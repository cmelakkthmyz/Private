// Discovery only: browser without login, no circumvention, no credentials.
// Reports whether the public Chance odds page exposes a verifiable event/odds feed.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const destination='https://www.chance.cz/kurzy';
const started=new Date().toISOString();
const capture={started,url:destination,navigation:null,requests:[],pageTitle:'',visibleText:'',errors:[],note:'Discovery only; no user login'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const ctx=await browser.newContext({locale:'cs-CZ',timezoneId:'Europe/Prague',
  viewport:{width:390,height:844}});
 const page=await ctx.newPage();
 page.on('requestfailed',r=>{
  if(capture.errors.length<8)capture.errors.push({url:r.url().split('?')[0].slice(0,180),
    reason:r.failure()?.errorText?.slice(0,120)});
 });
 page.on('response',async response=>{
  try{
   const request=response.request(),type=request.resourceType();
   if(!['xhr','fetch','document'].includes(type))return;
   const url=new URL(response.url()),contentType=response.headers()['content-type']||'';
   if(!/(chance\.cz|tipsport\.cz)/i.test(url.hostname))return;
   const item={host:url.host,path:url.pathname.slice(0,220),status:response.status(),
    type,contentType:contentType.slice(0,90)};
   if(['xhr','fetch'].includes(type)&&/(json|javascript|text|html)/i.test(contentType)){
    const bytes=(await response.body()).subarray(0,1500).toString('utf8');
    item.bodySample=bytes.slice(0,260).replace(/\s+/g,' ');
    item.bytesSampled=bytes.length;
   }
   if(capture.requests.length<90)capture.requests.push(item);
  }catch(e){}
 });
 try{
  const response=await page.goto(destination,{waitUntil:'domcontentloaded',timeout:27000});
  capture.navigation={status:response?.status(),finalUrl:page.url()};
  await page.waitForTimeout(12500);
  capture.pageTitle=(await page.title()).slice(0,120);
  capture.visibleText=(await page.locator('body').innerText({timeout:5000})).slice(0,700).replace(/\s+/g,' ');
 }catch(e){capture.errors.push({navigation:String(e).slice(0,250)});}
 await ctx.close();
}finally{await browser.close();}
capture.completedAt=new Date().toISOString();
await mkdir('research/results',{recursive:true});
await writeFile('research/results/chance-public-probe.json',JSON.stringify(capture,null,2));
console.log('CHANCE_PUBLIC_PROBE',JSON.stringify(capture));
