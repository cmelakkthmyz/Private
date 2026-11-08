import {loadCzechArchive} from './czechHistory.mjs';
import {loadEnglishArchive} from './openFootballEngland.mjs';
import {writeFile,readFile} from 'node:fs/promises';
const {matches,coverage,verifiedSeasons,missing}=await loadCzechArchive();
await writeFile('app/src/main/assets/czArchive.js','globalThis.CZ_ARCHIVE = '+
 JSON.stringify({matches,coverage,verifiedSeasons,missing:missing.map(x=>x.season)})+';\n');
console.log('BUNDLED_CZECH_HISTORY',JSON.stringify(coverage));
let english;
try{
 english=JSON.parse(await readFile('research/results/openfootball-full.json','utf8'));
 if(!english?.coverage?.allComplete)throw Error('Incomplete local archive');
}catch{
 english=await loadEnglishArchive();
}
const safeArchive={matches:english.matches,
 coverage:english.coverage,verifiedSeasons:english.reports.filter(x=>x.verified).map(x=>x.season),
 source:'OpenFootball England · CC0 public domain'};
await writeFile('app/src/main/assets/engArchive.js',
 'globalThis.ENG_ARCHIVE = '+JSON.stringify(safeArchive)+';\n');
console.log('BUNDLED_ENGLISH_HISTORY',JSON.stringify(english.coverage));
