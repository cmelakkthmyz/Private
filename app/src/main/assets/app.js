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

const MOD=globalThis.PredictorV2,OLD=globalThis.PLModel,HOCK=globalThis.HockeyModel,AUTO=globalThis.AutoOdds;
const ARCHIVE=globalThis.CZ_ARCHIVE||{matches:[],verifiedSeasons:[],coverage:{loadedTrainingSeasons:0,requestedTrainingSeasons:20}};
const EN_ARCHIVE=globalThis.ENG_ARCHIVE||{matches:[],verifiedSeasons:[],coverage:{complete:0,requested:21}};
const VALIDATED=globalThis.V3_VALIDATION||{production:{advancedHistory:false,venueWeight:0,shotsWeight:0}};
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
let bookmakerOffers=[],oddsReceivedAt=null,oddsError='',ticketProfile='balanced',ticketStake=20;
let livePlContext=null,livePlTimestamp=null,backgroundErrors={};
const candidatesByLeague={pl:[],cz:[],hockey:[]};
const canonical=name=>ALIASES[name]||String(name||'').replace(/ FC$/,'').trim();
function acceptLiveContext(raw){
 const ctx=raw?.context;
 if(!ctx||!Array.isArray(ctx.teams)||ctx.teams.length<18||
  !Array.isArray(ctx.players)||ctx.players.length<200||!ctx.fetchedAt)return false;
 const at=Date.parse(ctx.fetchedAt),now=Date.now();
 if(!Number.isFinite(at)||at>now+120000||now-at>72*3600000)return false;
 if(!ctx.teams.every(t=>t.id&&Number.isFinite(Number(t.attack))&&Number.isFinite(Number(t.defense))))return false;
 livePlContext=ctx;livePlTimestamp=ctx.fetchedAt;
 try{localStorage.setItem('live-pl-context-v1',JSON.stringify(ctx));}catch(e){}
 return true;
}
function fplFresh(){
 const at=Date.parse(livePlContext?.fetchedAt||'');
 return Number.isFinite(at)&&at<=Date.now()+120000&&Date.now()-at<72*3600000;
}
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
 const feat=forecast.features||{},parts=[];
 if(Number.isFinite(feat.homeElo)&&Number.isFinite(feat.awayElo))
  parts.push('Forma týmů: síla Elo '+Math.round(feat.homeElo)+' : '+Math.round(feat.awayElo));
 if(feat.homeForm&&feat.awayForm)
  parts.push('Body z posledních zápasů na utkání: '+feat.homeForm.pointsPerGame+' : '+feat.awayForm.pointsPerGame);
 if(feat.homeRest?.restDays!=null&&feat.awayRest?.restDays!=null)
  parts.push('Dny od posledního ligového zápasu: '+feat.homeRest.restDays+' : '+feat.awayRest.restDays);
 if(feat.homeAvailability?.available||feat.awayAvailability?.available){
  const missingHome=(feat.homeAvailability?.missing||[]).slice(0,4).join(', ')||'bez potvrzených výpadků z FPL';
  const missingAway=(feat.awayAvailability?.missing||[]).slice(0,4).join(', ')||'bez potvrzených výpadků z FPL';
  parts.push('Dostupnost hráčů FPL – '+home+': '+missingHome+'; '+away+': '+missingAway);
 }
 const pri=feat.matchPriority;
 if(pri?.home?.cup)parts.push('Domácí mají v rozpisu také '+pri.home.cup.competition+
  ' dne '+new Date(pri.home.cup.kickoff).toLocaleDateString('cs-CZ')+'; důkaz účelového šetření hráčů to není');
 if(pri?.away?.cup)parts.push('Hosté mají v rozpisu také '+pri.away.cup.competition+
  ' dne '+new Date(pri.away.cup.kickoff).toLocaleDateString('cs-CZ')+'; důkaz účelového šetření hráčů to není');
 if(feat.additionalHistory?.evidence?.hasVenue)
  parts.push('Domácí a venkovní statistiky z dřívějších zápasů: zahrnuty po historickém ověření');
 const detail=parts.length?'<details class="factor-list"><summary>Co ovlivnilo předpověď</summary>'+
  '<ul>'+parts.slice(0,7).map(v=>'<li>'+escapeText(v)+'</li>').join('')+'</ul></details>':'';
 return '<article class="match"><div class="date">'+escapeText(meta||'')+'</div>'+
 '<div class="teams">'+escapeText(home)+'<br><span class="versus">vs.</span><br>'+escapeText(away)+'</div>'+
 '<div class="result"><div>Tip 1 / X / 2<div class="pick">'+escapeText(forecast.pick)+'</div></div>'+
 '<div>Nejpravděpodobnější skóre<div class="score">'+escapeText(forecast.score||'–')+'</div></div></div>'+
 '<div class="prob">'+['1','X','2'].map(k=>'<div>'+k+'<strong>'+pct(forecast.probabilities[k])+'</strong></div>').join('')+'</div>'+
 '<div class="meta">Modelová pravděpodobnost vybraného tipu: <strong>'+pct(forecast.probabilities[forecast.pick])+'</strong>'+
 (forecast.xgHome!=null?'<br>Očekávané góly: '+Number(forecast.xgHome).toFixed(2)+' : '+Number(forecast.xgAway).toFixed(2):'')+
 '<br>'+escapeText(forecast.explanation||'Lokální model; nejde o jistotu výsledku.')+
 (forecast.learnedFrom!=null?'<br>Samoučení: '+escapeText(String(forecast.learnedFrom)):'')+'</div>'+detail+'</article>';
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
 if(current==='cz')return ARCHIVE.matches||[];
 if(current==='pl')return EN_ARCHIVE.matches||[];
 return [];
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
 const useFplSource=current==='pl'&&!manual&&fplFresh();
 const verifiedHistorical=current==='pl'&&VALIDATED.production?.advancedHistory===true;
 // Base football hyperparameters are exactly those fixed by the 2024/25
 // validation, then checked unchanged on 2025/26. Fresh roster/cup overlays
 // are prospective-only and not claimed to have historic test accuracy.
 const testedCore=current==='pl'?VALIDATED.production?.config:null;
 const cfg={
  prior:testedCore?.prior??6,
  power:testedCore?.power??.87,
  eloWeight:current==='hockey'?.12:(testedCore?.eloWeight??.25),
  marketWeight:0,priorityWeight:current==='hockey'?0:.40,
  useFpl:manual||useFplSource,
  useAvailability:useFplSource,
  useAdvancedHistory:verifiedHistorical,
  venueWeight:verifiedHistorical?(VALIDATED.production.venueWeight||0):0,
  shotsWeight:0,
  homeBase:profileRates?.homeBase??testedCore?.homeBase??league.homeBase,
  awayBase:profileRates?.awayBase??testedCore?.awayBase??league.awayBase,
  decayDays:testedCore?.decayDays??135
 };
 const teams=manual?[
  {id:match.home_team_id,attack:Number($('home-strength').value),defense:Number($('home-strength').value)},
  {id:match.away_team_id,attack:Number($('away-strength').value),defense:Number($('away-strength').value)}
 ]:useFplSource?livePlContext.teams:[];
 const players=useFplSource?livePlContext.players:[];
 const result=MOD.predictIntelligence(match,history,{config:cfg,teams,players,schedule:history,
  futureCupFixtures:useFplSource?(livePlContext.futureCupFixtures||[]):[]});
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


function renderOdds(){
 const total=bookmakerOffers.length;
 const fresh=oddsReceivedAt&&Date.now()-Date.parse(oddsReceivedAt)<14*3600000;
 const candidates=Object.values(candidatesByLeague).flat();
 const matches=fresh?bookmakerOffers.map(offer=>AUTO.matchOffer(offer,candidates))
  .filter(Boolean):[];
 const uniqueIds=new Set(matches.map(x=>x.fixture.id));
 $('odds-total').textContent=String(total);
 $('odds-matched').textContent=String(uniqueIds.size);
 $('odds-updated').textContent=oddsReceivedAt?new Date(oddsReceivedAt).toLocaleTimeString('cs-CZ',
  {hour:'2-digit',minute:'2-digit'}):'–';
 $('odds-status').textContent=oddsError||(fresh?
  'Nabídka Tipsportu automaticky načtena · jen ověřená utkání ze tří soutěží.' :
  total?'Poslední data jsou starší než 14 hodin. Znovu načti kurzy, staré ceny nevyužívám.':
  'Čekám na automatické načtení aktuálních kurzů.');
 $('odds-status').className='odds-status'+(oddsError||total&&!fresh?' error':'');
 const selection=AUTO.buildAutoTickets(matches,{stake:ticketStake,profile:ticketProfile,maxTickets:4});
 if(!fresh){
  $('auto-results').innerHTML='<div class="no-edges">Kurzy nejsou ověřené nebo jejich platnost vypršela. Žádný tiket nevymýšlím.</div>';return;
 }
 const intro='<div class="ticket-summary">'+uniqueIds.size+' z '+total+' nabídek odpovídá ověřeným utkáním. '
  +selection.considered+' jednotlivých tipů prošlo prvním výpočtem.</div>';
 if(!selection.selected.length){
  $('auto-results').innerHTML=intro+'<div class="no-edges"><strong>Žádná obhajitelná kombinace.</strong><p>'
   +'Při zvoleném režimu model nenašel tiket s dostatečným konzervativním odhadem. Vyšší kurz sám o sobě neznamená výhodu. '
   +'Nabídky bez potvrzeného zápasu nebo spolehlivých pravděpodobností jsou záměrně vyřazené.</p></div>';
  return;
 }
 $('auto-results').innerHTML=intro+selection.selected.map((ticket,index)=>{
  const pc=Math.max(0,Math.min(100,ticket.lowerBound*100));
  const risk=Math.max(0,Math.min(100,Math.round(100-ticket.p*100)));
  return '<article class="auto-ticket"><div class="ticket-head"><span>Varianta '+(index+1)+
   ' · '+ticket.legs.length+' zápasy</span><span class="ticket-odds">'+ticket.odds.toFixed(2)+'×</span></div>'+
   ticket.legs.map(l=>'<div class="leg-row"><div class="leg-names"><strong>'+
    escapeText(l.home)+' – '+escapeText(l.away)+'</strong><small>'+
    escapeText(LEAGUES[l.league]?.title||l.league)+' · '+new Date(l.kickoff)
      .toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})+
    '</small></div><span class="leg-pick">'+escapeText(l.pick)+'</span>'+
    '<span class="leg-odds">'+Number(l.odds).toFixed(2)+'</span></div>').join('')+
   '<div class="ticket-prob-row"><span>Odhad úspěchu celé kombinace</span><strong>'+pct(ticket.p)+'</strong></div>'+
   '<div class="prob-track"><div style="width:'+pc.toFixed(2)+'%"></div></div>'+
   '<div class="ticket-financial"><div><small>Ukázkový vklad</small><strong>'+ticket.stake+' Kč</strong></div>'+
   '<div><small>Možná celková výplata</small><strong>'+ticket.payout.toFixed(0)+' Kč</strong></div></div>'+
   '<p class="ticket-caveat">Konzervativní modelová hodnota: '+
    (ticket.conservativeEV>=0?'+':'')+pct(ticket.conservativeEV)+'. '+
    'Odhad není záruka ani prokázaný zisk; všechna utkání musejí vyjít.</p>'+
   (ticket.unverified?'<p class="error">Pozor: některé modely nemají nezávisle ověřenou kalibraci.</p>':'')+
   '</article>';
 }).join('');
}
function loadAutomaticOdds(refresh=true){
 if(refresh){oddsError='';$('odds-status').textContent='Procházím veřejnou denní nabídku Tipsportu…';}
 if(globalThis.AndroidPredictor?.loadOdds){
   globalThis.AndroidPredictor.loadOdds();
   if(refresh&&globalThis.AndroidPredictor.loadAllLeagues)globalThis.AndroidPredictor.loadAllLeagues();
 }else{
   oddsError='Načítání veřejných kurzů je dostupné v instalované Android aplikaci.';
   renderOdds();
 }
}
globalThis.receiveOdds=function(raw){
 try{
  const data=JSON.parse(raw);
  if(data.error)throw Error(data.error);
  if(!Array.isArray(data.offers)||!data.offers.length)throw Error('Veřejný zdroj neposkytuje ověřitelné kurzy 1/X/2.');
  bookmakerOffers=data.offers.map(AUTO.normalizeOffer).filter(Boolean);
  if(!bookmakerOffers.length)throw Error('Žádná platná kurzová nabídka pro sledované ligy.');
  oddsReceivedAt=data.fetchedAt||new Date().toISOString();
  oddsError='';
  try{localStorage.setItem('auto-odds-v1',JSON.stringify({
   offers:bookmakerOffers,fetchedAt:oddsReceivedAt,source:data.source
  }));}catch(e){}
 }catch(e){
  oddsError=e.message||'Kurzy se nepodařilo načíst.';
  // Cached data are shown only if demonstrably less than fourteen hours old.
  try{
   const prev=JSON.parse(localStorage.getItem('auto-odds-v1')||'null');
   if(prev?.fetchedAt&&Date.now()-Date.parse(prev.fetchedAt)<14*3600000){
    bookmakerOffers=(prev.offers||[]).map(AUTO.normalizeOffer).filter(Boolean);
    oddsReceivedAt=prev.fetchedAt;
    oddsError+=' · Poslední uložený snapshot. Před sázkou cenu znovu ověř.';
   }
  }catch(x){}
 }
 renderOdds();
};
function setTicketProfile(name){
 if(!['balanced','longshot','draws'].includes(name))return;
 ticketProfile=name;
 for(const k of ['balanced','longshot','draws'])$('profile-'+k).setAttribute('aria-pressed',String(k===name));
 renderOdds();
}
function setTicketStake(value){
 ticketStake=value;
 for(const k of [10,20,50])$('stake-'+k).setAttribute('aria-pressed',String(k===value));
 renderOdds();
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
    league:current,kickoff:m.kickoff,status:'scheduled',modelVerified:false,
    pick:forecast.pick,probabilities:forecast.probabilities});
   return scoreCard(m.home_team_name,m.away_team_name,forecast,
    new Date(m.kickoff).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}));
  }catch(e){return '<div class="match error">Předpověď není dostupná pro '+escapeText(m.home_team_name)+' – '+escapeText(m.away_team_name)+'</div>'}
 }).join('')||'<div class="match">Žádné další zápasy ve vráceném programu.</div>';
 candidatesByLeague[current]=ticketCandidates.slice();
 renderOdds();
 status((cache?'Uložený rozpis':'Ověřený rozpis')+' · '+incoming.length+' dalších zápasů · '+(changes?changes+' tipů vyhodnoceno · ':'')+
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
   ticketCandidates.push({id:fixture.id,home,away,
    league:'hockey',kickoff:fixture.kickoff,status:'scheduled',modelVerified:false,
    pick:forecast.pick,probabilities:forecast.probabilities});
   return scoreCard(home,away,forecast,new Date(e.date).toLocaleString('cs-CZ',
    {day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}));
  }catch(err){return '<article class="match error">Nelze spočítat zápas '+escapeText(home)+' – '+escapeText(away)+'</article>';}
 }).join('')||'<article class="match">Pro dnešní den nejsou k dispozici další ověřené zápasy extraligy. Ruční simulace z ligové tabulky funguje.</article>';
 candidatesByLeague.hockey=ticketCandidates.slice();
 renderOdds();
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
  'Premier League: '+(EN_ARCHIVE.coverage?.complete||0)+' ověřených ročníků OpenFootball CC0 ('+
  (EN_ARCHIVE.coverage?.fixtures||0)+' zápasů) · '+(fplFresh()?
   'aktuální síly klubů a dostupnost hráčů z FPL ('+new Date(livePlTimestamp).toLocaleString('cs-CZ')+')':
   'FPL informace o hráčích nyní nejsou ověřené; používám historické výsledky')+
  ' · pokročilé domácí/venkovní statistiky '+(VALIDATED.production?.advancedHistory?'aktivní po historické validaci':'vypnuté, bez potvrzeného zlepšení')+'.';
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
// Scan all watched leagues, not only the currently selected tab.
function collectCandidatesForLeague(league,payload){
 if(!LEAGUES[league]||!payload||payload.error){
  backgroundErrors[league]=payload?.error||'Data nedostupná';
  candidatesByLeague[league]=[];return;
 }
 const before=current;current=league;
 try{
  if(league==='pl')acceptLiveContext(payload);
  const now=Date.now(),chosen=[];
  if(league==='hockey'){
   if(!Array.isArray(payload.standings)||payload.standings.length<10)throw Error('Neověřená tabulka');
   hockeyStandings=payload.standings;hockeyUpdated=payload.updated;
   const games=payload.scheduleCurrent&&Array.isArray(payload.events)?payload.events:[];
   const state=readState();
   for(const e of games){
    if(!e.date||Date.parse(e.date)<=now||!e.home||!e.away)continue;
    const home=HOCK.hockeyTeamKey(e.home),away=HOCK.hockeyTeamKey(e.away);
    const match={id:'cz_hockey_daily_'+e.id,kickoff:e.date,season:seasonOf(e.date),
     home_team_id:home,away_team_id:away,home_team_name:home,
     away_team_name:away,status:'scheduled',competition:'cz-hockey'};
    const tip=futureForecast(match,[],state);
    chosen.push({id:match.id,home,away,league,kickoff:match.kickoff,status:'scheduled',
     modelVerified:false,probabilities:tip.probabilities,pick:tip.pick});
   }
  }else{
   const rows=(payload.events||[]).map(eventFromEspn).filter(Boolean);
   if(!rows.length)throw Error('Žádné ověřené zápasy');
   const {state}=updateHistory(rows);
   const future=rows.filter(x=>x.status!=='finished'&&Date.parse(x.kickoff)>now)
     .sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff)).slice(0,80);
   for(const m of future){
    try{
     const tip=futureForecast(m,rows,state);
     chosen.push({id:m.id,home:m.home_team_name,away:m.away_team_name,league,
      kickoff:m.kickoff,status:'scheduled',modelVerified:false,
      probabilities:tip.probabilities,pick:tip.pick});
    }catch(e){}
   }
  }
  candidatesByLeague[league]=chosen;
  delete backgroundErrors[league];
 }catch(e){
  backgroundErrors[league]=e.message||'Chyba modelu';
  candidatesByLeague[league]=[];
 }finally{current=before}
}
globalThis.receiveAllLeagues=function(raw){
 try{
  const responses=JSON.parse(raw);
  for(const league of ['pl','cz','hockey'])collectCandidatesForLeague(league,responses[league]);
 }catch(e){backgroundErrors.system=e.message||'Neplatná data'}
 renderOdds();
 if(current==='pl')renderCoverage();
};

globalThis.receiveMatches=function(raw,requestedLeague){
 if(requestedLeague&&requestedLeague!==current)return;
 try{
  const d=JSON.parse(raw);
  if(current==='pl')acceptLiveContext(d);
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
 refillSelects();renderCoverage();renderOdds();requestSchedule();
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
for(const profile of ['balanced','longshot','draws'])
 $('profile-'+profile).addEventListener('click',()=>setTicketProfile(profile));
for(const stake of [10,20,50])
 $('stake-'+stake).addEventListener('click',()=>setTicketStake(stake));
$('scan-odds').addEventListener('click',()=>loadAutomaticOdds(true));
try{
 const restored=JSON.parse(localStorage.getItem('live-pl-context-v1')||'null');
 if(restored)acceptLiveContext({context:restored});
}catch(e){}
changeLeague('pl');
loadAutomaticOdds(true);
})();
