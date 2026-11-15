import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModelTicketSuggestions} from './modelTicketBuilder.mjs';

const now=Date.parse('2026-11-08T17:00:00Z');
const matches=(n=4,quoted=false)=>Array.from({length:n},(_,i)=>({
 id:'fixture'+i,league:'pl',home:'Home '+i,away:'Away '+i,
 kickoff:new Date(now+(i+1)*3600000).toISOString(),
 probabilities:{'1':.6,X:.25,'2':.15},
 ...(quoted?{odds:{'1':1.8,X:3.8,'2':5}}:{})
}));
test('works with real forecast probabilities and no bookmaker key or prices',()=>{
 const out=buildModelTicketSuggestions(matches(4),{now,stake:30,maxMatches:3});
 assert.equal(out.fixturesEligible,4);
 assert.ok(out.recommended);
 assert.ok(out.alternatives.some(t=>t.type==='solo'));
 assert.ok(out.alternatives.some(t=>t.type==='ako'));
 assert.ok(out.alternatives.some(t=>t.type==='kombi'));
 assert.ok(out.alternatives.some(t=>t.type==='maxikombi'));
 assert.equal(out.recommended.hasPrices,false);
 for(const t of out.alternatives)assert.equal(t.expectedNet,null);
});
test('all fixture probabilities are normalized and 3-match system 2/3 is enumerated',()=>{
 const out=buildModelTicketSuggestions(matches(3),{now,stake:30,maxMatches:3});
 const sys=out.alternatives.find(x=>x.type==='kombi'&&x.legCount===3);
 assert.ok(sys);
 assert.equal(sys.lineCount,3);
 assert.deepEqual(sys.rows.map(x=>x.description),['A + B','A + C','B + C']);
 assert.equal(sys.stakePerRow,10);
 // Probability of at least two correct picks when each selection is 60%.
 assert.ok(Math.abs(sys.chanceAtLeastOne-.648)<1e-10);
});
test('three-leg AKO pays only if all three picks are correct',()=>{
 const out=buildModelTicketSuggestions(matches(3,true),{now,stake:20,maxMatches:3});
 const ako=out.alternatives.find(x=>x.type==='ako'&&x.legCount===3);
 assert.ok(ako);
 assert.ok(Math.abs(ako.chanceAtLeastOne-.216)<1e-10);
 assert.equal(ako.lineCount,1);
 assert.equal(ako.hasPrices,true);
 assert.equal(ako.chanceOfProfit,ako.chanceAtLeastOne);
});
test('rejects fictional, expired, bad and duplicate fixtures',()=>{
 const example=matches(1)[0];
 const invalid=[
 {...example,id:'expired',kickoff:new Date(now-10000).toISOString()},
 {...example,id:'bad-prob',probabilities:{'1':.6,X:0,'2':.9}},
 {...example,id:'broken-odds',odds:{'1':1,X:3,'2':5}}
 ];
 const out=buildModelTicketSuggestions([example,example,...invalid],{now});
 assert.equal(out.fixturesEligible,3); // bad odds valid match, never fabricated price
 assert.equal(out.matchesConsidered,2); // duplicate ID only
 assert.equal(out.recommended.hasPrices,false);
});
test('can compare systematic stake across all rows without treating one win as net profit',()=>{
 const out=buildModelTicketSuggestions(matches(3,true),{now,stake:30,maxMatches:3});
 const sys=out.alternatives.find(x=>x.type==='maxikombi'&&x.legCount===3);
 assert.equal(sys.lineCount,4);
 assert.equal(sys.stakePerRow,7.5);
 assert.ok(Math.abs(sys.chanceAtLeastOne-.648)<1e-10);
 assert.ok(sys.chanceOfProfit<=sys.chanceAtLeastOne);
});


test('selects 5 to 20 matches without silently imposing the old four-match ceiling',()=>{
 const data=matches(22,true).map(m=>({...m,odds:{'1':2.2,X:3.8,'2':5}}));
 const out=buildModelTicketSuggestions(data,{
  now,stake:20,minMatches:5,maxMatches:20,requirePrices:true,
  minEdge:.03,minRowStake:1
 });
 assert.equal(out.fixturesEligible,22);
 assert.equal(out.pricedMatches,22);
 assert.ok(out.alternatives.length);
 assert.ok(out.alternatives.every(t=>t.legCount>=5&&t.legCount<=20));
 const twenty=out.alternatives.find(t=>t.type==='ako'&&t.legCount===20);
 assert.ok(twenty,'A genuine 20-match accumulator should exist');
 assert.equal(twenty.lineCount,1);
 assert.equal(twenty.stakePerRow,20);
 assert.ok(Math.abs(twenty.chanceAtLeastOne-Math.pow(.6,20))<1e-9);
});
test('twenty-fixture expanded systems are bounded and not offered with unusable micro stakes',()=>{
 const fixtures=matches(20,true).map(m=>({...m,odds:{'1':2.2,X:3.8,'2':5}}));
 const small=buildModelTicketSuggestions(fixtures,{
  now,stake:20,minMatches:20,maxMatches:20,requirePrices:true,
  minRowStake:1,minEdge:.03
 });
 assert.ok(small.alternatives.some(t=>t.type==='ako'&&t.legCount===20));
 assert.ok(small.alternatives.some(t=>t.type==='kombi'&&t.legCount===20));
 assert.equal(small.alternatives.some(t=>t.type==='maxikombi'&&t.legCount===20),false);
 const large=buildModelTicketSuggestions(fixtures,{
  now,stake:250,minMatches:20,maxMatches:20,requirePrices:true,
  minRowStake:1,minEdge:.03
 });
 const system=large.alternatives.find(t=>t.type==='maxikombi'&&t.legCount===20);
 assert.ok(system);
 assert.equal(system.lineCount,211); // C(20,18)+C(20,19)+C(20,20)
 assert.equal(system.rows.length,211);
 assert.ok(system.chanceAtLeastOne<=1);
 assert.ok(system.chanceOfProfit<=system.chanceAtLeastOne);
});
test('value filter rejects unpriced and negative-edge offers instead of inventing profits',()=>{
 const noOdds=buildModelTicketSuggestions(matches(10),{
  now,stake:20,minMatches:5,maxMatches:10,requirePrices:true,minEdge:.03
 });
 assert.deepEqual(noOdds.alternatives,[]);
 assert.match(noOdds.reason,/kurzy/);
 const tooLow=matches(10,true).map(m=>({...m,odds:{'1':1.5,X:3.8,'2':5}}));
 const priced=buildModelTicketSuggestions(tooLow,{
  now,stake:20,minMatches:5,maxMatches:10,requirePrices:true,minEdge:.03
 });
 assert.equal(priced.pricedMatches,10);
 assert.equal(priced.valueMatches,0);
 assert.equal(priced.alternatives.length,0);
});
test('generate again explores a different viable fixture set rather than cycling fixed cards',()=>{
 const fixtureList=matches(12,true).map(m=>({...m,odds:{'1':2.2,X:3.8,'2':5}}));
 const options={now,stake:20,minMatches:5,maxMatches:5,
  requirePrices:true,minEdge:.03,minRowStake:1};
 const a=buildModelTicketSuggestions(fixtureList,{...options,generationIndex:0});
 const b=buildModelTicketSuggestions(fixtureList,{...options,generationIndex:1});
 const ids=out=>new Set(out.alternatives.filter(t=>t.type==='ako').map(t=>t.id));
 const x=ids(a),y=ids(b);
 assert.ok(x.size>=2);
 assert.ok(y.size>=2);
 assert.ok([...y].some(id=>!x.has(id)), 'A new suggestion should contain a new match combination');
});
test('explicit minimum 20 never returns a 5-leg ticket when few fixtures are available',()=>{
 const out=buildModelTicketSuggestions(matches(8,true),{
  now,stake:20,minMatches:20,maxMatches:20,requirePrices:true,minEdge:.03
 });
 assert.equal(out.alternatives.length,0);
});
