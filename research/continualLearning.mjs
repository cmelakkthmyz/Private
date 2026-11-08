// Online expert calibration. No hindsight, no artificial wins, no bookmaker account.
// State is isolated by competition and persisted as JSON by the host application.
const KEYS=['model','poisson','elo','market'];
const OUTCOMES=['1','X','2'];
const INIT={model:.48,poisson:.27,elo:.17,market:.08};
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const round=(x,n=5)=>Number(x.toFixed(n));
const ms=x=>{const v=Date.parse(x||'');return Number.isFinite(v)?v:null};
const norm=o=>{const vals=OUTCOMES.map(k=>Number(o?.[k]));if(vals.some(v=>!Number.isFinite(v)||v<0))return null;const s=vals.reduce((a,b)=>a+b,0);if(s<=0)return null;return Object.fromEntries(OUTCOMES.map((k,i)=>[k,vals[i]/s]));};
const outcome=m=>Number.isInteger(m.home_score)&&Number.isInteger(m.away_score)?m.home_score>m.away_score?'1':m.home_score===m.away_score?'X':'2':null;
export function newLearningState(competition){
 if(!competition||typeof competition!=='string')throw Error('Competition is required');
 return {version:1,competition,events:[],loss:Object.fromEntries(KEYS.map(k=>[k,0])),
   observations:Object.fromEntries(KEYS.map(k=>[k,0])),accuracy:{correct:0,settled:0},updatedAt:null};
}
function validateState(s,competition){
 if(!s||s.version!==1||s.competition!==competition||!Array.isArray(s.events))throw Error('Wrong competition/model state');
}
function weights(state,expertNames){
 const scores=expertNames.map(k=>{
  const n=state.observations[k]||0,loss=state.loss[k]||0;
  // Mean log loss with Bayesian shrinkage. Works when odds are rarely available.
  const effective=(loss+1.05*16)/(n+16);
  return [k,Math.log(INIT[k]||.05)-3.5*effective];
 });
 const max=Math.max(...scores.map(s=>s[1]));
 const exp=scores.map(([k,v])=>[k,Math.exp(v-max)]);
 const total=exp.reduce((s,x)=>s+x[1],0);
 const floor=expertNames.length>1?.018:0;
 return Object.fromEntries(exp.map(([k,v])=>[k,floor+(1-expertNames.length*floor)*v/total]));
}
function getExperts(pred,odds){
 const result={model:norm(pred?.probabilities),poisson:norm(pred?.poisson),elo:norm(pred?.elo)};
 const h=Number(odds?.home),d=Number(odds?.draw),a=Number(odds?.away);
 if([h,d,a].every(v=>Number.isFinite(v)&&v>1.01&&v<=100))
 result.market=norm({'1':1/h,X:1/d,'2':1/a});
 return Object.fromEntries(Object.entries(result).filter(([k,v])=>v!==null));
}
function snapshotAt(state,asOf) {
 const target=ms(asOf);
 if(target===null)throw Error('Invalid prediction timestamp');
 // Replay from immutable events: a forecast must not use outcomes known later.
 const copy=newLearningState(state.competition);
 for(const e of state.events
  .filter(x=>x.settledAt&&ms(x.settledAt)!==null&&ms(x.settledAt)<target)
  .sort((a,b)=>ms(a.settledAt)-ms(b.settledAt)||a.id.localeCompare(b.id))){
   updateStats(copy,e);
 }
 return copy;
}
function updateStats(s,e){
 const y=e.actual;
 for(const [key,p] of Object.entries(e.experts||{})){
  if(!KEYS.includes(key))continue;
  const n=norm(p);
  if(!n)continue;
  s.loss[key]=s.loss[key]*.995-Math.log(clamp(n[y],1e-5,1));
  s.observations[key]=s.observations[key]*.995+1;
 }
 s.accuracy.settled++;if(e.pick===y)s.accuracy.correct++;
 s.updatedAt=e.settledAt;
}
export function adaptivePrediction(competition,pred,odds,state,asOf){
 validateState(state,competition);
 const replay=snapshotAt(state,asOf);
 const experts=getExperts(pred,odds);
 const names=Object.keys(experts);
 if(!names.length)throw Error('No usable pre-match predictions');
 const w=weights(replay,names);
 const out={};
 for(const k of OUTCOMES)out[k]=names.reduce((s,expert)=>s+w[expert]*experts[expert][k],0);
 const sorted=[...OUTCOMES].sort((a,b)=>out[b]-out[a]),pick=sorted[0];
 return {competition,probabilities:out,pick,confidence:out[pick],
   experts,weights:w,modelVersion:'online-1',learnedFrom:replay.accuracy.settled,
   explanation:'Hedge ensemble; expert weights updated after settled matches only'};
}
export function recordForecast(state,entry) {
 validateState(state,entry.competition);
 const id=String(entry.id??''),at=ms(entry.predictedAt),kickoff=ms(entry.kickoff);
 if(!id||at===null||kickoff===null||at>=kickoff)throw Error('A forecast must be saved before kickoff');
 if(state.events.some(e=>e.id===id))return false; // Immutable first timestamp / first tip.
 const probs=norm(entry.probabilities);
 if(!probs||!OUTCOMES.includes(entry.pick)||!entry.experts)throw Error('Invalid predicted probabilities');
 const experts=Object.fromEntries(Object.entries(entry.experts).map(([key,value])=>[key,norm(value)]).filter(([key,v])=>KEYS.includes(key)&&v));
 if(!Object.keys(experts).length)throw Error('No expert snapshot to learn from');
 state.events.push({id,competition:state.competition,predictedAt:entry.predictedAt,kickoff:entry.kickoff,
  pick:entry.pick,probabilities:probs,experts,actual:null,settledAt:null});
 return true;
}
export function settleResult(state,{id,home_score,away_score,settledAt}){
 const item=state.events.find(x=>x.id===String(id));
 if(!item)return false;
 if(item.settledAt)return false; // Idempotent; never retrain twice.
 const y=outcome({home_score,away_score}),time=ms(settledAt);
 if(!y||time===null||time<=ms(item.kickoff))throw Error('A result is not verifiable before kickoff');
 item.actual=y;item.settledAt=settledAt;
 // Derive next state from event log; this enables replay as-of every historical moment.
 const updated=snapshotAt(state,new Date(time+1).toISOString());
 state.loss=updated.loss;state.observations=updated.observations;
 state.accuracy=updated.accuracy;state.updatedAt=updated.updatedAt;
 return true;
}
export function rebuildLearningState(raw,asOf){
 validateState(raw,raw.competition);
 const result=snapshotAt(raw,asOf);
 result.events=raw.events.filter(e=>ms(e.predictedAt)<ms(asOf)).map(e=>({
   ...e,actual:e.settledAt&&ms(e.settledAt)<ms(asOf)?e.actual:null,
   settledAt:e.settledAt&&ms(e.settledAt)<ms(asOf)?e.settledAt:null
 }));
 return result;
}
export function learningSummary(state,asOf){
 const s=snapshotAt(state,asOf);
 return {competition:state.competition,settled:s.accuracy.settled,
   correct:s.accuracy.correct,accuracy:s.accuracy.settled?round(s.accuracy.correct/s.accuracy.settled):null,
   expertWeight:weights(s,KEYS.filter(k=>s.observations[k]>0||k!=='market')),updatedAt:s.updatedAt};
}
