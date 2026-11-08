// Reproducible historical multi-leg ticket simulation.
// Uses ONLY pre-match odds columns (AvgH/AvgD/AvgA) and date-safe match history.
// Independent validation on 2024/25; untouched out-of-sample season 2025/26.
// No Chance or Tipsport historic feed is asserted: prices are independent market averages.
import {predictIntelligence} from './intelligenceV2.mjs';
import {matchOffer,buildAutoTickets} from './autoOddsScanner.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const league='pl',round=(v,n=5)=>Number(v.toFixed(n));
const sourceUrl=s=>'https://www.football-data.co.uk/mmz4281/'+s+'/E0.csv';
const SEASONS={'2425':'2024-25','2526':'2025-26'};
function parseCsv(text){
 const rows=[],records=[],line=[],s=String(text).replace(/^\uFEFF/,'');let cell='',quoted=false;
 const add=()=>{line.push(cell);cell='';if(line.some(x=>x.trim()))rows.push([...line]);line.length=0;};
 for(let i=0;i<s.length;i++){
  const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&c===','){line.push(cell);cell='';}
  else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&s[i+1]==='\n')i++;add();}
  else cell+=c;
 }
 if(cell||line.length)add();
 const headers=rows[0]?.map(x=>x.trim())||[];
 return rows.slice(1).map(row=>Object.fromEntries(headers.map((x,i)=>[x,row[i]||''])));
}
const aliases={'Man United':'Manchester United','Man City':'Manchester City','Tottenham':'Tottenham Hotspur',
 'Nott\'m Forest':'Nottingham Forest','Wolves':'Wolverhampton Wanderers','Newcastle':'Newcastle United',
 'West Ham':'West Ham United'};
const name=s=>aliases[s]||s;
function fixture(row,season,index){
 const m=String(row.Date||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
 if(!m)return null;
 const year=Number(m[3])+(Number(m[3])<100?2000:0);
 const day=new Date(Date.UTC(year,Number(m[2])-1,Number(m[1]),16));
 const hg=Number(row.FTHG),ag=Number(row.FTAG);
 if(!row.HomeTeam||!row.AwayTeam||!Number.isInteger(hg)||!Number.isInteger(ag))return null;
 const price=['AvgH','AvgD','AvgA'].map(k=>Number(row[k]));
 return {id:season+'_'+index,season,kickoff:day.toISOString(),home_team_id:name(row.HomeTeam),
  away_team_id:name(row.AwayTeam),home:name(row.HomeTeam),away:name(row.AwayTeam),
  home_score:hg,away_score:ag,status:'finished',league,odds:price.every(x=>Number.isFinite(x)&&x>1.01)?
    {'1':price[0],X:price[1],'2':price[2]}:null};
}
function verdict(game,pick){const h=game.home_score,a=game.away_score;return (h>a?'1':h===a?'X':'2')===pick;}
function evaluateSeason(games,config){
 const byDay=new Map();
 for(const m of games){
  const day=m.kickoff.slice(0,10);if(!byDay.has(day))byDay.set(day,[]);
  byDay.get(day).push(m);
 }
 const stats=Object.fromEntries(['balanced','longshot','draws'].map(k=>[k,{
  days:0,tickets:0,winning:0,staked:0,payout:0,under15:0,highOdds:0,meanOdds:0,
  claimedAdvantage:0
 }]));
 const actual=Object.fromEntries(games.map(g=>[g.id,g]));
 let priced=0,matched=0;
 for(const [day,dayMatches] of [...byDay].sort((a,b)=>a[0].localeCompare(b[0]))){
  const start=new Date(day+'T00:00:00Z').getTime();
  const fixtures=[],offers=[];
  for(const match of dayMatches){
   if(!match.odds)continue;
   priced++;
   const m=predictIntelligence(match,games,{
    config:{...config,marketWeight:0,priorityWeight:0,useFpl:false,useAvailability:false}
   });
   fixtures.push({id:match.id,home:match.home,away:match.away,league,
    kickoff:match.kickoff,status:'scheduled',modelVerified:true,probabilities:m.probabilities});
   offers.push({id:match.id,home:match.home,away:match.away,league,
    kickoff:match.kickoff,odds:match.odds,bookmaker:'historical-market-average'});
  }
  const linked=offers.map(o=>matchOffer(o,fixtures,start)).filter(Boolean);
  matched+=linked.length;
  for(const profile of Object.keys(stats)){
   const summary=stats[profile];summary.days++;
   const solution=buildAutoTickets(linked,{profile,stake:20,maxTickets:1,now:start});
   if(!solution.selected.length)continue;
   const bet=solution.selected[0];summary.tickets++;summary.staked+=20;
   summary.meanOdds+=bet.odds;
   if(bet.odds>=15)summary.highOdds++;
   if(bet.p<.15)summary.under15++;
   summary.claimedAdvantage+=bet.conservativeEV;
   const allCorrect=bet.legs.every(l=>verdict(actual[l.matchId],l.pick));
   if(allCorrect){summary.winning++;summary.payout+=bet.payout;}
  }
 }
 return {games:games.length,priced,matched,
  strategies:Object.fromEntries(Object.entries(stats).map(([key,x])=>[key,{
   days:x.days,tickets:x.tickets,winning:x.winning,hitRate:x.tickets?round(x.winning/x.tickets):null,
   staked:x.staked,payout:round(x.payout,2),net:round(x.payout-x.staked,2),
   roi:x.staked?round((x.payout-x.staked)/x.staked):null,
   meanOdds:x.tickets?round(x.meanOdds/x.tickets,3):null,
   claimedModelAdvantage:x.tickets?round(x.claimedAdvantage/x.tickets):null
  }]))};
}
const all={};
for(const [code,season] of Object.entries(SEASONS)){
 const url=sourceUrl(code),res=await fetch(url,{signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error('Could not download historical prematch odds '+season+' '+res.status);
 const rows=parseCsv(await res.text());
 const games=rows.map((r,i)=>fixture(r,season,i)).filter(Boolean);
 if(games.length!==380)throw Error('Historic season incomplete '+season+' count='+games.length);
 all[season]=games;
 console.log('ARCHIVE_CHECK',season,'fixtures',games.length,'with odds',games.filter(x=>x.odds).length);
}
const conf={prior:3,power:.9,eloWeight:.25,decayDays:105,homeBase:1.649123,
 awayBase:1.334211,temperature:1};
const validation=evaluateSeason(all['2024-25'],conf);
const independent=evaluateSeason(all['2025-26'],conf);
const output={generatedAt:new Date().toISOString(),
 source:'Football-data.co.uk historical early pre-match market averages — NOT historical Chance/Tipsport odds',
 settings:{stake:20,maxTicketsPerDay:1,selection:'Conservative model EV; no tune on test season',
  validation:'2024-25',holdout:'2025-26'},
 validation,independent,
 limitations:[
 'Historical prices are averages across other bookmakers, not Chance or Tipsport.',
 'Opening odds may be collected at varying times; no bookmaker maximum-stake restrictions are modelled.',
 'The portfolio assumes independent fixtures; selected matches from distinct clubs are filtered.',
 'A selected combination is not evidence of profitability; evaluate holdout ROI, especially thin samples.',
 'The betting-odds feed for other sports or countries does not have a verified old-price archive here.',
 'No guessing historical rematch prices or fabricated outcomes.'
 ]};
await mkdir('research/results',{recursive:true});
await writeFile('research/results/auto-ticket-backtest.json',JSON.stringify(output,null,2));
console.log('AUTO_TICKET_BACKTEST',JSON.stringify(output));
