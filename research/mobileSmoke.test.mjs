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
  'odds-status','odds-total','odds-matched','odds-updated',
  'profile-balanced','profile-longshot','profile-draws',
  'stake-10','stake-20','stake-50','scan-odds','auto-results','source-notice'
 ];
 const controls={};
 for(const id of ids)controls[id]={
  id,value:id.includes('strength')?'70':'',innerHTML:'',textContent:'',className:'',
  selectedIndex:0,attributes:{},listeners:{},
  addEventListener(type,handler){this.listeners[type]=handler;},
  setAttribute(k,v){this.attributes[k]=v;}
 };
 const saved=new Map(),calls=[],now=Date.now(),upcoming=new Date(now+3*86400000).toISOString();
 const ctx={
  console,URL,Intl,Date,Math,JSON,Array,Object,Number,String,Error,Boolean,Map,Set,Float64Array,
  document:{getElementById(id){if(!controls[id])throw Error('Unknown DOM id '+id);return controls[id]}},
  localStorage:{setItem(k,v){saved.set(k,v);},getItem(k){return saved.get(k)||null;}},
  AndroidPredictor:{loadFixtures(league){calls.push(league);},loadOdds(){calls.push('odds');}},
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
 assert.equal(t.calls[0],'pl');
 assert.ok(t.controls['coverage'].textContent.includes('Premier League'));
 const second=event('Chelsea','Fulham',new Date(Date.parse(t.upcoming)+86400000).toISOString());
 second.id='s2';
 t.ctx.receiveMatches(JSON.stringify({events:[event('Arsenal','Liverpool',t.upcoming),second]}),'pl');
 assert.ok(t.controls.matches.innerHTML.includes('Arsenal'));
 assert.ok(t.controls.matches.innerHTML.includes('Liverpool'));
 assert.ok(t.controls.matches.innerHTML.includes('Tip 1 / X / 2'));
 assert.ok(t.controls['auto-results'].innerHTML.includes('nejsou ověřené'));
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
 assert.ok(t.controls['auto-results'].innerHTML.includes('platnost vypršela'));
});
