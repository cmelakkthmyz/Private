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
 assert.ok(sys.chanceAtLeastOne>=.648);
 assert.ok(sys.chanceOfProfit<=sys.chanceAtLeastOne);
});
