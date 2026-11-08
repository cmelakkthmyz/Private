// Czech Chance Liga 20-season archive loader.
// Licence-safe design: automatic downloads only from the CC0 OpenFootball project;
// older CSV files must be supplied from an authorized source. Never invent seasons.
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const BASE='https://raw.githubusercontent.com/openfootball/europe/master/czech-republic/';
export const TARGET_SEASONS=Object.freeze(Array.from({length:20},(_,i)=>{
  const first=2005+i;return first+'-'+String((first+1)%100).padStart(2,'0');
}));
export const HELDOUT_SEASON='2025-26';
export const OPENFOOTBALL_CZECH=new Set(['2018-19','2020-21','2023-24','2024-25']);
const MONTHS={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
const asNum=s=>/^\d+$/.test(String(s))?Number(s):null;
export function canonicalCzechClub(value){
 const name=String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
 const aliases={
  'AC Sparta Praha':'Sparta Praha','Sparta Praha':'Sparta Praha',
  'SK Slavia Praha':'Slavia Praha','Slavia Praha':'Slavia Praha',
  'FC Viktoria Plzeň':'Viktoria Plzeň','Viktoria Plzeň':'Viktoria Plzeň',
  'FC Slovan Liberec':'Slovan Liberec','Slovan Liberec':'Slovan Liberec',
  'FK Teplice':'Teplice','FK Mladá Boleslav':'Mladá Boleslav',
  'FC Baník Ostrava':'Baník Ostrava','Baník Ostrava':'Baník Ostrava',
  '1. FC Slovácko':'Slovácko','1.FC Slovácko':'Slovácko',
  'SK Sigma Olomouc':'Sigma Olomouc','Sigma Olomouc':'Sigma Olomouc',
  'FC Hradec Králové':'Hradec Králové','FK Jablonec':'Jablonec',
  'Bohemians Praha 1905':'Bohemians Praha 1905','Bohemians 1905':'Bohemians Praha 1905',
  'FC Zlín':'Zlín','FC Fastav Zlín':'Zlín',
  'FC Trinity Zlín':'Zlín','FC Tescoma Zlín':'Zlín',
  'FC Zbrojovka Brno':'Zbrojovka Brno','1. FC Brno':'Zbrojovka Brno',
  'Dynamo České Budějovice':'Dynamo České Budějovice',
  'SK Dynamo České Budějovice':'Dynamo České Budějovice',
  'FK Pardubice':'Pardubice','FK Dukla Praha':'Dukla Praha','MFK Karviná':'Karviná',
  'FC Vysočina Jihlava':'Vysočina Jihlava',
 };
 return aliases[name]||name;
}
export function parseOpenfootballCzech(text,season){
 if(!/^\d{4}-\d{2}$/.test(season))throw Error('Invalid season format');
 const start=Number(season.slice(0,4));
 const rows=[],warnings=[];
 let dayKey=null,round=0,timeHint=null;
 const input=String(text||'').replace(/\r/g,'').split('\n');
 for(let i=0;i<input.length;i++){
  const line=input[i],roundMatch=line.match(/^\s*[▪•]\s*(?:Matchday|Round)\s+(\d+)/i);
  if(roundMatch){round=Number(roundMatch[1]);continue}
  const date=line.match(/^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?\s*$/);
  if(date){
   const month=MONTHS[date[1]],day=Number(date[2]),year=date[3]?Number(date[3]):month>=7?start:start+1;
   const stamp=new Date(Date.UTC(year,month-1,day));
   dayKey=stamp.getUTCFullYear()===year&&stamp.getUTCMonth()+1===month&&stamp.getUTCDate()===day?
    stamp.toISOString().slice(0,10):null;
   timeHint=null;continue;
  }
  const result=line.match(/^\s*(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+v\s+(.+?)\s+(\d+)-(\d+)(?:\s*\([^)]*\))?\s*$/);
  if(!result)continue;
  if(!dayKey){warnings.push('Skipped result without date at line '+(i+1));continue;}
  const tm=result[1]||timeHint||'12:00';if(result[1])timeHint=result[1];
  const home=canonicalCzechClub(result[2]),away=canonicalCzechClub(result[3]);
  const hg=Number(result[4]),ag=Number(result[5]);
  if(!home||!away||home===away||hg>30||ag>30){warnings.push('Invalid club/score at line '+(i+1));continue}
  rows.push({id:'cz1_'+season+'_'+rows.length,competition:'cz-football',
   season,matchday:round,home_team_id:home,away_team_id:away,home_team_name:home,away_team_name:away,
   kickoff:dayKey+'T'+tm+':00Z',home_score:hg,away_score:ag,status:'finished',
   source:'OpenFootball CC0',sourceUrl:BASE+season+'_cz1.txt'});
 }
 return {season,matches:rows,warnings};
}
function parseDelimited(text){
 const rows=[],raw=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
 if(raw.length<2)return [];
 const sep=raw[0].includes('\t')?'\t':raw[0].includes(';')?';':',';
 const hdr=raw[0].split(sep).map(s=>s.trim().toLowerCase());
 for(const line of raw.slice(1)){
  const fields=line.split(sep).map(s=>s.trim());
  if(fields.length<hdr.length)continue;
  rows.push(Object.fromEntries(hdr.map((h,i)=>[h,fields[i]])));
 }
 return rows;
}
export function parseCzechCsv(text,season,source='Authorized CSV import'){
 const rows=parseDelimited(text),issues=[],matches=[];
 for(const [i,row] of rows.entries()){
  const date=row.date||row.kickoff;
  const year=date&&/^\d{4}-\d{2}-\d{2}/.test(date)?date.slice(0,10):null;
  if(!year){issues.push('No ISO date at row '+(i+2));continue;}
  const home=canonicalCzechClub(row.home||row.home_team||row.hometeam),
    away=canonicalCzechClub(row.away||row.away_team||row.awayteam);
  const hg=asNum(row.home_score??row.fthg),ag=asNum(row.away_score??row.ftag);
  if(!home||!away||home===away||hg===null||ag===null||hg>30||ag>30){issues.push('Invalid fixture at row '+(i+2));continue;}
  const kickoff=date.includes('T')?date:year+'T12:00:00Z';
  matches.push({id:'cz1_'+season+'_'+matches.length,competition:'cz-football',
   season,kickoff,home_team_id:home,away_team_id:away,home_team_name:home,away_team_name:away,
   home_score:hg,away_score:ag,status:'finished',source});
 }
 return {season,matches,warnings:issues};
}
export function auditCzechSeason(input){
 const games=input.matches||[],names=new Set(),unique=new Set(),errors=[],start=Number(input.season?.slice(0,4));
 for(const g of games){
  names.add(g.home_team_id);names.add(g.away_team_id);
  const date=Date.parse(g.kickoff);
  if(!Number.isFinite(date)||new Date(date).getUTCFullYear()<start||new Date(date).getUTCFullYear()>start+1)
   errors.push('Outside season: '+g.id);
  const key=g.kickoff.slice(0,10)+'|'+g.home_team_id+'|'+g.away_team_id;
  if(unique.has(key))errors.push('Duplicate fixture '+key);unique.add(key);
 }
 const complete=games.length>=200&&names.size>=14&&errors.length===0;
 return {season:input.season,fixtures:games.length,teams:names.size,complete,errors,
   warnings:input.warnings||[],source:games[0]?.source||null};
}
export async function loadCzechArchive({fetchFn=fetch,localDirectory='research/data/czech-first-league',strict=false}={}){
 const found=[],audit=[],missing=[],base=new Map();
 try{
  for(const name of await readdir(localDirectory)){
   const season=name.match(/^(\d{4}-\d{2})\.csv$/)?.[1];
   if(!season)continue;
   const file=await readFile(join(localDirectory,name),'utf8');
   base.set(season,parseCzechCsv(file,season));
  }
 }catch(e){if(e.code!=='ENOENT')throw e}
 const requested=[...TARGET_SEASONS,HELDOUT_SEASON];
 for(const season of requested){
  let parsed=base.get(season);
  if(!parsed&&OPENFOOTBALL_CZECH.has(season)){
   const url=BASE+season+'_cz1.txt';
   try{
    const response=await fetchFn(url,{headers:{Accept:'text/plain'},signal:AbortSignal.timeout(12000)});
    if(response.ok)parsed=parseOpenfootballCzech(await response.text(),season);
   }catch(e){missing.push({season,reason:'fetch failed: '+String(e?.message||e)})}
  }
  if(!parsed){if(!missing.some(m=>m.season===season))missing.push({season,reason:'no licensed game-by-game archive supplied'});continue}
  const report=auditCzechSeason(parsed);
  audit.push(report);
  if(report.complete)found.push(...parsed.matches);else missing.push({season,reason:'incomplete or invalid archive'});
 }
 found.sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||a.id.localeCompare(b.id));
 const verifiedSeasons=audit.filter(x=>x.complete).map(x=>x.season);
 if(strict&&(verifiedSeasons.filter(s=>TARGET_SEASONS.includes(s)).length!==20||!verifiedSeasons.includes(HELDOUT_SEASON)))
  throw Error('The complete 20-season source archive is not available. Never claim 20-season training.');
 return {matches:found,audit,verifiedSeasons,missing,coverage:{
  requestedTrainingSeasons:20,loadedTrainingSeasons:verifiedSeasons.filter(x=>TARGET_SEASONS.includes(x)).length,
  heldoutLoaded:verifiedSeasons.includes(HELDOUT_SEASON),totalFixtures:found.length,
  complete20Years:TARGET_SEASONS.every(x=>verifiedSeasons.includes(x))}};
}
