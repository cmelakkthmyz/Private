import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPaperLedger,placePaperTicket,settlePaperTickets,paperSummary,proposePaperTicket} from './paperSimulation.mjs';
import {matchOffer} from './autoOddsScanner.mjs';

const base=Date.parse('2026-11-08T09:00:00Z');
const offeredAt=new Date(base).toISOString();
const date=new Date(base+5*3600000).toISOString();
const fixture=(id,home,away,league='pl')=>({
 id,league,home,away,kickoff:date,status:'scheduled',modelVerified:false,
 probabilities:{'1':.52,X:.29,'2':.19}
});
const offer=(id,home,away,league='pl')=>({
 id,league,home,away,kickoff:date,odds:{'1':2.4,X:3.4,'2':3.7},
 bookmaker:'Tipsport',sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html',
 fetchedAt:offeredAt
});
const matches=[
 matchOffer(offer('o1','Arsenal','Liverpool'),[fixture('pl-1','Arsenal','Liverpool')],base),
 matchOffer(offer('o2','Chelsea','Fulham'),[fixture('pl-2','Chelsea','Fulham')],base),
 matchOffer(offer('o3','Třinec','Pardubice','hockey'),[fixture('hk-1','Třinec','Pardubice','hockey')],base)
];
const create=()=>{
 const proposal=proposePaperTicket(matches,{now:base,stake:20,profile:'balanced'});
 const ledger=emptyPaperLedger();
 const out=placePaperTicket(ledger,proposal,{createdAt:offeredAt});
 assert.equal(out.saved,true);
 return {ledger,proposal,out};
};
const outcomeResult=(leg,homeScore,awayScore,observedAt=new Date(base+11*3600000).toISOString())=>({
 matchId:leg.matchId,league:leg.league,home:leg.home,away:leg.away,
 kickoff:leg.kickoff,status:'finished',homeScore,awayScore,
 market:leg.league==='hockey'?'1X2_60_MINUTES':'1X2_90_MINUTES',
 periodsVerified:leg.league==='hockey',observedAt,source:'Verified results'
});
const valuesForOutcome=(pick)=>pick==='1'?[2,1]:pick==='X'?[1,1]:[0,2];
test('automatic experimental paper ticket uses real pregame bookmaker snapshots',()=>{
 const {ledger,out}=create();
 assert.equal(ledger.tickets.length,1);
 assert.equal(out.ticket.status,'pending');
 assert.equal(paperSummary(ledger).settled,0);
 assert.ok(out.ticket.legs.every(l=>l.sourceUrl.startsWith('https:')));
});
test('never records anything as an actual bookmaker bet',()=>{
 const {ledger}=create();
 assert.ok(!('bookmakerAccount' in ledger));
 assert.ok(ledger.tickets[0].source);
 assert.ok(ledger.tickets[0].legs.every(l=>l.status==='pending'));
});
test('immutable, duplicate ticket is ignored',()=>{
 const {ledger,proposal}=create();
 const r=placePaperTicket(ledger,proposal,{createdAt:offeredAt});
 assert.equal(r.saved,false);
 assert.equal(ledger.tickets.length,1);
});
test('no tip can be retroactively placed after kickoff',()=>{
 const {ledger,proposal}=create();
 const midnight=new Date(base+7*3600000).toISOString();
 assert.throws(()=>placePaperTicket(ledger,proposal,{createdAt:midnight}),/před výkopem/);
});
test('stale odds cannot create an apparently verified ticket',()=>{
 const {proposal}=create(),ledger=emptyPaperLedger();
 assert.throws(()=>placePaperTicket(ledger,proposal,{createdAt:new Date(base+15*3600000).toISOString()}),/před výkopem|současný/);
});
test('no score before kick off or half time may settle paper result',()=>{
 const {ledger}=create();
 const legs=ledger.tickets[0].legs;
 const results=legs.map(l=>outcomeResult(l,...valuesForOutcome(l.pick)));
 const result=settlePaperTickets(ledger,results,{asOf:new Date(base+6*3600000).toISOString()});
 assert.equal(result.newlySettled.length,0);
 assert.equal(paperSummary(ledger).pending,1);
});
test('two winners settle once and calculate net correctly',()=>{
 const {ledger}=create(),legs=ledger.tickets[0].legs;
 const results=legs.map(l=>outcomeResult(l,...valuesForOutcome(l.pick)));
 const when=new Date(base+12*3600000).toISOString();
 const once=settlePaperTickets(ledger,results,{asOf:when});
 assert.equal(once.newlySettled.length,1);
 const summary=paperSummary(ledger);
 assert.equal(summary.won,1);assert.equal(summary.lost,0);
 assert.ok(summary.net>0);
 assert.equal(summary.payout,Math.round(20*ledger.tickets[0].odds*100)/100);
 const again=settlePaperTickets(ledger,results,{asOf:when});
 assert.equal(again.newlySettled.length,0);
 assert.equal(again.newlyVerifiedLegs.length,0);
});
test('one wrong tip settles ticket as a loss, actual stake only fake',()=>{
 const {ledger}=create(),leg=ledger.tickets[0].legs[0];
 const opposite=leg.pick==='1'?'2':'1';
 const result=settlePaperTickets(ledger,[outcomeResult(leg,...valuesForOutcome(opposite))],
  {asOf:new Date(base+12*3600000).toISOString()});
 assert.equal(result.summary.lost,1);
 assert.equal(result.summary.net,-20);
 assert.equal(result.summary.payout,0);
});
test('unknown results leave ticket pending, no false loss',()=>{
 const {ledger}=create();
 const r=settlePaperTickets(ledger,[],{asOf:new Date(base+12*3600000).toISOString()});
 assert.equal(r.summary.pending,1);
 assert.equal(r.summary.net,0);
});
test('football finals do not settle hockey draw',()=>{
 const {ledger}=create();
 const h=ledger.tickets[0].legs.find(l=>l.league==='hockey');
 if(!h)return;
 const wrong={...outcomeResult(h,3,3),periodsVerified:false};
 const result=settlePaperTickets(ledger,[wrong],{asOf:new Date(base+12*3600000).toISOString()});
 assert.equal(result.newlyVerifiedLegs.length,0);
});
test('hockey 60-minute draw is won despite overtime winner',()=>{
 const h=matches[2],p=proposePaperTicket([matches[2],matches[0]],{profile:'draws',now:base});
 assert.ok(p);
 const hockeyLeg=p.legs.find(l=>l.league==='hockey');
 if(!hockeyLeg){assert.fail('Expected hockey in paper proposal')}
 const ledger=emptyPaperLedger();
 placePaperTicket(ledger,p,{createdAt:offeredAt});
 const leg=ledger.tickets[0].legs.find(l=>l.league==='hockey');
 const football=ledger.tickets[0].legs.find(l=>l.league==='pl');
 const hockeyResult={
  matchId:'hokejcz_20901',league:'hockey',home:leg.home,away:leg.away,
  kickoff:leg.kickoff,status:'finished',homeScore:3,awayScore:3,
  finalHome:4,finalAway:3,periodsVerified:true,market:'1X2_60_MINUTES',
  source:'hokej.cz',observedAt:new Date(base+12*3600000).toISOString()
 };
 const footballResult=outcomeResult(football,...valuesForOutcome(football.pick));
 const graded=settlePaperTickets(ledger,[hockeyResult,footballResult],
  {asOf:new Date(base+13*3600000).toISOString()});
 assert.equal(ledger.tickets[0].legs.find(l=>l.league==='hockey').result.actual,'X');
 assert.ok(graded.newlyVerifiedLegs.length>=2);
});
test('no ambiguous duplicate provider results can settle',()=>{
 const {ledger}=create();const leg=ledger.tickets[0].legs[0];
 const result=outcomeResult(leg,...valuesForOutcome(leg.pick));
 const graded=settlePaperTickets(ledger,[result,{...result,source:'Another'}],
 {asOf:new Date(base+13*3600000).toISOString()});
 assert.equal(graded.newlyVerifiedLegs.length,0);
});
test('paper candidate cannot be made from unpaired or absent offers',()=>{
 assert.equal(proposePaperTicket([],{now:base}),null);
});


test('Czech finished match settles a bookmaker paper bet despite different CC0 result id',()=>{
 const czKickoff=new Date(base+6*3600000).toISOString();
 const czFixture={id:'cz_espn_odds_117',league:'cz',home:'Viktoria Plzeň',
  away:'Sparta Praha',kickoff:czKickoff,status:'scheduled',modelVerified:false,
  probabilities:{'1':.46,X:.31,'2':.23}};
 const czOffer={id:'book-117',league:'cz',home:'Plzeň',away:'Sparta Praha',kickoff:czKickoff,
  odds:{'1':2.45,X:3.20,'2':3.45},bookmaker:'Tipsport',
  sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html',fetchedAt:offeredAt};
 const linked=matchOffer(czOffer,[czFixture],base);
 assert.ok(linked,'Czech aliases must join bookmaker quote to actual fixture');
 const paper=proposePaperTicket([linked,matches[0]],{now:base,stake:20});
 const ledger=emptyPaperLedger();
 placePaperTicket(ledger,paper,{createdAt:offeredAt});
 const czLeg=ledger.tickets[0].legs.find(l=>l.league==='cz');
 assert.ok(czLeg);
 const result={matchId:'cz_espn_cc0_2026-27_122',league:'cz',home:'Viktoria Plzeň',
  away:'Sparta Praha',kickoff:'2026-11-08T11:00:00Z',status:'finished',
  homeScore:2,awayScore:1,market:'1X2_90_MINUTES',
  source:'OpenFootball CC0',observedAt:new Date(base+12*3600000).toISOString()};
 const graded=settlePaperTickets(ledger,[result],{asOf:new Date(base+13*3600000).toISOString()});
 assert.equal(graded.newlyVerifiedLegs.length,1);
 assert.equal(czLeg.result.actual,'1');
 assert.equal(czLeg.result.source,'OpenFootball CC0');
});
