import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOffer,matchOffer,evaluateOffer,buildAutoTickets,normClub} from './autoOddsScanner.mjs';
const now=Date.parse('2026-11-08T09:00:00Z');
const at=new Date(now+4*3600000).toISOString();
const fixture=(id,home,away,p={ '1':.65,X:.2,'2':.15},league='pl')=>({
  id,home,away,league,kickoff:at,status:'scheduled',
  modelVerified:true,probabilities:p
});
const offer=(id,home,away,odds={'1':2,X:3,'2':3},league='pl')=>({
  id,home,away,league,odds,kickoff:at,bookmaker:'Tipsport',
  sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html',fetchedAt:new Date(now).toISOString()
});
test('normalization matches Czech accents and English club variants',()=>{
 assert.equal(normClub('FC Viktoria Plzeň'),normClub('Viktoria Plzen'));
 assert.equal(normClub('Manchester Utd'),normClub('Manchester United FC'));
 assert.equal(normClub('HC Oceláři Třinec'),normClub('Třinec'));
});
test('valid public bookmaker 1X2 odds join to the actual fixture',()=>{
 const match=matchOffer(offer('o1','Arsenal','Liverpool'),[fixture('f1','Arsenal','Liverpool')],now);
 assert.equal(match.fixture.id,'f1');
 assert.equal(match.offer.odds['1'],2);
});
test('no match when opponents, venue, league or start date differ',()=>{
 const f=fixture('f1','Arsenal','Liverpool');
 assert.equal(matchOffer(offer('o1','Liverpool','Arsenal'),[f],now),null);
 assert.equal(matchOffer(offer('o1','Arsenal','Liverpool',undefined,'cz'),[f],now),null);
 assert.equal(matchOffer({...offer('o1','Arsenal','Liverpool'),kickoff:new Date(now+36*3600000).toISOString()},[f],now),null);
});
test('expired and implausible offers are rejected',()=>{
 assert.equal(matchOffer({...offer('o1','Arsenal','Liverpool'),kickoff:new Date(now-1000).toISOString()},[fixture('f1','Arsenal','Liverpool')],now),null);
 assert.equal(normalizeOffer({...offer('o1','Arsenal','Liverpool'),odds:{'1':2,X:0,'2':3}}),null);
});
test('market probability removes overround before edge comparison',()=>{
 const e=evaluateOffer(matchOffer(offer('o1','Arsenal','Liverpool'),[fixture('f1','Arsenal','Liverpool')],now));
 assert.ok(e.market.overround>.05);
 const expected=(1/2)/(1/2+1/3+1/3);
 assert.ok(Math.abs(e.market.fair['1']-expected)<1e-12);
 assert.ok(e.options.find(x=>x.pick==='1').conservativeEV>0);
});
test('automatically finds a two-match combo and respects model stake',()=>{
 const games=[fixture('g1','Arsenal','Liverpool'),fixture('g2','Chelsea','Fulham')];
 const odds=[offer('o1','Arsenal','Liverpool'),offer('o2','Chelsea','Fulham')];
 const matched=odds.map(x=>matchOffer(x,games,now));
 const v=buildAutoTickets(matched,{stake:10,profile:'balanced',now});
 assert.equal(v.scanned,2);
 assert.ok(v.selected.length>=1);
 assert.equal(v.selected[0].legs.length,2);
 assert.equal(v.selected[0].stake,10);
 assert.ok(v.selected[0].conservativeEV>.03);
});
test('three-leg high-odds profile requires three independent matches',()=>{
 const games=[fixture('g1','Arsenal','Liverpool'),fixture('g2','Chelsea','Fulham'),
  fixture('g3','Everton','Manchester United')];
 const offers=[offer('a','Arsenal','Liverpool'),offer('b','Chelsea','Fulham'),
  offer('c','Everton','Manchester United')];
 const v=buildAutoTickets(offers.map((x)=>matchOffer(x,games,now)),{profile:'longshot',now});
 assert.ok(v.selected.every(x=>x.legs.length===3));
});
test('draw profile permits hockey regulation-time X but labels unverified model',()=>{
 const games=[
  fixture('h1','Třinec','Olomouc',{'1':.4,X:.35,'2':.25},'hockey'),
  fixture('h2','Pardubice','Kometa Brno',{'1':.43,X:.34,'2':.23},'hockey')
 ].map(x=>({...x,modelVerified:false}));
 const offers=[offer('o1','Třinec','Olomouc',{'1':3,X:4.4,'2':4.1},'hockey'),
  offer('o2','Pardubice','Kometa Brno',{'1':3.2,X:4.5,'2':4.3},'hockey')];
 const matched=offers.map(x=>matchOffer(x,games,now));
 const result=buildAutoTickets(matched,{profile:'draws',now});
 assert.ok(result.selected.every(c=>c.legs.some(x=>x.pick==='X')));
 assert.ok(result.selected.every(c=>c.unverified));
});
test('no candidates means no fake tickets',()=>{
 const result=buildAutoTickets([],{profile:'longshot',now});
 assert.equal(result.selected.length,0);
 assert.ok(result.note.includes('Žádná kombinace'));
});
