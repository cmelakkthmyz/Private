import test from 'node:test';
import assert from 'node:assert/strict';
import {newLearningState,adaptivePrediction,recordForecast,settleResult,learningSummary,rebuildLearningState} from './continualLearning.mjs';
import {TARGET_SEASONS,parseOpenfootballCzech,parseCzechCsv,auditCzechSeason,canonicalCzechClub} from './czechHistory.mjs';
import {goalsKnownBefore,replayChronologically} from './seasonalReplay.mjs';
const clock=n=>new Date(Date.UTC(2026,0,n)).toISOString();
const good={probabilities:{'1':.6,X:.25,'2':.15},poisson:{'1':.55,X:.28,'2':.17},elo:{'1':.57,X:.25,'2':.18}};
function fakeForecast(s,id,day,competition='cz-football'){
 const kickoff=clock(day),predictedAt=new Date(Date.parse(kickoff)-3600000).toISOString();
 const p=adaptivePrediction(competition,good,null,s,predictedAt);
 recordForecast(s,{id,competition,kickoff,predictedAt,...p});
 return p;
}
test('Czech history covers exactly 20 intended pretest years',()=>{
 assert.equal(TARGET_SEASONS.length,20);
 assert.equal(TARGET_SEASONS[0],'2005-06');assert.equal(TARGET_SEASONS.at(-1),'2024-25');
});
test('OpenFootball text preserves dates and Czech club identities',()=>{
 const txt='= Czech Republic First League 2024/25\n▪ Matchday 1\n  Fri Jul 19 2024\n    19:00  AC Sparta Praha         v FK Pardubice             2-1 (1-1)\n  Sat Jul 20\n    14:30  SK Slavia Praha         v FC Viktoria Plzeň        1-0 (0-0)\n';
 const data=parseOpenfootballCzech(txt,'2024-25');
 assert.equal(data.matches.length,2);assert.equal(data.matches[0].kickoff,'2024-07-19T19:00:00Z');
 assert.equal(data.matches[0].home_team_id,'Sparta Praha');
 assert.equal(data.matches[1].away_team_id,'Viktoria Plzeň');
 assert.equal(auditCzechSeason(data).complete,false);
});
test('CSV imports do not silently treat incorrect score as valid',()=>{
 const s='date,home,away,home_score,away_score\n2006-08-10,AC Sparta Praha,FC Baník Ostrava,3,1\n2006-08-11,Sparta Praha,Sparta Praha,1,1';
 const data=parseCzechCsv(s,'2006-07');
 assert.equal(data.matches.length,1);assert.equal(data.warnings.length,1);
 assert.equal(canonicalCzechClub('FC Baník Ostrava'),'Baník Ostrava');
});
test('learner records first pre-match forecast and ignores duplicates',()=>{
 const state=newLearningState('cz-football');
 fakeForecast(state,'ABC',2);
 assert.equal(state.events.length,1);
 assert.equal(recordForecast(state,{...state.events[0]}),false);
});
test('learner prevents forecasts created after kickoff',()=>{
 const s=newLearningState('cz-football');
 assert.throws(()=>recordForecast(s,{id:'x',competition:'cz-football',predictedAt:clock(3),kickoff:clock(3),pick:'1',probabilities:good.probabilities,experts:{model:good.probabilities}}),/before kickoff/);
});
test('one final score only creates one learning update',()=>{
 const s=newLearningState('cz-football');
 fakeForecast(s,'A',4);
 assert.equal(settleResult(s,{id:'A',home_score:1,away_score:0,settledAt:clock(5)}),true);
 assert.equal(settleResult(s,{id:'A',home_score:0,away_score:9,settledAt:clock(5)}),false);
 assert.equal(learningSummary(s,clock(6)).settled,1);
});
test('unknown outcome cannot change learner state before kickoff',()=>{
 const s=newLearningState('cz-football');
 fakeForecast(s,'A',4);
 assert.throws(()=>settleResult(s,{id:'A',home_score:4,away_score:1,settledAt:clock(4)}),/before kickoff/);
 assert.equal(learningSummary(s,clock(4)).settled,0);
});
test('no leakage from future settlement when querying an older forecast',()=>{
 const s=newLearningState('cz-football');
 const before=adaptivePrediction('cz-football',good,null,s,clock(2));
 fakeForecast(s,'A',4);
 settleResult(s,{id:'A',home_score:4,away_score:0,settledAt:clock(5)});
 const replay=adaptivePrediction('cz-football',good,null,s,clock(2));
 assert.deepEqual(before.weights,replay.weights);
 assert.equal(rebuildLearningState(s,clock(3)).accuracy.settled,0);
});
test('online model distinguishes football from hockey by namespace',()=>{
 const a=newLearningState('cz-football'),b=newLearningState('cz-hockey');
 fakeForecast(a,'A',4);
 settleResult(a,{id:'A',home_score:2,away_score:0,settledAt:clock(5)});
 assert.equal(learningSummary(b,clock(6)).settled,0);
 assert.throws(()=>adaptivePrediction('cz-football',good,null,b,clock(6)),/Wrong competition/);
});
test('expert weights adapt after systematic model errors',()=>{
 const s=newLearningState('cz-football');
 const inputs={
  probabilities:{'1':.08,X:.12,'2':.80},poisson:{'1':.84,X:.1,'2':.06},elo:{'1':.80,X:.1,'2':.10}
 };
 const first=adaptivePrediction('cz-football',inputs,null,s,clock(2));
 for(let i=0;i<30;i++){
  const kick=new Date(Date.UTC(2026,0,4+i)).toISOString();
  const at=new Date(Date.parse(kick)-3600000).toISOString();
  const p=adaptivePrediction('cz-football',inputs,null,s,at);
  recordForecast(s,{id:'t'+i,competition:'cz-football',kickoff:kick,predictedAt:at,...p});
  settleResult(s,{id:'t'+i,home_score:1,away_score:0,settledAt:new Date(Date.parse(kick)+3600000).toISOString()});
 }
 const last=adaptivePrediction('cz-football',inputs,null,s,clock(50));
 assert.ok(last.weights.model<first.weights.model);
 assert.ok(last.weights.poisson>first.weights.poisson);
 assert.ok(last.probabilities['1']>first.probabilities['1']);
});
test('season prior uses only seasons before the target one',()=>{
 const fixture={season:'2020-21'};
 const past=[{season:'2019-20',status:'finished',home_score:2,away_score:1},
             {season:'2021-22',status:'finished',home_score:8,away_score:8}];
 assert.equal(goalsKnownBefore(fixture,past).previousMatches,1);
});
test('replay of fictional Czech seasons produces nonzero, chronologically ordered stats',()=>{
 const games=[];
 for(let y=2018;y<=2019;y++)for(let d=1;d<=14;d++){
  const season=y+'-'+String((y+1)%100).padStart(2,'0');
  const date=new Date(Date.UTC(y,7,d)).toISOString();
  games.push({id:season+'-'+d,season,competition:'cz-football',kickoff:date,
   home_team_id:d%2?'Sparta':'Slavia',away_team_id:d%2?'Plzen':'Banik',
   home_score:d%3,away_score:(d+1)%2,status:'finished'});
 }
 const report=replayChronologically(games);
 assert.equal(report.total.n,28);
 assert.equal(report.bySeason.length,2);
 assert.ok(report.summary.settled>=27);
});
