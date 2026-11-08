import {loadEnglishArchive} from './openFootballEngland.mjs';
import {predictIntelligence} from './intelligenceV2.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const r=(n,d=5)=>Number(n.toFixed(d));
const grouped=xs=>Object.groupBy?Object.groupBy(xs,x=>x.season):xs.reduce((a,x)=>{(a[x.season]??=[]).push(x);return a},{});
const outcome=g=>g.home_score>g.away_score?'1':g.home_score===g.away_score?'X':'2';
function metrics(rows){
 const n=rows.length,by=rows.reduce((a,x)=>{
   const probs=x.pred.probabilities,p=Math.max(1e-8,probs[x.y]);
   a.logloss-=Math.log(p);
   a.brier+=['1','X','2'].reduce((v,k)=>v+(probs[k]-(k===x.y?1:0))**2,0);
   a.correct+=x.pred.pick===x.y?1:0;
   a.draws+=x.pred.pick==='X'?1:0;
   a.exact+=x.pred.score===x.g.home_score+':'+x.g.away_score?1:0;
   return a;
 },{logloss:0,brier:0,correct:0,draws:0,exact:0});
 return {n,accuracy:r(by.correct/n),correct:by.correct,logloss:r(by.logloss/n),
  brier:r(by.brier/n),drawPredictions:by.draws,exactScoreAccuracy:r(by.exact/n)};
}
const all=await loadEnglishArchive({requireAll:false});
console.log('ENGLISH_HISTORY_COVERAGE',JSON.stringify(all.coverage));
console.log('ENGLISH_HISTORY_BAD_SEASONS',JSON.stringify(all.reports.filter(x=>!x.verified)));
const groups=grouped(all.matches);
if(!groups['2024-25']?.length || !groups['2025-26']?.length)
 throw Error('Cannot evaluate model, validation or holdout season is missing');
const previous=all.matches.filter(x=>x.season>='2019-20'&&x.season<='2023-24');
const leagueHome=previous.reduce((a,x)=>a+x.home_score,0)/previous.length;
const leagueAway=previous.reduce((a,x)=>a+x.away_score,0)/previous.length;
const fixed={eloWeight:.25,marketWeight:0,useFpl:false,useAvailability:false,
 priorityWeight:0,prior:6,power:.83,rho:0,temperature:1,
 homeBase:leagueHome,awayBase:leagueAway};
function run(season,cfg){
 const rows=[];
 for(const game of groups[season]){
   const p=predictIntelligence(game,all.matches,{config:cfg,teams:[],players:[],articles:[]});
   rows.push({g:game,pred:p,y:outcome(game)});
 }
 return metrics(rows);
}
const base=run('2024-25',{...fixed,useAdvancedHistory:false});
const candidates=[.25,.5,.75,1].map(weight=>{
 const config={...fixed,useAdvancedHistory:true,venueWeight:weight,shotsWeight:0};
 const score=run('2024-25',config);
 console.log('VENUE_VARIANT',weight,JSON.stringify(score));
 return {config,weight,validation:score};
});
candidates.sort((a,b)=>a.validation.logloss-b.validation.logloss);
const best=candidates[0];
const accepted=best.validation.logloss<base.logloss-.001;
const chosen=accepted?best.config:{...fixed,useAdvancedHistory:false};
const holdoutBaseline=run('2025-26',{...fixed,useAdvancedHistory:false});
const holdoutChosen=run('2025-26',chosen);
const result={
 updatedAt:new Date().toISOString(),
 source:'OpenFootball CC0 match outcomes, no betting odds or injury snapshots',
 archive:all.coverage,archiveIssues:all.reports.filter(x=>!x.verified),
 trainingSourceSeasons:['2005-06','2023-24'],
 validation:'2024-25',holdout:'2025-26',
 comparison:{validationBaseline:base,validationCandidates:candidates.map(x=>({weight:x.weight,...x.validation})),
  holdoutBaseline,holdoutChosen},
 production:{advancedHistory:accepted,venueWeight:accepted?best.weight:0,
  shotsWeight:0,config:chosen},
 selectedUsingOnly:'2024/25 log-loss before inspecting independent 2025/26',
 warnings:['Current FPL player availability is not available in historical CC0 data and was disabled',
  'Use 2025/26 independent metrics to judge predictive value; do not tune on that holdout',
  'Home/away data needs sufficient prior games before adjustment',
  '20 years of data does not prove 50%+ forecasting accuracy or betting profitability']
};
await mkdir('research/results',{recursive:true});
await writeFile('research/results/advanced-history-validation.json',JSON.stringify(result,null,2));
await writeFile('app/src/main/assets/v3Validation.js',
 'globalThis.V3_VALIDATION='+JSON.stringify({
  production:result.production,comparison:{validationBaseline:base,holdoutChosen,holdoutBaseline},
  trainingSeasons:all.coverage.complete,source:result.source})+';');
console.log('ADVANCED_HISTORY_RESULT',JSON.stringify({
 archive:result.archive,production:result.production,
 validationBaseline:base,validationChosen:accepted?best.validation:base,
 holdoutBaseline,holdoutChosen
}));
