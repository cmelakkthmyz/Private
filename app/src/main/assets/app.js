(function(){
'use strict';
const $=id=>document.getElementById(id);
const escapeText=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const pct=x=>(100*x).toFixed(1)+' %';
const MOD=globalThis.PredictorV2,OLD=globalThis.PLModel;
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
 const cfg={
  prior:6,power:.87,eloWeight:.25,marketWeight:0,priorityWeight:.40,
  useFpl:manual,homeBase:league.homeBase,awayBase:league.awayBase,decayDays:135
 };
 const teams=manual?[
  {id:match.home_team_id,attack:Number($('home-strength').value),defense:Number($('home-strength').value)},
  {id:match.away_team_id,attack:Number($('away-strength').value),defense:Number($('away-strength').value)}
 ]:[];
 return MOD.predictIntelligence(match,history,{config:cfg,teams,schedule:history});
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
 const base=modelForFixture(match,all);
 const at=new Date().toISOString();
 const forecast=MOD.adaptivePrediction(LEAGUES[current].namespace,base,null,state,at);
 // Persist *first* genuine pre-kickoff forecast. Never forge an old tip.
 try{
  if(MOD.recordForecast(state,{id:match.id,competition:LEAGUES[current].namespace,
   predictedAt:at,kickoff:match.kickoff,pick:forecast.pick,
   probabilities:forecast.probabilities,experts:forecast.experts}))saveState(state);
 }catch(e){}
 return {...base,pick:forecast.pick,probabilities:forecast.probabilities,
  confidence:forecast.confidence,learnedFrom:forecast.learnedFrom,
  explanation:'Kombinace Poisson, Elo a korekce z minulých vlastních chyb. Bez ověřených sestav či kurzů žádná smyšlená data.'};
}
function renderSchedule(events,receivedAt,cache=false){
 const parsed=events.map(eventFromEspn).filter(Boolean);
 if(!parsed.length)throw Error('Zdroj nevrátil ověřitelná utkání');
 sessionMatches=parsed;refillSelects();
 const {state,changes}=updateHistory(parsed);
 const now=Date.now();
 const incoming=parsed.filter(m=>m.status!=='finished'&&Date.parse(m.kickoff)>now)
  .sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff)).slice(0,30);
 $('matches').innerHTML=incoming.map(m=>{
  try{
   const forecast=futureForecast(m,parsed,state);
   return scoreCard(m.home_team_name,m.away_team_name,forecast,
    new Date(m.kickoff).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}));
  }catch(e){return '<div class="match error">Předpověď není dostupná pro '+escapeText(m.home_team_name)+' – '+escapeText(m.away_team_name)+'</div>'}
 }).join('')||'<div class="match">Žádné další zápasy ve vráceném programu.</div>';
 status((cache?'Uložený rozpis':'ESPN rozpis')+' · '+incoming.length+' dalších zápasů · '+(changes?changes+' tipů vyhodnoceno · ':'')+
 'Aktualizace '+new Date(receivedAt).toLocaleString('cs-CZ'));
 renderCoverage(state);
}
function renderCoverage(state=readState()){
 const league=LEAGUES[current];
 const info=MOD.learningSummary(state,new Date().toISOString());
 const recorded=info.settled?info.settled+' vyhodnocených vlastních tipů; úspěšnost '+pct(info.accuracy):'Zatím žádné vyhodnocené vlastní tipy';
 const coverage=current==='cz'?
  'Doložené historické sezóny: '+(ARCHIVE.verifiedSeasons||[]).join(', ')+
  ' · '+(ARCHIVE.coverage?.loadedTrainingSeasons||0)+' z 20 požadovaných starších sezón. Chybějící data nejsou doplňována odhady.':
  current==='hockey'?'Pro český hokej zatím není připojen ověřený archiv zápasů v základní hrací době. Ruční simulace je jen orientační.':
  'Premier League: model používá aktuálně známé výsledky a průběžně uložené vlastní tipy.';
 $('coverage').textContent=league.title+' · '+coverage+' · '+recorded;
}
function fallback(message){
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
globalThis.receiveMatches=function(raw){
 try{
  const d=JSON.parse(raw);
  if(d.error)throw Error(d.error);
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
 if(current==='hockey'){
  status('Česká extraliga: není připojen věrohodný živý zdroj výsledků. Použij ruční zápas.',true);
  $('matches').innerHTML='';return;
 }
 status('Načítám skutečná utkání '+LEAGUES[current].title+'…');
 if(globalThis.AndroidPredictor?.loadFixtures)globalThis.AndroidPredictor.loadFixtures(current);
 else fallback('Nativní Android připojení není dostupné.');
}
function changeLeague(id){
 current=id;lastPayload=null;lastUpdated=null;sessionMatches=[];
 for(const k of Object.keys(LEAGUES))$('league-'+k).setAttribute('aria-pressed',String(k===id));
 $('match-title').textContent='Zápasy – '+LEAGUES[id].title;
 $('manual-hint').textContent=id==='hockey'?'Hokej: třícestný tip je výsledek po 60 minutách, nikoliv po prodloužení. Bez historických dat je predikce pouze orientační.':
  'Vyber týmy a uprav sílu; výsledky jsou pravděpodobnostní odhady, ne zaručené tipy.';
 $('matches').innerHTML='';$('manual-result').innerHTML='';
 refillSelects();renderCoverage();requestSchedule();
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
   ...base,pick:adaptive.pick,probabilities:adaptive.probabilities,learnedFrom:adaptive.learnedFrom,
   explanation:'Ruční simulace. Síla týmů a dříve dokončené výsledky, pokud jsou dostupné.'
  },'Orientační ruční simulace · bez zaznamenání neuskutečněného zápasu');
 }catch(e){$('manual-result').textContent='Výpočet se nezdařil: '+e.message;}
});
$('refresh').addEventListener('click',requestSchedule);
changeLeague('pl');
})();
