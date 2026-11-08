// Model-first ticket drafts. Probabilities come from independent match forecasts.
// No bookmaker quote is fabricated, and this module never places wagers.
const PICKS=['1','X','2'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const toMillis=x=>typeof x==='number'?x:Date.parse(x);
function validFixture(m,now){
 if(!m||!['pl','cz','hockey'].includes(m.league)||!m.home||!m.away)return null;
 const kickoff=toMillis(m.kickoff);
 if(!Number.isFinite(kickoff)||kickoff<=now+60_000||kickoff>now+14*86400000)return null;
 const p=Object.fromEntries(PICKS.map(k=>[k,Number(m.probabilities?.[k])]));
 if(PICKS.some(k=>!Number.isFinite(p[k])||p[k]<0||p[k]>1))return null;
 const sum=p['1']+p.X+p['2'];
 if(Math.abs(sum-1)>.035)return null;
 for(const k of PICKS)p[k]/=sum;
 const pick=PICKS.reduce((a,b)=>p[b]>p[a]?b:a,'1');
 const odds=Object.fromEntries(PICKS.map(k=>[k,Number(m.odds?.[k])]));
 const hasOdds=PICKS.every(k=>Number.isFinite(odds[k])&&odds[k]>1.01&&odds[k]<=150);
 return {
  id:String(m.id||m.league+'_'+m.home+'_'+m.away+'_'+kickoff),
  league:m.league,home:String(m.home),away:String(m.away),
  kickoff:new Date(kickoff).toISOString(),pick,probabilities:p,probability:p[pick],
  price:hasOdds?odds[pick]:null,
  odds:hasOdds?odds:null,marketSource:hasOdds?String(m.bookmaker||'datový poskytovatel'):null,
  xgHome:Number.isFinite(Number(m.xgHome))?Number(m.xgHome):null,
  xgAway:Number.isFinite(Number(m.xgAway))?Number(m.xgAway):null,
  explanation:String(m.explanation||'Model založený na dostupných statistikách'),
  modelVerified:m.modelVerified===true
 };
}
function fold(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function independent(a,b){
 if(a.id===b.id)return false;
 if(a.league!==b.league)return true;
 const names=new Set([fold(a.home),fold(a.away)]);
 return !names.has(fold(b.home))&&!names.has(fold(b.away));
}
function combinations(n,k){
 const result=[];
 function grow(prefix,start){
  if(prefix.length===k){result.push(prefix);return;}
  for(let i=start;i<=n-(k-prefix.length);i++)grow([...prefix,i],i+1);
 }
 grow([],0);
 return result;
}
function rowsOf(type,n){
 const whole=Array.from({length:n},(_,i)=>i);
 if(type==='solo')return [[0]];
 if(type==='ako')return [whole];
 if(type==='kombi')return combinations(n,Math.max(2,n-1));
 if(type==='maxikombi'){
  // A simple Maxikombi variant: all double rows plus the full accumulator
  // for three picks, or doubles, trebles and fourfold for four picks.
  return Array.from({length:n-1},(_,i)=>combinations(n,i+2)).flat();
 }
 return [];
}
function modelOutcome(legs,rows,stake){
 const total=Math.pow(2,legs.length);
 let chanceAtLeastOne=0,chanceOfProfit=0,expectedPayout=0;
 const hasPrices=legs.every(x=>x.price!==null);
 const perRow=stake/rows.length;
 for(let mask=0;mask<total;mask++){
  let scenario=1;
  for(let i=0;i<legs.length;i++){
   const correct=Boolean(mask&(1<<i));
   scenario*=correct?legs[i].probability:1-legs[i].probability;
  }
  let winningRows=0,payout=0;
  for(const row of rows){
   if(row.every(i=>Boolean(mask&(1<<i)))){
    winningRows++;
    if(hasPrices)payout+=perRow*row.reduce((v,i)=>v*legs[i].price,1);
   }
  }
  if(winningRows)chanceAtLeastOne+=scenario;
  if(hasPrices){
   expectedPayout+=scenario*payout;
   if(payout>stake+1e-9)chanceOfProfit+=scenario;
  }
 }
 return {chanceAtLeastOne:clamp(chanceAtLeastOne,0,1),
  chanceOfProfit:hasPrices?clamp(chanceOfProfit,0,1):null,
  expectedPayout:hasPrices?expectedPayout:null,
  expectedNet:hasPrices?expectedPayout-stake:null,
  hasPrices,stakePerRow:perRow};
}
function buildTicket(type,legs,stake){
 const rows=rowsOf(type,legs.length);
 if(!rows.length)return null;
 const result=modelOutcome(legs,rows,stake);
 const letter=i=>String.fromCharCode(65+i);
 const unitRows=rows.map(indexes=>({
  keys:indexes.map(letter),
  description:indexes.map(letter).join(' + '),
  probability:indexes.reduce((p,i)=>p*legs[i].probability,1),
  odds:result.hasPrices?indexes.reduce((p,i)=>p*legs[i].price,1):null,
  potentialPayout:result.hasPrices?result.stakePerRow*indexes.reduce((p,i)=>p*legs[i].price,1):null
 }));
 return {
  id:type+':'+legs.map(x=>x.id+':'+x.pick).join('|'),
  type,legs,rows:unitRows,legCount:legs.length,lineCount:rows.length,
  stake,totalStake:stake,stakePerRow:result.stakePerRow,
  chanceAtLeastOne:result.chanceAtLeastOne,
  chanceOfProfit:result.chanceOfProfit,
  expectedPayout:result.expectedPayout,expectedNet:result.expectedNet,
  hasPrices:result.hasPrices,
  confidenceWarning:legs.some(x=>!x.modelVerified),
  label:type==='solo'?'SOLO':type==='ako'?'AKO '+legs.length:
   type==='kombi'?'KOMBI '+(legs.length-1)+'/'+legs.length:'MAXIKOMBI '+legs.length,
  // Without validated bookmaking prices, a multi-line system is not
  // labelled better simply because it has many chances to win *something*.
  rankingScore:result.hasPrices?
    (result.expectedNet/stake)*.55+(result.chanceOfProfit??0)*.45-.025*(legs.length-1):
    result.chanceAtLeastOne-.105*(legs.length-1)-.055*Math.log2(rows.length)
 };
}
export function buildModelTicketSuggestions(fixtures,{now=Date.now(),stake=20,maxMatches=4}={}){
 const timestamp=toMillis(now);
 if(!Number.isFinite(timestamp))throw Error('Neplatný čas sestavení tiketů');
 const amount=Number(stake);
 if(!Number.isFinite(amount)||amount<=0)throw Error('Vklad musí být kladný');
 const available=(fixtures||[]).map(f=>validFixture(f,timestamp)).filter(Boolean);
 const seen=new Set();
 const ranked=available.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;})
  .sort((a,b)=>(b.probability-a.probability)||(Date.parse(a.kickoff)-Date.parse(b.kickoff)))
  .slice(0,18);
 const limit=clamp(Number(maxMatches)||4,1,4);
 const pool=ranked.slice(0,9);
 const tickets=[];
 function append(type,legs){
  if(legs.some((v,i)=>legs.slice(0,i).some(w=>!independent(v,w))))return;
  const t=buildTicket(type,legs,amount);
  if(t)tickets.push(t);
 }
 for(const f of pool)append('solo',[f]);
 for(let k=2;k<=limit;k++){
  for(const idxs of combinations(pool.length,k)){
   const legs=idxs.map(i=>pool[i]);
   append('ako',legs);
   if(k>=3){append('kombi',legs);append('maxikombi',legs);}
  }
 }
 tickets.sort((a,b)=>b.rankingScore-a.rankingScore||
   a.legCount-b.legCount||b.chanceAtLeastOne-a.chanceAtLeastOne);
 // At least one option for each ticket family is shown, alongside top-rated
 // options; this is a comparison, not a guarantee of positive returns.
 const kept=[],groups=new Set();
 for(const t of tickets){
  if(groups.has(t.type))continue;
  groups.add(t.type);kept.push(t);
 }
 for(const t of tickets){
  if(kept.length>=10)break;
  if(!kept.some(x=>x.id===t.id))kept.push(t);
 }
 kept.sort((a,b)=>b.rankingScore-a.rankingScore);
 const best=tickets[0]||null;
 return {
  fixturesRead:(fixtures||[]).length,fixturesEligible:available.length,
  matchesConsidered:ranked.length,hasMarketPrices:Boolean(best?.hasPrices),
  recommended:best,alternatives:kept,
  basis:best?.hasPrices?'modelové očekávané výnosy a pravděpodobnost čistého zisku':
   'pravděpodobnosti předpovědí a penalizace počtu řádků; finanční výhodnost bez ověřených kurzů neznáme',
  caveat:'Odhady mohou být špatně kalibrované. U systémového tiketu alespoň jeden výherní řádek nezaručuje čistý zisk.'
 };
}
