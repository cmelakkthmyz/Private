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
  'manual-result','calc','refresh','data-attribution'
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
  AndroidPredictor:{loadFixtures(league){calls.push(league);}},
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
 t.ctx.receiveMatches(JSON.stringify({events:[event('Arsenal','Liverpool',t.upcoming)]}),'pl');
 assert.ok(t.controls.matches.innerHTML.includes('Arsenal'));
 assert.ok(t.controls.matches.innerHTML.includes('Liverpool'));
 assert.ok(t.controls.matches.innerHTML.includes('Tip 1 / X / 2'));
 const state=JSON.parse(t.saved.get('premier-intelligence-online-v1:pl-football'));
 assert.equal(state.events.length,1);
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
