// Temporary reproducible real-world Czech score source inspection.
const sources=[
  'https://fotbalapi.denik.cz/api/front/2/competitions',
  'https://fotbalapi.denik.cz/api/front/2/competition-years/current',
  'https://fotbalapi.denik.cz/api/front/2/competition/chance-liga/2026',
  'https://sazkyweb.cz/chance-liga/kolo-14.html',
  'https://sazkyweb.cz/chance-liga/prehled.html'
];
const results=await Promise.all(sources.map(async url=>{
 try{
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/html'},signal:AbortSignal.timeout(10000)});
  const text=await r.text();
  let parsed=null;
  try {const j=JSON.parse(text);parsed={type:Array.isArray(j)?'array':typeof j,
   keys:!Array.isArray(j)&&j&&typeof j==='object'?Object.keys(j).slice(0,20):[],
   body:JSON.stringify(j).slice(0,2400)};}
  catch{
   let snippets=[];
   for(const term of ['odehráno','odehrano','Jablonec','Sparta','Plzeň','zápas','match','data-mid','data-result']){
    let i=text.toLowerCase().indexOf(term.toLowerCase());
    if(i>=0)snippets.push({term,html:text.slice(Math.max(0,i-180),i+350)});
   }
   parsed={bodyStart:text.slice(0,280),snippets};
  }
  return {url,status:r.status,length:text.length,parsed};
 }catch(e){return {url,error:String(e).slice(0,300)}}
}));
console.log('CZECH_SCORE_SOURCE_PROBE',JSON.stringify(results));

const root='https://fotbalapi.denik.cz/api/front/2/';
const urls=[
 'competitions?year=2026','competitions?competitionYear=13',
 'competitions?competitionYearId=13','competitions?competitionYear=2026',
 'competitions?page=2','competitions?limit=400',
 'competition?year=2026','competitions/types','competitions/grades',
 'competitions/categories','seasons/chance-liga/2026','competition/ceska-liga/2026'
];
for(const suffix of urls){
 try{
  const res=await fetch(root+suffix,{signal:AbortSignal.timeout(8000)});
  const text=await res.text();
  let j=null;
  try{j=JSON.parse(text);}catch{}
  const values=Array.isArray(j?.results)?j.results:Array.isArray(j)?j:Array.isArray(j?.data)?j.data:[];
  const league=values.filter(x=>/liga|first/i.test(String(x.name||x.originName||''))&&
    /chance|první|1\.|gambrinus|synot|fortuna|ceska|česká/i.test(String(x.name||x.originName||'')));
  console.log('DENIK_CANDIDATE',JSON.stringify({suffix,status:res.status,count:j?.total,
   results:values.length,leagues:league.map(x=>({id:x.id,name:x.name,slug:x.slug,
    year:x.competitionYear?.year,current:x.competitionYear?.current,
    uuid:x.competitionUuid})).slice(-14),
   body:values.length?null:text.slice(0,480)}));
 }catch(e){console.log('DENIK_CANDIDATE_ERROR',suffix,String(e).slice(0,110))}
}

for(const suffix of ['competitions?year=2026&limit=1000',
 'competitions/types/1-liga?year=2026','competitions/types/1-liga?year=2026&limit=100',
 'competitions/grades/celostatni-ligy?year=2026&limit=100']){
 try{
  const r=await fetch(root+suffix,{signal:AbortSignal.timeout(11000)});
  const j=await r.json();
  const list=Array.isArray(j.results)?j.results:Array.isArray(j)?j:Array.isArray(j.data)?j.data:[];
  const top=list.filter(x=>(x.type?.id===11||/chance liga|fortuna liga|gambrinus liga|synot liga/i.test(x.name||''))&&
   x.category?.type==='A');
  console.log('DENIK_CURRENT_TOP',JSON.stringify({suffix,status:r.status,total:j.total,
   listCount:list.length,top:top.slice(-30).map(x=>({id:x.id,slug:x.slug,name:x.name,
    year:x.competitionYear?.year,type:x.type?.name}))}));
 }catch(e){console.log('DENIK_CURRENT_TOP_ERROR',suffix,String(e).slice(0,130))}
}
