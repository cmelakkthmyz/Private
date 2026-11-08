import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCombo} from './ticketEvaluator.mjs';
const legs=[
 {matchId:'A',home:'Arsenal',away:'Chelsea',pick:'1',probability:.55,odds:'2,00',competition:'pl-football'},
 {matchId:'B',home:'Brentford',away:'Liverpool',pick:'2',probability:.50,odds:2,competition:'pl-football'}
];
test('two-leg ticket math reports probability, fair odds and EV',()=>{
 const x=evaluateCombo(legs,100);
 assert.equal(x.combinedProbability,.275);
 assert.equal(x.combinedOdds,4);
 assert.equal(x.fairCombinedOdds,Number((1/.275).toFixed(4)));
 assert.equal(x.modelEV,.1);
 assert.equal(x.potentialPayout,400);
 assert.equal(x.guaranteedProfit,false);
});
test('negative theoretical model edge is not hidden',()=>{
 const x=evaluateCombo(legs.map(l=>({...l,odds:1.5})),50);
 assert.ok(x.modelEV<0);
 assert.ok(x.expectedNetValue<0);
});
test('duplicate matches are refused',()=>{
 assert.throws(()=>evaluateCombo([legs[0],{...legs[0],pick:'2'}],100),/pouze jednou/);
});
test('invalid bookmaker odds are refused',()=>{
 assert.throws(()=>evaluateCombo([legs[0],{...legs[1],odds:'?'}],100),/platný aktuální kurz/);
});
test('linked opponents warn about dependent outcomes',()=>{
 const p=evaluateCombo([legs[0],{...legs[1],home:'Arsenal'}],50);
 assert.ok(p.warnings.some(x=>x.includes('nemusejí být nezávislé')));
});
test('hockey ticket valuation is flagged as experimental',()=>{
 const p=evaluateCombo([{...legs[0],competition:'cz-hockey'},legs[1]],50);
 assert.ok(p.warnings.some(x=>x.includes('Hokejové odhady')));
});
test('requires two or three matches',()=>{
 assert.throws(()=>evaluateCombo([legs[0]],50),/dva nebo tři/);
});
