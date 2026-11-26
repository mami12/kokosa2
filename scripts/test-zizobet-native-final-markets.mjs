import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';

const result={
 home_team:'Chelsea Women',away_team:'Paris Saint-Germain Women',
 home_score:2,away_score:1,half_home_score:1,half_away_score:1,
 corners_home:10,corners_away:6,cards_home:1,cards_away:2,source:'ZIZOBET'
};
const quote=(market_name,outcome_name,extra={})=>({
 market_name,outcome_name,outcome_key:outcome_name,line:'',period:0,...extra
});
const grade=(market,outcome,extra={})=>gradeLine(quote(market,outcome,extra),result);

for(const [market,selection,expected] of [
 ['1st half - Awayteam clean sheet','Yes','LOST'],
 ['1st half - Awayteam clean sheet','No','WON'],
 ['1st half - Hometeam clean sheet','Yes','LOST'],
 ['1st half - Hometeam clean sheet','No','WON'],
 ['2nd half - Awayteam clean sheet','Yes','LOST'],
 ['2nd half - Awayteam clean sheet','No','WON'],
 ['2nd half - Hometeam clean sheet','Yes','WON'],
 ['2nd half - Hometeam clean sheet','No','LOST'],
 ['Clean sheet awayteam','Yes','LOST'],
 ['Clean sheet awayteam','No','WON'],
 ['Clean sheet hometeam','Yes','LOST'],
 ['Clean sheet hometeam','No','WON']
]) {
 const ticket=quote(market,selection);
 assert.equal(gradeLine(ticket,result),expected,market+' '+selection);
 assert.equal(hasRequiredSettlementEvidence(ticket,result),true,
  'A named team and verified scoreboards are sufficient: '+market);
}


// A held Zizobet quote can use a normal grader only after its exact frozen
// provider identity matches. This repairs accepted standard markets without
// opening a generic fallback for unknown compound or event contracts.
const held=(market,outcome,line='',extra={})=>{
 const marketKey='native-market-key',outcomeKey=outcome;
 return quote(market,outcome,{
  line,market_key:marketKey,outcome_key:outcomeKey,
  accepted_contract:{
   sourceProviderId:'ZIZOBET',settlementHold:'NATIVE_FINAL_RULE_UNMAPPED',
   providerMarketName:market,providerOutcomeName:outcome,
   providerMarketKey:marketKey,providerOutcomeKey:outcomeKey,
   line,providerPeriod:0,...extra
  }
 });
};
for(const [market,outcome,line,expected] of [
 ['Match Result','1','','WON'],
 ['Double Chance','X2','','LOST'],
 ['Draw No Bet','1','','WON'],
 ['Clean sheet awayteam','No','','WON'],
 ['Total Goals','Over','2.5','WON'],
 ['Correct Score','2:1','','WON']
]){
 const ticket=held(market,outcome,line);
 assert.equal(gradeLine(ticket,result),expected,'held native '+market+' / '+outcome);
 assert.equal(hasRequiredSettlementEvidence(ticket,result),true,
  'held native quote has sufficient verified evidence: '+market);
}
const heldMultiscore=held('Multiscores','Other home win','',{
 nativeMarketOutcomes:['1:0','2:0','2:1','0:1','0:2']
});
assert.equal(gradeLine(heldMultiscore,{...result,home_score:3,away_score:1}),'WON');
const heldUnknownComposite=held('Double Chance & First Corner','12/1','');
assert.equal(gradeLine(heldUnknownComposite,result),null,
 'an unparsed composite must remain pending even when one constituent looks familiar');
const mismatchedHeld=held('Match Result','1');
mismatchedHeld.market_name='Double Chance';
assert.equal(gradeLine(mismatchedHeld,result),null,
 'a modified display/market name cannot override the immutable accepted quote');

assert.equal(grade('Hometeam odd/even','Even'),'WON');
assert.equal(grade('Awayteam odd/even','Odd'),'WON');
assert.equal(grade('2nd half - Hometeam odd/even','Odd'),'WON');
assert.equal(grade('2nd half - Awayteam odd/even','Even'),'WON');

assert.equal(grade('Winning margin','Hometeam by 1'),'WON');
assert.equal(grade('Winning margin','Awayteam by 1'),'LOST');

assert.equal(grade('2nd half - Multigoals','1-2'),'WON');
assert.equal(grade('2nd half - Multigoals','2-3'),'LOST');
const fiveGoalResult={...result,home_score:3,away_score:2,half_home_score:1,half_away_score:0};
assert.equal(gradeLine(quote('Number of Goals 6+','4-5 goals'),fiveGoalResult),'WON');
assert.equal(gradeLine(quote('Number of Goals 6+','2-3 goals'),fiveGoalResult),'LOST');

const acceptedGrid={accepted_contract:{nativeMarketOutcomes:['1:0','2:0','2:1','0:1','0:2']}};
assert.equal(gradeLine(quote('Multiscores','X',acceptedGrid),result),'LOST');
assert.equal(gradeLine(quote('Multiscores','Other home win',acceptedGrid),result),'LOST');
assert.equal(gradeLine(quote('Multiscores','Other home win',acceptedGrid),
 {...result,home_score:3,away_score:1}),'WON');
assert.equal(gradeLine(quote('Multiscores','Other away win',acceptedGrid),
 {...result,home_score:0,away_score:3}),'WON');
assert.equal(gradeLine(quote('Multiscores','X',acceptedGrid),
 {...result,home_score:1,away_score:1}),'WON');
assert.equal(gradeLine(quote('Multiscores','Other home win'),result),null);

// Named final-result markets use exact fixture team names, not fuzzy prefixes.
const namedResult={...result,home_team:'Rubin Kazan',away_team:'FK Zenit Saint Petersburg',
 home_score:3,away_score:1};
assert.equal(gradeLine(quote('Rubin Kazan to win','Yes'),namedResult),'WON');
assert.equal(gradeLine(quote('Rubin Kazan to win','No'),namedResult),'LOST');
assert.equal(gradeLine(quote('FK Zenit Saint Petersburg to win','Yes'),namedResult),'LOST');
assert.equal(gradeLine(quote('FK Zenit Saint Petersburg to win','No'),namedResult),'WON');
const hajdukResult={...namedResult,home_team:'NK Lokomotiva Zagreb',
 away_team:'Hajduk Split',home_score:1,away_score:2};
assert.equal(gradeLine(quote('Hajduk Split to win','No'),hajdukResult),'LOST',
 'The explicit No selection loses because the exact named team won');
assert.equal(gradeLine(held('Rubin Kazan to win','Yes'),namedResult),'WON',
 'An identity-matched held Zizobet named-team winner can use the final score');
assert.equal(gradeLine(held('Rubin Kazan no bet','2'),namedResult),'LOST',
 'A held named no-bet market settles its frozen 2 outcome against FT');
assert.equal(gradeLine(quote('Rubin Kazan no bet','X'),namedResult),'LOST');
assert.equal(gradeLine(quote('Rubin Kazan no bet','X'),
 {...namedResult,home_score:1,away_score:1}),'WON',
 'The explicit X outcome is the draw result, not missing evidence');
const namedCornerResult={...namedResult,corners_home:5,corners_away:4};
assert.equal(gradeLine(held('Corners Hometeam','5-6'),namedCornerResult),'WON',
 'An identity-matched held native team corner band uses verified final counters');

for(const [selection,choice] of [['Over','over'],['Under','under']]) {
 const contract=liveContract(quote(
  'Goal in first 10 min. (00:00 - 09:59) (0.5)',selection,{line:'0.5'}
 ));
 assert.deepEqual(
  [contract?.kind,contract?.event,contract?.from,contract?.to,contract?.choice,contract?.threshold],
  ['window-total','goal',0,9,choice,0.5]
 );
}
assert.equal(liveContract(quote(
 'Goal in first 10 min. (00:00 - 09:59) (0.5)','Over',{line:'1.5'}
)),null);

console.log('PASS Zizobet clean sheets, joined team labels, half/full multigoals, multiscores grid and opening 10-minute totals');
