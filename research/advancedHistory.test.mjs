import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOpenFootballEngland,canonicalEngland,ENGLISH_TRAINING_SEASONS} from './openFootballEngland.mjs';
import {historySignalsBefore,enhanceHistoricalGoals} from './extraHistorySignals.mjs';
import {predictIntelligence} from './intelligenceV2.mjs';
const date=(n)=>new Date(Date.UTC(2024,7,1+n)).toISOString();
const f=(i,h,a,x,y,finished='finished')=>({
 id:'s'+i,season:'2024-25',kickoff:date(i),home_team_id:h,away_team_id:a,
 home_team_name:h,away_team_name:a,home_score:x,away_score:y,status:finished
});
test('OpenFootball parser supports old results in the middle and dates',()=>{
 const source='= English Premier League 2015/16\n▪ Matchday 1\nSat Aug 8\n  12:45  Manchester United        1-0 (1-0)  Tottenham Hotspur\n  15:00  AFC Bournemouth          0-1 (0-0)  Aston Villa\nSun Aug 9\n  13:30  Newcastle United         2-2 (1-1)  Southampton FC\n';
 const p=parseOpenFootballEngland(source,'2015-16');
 assert.equal(p.matches.length,3);
 assert.equal(p.matches[0].home_team_id,'Manchester United');
 assert.equal(p.matches[1].home_team_id,'Bournemouth');
 assert.equal(p.matches[2].kickoff.slice(0,10),'2015-08-09');
});
test('OpenFootball parser supports match schedule home v away score form',()=>{
 const source='= English Premier League 2024/25\n▪ Matchday 1\n  Fri Aug 16 2024\n    20:00  Manchester United FC    v Fulham FC                1-0 (0-0)\n  Sat Aug 17\n    15:00  Arsenal FC              v Wolverhampton Wanderers FC  2-0 (1-0)';
 const p=parseOpenFootballEngland(source,'2024-25');
 assert.equal(p.matches.length,2);
 assert.equal(p.matches[0].away_team_id,'Fulham');
 assert.equal(p.matches[1].away_team_id,'Wolverhampton Wanderers');
});
test('OpenFootball parser supports latest results and ignores scorer commentary',()=>{
 const source="= England | Premier League 2025/26\n▪ Regular Season - 1\nFri Aug 15 2025\n  19:00   Liverpool  4-2 (1-0)  Bournemouth\n                  (John 37', John 49', John 88'; Oscar 64')\nSat Aug 16\n  12:30   Aston Villa  0-0 (0-0)  Newcastle United";
 const p=parseOpenFootballEngland(source,'2025-26');
 assert.equal(p.matches.length,2);
 assert.equal(p.matches[0].home_score,4);
 assert.equal(p.matches[1].away_team_id,'Newcastle United');
});
test('training seasons include 20 completed historical years before holdout',()=>{
 assert.equal(ENGLISH_TRAINING_SEASONS.length,20);
 assert.equal(ENGLISH_TRAINING_SEASONS[0],'2005-06');
 assert.equal(ENGLISH_TRAINING_SEASONS.at(-1),'2024-25');
});
test('strict historical cutoff blocks future and same-day leaks',()=>{
 const history=[];
 for(let i=0;i<16;i++)history.push(f(i,'Arsenal','Liverpool',3,0));
 const fixture=f(20,'Arsenal','Liverpool',null,null,'scheduled');
 const before=historySignalsBefore(history,fixture);
 const poisoned=[...history,f(20,'Arsenal','Liverpool',0,99),f(22,'Arsenal','Liverpool',0,99)];
 const after=historySignalsBefore(poisoned,fixture);
 assert.deepEqual(after,before);
 const original=predictIntelligence(fixture,history,{config:{useAdvancedHistory:true}});
 const changed=predictIntelligence(fixture,poisoned,{config:{useAdvancedHistory:true}});
 assert.deepEqual(changed.probabilities,original.probabilities);
});
test('venue-specific goals increase appropriately without fabricating observations',()=>{
 const history=[];
 for(let i=0;i<20;i++){
  if(i%2===0)history.push(f(i,'Arsenal','Liverpool',3,0));
  else history.push(f(i,'Liverpool','Arsenal',1,1));
 }
 const fixture=f(23,'Arsenal','Liverpool',null,null,'scheduled');
 const s=historySignalsBefore(history,fixture);
 assert.ok(s.evidence.hasVenue);
 assert.ok(s.venueHome>0);
 const base={home:1.45,away:1.2};
 const stronger=enhanceHistoricalGoals(base,history,fixture,{venueWeight:.8,shotsWeight:0});
 assert.ok(stronger.home>base.home);
});
test('with no trustworthy historic shots the model cannot invent SOT signal',()=>{
 const fixture=f(4,'Arsenal','Liverpool',null,null,'scheduled');
 const s=historySignalsBefore([f(1,'Arsenal','Liverpool',2,0)],fixture);
 assert.equal(s.evidence.hasShots,false);
 assert.equal(s.shotsHome,0);
 assert.equal(s.shotsAway,0);
});
test('past shots affect only a small capped correction',()=>{
 const history=[];
 for(let i=0;i<22;i++){
   const g=i%2===0?f(i,'Arsenal','Liverpool',2,0):f(i,'Liverpool','Arsenal',1,0);
   g.home_shots_on_target=i%2===0?8:4;
   g.away_shots_on_target=i%2===0?3:6;
   history.push(g);
 }
 const fixture=f(24,'Arsenal','Liverpool',null,null,'scheduled');
 const s=historySignalsBefore(history,fixture);
 assert.equal(s.evidence.hasShots,true);
 assert.ok(Math.abs(s.shotsHome)<=.0771);
 assert.ok(Math.abs(s.shotsAway)<=.0771);
});
test('FPL-like historical strength snapshots must not leak into old matches',()=>{
 const fixture=f(24,'Arsenal','Liverpool',null,null,'scheduled');
 const plain=predictIntelligence(fixture,[],{config:{useFpl:false}});
 const poisoned=predictIntelligence(fixture,[],{config:{useFpl:false},teams:[
  {id:'Arsenal',attack:110,defense:110},{id:'Liverpool',attack:10,defense:10}]});
 assert.equal(plain.xgHome,poisoned.xgHome);
 assert.equal(plain.pick,poisoned.pick);
});
