// Auto Odds Scan V2. No user-entered odds, no bookmaker credentials, no bet placement.
// Every offered market must be linked to a verified scheduled match before scoring.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/&/g,' and ').replace(/[^a-z0-9]/g,' ').replace(/\b(fc|afc|hc|fk|sk|ac|bk)\b/g,' ')
 .replace(/\s+/g,' ').trim();
const aliases={
 'man city':'manchester city','man united':'manchester united','man utd':'manchester united',
 'manchester utd':'manchester united',
 'spurs':'tottenham hotspur','tottenham':'tottenham hotspur','newcastle':'newcastle united',
 'wolves':'wolverhampton wanderers','nottm forest':'nottingham forest',
 'west ham':'west ham united','brighton hove albion':'brighton',
 'brighton and hove albion':'brighton','bournemouth':'bournemouth',
 'sparta prague':'sparta praha','slavia prague':'slavia praha',
 'viktoria plzen':'viktoria plzen','slovan liberec':'slovan liberec',
 'bohemians 1905':'bohemians praha 1905','artis brno':'artis brno',
 'dukla prague':'dukla praha','banik ostrava':'banik ostrava',
 'olomouc':'olomouc','kometa brno':'kometa brno',
 'pardubice':'pardubice','dynamo pardubice':'pardubice',
 'ocelari trinec':'trinec','trinec':'trinec',
 'bili tygri liberec':'liberec','liberec':'liberec',
 'rytriri kladno':'kladno','rytiri kladno':'kladno',
 'motor ceske budejovice':'ceske budejovice',
 'energie karlovy vary':'karlovy vary',
 'skoda plzen':'plzen','sparta praha':'sparta praha',
 'mountfield hk':'hradec kralove','verva litvinov':'litvinov',
 'vitkovice ridera':'vitkovice'
};
export function normClub(s){const k=fold(s);return aliases[k]||k;}
export function normalizeOffer(input){
 const league=['pl','cz','hockey'].includes(input?.league)?input.league:null;
 const kickoff=Date.parse(input?.kickoff||'');
 if(!league||!Number.isFinite(kickoff)||!input.home||!input.away)return null;
 const prices=Object.fromEntries(['1','X','2'].map(k=>[k,Number(input.odds?.[k])]));
 if(Object.values(prices).some(x=>!Number.isFinite(x)||x<=1.01||x>150))return null;
 if(normClub(input.home)===normClub(input.away))return null;
 return {...input,league,kickoff:new Date(kickoff).toISOString(),odds:prices};
}
export function matchOffer(offer,fixtures,now=new Date()){
 const o=normalizeOffer(offer);if(!o)return null;
 const timestamp=Date.parse(o.kickoff),nowMs=new Date(now).getTime();
 if(!Number.isFinite(nowMs)||timestamp<=nowMs+60000||timestamp>nowMs+8*86400000)return null;
 const hits=(fixtures||[]).filter(f=>{
  if(f.league!==o.league||f.status==='finished')return false;
  const at=Date.parse(f.kickoff);if(!Number.isFinite(at)||Math.abs(at-timestamp)>90*60000)return false;
  return normClub(f.home)===normClub(o.home)&&normClub(f.away)===normClub(o.away);
 });
 return hits.length===1?{offer:o,fixture:hits[0]}:null;
}
function probabilityMarket(prices){
 const inv=Object.fromEntries(['1','X','2'].map(k=>[k,1/prices[k]]));
 const total=inv['1']+inv.X+inv['2'];
 if(!Number.isFinite(total)||total<.88||total>1.4)return null;
 return {fair:{'1':inv['1']/total,X:inv.X/total,'2':inv['2']/total},
   overround:total-1};
}
export function evaluateOffer(matched,{minimumModelProbability=.10}={}){
 if(!matched?.offer||!matched.fixture?.probabilities)return null;
 const odds=matched.offer.odds,market=probabilityMarket(odds);
 if(!market)return null;
 const raw=matched.fixture.probabilities;
 if(['1','X','2'].some(k=>!Number.isFinite(Number(raw[k]))||raw[k]<0||raw[k]>1))return null;
 const sum=Number(raw['1'])+Number(raw.X)+Number(raw['2']);
 if(Math.abs(sum-1)>.015)return null;
 const options=['1','X','2'].map(pick=>{
   const p=Number(raw[pick])/sum,price=odds[pick];
   const marketP=market.fair[pick],edge=p-marketP;
   // 1x2 performance depends on calibration. Apply conservative 5-10pp penalty,
   // stronger for speculative long odds, rather than labelling raw p*odds positive as a sure edge.
   const modelUncertainty=clamp(.045+(price>3?Math.log(price/3)*.023:0),.045,.115);
   const lowP=Math.max(0,p-modelUncertainty);
   const rawEV=p*price-1,conservativeEV=lowP*price-1;
   return {matchId:matched.fixture.id,league:matched.offer.league,
     home:matched.fixture.home,away:matched.fixture.away,kickoff:matched.fixture.kickoff,
     pick,p,marketP,edge,odds:price,rawEV,lowP,conservativeEV,
     bookmaker:matched.offer.bookmaker||'Tipsport',
     sourceUrl:matched.offer.sourceUrl,offeredAt:matched.offer.fetchedAt,
     marketOverround:market.overround,
     modelVerified:matched.fixture.modelVerified===true};
 }).filter(x=>x.p>=minimumModelProbability&&x.odds>=1.15);
 return {matched,market,options};
}
function independent(a,b){
 if(a.matchId===b.matchId)return false;
 if(a.league===b.league){
  const clubs1=new Set([normClub(a.home),normClub(a.away)]);
  if(clubs1.has(normClub(b.home))||clubs1.has(normClub(b.away)))return false;
 }
 return true;
}
const product=(xs,fn)=>xs.reduce((s,x)=>s*fn(x),1);
function summarizeCombo(legs,stake,profile){
 const p=product(legs,x=>x.p),lowerBound=product(legs,x=>x.lowP);
 const odds=product(legs,x=>x.odds),nominalEV=p*odds-1,conservativeEV=lowerBound*odds-1;
 const payout=odds*stake,expectedReturn=nominalEV*stake;
 const under=legs.some(x=>!x.modelVerified);
 return {id:legs.map(x=>x.matchId+':'+x.pick).join('|'),legs,
  p,lowerBound,odds,stake,payout,nominalEV,conservativeEV,
  expectedReturn,profile,unverified:under,guaranteed:false};
}
const PROFILES={
 balanced:{count:2,minOdds:1.65,maxOdds:15,requiredDraw:0},
 longshot:{count:3,minOdds:8,maxOdds:450,requiredDraw:0},
 draws:{count:2,minOdds:4,maxOdds:140,requiredDraw:1}
};
export function buildAutoTickets(matchedOffers,{stake=20,profile='balanced',maxTickets=4,now=Date.now()}={}){
 if(!PROFILES[profile])throw Error('Neznámý režim výběru.');
 const option=PROFILES[profile],evaluated=(matchedOffers||[]).map(x=>evaluateOffer(x)).filter(Boolean);
 const offers=matchedOffers?.length||0;
 const choices=evaluated.flatMap(x=>x.options)
 .filter(x=>x.p>=.12&&x.odds<=60&&x.kickoff&&Date.parse(x.kickoff)>now)
 .sort((a,b)=>(b.conservativeEV-a.conservativeEV)||(b.p-a.p)).slice(0,35);
 const tickets=[],stakes=clamp(Number(stake)||20,10,1000);
 for(let i=0;i<choices.length;i++){
  for(let j=i+1;j<choices.length;j++){
   const a=choices[i],b=choices[j];
   if(!independent(a,b))continue;
   const two=[a,b];
   if(option.count===2){push(two);continue;}
   for(let k=j+1;k<choices.length;k++){
    if(!independent(a,choices[k])||!independent(b,choices[k]))continue;
    push([a,b,choices[k]]);
   }
  }
 }
 function push(legs){
   if(legs.filter(x=>x.pick==='X').length<option.requiredDraw)return;
   const combo=summarizeCombo(legs,stakes,profile);
   if(combo.odds<option.minOdds||combo.odds>option.maxOdds)return;
   // Never describe a combination as mathematically advantageous when even
   // an intentionally pessimistic model fails to suggest positive value.
   const lowerCut=combo.unverified ? .25 : .03;
   if(combo.conservativeEV<=lowerCut)return;
   tickets.push(combo);
 }
 // Prefer lower-risk among plausible positive-conservative-value combos;
 // longshots still penalized for very small win probability.
 tickets.sort((a,b)=>
  (b.lowerBound*Math.log1p(b.odds)+b.conservativeEV*.14)
 -(a.lowerBound*Math.log1p(a.odds)+a.conservativeEV*.14));
 const uniq=new Set(),selected=[];
 for(const ticket of tickets){
   if(uniq.has(ticket.id))continue;uniq.add(ticket.id);
   selected.push(ticket);
   if(selected.length>=maxTickets)break;
 }
 return {profile,scanned:offers,modelled:evaluated.length,considered:choices.length,
   selected,stake:stakes,profiles:PROFILES,
   note:selected.length?'Teoretické předzápasové odhady, bez prokázané dlouhodobé výhody.':'Žádná kombinace neprošla konzervativním hodnocením; nevymýšlím výhodný tiket.'};
}
export const AUTO_TICKET_PROFILES=PROFILES;
