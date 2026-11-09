// Free on-device simulation journal + strictly prospective community picks.
// No account credentials, automation of bookmaker bets or unauthorized endpoints.
const PICKS=['1','X','2'];
const validNumber=n=>Number.isFinite(n)&&n>=0;
export function emptyTicketJournal(){return {version:1,drafts:[],arena:[]};}
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function key(league,home,away,kickoff){
 const d=new Date(kickoff);
 if(!Number.isFinite(d.getTime()))return null;
 return [league,norm(home),norm(away),d.toISOString().slice(0,10)].join('|');
}
export function storeTicketDraft(journal,ticket,{now=Date.now()}={}){
 if(!ticket||!Array.isArray(ticket.legs)||!ticket.legs.length||!Array.isArray(ticket.rows))throw Error('Žádný použitelný návrh tiketu');
 const ms=Number(now);
 if(!Number.isFinite(ms))throw Error('Neplatný čas');
 const legs=ticket.legs.map(l=>{
  const when=Date.parse(l.kickoff);
  if(!Number.isFinite(when)||when<=ms+60000)throw Error('Jeden zápas už začal nebo začíná příliš brzy');
  if(!['pl','cz','hockey'].includes(l.league)||!PICKS.includes(l.pick)||!l.home||!l.away)throw Error('Neúplný zápas');
  return {matchId:String(l.id),league:l.league,home:l.home,away:l.away,kickoff:l.kickoff,
   pick:l.pick,probability:Number(l.probability),odds:validNumber(l.price)?l.price:null,
   status:'pending',score:null};
 });
 const fingerprint=ticket.type+'#'+legs.map(l=>l.matchId+':'+l.pick).join('#');
 if(journal.drafts.some(x=>x.fingerprint===fingerprint))return {saved:false,reason:'Tento návrh už je uložený.'};
 const rows=ticket.rows.map(r=>({keys:[...r.keys],probability:r.probability,odds:r.odds}));
 const draft={fingerprint,createdAt:new Date(ms).toISOString(),type:ticket.type,label:ticket.label,
  stake:Number(ticket.totalStake),hasPrices:ticket.hasPrices,legs,rows,
  status:'pending',hitRows:null,settledAt:null,net:null};
 journal.drafts.unshift(draft);
 journal.drafts.splice(150);
 return {saved:true,draft};
}
function resultIndex(results){
 const keys=new Map(),ids=new Map();
 for(const r of results){
  if(!['pl','cz','hockey'].includes(r.league)||r.status!=='finished'||!Number.isInteger(r.homeScore)||!Number.isInteger(r.awayScore))continue;
  // Hockey 1/X/2 must be regulation-time results, never overtime totals.
  if(r.league==='hockey'&&r.market!=='1X2_60_MINUTES')continue;
  const k=key(r.league,r.home,r.away,r.kickoff);
  if(k){const a=keys.get(k)||[];a.push(r);keys.set(k,a);}
  if(r.matchId)ids.set(r.league+'#'+r.matchId,r);
 }
 return {keys,ids};
}
function outcome(r){return r.homeScore>r.awayScore?'1':r.homeScore===r.awayScore?'X':'2';}
function findResult(idx,l){
 const sameId=idx.ids.get(l.league+'#'+l.matchId);
 if(sameId&&Math.abs(Date.parse(l.kickoff)-Date.parse(sameId.kickoff))<9*3600000)return sameId;
 const candidates=idx.keys.get(key(l.league,l.home,l.away,l.kickoff))||[];
 return candidates.length===1?candidates[0]:null;
}
export function settleJournal(journal,results,{now=Date.now()}={}){
 const idx=resultIndex(results),at=new Date(now).toISOString();
 let newLegs=0,newDrafts=0,newArena=0;
 for(const draft of journal.drafts){
  if(draft.status!=='pending')continue;
  for(const leg of draft.legs){
   if(leg.status!=='pending')continue;
   const r=findResult(idx,leg);
   if(!r||Date.parse(r.kickoff)>Date.parse(at))continue;
   leg.status=leg.pick===outcome(r)?'won':'lost';
   leg.score=r.homeScore+':'+r.awayScore;newLegs++;
  }
  if(draft.legs.every(l=>l.status!=='pending')){
   draft.hitRows=draft.rows.filter(row=>row.keys.every(k=>draft.legs[k.charCodeAt(0)-65]?.status==='won')).length;
   draft.status=draft.hitRows?'has-hit':'lost';
   draft.settledAt=at;
   // Do not report fictitious monetary returns without actual recorded odds.
   draft.net=draft.hasPrices&&draft.legs.every(l=>validNumber(l.odds)&&l.odds>1)?
     draft.rows.reduce((sum,row)=>row.keys.every(k=>draft.legs[k.charCodeAt(0)-65]?.status==='won')?
      sum+draft.stake/draft.rows.length*row.keys.reduce((p,k)=>p*draft.legs[k.charCodeAt(0)-65].odds,1):sum,0)-draft.stake:null;
   newDrafts++;
  }
 }
 for(const a of journal.arena){
  if(a.status!=='pending')continue;
  const result=findResult(idx,a);
  if(!result||Date.parse(result.kickoff)>Date.parse(at))continue;
  a.status=a.pick===outcome(result)?'won':'lost';
  a.actual=outcome(result);a.settledAt=at;newArena++;
 }
 return {newLegs,newDrafts,newArena};
}
export function importArenaPicks(journal,text,{now=Date.now()}={}){
 const lines=String(text||'').trim().split(/\r?\n/).filter(Boolean);
 if(!lines.length||lines.length>30)throw Error('Zadej 1 až 30 řádků');
 let added=0,duplicates=0;const errors=[];
 for(let i=0;i<lines.length;i++){
  // Format: Author;league;home;away;ISO kickoff;1/X/2;optional public URL
  const parts=lines[i].split(';').map(x=>x.trim());
  if(parts.length<6){errors.push(i+1);continue;}
  const [author,league,home,away,kickoff,pick,url='']=parts;
  const when=Date.parse(kickoff);
  if(!author||author.length>50||!['pl','cz','hockey'].includes(league)||!home||!away||
      !PICKS.includes(pick)||!Number.isFinite(when)||when<=now+60000||
      when>now+20*86400000){errors.push(i+1);continue;}
  if(url&&!(url.startsWith('https://www.tipsport.cz/tiket-arena')||url.startsWith('https://tipsport.cz/tiket-arena'))){
   errors.push(i+1);continue;
  }
  const fingerprint=[norm(author),key(league,home,away,kickoff),pick].join('#');
  if(journal.arena.some(a=>a.fingerprint===fingerprint)){duplicates++;continue;}
  journal.arena.unshift({fingerprint,author,league,home,away,kickoff,pick,url,
   createdAt:new Date(now).toISOString(),status:'pending',actual:null,settledAt:null,
   source:'manual public Arena transcription'});
  added++;
 }
 journal.arena.splice(250);
 return {added,duplicates,invalidLines:errors};
}
export function arenaStats(journal){
 const finished=journal.arena.filter(a=>a.status==='won'||a.status==='lost');
 const wins=finished.filter(a=>a.status==='won').length;
 const authors=new Map();
 for(const a of finished){
  const row=authors.get(a.author)||{author:a.author,settled:0,wins:0};
  row.settled++;if(a.status==='won')row.wins++;
  authors.set(a.author,row);
 }
 const rated=[...authors.values()].sort((a,b)=>b.settled-a.settled);
 // Inherent sample selection bias: display the data, never blindly feed unverified signals to model.
 return {imported:journal.arena.length,pending:journal.arena.length-finished.length,
  settled:finished.length,wins,accuracy:finished.length?wins/finished.length:null,
  authors:rated.slice(0,12),eligibleToLearn:finished.length>=30&&rated.filter(a=>a.settled>=5).length>=3,
  limitation:'Údaje pocházejí z ručního přepisu, mohou být výběrově zkreslené. Bez nezávislého testu nepřebírat výběry komunity do modelu.'};
}
export function journalStats(journal){
 const all=journal.drafts,settled=all.filter(t=>t.status!=='pending');
 return {saved:all.length,pending:all.length-settled.length,settled:settled.length,
  withHit:settled.filter(t=>t.hitRows>0).length,
  netKnown:settled.filter(t=>t.net!==null).length};
}
