const url='https://sazkyweb.cz/tipsport-kurzy-dnes.html';
try {
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; SportPredictorAI/2.3; research; personal-use)','Accept':'text/html'},signal:AbortSignal.timeout(13000)});
 const html=await response.text();
 const plain=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|amp|quot);/g,' ').replace(/\s+/g,' ').trim().slice(0,520);
 const rows=[...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(x=>x[0]);
 const tables=[...html.matchAll(/<table\b[^>]*>/gi)].map(x=>x[0]);
 console.log('SOURCE_SNAPSHOT',JSON.stringify({status:response.status,length:html.length,url:response.url,
  tableCount:tables.length,rowCount:rows.length,tableSamples:tables.slice(0,3),
  rowSamples:rows.filter(x=>/chance liga|premier league|extraliga/i.test(x)).slice(0,4).map(x=>({html:x.slice(0,1700),plain:plain(x)})),
  rowFallback:rows.slice(0,2).map(x=>x.slice(0,1200)),
  embeddedJson:/application\/ld\+json/i.test(html),
  timestamp:html.match(/Aktualizov[aá]no[^<]{0,100}/i)?.[0]||null
 }));
} catch(e) {
 console.log('SOURCE_SNAPSHOT_ERROR',String(e));
 process.exitCode=1;
}
