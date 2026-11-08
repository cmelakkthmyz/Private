(function(){
'use strict';
const $=id=>document.getElementById(id);
const escapeText=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const pct=x=>(100*x).toFixed(1)+' %';
const outcomeScore=(home,away)=>home>away?'1':home===away?'X':'2';
function scoreForSelectedPick(xgHome,xgAway,pick){
  if(!['1','X','2'].includes(pick))throw Error('Invalid outcome');
  const lamH=Number(xgHome),lamA=Number(xgAway);
  if(!Number.isFinite(lamH)||!Number.isFinite(lamA))return '–';
  const pmf=(k,lam)=>{let p=Math.exp(-lam);for(let i=1;i<=k;i++)p=p*lam/i;return p};
  let max=-1,score='–';
  for(let h=0;h<=11;h++)for(let a=0;a<=11;a++){
    if(outcomeScore(h,a)!==pick)continue;
    const p=pmf(h,lamH)*pmf(a,lamA);
    if(p>max){max=p;score=h+':'+a}
  }
  return score;
}

const MOD=globalThis.PredictorV2,OLD=globalThis.PLModel,HOCK=globalThis.HockeyModel,TICKET=globalThis.TicketCalculator;
const ARCHIVE=globalThis.CZ_ARCHIVE||{matches:[],verifiedSeasons:[],coverage:{loadedTrainingSeasons:0,requestedTrainingSeasons:20}};
const HOCKEY=['Bílí Tygři Liberec','Dynamo Pardubice','HC Energie Karlovy Vary','HC Kometa Brno',
 'HC Motor České Budějovice','HC Olomouc','HC Oceláři Třinec','HC Sparta Praha',
 'HC Škoda Plzeň','HC Verva Litvínov','HC Vítkovice Ridera','Mountfield HK',
 'Rytíři Kladno','BK Mladá Boleslav'];
const LEAGUES={
 pl:{id:'pl',title:'Premier League',namespace:'pl-football',homeBase:1.65,awayBase:1.33},
 cz:{id:'cz',title:'Chance Liga',namespace:'cz-football',homeBase:1.53,awayBase:1.18},
 hockey:{id:'hockey',title:'Česká hokejová extraliga',namespace:'cz-hockey',homeBase:3.15,awayBase:2.83}
};
const ALIASES={
 'Manchester City FC':'Manchester City','Manchester United FC':'Manchester United',
 'Manchester Utd':'Manchester United','Newcastle':'Newcastle United',
 'Nottingham Forest':'Nottingham Forest','Tottenham':'Tottenham Hotspur',
 'West Ham':'West Ham United','Wolves':'Wolverhampton Wanderers',
 'AFC Bournemouth':'Bournemouth','Brighton & Hove Albion':'Brighton',
 'Sparta Prague':'Sparta Praha','Sparta Praha':'Sparta Praha',
 'Slavia Prague':'Slavia Praha','Slavia Praha':'Slavia Praha',
 'Viktoria Plzen':'Viktoria Plzeň','Viktoria Plzeň':'Viktoria Plzeň',
 'Baník Ostrava':'Baník Ostrava','Banik Ostrava':'Baník Ostrava',
 'Viktoria Plzeň':'Viktoria Plzeň','Slovan Liberec':'Slovan Liberec',
 'Jablonec':'Jablonec','Mlada Boleslav':'Mladá Boleslav',
 'Hradec Kralove':'Hradec Králové','Sigma Olomouc':'Sigma Olomouc',
 'Karvina':'Karviná','Pardubice':'Pardubice','Bohemians 1905':'Bohemians Praha 1905',
 'Teplice':'Teplice','Slovacko':'Slovácko','Zlin':'Zlín','Dukla Prague':'Dukla Praha'
};
let current='pl',sessionMatches=[],sessionTeams=[],lastPayload=null,lastUpdated=null;
let hockeyStandings=null,hockeyUpdated=null,ticketCandidates=[];
const canonical=name=>ALIASES[name]||String(name||'').replace(/ FC$/,'').trim();
const storeKey=league=>'premier-intelligence-online-v1:'+LEAGUES[league].namespace;
function readState(){
 const key=storeKey(current),fallback=MOD.newLearningState(LEAGUES[current].namespace);
 try{
  const saved=JSON.parse(localStorage.getItem(key)||'null');
  return saved?.version===1&&saved.competition===fallback.competition&&Array.isArray(saved.events)?saved:fallback;
 }catch{return fallback}
}
function saveState(state){
 try{localStorage.setItem(storeKey(current),JSON.stringify(state));}catch(e){}
}
function scoreCard(home,away,forecast,meta){
 return '<article class="match"><div class="date">'+escapeText(meta||'')+'</div>'+
 '<div class="teams">'+escapeText(home)+'<br><span class="versus">vs.</span><br>'+escapeText(away)+'</div>'+
 '<div class="result"><div>Tip 1 / X / 2<div class="pick">'+escapeText(forecast.pick)+'</div></div>'+
 '<div>Nejpravděpodobnější skóre<div class="score">'+escapeText(forecast.score||'–')+'</div></div></div>'+
 '<div class="prob">'+['1','X','2'].map(k=>'<div>'+k+'<strong>'+pct(forecast.probabilities[k])+'</strong></div>').join('')+'</div>'+
 '<div class="meta">Odhad úspěšnosti konkrétního tipu: <strong>'+pct(forecast.probabilities[forecast.pick])+'</strong>'+
 (forecast.xgHome!=null?'<br>Očekávané góly: '+Number(forecast.xgHome).toFixed(2)+' : '+Number(forecast.xgAway).toFixed(2):'')+
 '<br>'+escapeText(forecast.explanation||'Lokální model; nejde o jistotu výsledku.')+
 (forecast.learnedFrom!=null?'<br>Samoučení: '+forecast.learnedFrom+' dříve vyhodnocených vlastních tipů':'')+'</div></article>';
}
function status(message,isError=false){
 $('status').textContent=message;$('status').className=isError?'error':'';
}
function eventFromEspn(e){
 const comp=e.competitions?.[0]?.competitors||[];
 const h=comp.find(x=>x.homeAway==='home'),a=comp.find(x=>x.homeAway==='away');
 if(!h||!a||!e.date||!Number.isFinite(Date.parse(e.date)))return null;
 const completed=e.status?.type?.completed===true||e.status?.type?.name==='STATUS_FINAL';
 const home_score=completed?Number(h.score):null,away_score=completed?Number(a.score):null;
 return {id:current+'_espn_'+String(e.id),competition:LEAGUES[current].namespace,
  season:seasonOf(e.date),kickoff:e.date,home_team_id:canonical(h.team?.displayName),
  away_team_id:canonical(a.team?.displayName),home_team_name:canonical(h.team?.displayName),
  away_team_name:canonical(a.team?.displayName),status:completed?'finished':'scheduled',
  home_score:Number.isFinite(home_score)?home_score:null,
  away_score:Number.isFinite(away_score)?away_score:null};
}
function seasonOf(date){
 const d=new Date(date),y=d.getUTCMonth()>=6?d.getUTCFullYear():d.getUTCFullYear()-1;
 return y+'-'+String((y+1)%100).padStart(2,'0');
}
function archiveMatches(){
 return current==='cz'?ARCHIVE.matches||[]:[];
}
function knownTeams(){
 if(current==='pl')return OLD.TEAM_NAMES;
 if(current==='hockey')return HOCKEY;
 return [...new Set([...archiveMatches().flatMap(m=>[m.home_team_id,m.away_team_id]),
 ...sessionMatches.flatMap(m=>[m.home_team_id,m.away_team_id])])].sort((a,b)=>a.localeCompare(b,'cs'));
}
function refillSelects(){
 const options=knownTeams(),home=$('home').value,away=$('away').value;
 for(const id of ['home','away'])$(id).innerHTML=options.map(t=>'<option value="'+escapeText(t)+'">'+escapeText(t)+'</option>').join('');
 if(options.includes(home))$('home').value=home;
 if(options.includes(away)&&away!==$('home').value)$('away').value=away;
 else $('away').selectedIndex=Math.min(1,options.length-1);
}
function modelForFixture(match,matches,manual=false){
 const league=LEAGUES[current];
 const historical=archiveMatches();
 const history=historical.concat(matches||[]);
 const hockeyProfile=current==='hockey'?HOCK.hockeyStandingsProfile(hockeyStandings):null;
 const profileRates=current==='hockey'?HOCK.hockeyFixtureRates(hockeyProfile,match.home_team_id,match.away_team_id):null;
 const cfg={
  prior:6,power:.87,eloWeight:current==='hockey'?.12:.25,marketWeight:0,
  priorityWeight:current==='hockey'?0:.40,
  useFpl:manual,homeBase:profileRates?.homeBase??league.homeBase,
  awayBase:profileRates?.awayBase??league.awayBase,decayDays:135
 };
 const teams=manual?[
  {id:match.home_team_id,attack:Number($('home-strength').value),defense:Number($('home-strength').value)},
  {id:match.away_team_id,attack:Number($('away-strength').value),defense:Number($('away-strength').value)}
 ]:[];
 const result=MOD.predictIntelligence(match,history,{config:cfg,teams,schedule:history});
 return current==='hockey'?HOCK.calibrateRegulationHockey(result,hockeyProfile):result;
}
function updateHistory(played){
 const state=readState();let changes=0;
 const pending=state.events.filter(e=>!e.settledAt);
 const byId=new Map(played.filter(g=>g.status==='finished').map(g=>[g.id,g]));
 for(const item of pending){
  const result=byId.get(item.id);
  if(!result||!Number.isInteger(result.home_score)||!Number.isInteger(result.away_score))continue;
  try{
   if(MOD.settleResult(state,{id:item.id,home_score:result.home_score,away_score:result.away_score,
    settledAt:new Date().toISOString()}))changes++;
  }catch(e){}
 }
 if(changes)saveState(state);
 return {state,changes};
}
function futureForecast(match,all,state){
 const base=modelForFixture(match,all),at=new Date().toISOString();
 const existing=state.events.find(e=>e.id===match.id);
 const snapshot=existing||MOD.adaptivePrediction(LEAGUES[current].namespace,base,null,state,at);
 if(!existing){
  try{
   if(MOD.recordForecast(state,{id:match.id,competition:LEAGUES[current].namespace,
    predictedAt:at,kickoff:match.kickoff,pick:snapshot.pick,
    probabilities:snapshot.probabilities,experts:snapshot.experts}))saveState(state);
  }catch(e){}
 }
 return {...base,pick:snapshot.pick,probabilities:snapshot.probabilities,
  score:scoreForSelectedPick(base.xgHome,base.xgAway,snapshot.pick),
  confidence:snapshot.probabilities[snapshot.pick],learnedFrom:existing?'původní uložený tip':'průběžný model',
  explanation:existing?'Původní předzápasový tip z '+new Date(existing.predictedAt).toLocaleString('cs-CZ')+'.':'Lokální ensemble: Poisson, Elo a váhy upravované podle minulých chyb.'};
}


function renderTicketForm(){
 const count=Number($('ticket-count').value||2);
 const box=$('ticket-legs');
 if(ticketCandidates.length<2){
  box.innerHTML='<p class="meta">V této soutěži zatím nejsou aspoň dvě naplánovaná utkání s vypočtenou předpovědí.</p>';
  $('ticket-result').textContent='';return;
 }
 const sorted=[...ticketCandidates].sort((a,b)=>
   b.probabilities[b.pick]-a.probabilities[a.pick]);
 box.innerHTML=Array.from({length:count},(_,i)=>{
  const options=sorted.map((x,j)=>'<option value="'+escapeText(x.id)+'"'+(j===i?' selected':'')+'>'+
    escapeText(x.home+' – '+x.away)+'</option>').join('');
  const predicted=sorted[Math.min(i,sorted.length-1)].pick;
  const picks=['1','X','2'].map(p=>'<option value="'+p+'"'+(p===predicted?' selected':'')+'>'+p+'</option>').join('');
  return '<div class="ticket-leg"><label>Utkání '+(i+1)+'<select id="ticket-match-'+i+'">'+options+'</select></label>'+
    '<label>Tip<select id="ticket-pick-'+i+'">'+picks+'</select></label>'+
    '<label>Aktuální kurz<input type="text" inputmode="decimal" id="ticket-odds-'+i+'" placeholder="např. 1,85"></label></div>';
 }).join('');
 $('ticket-result').textContent='';
}
function evaluateTicketForm(){
 const count=Number($('ticket-count').value||2);
 const rows=[];
 for(let i=0;i<count;i++){
  const game=$('ticket-match-'+i),pick=$('ticket-pick-'+i),odd=$('ticket-odds-'+i);
  if(!game||!pick||!odd){$('ticket-result').textContent='Nejdřív načti zápasy.';return}
  const match=ticketCandidates.find(x=>x.id===game.value);
  if(!match){$('ticket-result').textContent='Pro tento zápas nejsou dostupná data.';return}
  rows.push({matchId:match.id,home:match.home,away:match.away,pick:pick.value,
   probability:match.probabilities[pick.value],odds:odd.value,
   competition:LEAGUES[current].namespace});
 }
 try{
  const result=TICKET.evaluateCombo(rows,$('ticket-stake').value);
  const modelValue=result.modelEV>=0?'+':'';
  $('ticket-result').innerHTML='<div class="ticket-result">'+
   '<strong>'+escapeText($('ticket-bookmaker').value)+' · pouze výpočet</strong>'+
   '<p>Odhad šance celého tiketu: <strong>'+pct(result.combinedProbability)+'</strong></p>'+
   '<p>Součin kurzů: <strong>'+result.combinedOdds.toFixed(2)+'</strong> · Férový modelový kurz: '+result.fairCombinedOdds.toFixed(2)+'</p>'+
   '<p>Případná výplata při správných všech tipech: '+result.potentialPayout.toFixed(0)+' Kč.</p>'+
   '<p>Teoretická hodnota podle modelu: <strong>'+modelValue+pct(result.modelEV)+'</strong> ('+
   (result.expectedNetValue>=0?'+':'')+result.expectedNetValue.toFixed(0)+' Kč oproti zadanému vkladu v průměru).</p>'+
   '<p class="risk">Nejde o jistý nebo prokázaně výhodný tiket. '+result.warnings.map(escapeText).join(' ')+'</p></div>';
 }catch(e){
  $('ticket-result').textContent=e.message||'Kurzy nejsou vyplněné správně.';
 }
}

function renderSchedule(events,receivedAt,cache=false){
 const parsed=events.map(eventFromEspn).filter(Boolean);
 if(!parsed.length)throw Error('Zdroj nevrátil ověřitelná utkání');
 sessionMatches=parsed;refillSelects();
 const {state,changes}=updateHistory(parsed);
 const now=Date.now();
 const incoming=parsed.filter(m=>m.status!=='finished'&&Date.parse(m.kickoff)>now)
  .sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff)).slice(0,30);
 ticketCandidates=[];
 $('matches').innerHTML=incoming.map(m=>{
  try{
   const forecast=futureForecast(m,parsed,state);
   ticketCandidates.push({id:m.id,home:m.home_team_name,away:m.away_team_name,
    pick:forecast.pick,probabilities:forecast.probabilities});
   return scoreCard(m.home_team_name,m.away_team_name,forecast,
    new Date(m.kickoff).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}));
  }catch(e){return '<div class="match error">Předpověď není dostupná pro '+escapeText(m.home_team_name)+' – '+escapeText(m.away_team_name)+'</div>'}
 }).join('')||'<div class="match">Žádné další zápasy ve vráceném programu.</div>';
 renderTicketForm();
 status((cache?'Uložený rozpis':'ESPN rozpis')+' · '+incoming.length+' dalších zápasů · '+(changes?changes+' tipů vyhodnoceno · ':'')+
 'Aktualizace '+new Date(receivedAt).toLocaleString('cs-CZ'));
 renderCoverage(state);
}

function renderHockey(raw,fromCache=false){
 if(raw.sport!=='hockey')throw Error('Neznámý formát hokejových dat');
 if(!Array.isArray(raw.standings)||raw.standings.length<10)throw Error('Zdroj nevrátil platnou tabulku');
 hockeyStandings=raw.standings;
 hockeyUpdated=raw.updated;
 // Hockey table is a current snapshot, NOT an individual 60-minute match archive.
 // It may inform a future prediction; it cannot retroactively settle old 1/X/2 bets.
 sessionMatches=[];
 refillSelects();
 const now=Date.now(),sourceEntries=raw.scheduleCurrent&&Array.isArray(raw.events)?raw.events:[];
 const future=sourceEntries.filter(e=>e.date&&Date.parse(e.date)>now&&e.home&&e.away)
  .sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 const state=readState();
 ticketCandidates=[];
 $('matches').innerHTML=future.map(e=>{
  const home=HOCK.hockeyTeamKey(e.home),away=HOCK.hockeyTeamKey(e.away);
  const fixture={id:'cz_hockey_daily_'+e.id,kickoff:e.date,season:seasonOf(e.date),
   home_team_id:home,away_team_id:away,home_team_name:home,away_team_name:away,
   status:'scheduled',competition:'cz-hockey'};
  try{
   const forecast=futureForecast(fixture,[],state);
   ticketCandidates.push({id:fixture.id,home,away,pick:forecast.pick,probabilities:forecast.probabilities});
   return scoreCard(home,away,forecast,new Date(e.date).toLocaleString('cs-CZ',
    {day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}));
  }catch(err){return '<article class="match error">Nelze spočítat zápas '+escapeText(home)+' – '+escapeText(away)+'</article>';}
 }).join('')||'<article class="match">Pro dnešní den nejsou k dispozici další ověřené zápasy extraligy. Ruční simulace z ligové tabulky funguje.</article>';
 renderTicketForm();
 const age=raw.updated&&Number.isFinite(Date.parse(raw.updated))?Math.round((Date.now()-Date.parse(raw.updated))/3600000):null;
 status('Česká extraliga: '+future.length+' dnešních utkání · tabulka '+escapeText(raw.updated||'bez data')+
  (age!==null&&age>48?' · Pozor: starší než 48 hodin':'')+
  ' · CC BY 4.0, zdroj SazkyWeb.cz'+(fromCache?' · offline kopie':''),
  Boolean(fromCache||age!==null&&age>48));
 renderCoverage(state);
 if(!fromCache){
  try{localStorage.setItem('hockey-cache-v1',JSON.stringify(raw));}catch(e){}
 }
}

function renderCoverage(state=readState()){
 const league=LEAGUES[current];
 const info=MOD.learningSummary(state,new Date().toISOString());
 const recorded=info.settled?info.settled+' vyhodnocených vlastních tipů; úspěšnost '+pct(info.accuracy):'Zatím žádné vyhodnocené vlastní tipy';
 const coverage=current==='cz'?
  'Doložené historické sezóny: '+(ARCHIVE.verifiedSeasons||[]).join(', ')+
  ' · '+(ARCHIVE.coverage?.loadedTrainingSeasons||0)+' z 20 požadovaných starších sezón. Chybějící data nejsou doplňována odhady.':
  current==='hockey'?'Zdroj tabulky: SazkyWeb.cz (CC BY 4.0) · '+(hockeyUpdated||'offline')+'. Statistiky obsahují i góly z prodloužení; výsledek 1/X/2 je předpověď po 60 minutách, experimentální. Bez historie výsledků po 60 minutách se model zatím sám z hokeje neučí.':
  'Premier League: model používá aktuálně známé výsledky a průběžně uložené vlastní tipy.';
 $('coverage').textContent=league.title+' · '+coverage+' · '+recorded;
}
function fallback(message){
 if(current==='hockey'){
  try{
   const raw=JSON.parse(localStorage.getItem('hockey-cache-v1')||'null');
   if(raw){renderHockey({...raw,events:[],scheduleCurrent:false},true);
    status(message+' · Uložená tabulka může být zastaralá.',true);return;}
  }catch(e){}
  status(message+' Ruční základní model funguje offline.',true);$('matches').innerHTML='';return;
 }
 const saved=localStorage.getItem('espn-cache:'+current);
 if(saved){
  try{
   const obj=JSON.parse(saved);lastPayload=obj.events;lastUpdated=obj.updated;
   renderSchedule(obj.events,obj.updated,true);
   status(message+' · Zobrazuji poslední uložená data.',true);
   return;
  }catch(e){}
 }
 status(message+' Ruční zápas funguje i bez připojení.',true);
 $('matches').innerHTML='';
}
globalThis.receiveMatches=function(raw,requestedLeague){
 if(requestedLeague&&requestedLeague!==current)return;
 try{
  const d=JSON.parse(raw);
  if(d.error)throw Error(d.error);
  if(current==='hockey'){
   renderHockey(d);return;
  }
  if(!Array.isArray(d.events)||!d.events.length)throw Error('ESPN neposkytla program');
  const updated=new Date().toISOString();
  lastPayload=d.events;lastUpdated=updated;
  const compact=d.events.map(e=>({id:e.id,date:e.date,status:e.status,
   competitions:[{competitors:(e.competitions?.[0]?.competitors||[]).map(x=>({
    homeAway:x.homeAway,score:x.score,team:{displayName:x.team?.displayName}}))}]}));
  try{localStorage.setItem('espn-cache:'+current,JSON.stringify({events:compact,updated}));}catch(e){}
  renderSchedule(compact,updated);
 }catch(e){fallback('Data nelze načíst: '+e.message+'.');}
};
function requestSchedule(){
 status('Načítám skutečná utkání '+LEAGUES[current].title+'…');
 if(globalThis.AndroidPredictor?.loadFixtures)globalThis.AndroidPredictor.loadFixtures(current);
 else fallback('Nativní Android připojení není dostupné.');
}
function changeLeague(id){
 current=id;lastPayload=null;lastUpdated=null;sessionMatches=[];ticketCandidates=[];
 for(const k of Object.keys(LEAGUES))$('league-'+k).setAttribute('aria-pressed',String(k===id));
 $('match-title').textContent='Zápasy – '+LEAGUES[id].title;
 $('manual-hint').textContent=id==='hockey'?'Hokej 1/X/2: pouze stav po 60 minutách. Síla klubů se při připojení vypočítá z tabulky SazkyWeb.cz; model zůstává experimentální.':
  'Vyber týmy a uprav sílu; výsledky jsou pravděpodobnostní odhady, ne zaručené tipy.';
 $('matches').innerHTML='';$('manual-result').innerHTML='';
 if(id==='hockey'&&!hockeyStandings){
  try{const raw=JSON.parse(localStorage.getItem('hockey-cache-v1')||'null');if(raw?.standings){hockeyStandings=raw.standings;hockeyUpdated=raw.updated;}}catch(e){}
 }
 refillSelects();renderCoverage();renderTicketForm();requestSchedule();
}
for(const id of Object.keys(LEAGUES))$('league-'+id).addEventListener('click',()=>changeLeague(id));
for(const s of ['home','away'])$(''+s+'-strength').addEventListener('input',()=>{$(s+'-power').textContent=$(s+'-strength').value});
$('calc').addEventListener('click',()=>{
 const home=$('home').value,away=$('away').value;
 if(!home||!away||home===away){$('manual-result').innerHTML='<p class="error">Vyber dvě různá mužstva.</p>';return;}
 try{
  const date=new Date(Date.now()+3*3600000).toISOString();
  const fixture={id:'manual-'+current,season:seasonOf(date),kickoff:date,
   home_team_id:home,away_team_id:away,home_team_name:home,away_team_name:away,status:'scheduled'};
  const base=modelForFixture(fixture,sessionMatches,true);
  const state=readState(),adaptive=MOD.adaptivePrediction(LEAGUES[current].namespace,base,null,state,new Date().toISOString());
  $('manual-result').innerHTML=scoreCard(home,away,{
   ...base,pick:adaptive.pick,probabilities:adaptive.probabilities,
   score:scoreForSelectedPick(base.xgHome,base.xgAway,adaptive.pick),
   learnedFrom:adaptive.learnedFrom,
   explanation:'Ruční simulace. Síla týmů a dříve dokončené výsledky, pokud jsou dostupné.'
  },'Orientační ruční simulace · bez zaznamenání neuskutečněného zápasu');
 }catch(e){$('manual-result').textContent='Výpočet se nezdařil: '+e.message;}
});
$('refresh').addEventListener('click',requestSchedule);
$('ticket-count').addEventListener('change',renderTicketForm);
$('ticket-calc').addEventListener('click',evaluateTicketForm);
changeLeague('pl');
})();
