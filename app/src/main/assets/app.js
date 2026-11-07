(function(){
'use strict';
const {TEAM_NAMES,baseline,predict,ratingsFromResults}=globalThis.PLModel;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const pct=p=>(100*p).toFixed(1)+' %';
const names={'Man City':'Manchester City','Man United':'Manchester United','Manchester Utd':'Manchester United','Spurs':'Tottenham Hotspur','Wolves':'Wolverhampton Wanderers','Nottm Forest':'Nottingham Forest','Brighton & Hove Albion':'Brighton','West Ham':'West Ham United','Newcastle':'Newcastle United','AFC Bournemouth':'Bournemouth','Leeds':'Leeds United'};
const normalize=n=>names[n]||String(n||'').replace(/ FC$/,'');
function card(home,away,model,info,quality){
 return '<article class="match"><div class="date">'+esc(info||'')+'</div><div class="teams">'+esc(home)+'<br><span class="versus">vs.</span><br>'+esc(away)+'</div><div class="result"><div>Tip 1 / X / 2<div class="pick">'+esc(model.pick)+'</div></div><div>Přesné skóre<div class="score">'+esc(model.score)+'</div></div></div><div class="prob">'+['1','X','2'].map(k=>'<div>'+k+'<strong>'+pct(model.probabilities[k])+'</strong></div>').join('')+'</div><div class="meta">xG '+model.xg.home.toFixed(2)+' : '+model.xg.away.toFixed(2)+' · Nad 2,5 gólu: '+pct(model.over25)+' · Oba skórují: '+pct(model.btts)+'<br>'+(quality==='season-results'?'Výpočet využívá odehrané zápasy aktuální sezóny.':'Odhad používá omezené statistiky a ligový základ.')+'</div></article>';
}
function parseEvent(e){
 const c=e.competitions?.[0]?.competitors||[];
 const h=c.find(x=>x.homeAway==='home'),a=c.find(x=>x.homeAway==='away');
 if(!h||!a)return null;
 const completed=e.status?.type?.completed===true||e.status?.type?.name==='STATUS_FINAL';
 return {id:e.id,date:e.date,home:normalize(h.team?.displayName),away:normalize(a.team?.displayName),homeScore:completed?Number(h.score):null,awayScore:completed?Number(a.score):null,status:completed?'STATUS_FINAL':(e.status?.type?.name||'STATUS_SCHEDULED')};
}
function renderEvents(events,updated,isCache){
 const data=events.map(parseEvent).filter(Boolean);
 if(!data.length)throw Error('Zdroj nevrátil žádné zápasy');
 const ratings=ratingsFromResults(data);
 const now=Date.now();
 const matches=data.filter(e=>e.status!=='STATUS_FINAL'&&Date.parse(e.date)>now-2*3600000).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).slice(0,30);
 $('matches').innerHTML=matches.length?matches.map(m=>{
   const h=ratings[m.home]||baseline[m.home]||baseline.Arsenal;
   const a=ratings[m.away]||baseline[m.away]||baseline.Arsenal;
   const quality=(h.played||0)>3&&(a.played||0)>3?'season-results':'baseline';
   return card(m.home,m.away,predict(h,a),new Date(m.date).toLocaleString('cs-CZ',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}),quality);
 }).join(''):'Z aktuálních dat nejsou dostupné žádné další zápasy.';
 $('status').className='';
 $('status').textContent=(isCache?'Uložený rozpis (offline)':'Aktuální rozpis ESPN')+' · '+matches.length+' nejbližších zápasů · poslední načtení '+new Date(updated).toLocaleString('cs-CZ');
}
function request(){
 $('status').className='';
 $('status').textContent='Načítám aktuální zápasy…';
 if(globalThis.AndroidPredictor?.loadFixtures){globalThis.AndroidPredictor.loadFixtures();}
 else{showCache('Tato verze nepodporuje připojení k Androidu.');}
}
function showCache(error){
 try {
   const cached=JSON.parse(localStorage.getItem('fixtures-v1')||'null');
   if(cached&&Array.isArray(cached.events)){renderEvents(cached.events,cached.updated,true);$('status').className='error';$('status').textContent=error+' Zobrazuji poslední uložená data ('+new Date(cached.updated).toLocaleString('cs-CZ')+').';return;}
 }catch(e){}
 $('status').className='error';$('status').textContent=error+' Vlastní zápas funguje offline.';$('matches').innerHTML='';
}
globalThis.receiveMatches=function(raw){
 try{
   const d=JSON.parse(raw);
   if(d.error)throw Error(d.error);
   if(!Array.isArray(d.events)||!d.events.length)throw Error('ESPN nevrátila zápasy');
   const updated=new Date().toISOString();
   // Cache only the subset required for scoring, to avoid large WebView storage.
   const compact=d.events.map(e=>{
     const c=e.competitions?.[0]?.competitors||[];
     return {id:e.id,date:e.date,status:e.status,competitions:[{competitors:c.map(x=>({homeAway:x.homeAway,score:x.score,team:{displayName:x.team?.displayName}}))}]};
   });
   try{localStorage.setItem('fixtures-v1',JSON.stringify({events:compact,updated}));}catch(e){}
   renderEvents(compact,updated,false);
 }catch(e){showCache('Aktuální zápasy nelze načíst: '+e.message+'.');}
};
for(const id of ['home','away'])$(id).innerHTML=TEAM_NAMES.map(t=>'<option value="'+esc(t)+'">'+esc(t)+'</option>').join('');
$('away').selectedIndex=1;
for(const side of ['home','away'])$(side+'-strength').addEventListener('input',()=>{$(side+'-power').textContent=$(side+'-strength').value;});
$('calc').addEventListener('click',()=>{
 const h=$('home').value,a=$('away').value;
 if(h===a){$('manual-result').innerHTML='<p class="error">Vyber dva různé týmy.</p>';return;}
 const H=Number($('home-strength').value),A=Number($('away-strength').value);
 const model=predict({attack:H,defense:H,form:55},{attack:A,defense:A,form:55});
 $('manual-result').innerHTML=card(h,a,model,'Ruční nastavení síly týmů','baseline');
});
$('refresh').addEventListener('click',request);
request();
})();
