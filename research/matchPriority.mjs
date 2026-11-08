// Prematch, source-aware fixture priority and squad-rotation signals.
// A match is never marked "unimportant" without actual standings and a verified schedule.
// Historical backtests must pass only information available before kickoff.
const DAY=86400000;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const value=(x,f=null)=>x==null||x===''?f:(Number.isFinite(Number(x))?Number(x):f);
const day=x=>String(x||'').slice(0,10);
const time=x=>{const v=Date.parse(x);return Number.isFinite(v)?v:null};
function score(m){return {h:value(m.home_score),a:value(m.away_score)}}
function isPrior(m,date){const s=score(m);return m?.status==='finished'&&s.h!==null&&s.a!==null&&time(m.kickoff)!==null&&day(m.kickoff)<day(date)}
function tableBefore(fixture,fixtures){
 const ids=new Set(),rows=new Map(),previous=fixtures.filter(m=>isPrior(m,fixture.kickoff)&&(!fixture.season||!m.season||m.season===fixture.season));
 for(const f of fixtures){if(f.home_team_id)ids.add(f.home_team_id);if(f.away_team_id)ids.add(f.away_team_id)}
 const make=id=>{if(!rows.has(id))rows.set(id,{teamId:id,p:0,played:0,gf:0,ga:0});return rows.get(id)};
 ids.forEach(make);
 for(const m of previous){const h=make(m.home_team_id),a=make(m.away_team_id),s=score(m);h.played++;a.played++;h.gf+=s.h;h.ga+=s.a;a.gf+=s.a;a.ga+=s.h;
 if(s.h>s.a)h.p+=3;else if(s.h<s.a)a.p+=3;else{h.p++;a.p++}}
 const sorted=[...rows.values()].sort((a,b)=>b.p-a.p||(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf||String(a.teamId).localeCompare(String(b.teamId)));
 const teams=sorted.map((r,i)=>({...r,rank:i+1,gd:r.gf-r.ga}));
 return {teams,byId:Object.fromEntries(teams.map(t=>[t.teamId,t])),played:previous.length,clubCount:teams.length};
}
function relativeImportance(standing,table,roundsLeft){
 if(!standing||standing.played<6||table.clubCount<10)return {pressure:0,reasons:['Málo historických zápasů – motivaci neodhaduji'],phase:'unknown'};
 const late=roundsLeft!==null?roundsLeft<=10:standing.played>=25;
 const veryLate=roundsLeft!==null?roundsLeft<=6:standing.played>=31;
 if(!late)return {pressure:0,reasons:['Základní ligový zápas'],phase:'season'};
 const n=table.clubCount,rank=standing.rank;
 const boundary=[1,Math.min(4,n),Math.max(1,n-3)];
 let pressure=0;const reasons=[];
 for(const b of boundary){
   const pivot=table.teams[b-1];
   if(!pivot)continue;
   const gap=Math.abs(standing.p-pivot.p);
   if(gap<=8){pressure=Math.max(pressure,gap<=3?.068:.035);
     reasons.push(b===1?'Boj o titul':b===Math.min(4,n)?'Boj o přední čtyřku':'Boj o záchranu');}
 }
 const optimistic=roundsLeft===null?null:roundsLeft*3;
 const safeBottom=rank<n-4&&standing.p-(table.teams[Math.max(0,n-4)]?.p??0)>Math.max(8,optimistic??8);
 const safeTop=rank>5&&(table.teams[3]?.p??standing.p)-standing.p>Math.max(8,optimistic??8);
 if(veryLate&&safeTop&&safeBottom&&!pressure){reasons.push('Klidný střed tabulky bez bezprostředního boje o klíčovou pozici');return {pressure:-.025,reasons,phase:'low-stakes'}}
 if(!reasons.length)reasons.push('Ligové body stále mohou rozhodovat');
 return {pressure,reasons,phase:veryLate?'late':'mid'};
}
function roundCount(teamId,date,matches,completed){
 if(!teamId||!Array.isArray(matches)||matches.length<100)return null;
 const season=matches.filter(m=>(m.home_team_id===teamId||m.away_team_id===teamId)&&m.kickoff);
 // Current and future fixture dates are used only for live previews (not offline historical inference).
 return Math.max(0,season.filter(m=>time(m.kickoff)>time(date)).length);
}
function nextPriorityFixture(teamId,fixture,context){
 const upcoming=(context.futureCupFixtures||[]).filter(m=>{
   if(m.team_id!==teamId||!m.verified||!m.kickoff)return false;
   const diff=(time(m.kickoff)-time(fixture.kickoff))/DAY;
   return diff>0&&diff<=7;
 }).sort((a,b)=>time(a.kickoff)-time(b.kickoff));
 return upcoming[0]||null;
}
function actualLineupEvidence(teamId,context,fixture){
 const record=(context.lineupEvidence||[]).find(x=>x.team_id===teamId);
 if(!record||record.verified!==true||time(record.published_at)===null||time(record.published_at)>time(fixture.kickoff))return null;
 const missing=value(record.key_players_resting,0), total=value(record.expected_starter_changes,0);
 return {missing:clamp(missing,0,11),changes:clamp(total,0,11),source:record.source||'confirmed lineup'};
}
export function assessMatchPriority(fixture,fixtures=[],context={}){
 const table=tableBefore(fixture,fixtures);
 function getTeam(teamId){
   const entry=table.byId[teamId];
   const remaining=context.liveScheduleVerified?roundCount(teamId,fixture.kickoff,fixtures):null;
   const stakes=relativeImportance(entry,table,remaining);
   const cup=nextPriorityFixture(teamId,fixture,context);
   const lineup=actualLineupEvidence(teamId,context,fixture);
   let rotation=.0;const reasons=[...stakes.reasons];
   if(cup){reasons.push('Ověřený '+(cup.competition||'pohárový')+' zápas za '+round((time(cup.kickoff)-time(fixture.kickoff))/DAY,1)+' dne');
     // A different match being important is not proof that the present fixture is sacrificed.
     if(cup.stage==='knockout'||cup.importance==='high')rotation+=.018;
   }
   if(lineup){
     rotation+=clamp(lineup.missing*.021+Math.max(0,lineup.changes-3)*.006,0,.16);
     reasons.push('Ověřené změny sestavy / klíčoví náhradníci: '+lineup.missing);
   }
   const lowPriority=stakes.phase==='low-stakes'&&cup!==null;
   if(lowPriority){reasons.push('Možná priorita jiného utkání, neověřená motivace hráčů');rotation+=.012}
   return {teamId,position:entry?.rank??null,points:entry?.p??null,games:entry?.played??0,
     remaining,pressure:stakes.pressure,rotationRisk:round(clamp(rotation,0,.18)),cup,
     confirmedRotation:lineup,reasons,lowPriority,inferredOnly:!lineup,knownInputs:{
       table:entry?.played>=6||false,upcomingCup:Boolean(cup),lineup:Boolean(lineup)}};
 }
 const home=getTeam(fixture.home_team_id),away=getTeam(fixture.away_team_id);
 return {home,away,tableSize:table.clubCount,tableMatches:table.played,
    note:'Rotace a ligové priority jsou pravděpodobnostní signály, nikoliv tvrzení, že tým nechce vyhrát.'};
}
function round(n,d){return Number(n.toFixed(d))}
