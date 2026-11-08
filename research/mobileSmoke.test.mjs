// A cheap UI integration smoke test: actual browser assets, minimal DOM, no Android emulator.
// Calls the same receiveMatches bridge used on a phone, including late league switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC='app/src/main/assets/';
const makeDom=()=>{
 const ids=[
  'league-pl','league-cz','league-hockey','coverage','match-title','status','matches',
  'manual-hint','home','away','home-strength','away-strength','home-power','away-power',
  'manual-result','calc','refresh','data-attribution',
  'odds-status','auto-refresh-status','odds-total','odds-matched','odds-updated',
  'profile-balanced','profile-longshot','profile-draws',
  'stake-10','stake-20','stake-50','scan-odds','auto-results','source-notice',
  'paper-pending','paper-completed','paper-profit','paper-status',
  'paper-create','paper-check','paper-history',
  'odds-provider','chance-api-settings','chance-api-key','save-chance-key',
  'clear-chance-key','chance-key-status'
 ];
 const controls={};
 for(const id of ids)controls[id]={
  id,value:id.includes('strength')?'70':'',innerHTML:'',textContent:'',className:'',
  selectedIndex:0,attributes:{},listeners:{},
  addEventListener(type,handler){this.listeners[type]=handler;},
  querySelectorAll(){return [];},
  setAttribute(k,v){this.attributes[k]=v;}
 };
 const saved=new Map(),calls=[],now=Date.now(),upcoming=new Date(now+3*86400000).toISOString();
 const ctx={
  console,URL,Intl,Date,Math,JSON,Array,Object,Number,String,Error,Boolean,Map,Set,Float64Array,
  document:{getElementById(id){if(!controls[id])throw Error('Unknown DOM id '+id);return controls[id]}},
  localStorage:{setItem(k,v){saved.set(k,v);},getItem(k){return saved.get(k)||null;}},
  AndroidPredictor:{loadFixtures(league){calls.push(league);},loadOdds(){calls.push('odds');},loadAllLeagues(){calls.push('all');},loadPaperHockeyResults(dates){calls.push('hockey-result:'+dates);},
   loadChanceOdds(){calls.push('chance');},
   loadTipsportApiOdds(){calls.push('tipsport-api');},
   chanceKeyStatus(){calls.push('chance-key-status');},
   saveChanceApiKey(key){calls.push('save-key');},
   clearChanceApiKey(){calls.push('clear-key');}},
 };
 ctx.globalThis=ctx;ctx.window=ctx;
 const scope=vm.createContext(ctx);
 for(const name of ['model.js','intelligence.js','czArchive.js','app.js'])
  vm.runInContext(fs.readFileSync(SRC+name,'utf8'),scope,{filename:name});
 return {controls,calls,saved,ctx,upcoming};
};
const event=(home,away,date,finished=false)=>({
 id:'s1',date,status:{type:{completed:finished,name:finished?'STATUS_FINAL':'STATUS_SCHEDULED'}},
 competitions:[{competitors:[
  {homeAway:'home',score:finished?'2':null,team:{displayName:home}},
  {homeAway:'away',score:finished?'0':null,team:{displayName:away}}
 ]}]
});
function rows(){
 const clubs=['Třinec','Pardubice','Kladno','Karlovy Vary','České Budějovice','Sparta Praha',
  'Plzeň','Liberec','Hradec Králové','Kometa Brno','Litvínov','Mladá Boleslav','Vítkovice','Olomouc'];
 return clubs.map((tym,i)=>({tym,zapasy:17,skore:(65-i*2)+':'+(33+i*2),
  vyhry_prodl:i%3+1,prohry_prodl:i%2}));
}
test('home page starts with Premier League and requests its actual fixtures',()=>{
 const t=makeDom();
 assert.ok(t.calls.includes('pl'),'Startup must request real Premier League fixtures');
 assert.ok(t.controls['coverage'].textContent.includes('Premier League'));
 const second=event('Chelsea','Fulham',new Date(Date.parse(t.upcoming)+86400000).toISOString());
 second.id='s2';
 t.ctx.receiveMatches(JSON.stringify({events:[event('Arsenal','Liverpool',t.upcoming),second]}),'pl');
 assert.ok(t.controls.matches.innerHTML.includes('Arsenal'));
 assert.ok(t.controls.matches.innerHTML.includes('Liverpool'));
 assert.ok(t.controls.matches.innerHTML.includes('Tip 1 / X / 2'));
 assert.ok(t.controls['auto-results'].innerHTML.includes('nejsou dostupné'));
 assert.equal(t.calls.includes('odds'),true);

 const state=JSON.parse(t.saved.get('premier-intelligence-online-v1:pl-football'));
 assert.equal(state.events.length,2);
 assert.equal(state.accuracy.settled,0);
});
test('switch to Czech hockey loads public table and previews 60-minute outcome',()=>{
 const t=makeDom();
 t.controls['league-hockey'].listeners.click();
 assert.equal(t.calls.at(-1),'hockey');
 const h={sport:'hockey',updated:new Date().toISOString(),scheduleCurrent:true,
  events:[{id:'2026-1',date:t.upcoming,home:'Třinec',away:'Olomouc'}],
  standings:rows()};
 t.ctx.receiveMatches(JSON.stringify(h),'hockey');
 assert.ok(t.controls.matches.innerHTML.includes('Třinec'),t.controls.matches.innerHTML);
 assert.ok(t.controls.matches.innerHTML.includes('Olomouc'));
 assert.ok(t.controls.matches.innerHTML.includes('Tip 1 / X / 2'));
 assert.ok(t.controls.coverage.textContent.includes('SazkyWeb.cz'));
 const hockeyState=JSON.parse(t.saved.get('premier-intelligence-online-v1:cz-hockey'));
 assert.equal(hockeyState.events.length,1);
 assert.equal(hockeyState.accuracy.settled,0);
});
test('a delayed Premier League response cannot overwrite Czech hockey screen',()=>{
 const t=makeDom();
 t.controls['league-cz'].listeners.click();
 t.ctx.receiveMatches(JSON.stringify({events:[event('Arsenal','Liverpool',t.upcoming)]}),'pl');
 assert.ok(!t.controls.matches.innerHTML.includes('Arsenal'));
 assert.equal(t.controls['league-cz'].attributes['aria-pressed'],'true');
});
test('stale hockey schedule never invents upcoming fixtures',()=>{
 const t=makeDom();
 t.controls['league-hockey'].listeners.click();
 t.ctx.receiveMatches(JSON.stringify({sport:'hockey',updated:'2026-01-01T05:00:00Z',
  scheduleCurrent:false,events:[{id:'fake',date:t.upcoming,home:'Třinec',away:'Olomouc'}],
  standings:rows()}),'hockey');
 assert.ok(t.controls.matches.innerHTML.includes('nejsou k dispozici'));
 assert.ok(!t.saved.get('premier-intelligence-online-v1:cz-hockey'));
});
test('existing recorded forecast is immutable when data refreshes',()=>{
 const t=makeDom();
 const payload=JSON.stringify({events:[event('Arsenal','Liverpool',t.upcoming)]});
 t.ctx.receiveMatches(payload,'pl');
 const before=JSON.parse(t.saved.get('premier-intelligence-online-v1:pl-football'));
 t.ctx.receiveMatches(payload,'pl');
 const after=JSON.parse(t.saved.get('premier-intelligence-online-v1:pl-football'));
 assert.equal(before.events.length,1);
 assert.equal(after.events.length,1);
 assert.equal(after.events[0].pick,before.events[0].pick);
 assert.equal(after.events[0].predictedAt,before.events[0].predictedAt);
});

test('automatic odds bridge scans and pairs current bookmaker prices with both fixtures',()=>{
 const t=makeDom();
 const second=event('Chelsea','Fulham',new Date(Date.parse(t.upcoming)+3600000).toISOString());
 second.id='s2';
 t.ctx.receiveMatches(JSON.stringify({events:[event('Arsenal','Liverpool',t.upcoming),second]}),'pl');
 const offers=[
  {id:'test-1',league:'pl',home:'Arsenal',away:'Liverpool',kickoff:t.upcoming,
   odds:{'1':5,X:4,'2':2},bookmaker:'Tipsport'},
  {id:'test-2',league:'pl',home:'Chelsea',away:'Fulham',kickoff:new Date(Date.parse(t.upcoming)+3600000).toISOString(),
   odds:{'1':5,X:4,'2':2},bookmaker:'Tipsport'}
 ];
 t.ctx.receiveOdds(JSON.stringify({offers,fetchedAt:new Date().toISOString()}));
 assert.equal(t.controls['odds-total'].textContent,'2');
 assert.equal(t.controls['odds-matched'].textContent,'2');
 assert.ok(t.controls['auto-results'].innerHTML.includes('odpovídá ověřeným utkáním'));
 assert.ok(!t.controls['auto-results'].innerHTML.includes('ticket-odds-'));
});
test('all risk profile and stake controls produce a visible state change',()=>{
 const t=makeDom();
 for(const id of ['balanced','longshot','draws']){
  t.controls['profile-'+id].listeners.click();
  assert.equal(t.controls['profile-'+id].attributes['aria-pressed'],'true');
 }
 for(const stake of [10,50,20]){
  t.controls['stake-'+stake].listeners.click();
  assert.equal(t.controls['stake-'+stake].attributes['aria-pressed'],'true');
 }
 const before=t.calls.filter(x=>x==='odds').length;
 t.controls['scan-odds'].listeners.click();
 assert.equal(t.calls.filter(x=>x==='odds').length,before+1);
});
test('no ticket is produced from stale bookmaker snapshot',()=>{
 const t=makeDom();
 t.ctx.receiveOdds(JSON.stringify({offers:[{
  id:'a',league:'pl',home:'Arsenal',away:'Liverpool',kickoff:t.upcoming,odds:{'1':2,X:3,'2':4}
 }],fetchedAt:new Date(Date.now()-20*3600000).toISOString()}));
 assert.ok(t.controls['auto-results'].innerHTML.includes('nejsou dostupné'));
});

test('FPL live squad statuses and 21-year CC0 archive are visible only with valid as-of snapshot',()=>{
 const t=makeDom();
 const teams=Array.from({length:20},(_,i)=>({id:'Club'+i,name:'Club'+i,attack:70+i*.2,defense:70-i*.2}));
 const players=Array.from({length:220},(_,i)=>({name:'Player '+i,team_id:'Club'+i%20,
  minutes:400,xg:.9,xa:.2,availability:i===0?'i':'a',chance_of_playing_next_round:i===0?0:100}));
 const context={teams,players,fetchedAt:new Date().toISOString(),source:'Fantasy Premier League public API'};
 t.ctx.receiveMatches(JSON.stringify({context,events:[event('Arsenal','Chelsea',t.upcoming)]}),'pl');
 assert.ok(t.controls.coverage.textContent.includes('FPL'));
 assert.ok(t.controls.coverage.textContent.includes('OpenFootball'));
 assert.ok(t.calls.includes('all'));
});
test('all three sport candidate snapshots are considered even when Premier League tab is selected',()=>{
 const t=makeDom();
 const d=new Date(Date.now()+6*3600000).toISOString();
 const other=(id,h,a,time)=>({...event(h,a,time),id});
 const leagues={
  pl:{events:[event('Arsenal','Liverpool',d),other('22','Chelsea','Fulham',new Date(Date.parse(d)+3600000).toISOString())]},
  cz:{events:[event('Sparta Praha','Slavia Praha',d),other('23','Viktoria Plzeň','Baník Ostrava',new Date(Date.parse(d)+3600000).toISOString())]},
  hockey:{sport:'hockey',updated:new Date().toISOString(),scheduleCurrent:true,standings:rows(),events:[
    {id:'h1',home:'Třinec',away:'Olomouc',date:d},
    {id:'h2',home:'Pardubice',away:'Kometa Brno',date:new Date(Date.parse(d)+3600000).toISOString()}
  ]}
 };
 t.ctx.receiveAllLeagues(JSON.stringify(leagues));
 const offers=[
  {id:'o1',league:'pl',home:'Arsenal',away:'Liverpool',kickoff:d,odds:{'1':3,X:3.2,'2':3.5}},
  {id:'o2',league:'cz',home:'Sparta Praha',away:'Slavia Praha',kickoff:d,odds:{'1':3,X:3.2,'2':3.5}},
  {id:'o3',league:'hockey',home:'Třinec',away:'Olomouc',kickoff:d,odds:{'1':3,X:3.2,'2':3.5}}
 ];
 t.ctx.receiveOdds(JSON.stringify({offers,fetchedAt:new Date().toISOString()}));
 assert.equal(t.controls['odds-total'].textContent,'3');
 assert.equal(t.controls['odds-matched'].textContent,'3');
 assert.equal(t.controls['league-pl'].attributes['aria-pressed'],'true');
});
test('offline/stale FPL snapshot is never used to claim current injuries',()=>{
 const t=makeDom();
 const old=new Date(Date.now()-5*86400000).toISOString();
 const bad={teams:Array.from({length:20},(_,i)=>({id:'Arsenal'+i,attack:90,defense:80})),
  players:Array.from({length:210},(_,i)=>({team_id:'Arsenal',name:'i'+i,availability:'i'})),
  fetchedAt:old,source:'FPL'};
 t.ctx.receiveMatches(JSON.stringify({context:bad,events:[event('Arsenal','Liverpool',t.upcoming)]}),'pl');
 assert.ok(t.controls.coverage.textContent.includes('nejsou ověřené'));
});

test('paper lab is on screen and refuses to pretend to bet when market not loaded',()=>{
 const t=makeDom();
 assert.equal(t.controls['paper-pending'].textContent,'0');
 assert.equal(t.controls['paper-completed'].textContent,'0');
 assert.equal(t.controls['paper-create'].disabled,true);
 t.controls['paper-create'].listeners.click();
 assert.ok(t.controls['paper-status'].textContent.includes('ověřených'));
 assert.equal(t.saved.get('sport-predictor-paper-v1'),undefined);
});
test('paper ticket is created from genuine matched quoted offers, stored in local phone journal',()=>{
 const t=makeDom();
 const second=event('Chelsea','Fulham',new Date(Date.parse(t.upcoming)+3600000).toISOString());
 second.id='s2';
 t.ctx.receiveMatches(JSON.stringify({events:[event('Arsenal','Liverpool',t.upcoming),second]}),'pl');
 const offers=[
  {id:'test-1',league:'pl',home:'Arsenal',away:'Liverpool',kickoff:t.upcoming,
   odds:{'1':2.4,X:3.4,'2':3.7},bookmaker:'Tipsport',fetchedAt:new Date().toISOString(),
   sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'},
  {id:'test-2',league:'pl',home:'Chelsea',away:'Fulham',
   kickoff:new Date(Date.parse(t.upcoming)+3600000).toISOString(),
   odds:{'1':2.4,X:3.4,'2':3.7},bookmaker:'Tipsport',fetchedAt:new Date().toISOString(),
   sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'}
 ];
 t.ctx.receiveOdds(JSON.stringify({offers,fetchedAt:new Date().toISOString()}));
 assert.equal(t.controls['paper-create'].disabled,false);
 t.controls['paper-create'].listeners.click();
 const raw=t.saved.get('sport-predictor-paper-v1');
 assert.ok(raw);
 const stored=JSON.parse(raw);
 assert.equal(stored.tickets.length,1);
 assert.equal(stored.tickets[0].status,'pending');
 assert.equal(stored.tickets[0].legs.length,2);
 assert.equal(t.controls['paper-pending'].textContent,'1');
 assert.ok(t.controls['paper-history'].innerHTML.includes('Tipsport')===false ||
           t.controls['paper-history'].innerHTML.includes('nanečisto')===false ||
           t.controls['paper-history'].innerHTML.includes('Nanečisto'));
 // The same button must not double-count the same frozen market.
 t.controls['paper-create'].listeners.click();
 assert.equal(JSON.parse(t.saved.get('sport-predictor-paper-v1')).tickets.length,1);
});
test('paper result verification button invokes native all-league and hockey settlement checks',()=>{
 const t=makeDom();
 const before=t.calls.filter(x=>x==='all').length;
 t.controls['paper-check'].listeners.click();
 assert.ok(t.calls.filter(x=>x==='all').length>before);
 assert.ok(t.controls['paper-status'].textContent.includes('Kontroluji'));
});


test('screenshot regression: 15 bookmaker rows, 2 verified fixtures, remizy mode shows an experimental paper ticket',()=>{
 const t=makeDom();
 const later=new Date(Date.parse(t.upcoming)+3600000).toISOString();
 t.controls['profile-draws'].listeners.click();
 const second={...event('Chelsea','Fulham',later),id:'s2'};
 t.ctx.receiveMatches(JSON.stringify({events:[event('Arsenal','Liverpool',t.upcoming),second]}),'pl');
 const valid=[
  {id:'real1',league:'pl',home:'Arsenal',away:'Liverpool',kickoff:t.upcoming,
   odds:{'1':2.45,X:3.65,'2':3.9},bookmaker:'Tipsport',
   fetchedAt:new Date().toISOString(),sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'},
  {id:'real2',league:'pl',home:'Chelsea',away:'Fulham',kickoff:later,
   odds:{'1':2.05,X:3.65,'2':4.7},bookmaker:'Tipsport',
   fetchedAt:new Date().toISOString(),sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'}
 ];
 const unpaired=Array.from({length:13},(_,i)=>({
  id:'unpaired'+i,league:'cz',home:'Unused Team '+i,away:'Away Team '+i,
  kickoff:later,odds:{'1':2.1,X:3.2,'2':4.2},bookmaker:'Tipsport',
  fetchedAt:new Date().toISOString(),sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'
 }));
 t.ctx.receiveOdds(JSON.stringify({offers:[...valid,...unpaired],fetchedAt:new Date().toISOString()}));
 assert.equal(t.controls['odds-total'].textContent,'15');
 assert.equal(t.controls['odds-matched'].textContent,'2');
 assert.ok(t.controls['auto-results'].innerHTML.includes('POUZE SIMULACE'),
  t.controls['auto-results'].innerHTML.slice(0,1000));
 assert.ok(t.controls['auto-results'].innerHTML.includes('Uložit tento tiket nanečisto'));
 assert.ok(t.controls['auto-results'].innerHTML.includes('Arsenal'));
 assert.ok(t.controls['auto-results'].innerHTML.includes('Chelsea'));
 assert.ok(t.controls['auto-results'].innerHTML.includes('neprošel'));
 assert.ok(t.controls['auto-results'].innerHTML.includes('spárováno'));
});
test('three-leg longshot with only two verified matches explains why it cannot be created',()=>{
 const t=makeDom(),later=new Date(Date.parse(t.upcoming)+3600000).toISOString();
 t.controls['profile-longshot'].listeners.click();
 const second={...event('Chelsea','Fulham',later),id:'s2'};
 t.ctx.receiveMatches(JSON.stringify({events:[event('Arsenal','Liverpool',t.upcoming),second]}),'pl');
 const offers=[
  {id:'real1',league:'pl',home:'Arsenal',away:'Liverpool',kickoff:t.upcoming,
   odds:{'1':2.3,X:3.4,'2':3.2},bookmaker:'Tipsport',
   fetchedAt:new Date().toISOString(),sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'},
  {id:'real2',league:'pl',home:'Chelsea',away:'Fulham',kickoff:later,
   odds:{'1':2.3,X:3.4,'2':3.2},bookmaker:'Tipsport',
   fetchedAt:new Date().toISOString(),sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'}
 ];
 t.ctx.receiveOdds(JSON.stringify({offers,fetchedAt:new Date().toISOString()}));
 const html=t.controls['auto-results'].innerHTML;
 assert.ok(html.includes('vyžaduje 3 různá ověřená utkání'),html);
 assert.ok(!html.includes('POUZE SIMULACE'));
});


test('Chance API provider selection is real and never silently substitutes Tipsport prices',()=>{
 const t=makeDom();
 assert.equal(t.controls['odds-provider'].value,'tipsport');
 const before=t.calls.filter(x=>x==='chance').length;
 t.controls['odds-provider'].value='chance';
 t.controls['odds-provider'].listeners.change();
 assert.equal(t.calls.filter(x=>x==='chance').length,before+1);
 assert.ok(t.controls['source-notice'].textContent.includes('Chance'));
 assert.equal(t.saved.get('sport-odds-provider'),'chance');
 const sample=[{id:'T1',league:'pl',home:'Arsenal',away:'Liverpool',
   kickoff:t.upcoming,odds:{'1':2.4,X:3.5,'2':3.1},
   bookmaker:'Tipsport',sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html',
   fetchedAt:new Date().toISOString()}];
 t.ctx.receiveOdds(JSON.stringify({offers:sample,bookmaker:'Tipsport',fetchedAt:new Date().toISOString()}),'tipsport');
 assert.equal(t.controls['odds-total'].textContent,'0');
 assert.ok(!t.saved.get('auto-odds-v1:chance'));
 const actual=sample.map(x=>({...x,id:'C1',bookmaker:'Chance',
    sourceUrl:'https://www.chance.cz/kurzy'}));
 t.ctx.receiveOdds(JSON.stringify({offers:actual,bookmaker:'Chance',fetchedAt:new Date().toISOString()}),'chance');
 assert.equal(t.controls['odds-total'].textContent,'1');
 assert.ok(t.saved.get('auto-odds-v1:chance'));
 assert.equal(t.saved.get('auto-odds-v1'),undefined);
 t.controls['odds-provider'].value='tipsport';
 t.controls['odds-provider'].listeners.change();
 assert.ok(t.controls['source-notice'].textContent.includes('Tipsport'));
 assert.equal(t.controls['odds-total'].textContent,'0');
});
test('PulseScore key is passed only to Android encrypted bridge, never saved in web localStorage',()=>{
 const t=makeDom();
 t.controls['odds-provider'].value='chance';
 t.controls['odds-provider'].listeners.change();
 t.controls['chance-api-key'].value='012345678901abcdef';
 t.controls['save-chance-key'].listeners.click();
 assert.equal(t.controls['chance-api-key'].value,'');
 assert.ok(t.calls.includes('save-key'));
 assert.ok(![...t.saved.values()].some(value=>String(value).includes('012345678901abcdef')));
 const before=t.calls.filter(v=>v==='chance').length;
 t.ctx.receiveChanceKeyStatus(true,'API klíč je uložen');
 assert.equal(t.calls.filter(v=>v==='chance').length,before+1);
 t.controls['clear-chance-key'].listeners.click();
 assert.ok(t.calls.includes('clear-key'));
});

test('resuming the app starts an automatic foreground odds scan',()=>{
 const t=makeDom();
 const count=t.calls.filter(x=>x==='odds').length;
 t.ctx.sportPredictorOnPause();
 assert.ok(t.controls['auto-refresh-status'].textContent.includes('pozadí'));
 t.ctx.sportPredictorOnResume();
 assert.ok(t.calls.filter(x=>x==='odds').length>count);
 assert.ok(t.controls['auto-refresh-status'].textContent.includes('Kontroluji'));
});
test('Tipsport API uses different provider and does not mix with morning snapshot',()=>{
 const t=makeDom();
 t.controls['odds-provider'].value='tipsport-api';
 t.controls['odds-provider'].listeners.change();
 assert.ok(t.calls.includes('tipsport-api'));
 const offer={id:'t1',league:'pl',home:'Arsenal',away:'Chelsea',kickoff:t.upcoming,
  odds:{'1':2.3,X:3.4,'2':3.1},bookmaker:'Tipsport'};
 t.ctx.receiveOdds(JSON.stringify({bookmaker:'Tipsport',offers:[offer],fetchedAt:new Date().toISOString()}),'tipsport-api');
 assert.equal(t.controls['odds-total'].textContent,'1');
 assert.ok(t.saved.get('auto-odds-v2:tipsport-api'));
 t.ctx.receiveOdds(JSON.stringify({bookmaker:'Tipsport',offers:[offer],fetchedAt:new Date().toISOString()}),'tipsport');
 assert.equal(t.controls['odds-total'].textContent,'1');
});
