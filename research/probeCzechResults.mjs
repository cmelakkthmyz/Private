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
