// Offline, analytical comparison of manually entered Chance/Tipsport odds.
// This cannot place bets and never claims a profitable combination exists.
const calc=(n)=>Number(n);
const r=(n,d=4)=>Number(n.toFixed(d));
export function evaluateCombo(legs,stake){
 if(!Array.isArray(legs)||legs.length<2||legs.length>3)
  throw Error('Vyber dva nebo tři zápasy.');
 const wager=calc(stake);
 if(!Number.isFinite(wager)||wager<1||wager>50000)
  throw Error('Zadej orientační vklad 1 až 50 000 Kč.');
 const ids=new Set(),clubs=new Set(),warnings=[];
 let probability=1,odds=1;const details=[];
 for(const leg of legs){
  const p=calc(leg.probability),o=calc(String(leg.odds).replace(',','.'));
  if(!leg.matchId||ids.has(leg.matchId))throw Error('Jedno utkání může být na tiketu pouze jednou.');
  ids.add(leg.matchId);
  if(!Number.isFinite(p)||p<=0||p>=1)throw Error('Neplatný modelový odhad pravděpodobnosti.');
  if(!Number.isFinite(o)||o<=1.01||o>500)throw Error('Zadej platný aktuální kurz pro každý zápas.');
  for(const club of [leg.home,leg.away]){
   const team=String(club||'').trim().toLowerCase();
   if(!team)continue;
   if(clubs.has(team)&&!warnings.includes('Stejný tým hraje ve více zápasech; výsledky nemusejí být nezávislé.'))
    warnings.push('Stejný tým hraje ve více zápasech; výsledky nemusejí být nezávislé.');
   clubs.add(team);
  }
  probability*=p;odds*=o;
  details.push({matchId:leg.matchId,pick:leg.pick,probability:p,odds:o,implied:1/o,
   theoreticalEdge:r(p*o-1,4)});
 }
 const payout=wager*odds,expectedReturn=wager*(probability*odds-1);
 warnings.push('Kombinace předpokládá nezávislé výsledky a správně kalibrované pravděpodobnosti; skutečná šance se může lišit.');
 if(legs.some(x=>x.competition==='cz-hockey'))warnings.push('Hokejové odhady jsou experimentální a nejsou nezávisle ověřené; vypočtené EV není prokázaná výhoda.');
 return {legs:details,stake:wager,combinedProbability:r(probability,7),combinedOdds:r(odds,5),
  impliedCombinedProbability:r(1/odds,7),fairCombinedOdds:r(1/probability,4),
  potentialPayout:r(payout,2),expectedNetValue:r(expectedReturn,2),
  modelEV:r(probability*odds-1,5),warnings,guaranteedProfit:false};
}
