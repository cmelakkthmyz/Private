// Premier League Intelligence V2 — pure, deterministic, pre-match prediction engine.
// Uses only events strictly before the forecast day; never current/final fixture statistics.
// The model is deliberately auditable. Extra information is additive only when present.
const GOAL_CAP=11;
const DAY=86400000;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=(x, fallback=null)=>x===null||x===undefined||x===''?fallback:(Number.isFinite(Number(x))?Number(x):fallback);
const utcDay=x=>String(x||'').slice(0,10);
const categorical=(h,a)=>h>a?'1':h===a?'X':'2';
const round=(x,n=3)=>Number(x.toFixed(n));
function probPoisson(n,l){let p=Math.exp(-l);for(let k=1;k<=n;k++)p=p*l/k;return p;}
function normalize(p){const s=p.reduce((a,b)=>a+b,0);return s>0?p.map(v=>v/s):[.45,.27,.28];}
function asDate(value){const x=Date.parse(value);return Number.isFinite(x)?x:null;}
function matchId(x){return String(x?.id||'');}
function validPast(m,cutoff){
  return m?.status==='finished'&&Number.isFinite(num(m.home_score))&&Number.isFinite(num(m.away_score))&&
    m.home_team_id&&m.away_team_id&&m.home_team_id!==m.away_team_id&&
    asDate(m.kickoff)!==null&&utcDay(m.kickoff)<utcDay(cutoff);
}
const empty=(id)=>({id,n:0,home:0,away:0,gf:0,ga:0,weightedGF:0,weightedGA:0,weightedN:0,
  recent:[],playedDates:[],elo:1500,shots:0,shotsAllowed:0,shotMatches:0});
const outcomes=(p)=>({'1':p[0],X:p[1],'2':p[2]});
export function buildPrematchStates(matches,fixture,settings={}){
  const futureDate=fixture.kickoff;
  if(asDate(futureDate)===null)throw new Error('Invalid kickoff timestamp');
  const past=(matches||[]).filter(m=>validPast(m,futureDate))
    .sort((a,b)=>asDate(a.kickoff)-asDate(b.kickoff)||matchId(a).localeCompare(matchId(b)));
  const state=new Map();
  const get=id=>{if(!state.has(id))state.set(id,empty(id));return state.get(id)};
  const eloK=clamp(num(settings.eloK,23),4,64);
  const decay=clamp(num(settings.decayDays,105),20,900);
  // Preserve chronological information boundaries between match days.
  for(let i=0;i<past.length;){
    const day=utcDay(past[i].kickoff),group=[];
    while(i<past.length && utcDay(past[i].kickoff)===day)group.push(past[i++]);
    const eloDeltas=new Map();
    for(const m of group){
      const h=get(m.home_team_id),a=get(m.away_team_id);
      const hg=num(m.home_score),ag=num(m.away_score),actual=hg>ag?1:hg===ag?.5:0;
      const expectation=1/(1+Math.pow(10,-(h.elo+75-a.elo)/400));
      const factor=Math.min(1.65,1+Math.log1p(Math.abs(hg-ag))*.31);
      const delta=eloK*(actual-expectation)*factor;
      eloDeltas.set(h.id,(eloDeltas.get(h.id)||0)+delta);
      eloDeltas.set(a.id,(eloDeltas.get(a.id)||0)-delta);
      const age=Math.max(0,(asDate(futureDate)-asDate(m.kickoff))/DAY);
      const weight=Math.pow(.5,age/decay);
      for(const [team,score,conceded,home] of [[h,hg,ag,true],[a,ag,hg,false]]){
        team.n++;team[home?'home':'away']++;team.gf+=score;team.ga+=conceded;
        team.weightedGF+=weight*score;team.weightedGA+=weight*conceded;team.weightedN+=weight;
        team.playedDates.push(asDate(m.kickoff));
        team.recent.push({date:m.kickoff,points:score>conceded?3:score===conceded?1:0,goals:score,against:conceded,home});
        if(team.recent.length>6)team.recent.shift();
        const shots=num(home?m.home_shots_on_target:m.away_shots_on_target);
        const allowed=num(home?m.away_shots_on_target:m.home_shots_on_target);
        if(shots!==null&&allowed!==null){team.shots+=shots;team.shotsAllowed+=allowed;team.shotMatches++;}
      }
    }
    for(const [team,delta] of eloDeltas) get(team).elo=clamp(get(team).elo+delta,1050,1950);
  }
  return {home:get(fixture.home_team_id),away:get(fixture.away_team_id),priorMatches:past.length,past};
}
function restFeature(state,cutoff){
  if(!state.playedDates.length)return {restDays:null,fixturesIn14Days:0,adjustment:0};
  const t=asDate(cutoff),last=Math.max(...state.playedDates);
  const restDays=(t-last)/DAY;
  const fixturesIn14Days=state.playedDates.filter(v=>t-v<=14*DAY).length;
  // Only EPL fixtures known; exclude other competitions, so cap effect.
  const fatigue=restDays<3?-.045:restDays<5?-.021:restDays>9?.009:0;
  const congestion=fixturesIn14Days>=4?-.013:0;
  return {restDays:round(restDays,1),fixturesIn14Days,adjustment:fatigue+congestion};
}
function formFeature(state){
  const pts=state.recent.length?state.recent.reduce((s,v)=>s+v.points,0)/(3*state.recent.length):.48;
  return {pointsPerGame:round(pts*3,2),adjustment:clamp((pts-.48)*.10,-.045,.045)};
}
function availabilityFeature(teamId,players){
  const items=(players||[]).filter(x=>x.team_id===teamId&&num(x.minutes,0)>=250);
  if(items.length<7)return {adjustment:0,missing:[],count:0,available:false};
  const total=items.reduce((s,p)=>s+Math.max(0,num(p.xg,0))+.5*Math.max(0,num(p.xa,0))+.03*Math.max(0,num(p.minutes,0))/90,0)||1;
  const missing=items.filter(p=>p.availability&&p.availability!=='a'&&num(p.chance_of_playing_next_round,100)<=50);
  let mass=0;
  for(const p of missing) mass+=(Math.max(0,num(p.xg,0))+.5*Math.max(0,num(p.xa,0))+.03*Math.max(0,num(p.minutes,0))/90)*(1-num(p.chance_of_playing_next_round,0)/100);
  return {adjustment:-clamp(mass/total*.23,0,.12),missing:missing.map(p=>p.name).slice(0,5),count:missing.length,available:true};
}
function newsFeature(team,articles,fixture){
  const before=asDate(fixture.kickoff),now=Date.now();
  let sum=0;const evidence=[],seen=new Set();
  for(const item of articles||[]){
    const at=num(item.published);
    if(!at||at>before||at>now||before-at>14*DAY||item.rumor||!Array.isArray(item.teams))continue;
    if(item.teams.length!==1)continue; // no guess which of two teams is affected
    const key=item.teams[0].toLowerCase(),wanted=String(team||'').toLowerCase();
    if(!wanted||key!==wanted)continue;
    const marker=(item.category||'')+'|'+String(item.title||'').toLowerCase();
    if(seen.has(marker))continue;seen.add(marker);
    const cat=item.category;
    const effect=cat==='injury'||cat==='suspension'?-.017:cat==='return'?.013:0;
    if(!effect)continue;
    sum+=effect;
    evidence.push({title:item.title,source:item.source,url:item.url,impact:effect,published:at});
  }
  return {adjustment:clamp(sum,-.06,.045),articles:evidence.slice(0,6)};
}
function goalRates(states,fixture,teams=[],players=[],articles=[],cfg={}){
  const H=states.home,A=states.away;
  const prior=clamp(num(cfg.prior,6),1,20);
  const power=clamp(num(cfg.power,.83),.25,1.5);
  const homeBase=clamp(num(cfg.homeBase,1.65),.7,2.5);
  const awayBase=clamp(num(cfg.awayBase,1.32),.6,2.1);
  const mean=(homeBase+awayBase)/2;
  const teamById=new Map((teams||[]).map(t=>[t.id,t]));
  const attack=s=>((s.weightedGF+prior*mean)/(s.weightedN+prior))/mean;
  const conceding=s=>((s.weightedGA+prior*mean)/(s.weightedN+prior))/mean;
  let homeXg=homeBase*Math.pow(attack(H)*conceding(A),power);
  let awayXg=awayBase*Math.pow(attack(A)*conceding(H),power);
  // FPL-strength inputs are contemporaneous as-of forecast only; NEVER use them for historical backtesting.
  const fplRating=(t,key)=>clamp((num(t?.[key],70)-70)/200,-.10,.10);
  const hteam=teamById.get(H.id),ateam=teamById.get(A.id);
  const strengthHome=clamp(fplRating(hteam,'attack')-fplRating(ateam,'defense'),-.13,.13);
  const strengthAway=clamp(fplRating(ateam,'attack')-fplRating(hteam,'defense'),-.13,.13);
  if(cfg.useFpl !== false){homeXg*=Math.exp(strengthHome);awayXg*=Math.exp(strengthAway);}
  const hr=restFeature(H,fixture.kickoff),ar=restFeature(A,fixture.kickoff);
  const hf=formFeature(H),af=formFeature(A);
  const hav=cfg.useAvailability===false?{adjustment:0,missing:[],count:0,available:false}:availabilityFeature(H.id,players);
  const aav=cfg.useAvailability===false?{adjustment:0,missing:[],count:0,available:false}:availabilityFeature(A.id,players);
  const hn=newsFeature(fixture.home_team_name,articles,fixture);
  const an=newsFeature(fixture.away_team_name,articles,fixture);
  // Limited corrections, relative to each side rather than arbitrary full outcome replacement.
  const relativeRest=clamp(hr.adjustment-ar.adjustment,-.08,.08);
  const relativeForm=clamp(hf.adjustment-af.adjustment,-.07,.07);
  homeXg*=Math.exp(relativeRest+relativeForm+hav.adjustment+hn.adjustment);
  awayXg*=Math.exp(-relativeRest-relativeForm+aav.adjustment+an.adjustment);
  // Elo tracked separately for probability fusion, not counted into Poisson twice.
  return {home:clamp(homeXg,.18,4.8),away:clamp(awayXg,.15,4.5),
    features:{homeElo:round(H.elo,1),awayElo:round(A.elo,1),
      homeGames:H.n,awayGames:A.n,homeRest:hr,awayRest:ar,
      homeForm:hf,awayForm:af,homeAvailability:hav,awayAvailability:aav,
      homeNews:hn,awayNews:an,homeFplStrength:round(strengthHome),awayFplStrength:round(strengthAway)}};
}
function poissonMatrix(gh,ga,rho=0){
  const pH=Array.from({length:GOAL_CAP+1},(_,i)=>probPoisson(i,gh));
  const pA=Array.from({length:GOAL_CAP+1},(_,i)=>probPoisson(i,ga));
  const scores=[],sums=[0,0,0];
  for(let h=0;h<=GOAL_CAP;h++)for(let a=0;a<=GOAL_CAP;a++){
    let p=pH[h]*pA[a];
    if(rho && h<2 && a<2){
      const factor=h===0&&a===0?1-gh*ga*rho:
        h===0&&a===1?1+gh*rho:
        h===1&&a===0?1+ga*rho:1-rho;
      p*=Math.max(.001,factor);
    }
    scores.push({home:h,away:a,probability:p});
    sums[h>a?0:h===a?1:2]+=p;
  }
  const total=sums.reduce((a,b)=>a+b,0);
  for(const s of scores)s.probability/=total;
  return {probabilities:normalize(sums),scores};
}
function eloModel(h,a,homeEloAdvantage=75){
  const delta=h+homeEloAdvantage-a;
  const draw=clamp(.276*Math.exp(-Math.abs(delta)/650),.125,.31);
  const e=1/(1+Math.pow(10,-delta/400));
  return normalize([(1-draw)*e,draw,(1-draw)*(1-e)]);
}
function marketFromOdds(odds){
  if(!odds)return null;
  const a=[num(odds.home),num(odds.draw),num(odds.away)];
  if(a.some(v=>v===null||v<=1.01||v>100))return null;
  return normalize(a.map(v=>1/v));
}
function blend3(a,b,alpha){return normalize(a.map((v,i)=>v*(1-alpha)+b[i]*alpha));}
export function predictIntelligence(fixture,matchList=[],context={}){
  if(!fixture?.home_team_id||!fixture?.away_team_id||fixture.home_team_id===fixture.away_team_id)throw Error('Invalid teams');
  const cfg=context.config||{};
  const states=buildPrematchStates(matchList,fixture,cfg);
  const goals=goalRates(states,fixture,context.teams||[],context.players||[],context.articles||[],cfg);
  const goalsModel=poissonMatrix(goals.home,goals.away,clamp(num(cfg.rho,0),-.09,.09));
  const elo=eloModel(states.home.elo,states.away.elo,num(cfg.eloHome,75));
  const eloWeight=clamp(num(cfg.eloWeight,.25),0,1);
  const odds=context.odds||{home:fixture.odds_home,draw:fixture.odds_draw,away:fixture.odds_away};
  const market=marketFromOdds(odds);
  const marketWeight=market?clamp(num(cfg.marketWeight,.5),0,.9):0;
  const priorBlend=blend3(goalsModel.probabilities,elo,eloWeight);
  const weighted=marketWeight?blend3(priorBlend,market,marketWeight):priorBlend;
  const temperature=clamp(num(cfg.temperature,1),.65,1.6);
  const distribution=normalize(weighted.map(p=>Math.pow(p,1/temperature)));
  const ix=distribution.indexOf(Math.max(...distribution)),pick=['1','X','2'][ix];
  // Score is the Poisson mode conditioned on chosen 1/X/2. No contradictory scores.
  const best=goalsModel.scores.filter(x=>categorical(x.home,x.away)===pick)
    .sort((a,b)=>b.probability-a.probability)[0];
  return {pick,score:best.home+':'+best.away,probability:distribution[ix],
    probabilities:outcomes(distribution),xgHome:round(goals.home,2),xgAway:round(goals.away,2),
    exactScoreProbability:best.probability,elo:outcomes(elo),poisson:outcomes(goalsModel.probabilities),
    marketUsed:Boolean(market),marketWeight,features:goals.features,
    signalCoverage:{history:states.priorMatches,roster:goals.features.homeAvailability.available&&goals.features.awayAvailability.available,
      news:goals.features.homeNews.articles.length+goals.features.awayNews.articles.length,market:Boolean(market)},
    model:'Intelligence V2',topScores:goalsModel.scores.sort((a,b)=>b.probability-a.probability).slice(0,5)};
}
export const BASELINE_CONFIG=Object.freeze({prior:6,power:.83,eloK:23,eloWeight:.25,marketWeight:.5,
  rho:0,temperature:1,decayDays:105,homeBase:1.65,awayBase:1.32});
