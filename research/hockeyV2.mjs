// Czech Extraliga: separate regulation-time goals model.
// Public league table includes overtime winners, not 60-minute final results.
// Never treat an OT winner as a regulation win or learn 1/X/2 from those scores.
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const numeric=v=>Number.isFinite(Number(v))?Number(v):null;
const NAMES=[
 ['trinec','Třinec'],['pardubic','Pardubice'],['kladno','Kladno'],
 ['karlovy vary','Karlovy Vary'],['ceske budejovice','České Budějovice'],
 ['sparta','Sparta Praha'],['plzen','Plzeň'],['liberec','Liberec'],
 ['hradec kralove','Hradec Králové'],['kometa','Kometa Brno'],
 ['litvinov','Litvínov'],['mlada boleslav','Mladá Boleslav'],
 ['vitkovic','Vítkovice'],['olomouc','Olomouc']
];
export function hockeyTeamKey(name){
 const ascii=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
 const found=NAMES.find(([pattern])=>ascii.includes(pattern));
 return found?found[1]:String(name||'').trim();
}
export function hockeyStandingsProfile(rows){
 if(!Array.isArray(rows)||!rows.length)return null;
 const teams=new Map();let allGoals=0,allMatches=0,overtimeOutcomes=0;
 for(const row of rows){
  const games=numeric(row?.zapasy),score=String(row?.skore||'').match(/^(\d+):(\d+)$/);
  if(!score||!games||games<=0||games>90)continue;
  const goalsFor=Number(score[1]),goalsAgainst=Number(score[2]);
  const ow=numeric(row.vyhry_prodl)||0,ol=numeric(row.prohry_prodl)||0;
  const team=hockeyTeamKey(row.tym);
  teams.set(team,{team,played:games,goalsFor,goalsAgainst,otDraws:ow+ol});
  allGoals+=goalsFor;allMatches+=games;overtimeOutcomes+=ow+ol;
 }
 if(teams.size<10||!allMatches)return null;
 const mean=clamp(allGoals/allMatches,2.1,4);
 // Each game is counted for both teams in the table; this ratio is well defined.
 const observedRegulationDraw=clamp(overtimeOutcomes/allMatches,.12,.40);
 return {teams,mean,observedRegulationDraw,gamesRecorded:allMatches/2,source:'SazkyWeb.cz (CC BY 4.0)'};
}
export function hockeyFixtureRates(profile,home,away){
 const baselineHome=3.12,baselineAway=2.8;
 if(!profile)return {homeBase:baselineHome,awayBase:baselineAway,source:'untrained hockey prior'};
 const h=profile.teams.get(hockeyTeamKey(home)),a=profile.teams.get(hockeyTeamKey(away));
 if(!h||!a)return {homeBase:baselineHome,awayBase:baselineAway,source:'one or both teams missing from table'};
 const avg=profile.mean,smooth=9;
 const attack=t=>(t.goalsFor+avg*smooth)/(t.played+smooth)/avg;
 const conceded=t=>(t.goalsAgainst+avg*smooth)/(t.played+smooth)/avg;
 const homeBase=clamp(baselineHome*Math.pow(attack(h)*conceded(a),.74),1.1,5.8);
 const awayBase=clamp(baselineAway*Math.pow(attack(a)*conceded(h),.74),.95,5.5);
 return {homeBase,awayBase,source:profile.source,clubGames:[h.played,a.played]};
}
function renormalize(row){
 const v=['1','X','2'].map(k=>Math.max(0,Number(row[k])||0)),sum=v.reduce((a,b)=>a+b,0);
 if(sum<=0)return {'1':.42,X:.26,'2':.32};
 return {'1':v[0]/sum,X:v[1]/sum,'2':v[2]/sum};
}
export function calibrateRegulationHockey(pred,profile){
 if(!profile)return pred;
 const correct=distribution=>{
  const d=renormalize(distribution),fraction=1-d.X;
  const x=clamp(.65*profile.observedRegulationDraw+.35*d.X,.12,.4);
  if(fraction<=0)return {'1':(1-x)/2,X:x,'2':(1-x)/2};
  return {'1':(1-x)*d['1']/fraction,X:x,'2':(1-x)*d['2']/fraction};
 };
 const probabilities=correct(pred.probabilities);
 const poisson=correct(pred.poisson||pred.probabilities);
 const elo=correct(pred.elo||pred.probabilities);
 const pick=['1','X','2'].sort((a,b)=>probabilities[b]-probabilities[a])[0];
 return {...pred,pick,probabilities,poisson,elo,probability:probabilities[pick],
  hockeyRegulation:true,regulationDrawReference:profile.observedRegulationDraw};
}
