// Pure chronological football/hockey walk-forward and online recalibration.
// Run with archived matches. No future outcomes are ever used in predictors.
import {predictIntelligence} from './intelligenceV2.mjs';
import {newLearningState,adaptivePrediction,recordForecast,settleResult,learningSummary} from './continualLearning.mjs';
import {loadCzechArchive,HELDOUT_SEASON,TARGET_SEASONS} from './czechHistory.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const num=(v,f=null)=>Number.isFinite(Number(v))?Number(v):f;
const round=(n,places=6)=>Number(n.toFixed(places));
const outcomes=['1','X','2'];
function mark(match){return match.home_score>match.away_score?'1':match.home_score===match.away_score?'X':'2'}
function logLoss(pred,y){return -Math.log(Math.max(1e-7,pred.probabilities[y]))}
const counts=(matches)=>({
  played:matches.length,
  home:matches.reduce((s,m)=>s+m.home_score,0),
  away:matches.reduce((s,m)=>s+m.away_score,0)
});
export function goalsKnownBefore(match,prior){
 // Re-estimate goal priors using only earlier seasons, not all 20 years in advance.
 const cut=match.season,done=prior.filter(m=>m.season<cut&&m.status==='finished');
 if(done.length<80)return {homeBase:1.53,awayBase:1.18,estimated:false,previousMatches:done.length};
 const lastYears=done.filter(m=>Number(m.season.slice(0,4))>=Number(cut.slice(0,4))-5);
 const n=Math.max(1,lastYears.length),s=counts(lastYears);
 return {homeBase:s.home/n,awayBase:s.away/n,estimated:true,previousMatches:done.length};
}
const dateKey=m=>m.kickoff.slice(0,10);
function grade(rows){
 const n=rows.length;
 if(!n)return {n:0};
 const s=rows.reduce((acc,r)=>{
  const y=r.actual;
  if(r.adaptive.pick===y)acc.correct++;
  if(r.static.pick===y)acc.staticCorrect++;
  if(r.adaptive.pick==='X')acc.drawPred++;
  if(r.static.pick==='X')acc.staticDrawPred++;
  acc.log+=logLoss(r.adaptive,y);
  acc.staticLog+=logLoss(r.static,y);
  if(r.adaptive.confidence>=.5){acc.strong++;if(r.adaptive.pick===y)acc.strongCorrect++}
  return acc;
 },{correct:0,staticCorrect:0,drawPred:0,staticDrawPred:0,log:0,staticLog:0,strong:0,strongCorrect:0});
 return {n,correct:s.correct,accuracy:round(s.correct/n),staticAccuracy:round(s.staticCorrect/n),
   logloss:round(s.log/n),staticLogloss:round(s.staticLog/n),drawPicks:s.drawPred,
   strong:{n:s.strong,correct:s.strongCorrect,accuracy:s.strong?round(s.strongCorrect/s.strong):null}};
}
export function replayChronologically(matches,{competition='cz-football',includeSnapshots=false}={}){
 const sorted=[...matches].filter(m=>m.status==='finished'&&Number.isInteger(m.home_score)&&Number.isInteger(m.away_score))
 .sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||String(a.id).localeCompare(String(b.id)));
 const state=newLearningState(competition),reports=[],overall=[];
 // Strict batch by match date: no result of the same calendar day enters a prediction.
 let start=0;
 while(start<sorted.length){
  const day=dateKey(sorted[start]),group=[];let i=start;
  while(i<sorted.length&&dateKey(sorted[i])===day)group.push(sorted[i++]);
  for(const match of group){
   const base=goalsKnownBefore(match,sorted);
   const staticPrediction=predictIntelligence(match,sorted,{config:{
    prior:5,power:.88,eloWeight:.22,marketWeight:0,priorityWeight:0,
    useFpl:false,useAvailability:false,homeBase:base.homeBase,awayBase:base.awayBase
   }});
   const predictedAt=new Date(Date.parse(match.kickoff)-60*60000).toISOString();
   const adaptive=adaptivePrediction(competition,staticPrediction,null,state,predictedAt);
   const row={season:match.season,id:match.id,date:day,actual:mark(match),
     static:staticPrediction,adaptive};
   reports.push(row);overall.push(row);
   const record=recordForecast(state,{id:match.id,competition,predictedAt,kickoff:match.kickoff,
     pick:adaptive.pick,probabilities:adaptive.probabilities,experts:adaptive.experts});
   if(!record)throw Error('Repeated prediction id '+match.id);
  }
  // Results settle after the current UTC day; same-day events are never leaked.
  const available=new Date(Date.parse(day+'T00:00:00Z')+86400000+1000).toISOString();
  for(const match of group)settleResult(state,{id:match.id,home_score:match.home_score,
   away_score:match.away_score,settledAt:available});
  start=i;
 }
 const seasons=[...new Set(sorted.map(m=>m.season))].sort();
 const bySeason=seasons.map(season=>({season,...grade(reports.filter(x=>x.season===season))}));
 const tail=bySeason.filter(x=>TARGET_SEASONS.includes(x.season));
 const final=bySeason.find(x=>x.season===HELDOUT_SEASON)||null;
 const finalDate=new Date(Date.parse(sorted.at(-1)?.kickoff||'2026-11-01')+3*86400000).toISOString();
 return {competition,total:grade(overall),bySeason,heldout:final,
   heldoutStatus:final?'separate last-season score; no retuning on this season':'not available',
   summary:learningSummary(state,finalDate),state:includeSnapshots?state:undefined,
   warnings:['Historical datasets may be incomplete; check coverage manifest',
     'Any match not available before kickoff is excluded by the engine',
     'No rotation or injury history is inferred from final scores']};
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].split('/').at(-1))){
 const history=await loadCzechArchive();
 const review=replayChronologically(history.matches);
 const output={generatedAt:new Date().toISOString(),coverage:history.coverage,
  verifiedSeasons:history.verifiedSeasons,missing:history.missing,seasonAudit:history.audit,
  results:{total:review.total,bySeason:review.bySeason,heldout:review.heldout,summary:review.summary},
  status:history.coverage.complete20Years&&history.coverage.heldoutLoaded?
    'full 20-year validation':'PARTIAL — never describe as 20-year-trained'};
 await mkdir('research/results',{recursive:true});
 await writeFile('research/results/czech-history-learning.json',JSON.stringify(output,null,2));
 console.log('CZECH_HISTORY_REPORT',JSON.stringify(output));
}
