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

const MOD=globalThis.PredictorV2,OLD=globalThis.PLModel,HOCK=globalThis.HockeyModel,AUTO=globalThis.AutoOdds,PAPER=globalThis.PaperBet,MODEL_TICKETS=globalThis.ModelTicketBuilder,MODEL_JOURNAL=globalThis.ModelTicketJournal;
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
let oddsProvider=['chance','tipsport-api'].includes(localStorage.getItem('sport-odds-provider'))?localStorage.getItem('sport-odds-provider'):'tipsport';
let pendingChanceKeySave=false;
let modelTicketType='auto',modelTicketMax=3,modelTicketOptions=[],selectedModelTicketId=null,modelTicketGenerateCount=0;
const MODEL_JOURNAL_KEY='sport-predictor-model-journal-v1';
let modelTicketJournal=loadModelTicketJournal();
function loadModelTicketJournal(){
 try{
  const p=JSON.parse(localStorage.getItem(MODEL_JOURNAL_KEY)||'null');
  if(p?.version===1&&Array.isArray(p.drafts)&&Array.isArray(p.arena))return p;
 }catch(e){}
 return MODEL_JOURNAL.emptyTicketJournal();
}
function saveModelTicketJournal(){
 try{localStorage.setItem(MODEL_JOURNAL_KEY,JSON.stringify(modelTicketJournal));return true;}
 catch(e){$('model-ticket-action-status').textContent='Uložení se nezdařilo – zkontroluj dostupné místo.';return false;}
}
const oddsCacheKey=()=>oddsProvider==='chance'?'auto-odds-v1:chance':oddsProvider==='tipsport-api'?'auto-odds-v2:tipsport-api':'auto-odds-v1';
let livePlContext=null,livePlTimestamp=null,backgroundErrors={};
const candidatesByLeague={pl:[],cz:[],hockey:[]};
let paperLedger=loadPaperLedger(),paperMatched=[],paperNote='';
const PAPER_KEY='sport-predictor-paper-v1';
function loadPaperLedger(){
 try{
  const parsed=JSON.parse(localStorage.getItem('sport-predictor-paper-v1')||'null');
  if(parsed){PAPER.checkPaperLedger(parsed);return parsed;}
 }catch(e){}
 return PAPER.emptyPaperLedger();
}
function savePaperLedger(){
 try{localStorage.setItem('sport-predictor-paper-v1',JSON.stringify(paperLedger));}
 catch(e){paperNote='Uložení simulace selhalo; zkontroluj volné místo v telefonu.';}
}
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
function readLeagueState(league){
 const key=storeKey(league),fallback=MOD.newLearningState(LEAGUES[league].namespace);
 try{
  const saved=JSON.parse(localStorage.getItem(key)||'null');
  return saved?.version===1&&saved.competition===fallback.competition&&Array.isArray(saved.events)?saved:fallback;
 }catch{return fallback}
}
function readState(){return readLeagueState(current);}
function saveLeagueState(league,state){
 try{localStorage.setItem(storeKey(league),JSON.stringify(state));}
 catch(e){paperNote='Uložení průběžného učení se nezdařilo.';}
}
function saveState(state){saveLeagueState(current,state);}
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
 // Journal forecasts remain frozen; visible predictions are always recalculated.
 const snapshot=MOD.adaptivePrediction(LEAGUES[current].namespace,base,null,state,at);
 if(!existing){
  try{
   if(MOD.recordForecast(state,{id:match.id,competition:LEAGUES[current].namespace,
    predictedAt:at,kickoff:match.kickoff,pick:snapshot.pick,
    probabilities:snapshot.probabilities,experts:snapshot.experts}))saveState(state);
  }catch(e){}
 }
 return {...base,pick:snapshot.pick,probabilities:snapshot.probabilities,
  score:scoreForSelectedPick(base.xgHome,base.xgAway,snapshot.pick),
  confidence:snapshot.probabilities[snapshot.pick],learnedFrom:existing?'aktualizováno; archivní tip zachován':'průběžný model',
  explanation:'Aktuální analýza: Poisson, Elo a váhy upravované podle ověřených výsledků.'};
}



function pageDateInPrague(value){
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',
  month:'2-digit',day:'2-digit'}).format(new Date(value));
}
function renderPaper(){
 const summary=PAPER.paperSummary(paperLedger);
 $('paper-pending').textContent=String(summary.pending);
 $('paper-completed').textContent=String(summary.settled);
 $('paper-profit').textContent=(summary.net>0?'+':'')+summary.net.toFixed(0)+' Kč';
 $('paper-profit').className=summary.net<0?'paper-negative':summary.net>0?'paper-positive':'';
 const matched=paperMatched.length;
 const existing=paperLedger.tickets.some(t=>t.status==='pending');
 $('paper-status').textContent=paperNote||(matched>=2?
   'Ověřená aktuální nabídka obsahuje '+matched+' spárovaných zápasů. Lze uložit nový testovací tiket.':
   'Nyní není dostatek shodných živých kurzů a zápasů. Nový tiket zatím nelze založit.')+
   (existing?' · Zbylé simulace se ověřují při načtení skutečných výsledků.':'');
 const button=$('paper-create');
 button.disabled=matched<2;
 const tickets=paperLedger.tickets.slice(0,12);
 $('paper-history').innerHTML=tickets.length?tickets.map(ticket=>{
  const result=ticket.status==='won'?'Výherní':ticket.status==='lost'?'Prohraný':'Čeká na výsledky';
  const profit=ticket.net===null?'Nevyhodnoceno':(ticket.net>0?'+':'')+ticket.net.toFixed(0)+' Kč';
  const cls=ticket.status==='won'?'paper-win':ticket.status==='lost'?'paper-loss':'paper-pending';
  return '<article class="paper-ticket '+cls+'"><div class="paper-ticket-top">'+
   '<strong>'+escapeText(result)+'</strong><span>'+escapeText(new Date(ticket.createdAt)
     .toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}))+'</span></div>'+
   '<div class="paper-ticket-meta">Nanečisto '+ticket.stake.toFixed(0)+' Kč · kurz '+ticket.odds.toFixed(2)+
   ' · odhad šance '+pct(ticket.modelProbability)+
   (ticket.experimental?' · EXPERIMENT – bez doložené výhody':'')+'</div>'+
   ticket.legs.map(leg=>{
    const state=leg.status==='won'?'✓':leg.status==='lost'?'×':'…';
    const score=leg.result?' · '+leg.result.homeScore+':'+leg.result.awayScore:'';
    return '<div class="paper-ticket-leg"><span>'+escapeText(leg.home)+' – '+
      escapeText(leg.away)+'</span><strong>'+escapeText(leg.pick)+' @ '+Number(leg.odds).toFixed(2)+
      '</strong><small>'+state+escapeText(score)+'</small></div>';
   }).join('')+
   '<div class="paper-ticket-bottom"><span>Modelový výsledek</span><strong>'+
     escapeText(profit)+'</strong></div></article>';
 }).join(''):'<p class="paper-empty">Zatím žádný simulovaný tiket. Po načtení skutečných kurzů zkus první test.</p>';
}
function createPaperFromLive(){
 try{
  const now=Date.now();
  const proposed=PAPER.proposePaperTicket(paperMatched,{now,stake:ticketStake,profile:ticketProfile});
  if(!proposed)throw Error('Není dost ověřených samostatných zápasů s čerstvými kurzy.');
  const saved=PAPER.placePaperTicket(paperLedger,proposed,{
   createdAt:new Date(now).toISOString(),source:'Veřejná nabídka Tipsport / SazkyWeb.cz'});
  if(saved.saved){
   savePaperLedger();
   paperNote='Tiket nanečisto byl uložen. '+(proposed.experimental?
    'Jde o experiment bez potvrzené matematické výhody.':
    'Model navrhl variantu; výsledek není zaručen.');
  }else paperNote=saved.reason||'Tiket už v archivu existuje.';
 }catch(e){paperNote=e.message||'Simulace nyní není dostupná.';}
 renderPaper();
}
function absorbVerifiedOutcomes(results){
 if(!Array.isArray(results)||!results.length)return 0;
 const journalCheck=MODEL_JOURNAL.settleJournal(modelTicketJournal,results);
 if(journalCheck.newDrafts||journalCheck.newArena||journalCheck.newLegs)saveModelTicketJournal();
 renderModelTicketJournal();
 const asOf=new Date().toISOString();
 const checked=PAPER.settlePaperTickets(paperLedger,results,{asOf});
 if(checked.newlySettled.length||checked.newlyVerifiedLegs.length)savePaperLedger();
 const groups=new Map();
 for(const leg of checked.newlyVerifiedLegs){
  if(!groups.has(leg.league))groups.set(leg.league,[]);
  groups.get(leg.league).push(leg);
 }
 let learningUpdates=0;
 for(const [league,legs] of groups){
  const state=readLeagueState(league);
  for(const leg of legs){
   try{
    const done=MOD.settleResult(state,{
     id:leg.matchId,home_score:leg.homeScore,away_score:leg.awayScore,
     settledAt:asOf
    });
    if(done)learningUpdates++;
  }catch(e){}
  }
  saveLeagueState(league,state);
 }
 if(checked.newlySettled.length||checked.newlyVerifiedLegs.length)
  paperNote='Ověřeno '+checked.newlyVerifiedLegs.length+' výsledků, ukončeno '+
    checked.newlySettled.length+' tiketů. '+learningUpdates+
    ' nových výsledků zapracováno do průběžného modelu.';
 renderPaper();
 return checked.newlyVerifiedLegs.length;
}
function officialFootballResults(league,events){
 const valid=[];
 for(const e of events||[]){
  if(!(e?.status?.type?.completed===true || e?.status?.type?.name==='STATUS_FINAL'))continue;
  const pair=e.competitions?.[0]?.competitors||[];
  const home=pair.find(x=>x.homeAway==='home'),away=pair.find(x=>x.homeAway==='away');
  if(!home||!away)continue;
  // Do not allow Number(null) => 0 to fabricate a final score.
  const hs=home.score,as=away.score;
  if(hs===null||hs===undefined||as===null||as===undefined)continue;
  const h=Number(hs),a=Number(as);
  if(!Number.isInteger(h)||!Number.isInteger(a)||h<0||a<0||h>30||a>30)continue;
  const kickoff=e.date;
  if(!Number.isFinite(Date.parse(kickoff)))continue;
  valid.push({matchId:league+'_espn_'+String(e.id),league,
   home:canonical(home.team?.displayName),away:canonical(away.team?.displayName),
   kickoff,status:'finished',homeScore:h,awayScore:a,market:'1X2_90_MINUTES',
   source:league==='pl'?'Fantasy Premier League / ESPN':String(e.id||'').startsWith('FACR_')?'FAČR / Deník aktuální výsledky':'OpenFootball CC0 Czech archiv',
   observedAt:new Date().toISOString()});
 }
 return valid;
}
function requestHockeyPaperResults(){
 if(!globalThis.AndroidPredictor?.loadPaperHockeyResults)return;
 const days=new Set(),now=Date.now(),today=pageDateInPrague(now);
 for(const ticket of paperLedger.tickets){
  for(const leg of ticket.legs){
   if(leg.league!=='hockey'||leg.status!=='pending')continue;
   const game=Date.parse(leg.kickoff);
   if(!Number.isFinite(game)||now-game<2.5*3600_000||now-game>12*86400000)continue;
   const day=pageDateInPrague(game);
   if(day<today)days.add(day);
  }
 }
 if(days.size)globalThis.AndroidPredictor.loadPaperHockeyResults(JSON.stringify([...days].sort().slice(-8)));
}
globalThis.receivePaperHockeyResults=function(raw){
 try{
  const data=JSON.parse(raw);
  const grades=Array.isArray(data.results)?data.results:[];
  const n=absorbVerifiedOutcomes(grades);
  if(!n&&paperLedger.tickets.some(t=>t.status==='pending'))
   paperNote=(data.unavailableDates?.length?
    'Hokejový zdroj zatím nemá ověřené výsledky pro '+data.unavailableDates.join(', ')+'.':
    'Hokejové výsledky se ověří po skončení utkání.');
 }catch(e){paperNote='Vyhodnocení hokeje: '+(e.message||'zdroj nedostupný');}
 renderPaper();
};
function checkPaperResults(){
 paperNote='Kontroluji odehrané zápasy a aktuální výsledky…';
 renderPaper();
 if(globalThis.AndroidPredictor?.loadAllLeagues)globalThis.AndroidPredictor.loadAllLeagues();
 requestHockeyPaperResults();
}

function loadedOddsTable(){
 const rows=bookmakerOffers.filter(o=>Date.parse(o.kickoff)>Date.now()).slice(0,35);
 if(!rows.length)return '';
 const body=rows.map(o=>'<tr><td>'+escapeText(o.home)+' – '+escapeText(o.away)+
 '</td><td>'+new Date(o.kickoff).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})+
 '</td><td>'+['1','X','2'].map(k=>Number(o.odds[k]).toFixed(2)).join(' / ')+'</td></tr>').join('');
 return '<details class="match-diagnostics" open><summary>Všechny dostupné načtené nabídky ('+bookmakerOffers.length+')</summary>'+
 '<p>Kurzy slouží k informaci; bez nezávislého ověření programu a statistických dat se z nich automaticky nevytvoří tiket. '+
 (oddsProvider==='tipsport'?'Tento veřejný zdroj se aktualizuje jen ráno.':'Zdroj: nezávislé rozhraní PulseScore.')+
 '</p><div style="overflow-x:auto"><table><thead><tr><th>Zápas</th><th>Začátek</th><th>1 / X / 2</th></tr></thead><tbody>'+body+'</tbody></table></div></details>';
}

function renderModelTicketJournal(){
 const j=MODEL_JOURNAL.journalStats(modelTicketJournal);
 $('model-journal-summary').textContent=j.saved+' uložených modelových tiketů · '+j.pending+
 ' čeká · '+j.settled+' vyhodnoceno · '+j.withHit+' s alespoň jedním správným řádkem.'+
 (j.netKnown?' U '+j.netKnown+' tiketů jsou známé kurzy.':' Bez kurzů se finanční výsledek neurčuje.');
 $('model-journal-list').innerHTML=modelTicketJournal.drafts.slice(0,10).map(t=>{
  const label=t.status==='pending'?'Čeká na výsledky':t.status==='has-hit'?
   'Alespoň jeden správný řádek':'Žádný správný řádek';
  return '<div class="model-journal-row"><strong>'+escapeText(t.label)+' · '+escapeText(label)+'</strong>'+
   '<small>'+escapeText(new Date(t.createdAt).toLocaleString('cs-CZ'))+' · '+t.stake.toFixed(2)+' Kč modelově'+
   (t.net===null?' · bez finančního vyhodnocení':' · modelový čistý výsledek: '+t.net.toFixed(2)+' Kč')+
   '</small><div>'+t.legs.map(l=>escapeText(l.home+' – '+l.away)+' ('+escapeText(l.pick)+
    (l.score?', '+escapeText(l.score):'')+')'+(l.status==='won'?' ✓':l.status==='lost'?' ×':' …')).join(' · ')+'</div></div>';
 }).join('')||'<p class="source-notice">Uložené návrhy se objeví zde.</p>';
 const a=MODEL_JOURNAL.arenaStats(modelTicketJournal);
 $('arena-tips-summary').innerHTML='<p class="source-notice">'+a.imported+' importovaných tipů · '+a.pending+
 ' čeká na zápas · '+a.settled+' vyhodnoceno'+(a.accuracy===null?'': ' · úspěšnost '+pct(a.accuracy))+
 '. Úspěšnost není totéž jako zisk.</p>'+
 (a.authors.length?'<details><summary>Autoři a jejich dosavadní výsledky</summary><div>'+
  a.authors.map(row=>'<p>'+escapeText(row.author)+' · '+row.wins+'/'+row.settled+
   ' správně (malý vzorek nemusí nic dokazovat)</p>').join('')+'</div></details>':'')+
 '<p class="source-notice">'+(a.eligibleToLearn?
 'Vzorek je dostatečný pro další testování komunitního signálu, ale bez potvrzeného zlepšení kalibrace ho nepřidávám do predikcí.':
 'Pro případné učení z komunitních tipů je potřeba nejméně 30 nezávisle vyhodnocených tipů od více autorů.')+'</p>';
}
function generateNextModelTicket(){
 if(!modelTicketOptions.length){$('model-ticket-action-status').textContent='Nejsou načtené budoucí zápasy. Použij Aktualizovat zápasy.';return;}
 let index=modelTicketGenerateCount?modelTicketOptions.findIndex(t=>t.id===selectedModelTicketId):-1;
 index=(index+1)%modelTicketOptions.length;
 selectedModelTicketId=modelTicketOptions[index].id;
 modelTicketGenerateCount++;
 renderModelTickets();
 $('model-ticket-action-status').textContent='Vygenerovaný návrh: '+modelTicketOptions[index].label+
  ' · '+modelTicketOptions[index].legCount+' zápasů · '+modelTicketOptions[index].lineCount+
  ' řádků. Pomocí Uložit vybraný tiket ho zaznamenáš nanečisto.';
}
function saveGeneratedTicket(ticket){
 const chosen=ticket||modelTicketOptions.find(t=>t.id===selectedModelTicketId);
 if(!chosen){$('model-ticket-action-status').textContent='Nejdřív vygeneruj tiket ze zápasů.';return;}
 try{
  const outcome=MODEL_JOURNAL.storeTicketDraft(modelTicketJournal,chosen);
  if(!outcome.saved){$('model-ticket-action-status').textContent=outcome.reason;return;}
  if(saveModelTicketJournal())
   $('model-ticket-action-status').textContent='Tiket '+chosen.label+' uložen nanečisto. Výsledky se ověří po skončení zápasů.';
  renderModelTicketJournal();
  requestHockeyPaperResults();
 }catch(e){$('model-ticket-action-status').textContent='Návrh nelze uložit: '+String(e.message||e);}
}
function importArenaFromText(){
 try{
  const outcome=MODEL_JOURNAL.importArenaPicks(modelTicketJournal,$('arena-tips-input').value);
  if(outcome.added){saveModelTicketJournal();$('arena-tips-input').value='';}
  $('arena-import-status').textContent='Uloženo '+outcome.added+' tipů · duplicitní '+outcome.duplicates+
   ' · neplatné řádky '+(outcome.invalidLines.length?outcome.invalidLines.join(', '):'žádné')+
   '. Budou ověřeny z konečných výsledků, ne podle tvrzení autora.';
  renderModelTicketJournal();
  if(globalThis.AndroidPredictor?.loadAllLeagues)globalThis.AndroidPredictor.loadAllLeagues();
  requestHockeyPaperResults();
 }catch(e){$('arena-import-status').textContent='Import neproběhl: '+String(e.message||e);}
}
function renderModelTickets(){
 const el=$('model-ticket-results'),info=$('model-ticket-status');
 if(!el||!info)return;
 const entries=Object.values(candidatesByLeague).flat();
 if(!entries.length){info.textContent='Čekám na první načtené zápasy. Placené API není potřeba.';el.innerHTML='';return;}
 if(!MODEL_TICKETS?.buildModelTicketSuggestions){info.textContent='Chybí modul návrhu tiketů. Je nutná nová verze aplikace.';el.innerHTML='';return;}
 try{
  const freshApiPrice=oddsProvider!=='tipsport'&&oddsReceivedAt&&Date.now()-Date.parse(oddsReceivedAt)<5*60_000;
  const paired=freshApiPrice?bookmakerOffers.map(o=>AUTO.matchOffer(o,entries)).filter(Boolean):[];
  const prices=new Map(paired.map(x=>[x.fixture.id,x.offer]));
  const priced=entries.map(x=>({...x,odds:prices.get(x.id)?.odds,bookmaker:prices.get(x.id)?.bookmaker}));
  const data=MODEL_TICKETS.buildModelTicketSuggestions(priced,{stake:ticketStake,maxMatches:modelTicketMax});
  const options=(modelTicketType==='auto'?data.alternatives:data.alternatives.filter(t=>t.type===modelTicketType)).slice(0,6);
 modelTicketOptions=options;
 if(!options.some(t=>t.id===selectedModelTicketId))selectedModelTicketId=options[0]?.id||null;
  info.textContent='Model analyzoval '+data.fixturesEligible+' budoucích zápasů. '+data.basis+'.';
 const recommended=options.find(t=>t.id===selectedModelTicketId)||options[0]||null;
 const summary=recommended?'<div class="model-selection-note"><strong>'+
 (modelTicketType==='auto'?'Vybraný návrh: ':'Zvolený typ: ')+escapeText(recommended.label)+
 '</strong><p>'+(recommended.hasPrices?
 'Odhad pracuje s nejistými pravděpodobnostmi a kurzy, výdělek nezaručuje.':
 'Bez kurzů jde o výběr podle šance zásahu, nikoli podle výnosnosti.')+
 ' Výpočet kombinací předpokládá přibližnou nezávislost utkání.</p></div>':'';
  if(!options.length){el.innerHTML='<div class="no-edges">Pro zvolený typ tiketu zatím není dost nezávislých zápasů. Zkus SOLO nebo přepni počet utkání.</div>';return;}
  el.innerHTML=summary+options.map((t,index)=>{
   const legs=t.legs.map((x,i)=>'<div class="model-leg"><strong class="model-letter">'+String.fromCharCode(65+i)+'</strong><div><strong>'+escapeText(x.home)+' – '+escapeText(x.away)+'</strong><small>'+
     escapeText(LEAGUES[x.league]?.title||x.league)+' · '+new Date(x.kickoff).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})+
     '</small><small>1 '+pct(x.probabilities['1'])+' · X '+pct(x.probabilities.X)+' · 2 '+pct(x.probabilities['2'])+
     '</small><small>'+escapeText(x.xgHome!=null&&x.xgAway!=null?
      'Očekávané góly: '+x.xgHome.toFixed(2)+' : '+x.xgAway.toFixed(2):x.explanation)+
      '</small></div><span class="model-pick">'+escapeText(x.pick)+'<small>'+pct(x.probability)+'</small></span></div>').join('');
   const lines=t.rows.map(r=>'<tr><td>'+escapeText(r.description)+'</td><td>'+pct(r.probability)+'</td><td>'+
      (r.odds===null?'–':r.odds.toFixed(2)+'×')+'</td></tr>').join('');
   return '<article class="auto-ticket model-ticket'+(t.id===selectedModelTicketId?' model-ticket-primary':'')+'"><div class="ticket-head"><strong>'+
    (t.id===selectedModelTicketId?'VYBRANÝ · ':'')+escapeText(t.label)+'</strong><span>'+
    t.lineCount+' řádků</span></div>'+legs+'<div class="ticket-prob-row"><span>Šance alespoň jednoho správného řádku</span><strong>'+
    pct(t.chanceAtLeastOne)+'</strong></div><p class="model-split">Modelový vklad: '+t.lineCount+' × '+
    t.stakePerRow.toFixed(2)+' Kč = '+t.totalStake.toFixed(2)+' Kč</p><p class="ticket-caveat">'+
    (t.hasPrices?'Odhad šance na čistý zisk: '+pct(t.chanceOfProfit)+' · odhadovaný čistý výsledek: '+t.expectedNet.toFixed(1)+' Kč.':
      'Bez ověřených kurzů nelze znát čistý zisk ani výplatní kurz.')+
    ' Alespoň jeden správný řádek nezaručuje výdělek.</p>'+
    '<details class="match-diagnostics"><summary>Podrobný rozpis kombinací</summary><div style="overflow-x:auto"><table>'+
    '<thead><tr><th>Řádek</th><th>Šance</th><th>Kurz</th></tr></thead><tbody>'+lines+
    '</tbody></table></div></details>'+
     '<button type="button" class="model-pick-option" data-model-ticket-index="'+index+'">'+
     (t.id===selectedModelTicketId?'Vybráno':'Vybrat tento návrh')+'</button></article>';
  }).join('');
 }catch(e){info.textContent='Chyba výpočtu: '+String(e.message||e);el.innerHTML='';}
}

function renderOdds(){
 const total=bookmakerOffers.length;
 const fresh=Boolean(oddsReceivedAt && Date.now()-Date.parse(oddsReceivedAt)<14*3600000);
 const candidates=Object.values(candidatesByLeague).flat();
 const matched=fresh?bookmakerOffers.map(offer=>AUTO.matchOffer(offer,candidates)).filter(Boolean):[];
 paperMatched=matched;
 renderPaper();
 const ids=new Set(matched.map(x=>x.fixture.id));
 $('odds-total').textContent=String(total);
 $('odds-matched').textContent=String(ids.size);
 $('odds-updated').textContent=oddsReceivedAt?new Date(oddsReceivedAt).toLocaleTimeString('cs-CZ',
  {hour:'2-digit',minute:'2-digit'}):'–';
 $('odds-status').textContent=oddsError||(fresh?
  'Načtená nabídka '+(oddsProvider==='chance'?'Chance (PulseScore)':oddsProvider==='tipsport-api'?'Tipsport (PulseScore)':'Tipsport (ranní přehled)')+
   ' · propojuji jen shodná utkání se spolehlivým datem a výsledkovým zdrojem.' :
  total?'Kurzy jsou starší než 14 hodin. Stará nabídka se nepoužívá.':
  'Čekám na automatické načtení aktuálních kurzů.');
 $('odds-status').className='odds-status'+(oddsError||total&&!fresh?' error':'');
 if(!fresh){
  $('auto-results').innerHTML='<div class="no-edges">Aktuální kurzy nejsou dostupné. Nelze sestavit ověřený tiket ani test nanečisto.</div>';
  return;
 }
 const selection=AUTO.buildAutoTickets(matched,{
  stake:ticketStake,profile:ticketProfile,maxTickets:4,now:Date.now()
 });
 const introduction='<div class="ticket-summary">'+ids.size+' z '+total+
  ' kurzových nabídek odpovídá ověřeným utkáním · '+selection.considered+
  ' jednotlivých možností prošlo modelem.</div>';
 const diagnostics=matchingDiagnostics(bookmakerOffers,matched,candidates);
 const details='<details class="match-diagnostics"><summary>Proč nebyly použity ostatní kurzy?</summary>'+
  '<p>'+escapeText(diagnostics)+'</p></details>';
 let tickets=selection.selected.slice();
 let isExperimental=false;
 if(!tickets.length){
  // The stricter "value" threshold is intentionally kept intact; an exploratory
  // proposal is shown separately rather than silently re-labelled profitable.
  const proposal=PAPER.proposePaperTicket(matched,{
   stake:ticketStake,profile:ticketProfile,now:Date.now()
  });
  if(proposal){
   tickets=[proposal];
   isExperimental=true;
  }
 }
 if(!tickets.length){
  const needed=ticketProfile==='longshot'?3:2;
  const specific=ids.size<needed?
   'Režim '+(ticketProfile==='longshot'?'Vyšší kurz':'dvouzápasový tiket')+
   ' vyžaduje '+needed+' různá ověřená utkání. Nalezeno: '+ids.size+'. ':
   ticketProfile==='draws'?
   'Mezi ověřenými zápasy nelze sestavit kombinaci obsahující remízu s platnými kurzy. ':
   'Z dostupných utkání se nepodařilo sestavit ani bezpečně doložený experimentální test. ';
  $('auto-results').innerHTML=introduction+
   '<div class="no-edges"><strong>Vhodná kombinace zatím není dostupná.</strong><p>'+
   escapeText(specific)+
   'Nepoužívám smyšlené zápasy ani neplatné kurzy. Zkus jiný režim nebo obnov nabídku.</p></div>'+details+loadedOddsTable();
  return;
 }
 const heading=isExperimental?
  '<div class="experimental-banner"><strong>Testovací tiket nanečisto</strong>'+
  '<p>Žádná kombinace neprošla přísným testem výhodnosti. Níže je pouze experimentální návrh z reálných kurzů, abychom mohli měřit skutečnou úspěšnost. Není určený jako doporučení k sázení za peníze.</p></div>':
  '<div class="ticket-summary"><strong>Modelové návrhy</strong> · teoretická hodnota není potvrzení dlouhodobého zisku.</div>';
 const cards=tickets.map((ticket,index)=>{
  const probability=Number(ticket.p),certainty=Math.max(0,Math.min(100,probability*100));
  const lowerProbability=Math.max(0,Math.min(100,Number(ticket.lowerBound)*100));
  const modelEV=Number(ticket.conservativeEV);
  const chance=Number.isFinite(probability)?pct(probability):'neznámá';
  const experimental=isExperimental||ticket.experimental===true;
  return '<article class="auto-ticket'+(experimental?' auto-ticket-experimental':'')+'">'+
   '<div class="ticket-head"><span>'+(experimental?'POUZE SIMULACE':'Varianta '+(index+1))+
   ' · '+ticket.legs.length+' zápasy</span><span class="ticket-odds">'+
    Number(ticket.odds).toFixed(2)+'×</span></div>'+
   ticket.legs.map(l=>'<div class="leg-row"><div class="leg-names"><strong>'+
    escapeText(l.home)+' – '+escapeText(l.away)+'</strong><small>'+
    escapeText(LEAGUES[l.league]?.title||l.league)+' · '+
    new Date(l.kickoff).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})+
    '</small></div><span class="leg-pick">'+escapeText(l.pick)+'</span>'+
    '<span class="leg-odds">'+Number(l.odds).toFixed(2)+'</span></div>').join('')+
   '<div class="ticket-prob-row"><span>Odhad šance celé kombinace</span><strong>'+
    chance+'</strong></div><div class="prob-track"><div style="width:'+certainty.toFixed(1)+'%"></div></div>'+
   '<div class="ticket-financial"><div><small>Modelový vklad</small><strong>'+
    ticket.stake+' Kč</strong></div><div><small>Výplata, pokud vyjdou všechny tipy</small><strong>'+
    Number(ticket.payout).toFixed(0)+' Kč</strong></div></div>'+
   '<p class="ticket-caveat">Odhadovaná konzervativní šance nejméně '+
    pct(Number(ticket.lowerBound))+'; teoretické EV '+
    (modelEV>=0?'+':'')+pct(modelEV)+'. Výpočet pracuje s nejistými odhady, nikoliv se zárukou výdělku.</p>'+
   (experimental?'<p class="experimental-warning">Tento tiket neprošel filtrem matematické výhodnosti. Je vhodný pouze pro sledování výsledků nanečisto.</p>':'')+
   '<button class="ticket-paper-action" type="button" data-paper-action="save">Uložit tento tiket nanečisto</button>'+
   '</article>';
 }).join('');
 $('auto-results').innerHTML=introduction+heading+cards+details+loadedOddsTable();
 for(const action of $('auto-results').querySelectorAll('[data-paper-action="save"]')){
  action.addEventListener('click',createPaperFromLive);
 }
}
function matchingDiagnostics(offers,matched,candidates){
 const used=new Set(matched.map(x=>x.offer.id+'|'+x.offer.league+'|'+x.offer.kickoff));
 const scope=['pl','cz','hockey'];
 const lines=scope.map(league=>{
  const offered=offers.filter(x=>x.league===league);
  if(!offered.length)return null;
  const candidateCount=candidates.filter(x=>x.league===league).length;
  const paired=matched.filter(x=>x.offer.league===league).length;
  const label=LEAGUES[league]?.title||league;
  return label+': '+paired+'/'+offered.length+' spárováno ('+candidateCount+
   ' budoucích zápasů z výsledkového zdroje)';
 }).filter(Boolean);
 return lines.join(' · ')+'. Nespárované nabídky mohou mít jiný název klubu, nesouhlasící datum/čas, chybějící program nebo neověřená data. Takové zápasy bez potvrzení nesimuluji.';
}

function changeOddsProvider(value){
 if(!['tipsport','chance','tipsport-api'].includes(value))return;
 oddsProvider=value;
 try{localStorage.setItem('sport-odds-provider',value);}catch(e){}
 bookmakerOffers=[];oddsReceivedAt=null;oddsError='';
 $('odds-provider').value=value;
 $('chance-api-settings').open=value!=='tipsport';
 $('source-notice').textContent=value==='tipsport'?
  'Veřejný přehled Tipsportu: nové kurzy pouze ráno. Pro aktuálnější data zvol Tipsport API.':
  (value==='chance'?'Chance':'Tipsport')+': čtení průběžné nabídky přes nezávislý PulseScore. Je nutný datový API klíč; cena se může změnit a není garantovaná.';
 renderOdds();
 loadAutomaticOdds(true);
}
function loadAutomaticOdds(refresh=true){
 if(refresh){
  oddsError='';
  $('odds-status').textContent=oddsProvider==='chance'?
   'Načítám předzápasové kurzy Chance z API PulseScore…':
   oddsProvider==='tipsport-api'?'Načítám aktuální kurzy Tipsportu z API PulseScore…':
   'Procházím veřejný ranní přehled Tipsportu…';
 }
 if(globalThis.AndroidPredictor){
  if(oddsProvider==='chance'||oddsProvider==='tipsport-api'){
   const method=oddsProvider==='chance'?'loadChanceOdds':'loadTipsportApiOdds';
   if(typeof globalThis.AndroidPredictor[method]==='function')globalThis.AndroidPredictor[method]();
   else{
    oddsError='Aktuální Android verze neobsahuje zvolený zdroj API.';
    renderOdds();return;
   }
  }else{
   if(globalThis.AndroidPredictor.loadOdds)globalThis.AndroidPredictor.loadOdds();
   else{
    oddsError='Načítání veřejných kurzů není v této aplikaci dostupné.';
    renderOdds();return;
   }
  }
  if(refresh&&globalThis.AndroidPredictor.loadAllLeagues)
   globalThis.AndroidPredictor.loadAllLeagues();
 }else{
  oddsError='Načítání kurzů je dostupné pouze v instalované Android aplikaci.';
  renderOdds();
 }
}
globalThis.receiveOdds=function(raw,origin){
 // Asynchronous responses from a previous source cannot overwrite the chosen source.
 if(origin&&origin!==oddsProvider)return;
 try{
  const data=JSON.parse(raw);
  if(data.error)throw Error(data.error);
  const expected=oddsProvider==='chance'?'Chance':'Tipsport';
  if(data.bookmaker&&data.bookmaker!==expected)throw Error('Nesouhlasí zdroj kurzů '+data.bookmaker);
  if(!Array.isArray(data.offers)||!data.offers.length)
   throw Error('Zdroj '+expected+' dnes nevrátil ověřené předzápasové kurzy 1/X/2 pro sledované soutěže.');
  bookmakerOffers=data.offers.map(AUTO.normalizeOffer).filter(Boolean);
  if(!bookmakerOffers.length)throw Error('Žádná platná nabídka pro sledované soutěže.');
  oddsReceivedAt=data.fetchedAt||new Date().toISOString();
  oddsError='';
  try{
   localStorage.setItem(oddsCacheKey(),JSON.stringify({
    offers:bookmakerOffers,fetchedAt:oddsReceivedAt,
    source:data.source,bookmaker:expected
   }));
  }catch(e){}
 }catch(e){
  bookmakerOffers=[];oddsReceivedAt=null;
  oddsError=e.message||'Kurzy se nepodařilo načíst.';
  // Only restore a timestamped snapshot for the SAME bookmaker, never the other one.
  try{
   const prev=JSON.parse(localStorage.getItem(oddsCacheKey())||'null');
   const valid=prev?.fetchedAt&&Date.now()-Date.parse(prev.fetchedAt)<14*3600000;
   const expected=oddsProvider==='chance'?'Chance':'Tipsport';
   if(valid&&prev.bookmaker===expected){
    bookmakerOffers=(prev.offers||[]).map(AUTO.normalizeOffer).filter(Boolean);
    oddsReceivedAt=prev.fetchedAt;
    oddsError+=' · Uložený starší přehled, cenu před případnou sázkou ověř.';
   }
  }catch(x){}
 }
 renderModelTickets();renderOdds();
};
globalThis.receiveChanceKeyStatus=function(configured,message){
 $('chance-key-status').textContent=(configured?'Nastaveno: ':'Není nastaveno: ')+String(message||'');
 if(configured&&oddsProvider!=='tipsport'&&pendingChanceKeySave)loadAutomaticOdds(true);
 pendingChanceKeySave=false;
};
function saveChanceApiKey(){
 const field=$('chance-api-key'),value=field.value;
 field.value='';
 if(!globalThis.AndroidPredictor?.saveChanceApiKey){
  $('chance-key-status').textContent='Šifrované uložení je podporováno jen v Android aplikaci.';
  return;
 }
 if(!value||value.length<12){
  $('chance-key-status').textContent='Zadej klíč PulseScore, ne heslo ke Chance.';
  return;
 }
 pendingChanceKeySave=true;
 globalThis.AndroidPredictor.saveChanceApiKey(value);
 $('chance-key-status').textContent='Ukládám API klíč šifrovaně do telefonu…';
}

function setTicketProfile(name){
 if(!['balanced','longshot','draws'].includes(name))return;
 ticketProfile=name;
 for(const k of ['balanced','longshot','draws'])$('profile-'+k).setAttribute('aria-pressed',String(k===name));
 renderOdds();
}
function setTicketStake(value){
 ticketStake=value;
 if($('model-ticket-stake'))$('model-ticket-stake').value=String(value);
 for(const k of [10,20,50])$('stake-'+k).setAttribute('aria-pressed',String(k===value));
 renderModelTickets();renderOdds();
}

function renderSchedule(events,receivedAt,cache=false){
 const parsed=events.map(eventFromEspn).filter(Boolean);
 if(!parsed.length)throw Error('Zdroj nevrátil ověřitelná utkání');
 absorbVerifiedOutcomes(officialFootballResults(current,events));
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
    pick:forecast.pick,probabilities:forecast.probabilities,
     xgHome:forecast.xgHome,xgAway:forecast.xgAway,explanation:forecast.explanation});
   return scoreCard(m.home_team_name,m.away_team_name,forecast,
    new Date(m.kickoff).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}));
  }catch(e){return '<div class="match error">Předpověď není dostupná pro '+escapeText(m.home_team_name)+' – '+escapeText(m.away_team_name)+'</div>'}
 }).join('')||'<div class="match">Žádné další zápasy ve vráceném programu.</div>';
 candidatesByLeague[current]=ticketCandidates.slice();
 renderModelTickets();renderOdds();
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
    pick:forecast.pick,probabilities:forecast.probabilities,
     xgHome:forecast.xgHome,xgAway:forecast.xgAway,explanation:forecast.explanation});
   return scoreCard(home,away,forecast,new Date(e.date).toLocaleString('cs-CZ',
    {day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}));
  }catch(err){return '<article class="match error">Nelze spočítat zápas '+escapeText(home)+' – '+escapeText(away)+'</article>';}
 }).join('')||'<article class="match">Pro dnešní den nejsou k dispozici další ověřené zápasy extraligy. Ruční simulace z ligové tabulky funguje.</article>';
 candidatesByLeague.hockey=ticketCandidates.slice();
 renderModelTickets();renderOdds();
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
     modelVerified:false,probabilities:tip.probabilities,pick:tip.pick,
     xgHome:tip.xgHome,xgAway:tip.xgAway,explanation:tip.explanation});
   }
  }else{
   const rows=(payload.events||[]).map(eventFromEspn).filter(Boolean);
   if(!rows.length)throw Error('Žádné ověřené zápasy');
   absorbVerifiedOutcomes(officialFootballResults(league,payload.events||[]));
   const {state}=updateHistory(rows);
   const future=rows.filter(x=>x.status!=='finished'&&Date.parse(x.kickoff)>now)
     .sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff)).slice(0,80);
   for(const m of future){
    try{
     const tip=futureForecast(m,rows,state);
     chosen.push({id:m.id,home:m.home_team_name,away:m.away_team_name,league,
      kickoff:m.kickoff,status:'scheduled',modelVerified:false,
      probabilities:tip.probabilities,pick:tip.pick,
     xgHome:tip.xgHome,xgAway:tip.xgAway,explanation:tip.explanation});
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
 renderModelTickets();renderOdds();
 if(current==='pl')renderCoverage();
 requestHockeyPaperResults();
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
$('paper-create').addEventListener('click',createPaperFromLive);
$('paper-check').addEventListener('click',checkPaperResults);
$('scan-odds').addEventListener('click',()=>loadAutomaticOdds(true));
$('model-ticket-refresh').addEventListener('click',()=>{
 $('model-ticket-action-status').textContent='Aktualizuji program zápasů a výpočty pravděpodobností…';
 if(globalThis.AndroidPredictor?.loadAllLeagues)globalThis.AndroidPredictor.loadAllLeagues();
 else renderModelTickets();
});
$('model-ticket-generate').addEventListener('click',generateNextModelTicket);
$('model-ticket-save').addEventListener('click',()=>saveGeneratedTicket());
$('arena-tips-import').addEventListener('click',importArenaFromText);
$('model-ticket-results').addEventListener('click',e=>{
 const option=e.target?.closest?.('[data-model-ticket-index]');
 if(!option)return;
 const ticket=modelTicketOptions[Number(option.dataset.modelTicketIndex)];
 if(!ticket)return;
 selectedModelTicketId=ticket.id;modelTicketGenerateCount++;
 renderModelTickets();
 $('model-ticket-action-status').textContent='Vybrán tiket '+ticket.label+
  '. Můžeš ho uložit nanečisto nebo vytvořit další návrh.';
});
$('model-ticket-type').addEventListener('change',()=>{modelTicketType=$('model-ticket-type').value;selectedModelTicketId=null;modelTicketGenerateCount=0;renderModelTickets();});
$('model-ticket-count').addEventListener('change',()=>{modelTicketMax=Number($('model-ticket-count').value)||3;selectedModelTicketId=null;modelTicketGenerateCount=0;renderModelTickets();});
$('model-ticket-stake').addEventListener('change',()=>setTicketStake(Number($('model-ticket-stake').value)||20));
$('odds-provider').value=oddsProvider;
$('odds-provider').addEventListener('change',()=>changeOddsProvider($('odds-provider').value));
$('save-chance-key').addEventListener('click',saveChanceApiKey);
$('clear-chance-key').addEventListener('click',()=>{
 if(globalThis.AndroidPredictor?.clearChanceApiKey)globalThis.AndroidPredictor.clearChanceApiKey();
 else $('chance-key-status').textContent='Klíč není uložen.';
});
if(oddsProvider!=='tipsport')$('chance-api-settings').open=true;
$('source-notice').textContent=oddsProvider==='tipsport'?
 'Tipsport: veřejný ranní přehled SazkyWeb.cz; nejde o živé ani garantované kurzy.':
 (oddsProvider==='chance'?'Chance':'Tipsport')+': předzápasové kurzy přes nezávislé PulseScore API, nikoliv účet sázkové kanceláře. Nutný API klíč, údaje se mohou změnit.';
if(globalThis.AndroidPredictor?.chanceKeyStatus)
 globalThis.AndroidPredictor.chanceKeyStatus();
try{
 const restored=JSON.parse(localStorage.getItem('live-pl-context-v1')||'null');
 if(restored)acceptLiveContext({context:restored});
}catch(e){}
changeLeague('pl');
renderModelTicketJournal();
renderPaper();
loadAutomaticOdds(true);
requestHockeyPaperResults();

// Persistent foreground refresh. The WebView is kept alive while the app is
// visible; reopening the screen triggers a fresh network request immediately.
const AUTO_SCAN_EVERY_MS=60_000;
let autoForeground=true,autoScanAt=Date.now(),autoScanPending=false;
function updateAutoStatus(){
 const el=$('auto-refresh-status');if(!el)return;
 const isPublic=oddsProvider==='tipsport';
 el.textContent=!autoForeground?'Obnovování pozastaveno (aplikace na pozadí)':
  (autoScanPending?'Kontroluji aktuální zápasy a kurzy…':
  'Automatická kontrola každých 60 sekund při otevřené aplikaci.')+
  (isPublic?' Veřejný zdroj vydává kurzy pouze ráno; tento interval NEZNAMENÁ nové ceny.':
  ' API může omezit četnost podle tarifu.');
}
function autoScan(force=false){
 if(!autoForeground||(typeof document.visibilityState==='string'&&document.visibilityState==='hidden'))return;
 const now=Date.now();
 if(autoScanPending&&now-autoScanAt<180_000)return;
 if(!force&&now-autoScanAt<AUTO_SCAN_EVERY_MS)return;
 autoScanPending=true;autoScanAt=now;
 loadAutomaticOdds(true);
 updateAutoStatus();
}
const originalOddsReceiver=globalThis.receiveOdds;
globalThis.receiveOdds=function(raw,provider){
 if(!provider||provider===oddsProvider)autoScanPending=false;
 originalOddsReceiver(raw,provider);
 updateAutoStatus();
};
globalThis.sportPredictorOnPause=()=>{autoForeground=false;updateAutoStatus();};
globalThis.sportPredictorOnResume=()=>{
 autoForeground=true;
 autoScan(true);
 updateAutoStatus();
};
if(typeof document.addEventListener==='function')
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')globalThis.sportPredictorOnPause();
  else globalThis.sportPredictorOnResume();
 });
if(typeof setInterval==='function')setInterval(()=>{autoScan();updateAutoStatus();},15_000);
updateAutoStatus();
})();
