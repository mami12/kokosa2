import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {gradeLine,hasRequiredSettlementEvidence,settledOddsFor,
 scorePeriodOf,pendingEventReason} from '../server/ledger/settler.mjs';
import {finishedResultParameters,isFinished} from '../server/ledger/results.mjs';
const score={home_team:'Manchester City',away_team:'Manchester United',
 home_score:3,away_score:1,half_home_score:0,half_away_score:1,
 corners_home:3,corners_away:2,cards_home:3,cards_away:2};
const choice=(market_name,outcome_name,opts={})=>({market_name,outcome_name,
 outcome_key:outcome_name,line:'',...opts});
const grade=(market,outcome,opts={})=>gradeLine(choice(market,outcome,opts),score);

// A 1H/2H provider period MUST never use the FT 3-1.
assert.equal(scorePeriodOf(choice('1X2','1',{period:1})),1);
assert.equal(grade('1X2','1',{period:1}),'LOST');
assert.equal(grade('1X2','2',{period:1}),'WON');
assert.equal(grade('1X2','1',{period:2}),'WON');
assert.equal(grade('Both Teams To Score','Yes',{period:1}),'LOST');
assert.equal(grade('Both Teams To Score','Yes',{period:2}),'LOST');
assert.equal(grade('Both Teams To Score','Yes',{period:0}),'WON');
assert.equal(grade('Double Chance','1X',{period:1}),'LOST');
assert.equal(grade('Double Chance','X2',{period:1}),'WON');
assert.equal(grade('Odd/Even','Odd',{period:1}),'WON');
assert.equal(grade('Odd/Even','Even',{period:0}),'WON');
assert.equal(grade('Correct Score','0:1',{period:1}),'WON');
assert.equal(grade('Correct Score','3:0',{period:2}),'WON');
assert.equal(grade('1X2','1',{period:3}),null);
assert.equal(grade('1st Half Result','1',{period:2}),null);
assert.equal(grade('1X2','1',{period:1}), 'LOST');
assert.equal(gradeLine(choice('1X2','1',{period:1}),{...score,half_home_score:null}),null);
assert.equal(gradeLine(choice('1X2','1',{period:2}),{...score,half_home_score:5}),null);
assert.equal(hasRequiredSettlementEvidence(choice('1X2','1'),{...score,home_score:null}),false);
assert.equal(gradeLine(choice('1X2','1'),{...score,home_score:null}),null);

// Half-only corners cannot be inferred from the final match corner total.
assert.equal(grade('Total Corners','Over',{period:1,line:'0.5'}),null);
assert.equal(grade('Corner Result 1X2','1',{period:1}),null);

// Verified Zizobet FT statistics remain authoritative even when the
// optional secondary-provider comparison has not produced a review row.
const chelseaPsg={...score,source:'ZIZOBET',home_team:'Chelsea Women',
 away_team:'Paris Saint-Germain Women',home_score:1,away_score:0,
 half_home_score:0,half_away_score:0,corners_home:10,corners_away:3,
 statistics_review_pending:true,statistics_review:null};
const cornerGrade=(market,outcome,line='')=>gradeLine(
 {...choice(market,outcome),line},chelseaPsg);
assert.equal(hasRequiredSettlementEvidence(choice('Total Corners','Over',{line:'12.5'}),chelseaPsg),true);
assert.equal(cornerGrade('Total Corners (12.5)','Over'),'WON',
 '13 verified Zizobet corners beats 12.5');
assert.equal(cornerGrade('Hometeam total corners (8.5)','Over'),'WON',
 'compact Hometeam label uses Chelsea 10, not total corners');
assert.equal(cornerGrade('Awayteam total corners (3.5)','Over'),'LOST',
 'compact Awayteam label uses PSG 3, not total corners');
assert.equal(cornerGrade('Most corners','1'),'WON',
 'Most corners is a three-way corner winner market, not an unsupported total');
assert.equal(cornerGrade('Most corners','X'),'LOST');
assert.equal(cornerGrade('Most corners','2'),'LOST');

// Secondary-source review can still hold non-primary result rows.
const nonPrimaryPending={...chelseaPsg,source:'FEED'};
assert.equal(hasRequiredSettlementEvidence(choice('Total Corners','Over',{line:'12.5'}),nonPrimaryPending),false);

// Team-named clean sheet: Manchester City conceded 1; Man U conceded 3.
// Generic "Clean Sheet" cannot be allocated to an arbitrary team.
assert.equal(grade('Manchester City Clean Sheet','Yes'),'LOST');
assert.equal(grade('Manchester United Clean Sheet','No'),'WON');
assert.equal(grade('Clean Sheet','Yes'),null);
assert.equal(grade('Home and Away Clean Sheet','Yes'),null);

// A DNB code that is not 1 or 2 cannot be silently interpreted as LOST.
assert.equal(grade('Draw No Bet','Mystery'),null);
assert.equal(gradeLine(choice('Draw No Bet','Mystery'),{...score,home_score:1,away_score:1}),null);
const realPsvDraw={...score,home_team:'Real Madrid U19',away_team:'PSV Eindhoven U19',
 home_score:3,away_score:3,half_home_score:2,half_away_score:3};
for(const [market,outcome,expected] of [
 ['Real Madrid U19 to win','No','WON'],
 ['PSV Eindhoven U19 to win','No','WON'],
 ['Real Madrid U19 to win','Yes','LOST'],
 ['PSV Eindhoven U19 to win','Yes','LOST'],
 ['Real Madrid U19 no bet','X','WON'],
 ['Real Madrid U19 no bet','2','LOST']
]){
 const wager=choice(market,outcome);
 assert.equal(gradeLine(wager,realPsvDraw),expected,market+' '+outcome);
 assert.equal(hasRequiredSettlementEvidence(wager,realPsvDraw),true,
  'The verified 3-3 final score is sufficient for '+market+' '+outcome);
}

const firstHalfRestResult={...realPsvDraw,
 home_score:3,away_score:3,half_home_score:2,half_away_score:3};
const acceptedAt43={
 scoreHome:2,scoreAway:2,clockMilliseconds:43*60*1000,
 feedPhase:'1st half'
};
for(const [outcome,expected] of [
 ['2','WON'],['1','LOST'],['X','LOST']
]){
 const wager=choice('Halftime - Who wins the rest',outcome,{
  accepted_contract:{acceptedLiveSnapshot:acceptedAt43}
 });
 assert.equal(gradeLine(wager,firstHalfRestResult),expected,
  'Halftime rest is decided only by the 43-minute-to-HT score delta: '+outcome);
 assert.equal(hasRequiredSettlementEvidence(wager,firstHalfRestResult),true,
  'Confirmed HT and FT scores are present for the halftime-rest selection');
}
assert.equal(gradeLine(choice('Halftime - Who wins the rest','2',{
 accepted_contract:{acceptedLiveSnapshot:{...acceptedAt43,
  clockMilliseconds:46*60*1000,feedPhase:'2nd half'}}
}),firstHalfRestResult),null,
 'A first-half-rest market cannot be regraded from a second-half snapshot');
assert.equal(gradeLine(choice('Halftime - Who wins the rest','2'),firstHalfRestResult),null,
 'Without an immutable entry score the first-half-rest winner remains unknown');
assert.equal(gradeLine(choice('Halftime - Who wins the rest?','2',{
 accepted_contract:{acceptedLiveSnapshot:acceptedAt43}
}),firstHalfRestResult),'WON',
 'The halftime-rest parser accepts the provider title with a trailing question mark');
const genericRest=choice('Who wins the rest of the match?','1',{
 accepted_contract:{acceptedLiveSnapshot:{isLive:true,scoreHome:0,scoreAway:1}}
});
assert.equal(gradeLine(genericRest,realPsvDraw),'WON',
 'Generic rest-of-match settlement uses the final score delta without halftime-only state');

// The same rule must repair old native tickets held by a previous parser.
// Only the accepted quote and its frozen 43-minute score may be used.
const heldNative=(market,outcome,snapshot=acceptedAt43)=>choice(market,outcome,{
 market_key:'zz-test-native-market',
 accepted_contract:{
  sourceProviderId:'ZIZOBET',settlementHold:'NATIVE_FINAL_RULE_UNMAPPED',
  providerMarketName:market,providerOutcomeName:outcome,
  providerMarketKey:'zz-test-native-market',providerOutcomeKey:outcome,
  line:'',providerPeriod:0,homeTeamName:'Real Madrid U19',
  awayTeamName:'PSV Eindhoven U19',
  ...(snapshot?{acceptedLiveSnapshot:snapshot}:{})
 }
});
assert.equal(gradeLine(heldNative('Halftime - Who wins the rest','2'),firstHalfRestResult),'WON',
 'A held historical native halftime-rest ticket is repaired from its original accepted snapshot');
assert.equal(gradeLine(heldNative('Halftime - Who wins the rest','1'),firstHalfRestResult),'LOST');
assert.equal(gradeLine(choice('Halftime - Who wins the rest','PSV Eindhoven U19',{
 home_team:'Real Madrid U19',away_team:'PSV Eindhoven U19',
 accepted_contract:{acceptedLiveSnapshot:acceptedAt43}
}),firstHalfRestResult),'WON',
 'The quoted team-name selection resolves to the correct halftime side');
assert.equal(gradeLine(choice('Halftime - Who wins the rest','PSV Eindhoven U19',{
 home_team:'Real Madrid U19',away_team:'PSV Eindhoven U19',
 accepted_contract:{acceptedLiveSnapshot:{
  isLive:false,scoreHome:0,scoreAway:0
 }}
}),firstHalfRestResult),'WON',
 'A prematch 0-0 baseline can settle from the confirmed first-half score');

for(const [market,outcome,expected] of [
 ['Total awayteam 4.5','Under','WON'],['Total awayteam 4.5','Over','LOST'],
 ['Total hometeam 3.5','Under','WON'],['Total hometeam 3.5','Over','LOST'],
 ['Real Madrid U19 to win','No','WON'],['PSV Eindhoven U19 to win','Yes','LOST'],
 ['Real Madrid U19 no bet','X','WON']
]){
 assert.equal(gradeLine(heldNative(market,outcome),realPsvDraw),expected,
  'A held native ticket is graded only from its immutable quote: '+market+' '+outcome);
}

const draw={...score,home_score:1,away_score:1,half_home_score:1,half_away_score:1};
assert.equal(gradeLine(choice('Draw No Bet','1'),draw),'WON');
assert.equal(settledOddsFor(choice('Draw No Bet','1'),draw,'WON'),1);
assert.equal(settledOddsFor(choice('Draw No Bet','Mystery'),draw,null),null);
assert.equal(settledOddsFor(choice('Draw No Bet','1'),score,'WON'),null);
assert.equal(gradeLine(choice('Draw No Bet','2',{period:1}),draw),'WON');
assert.equal(settledOddsFor(choice('Draw No Bet','2',{period:1}),draw,'WON'),1);
assert.equal(settledOddsFor(choice('Draw No Bet first half','2'),draw,'WON'),1);
assert.equal(settledOddsFor(choice('1st half - Draw no bet','2'),draw,'WON'),1);
assert.equal(gradeLine(choice('Draw No Bet first half','2'),score),'WON');
assert.equal(gradeLine(choice('Draw No Bet first half','1'),score),'LOST');
assert.equal(grade('Draw No Bet + BTTS','1'),null);

// Corners 4+ means four OR MORE, not exactly four. The legacy norm()
// erased '+' before detecting a lower-bound selection.
assert.equal(grade('Exact Corners','4+'),'WON');
assert.equal(grade('Exact Corners','5'),'WON');
assert.equal(grade('Exact Corners','4'),'LOST');
assert.equal(grade('Exact Corners','6+'),'LOST');
assert.equal(grade('Exact Corners','4 or more'),'WON');

// A missing red count is unknown, NOT zero, for either team.
const raw={match_id:99,home:'Home',away:'Away',home_score:2,away_score:1,
 score_at:'2026-11-11T20:00:00Z',stats:{
  home:{yellow:3,corners:5},away:{yellow:1,red:0,corners:4}}};
let params=finishedResultParameters(raw);
assert.equal(params[7],null,'Home yellow+red cannot be computed from yellow alone');
assert.equal(params[8],1);
params=finishedResultParameters({...raw,stats:{home:{yellow:3,red:0,corners:5},
 away:{yellow:1,red:0,corners:4}}});
assert.equal(params[7],3);
assert.equal(params[8],1);
params=finishedResultParameters({...raw,stats:{
 home:{yellow:1,red:0,corners:10,corners2H:6},
 away:{yellow:0,red:0,corners:3,corners2H:1}
}});
const cornerPeriods=JSON.parse(params[11]).cornerPeriods;
assert.deepEqual(cornerPeriods,{
 firstHalf:{home:4,away:2},secondHalf:{home:6,away:1},
 fullTime:{home:10,away:3},source:'ZIZOBET'
},'Zizobet 2H corner counters plus FT counters must reconstruct both halves');
params=finishedResultParameters({...raw,stats:{
 home:{yellow:1,red:0,corners:10,cornersHT:4},
 away:{yellow:0,red:0,corners:3,cornersHT:2}
}});
assert.deepEqual(JSON.parse(params[11]).cornerPeriods,{
 firstHalf:{home:4,away:2},secondHalf:{home:6,away:1},
 fullTime:{home:10,away:3},source:'ZIZOBET'
},'Zizobet HT corner counters plus FT counters must reconstruct both halves');
const finishedFrame={raw:{provider:'ZIZOBET'},feed_status:'FT',score_at:'2026-11-11T20:00:00Z',home_score:1,away_score:1};
assert.equal(isFinished(finishedFrame),true);
assert.equal(isFinished({...finishedFrame,raw:{provider:'FOTMOB'}}),false,
 'A secondary final-score frame must never qualify for settlement');
for(const status of ['After penalties','Penalties','Extra time','After match','Penalty shootout']){
 assert.equal(isFinished({...finishedFrame,feed_status:status}),false,
  status+' score could be non-regulation and must not settle 90m bets');
}

// Same fixture result and same quoted market/line must produce one
// deterministic answer for every ticket, regardless of which account or
// ticket row carries it. A 5-0 FT cannot make Over 2.5 both WON and LOST.
const blowout={...score,home_team:'Home FC',away_team:'Away FC',
 home_score:5,away_score:0,half_home_score:2,half_away_score:0};
for(const threshold of ['2.5','3.5','4.5']){
 assert.equal(gradeLine(choice('Total Goals','Over',{line:threshold}),blowout),'WON',
  'FT Over '+threshold+' is WON for 5-0');
 assert.equal(gradeLine(choice('Total Goals','Under',{line:threshold}),blowout),'LOST',
  'FT Under '+threshold+' is LOST for 5-0');
}
assert.equal(gradeLine(choice('Total Goals','Over',{line:'2.5',period:1}),blowout),'LOST',
 '1H Over 2.5 uses 2-0 at HT, not the 5-0 FT');
assert.equal(gradeLine(choice('Total Goals','Under',{line:'2.5',period:1}),blowout),'WON');
assert.equal(gradeLine(choice('Total Goals','Over',{line:'2.5',period:2}),blowout),'WON',
 '2H Over 2.5 uses FT minus HT: 3-0');
assert.equal(gradeLine(choice('Home Team Total Goals','Over',{line:'2.5'}),blowout),'WON');
assert.equal(gradeLine(choice('Away Team Total Goals','Over',{line:'0.5'}),blowout),'LOST');


const denmarkNorway={...score,home_team:'Denmark',away_team:'Norway',
 home_score:2,away_score:3,half_home_score:2,half_away_score:1};
for(const market of ['Full Time 1UP','Full Time 2UP','Full Time 3UP']){
 assert.equal(gradeLine(choice(market,'2'),denmarkNorway),'WON',
  market+' follows the documented ordinary FT 1X2 result contract');
 assert.equal(gradeLine(choice(market,'X'),denmarkNorway),'LOST',
  market+' draw follows the documented ordinary FT 1X2 result contract');
}
for(const outcome of ['1','X','2']){
 const expected=outcome==='2'?'WON':'LOST';
 assert.equal(gradeLine(choice('3way',outcome),denmarkNorway),expected,
  'Bare 3way remains ordinary FT 1X2');
}


assert.equal(pendingEventReason({market_name:'Next Goal'},score),'NO_LIVE_CONTRACT',
 'an advanced quote without a frozen event contract must be diagnosed');
assert.equal(pendingEventReason({market_name:'Asian Handicap'},score),'NO_SETTLEMENT_RULE',
 'an unsupported market must expose the missing settlement rule');
assert.equal(pendingEventReason({market_name:'Next Goal'},null),'FINAL_RESULT_OR_LIVE_FACTS_UNVERIFIED');

console.log('PASS period-scoped score markets, DNB draw win at 1.00, clean sheets, exact bands, card unknowns');
