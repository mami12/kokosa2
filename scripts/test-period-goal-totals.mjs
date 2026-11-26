import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parsePeriodGoalTotal,isPeriodGoalTotal,gradePeriodGoalTotal} from '../server/ledger/period-goal-totals.mjs';
import {gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
const result={home_score:3,away_score:2,half_home_score:1,half_away_score:0,
 home_team:'Home',away_team:'Away'};
const quote=(market_name,outcome_name,line='',period=0)=>({market_name,outcome_name,line,period});
for(const market_name of ['Anytime Goalscorer','First Goalscorer','Last Goalscorer',
  'Player to score','Player X Goals']){
  assert.equal(isPeriodGoalTotal(quote(market_name,'Player X')),false,
    'An individual scorer proposition cannot be graded from match goals: '+market_name);
}
for(const [market,label,line,expected]of [
 ['1st Half Total Goals','Over','0.5','WON'],
 ['2nd Half Goals','Over 3.5','','WON'],
 ['Home Team Goals 2nd Half','Under 2.5','','WON'],
 ['2nd Half Away Team Total Goals','Over 1.5','','WON'],
 ['Total Goals 1st Half','Exactly 1','','WON'],
 ['1st Half Team 1 Total Goals','Under','1.0','VOID'],
 ['Full Time Total Goals','Over 4.5','','WON'],
 ['2nd Half Goals','Over 4.0','','VOID'],
 ['First Half Total Goals','Under 0.5','','LOST'],
 ['First Half Home Goals','Over 0.5','','WON'],
 ['2nd Half Goals','3+','','WON']
]){
 const ticket=quote(market,label,line);
 const contract=parsePeriodGoalTotal(ticket,result);
 assert.ok(contract,'Unable to parse '+market);
 assert.equal(gradePeriodGoalTotal(contract,result),expected,market);
 assert.equal(gradeLine(ticket,result),expected,
  'Historical ticket must use same period totals as new frozen bets');
 assert.equal(hasRequiredSettlementEvidence(ticket,result),true);
 assert.equal(await gradeStoredEventContract({live_contract:contract},result,
  {execute:()=>{throw Error('HT/FT scoreboard should not fetch incident list');}}),expected);
}
for(const ticket of [
 quote('First Half Total Goals','Over 1.25'),
 quote('2nd Half Home Team Goals','Over 2.5','1.5'),
 quote('2nd Half Total Goals','Over 1.5','1.5',1),
 quote('Total Corners','Over 5.5'),
 quote('Player Total Goals','Over 1.5'),
 quote('Result and Total Goals','1 and Over 3.5')
]){
 if(['Total Corners','Player Total Goals','Result and Total Goals'].includes(ticket.market_name)){
  assert.equal(isPeriodGoalTotal(ticket),false,'Different market family');
 }else{
  assert.equal(parsePeriodGoalTotal(ticket,result),null,'Malformed period or line');
  assert.equal(gradeLine(ticket,result),null,'Never grade malformed total from match goals');
 }
}
assert.equal(gradePeriodGoalTotal(parsePeriodGoalTotal(quote('2nd Half Total Goals','Over 1.5')),{
 ...result,half_home_score:null}),null);
assert.equal(gradePeriodGoalTotal(parsePeriodGoalTotal(quote('2nd Half Total Goals','Over 1.5')),{
 ...result,half_home_score:9}),null);
assert.equal(gradeLine(quote('2nd Half Away Team Goals','Over 1.5'),result),'WON');
assert.equal(parsePeriodGoalTotal(quote('Home team exact goals','Over 2.5'),result),null,
 'Exact Goals is a count selection, never a generic Over/Under team total');
assert.equal(gradeLine(quote('Home team exact goals','Over 2.5'),result),null,
 'Wrongly-labeled exact market is not a team Over payout');
assert.equal(gradeLine(quote('Home team exact goals','Exactly 3'),result),'WON',
 'Genuine home exact-goal selection uses only home score, not both teams');

// The 6+/9+ suffix is a catalogue cap, not the winning threshold.
// The numbered outcome remains an exact match-goal count.
for (const market of ['Exact goals 6+','Exact goals 9+']) {
 const ticket=quote(market,'5');
 const contract=parsePeriodGoalTotal(ticket,result);
 assert.equal(contract?.selection,'exact',market+' uses the selected exact count');
 assert.equal(contract?.target,5,market+' does not impose the catalogue suffix as a minimum');
 assert.equal(gradePeriodGoalTotal(contract,result),'WON');
 assert.equal(gradeLine(ticket,result),'WON');
 assert.equal(hasRequiredSettlementEvidence(ticket,result),true);
}

// Provider labels without a space are normalized, and multigoals remains
// team-scoped instead of accidentally counting both sides.
const multi=quote('Multigoals awayteam','2');
assert.equal(parsePeriodGoalTotal(multi,result)?.side,'away');
assert.equal(gradeLine(multi,result),'WON');
const htResult={...result,home_score:2,away_score:3,half_home_score:2,half_away_score:1};
for (const [market,outcome,expected] of [
 ['1st Half Goals awayteam','1','WON'],
 ['1st Half Goals hometeam','2','WON'],
 ['Halftime - Total 3','Over','VOID'],
 ['Halftime - Total 3','Under','VOID']
]) {
 const ticket=quote(market,outcome,market==='Halftime - Total 3'?'3':'');
 const contract=parsePeriodGoalTotal(ticket,htResult);
 assert.ok(contract,market+' contract parses');
 assert.equal(contract.half,1,market+' uses verified first-half score');
 assert.equal(gradePeriodGoalTotal(contract,htResult),expected);
 assert.equal(gradeLine(ticket,htResult),expected);
 assert.equal(hasRequiredSettlementEvidence(ticket,htResult),true);
}



for(const [market,outcome,expected] of [
 ['Number of Goals 7+','4-6 goals','WON'],
 ['Number of Goals 7+','0-1 goals','LOST'],
 ['Number of Goals 7+','7+ goals','LOST'],
 ['Number of Goals 6+','4-5 goals','WON'],
 ['Multigoals awayteam','2-3','WON'],
 ['Multigoals awayteam','4+','LOST'],
 ['Multigoals hometeam','1-2','LOST']
]){
 const ticket=quote(market,outcome);
 const contract=parsePeriodGoalTotal(ticket,result);
 assert.ok(contract,market+' parses selection '+outcome);
 assert.equal(gradePeriodGoalTotal(contract,result),expected,market+' '+outcome);
 assert.equal(gradeLine(ticket,result),expected,'legacy ticket '+market+' '+outcome);
 assert.equal(hasRequiredSettlementEvidence(ticket,result),true);
}

console.log('PASS half/team/match goals O/U, exact, 3+, integer pushes, contradictory half/FT and no incident SQL');
