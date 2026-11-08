// Immutable no-money paper tickets, verified 1/X/2 settlement, and audit trail.
// Ticket snapshots are captured strictly BEFORE the games begin. No fantasy stake
// is ever sent to a bookmaker. A missing result leaves the ticket pending.
import {buildAutoTickets,evaluateOffer,normClub} from './autoOddsScanner.mjs';

const OUTCOMES=['1','X','2'];
const DAY=86400000;
const validDate=s=>Number.isFinite(Date.parse(s||''));
const round=(n,d=4)=>Number(n.toFixed(d));
const outcome=(h,a)=>h>a?'1':h===a?'X':'2';
const cap=(v,min,max)=>Math.min(max,Math.max(min,v));
const num=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
export function emptyPaperLedger(){
 return {version:1,tickets:[],createdAt:new Date().toISOString()};
}
export function checkPaperLedger(ledger){
 if(!ledger||ledger.version!==1||!Array.isArray(ledger.tickets)||ledger.tickets.length>400)
  throw Error('Poškozený archiv papírových tiketů.');
}
function independent(a,b){
 if(a.matchId===b.matchId)return false;
 if(a.league===b.league) {
  const teams=new Set([normClub(a.home),normClub(a.away)]);
  if(teams.has(normClub(b.home))||teams.has(normClub(b.away)))return false;
 }
 return true;
}
export function proposePaperTicket(matchedOffers,{stake=20,profile='balanced',now=Date.now()}={}){
 const rated=buildAutoTickets(matchedOffers,{stake,profile,maxTickets:5,now});
 if(rated.selected.length) return {...rated.selected[0],experimental:false,
  note:'Model navrhl kombinaci; budoucí výhoda není prokázaná.'};
 // For observational learning only, allow a transparent test even when no bet has
 // a defensible positive value. Never present it as "výhodný tiket".
 const minimum=profile==='longshot'?3:2;
 const candidates=(matchedOffers||[]).flatMap(pair=>evaluateOffer(pair)?.options||[])
  .filter(x=>OUTCOMES.includes(x.pick)&&Number.isFinite(x.p)&&x.p>.06&&
   Number.isFinite(x.odds)&&x.odds>1.02&&x.odds<100&&
   validDate(x.kickoff)&&Date.parse(x.kickoff)>now+10*60000)
  .sort((a,b)=>b.p-a.p || b.conservativeEV-a.conservativeEV)
  .slice(0,48);
 const selected=[],drawRequired=profile==='draws';
 if(drawRequired){
  const draw=candidates.find(x=>x.pick==='X');
  if(draw)selected.push(draw);
 }
 for(const cand of candidates){
  if(selected.length>=minimum)break;
  if(selected.every(existing=>independent(existing,cand)))selected.push(cand);
 }
 if(selected.length<minimum)return null;
 const combinedOdds=selected.reduce((v,x)=>v*x.odds,1),
  probability=selected.reduce((v,x)=>v*x.p,1),
  lowerBound=selected.reduce((v,x)=>v*x.lowP,1);
 const wager=cap(Number(stake)||20,10,1000);
 return {id:selected.map(x=>x.matchId+':'+x.pick).join('|'),legs:selected,
  p:probability,lowerBound,odds:combinedOdds,stake:wager,payout:wager*combinedOdds,
  nominalEV:probability*combinedOdds-1,conservativeEV:lowerBound*combinedOdds-1,
  expectedReturn:(probability*combinedOdds-1)*wager,profile,
  unverified:selected.some(x=>!x.modelVerified),
  guaranteed:false,experimental:true,
  note:'Čistě experimentální kombinace na ověření modelu; neprošla testem výhodnosti.'};
}
export function placePaperTicket(ledger,proposal,{createdAt=new Date().toISOString(),source='public bookmaker snapshot'}={}){
 checkPaperLedger(ledger);
 const when=Date.parse(createdAt);
 if(!Number.isFinite(when)||!proposal||!Array.isArray(proposal.legs)||proposal.legs.length<2||proposal.legs.length>3)
  throw Error('Neplatná simulovaná sázka.');
 if(!Number.isFinite(proposal.stake)||proposal.stake<10||proposal.stake>1000)
  throw Error('Neplatný modelový vklad.');
 const legs=proposal.legs.map(l=>{
  if(!l.matchId||!l.league||!['pl','cz','hockey'].includes(l.league)||
   !l.home||!l.away||!OUTCOMES.includes(l.pick)||
   !Number.isFinite(l.odds)||l.odds<=1.01||!Number.isFinite(l.p)||l.p<=0||l.p>=1||
   !validDate(l.kickoff)||Date.parse(l.kickoff)<=when+60_000)
   throw Error('Zápas není doložen platným kurzem před výkopem.');
  const retrieved=l.offeredAt?Date.parse(l.offeredAt):NaN;
  if(!Number.isFinite(retrieved)||retrieved>when+60_000||
   when-retrieved>14*3600_000)throw Error('Kurz není současný. Obnov nabídku.');
  if(!l.sourceUrl||!/^https:\/\//.test(l.sourceUrl))
   throw Error('Není doložen veřejný zdroj kurzu.');
  return Object.freeze({matchId:String(l.matchId),league:l.league,home:l.home,away:l.away,
   kickoff:l.kickoff,pick:l.pick,odds:l.odds,modelProbability:l.p,
   bookmaker:l.bookmaker||'public odds',sourceUrl:l.sourceUrl,offeredAt:l.offeredAt,
   status:'pending',result:null});
 });
 if(!legs.every((x,i)=>legs.every((y,j)=>i===j||independent(x,y))))
  throw Error('Duplicitní nebo závislá utkání na jednom tiketu.');
 const ticketId=legs.map(l=>l.matchId+'|'+l.pick).sort().join('::');
 if(ledger.tickets.some(t=>t.id===ticketId))return {saved:false,reason:'Tento tiket už je uložen.',ticket:ledger.tickets.find(t=>t.id===ticketId)};
 const odds=legs.reduce((v,l)=>v*l.odds,1);
 const ticket={
  id:ticketId,createdAt,source,profile:proposal.profile||'balanced',
  stake:proposal.stake,odds:round(odds,5),modelProbability:round(legs.reduce((v,l)=>v*l.modelProbability,1),7),
  experimental:proposal.experimental===true,
  legs, status:'pending',payout:null,net:null,settledAt:null
 };
 ledger.tickets.unshift(ticket);
 return {saved:true,ticket};
}
function sameGame(leg,result){
 if(result.league!==leg.league ||result.status!=='finished')return false;
 // Football's ID must match; hockey sportsbook ID differs from hokej.cz ID.
 if(leg.league!=='hockey')return String(result.matchId)===String(leg.matchId);
 if(!validDate(result.kickoff)||!validDate(leg.kickoff))return false;
 const diff=Math.abs(Date.parse(result.kickoff)-Date.parse(leg.kickoff));
 if(diff>4*3600_000)return false;
 return normClub(result.home)===normClub(leg.home)&&normClub(result.away)===normClub(leg.away);
}
function verifiedResult(result){
 if(!result||!['pl','cz','hockey'].includes(result.league)||result.status!=='finished'||
  !result.source||!result.observedAt||!validDate(result.observedAt)||
  !Number.isInteger(result.homeScore)||!Number.isInteger(result.awayScore)||
  result.homeScore<0||result.awayScore<0||result.homeScore>40||result.awayScore>40)return false;
 if(result.league==='hockey'){
  // Hockey 1/X/2 is the score at 60:00 ONLY, not final score after overtime.
  if(result.market!=='1X2_60_MINUTES'||result.periodsVerified!==true)return false;
 }else if(result.market!=='1X2_90_MINUTES')return false;
 return true;
}
export function settlePaperTickets(ledger,results,{asOf=new Date().toISOString()}={}){
 checkPaperLedger(ledger);
 if(!validDate(asOf))throw Error('Neplatné datum kontroly.');
 const now=Date.parse(asOf),newlySettled=[],newlyVerifiedLegs=[],missing=new Set();
 for(const ticket of ledger.tickets){
  for(const leg of ticket.legs){
   if(leg.status!=='pending')continue;
   const kickoff=Date.parse(leg.kickoff);
   if(now<kickoff+(leg.league==='hockey'?115:105)*60_000)continue;
   const matches=(results||[]).filter(x=>sameGame(leg,x)&&verifiedResult(x));
   // Ambiguous providers or duplicate games: never guess final outcome.
   if(matches.length!==1){missing.add(leg.league);continue;}
   const result=matches[0],observed=Date.parse(result.observedAt);
   if(observed<=kickoff ||observed>now+60_000)continue;
   const actual=outcome(result.homeScore,result.awayScore);
   leg.status=leg.pick===actual?'won':'lost';
   leg.result={homeScore:result.homeScore,awayScore:result.awayScore,actual,
    source:result.source,sourceId:result.sourceId||null,
    observedAt:result.observedAt,market:result.market};
   newlyVerifiedLegs.push({matchId:leg.matchId,league:leg.league,home:leg.home,away:leg.away,
    kickoff:leg.kickoff,homeScore:result.homeScore,awayScore:result.awayScore,
    source:result.source,sourceId:result.sourceId||null});
  }
  if(ticket.status!=='pending')continue;
  if(ticket.legs.some(l=>l.status==='lost')){
   ticket.status='lost';ticket.payout=0;ticket.net=-ticket.stake;ticket.settledAt=asOf;
   newlySettled.push(ticket.id);
  }else if(ticket.legs.every(l=>l.status==='won')){
   ticket.status='won';ticket.payout=round(ticket.stake*ticket.odds,2);
   ticket.net=round(ticket.payout-ticket.stake,2);ticket.settledAt=asOf;
   newlySettled.push(ticket.id);
  }
 }
 return {newlySettled,newlyVerifiedLegs,waitingFor:[...missing],summary:paperSummary(ledger)};
}
export function paperSummary(ledger){
 checkPaperLedger(ledger);
 const won=ledger.tickets.filter(t=>t.status==='won'),lost=ledger.tickets.filter(t=>t.status==='lost');
 const completed=[...won,...lost];
 const stake=completed.reduce((s,t)=>s+t.stake,0);
 const profit=completed.reduce((s,t)=>s+t.net,0);
 return {total:ledger.tickets.length,pending:ledger.tickets.filter(t=>t.status==='pending').length,
  won:won.length,lost:lost.length,settled:completed.length,
  staked:round(stake,2),payout:round(completed.reduce((s,t)=>s+t.payout,0),2),
  net:round(profit,2),roi:stake>0?round(profit/stake,5):null,
  hitRate:completed.length?round(won.length/completed.length,5):null};
}
