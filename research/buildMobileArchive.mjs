import {loadCzechArchive} from './czechHistory.mjs';
import {writeFile} from 'node:fs/promises';
// Downloads only CC0 OpenFootball seasons; makes coverage explicit in UI.
const {matches,coverage,verifiedSeasons,missing}=await loadCzechArchive();
const json=JSON.stringify({matches,coverage,verifiedSeasons,missing:missing.map(x=>x.season)});
await writeFile('app/src/main/assets/czArchive.js','globalThis.CZ_ARCHIVE = '+json+';\n');
console.log('BUNDLED_CZECH_HISTORY',JSON.stringify(coverage));
