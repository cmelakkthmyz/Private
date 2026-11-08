import test from 'node:test';
import assert from 'node:assert/strict';
import {predictIntelligence,buildPrematchStates,BASELINE_CONFIG} from './intelligenceV2.mjs';
import {assessMatchPriority} from './matchPriority.mjs';
const day=n=>new Date(Date.UTC(2026,7,n)).toISOString();
const game=(id,dayNumber,h,a,hs,as,status='finished')=>({
 id:String(id),season:'2026-27',kickoff:day(dayNumber),
 home_team_id:h,away_team_id:a,home_team_name:h,away_team_name:a,
 home_score:hs,away_score:as,status
});
const history=[
 game('1',1,'A','B',3,1),game('2',2,'C','A',2,2),game('3',3,'B','C',0,1),
 game('4',4,'A','C',2,0),game('5',5,'B','A',1,1),game('6',6,'C','B',2,0)
];
const fixture=game('future',10,'A','B',null,null,'scheduled');
test('model emits normalized 1 X 2 probabilities and consistent mode',()=>{
 const p=predictIntelligence(fixture,history);
 const s=Object.values(p.probabilities).reduce((a,b)=>a+b,0);
 assert.ok(Math.abs(s-1)<1e-10);
 assert.equal(p.probabilities[p.pick],Math.max(...Object.values(p.probabilities)));
 const [h,a]=p.score.split(':').map(Number);
 assert.ok(p.pick==='1'?h>a:p.pick==='X'?h===a:h<a);
});
test('time isolation — future results cannot change prediction',()=>{
 const p=predictIntelligence(fixture,history);
 const other=[...history,game('x',12,'A','B',0,8),game('y',13,'B','C',10,0)];
 const next=predictIntelligence(fixture,other);
 assert.deepEqual(p.probabilities,next.probabilities);
 assert.equal(p.score,next.score);
});
test('time isolation — matches on same day are excluded',()=>{
 const extra=[...history,game('7',10,'A','C',10,0)];
 const original=buildPrematchStates(history,fixture);
 const changed=buildPrematchStates(extra,fixture);
 assert.equal(original.priorMatches,changed.priorMatches);
 assert.equal(original.home.elo,changed.home.elo);
});
test('unknown rotation does not imply a team sacrificed the league',()=>{
 const c=assessMatchPriority(fixture,history,{futureCupFixtures:[{
   team_id:'A',competition:'Champions League',stage:'knockout',kickoff:day(13),verified:false
 }]});
 assert.equal(c.home.rotationRisk,0);
 assert.equal(c.home.cup,null);
});
test('verified cup fixture records a restrained scenario risk',()=>{
 const c=assessMatchPriority(fixture,history,{futureCupFixtures:[{
   team_id:'A',competition:'Champions League',stage:'knockout',kickoff:day(13),verified:true
 }]});
 assert.equal(c.home.rotationRisk,.018);
 assert.ok(c.home.cup);
 assert.equal(c.home.confirmedRotation,null);
});
test('verified pre-match rotation reduces expected strength',()=>{
 const previous=predictIntelligence(fixture,history);
 const rotated=predictIntelligence(fixture,history,{lineupEvidence:[{
   team_id:'A',verified:true,published_at:day(9),
   key_players_resting:4,expected_starter_changes:6,source:'official team news'
 }]});
 assert.ok(rotated.xgHome<previous.xgHome);
 assert.equal(rotated.features.matchPriority.home.confirmedRotation.missing,4);
});
test('postkickoff lineup report is not used',()=>{
 const a=predictIntelligence(fixture,history);
 const b=predictIntelligence(fixture,history,{lineupEvidence:[{
   team_id:'A',verified:true,published_at:day(11),key_players_resting:8,expected_starter_changes:9
 }]});
 assert.equal(a.xgHome,b.xgHome);
});
test('missing market prices do not generate fake odds',()=>{
 const p=predictIntelligence(fixture,history);
 assert.equal(p.marketUsed,false);
 assert.equal(p.marketWeight,0);
});
test('market data must be plausible and valid',()=>{
 const p=predictIntelligence(fixture,history,{odds:{home:0,draw:1,away:2}});
 assert.equal(p.marketUsed,false);
});
test('do not use fulltime outcomes for future fixtures',()=>{
 const p=predictIntelligence({...fixture,home_score:9,away_score:0,status:'finished'},history);
 const q=predictIntelligence(fixture,history);
 assert.equal(p.pick,q.pick);
});
test('reasonable results for wide ability differences',()=>{
 for(let n=1;n<=7;n++){
   const h=history.map(x=>({...x}));
   const p=predictIntelligence(fixture,h,{config:{...BASELINE_CONFIG,eloWeight:n/10}});
   assert.ok(p.probability>0&&p.probability<1);
 }
});
