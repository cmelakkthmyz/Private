// Real live-source smoke diagnostics, not mock fixtures; no account, no bet placement.
import {mkdir,writeFile} from 'node:fs/promises';
const today=new Date(),date=today.toISOString().slice(0,10);
const yesterday=new Date(today.getTime()-86400000).toISOString().slice(0,10);
const yyyy=today.getUTCFullYear(),start=today.getUTCMonth()>=7?yyyy:yyyy-1;
const probe=[
 {id:'fpl',url:'https://fantasy.premierleague.com/api/bootstrap-static/',type:'json'},
 {id:'fplFixtures',url:'https://fantasy.premierleague.com/api/fixtures/',type:'json'},
 {id:'openfootballCzechLeague',url:'https://raw.githubusercontent.com/openfootball/europe/master/czech-republic/'+start+'-'+String((start+1)%100).padStart(2,'0')+'_cz1.txt',type:'text'},
 {id:'espnCzechFootball',url:'https://site.api.espn.com/apis/site/v2/sports/soccer/cze.1/scoreboard?dates='+start+'0801-'+(start+1)+'0630&limit=500',type:'json'},
 {id:'tipsportPublicOdds',url:'https://sazkyweb.cz/tipsport-kurzy-dnes.html',type:'html'},
 {id:'hockeyScoreboardYesterday',url:'https://json.esports.cz/hokejcz/scoreboard/'+yesterday+'.json',type:'json'}
];
async function read(item){
 const observedAt=new Date().toISOString();
 try{
  const res=await fetch(item.url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; SportPredictorAI; diagnostics)','Accept':item.type==='html'?'text/html':'application/json'},
   signal:AbortSignal.timeout(16000)});
  const txt=await res.text();
  let found=null,valid=false;
  if(item.type==='json'){
   try{
    const j=JSON.parse(txt);
    found={
     teams:Array.isArray(j.teams)?j.teams.length:null,
     players:Array.isArray(j.elements)?j.elements.length:null,
     fixtures:Array.isArray(j)?j.length:null,
     events:Array.isArray(j.events)?j.events.length:null,
     hockeyLeague101:Boolean(j['101'])};
    if(item.id==='fpl')valid=found.teams>=18&&found.players>=250;
    else if(item.id==='fplFixtures')valid=found.fixtures>=100;
    else if(item.id==='espnCzechFootball')valid=found.events>0;
    else valid=found.hockeyLeague101;
   }catch(e){found={jsonParseError:String(e).slice(0,120)};}
  }else if(item.type==='text'){
   found={bytes:txt.length,finishedScoreRows:(txt.match(/\b\d+-\d+ \(\d+-\d+\)/g)||[]).length,
    firstLeagueText:/First League/.test(txt)};
   valid=res.ok&&found.bytes>4000&&found.finishedScoreRows>=25&&found.firstLeagueText;
  }else{
   found={htmlLength:txt.length,rows:(txt.match(/<tr[^>]*data-start/gi)||[]).length,
    bookmakerMention:/tipsport/i.test(txt)};
   valid=found.htmlLength>4000&&found.rows>=1&&found.bookmakerMention;
  }
  return {id:item.id,checkedAt:observedAt,url:item.url,httpStatus:res.status,valid:valid&&res.ok,
   info:found,description:item.id==='hockeyScoreboardYesterday'?'A day without hockey may legitimately have no scoreboard':''};
 }catch(e){
  return {id:item.id,checkedAt:observedAt,url:item.url,valid:false,error:String(e).slice(0,180)};
 }
}
const results=await Promise.all(probe.map(read));
const report={testedAt:new Date().toISOString(),date,results};
await mkdir('research/results',{recursive:true});
await writeFile('research/results/live-source-check.json',JSON.stringify(report,null,2));
console.log('REAL_LIVE_SOURCE_CHECK',JSON.stringify(report));
if(results.every(x=>!x.valid))console.error('No reliable live provider returned usable data today.');
