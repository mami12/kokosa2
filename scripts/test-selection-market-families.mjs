import assert from 'node:assert/strict';
import {
  assertDistinctSelectionMarkets, assertCompatibleSelections, selectionMarketIdentity,
  selectionConflict, toggleMarketSelection, toggleCompatibleSelection, findSelectionConflict
} from '../server/ledger/selection-market.mjs';

const pick=(outcomeId,extra={})=>({outcomeId,matchId:'200',marketId:outcomeId.split('|').slice(0,2).join('|'),...extra});
const conflict=(a,b,family)=> {
  const result=selectionConflict(a,b);
  assert.equal(result?.family,family,String(a.marketName)+' must conflict with '+String(b.marketName)+' as '+family);
  assert.equal(selectionConflict(b,a)?.family,family,'Conflict must work in reverse selection order');
};
const blocked=(existing,candidate,family)=> {
  conflict(existing,candidate,family);
  assert.deepEqual(toggleCompatibleSelection([existing],candidate),[existing],
    'Frontend must refuse the conflicting selection without removing the existing one');
  assert.throws(()=>assertCompatibleSelections([existing,candidate]),
    error=>error.code==='INCOMPATIBLE_SELECTIONS',
    'Backend must reject the same conflicting selections');
};

const totalGoals=pick('200|gGoals|2.5|Over',{marketName:'Total Goals',marketType:'over_under',outcomeName:'Over 2.5'});
const firstHalfGoals=pick('200|gGoals1h|1.5|Under',{marketName:'1st Half Total Goals',marketType:'over_under',outcomeName:'Under 1.5',period:1});
const homeGoals=pick('200|gHomeGoals|1.5|Over',{marketName:'Home Team Total Goals',marketType:'over_under',outcomeName:'Over 1.5'});
const awayGoals=pick('200|gAwayGoals|1.5|Over',{marketName:'Away Team Total Goals',marketType:'over_under',outcomeName:'Over 1.5'});
const btts=pick('200|gBtts||Yes',{marketName:'Both Teams To Score',outcomeName:'Yes'});
const correctScore=pick('200|gCorrectScore||1:0',{marketName:'Correct Score',outcomeName:'1:0'});
blocked(totalGoals,firstHalfGoals,'goals');
blocked(totalGoals,homeGoals,'goals');
blocked(homeGoals,awayGoals,'goals');

// Zizobet team-total variants can arrive with a generic display title while
// the native key carries the complete Home/Away Team Goals identity.
const homeTeamGoalsKeyOnly=pick('200|gHomeTeamGoals|1.5|Over',{
  marketKey:'gHomeTeamGoals',marketName:'Home Team Total',marketType:'over_under',
  outcomeName:'Over 1.5'
});
const awayTeamGoalsKeyOnly=pick('200|gAwayTeamGoals|1.5|Over',{
  marketKey:'gAwayTeamGoals',marketName:'Away Team Total',marketType:'over_under',
  outcomeName:'Over 1.5'
});
blocked(totalGoals,homeTeamGoalsKeyOnly,'goals');
blocked(totalGoals,awayTeamGoalsKeyOnly,'goals');
blocked(homeTeamGoalsKeyOnly,awayTeamGoalsKeyOnly,'goals');
blocked(totalGoals,btts,'goals');
blocked(totalGoals,correctScore,'goals');

const result=pick('200|g1x2||1',{marketName:'Match Result',marketType:'1x2',outcomeName:'Home'});
const doubleChance=pick('200|gDC||1X',{marketName:'Double Chance',outcomeName:'1X'});
const dnb=pick('200|gDNB||Home',{marketName:'Draw No Bet',outcomeName:'Home'});
const htft=pick('200|gHTFT||1-X',{marketName:'Half Time / Full Time',outcomeName:'Home/Draw'});
blocked(result,doubleChance,'result');
blocked(result,dnb,'result');
blocked(result,htft,'result');
blocked(result,correctScore,'result');
const nextGoal=pick('200|gNextGoal||Home',{marketName:'Next Goal',outcomeName:'Home'});
blocked(result,nextGoal,'result');
const threeWay=pick('200|g3Way||Home',{marketName:'3-Way Result',marketType:'3_way',outcomeName:'Home'});
blocked(result,threeWay,'result');

// Different provider IDs and labels must not bypass equivalent no-goal contracts.
const underZeroFive=pick('200|gGoals|0.5|Under',{marketName:'Total Goals',marketType:'over_under',outcomeName:'Under 0.5',marketLine:'0.5'});
const noGoals=pick('200|gNoGoals||Yes',{marketName:'No Goals',outcomeName:'Yes'});
const exactZero=pick('200|gExactGoals||0',{marketName:'Exact Goals',outcomeName:'0'});
blocked(underZeroFive,noGoals,'goals');
blocked(underZeroFive,exactZero,'goals');
blocked(noGoals,exactZero,'goals');

// Range buckets overlap the same goals statistic even with a separate provider market ID.
const goalRange23=pick('200|gGoalRange||2-3',{marketName:'Goal Range',marketType:'range',outcomeName:'2-3'});
const goalRange24=pick('200|gMultiGoals||2-4',{marketName:'Multi Goals',marketType:'multi_goals',outcomeName:'2-4'});
blocked(totalGoals,goalRange23,'goals');
blocked(totalGoals,goalRange24,'goals');
const goalRange03=pick('200|gTotalInRange||0-3',{marketName:'Total Goals In Range',marketType:'range',outcomeName:'0-3'});
blocked(totalGoals,goalRange03,'goals');


const corners=pick('200|gCorners|8.5|Over',{marketName:'Total Corners',marketType:'over_under',outcomeName:'Over 8.5'});
const raceCorners=pick('200|gRaceCorners||Home',{marketName:'Race to 5 Corners',outcomeName:'Home'});
const firstCorner=pick('200|gFirstCorner||Home',{marketName:'First Corner',outcomeName:'Home'});
const teamCorners=pick('200|gHomeCorners|4.5|Over',{marketName:'Home Team Total Corners',marketType:'over_under',outcomeName:'Over 4.5'});
blocked(corners,raceCorners,'corners');
blocked(corners,firstCorner,'corners');
blocked(corners,teamCorners,'corners');

const cards=pick('200|gCards|4.5|Over',{marketName:'Total Cards',marketType:'over_under',outcomeName:'Over 4.5'});
const yellowCards=pick('200|gYellowCards|2.5|Over',{marketName:'Total Yellow Cards',marketType:'over_under',outcomeName:'Over 2.5'});
const redCards=pick('200|gRedCards||Yes',{marketName:'Red Card',outcomeName:'Yes'});
const bookingPoints=pick('200|gBookingPoints|30.5|Over',{marketName:'Booking Points',marketType:'over_under',outcomeName:'Over 30.5'});
blocked(cards,yellowCards,'cards');
blocked(cards,redCards,'cards');
blocked(yellowCards,bookingPoints,'cards');

const resultGoalsCombo=pick('200|gResultGoals||HomeOver',{
  marketName:'Full Time Result + Total Goals',marketType:'combo',outcomeName:'Home & Over 2.5'
});
blocked(result,resultGoalsCombo,'result');
blocked(totalGoals,resultGoalsCombo,'goals');
const winAndOver=pick('200|gWinOver||HomeOver',{marketName:'Match Winner + Over 2.5 Goals',marketType:'combo',outcomeName:'Home & Over 2.5'});
blocked(result,winAndOver,'result');
blocked(totalGoals,winAndOver,'goals');
const builder=pick('200|BB|template-1',{
  marketName:'Bet Builder',
  builderLegs:[
    {marketId:'200|g1x2|',outcomeId:'200|g1x2||1'},
    {marketId:'200|gCorners|8.5',outcomeId:'200|gCorners|8.5|Over'}
  ]
});
blocked(result,builder,'result');
blocked(corners,builder,'corners');

const compactCombo=pick('200|combo|1',{
  marketName:'Bet Builder',
  comboLegs:[{market:'1X2',outcome:'1'},{market:'TOTAL',outcome:'Over',line:'2.5'}]
});
blocked(result,compactCombo,'result');
blocked(totalGoals,compactCombo,'goals');

const fouls=pick('200|gFouls|20.5|Over',{marketName:'Total Fouls',marketType:'over_under',outcomeName:'Over 20.5'});
const otherFixture=pick('201|gGoals|2.5|Over',{matchId:'201',marketName:'Total Goals',marketType:'over_under',outcomeName:'Over 2.5'});
assert.equal(selectionConflict(totalGoals,corners),null);
assert.equal(selectionConflict(corners,cards),null);
assert.equal(selectionConflict(cards,fouls),null);
assert.equal(selectionConflict(totalGoals,otherFixture),null);
assert.doesNotThrow(()=>assertCompatibleSelections([totalGoals,corners,cards,fouls,otherFixture]));
assert.equal(findSelectionConflict([totalGoals,corners,cards,fouls,otherFixture]),null);

const totalGoalsAlt=pick('200|gGoals|3.5|Under',{marketName:'Total Goals',marketType:'over_under',outcomeName:'Under 3.5'});
assert.equal(selectionMarketIdentity(totalGoals),selectionMarketIdentity(totalGoalsAlt));
assert.equal(selectionConflict(totalGoals,totalGoalsAlt)?.code,'SAME_MARKET_GROUP');
assert.deepEqual(toggleMarketSelection([totalGoals],totalGoalsAlt),[totalGoalsAlt]);
assert.throws(()=>assertDistinctSelectionMarkets([totalGoals,totalGoalsAlt]),error=>error.code==='DUPLICATE_MARKET');

assert.deepEqual(toggleCompatibleSelection([totalGoals],totalGoals),[]);
// Winner-or-total markets are compound contracts: each represents both
// match result and goal totals, so they conflict with either family.
const homeWinTotalOver=pick('200|gHomeWinTotalOver||Yes',{
  marketName:'Home team win or total over1',marketType:'other',outcomeName:'Yes'
});
const homeWinTotalUnder=pick('200|gHomeWinTotalUnder||Yes',{
  marketName:'Home team wins or total under1',marketType:'other',outcomeName:'Yes'
});
const awayWinTotalOver=pick('200|gAwayWinTotalOver||Yes',{
  marketName:'Away team wins or total over1',marketType:'other',outcomeName:'Yes'
});
const awayWinTotalUnder=pick('200|gAwayWinTotalUnder||Yes',{
  marketName:'Away team wins or total under1',marketType:'other',outcomeName:'Yes'
});
for (const compound of [homeWinTotalOver,homeWinTotalUnder,awayWinTotalOver,awayWinTotalUnder]) {
  blocked(compound,totalGoals,'goals');
  blocked(compound,result,'result');
  assert.equal(selectionConflict(compound,corners),null,
    'Win-or-total market remains compatible with unrelated Corners');
}

// Half-time and second-half result + total combinations contribute to
// both families. Plain half totals contribute to Goals.
const firstHalfResultTotal=pick('200|g1HResultTotal||HomeOver',{
  marketName:'1st half - Result & total',marketType:'other',outcomeName:'Home & Over 0.5',period:1
});
const secondHalfResultTotal=pick('200|g2HResultTotal||HomeOver',{
  marketName:'2nd half - Result & total',marketType:'other',outcomeName:'Home & Over 0.5',period:2
});
for (const compound of [firstHalfResultTotal,secondHalfResultTotal]) {
  blocked(compound,totalGoals,'goals');
  blocked(compound,result,'result');
  assert.equal(selectionConflict(compound,corners),null,
    'Half result + total remains compatible with unrelated Corners');
}
const firstHalfTotal=pick('200|g1HTotal|1.5|Over',{
  marketName:'1st half - Total',marketType:'over_under',outcomeName:'Over 1.5',period:1
});
const secondHalfTotal=pick('200|g2HTotal|1.5|Over',{
  marketName:'2nd Half - Total',marketType:'over_under',outcomeName:'Over 1.5',period:2
});
blocked(totalGoals,firstHalfTotal,'goals');
blocked(totalGoals,secondHalfTotal,'goals');
blocked(firstHalfTotal,secondHalfTotal,'goals');
assert.equal(selectionConflict(firstHalfTotal,result),null,
  'Plain first-half total remains distinct from Match Result');
assert.equal(selectionConflict(secondHalfTotal,result),null,
  'Plain second-half total remains distinct from Match Result');

console.log('PASS: same-match market-family exclusivity for goals, results, corners, cards and multi-stat combinations.');
