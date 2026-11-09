import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyTicketJournal,storeTicketDraft,settleJournal,importArenaPicks,arenaStats,journalStats}
 from './modelTicketJournal.mjs';
const now=Date.parse('2026-11-09T09:00:00Z');
const matches=['Arsenal|Chelsea','Liverpool|Everton','Newcastle United|Brighton'].map((name,i)=>{
 const [home,away]=name.split('|');
 return {id:'s'+i,league:'pl',home,away,
  kickoff:new Date(now+(i+2)*86400000).toISOString(),pick:'1',probability:.59,price:null};
});
const example=(type='kombi')=>({
 type,label:'KOMBI 2/3',totalStake:30,stake:30,hasPrices:false,legs:matches,
 rows:[{keys:['A','B'],probability:.35,odds:null},
       {keys:['A','C'],probability:.35,odds:null},
       {keys:['B','C'],probability:.35,odds:null}]
});
const final=(i,homeScore,awayScore)=>({
 matchId:'pl_espn_s'+i,league:'pl',home:matches[i].home,away:matches[i].away,
 kickoff:matches[i].kickoff,status:'finished',homeScore,awayScore,market:'1X2_90_MINUTES'
});
test('save selected model ticket, prevent duplicate and store independently of prices',()=>{
 const journal=emptyTicketJournal();
 const first=storeTicketDraft(journal,example(),{now});
 assert.equal(first.saved,true);
 assert.equal(first.draft.legs.length,3);
 assert.equal(first.draft.rows.length,3);
 assert.equal(storeTicketDraft(journal,example(),{now}).saved,false);
 assert.equal(journalStats(journal).pending,1);
 assert.equal(journal.drafts[0].net,null);
});
test('official final outcomes settle model KOMBI correctly but no fictional profit',()=>{
 const j=emptyTicketJournal();storeTicketDraft(j,example(),{now});
 let result=settleJournal(j,[{...final(0,3,1),status:'scheduled'},final(1,0,2)],{now:now+3*86400000});
 assert.equal(result.newLegs,1);
 assert.equal(j.drafts[0].status,'pending');
 result=settleJournal(j,[final(0,3,1),final(2,2,0)],{now:now+4*86400000});
 assert.equal(result.newDrafts,1);
 assert.equal(j.drafts[0].status,'has-hit');
 assert.equal(j.drafts[0].hitRows,1);
 assert.equal(j.drafts[0].net,null);
 assert.equal(settleJournal(j,[final(0,3,1)],{now:now+5*86400000}).newDrafts,0);
});
test('future-only Arena tips are validated and duplicates rejected, historical claims not imported',()=>{
 const j=emptyTicketJournal(),kickoff=matches[0].kickoff;
 const line='TipérA;pl;Arsenal;Chelsea;'+kickoff+';1';
 const invalid='Old;pl;Arsenal;Chelsea;2026-11-08T09:00:00Z;1';
 const r=importArenaPicks(j,[line,line,invalid].join('\n'),{now});
 assert.equal(r.added,1);
 assert.equal(r.duplicates,1);
 assert.deepEqual(r.invalidLines,[3]);
 assert.equal(arenaStats(j).settled,0);
 assert.equal(arenaStats(j).accuracy,null);
 assert.equal(arenaStats(j).eligibleToLearn,false);
});
test('Arena success is based only on independently verified final results',()=>{
 const j=emptyTicketJournal();
 importArenaPicks(j,'AutorZ;pl;Arsenal;Chelsea;'+matches[0].kickoff+';2',{now});
 settleJournal(j,[{...final(0,2,0),status:'scheduled'}],{now:now+3*86400000});
 assert.equal(arenaStats(j).pending,1);
 settleJournal(j,[final(0,2,0)],{now:now+3*86400000});
 assert.equal(arenaStats(j).settled,1);
 assert.equal(arenaStats(j).wins,0);
 assert.equal(arenaStats(j).accuracy,0);
});
test('hockey outcome cannot be determined from overtime win instead of 60-minute draw',()=>{
 const j=emptyTicketJournal(),kickoff=new Date(now+4*86400000).toISOString();
 importArenaPicks(j,'Fanda;hockey;Třinec;Pardubice;'+kickoff+';X',{now});
 const full={matchId:'any',league:'hockey',home:'Třinec',away:'Pardubice',kickoff,
  status:'finished',homeScore:4,awayScore:3,market:'1X2_FINAL'};
 assert.equal(settleJournal(j,[full],{now:now+5*86400000}).newArena,0);
 assert.equal(settleJournal(j,[{...full,homeScore:3,awayScore:3,market:'1X2_60_MINUTES'}],
   {now:now+5*86400000}).newArena,1);
 assert.equal(arenaStats(j).wins,1);
});
