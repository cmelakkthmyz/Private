import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8',
 '.css':'text/css;charset=utf-8'};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1').pathname;
 const file=resolve(root,'.'+url);
 if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
 try{const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(data);}
 catch{res.writeHead(404);res.end('not found');}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const port=server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,
 isMobile:true,hasTouch:true});
const page=await ctx.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 const future=h=>new Date(Date.now()+h*3600000).toISOString();
 const event=(id,home,away,h)=>({
  id,date:future(h),status:{type:{completed:false,name:'STATUS_SCHEDULED'}},
  competitions:[{competitors:[{homeAway:'home',team:{displayName:home}},
   {homeAway:'away',team:{displayName:away}}]}]
 });
 const model={
  pl:[event('101','Arsenal','Brentford',12),event('102','Chelsea','Fulham',13),
    event('103','Manchester City','Everton',14)],
  cz:[event('201','Sparta Praha','Slavia Praha',12),event('202','Viktoria Plzeň','Baník Ostrava',13)],
  hockey:[]
 };
 const clubs=['Třinec','Pardubice','Kladno','Karlovy Vary','České Budějovice','Sparta Praha','Plzeň',
  'Liberec','Hradec Králové','Kometa Brno','Litvínov','Mladá Boleslav','Vítkovice','Olomouc'];
 const standings=clubs.map((tym,i)=>({tym,zapasy:18,skore:(62-i*2)+':'+(34+i*2),vyhry_prodl:i%3,prohry_prodl:i%2}));
 const offers=[
  ['pl','Arsenal','Brentford',12],['pl','Chelsea','Fulham',13],['pl','Manchester City','Everton',14],
  ['cz','Sparta Praha','Slavia Praha',12],['cz','Viktoria Plzeň','Baník Ostrava',13],
  ['hockey','Třinec','Olomouc',12],['hockey','Pardubice','Kometa Brno',13]
 ].map(([league,home,away,h],i)=>({id:String(600+i),league,home,away,kickoff:future(h),
  odds:{'1':2.7,X:3.1,'2':3.2},fetchedAt:new Date().toISOString(),bookmaker:'Tipsport',
  sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'}));
 const safeCall=(callback)=>setTimeout(callback,100);
 window.AndroidPredictor={
  loadFixtures(league){
   window.__leagueRequests=(window.__leagueRequests||0)+1;
   safeCall(()=>{
    if(league==='hockey')
     window.receiveMatches(JSON.stringify({sport:'hockey',standings,updated:new Date().toISOString(),
      scheduleCurrent:true,events:[
       {id:'h1',home:'Třinec',away:'Olomouc',date:future(12)},
       {id:'h2',home:'Pardubice',away:'Kometa Brno',date:future(13)}]}),league);
    else window.receiveMatches(JSON.stringify({events:model[league]||[]}),league);
   });
  },
  loadOdds(){window.__oddsRequests=(window.__oddsRequests||0)+1;
   safeCall(()=>window.receiveOdds(JSON.stringify({offers,fetchedAt:new Date().toISOString()})));},
  loadPaperHockeyResults(dates){
   window.__hockeyCheckRequests=(window.__hockeyCheckRequests||0)+1;
   safeCall(()=>window.receivePaperHockeyResults(JSON.stringify({
    results:[],unavailableDates:JSON.parse(dates),checkedAt:new Date().toISOString()})));
  },
  loadAllLeagues(){
   window.__fullScanRequests=(window.__fullScanRequests||0)+1;
   const names=['Arsenal','Liverpool','Brentford','Chelsea','Fulham','Everton','Manchester City',
    'Manchester United','Tottenham Hotspur','Aston Villa','Brighton','Newcastle United',
    'Wolverhampton Wanderers','West Ham United','Nottingham Forest','Burnley',
    'Leeds United','Bournemouth','Crystal Palace','Sunderland'];
   const teams=names.map(id=>({id,attack:72,defense:70}));
   const players=Array.from({length:230},(_,i)=>({
    name:'Example '+i,team_id:names[i%20],minutes:400,xg:1,xa:.2,
    availability:i%29===0?'i':'a',chance_of_playing_next_round:i%29===0?0:100}));
   const context={teams,players,fetchedAt:new Date().toISOString(),
    source:'Fantasy Premier League public API',
    futureCupFixtures:[{team_id:'Arsenal',kickoff:future(48),
     competition:'Liga mistrů',stage:'knockout',verified:true}]};
   safeCall(()=>window.receiveAllLeagues(JSON.stringify({
    pl:{events:model.pl,context},cz:{events:model.cz},
    hockey:{sport:'hockey',standings,updated:new Date().toISOString(),
     scheduleCurrent:true,events:[{id:'h1',home:'Třinec',away:'Olomouc',date:future(12)},
      {id:'h2',home:'Pardubice',away:'Kometa Brno',date:future(13)}]}
   })));
  }
 };
});
try {
 const errorsSummary=[];
 await page.goto('http://127.0.0.1:'+port+'/app/src/main/assets/index.html',{waitUntil:'load',timeout:60000});
 await page.waitForFunction(()=>document.querySelector('#odds-total')?.textContent==='7',{timeout:25000});
 await page.waitForFunction(()=>document.querySelector('#odds-matched')?.textContent==='7',{timeout:35000});
 assert.equal(await page.locator('#odds-total').innerText(),'7');
 assert.equal(await page.locator('#league-pl').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#ticket-odds-0').count(),0);
 await page.locator('#profile-longshot').click();
 assert.equal(await page.locator('#profile-longshot').getAttribute('aria-pressed'),'true');
 await page.locator('#profile-draws').click();
 assert.equal(await page.locator('#profile-draws').getAttribute('aria-pressed'),'true');
 await page.locator('#profile-balanced').click();
 await page.locator('#stake-10').click();
 assert.equal(await page.locator('#stake-10').getAttribute('aria-pressed'),'true');
 await page.locator('#stake-20').click();
 assert.equal(await page.locator('#stake-20').getAttribute('aria-pressed'),'true');
 await page.locator('#scan-odds').click();
 await page.waitForFunction(()=>window.__oddsRequests>=2,{timeout:5000});
 await page.waitForFunction(()=>document.querySelector('#odds-total')?.textContent==='7',{timeout:15000});
 await mkdir('research/screenshots',{recursive:true});
 await page.locator('.factor-list summary').first().click();
 assert.ok(await page.locator('.factor-list li').first().isVisible());
 assert.equal(await page.locator('#paper-create').isDisabled(),false);
 await page.locator('#paper-create').click();
 await page.waitForFunction(()=>document.querySelector('#paper-pending')?.textContent==='1',{timeout:15000});
 assert.ok(await page.locator('#paper-history').innerText().then(x=>x.includes('Čeká na výsledky')));
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('sport-predictor-paper-v1')));
 assert.equal(saved.tickets.length,1);
 assert.ok(saved.tickets[0].legs.every(x=>x.status==='pending'));
 await page.locator('#paper-check').click();
 await page.waitForFunction(()=>window.__fullScanRequests>=2,{timeout:12000});
 await page.screenshot({path:'research/screenshots/android-paper-simulation-pl.png',fullPage:true});
 await page.screenshot({path:'research/screenshots/android-auto-odds-pl.png',fullPage:true});
 await page.locator('#league-cz').click();
 await page.waitForFunction(()=>document.querySelector('#matches')?.textContent.includes('Sparta Praha'),{timeout:15000});
 assert.equal(await page.locator('#league-cz').getAttribute('aria-pressed'),'true');
 await page.screenshot({path:'research/screenshots/android-auto-odds-cz.png',fullPage:true});
 await page.locator('#league-hockey').click();
 await page.waitForFunction(()=>document.querySelector('#matches')?.textContent.includes('Třinec'),{timeout:15000});
 assert.equal(await page.locator('#league-hockey').getAttribute('aria-pressed'),'true');
 await page.screenshot({path:'research/screenshots/android-auto-odds-hockey.png',fullPage:true});
 // Exact user-recording regression: 15 published offers but only 2 verified
 // fixtures, Remízy should display a visible paper-only combination instead of blank.
 await page.evaluate(()=>{
  const now=new Date();
  const future=h=>new Date(now.getTime()+h*3600000).toISOString();
  const event=(id,home,away,at)=>({
   id,date:at,status:{type:{completed:false,name:'STATUS_SCHEDULED'}},
   competitions:[{competitors:[
    {homeAway:'home',team:{displayName:home}},
    {homeAway:'away',team:{displayName:away}}]}]});
  const first=future(12),second=future(13),priceTime=new Date().toISOString();
  window.receiveAllLeagues(JSON.stringify({
   pl:{events:[event('991','Arsenal','Liverpool',first),
    event('992','Chelsea','Fulham',second)]},
   cz:{error:'No comparable schedule for this screen test'},
   hockey:{error:'No comparable schedule for this screen test'}
  }));
  const offers=[
   {id:'live991',league:'pl',home:'Arsenal',away:'Liverpool',kickoff:first,
    odds:{'1':2.3,X:3.45,'2':3.9},bookmaker:'Tipsport',
    fetchedAt:priceTime,sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'},
   {id:'live992',league:'pl',home:'Chelsea',away:'Fulham',kickoff:second,
    odds:{'1':2.15,X:3.65,'2':4.2},bookmaker:'Tipsport',
    fetchedAt:priceTime,sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'},
   ...Array.from({length:13},(_,i)=>({id:'other'+i,league:'cz',
    home:'Unknown Club '+i,away:'Another Club '+i,kickoff:second,
    odds:{'1':2.4,X:3.1,'2':3.65},bookmaker:'Tipsport',
    fetchedAt:priceTime,sourceUrl:'https://sazkyweb.cz/tipsport-kurzy-dnes.html'}))
  ];
  window.receiveOdds(JSON.stringify({offers,fetchedAt:priceTime}));
 });
 await page.locator('#profile-draws').click();
 await page.waitForFunction(()=>document.querySelector('#odds-matched')?.textContent==='2',{timeout:12000});
 assert.equal(await page.locator('#odds-total').innerText(),'15');
 assert.ok((await page.locator('#auto-results').innerText()).includes('POUZE SIMULACE'));
 assert.ok((await page.locator('#auto-results').innerText()).includes('Arsenal'));
 assert.ok((await page.locator('#auto-results').innerText()).includes('Chelsea'));
 await page.screenshot({path:'research/screenshots/android-remizy-15-offers-2-matches-fixed.png',fullPage:true});
 const beforeCount=await page.evaluate(()=>JSON.parse(localStorage.getItem('sport-predictor-paper-v1'))?.tickets?.length||0);
 await page.locator('#auto-results .ticket-paper-action').first().click();
 const afterCount=await page.evaluate(()=>JSON.parse(localStorage.getItem('sport-predictor-paper-v1'))?.tickets?.length||0);
 assert.equal(afterCount,beforeCount+1,'Experimental ticket save button must work');

 const layout=await page.evaluate(()=>({bodyWidth:document.body.scrollWidth,screen:window.innerWidth,
   buttons:[...document.querySelectorAll('button')].map(x=>({id:x.id,width:Math.round(x.getBoundingClientRect().width)}))}));
 assert.ok(layout.bodyWidth<=layout.screen+6,'Horizontal overflow '+JSON.stringify(layout));
 assert.equal(errors.length,0,'Page JS errors: '+errors.join('; '));
 console.log('VISUAL_UI_SMOKE_PASSED',JSON.stringify({
  screenshots:['android-paper-simulation-pl.png','android-auto-odds-pl.png','android-auto-odds-cz.png','android-auto-odds-hockey.png','android-remizy-15-offers-2-matches-fixed.png'],
  oddsScanned:7,profileButtons:3,stakeButtons:3,leagueSwitches:3,buttonWidths:layout.buttons.length,
  pageErrors:errors.length,bodyWidth:layout.bodyWidth,mobileWidth:layout.screen}));
}catch(e){console.error('VISUAL_UI_SMOKE_FAILED',String(e),errors);process.exitCode=1}
finally{await browser.close();await new Promise(ok=>server.close(ok));}
