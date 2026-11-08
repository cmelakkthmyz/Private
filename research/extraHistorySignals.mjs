// Additional historical observations strictly available before kickoff.
// Stadium-specific attack/defence and shots on target have Bayesian shrinkage.
// No post-match data, historical "injury guess", or same-day scores can enter here.
const DAY=86400000;
const clamp=(x,low,high)=>Math.min(high,Math.max(low,x));
const number=(x)=>x===undefined||x===null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const date=x=>Date.parse(String(x||''));
const day=x=>String(x||'').slice(0,10);
function stats(){
 return {all:{n:0,gf:0,ga:0},home:{n:0,gf:0,ga:0},away:{n:0,gf:0,ga:0},
  sotN:0,sotFor:0,sotAgainst:0,recentResults:[]};
}
function update(s,venue,scored,conceded,weight,sotFor,sotAgainst,kickoff){
 for(const bucket of [s.all,s[venue]]){
  bucket.n+=weight;bucket.gf+=scored*weight;bucket.ga+=conceded*weight;
 }
 if(sotFor!==null&&sotAgainst!==null&&sotFor>=0&&sotAgainst>=0&&sotFor<=50&&sotAgainst<=50){
  s.sotN+=weight;s.sotFor+=weight*sotFor;s.sotAgainst+=weight*sotAgainst;
 }
 s.recentResults.push({date:kickoff,venue,points:scored>conceded?3:scored===conceded?1:0});
 if(s.recentResults.length>12)s.recentResults.shift();
}
const rate=(x,n,priorRate,priorMatches=5)=> (x+priorRate*priorMatches)/(n+priorMatches);
function sideRatio(s,venue,category,leagueMean){
 const total=rate(s.all[category],s.all.n,leagueMean,8);
 const venueBucket=s[venue];
 const home=rate(venueBucket[category],venueBucket.n,total,8);
 return clamp(home/Math.max(.3,total),.75,1.28);
}
export function historySignalsBefore(matchList,fixture,{halflifeDays=220}={}){
 const when=date(fixture?.kickoff);
 if(!Number.isFinite(when))throw Error('Fixture has no valid kickoff');
 const cutoff=day(fixture.kickoff),states=new Map(),get=id=>{
  if(!states.has(id))states.set(id,stats());return states.get(id);
 };
 let used=0,shotsAvailable=0;
 for(const match of matchList||[]){
  if(match?.status!=='finished'||day(match.kickoff)>=cutoff)continue;
  const played=date(match.kickoff),h=number(match.home_score),a=number(match.away_score);
  if(!Number.isFinite(played)||!Number.isInteger(h)||!Number.isInteger(a)||h<0||a<0||
    !match.home_team_id||!match.away_team_id||match.home_team_id===match.away_team_id)continue;
  const age=Math.max(0,(when-played)/DAY),weight=Math.pow(.5,age/clamp(halflifeDays,80,700));
  if(weight<.004)continue;
  used++;
  const hs=number(match.home_shots_on_target),as=number(match.away_shots_on_target);
  if(hs!==null&&as!==null)shotsAvailable++;
  update(get(match.home_team_id),'home',h,a,weight,hs,as,match.kickoff);
  update(get(match.away_team_id),'away',a,h,weight,as,hs,match.kickoff);
 }
 const H=get(fixture.home_team_id),A=get(fixture.away_team_id);
 const leagueMean=1.43;
 const hAttack=sideRatio(H,'home','gf',leagueMean),aConcede=sideRatio(A,'away','ga',leagueMean);
 const aAttack=sideRatio(A,'away','gf',leagueMean),hConcede=sideRatio(H,'home','ga',leagueMean);
 const venueReady=H.home.n>=1.8&&A.away.n>=1.8&&H.all.n>=4&&A.all.n>=4;
 const venueHome=venueReady?clamp(Math.log(hAttack*aConcede),-.22,.22):0;
 const venueAway=venueReady?clamp(Math.log(aAttack*hConcede),-.22,.22):0;
 const shotsReady=H.sotN>=3&&A.sotN>=3;
 const net=s=>s.sotN?(s.sotFor-s.sotAgainst)/s.sotN:0;
 const netDifference=shotsReady?clamp((net(H)-net(A))/8,-.22,.22):0;
 const shotsHome=shotsReady?netDifference*.35:0;
 const shotsAway=shotsReady?-netDifference*.35:0;
 return {venueHome,venueAway,shotsHome,shotsAway,
  evidence:{priorMatches:used,hasVenue:venueReady,hasShots:shotsReady,
   homeEffectiveGames:Number(H.all.n.toFixed(2)),awayEffectiveGames:Number(A.all.n.toFixed(2)),
   sources:['finished matches strictly before fixture date',
    ...(shotsReady?['shots-on-target observed in past results']:[])]}};
}
export function enhanceHistoricalGoals(goals,matchList,fixture,config={}){
 const s=historySignalsBefore(matchList,fixture,config);
 const venueWeight=clamp(Number(config.venueWeight??.50),0,1.25);
 const shotsWeight=clamp(Number(config.shotsWeight??.45),0,1.25);
 const home=clamp(goals.home*Math.exp(s.venueHome*venueWeight+s.shotsHome*shotsWeight),.16,5.5);
 const away=clamp(goals.away*Math.exp(s.venueAway*venueWeight+s.shotsAway*shotsWeight),.14,5.5);
 return {home,away,signals:s};
}
