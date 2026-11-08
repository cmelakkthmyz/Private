import test from 'node:test';
import assert from 'node:assert/strict';
import {hockeyTeamKey,hockeyStandingsProfile,hockeyFixtureRates,calibrateRegulationHockey} from './hockeyV2.mjs';

const names=['Třinec','Pardubice','Kladno','Karlovy Vary','České Budějovice','Sparta Praha',
 'Plzeň','Liberec','Hradec Králové','Kometa Brno','Litvínov',
 'Mladá Boleslav','Vítkovice','Olomouc'];
function makeStandings(){
 return names.map((tym,i)=>({tym,zapasy:17,skore:(70-i*3)+':'+(37+i*2),
  vyhry_prodl:(i%3)+1,prohry_prodl:i%2,vyhry:10-i%4,prohry:4+i%4}));
}
test('Czech hockey name aliases identify the same team',()=>{
 assert.equal(hockeyTeamKey('HC Oceláři Třinec'),hockeyTeamKey('Třinec'));
 assert.equal(hockeyTeamKey('Bílí Tygři Liberec'),'Liberec');
 assert.equal(hockeyTeamKey('HC Motor České Budějovice'),'České Budějovice');
 assert.equal(hockeyTeamKey('HC Energie Karlovy Vary'),'Karlovy Vary');
 assert.equal(hockeyTeamKey('HC Verva Litvínov'),'Litvínov');
});
test('hockey standings profile requires reliable number of teams',()=>{
 assert.equal(hockeyStandingsProfile(makeStandings().slice(0,5)),null);
 assert.equal(hockeyStandingsProfile(makeStandings()).teams.size,14);
});
test('OT draws per team represent 60-minute ties, not wins',()=>{
 const p=hockeyStandingsProfile(makeStandings());
 const expected=makeStandings().reduce((a,t)=>a+t.vyhry_prodl+t.prohry_prodl,0)/238;
 assert.ok(Math.abs(p.observedRegulationDraw-expected)<1e-12);
});
test('goal projections separate stronger and weaker clubs',()=>{
 const table=hockeyStandingsProfile(makeStandings());
 const f=hockeyFixtureRates(table,'HC Oceláři Třinec','HC Olomouc');
 const r=hockeyFixtureRates(table,'HC Olomouc','HC Oceláři Třinec');
 assert.ok(f.homeBase>r.homeBase);
 assert.ok(f.homeBase>f.awayBase);
});
test('not invent hockey fixture data when standings missing',()=>{
 const p=hockeyFixtureRates(null,'A','B');
 assert.equal(p.source,'untrained hockey prior');
 assert.equal(p.homeBase,3.12);
});
test('calibration preserves normalized 60-minute probabilities',()=>{
 const t=hockeyStandingsProfile(makeStandings());
 const old={'1':.55,X:.12,'2':.33};
 const prediction={pick:'1',probabilities:old,poisson:old,elo:old};
 const after=calibrateRegulationHockey(prediction,t);
 const p=after.probabilities;
 assert.ok(Math.abs(p['1']+p.X+p['2']-1)<1e-12);
 assert.ok(p.X>old.X);
 assert.equal(after.marketUsed,undefined);
});
test('60-minute X remains possible even if the match has overtime winner',()=>{
 const t=hockeyStandingsProfile(makeStandings());
 const neutral={'1':.36,X:.28,'2':.36};
 const p=calibrateRegulationHockey({pick:'1',probabilities:neutral,poisson:neutral,elo:neutral},t);
 assert.ok(p.probabilities.X>0);
 assert.ok(p.hockeyRegulation);
});
