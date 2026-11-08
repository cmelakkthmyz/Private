// Public-domain historical English Premier League results — OpenFootball CC0.
// Each season is checked against its declared 380 fixtures. No result is invented.
const MONTHS={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
const PREFIX='https://raw.githubusercontent.com/openfootball/england/master/';
export const ENGLISH_TRAINING_SEASONS=Object.freeze(
  Array.from({length:20},(_,i)=>{const y=2005+i;return y+'-'+String((y+1)%100).padStart(2,'0');}));
export const ENGLISH_HOLDOUT_SEASON='2025-26';
export function canonicalEngland(name){
  let key=String(name||'').trim().replace(/\s+/g,' ').replace(/\s+(FC|AFC)$/i,'');
  const map={
    'AFC Bournemouth':'Bournemouth','Bournemouth':'Bournemouth',
    'Manchester United':'Manchester United','Manchester City':'Manchester City',
    'Brighton & Hove Albion':'Brighton','Tottenham Hotspur':'Tottenham Hotspur',
    'Wolverhampton Wanderers':'Wolverhampton Wanderers',
    'Newcastle United':'Newcastle United','West Ham United':'West Ham United',
    'West Bromwich Albion':'West Bromwich Albion','Nottingham Forest':'Nottingham Forest',
    'Norwich City':'Norwich City','Huddersfield Town':'Huddersfield Town',
    'Ipswich Town':'Ipswich Town','Leicester City':'Leicester City',
    'Sheffield United':'Sheffield United','Sunderland':'Sunderland',
    'Aston Villa':'Aston Villa','Crystal Palace':'Crystal Palace',
    'Stoke City':'Stoke City','Cardiff City':'Cardiff City',
    'Swansea City':'Swansea City','Watford':'Watford','Hull City':'Hull City'
  };
  return map[key]||key;
}
function parseDate(line,seasonYear){
  const m=String(line).trim().match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?\s*$/);
  if(!m)return null;
  const mon=MONTHS[m[1]],day=Number(m[2]),year=m[3]?Number(m[3]):mon>=7?seasonYear:seasonYear+1;
  const d=new Date(Date.UTC(year,mon-1,day));
  return d.getUTCFullYear()===year&&d.getUTCMonth()+1===mon&&d.getUTCDate()===day?d.toISOString().slice(0,10):null;
}
function parseResult(line){
 const text=String(line).trim();
 // Newer OpenFootball format: Home v Away 1-0 (0-0).
 const newer=text.match(/^(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+v\s+(.+?)\s+(\d+)-(\d+)(?:\s+\([^()]*\))?\s*$/);
 if(newer)return {time:newer[1],home:newer[2],away:newer[3],h:Number(newer[4]),a:Number(newer[5])};
 // Traditional format: Home 1-0 (0-0) Away.
 const classic=text.match(/^(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+(\d+)-(\d+)(?:\s+\([^()]*\))?\s+(.+?)\s*$/);
 if(classic)return {time:classic[1],home:classic[2],away:classic[5],h:Number(classic[3]),a:Number(classic[4])};
 return null;
}
export function parseOpenFootballEngland(text,season){
 if(!/^\d{4}-\d{2}$/.test(season))throw Error('Incorrect season name');
 const year=Number(season.slice(0,4)),games=[],warnings=[],rounds=new Set(),clubMap=new Set();
 let date=null,round=0;
 const lines=String(text).replace(/\r/g,'').split('\n');
 for(let index=0;index<lines.length;index++){
   const line=lines[index];
   const roundMatch=line.match(/^\s*[▪•]\s*(?:Matchday|Regular Season\s*-\s*)(?:\s*-\s*)?(\d+)/i);
   if(roundMatch){round=Number(roundMatch[1]);continue}
   const dateCandidate=parseDate(line,year);
   if(dateCandidate){date=dateCandidate;continue}
   const fixture=parseResult(line);
   if(!fixture)continue;
   if(!date){warnings.push('No preceding kickoff date at line '+(index+1));continue}
   const home=canonicalEngland(fixture.home),away=canonicalEngland(fixture.away);
   if(home===away||!home||!away||fixture.h>25||fixture.a>25){
    warnings.push('Rejected invalid outcome at '+(index+1));continue;
   }
   let tm=fixture.time||'12:00';
   if(!/^\d{1,2}:\d{2}$/.test(tm))tm='12:00';
   const match={id:'eng_'+season+'_'+games.length,competition:'pl-football',
      season,kickoff:date+'T'+tm.padStart(5,'0')+':00Z',home_team_id:home,away_team_id:away,
      home_team_name:home,away_team_name:away,home_score:fixture.h,away_score:fixture.a,
      status:'finished',round,source:'OpenFootball CC0'};
   games.push(match);clubMap.add(home);clubMap.add(away);rounds.add(round);
 }
 const unique=new Set(games.map(m=>m.kickoff.slice(0,10)+'|'+m.home_team_id+'|'+m.away_team_id));
 const report={season,fixtures:games.length,clubs:clubMap.size,unique:unique.size,
   rounds:rounds.size,verified:games.length===380&&clubMap.size===20&&unique.size===380,
   warnings:warnings.slice(0,12)};
 return {matches:games,report};
}
export async function loadEnglishArchive({fetchFn=fetch,first=2005,last=2025,requireAll=false}={}){
 const matches=[],reports=[];
 for(let y=first;y<=last;y++){
   const season=y+'-'+String((y+1)%100).padStart(2,'0');
   const url=PREFIX+season+'/1-premierleague.txt';
   try{
    const response=await fetchFn(url,{headers:{Accept:'text/plain'},
      signal:AbortSignal.timeout(17000)});
    if(!response.ok){reports.push({season,verified:false,error:'HTTP '+response.status});continue}
    const parsed=parseOpenFootballEngland(await response.text(),season);
    reports.push(parsed.report);
    if(parsed.report.verified)matches.push(...parsed.matches);
   }catch(e){reports.push({season,verified:false,error:String(e?.message||e).slice(0,150)})}
 }
 matches.sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||a.id.localeCompare(b.id));
 if(requireAll&&reports.some(r=>!r.verified))
  throw Error('Missing historical football data for: '+reports.filter(r=>!r.verified).map(x=>x.season).join(','));
 return {matches,reports,coverage:{requested:last-first+1,complete:reports.filter(x=>x.verified).length,
  fixtures:matches.length,cc0:true,allComplete:reports.every(x=>x.verified)}};
}
