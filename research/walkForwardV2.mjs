import {predictIntelligence,BASELINE_CONFIG} from './intelligenceV2.mjs';
import {mkdir,writeFile} from 'node:fs/promises';

const SEASONS=['2122','2223','2324','2425','2526'];
const URL=s=>'https://www.football-data.co.uk/mmz4281/'+s+'/E0.csv';
const LABELS={'2122':'2021-22','2223':'2022-23','2324':'2023-24','2425':'2024-25','2526':'2025-26'};
const round=(x,d=4)=>Number(x.toFixed(d));
function csvRows(txt){
 const out=[];let cell='',row=[],quoted=false;
 for(let i=0;i<txt.length;i++){
   const c=txt[i];
   if(c==='"'){
      if(quoted&&txt[i+1]==='"'){cell+='"';i++}else quoted=!quoted;
   }else if(c===','&&!quoted){row.push(cell);cell=''}
   else if((c==='\n'||c==='\r')&&!quoted){
     if(c==='\r'&&txt[i+1]==='\n')i++;
     row.push(cell);cell='';
     if(row.length>1&&row.some(v=>v!==''))out.push(row);
     row=[];
   }else cell+=c;
 }
 if(row.length||cell){row.push(cell);out.push(row)}
 const [headers,...records]=out;
 return records.map(line=>Object.fromEntries(headers.map((s,i)=>[s.trim(),line[i]??''])));
}
function dateISO(s){
 const m=String(s||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
 if(!m)return null;
 let y=Number(m[3]);if(y<100)y+=2000;
 const month=Number(m[2]),day=Number(m[1]);
 const d=new Date(Date.UTC(y,month-1,day));
 if(d.getUTCFullYear()!==y||d.getUTCMonth()+1!==month||d.getUTCDate()!==day)return null;
 return d.toISOString();
}
const names={'Man United':'Manchester United','Man City':'Manchester City','Tottenham':'Tottenham Hotspur','Wolves':'Wolverhampton Wanderers',"Nott'm Forest":'Nottingham Forest','West Ham':'West Ham United','Newcastle':'Newcastle United'};
const canonical=s=>names[s]||String(s||'').trim();
const optional=n=>n===''||n==null?null:Number.isFinite(Number(n))?Number(n):null;
function fixture(x,season,i){
 const date=dateISO(x.Date),h=optional(x.FTHG),a=optional(x.FTAG);
 if(!date||h===null||a===null||!x.HomeTeam||!x.AwayTeam)return null;
 const opening=[['AvgH','AvgD','AvgA'],['B365H','B365D','B365A'],['PSH','PSD','PSA']]
   .map(cols=>cols.map(k=>optional(x[k]))).find(v=>v.every(n=>n!==null&&n>1.01&&n<=100))||null;
 return {id:season+'_'+i,season:LABELS[season],kickoff:date,home_team_id:canonical(x.HomeTeam),
   away_team_id:canonical(x.AwayTeam),home_team_name:canonical(x.HomeTeam),away_team_name:canonical(x.AwayTeam),
   home_score:h,away_score:a,status:'finished',
   openingOdds:opening?{home:opening[0],draw:opening[1],away:opening[2]}:null,
   home_shots_on_target:optional(x.HST),away_shots_on_target:optional(x.AST)};
}
function trueOutcome(x){return x.home_score>x.away_score?'1':x.home_score===x.away_score?'X':'2'}
function resultMetrics(records){
 if(!records.length)return {n:0};
 const sum=records.reduce((acc,r)=>{
   const p=r.pred.probabilities,y=r.actual,v=Math.max(1e-12,p[y]);
   acc.correct+=r.pred.pick===y?1:0;
   acc.logloss-=Math.log(v);
   acc.brier+=['1','X','2'].reduce((s,k)=>s+(p[k]-(k===y?1:0))**2,0);
   acc.exact+=r.pred.score===r.game.home_score+':'+r.game.away_score?1:0;
   acc.draws+=r.pred.pick==='X'?1:0;
   acc.market+=r.pred.marketUsed?1:0;
   return acc;
 },{correct:0,logloss:0,brier:0,exact:0,draws:0,market:0});
 const high=records.filter(r=>r.pred.probability>=.5);
 return {n:records.length,accuracy:round(sum.correct/records.length,6),correct:sum.correct,
   logloss:round(sum.logloss/records.length,6),brier:round(sum.brier/records.length,6),
   exactScoreRate:round(sum.exact/records.length,6),drawPicks:sum.draws,marketUsed:sum.market,
   highConfidence:{n:high.length,accuracy:high.length?round(high.filter(r=>r.pred.pick===r.actual).length/high.length,6):null,
     correct:high.filter(r=>r.pred.pick===r.actual).length}};
}
function predictSeason(games,cfg,useMarket){
 const sorted=[...games].sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||a.id.localeCompare(b.id));
 const records=[];
 for(const game of sorted){
   const pred=predictIntelligence(game,sorted,{
     config:{...cfg,useFpl:false,useAvailability:false,priorityWeight:cfg.priorityWeight||0},
     odds:useMarket?game.openingOdds:null
   });
   records.push({game,pred,actual:trueOutcome(game)});
 }
 return {records,metrics:resultMetrics(records)};
}
const all={};
for(const season of SEASONS){
 const url=URL(season),r=await fetch(url,{headers:{'User-Agent':'PremierLeagueResearchV2/1.0'}});
 if(!r.ok)throw Error('No historical dataset '+url+' status='+r.status);
 const txt=await r.text();
 const matches=csvRows(txt).map((row,i)=>fixture(row,season,i)).filter(Boolean);
 if(matches.length!==380)throw Error('Expected 380 fixtures in '+season+' got '+matches.length);
 all[season]=matches;
 console.log(season,'verified fixtures',matches.length);
}
const prior=SEASONS.slice(0,3).flatMap(s=>all[s]);
const baseHome=prior.reduce((a,m)=>a+m.home_score,0)/prior.length;
const baseAway=prior.reduce((a,m)=>a+m.away_score,0)/prior.length;
const base={...BASELINE_CONFIG,homeBase:baseHome,awayBase:baseAway,rho:0};
const variants=[];
for(const priorValue of [3,6,9])for(const eloWeight of [0,.25,.45]){
 for(const power of [.7,.9])for(const marketWeight of [0,.4,.7]){
   variants.push({...base,prior:priorValue,eloWeight,power,marketWeight});
 }
}
const validations=[];
for(let i=0;i<variants.length;i++){
 const cfg=variants[i];
 const {metrics}=predictSeason(all['2425'],cfg,true);
 validations.push({config:cfg,...metrics});
 if((i+1)%9===0)console.log('validated',i+1,'/',variants.length);
}
const ordering=(a,b)=>a.logloss-b.logloss||b.accuracy-a.accuracy;
validations.sort(ordering);
const selected=validations[0];
const {metrics:test}=predictSeason(all['2526'],selected.config,true);
const withoutMarket={...selected.config,marketWeight:0};
const noMarket=predictSeason(all['2526'],withoutMarket,false).metrics;
const simple=predictSeason(all['2526'],{...base,eloWeight:0,marketWeight:0,priorityWeight:0},false).metrics;
const marketOnly=predictSeason(all['2526'],{...base,eloWeight:0,marketWeight:1,priorityWeight:0},true).metrics;
const result={generatedAt:new Date().toISOString(),sources:{resultsAndOpeningOdds:'https://www.football-data.co.uk/',method:'time-safe walk-forward'},
 training:SEASONS.slice(0,3).map(s=>LABELS[s]),baseGoals:{home:round(baseHome,4),away:round(baseAway,4)},
 validation:{season:LABELS['2425'],candidates:validations.length,best:validations.slice(0,5).map(x=>({config:x.config,n:x.n,accuracy:x.accuracy,logloss:x.logloss}))},
 holdout:{season:LABELS['2526'],selected:test,noMarket,poissonOnly:simple,marketOnly},
 leakageGuards:['Only prior match dates for club statistics and Elo','The entire test season is untouched until after validation','Only opening pre-match odds; never closing odds','Historical player injuries and future cup fixture priorities are unavailable and disabled','For same-day matches earlier games are also hidden'],
 warnings:['Retrospective 1/X/2 accuracy does not guarantee future performance','Rotation and match importance cannot be historically scored from results-only feeds','The market model depends on publicly available odds and does not imply betting profitability']};
await mkdir('research/results',{recursive:true});
await writeFile('research/results/v2-backtest.json',JSON.stringify(result,null,2));
console.log('RESULT_JSON',JSON.stringify(result));
