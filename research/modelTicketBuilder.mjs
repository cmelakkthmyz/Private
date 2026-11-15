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
  xgHome:m.xgHome!=null&&Number.isFinite(Number(m.xgHome))?Number(m.xgHome):null,
  xgAway:m.xgAway!=null&&Number.isFinite(Number(m.xgAway))?Number(m.xgAway):null,
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
  // Legacy two-to-four fixture mode kept for compatibility with older drafts.
  // Five or more fixtures use real grouped MAXIKOMBI in buildTicket.
  const minimum=n<=4?2:Math.max(3,n-2);
  return Array.from({length:n-minimum+1},(_,i)=>combinations(n,minimum+i)).flat();
 }
 return [];
}
function modelOutcome(legs,rows,stake){
 const n=legs.length;
 const hasPrices=legs.every(x=>x.price!==null);
 const perRow=stake/rows.length;
 const minRowLength=Math.min(...rows.map(row=>row.length));
 let chanceAtLeastOne=0,chanceOfProfit=0,expectedPayout=0;
 // A row can win only when the total missed picks is at most n-minRowLength.
 // For systems with 20 legs this means enumerating at most 211 failure sets,
 // rather than 2^20 outcomes multiplied by all possible ticket lines.
 for(let failedCount=0;failedCount<=n-minRowLength;failedCount++){
  for(const failed of combinations(n,failedCount)){
   const missed=new Set(failed);
   let scenario=1;
   for(let i=0;i<n;i++)scenario*=missed.has(i)?1-legs[i].probability:legs[i].probability;
   if(scenario<=0)continue;
   let winning=0,payout=0;
   for(const row of rows){
    if(row.some(index=>missed.has(index)))continue;
    winning++;
    if(hasPrices)payout+=perRow*row.reduce((v,index)=>v*legs[index].price,1);
   }
   if(winning)chanceAtLeastOne+=scenario;
   if(hasPrices&&payout>stake+1e-9)chanceOfProfit+=scenario;
  }
 }
 if(hasPrices){
  // Expectation by linearity: sum of (probability of row x its payout).
  expectedPayout=rows.reduce((sum,row)=>sum+
   perRow*row.reduce((p,i)=>p*legs[i].probability*legs[i].price,1),0);
 }
 return {chanceAtLeastOne:clamp(chanceAtLeastOne,0,1),
  chanceOfProfit:hasPrices?clamp(chanceOfProfit,0,1):null,
  expectedPayout:hasPrices?expectedPayout:null,
  expectedNet:hasPrices?expectedPayout-stake:null,
  hasPrices,stakePerRow:perRow};
}
function buildTicket(type,legs,stake,minRowStake=0){
 let groups=null,calcLegs=legs,rows;
 if(type==='maxikombi'&&legs.length>=5){
  // Genuine MAXIKOMBI structure: each group of 2+ selections becomes
  // one system opportunity. Group odds/probabilities multiply within it.
  // 20 individual matches become four groups of five, not 2^20 bet lines.
  const groupCount=Math.min(4,Math.max(2,Math.floor(legs.length/3)));
  const buckets=Array.from({length:groupCount},()=>[]);
  legs.forEach((_,i)=>buckets[i%groupCount].push(i));
  groups=buckets.map((indexes,i)=>({
   name:String.fromCharCode(65+i),indexes,
   probability:indexes.reduce((p,j)=>p*legs[j].probability,1),
   price:indexes.every(j=>legs[j].price!==null)?
    indexes.reduce((p,j)=>p*legs[j].price,1):null
  }));
  calcLegs=groups;
  // Model the selectable singles and accumulator combinations of groups.
  // Users can reproduce these rows as a grouped Kombinátor/Maxikombi.
  rows=Array.from({length:groupCount},(_,i)=>combinations(groupCount,i+1)).flat();
 }else rows=rowsOf(type,legs.length);
 if(!rows.length||stake/rows.length<minRowStake)return null;
 const result=modelOutcome(calcLegs,rows,stake);
 const letter=i=>String.fromCharCode(65+i);
 const unitRows=rows.map(indexes=>({
  keys:indexes.map(letter),
  description:indexes.map(letter).join(' + '),
  matchIndexes:groups?indexes.flatMap(i=>groups[i].indexes):indexes.slice(),
  probability:indexes.reduce((p,i)=>p*calcLegs[i].probability,1),
  odds:result.hasPrices?indexes.reduce((p,i)=>p*calcLegs[i].price,1):null,
  potentialPayout:result.hasPrices?result.stakePerRow*indexes.reduce((p,i)=>p*calcLegs[i].price,1):null
 }));
 return {
  id:type+':'+legs.map(x=>x.id+':'+x.pick).join('|'),
  type,legs,groups,rows:unitRows,legCount:legs.length,lineCount:rows.length,
  stake,totalStake:stake,stakePerRow:result.stakePerRow,
  chanceAtLeastOne:result.chanceAtLeastOne,
  chanceOfProfit:result.chanceOfProfit,
  expectedPayout:result.expectedPayout,expectedNet:result.expectedNet,
  hasPrices:result.hasPrices,
  confidenceWarning:legs.some(x=>!x.modelVerified),
  label:type==='solo'?'SOLO':type==='ako'?'AKU '+legs.length:
   type==='kombi'?'KOMBI '+(legs.length-1)+'/'+legs.length:
   groups?'MAXIKOMBI '+legs.length+' ('+groups.length+' skupiny)':
   'MAXIKOMBI '+legs.length,
  rankingScore:result.hasPrices?
    Math.tanh(result.expectedNet/stake)*.35+(result.chanceOfProfit??0)*.5+
    result.chanceAtLeastOne*.15-.002*(legs.length-1):
    result.chanceAtLeastOne-.045*(legs.length-1)-.03*Math.log2(rows.length)
 };
}
// Min/max are inclusive. "Max" never means "exactly N" and never silently
// overrides the chosen minimum. A reroll explores different independent fixtures.
export function buildModelTicketSuggestions(fixtures,{
 now=Date.now(),stake=20,minMatches=1,maxMatches=4,
 requirePrices=false,minEdge=0,minRowStake=0,generationIndex=0
}={}){
 const timestamp=toMillis(now);
 if(!Number.isFinite(timestamp))throw Error('Neplatný čas sestavení tiketů');
 const amount=Number(stake);
 if(!Number.isFinite(amount)||amount<=0)throw Error('Vklad musí být kladný');
 const lower=clamp(Math.trunc(Number(minMatches)||1),1,20);
 const upper=clamp(Math.trunc(Number(maxMatches)||4),1,20);
 if(lower>upper)throw Error('Minimální počet zápasů převyšuje maximum');
 const available=(fixtures||[]).map(f=>validFixture(f,timestamp)).filter(Boolean);
 const seen=new Set();
 const unique=available.filter(x=>{
  const key=x.league+':'+x.id;
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
 const withPrices=unique.filter(x=>x.price!==null);
 // A quote alone is not value. Positive expected return is only a MODEL claim:
 // no historical calibration / live bookmaker guarantee is implied.
 const eligible=requirePrices?withPrices.filter(x=>
  x.probability*x.price-1>=Number(minEdge||0)):unique;
 const ranked=eligible.sort((a,b)=>{
  const score=x=>requirePrices?
   (x.probability*x.price-1)*.8+x.probability*.2:
   x.probability;
  return score(b)-score(a)||Date.parse(a.kickoff)-Date.parse(b.kickoff);
 }).slice(0,40);
 const pool=ranked.slice(0,Math.min(40,Math.max(24,upper+8)));
 const tickets=[];
 const made=new Set();
 const reroll=clamp(Math.trunc(Number(generationIndex)||0),0,100000);
 function chooseLegs(k,variant){
  if(k>pool.length)return null;
  // Rotate one of the stronger fixtures out for the next real candidate.
  // Unlike the old button, subsequent generations can change the match set.
  const excluded=pool.length===k||variant===0&&reroll===0?-1:(k-1-((variant+reroll-1)%k));
  const picked=[];
  for(let i=0;i<pool.length&&picked.length<k;i++){
   if(i===excluded)continue;
   const candidate=pool[i];
   if(picked.every(existing=>independent(existing,candidate)))picked.push(candidate);
  }
  return picked.length===k?picked:null;
 }
 function append(type,legs){
  if(type==='solo'&&legs.length!==1)return;
  const t=buildTicket(type,legs,amount,Number(minRowStake)||0);
  if(t&&!made.has(t.id)){made.add(t.id);tickets.push(t);}
 }
 if(lower===1&&pool.length)append('solo',[pool[Math.min(reroll%pool.length,pool.length-1)]]);
 for(let k=Math.max(2,lower);k<=Math.min(upper,pool.length);k++){
  for(let variant=0;variant<Math.min(4,pool.length-k+1);variant++){
   const legs=chooseLegs(k,variant);
   if(!legs)continue;
   append('ako',legs);
   if(k>=3){append('kombi',legs);append('maxikombi',legs);}
  }
 }
 tickets.sort((a,b)=>b.rankingScore-a.rankingScore||
  b.chanceOfProfit-a.chanceOfProfit||a.legCount-b.legCount);
 // Preserve at least one ticket for every feasible leg count and family,
 // including twenty matches, even when shorter slips rank higher.
 const kept=[],groups=new Set();
 for(const t of tickets){
  const group=t.type+':'+t.legCount;
  if(groups.has(group))continue;
  groups.add(group);kept.push(t);
 }
 const saved=new Set(kept.map(t=>t.id));
 for(const t of tickets){
  if(kept.length>=240)break;
  if(!saved.has(t.id)){kept.push(t);saved.add(t.id);}
 }
 kept.sort((a,b)=>b.rankingScore-a.rankingScore);
 const best=tickets[0]||null;
 const whyNoTickets=requirePrices?
  withPrices.length===0?'Chybí čerstvé ověřitelné kurzy. Bez nich nelze určit výhodný tiket.':
  eligible.length<lower?'Pouze '+eligible.length+' z '+withPrices.length+
   ' zápasů s kurzem splňuje požadovanou modelovou hodnotu; minimum je '+lower+'.':
  'Nelze sestavit '+lower+' až '+upper+
   ' nezávislých tipů v rámci rozpočtu a počtu řádků.':
  'Není dost budoucích nezávislých zápasů pro zadaný rozsah.';
 return {
  fixturesRead:(fixtures||[]).length,fixturesEligible:available.length,
  matchesConsidered:ranked.length,pricedMatches:withPrices.length,
  valueMatches:eligible.length,hasMarketPrices:Boolean(best?.hasPrices),
  recommended:best,alternatives:kept,reason:best?null:whyNoTickets,
  basis:requirePrices?
   'předběžná modelová hodnota podle dostupných kurzů, bez záruky zisku a bez ověření kalibrace modelu':
   'pravděpodobnosti předpovědí; finanční výhodnost bez kurzů neznáme',
  caveat:'Modelový kladný očekávaný výnos není důkaz skutečné výhodnosti. Odhady a kurzy se mohou měnit. Zisk nelze zaručit.'
 };
}
