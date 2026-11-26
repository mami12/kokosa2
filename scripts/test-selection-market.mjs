import assert from 'node:assert/strict';
import {
  assertDistinctSelectionMarkets, assertCompatibleSelections, selectionMarketIdentity,
  selectionConflict, toggleMarketSelection, toggleMatchSelection, toggleCompatibleSelection, findSelectionConflict
} from '../server/ledger/selection-market.mjs';
import {buildBetslipColumns} from '../web/src/utils/betslipColumns.ts';

const pick=(outcomeId,extra={})=>({outcomeId,...extra});
for(const key of ['g6257','gBothScore','gCorrectScore','gGoalTime','gCorners','gCards','gPlayer']){
  const home=pick(`100|${key}||1`),draw=pick(`100|${key}||X`),away=pick(`100|${key}||2`);
  const other=pick('101|g6257||1');
  let slip=[home,other];
  slip=toggleMarketSelection(slip,away);
  assert.deepEqual(slip,[away,other],`${key}: new option replaces previous same-market outcome`);
  slip=toggleMarketSelection(slip,draw);
  assert.deepEqual(slip,[draw,other],`${key}: cannot create an extra column with same-market options`);
  slip=toggleMarketSelection(slip,draw);
  assert.deepEqual(slip,[other],`${key}: clicking the selected outcome removes it`);
  assert.throws(()=>assertDistinctSelectionMarkets([home,away]),
    error=>error.status===400&&error.code==='DUPLICATE_MARKET',
    `${key}: only one selection is allowed per market, including Corners`);
}
const over=pick('100|g6379|2.5|Over'),under=pick('100|g6379|2.5|Under');
const line35=pick('100|g6379|3.5|Under');
const half1=pick('100|g6379p1|2.5|Under');
assert.deepEqual(toggleMarketSelection([over,line35,half1],under),[under,half1],
  'All quoted lines of the same goal-total market replace one another');
assert.throws(()=>assertDistinctSelectionMarkets([under,line35,half1]),
  error=>error.code==='DUPLICATE_MARKET');
assert.equal(selectionMarketIdentity(over),selectionMarketIdentity(line35));
assert.notEqual(selectionMarketIdentity(over),selectionMarketIdentity(half1),
  'Distinct first-half market key remains a separate bettable group');
// The restriction applies to every market family, not just totals.
for(const key of ['gGoals','gCorners','gCards','gGoalTime','gPlayer','gTeamFouls','gShotsOnTarget']){
 const low=pick(`100|${key}|1.5|Over`), high=pick(`100|${key}|3.5|Under`);
 assert.equal(selectionMarketIdentity(low),selectionMarketIdentity(high),`${key}: lines belong to one group`);
 assert.deepEqual(toggleMarketSelection([low],high),[high],`${key}: replace previous line`);
 assert.throws(()=>assertDistinctSelectionMarkets([low,high]),
   error=>error.code==='DUPLICATE_MARKET',`${key}: reject multiple selections from the same market`);
}
// Other fixtures and other actual provider market keys are independent.
assert.notEqual(selectionMarketIdentity(over),selectionMarketIdentity(pick('101|g6379|2.5|Over')));
assert.notEqual(selectionMarketIdentity(over),selectionMarketIdentity(pick('100|g6379p1|2.5|Over')));
// Zizobet embeds line/interval/threshold parameters after @. Those
// parameters are alternatives within the same native market ID, not new
// independent markets that can be stacked on one ticket.
const nativeA=pick('100|zz6379@eyJwMSI6IjEifQ|2.5|Over');
const nativeB=pick('100|zz6379@eyJwMSI6IjIifQ|3.5|Under');
assert.equal(selectionMarketIdentity(nativeA),selectionMarketIdentity(nativeB));
assert.throws(()=>assertDistinctSelectionMarkets([nativeA,nativeB]),
 error=>error.code==='DUPLICATE_MARKET');
assert.deepEqual(toggleMarketSelection([nativeA],nativeB),[nativeB]);
assert.notEqual(selectionMarketIdentity(nativeA),
 selectionMarketIdentity(pick('100|zz6380@eyJwMSI6IjEifQ|2.5|Over')));
assert.notEqual(selectionMarketIdentity({...nativeA,period:0}),
 selectionMarketIdentity({...nativeB,period:1}),
 'First-half and full-time markets stay separate when the provider reuses a native ID');
// IDs and frozen source contracts, never translated names, drive identity.
assert.equal(selectionMarketIdentity(over),selectionMarketIdentity({matchId:100,marketKey:'g6379',line:'2.5'}));
assert.deepEqual(toggleMarketSelection(
 [{...over,matchId:'faked',marketId:'different',marketName:'Lart/Poshte'}],
 {...under,matchId:'fake',marketId:'elsewhere',marketName:'Total Goals'}),
 [{...under,matchId:'fake',marketId:'elsewhere',marketName:'Total Goals'}]);
assert.throws(()=>assertDistinctSelectionMarkets([
 {matchId:100,marketKey:'g6379',line:null},
 {matchId:'100',marketKey:'g6379',line:''}
]),error=>error.code==='DUPLICATE_MARKET');
assert.doesNotThrow(()=>assertDistinctSelectionMarkets([
 {matchId:'100',marketKey:'g1',line:''},
 {matchId:'100',marketKey:'g2',line:'',marketName:'Same display name'}
]));
// Legacy app fixtures sometimes expose a local marketId instead of native ID.
const aliasA=pick('one',{matchId:'100',marketId:'market-local',marketLine:'',period:0});
const aliasB=pick('two',{matchId:'100',marketId:'market-local',period:0});
assert.deepEqual(toggleMarketSelection([aliasA],aliasB),[aliasB]);
const builderOption=(template,line='2.5',period='')=>({
 outcomeId:`BB|100|${template}`,matchId:'100',builderLegs:[
 {marketId:`100|gBtts${period}|`,outcomeId:`100|gBtts${period}||Yes`},
 {marketId:`100|gTotal${period}|${line}`,outcomeId:`100|gTotal${period}|${line}|Over`},
 ]
});
const yesOver=builderOption('template-yes-over');
const noUnder={...builderOption('template-no-under'),builderLegs:[
 {marketId:'100|gTotal|2.5',outcomeId:'100|gTotal|2.5|Under'},
 {marketId:'100|gBtts|',outcomeId:'100|gBtts||No'}
]};
assert.equal(selectionMarketIdentity(yesOver),selectionMarketIdentity(noUnder));
assert.deepEqual(toggleMarketSelection([yesOver],noUnder),[noUnder],
 'Same two source markets in different builder template cannot create parallel columns');
const sameIdRepeated=[over,under,over,line35];
assert.deepEqual(toggleMarketSelection(sameIdRepeated,under),[],
 'Clicking a selected option also cleans up duplicate outcomes and lines from old slip state');
assert.deepEqual(toggleMarketSelection(sameIdRepeated,pick('100|g6379|2.5|Exact')),[pick('100|g6379|2.5|Exact')],
 'A new option removes every old line from that market group');
// Different markets on the same fixture continue to build a normal COMBO.
const distinct=[
 {outcomeId:'100|1x2||1',matchId:'100',marketId:'100|1x2|',odds:2},
 {outcomeId:'100|btts||Yes',matchId:'100',marketId:'100|btts|',odds:1.8},
 {outcomeId:'101|1x2||2',matchId:'101',marketId:'101|1x2|',odds:2.2}
];
const slip=buildBetslipColumns(distinct);
assert.equal(slip.automaticSystem,false);
assert.equal(slip.columns.length,1);
assert.equal(slip.columns[0].length,3);
const changed=toggleMarketSelection(distinct,{...distinct[0],outcomeId:'100|1x2||X'});
assert.equal(buildBetslipColumns(changed).columns.length,1);
assert.deepEqual(changed.map(v=>v.outcomeId),['100|1x2||X','100|btts||Yes','101|1x2||2']);

// Normal users may combine one Corners selection with one non-Corners selection from the same fixture.
const matchResult=pick('200|g1x2||1',{matchId:'200',marketId:'200|g1x2|',marketName:'Match Result',marketType:'1x2'});
const doubleChance=pick('200|gdc||1X',{matchId:'200',marketId:'200|gdc|',marketName:'Double Chance'});
const drawNoBet=pick('200|gdnb||1',{matchId:'200',marketId:'200|gdnb|',marketName:'Draw No Bet'});
const nextGoal=pick('200|gNextGoal||Home',{matchId:'200',marketId:'200|gNextGoal|',marketName:'Next Goal',outcomeName:'Home'});
assert.equal(selectionConflict(matchResult,nextGoal)?.family,'result',
  'Next Goal cannot be combined with 1X2 on the same fixture');
assert.deepEqual(toggleCompatibleSelection([matchResult],nextGoal),[matchResult]);
assert.throws(()=>assertCompatibleSelections([matchResult,nextGoal]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');
const matchTotal=pick('200|g6379|2.5|Over',{matchId:'200',marketId:'200|g6379|2.5',marketName:'Total Goals',marketType:'over_under',marketLine:'2.5',outcomeName:'Over 2.5'});
const fullTimeResultGoals=pick('200|gFTResultGoals||HomeOver',{matchId:'200',marketId:'200|gFTResultGoals|',marketName:'Full Time Result/Goals',marketType:'result_goals',outcomeName:'Home & Over 1.5'});
const corners=pick('200|gCorners|2.5|Over',{matchId:'200',marketId:'200|gCorners|2.5',marketName:'Total Corners',marketType:'over_under',marketLine:'2.5',outcomeName:'Over 2.5'});
const cards=pick('200|gCards|4.5|Over',{matchId:'200',marketId:'200|gCards|4.5',marketName:'Total Cards',marketType:'over_under',marketLine:'4.5',outcomeName:'Over 4.5'});
const otherFixture=pick('201|g1x2||1',{matchId:'201',marketId:'201|g1x2|',marketName:'Match Result'});

// Across one match, Over/Under and Range are mutually exclusive for the
// same statistic, even when Zizobet assigns them different provider market IDs.
const statisticOverRangePairs = [
  ['goals', 'Total Goals', 'Total in Range', 'g6379', 'gMultiGoals'],
  ['goals', 'Home Team Total Goals', 'Home Team Total Range', 'gHomeGoals', 'gHomeGoalRange'],
  ['corners', 'Total Corners', 'Corner Range', 'gCorners', 'gCornerRange'],
  ['cards', 'Total Cards', 'Total Cards Range', 'gCards', 'gCardRange'],
  ['yellow cards', 'Total Yellow Cards', 'Yellow Card Range', 'gYellowCards', 'gYellowCardRange'],
  ['red cards', 'Total Red Cards', 'Red Card Range', 'gRedCards', 'gRedCardRange'],
  ['booking points', 'Total Booking Points', 'Card Point Range', 'gBookingPoints', 'gCardPointRange'],
  ['fouls', 'Total Fouls', 'Foul Range', 'gFouls', 'gFoulRange'],
  ['shots', 'Total Shots', 'Shots Range', 'gShots', 'gShotsRange'],
  ['shots on target', 'Total Shots on Target', 'Shots on Target Range', 'gShotsOnTarget', 'gSOTRange'],
  ['offsides', 'Total Offsides', 'Offside Range', 'gOffsides', 'gOffsideRange'],
  ['throw-ins', 'Total Throw-ins', 'Throw-in Range', 'gThrowIns', 'gThrowInRange'],
  ['saves', 'Total Saves', 'Saves Range', 'gSaves', 'gSavesRange'],
  ['penalties', 'Total Penalties', 'Penalty Range', 'gPenalties', 'gPenaltyRange'],
];
for (const [stat, overMarket, rangeMarket, overKey, rangeKey] of statisticOverRangePairs) {
  const overPick = pick(`200|${overKey}|2.5|Over`, {
    matchId:'200',marketId:`200|${overKey}|2.5`,marketKey:overKey,
    marketName:overMarket,marketType:'over_under',marketLine:'2.5',outcomeName:'Over 2.5'
  });
  const rangePick = pick(`200|${rangeKey}|2-3|Range`, {
    matchId:'200',marketId:`200|${rangeKey}|2-3`,marketKey:rangeKey,
    marketName:rangeMarket,marketType:'range',marketLine:'2-3',outcomeName:'2-3'
  });
  assert.equal(selectionConflict(overPick,rangePick)?.code,'SAME_STATISTIC_TOTAL_RANGE',
    `${stat}: Over/Under blocks Range across distinct provider market IDs`);
  assert.equal(selectionConflict(rangePick,overPick)?.code,'SAME_STATISTIC_TOTAL_RANGE',
    `${stat}: Range blocks Over/Under in the reverse selection order`);
  assert.deepEqual(toggleCompatibleSelection([overPick],rangePick),[overPick],
    `${stat}: selecting Over/Under keeps Range markets locked`);
  assert.deepEqual(toggleCompatibleSelection([rangePick],overPick),[rangePick],
    `${stat}: selecting Range keeps Over/Under markets locked`);
  assert.throws(()=>assertCompatibleSelections([overPick,rangePick]),
    error=>error.code==='INCOMPATIBLE_SELECTIONS'&&error.conflictCode==='SAME_STATISTIC_TOTAL_RANGE',
    `${stat}: backend rejects Over/Under + Range`);
}

// Actual OddsButton payloads may show a generic title while preserving
// the provider's native market title separately.
const nativeGoalsOver = pick('200|zz910@e30|2.5|Over', {
  matchId:'200',marketId:'200|zz910@e30|2.5',marketName:'Over/Under',
  nativeMarketName:'Total Goals',marketType:'OVER_UNDER',outcomeName:'Over 2.5'
});
const nativeGoalsRange = pick('200|zz911@e30|0-1|Range', {
  matchId:'200',marketId:'200|zz911@e30|0-1',marketName:'Range',
  nativeMarketName:'Multigoals Home Team',marketType:'RANGE',outcomeName:'0-1'
});
assert.equal(selectionConflict(nativeGoalsOver,nativeGoalsRange)?.code,'SAME_STATISTIC_TOTAL_RANGE',
  'Native Zizobet titles identify the same Goals statistic despite generic display names');
assert.deepEqual(toggleCompatibleSelection([nativeGoalsOver],nativeGoalsRange),[nativeGoalsOver]);

// Over/Under picks from different markets of the same statistic are also
// mutually exclusive, including full-time/team/period variants of Goals.
const goalsOver = pick('200|g6379|2.5|Over', {
  matchId:'200',marketId:'200|g6379|2.5',marketKey:'g6379',
  marketName:'Total Goals',marketType:'over_under',outcomeName:'Over 2.5'
});
const homeGoalsUnder = pick('200|gHomeGoals|1.5|Under', {
  matchId:'200',marketId:'200|gHomeGoals|1.5',marketKey:'gHomeGoals',
  marketName:'Home Team Total Goals',marketType:'over_under',outcomeName:'Under 1.5'
});
assert.equal(selectionConflict(goalsOver,homeGoalsUnder)?.code,'SAME_STATISTIC_TOTAL_RANGE');
assert.deepEqual(toggleCompatibleSelection([goalsOver],homeGoalsUnder),[goalsOver]);
assert.throws(()=>assertCompatibleSelections([goalsOver,homeGoalsUnder]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');

// Real screenshot case: provider displays the match total simply as "Total".
const genericMatchUnder = pick('200|zz920@e30|3.5|Under', {
  matchId:'200',marketId:'200|zz920@e30|3.5',marketKey:'zz920@e30',
  marketName:'Total',marketType:'OVER_UNDER',marketLine:'3.5',outcomeName:'Under 3.5'
});
const genericHomeGoalsOver = pick('200|gHomeGoals|0.5|Over', {
  matchId:'200',marketId:'200|gHomeGoals|0.5',marketKey:'gHomeGoals',
  marketName:'Home Team Total Goals',marketType:'OVER_UNDER',marketLine:'0.5',outcomeName:'Over 0.5'
});
assert.equal(selectionConflict(genericMatchUnder,genericHomeGoalsOver)?.family,'goals',
  'Generic Total Under conflicts with Home Team Total Goals Over');
assert.deepEqual(toggleCompatibleSelection([genericMatchUnder],genericHomeGoalsOver),[genericMatchUnder],
  'Frontend blocks generic Total + Home Team Total Goals');
assert.throws(()=>assertCompatibleSelections([genericMatchUnder,genericHomeGoalsOver]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend blocks generic Total + Home Team Total Goals');

// Different statistics and non-total market types remain available.
const cornersOver = pick('200|gCorners|8.5|Over', {
  matchId:'200',marketId:'200|gCorners|8.5',marketKey:'gCorners',
  marketName:'Total Corners',marketType:'over_under',outcomeName:'Over 8.5'
});
assert.doesNotThrow(()=>assertCompatibleSelections([goalsOver,cornersOver,matchResult]));
const bttsMarket = pick('200|gBtts||Yes', {
  matchId:'200',marketId:'200|gBtts|',marketKey:'gBtts',
  marketName:'Both Teams to Score',outcomeName:'Yes'
});
assert.throws(()=>assertCompatibleSelections([goalsOver,bttsMarket]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend blocks a BTTS market alongside another Goals-family selection');
// Selecting 1X2 must not lock unrelated market families from the same fixture.
// The provider market key is the boundary: one pick per key, any number of
// different keys from the same match.
const differentMarketFamilies = [
  pick('200|g6379|2.5|Over',{matchId:'200',marketId:'200|g6379|2.5',marketName:'Total Goals',marketType:'over_under',outcomeName:'Over 2.5'}),
  pick('200|gCards|4.5|Over',{matchId:'200',marketId:'200|gCards|4.5',marketName:'Total Cards',marketType:'over_under',outcomeName:'Over 4.5'}),
  pick('200|gCorners|8.5|Over',{matchId:'200',marketId:'200|gCorners|8.5',marketName:'Total Corners',marketType:'over_under',outcomeName:'Over 8.5'}),
  pick('200|gFouls|21.5|Over',{matchId:'200',marketId:'200|gFouls|21.5',marketName:'Total Fouls',marketType:'over_under',outcomeName:'Over 21.5'}),
  pick('200|gShotsOnTarget|7.5|Over',{matchId:'200',marketId:'200|gShotsOnTarget|7.5',marketName:'Shots on Target',marketType:'over_under',outcomeName:'Over 7.5'}),
  pick('200|gFirstGoal||Home',{matchId:'200',marketId:'200|gFirstGoal|',marketName:'First Goal',outcomeName:'Home'}),
  pick('200|BB|template-a',{matchId:'200',marketId:'200|BB|template-a',marketName:'Bet Builder'})
];
for (const candidate of differentMarketFamilies) {
  assert.equal(selectionConflict(matchResult,candidate),null,
    `1X2 remains compatible with distinct non-result market ${candidate.outcomeId}`);
  assert.deepEqual(toggleCompatibleSelection([matchResult],candidate),[matchResult,candidate],
    `Selecting 1X2 does not disable distinct market ${candidate.outcomeId}`);
}
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,...differentMarketFamilies.filter(p=>!String(p.marketName).includes('First Goal'))]),
  'Backend accepts one selection from each independent family in the same match');
assert.deepEqual(toggleCompatibleSelection([matchResult,otherFixture],matchTotal),[matchResult,otherFixture,matchTotal],
  'Goals totals can combine with the main result market from the same fixture');
assert.deepEqual(toggleCompatibleSelection([matchResult,otherFixture],corners),[matchResult,otherFixture,corners],
  'Corners can combine with result markets');
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,corners,otherFixture]));
const resultCorrectScore=pick('200|gCorrectScore||1:0',{matchId:'200',marketId:'200|gCorrectScore|',marketName:'Correct Score',outcomeName:'1:0'});
assert.equal(selectionConflict(matchResult,resultCorrectScore)?.family,'result',
  '1X2 and Correct Score cannot be stacked as correlated match-result selections');
assert.throws(()=>assertCompatibleSelections([matchResult,resultCorrectScore]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');
assert.doesNotThrow(()=>assertCompatibleSelections([matchTotal,corners,otherFixture]));
assert.doesNotThrow(()=>assertCompatibleSelections([cards,corners,otherFixture]));
assert.equal(selectionConflict(matchResult,doubleChance)?.family,'result',
  '1X2 + Double Chance are mutually exclusive result-family markets');
assert.equal(selectionConflict(matchResult,drawNoBet)?.family,'result',
  '1X2 + Draw No Bet are mutually exclusive result-family markets');
assert.deepEqual(toggleCompatibleSelection([matchResult],doubleChance),[matchResult],
  'A second main-result market is blocked');
assert.throws(()=>assertCompatibleSelections([matchResult,doubleChance,drawNoBet]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');

const goalOver=pick('200|gGoals|1.5|Over',{matchId:'200',marketId:'200|gGoals|1.5',marketName:'Total Goals',marketType:'over_under',marketLine:'1.5',outcomeName:'Over 1.5'});
const goalUnderAlt=pick('200|gGoals|3.5|Under',{matchId:'200',marketId:'200|gGoals|3.5',marketName:'Total Goals',marketType:'over_under',marketLine:'3.5',outcomeName:'Under 3.5'});
assert.equal(selectionConflict(goalOver,goalUnderAlt)?.code,'SAME_MARKET_GROUP',
  'Alternate lines from the same Goals market remain mutually exclusive');
const cornersUnder=pick('200|gCorners|4.5|Under',{matchId:'200',marketId:'200|gCorners|4.5',marketName:'Total Corners',marketType:'over_under',marketLine:'4.5',outcomeName:'Under 4.5'});
assert.equal(selectionConflict(corners,cornersUnder)?.code,'SAME_MARKET_GROUP',
  'Different lines from the same Total Corners market cannot be combined');
const raceCorners=pick('200|gRaceCorners||7',{matchId:'200',marketId:'200|gRaceCorners|',marketName:'Race to 7 Corners',outcomeName:'First to 7'});
const raceCornersAgain=pick('200|gRaceCorners||10',{matchId:'200',marketId:'200|gRaceCorners|',marketName:'Race to 10 Corners',outcomeName:'First to 10'});
assert.equal(selectionConflict(corners,raceCorners)?.family,'corners',
  'Total Corners and Race to X Corners share one statistic family');
assert.equal(selectionConflict(corners,raceCornersAgain)?.family,'corners',
  'Race to X Corners cannot be stacked with Total Corners');
assert.equal(selectionConflict(raceCorners,raceCornersAgain)?.code,'SAME_MARKET_GROUP',
  'Two Race to X choices from the same market cannot be combined');
const firstCornerMarket=pick('200|gFirstCorner||Home',{matchId:'200',marketId:'200|gFirstCorner|',marketName:'First Corner',outcomeName:'Home'});
assert.equal(selectionConflict(corners,firstCornerMarket)?.family,'corners',
  'Total Corners and First Corner share the Corners family');
assert.throws(()=>assertCompatibleSelections([corners,raceCornersAgain,firstCornerMarket]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend blocks multiple Corners markets on one match');
assert.throws(()=>assertCompatibleSelections([corners,cornersUnder]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend rejects two selections from Total Corners');
assert.throws(()=>assertDistinctSelectionMarkets([corners,cornersUnder]),
  error=>error.code==='DUPLICATE_MARKET',
  'Structural duplicate-market guard rejects repeated Corners market');
assert.deepEqual(toggleCompatibleSelection([corners],cornersUnder),[corners],
  'Client refuses a second selection from the same Corners market');
const cardsUnder=pick('200|gCards|5.5|Under',{matchId:'200',marketId:'200|gCards|5.5',marketName:'Total Cards',marketType:'over_under',marketLine:'5.5',outcomeName:'Under 5.5'});
assert.equal(selectionConflict(cards,cardsUnder)?.code,'SAME_MARKET_GROUP',
  'Only one quote from the same Total Cards market is allowed');
assert.equal(findSelectionConflict([matchResult,goalOver,goalUnderAlt])?.code,'SAME_MARKET_GROUP',
  'A second Goals quote is blocked even when 1X2 is selected');
assert.throws(()=>assertCompatibleSelections([matchResult,goalOver,goalUnderAlt]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend rejects 1X2 + Over 1.5 + Over/Under 2.5');
assert.throws(()=>assertDistinctSelectionMarkets([matchResult,goalOver,goalUnderAlt]),
  error=>error.code==='DUPLICATE_MARKET',
  'Structural duplicate-market guard blocks a second Goals total despite a main market');
assert.deepEqual(toggleCompatibleSelection([matchResult,goalOver],goalUnderAlt),
  [matchResult,goalOver],
  'Frontend refuses a second Goals total even when a main market is selected');
assert.equal(selectionConflict(matchResult,matchTotal),null,
  'Main result + total goals are compatible');


// Main market + one full-time Goals total must work in both LIVE and PREMATCH.
const dcGoal = {...matchTotal, outcomeId:'200|g6379|1.5|Over', marketId:'200|g6379|1.5', marketLine:'1.5', outcomeName:'Over 1.5'};
const goalLine35 = {...matchTotal, outcomeId:'200|g6379|3.5|Under', marketId:'200|g6379|3.5', marketLine:'3.5', outcomeName:'Under 3.5'};
for (const status of ['LIVE','PREMATCH']) {
  const main = {...doubleChance, matchSnapshot:{status}};
  const totalA = {...dcGoal, matchSnapshot:{status}};
  const totalB = {...goalLine35, matchSnapshot:{status}};
  assert.deepEqual(toggleCompatibleSelection([main],totalA),[main,totalA],
    `Double Chance + Over 1.5 is accepted for ${status}`);
  assert.deepEqual(toggleCompatibleSelection([main,totalA],totalB),[main,totalA],
    `Double Chance + a second Goals total is blocked for ${status}`);
  assert.throws(()=>assertCompatibleSelections([main,totalA,totalB]),
    error=>error.code==='INCOMPATIBLE_SELECTIONS',
    `Backend blocks Double Chance + multiple Goals totals for ${status}`);
}
assert.throws(()=>assertCompatibleSelections([goalOver,goalUnderAlt]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Multiple goal totals without a main market remain blocked');

// One selection per visible market category for the same fixture, even when
// the provider gives the offers different market IDs and different names.
const nextGoalFromGoals=pick('200|gNextGoal||Home',{matchId:'200',marketId:'200|gNextGoal|',marketName:'Next Goal',outcomeName:'Home'});
assert.equal(selectionConflict(goalOver,nextGoalFromGoals)?.family,'goals',
  'Total Goals and Next Goal share the goal family');
assert.deepEqual(toggleCompatibleSelection([goalOver],nextGoalFromGoals),[goalOver],
  'The slip blocks Next Goal after a Goals selection');
assert.throws(()=>assertCompatibleSelections([goalOver,nextGoalFromGoals]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'The backend blocks Next Goal with another Goals market');

assert.equal(selectionConflict(corners,raceCorners)?.family,'corners',
  'Total Corners and Race to X Corners share one statistic family');
const cardsOther=pick('200|gCards||Over',{matchId:'200',marketId:'200|gCards|',marketName:'Total Cards',outcomeName:'Over'});
const playerOther=pick('200|gBooked||Yes',{matchId:'200',marketId:'200|gBooked|',marketName:'Player to be Booked',outcomeName:'Yes'});
assert.equal(selectionConflict(cardsOther,playerOther),null,
  'Different market IDs can combine even when both were previously classified as Other');
assert.equal(selectionConflict(goalOver,corners),null,
  'Different visible categories remain compatible within one match');
assert.equal(selectionConflict(matchResult,corners),null,
  'Corners must combine with full-time result markets');
assert.equal(selectionConflict(corners,matchResult),null,
  'Corners must combine with full-time result markets in either selection order');
// A Corners pick must bypass every same-match conflict check, even if the
// provider reuses a market identity or the other pick belongs to a restricted family.
const cornerWithSharedIdentity = pick('200|gCorners|2.5|Over', {
  matchId:'200', marketId:'200|shared-market|2.5',
  marketKey:'gCorners', marketName:'Total Corners', marketType:'over_under'
});
const nonCornerWithSharedIdentity = pick('200|gCorners|2.5|Yes', {
  matchId:'200', marketId:'200|shared-market|2.5',
  marketName:'Correct Score', marketType:'other'
});
assert.equal(selectionConflict(cornerWithSharedIdentity, nonCornerWithSharedIdentity)?.code,'SAME_MARKET_GROUP',
  'A Corners pick cannot bypass a duplicate market group');
assert.equal(selectionConflict(nonCornerWithSharedIdentity, cornerWithSharedIdentity)?.code,'SAME_MARKET_GROUP',
  'The duplicate market restriction works in either selection order');
assert.throws(()=>assertDistinctSelectionMarkets([cornerWithSharedIdentity, nonCornerWithSharedIdentity]),
  error=>error.code==='DUPLICATE_MARKET',
  'Structural guard rejects a duplicated Corners market group');
const genericallyNamedCorners = pick('200|zzCorners@total|2.5|Over', {
  matchId:'200', marketId:'200|zzCorners@total|2.5',
  marketKey:'gCorners', marketName:'Over/Under',
  marketType:'over_under', marketLine:'2.5', outcomeName:'Over 2.5'
});
assert.equal(selectionConflict(matchResult,genericallyNamedCorners),null,
  'Native corner market key identifies a generic Over/Under title as Corners');
// The canonical server resolver keeps the generic display title in
// marketName and the actual Zizobet title in nativeMarketName. Native title
// evidence must win even when the display title is generic.
const resolvedZizobetCorner = pick('200|zz901@total|5.5|Over', {
  matchId:'200', marketKey:'zz901@total', marketId:'200|zz901@total|5.5',
  marketName:'Over/Under', marketType:'over_under',
  nativeMarketName:'Total Corners Over/Under', nativeMarketId:'901'
});
const resolvedNonCornerSameGroup = pick('200|zz901@total|5.5|Yes', {
  matchId:'200', marketKey:'zz901@total', marketId:'200|zz901@total|5.5',
  marketName:'Correct Score', marketType:'other'
});
assert.equal(selectionConflict(resolvedZizobetCorner, resolvedNonCornerSameGroup)?.code,'SAME_MARKET_GROUP',
  'Native Corners title does not bypass the one-selection-per-market rule');
assert.equal(selectionConflict(resolvedNonCornerSameGroup, resolvedZizobetCorner)?.code,'SAME_MARKET_GROUP',
  'The native market duplicate rule works in either selection order');
assert.throws(()=>assertDistinctSelectionMarkets([resolvedZizobetCorner, resolvedNonCornerSameGroup]),
  error=>error.code==='DUPLICATE_MARKET');
assert.throws(()=>assertCompatibleSelections([resolvedZizobetCorner, resolvedNonCornerSameGroup]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');
// Mirrors the actual frontend payload after the native provider title is
// forwarded from Market -> OddsButton -> BetSelection. No opaque native key
// or synthetic gCorners identifier is required for classification.
const oddsButtonNativeTitleCorner = pick('200|zz901@total|5.5|Over', {
  matchId:'200', marketId:'200|zz901@total|5.5',
  marketName:'Over/Under', nativeMarketName:'Total Corners Over/Under',
  marketType:'over_under', marketLine:'5.5', outcomeName:'Over 5.5'
});
assert.equal(selectionConflict(matchResult, oddsButtonNativeTitleCorner), null,
  'Frontend Corners pick is recognized from the preserved native Zizobet title');
assert.equal(selectionConflict(oddsButtonNativeTitleCorner, matchTotal), null,
  'Native-title Corners pick combines with Goals in the frontend');
assert.equal(selectionConflict(oddsButtonNativeTitleCorner, cornersUnder)?.family,'corners',
  'Different provider IDs still share the Corners family');
assert.throws(()=>assertCompatibleSelections([matchResult, oddsButtonNativeTitleCorner, cornersUnder]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Server blocks two Corners-family selections alongside the main result');
// This mirrors the exact object built by OddsButton: marketKey/extId are not
// sent to the betslip, so category detection must read the native key in outcomeId.
const actualOddsButtonCorner = pick('200|gCorners|2.5|Over', {
  matchId:'200', marketId:'local-market-id',
  marketName:'Over/Under', marketType:'over_under',
  marketLine:'2.5', outcomeName:'Over 2.5'
});
const firstHalfTotal=pick('200|gGoals1h|1.5|Over',{matchId:'200',marketId:'200|gGoals1h|1.5',marketName:'1st Half Total Goals',marketType:'over_under',marketLine:'1.5',outcomeName:'Over 1.5',period:1});
const sameGameCombo=pick('200|BB|template-a',{matchId:'200',marketId:'200|BB|template-a',marketName:'Bet Builder'});
for (const other of [matchResult, matchTotal, cards, firstHalfTotal, sameGameCombo]) {
  assert.equal(selectionConflict(other, actualOddsButtonCorner), null,
    'A native gCorners selection from the real OddsButton payload combines with every market family');
  assert.equal(selectionConflict(actualOddsButtonCorner, other), null,
    'Corners compatibility is independent of selection order');
}
assert.equal(selectionConflict(actualOddsButtonCorner, cornersUnder)?.code,'SAME_MARKET_GROUP',
   'Two gCorners offers from the same provider market group are blocked');
const albanianCornerTitle = pick('200|local-corner-market|10.5|Over', {
  matchId:'200', marketId:'local-corner-id',
  marketName:'Totali i goditjeve këndore (10.5)',
  marketType:'over_under', marketLine:'10.5', outcomeName:'Lart'
});
assert.equal(selectionConflict(matchResult, albanianCornerTitle), null,
  'Albanian translated corner title combines with Match Result');
const albanianSecondCorner = {...albanianCornerTitle, outcomeId:'200|local-corner-market|11.5|Under', marketLine:'11.5', outcomeName:'Poshtë'};
assert.equal(selectionConflict(albanianCornerTitle, albanianSecondCorner)?.code,'SAME_MARKET_GROUP',
  'Two Albanian quotes from the same Corners market are blocked');
// Zizobet sometimes gives the offer a local outcome ID, so OddsButton
// must carry extId/marketKey into the selection. This applies identically
// to live and prematch fixtures.
for (const status of ['LIVE','PREMATCH']) {
 const extIdCorner = pick(`200|local-outcome-${status}|10.5|Over`, {
  matchId:'200', marketId:'local-corner-${status}', extId:'gCorners',
  marketKey:'gCorners', marketName:'Over/Under', marketType:'over_under',
  marketLine:'10.5', outcomeName:'Over 10.5',
  matchSnapshot:{status}
 });
 assert.equal(selectionConflict(matchResult, extIdCorner), null,
  `Result + Corners must combine for ${status}`);
 assert.equal(selectionConflict(extIdCorner, actualOddsButtonCorner)?.family,'corners',
   `Different Corners market IDs still share the statistic family for ${status}`);
}
// Corners must remain combinable with all distinct market categories
// for both live and prematch selections, even when the visible label is generic.
for (const status of ['LIVE','PREMATCH']) {
 const resultPick = {...matchResult, matchSnapshot:{status}};
 const cornerPick = pick(`200|local-corner-${status}|10.5|Over`, {
  matchId:'200', marketId:`local-corner-${status}`, extId:'gCorners',
  marketKey:'gCorners', marketName:'Over/Under', marketType:'over_under',
  marketLine:'10.5', outcomeName:'Over 10.5', matchSnapshot:{status}
 });
 assert.equal(selectionConflict(resultPick, cornerPick), null,
  `Result + Corners are compatible in ${status}`);
 assert.equal(selectionConflict(cornerPick, matchTotal), null,
  `Corners + Goals are compatible in ${status}`);
 assert.equal(selectionConflict(cornerPick, cards), null,
  `Corners + Cards are compatible in ${status}`);
}
const actualSecondCorner = pick('200|gCorners|5.5|Under', {
  matchId:'200', marketId:'another-local-market-id',
  marketName:'Over/Under', marketType:'over_under',
  marketLine:'5.5', outcomeName:'Under 5.5'
});
assert.equal(selectionConflict(actualOddsButtonCorner, actualSecondCorner)?.code,'SAME_MARKET_GROUP',
   'Two generic Over/Under quotes from the same gCorners market group are blocked');
assert.equal(selectionConflict(actualOddsButtonCorner, matchTotal), null,
  'Corners remain compatible with Goals despite generic Over/Under labels');
assert.equal(selectionConflict(actualOddsButtonCorner, matchResult), null,
  'A corner selection combines with 1X2 on the same match');
// Every provider Corners market family is stackable, not only Total Corners.
// Cover translated labels, team-most-corners, handicaps, team totals, race-to,
// first-corner, and period/interval variants with generic Over/Under labels.
const allCornerMarketTypes = [
  {marketName:'Skuadra me me shume goditje kendore', marketType:'other'},
  {marketName:'Over/Under', marketType:'team_with_most_corners'},
  {marketName:'Over/Under', marketType:'corner_handicap'},
  {marketName:'Home Team Total', marketType:'home_team_corners'},
  {marketName:'Race to 5', marketType:'race_to_corners'},
  {marketName:'First Corner', marketType:'first_corner'},
  {marketName:'2nd Half Total', marketType:'corners_2h'},
  {marketName:'Over/Under', extId:'gMostCorners'},
  {marketName:'Over/Under', marketKey:'gCornerHandicap'},
];
const allCornerSelections = allCornerMarketTypes.map((fields,index)=>pick(
  `200|corner-family-${index}|1|Home`,
  {matchId:'200',marketId:`local-corner-family-${index}`,outcomeName:'Home',...fields}
));
for (const cornerPick of allCornerSelections) {
  assert.equal(selectionConflict(matchResult,cornerPick),null,
    'Every Corners market family combines with 1X2');
  assert.equal(selectionConflict(cornerPick,matchTotal),null,
    'Every Corners market family combines with Goals');
}
assert.equal(findSelectionConflict(allCornerSelections)?.family,'corners',
  'All Corners market types share one statistic family on a fixture');
assert.throws(()=>assertCompatibleSelections([matchResult,...allCornerSelections]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend blocks multiple Corners market types in one ticket');
assert.deepEqual(toggleCompatibleSelection([matchResult,...allCornerSelections.slice(0,-1)],allCornerSelections.at(-1)),
  [matchResult,...allCornerSelections.slice(0,-1)],
  'Client blocks a second Corners-family selection while preserving unrelated picks');

// Corners acceptance is independent of line magnitude, including zero and
// unusually large provider lines, for both client and backend validation.
for (const line of ['0','0.5','7.5','1000.5','1000000.5']) {
 const cornerLine = pick(`200|gCorners|${line}|Over`, {
  matchId:'200', marketId:`200|gCorners|${line}`,
  marketName:`Total Corners (${line})`, marketType:'over_under',
  marketLine:line, outcomeName:`Over ${line}`
 });
 const anotherCornerLine = pick(`200|gCorners|${line}|Under`, {
  matchId:'200', marketId:`200|gCorners|${line}`,
  marketName:`Total Corners (${line})`, marketType:'over_under',
  marketLine:line, outcomeName:`Under ${line}`
 });
 assert.equal(selectionConflict(cornerLine, anotherCornerLine)?.code,'SAME_MARKET_GROUP',
  `Total Corners line ${line} cannot be selected twice`);
 assert.throws(()=>assertCompatibleSelections([matchResult,cornerLine,anotherCornerLine]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  `Backend rejects duplicate Total Corners picks at line ${line}`);
 assert.deepEqual(toggleCompatibleSelection([matchResult,cornerLine],anotherCornerLine),
  [matchResult,cornerLine],
  `Client blocks second Total Corners pick at line ${line}`);
}
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult, actualOddsButtonCorner, matchTotal]),
  'Main result + Goals + Corners are allowed together');
assert.deepEqual(toggleCompatibleSelection([matchResult, actualOddsButtonCorner], matchTotal),
  [matchResult, actualOddsButtonCorner, matchTotal],
  'The client allows a goal total alongside an existing main result + Corners');
assert.equal(selectionConflict(matchResult,firstHalfTotal),null,
  '1X2 and a first-half Goals market are distinct markets');
assert.equal(selectionConflict(matchResult,sameGameCombo),null,
  '1X2 and Bet Builder are distinct markets');
assert.equal(selectionConflict(firstHalfTotal,sameGameCombo),null,
  'First-half Goals and Bet Builder are distinct markets');
assert.equal(selectionConflict(matchResult,{...sameGameCombo,matchId:'201',marketId:'201|BB|template-a'}),null,
  'Selections from different fixtures remain compatible');
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,firstHalfTotal]));
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,sameGameCombo]));
assert.doesNotThrow(()=>assertCompatibleSelections([firstHalfTotal,sameGameCombo]));
assert.throws(()=>assertCompatibleSelections([goalOver,goalUnderAlt]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');
assert.equal(selectionConflict(matchResult,matchTotal),null,
  'Result and Goals can combine without requiring a corner market');
assert.equal(selectionConflict(fullTimeResultGoals,goalOver)?.family,'goals',
   'Full Time Result/Goals overlaps with Total Goals');
assert.equal(selectionConflict(goalOver,fullTimeResultGoals)?.family,'goals',
   'The combined Result/Goals market conflicts in either selection order');
assert.equal(selectionConflict(fullTimeResultGoals,cards),null,
  'Different non-Corners market categories combine on one match');
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,matchTotal]),
  'Backend accepts Result + Goals without Corners');
assert.doesNotThrow(()=>assertCompatibleSelections([goalOver,cards]),
  'Backend accepts Goals + Cards as different markets');
assert.throws(()=>assertCompatibleSelections([fullTimeResultGoals,goalOver]),
   error=>error.code==='INCOMPATIBLE_SELECTIONS',
   'Backend rejects overlapping full-time goal market groups');
assert.deepEqual(toggleCompatibleSelection([fullTimeResultGoals],goalOver),[fullTimeResultGoals],
   'Player betslip blocks Full Time Result/Goals + Total Goals');
assert.equal(selectionConflict(goalOver,cards),null,
  'Goals and Cards are distinct markets and can combine');
assert.equal(selectionConflict(sameGameCombo,goalOver),null,
  'Bet Builder and Goals are distinct markets and can combine');
assert.equal(selectionConflict(sameGameCombo,corners),null,
  'Bet Builder can combine with Corners');
assert.equal(selectionConflict(firstHalfTotal,corners),null,
  'First-half goals can combine with Corners');
assert.equal(selectionConflict(matchTotal,corners),null,
  'Full-time goals can combine with Corners');
const firstHalfGoals={...goalUnderAlt,outcomeId:'200|gGoals1h|1.5|Under',marketId:'200|gGoals1h|1.5',marketName:'1st Half Total Goals',marketLine:'1.5',period:1};
assert.equal(selectionConflict(goalOver,firstHalfGoals)?.code,'SAME_STATISTIC_TOTAL_RANGE',
  'Goals Over/Under is exclusive across full-time and first-half Goals markets');
assert.throws(()=>assertCompatibleSelections([goalOver,firstHalfGoals]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend blocks full-time and first-half Goals Over/Under together');
const secondHalfGoals={...goalUnderAlt,outcomeId:'200|gGoals2h|1.5|Under',marketId:'200|gGoals2h|1.5',marketName:'2nd Half Total Goals',marketLine:'1.5',period:2};
assert.equal(selectionConflict(goalOver,secondHalfGoals)?.code,'SAME_STATISTIC_TOTAL_RANGE',
  'Goals Over/Under is exclusive across full-time and second-half Goals markets');
const homeTeamGoals=pick('200|gHomeGoals|1.5|Over',{matchId:'200',marketId:'200|gHomeGoals|1.5',marketKey:'gHomeGoals',marketName:'Home Team Total Goals',marketType:'over_under',marketLine:'1.5',outcomeName:'Over 1.5'});
const awayTeamGoals=pick('200|gAwayGoals|1.5|Over',{matchId:'200',marketId:'200|gAwayGoals|1.5',marketKey:'gAwayGoals',marketName:'Away Team Total Goals',marketType:'over_under',marketLine:'1.5',outcomeName:'Over 1.5'});
assert.equal(selectionConflict(homeTeamGoals,awayTeamGoals)?.code,'SAME_STATISTIC_TOTAL_RANGE',
  'Home and Away Team Goals Over/Under share the same Goals exclusivity group');
assert.equal(selectionConflict(goalOver,homeTeamGoals)?.code,'SAME_STATISTIC_TOTAL_RANGE',
  'Total Goals and Home Team Goals Over/Under cannot be combined');
assert.throws(()=>assertCompatibleSelections([homeTeamGoals,awayTeamGoals]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend blocks Home Team Goals + Away Team Goals Over/Under');

const correctScore=pick('200|gCorrectScore||0:0',{matchId:'200',marketId:'200|gCorrectScore|',marketName:'Correct Score',outcomeName:'0:0'});
assert.equal(selectionConflict(matchResult,correctScore)?.family,'result',
  'Match Result and Correct Score are correlated match-result outcomes');
assert.equal(selectionConflict(doubleChance,correctScore)?.family,'result',
  'Double Chance and Correct Score are correlated match-result outcomes');

const prematch={status:'PREMATCH'};
const underHalf=pick('200|gGoals|0.5|Under',{matchId:'200',marketId:'200|gGoals|0.5',marketName:'Total Goals',marketType:'over_under',marketLine:'0.5',outcomeName:'Under 0.5',matchSnapshot:prematch});
const zeroZero=pick('200|gCorrectScore||0:0',{matchId:'200',marketId:'200|gCorrectScore|',marketName:'Correct Score',outcomeName:'0:0',matchSnapshot:prematch});
const noFirstGoal=pick('200|gFirstGoal||None',{matchId:'200',marketId:'200|gFirstGoal|',marketName:'First Goal',outcomeName:'No Goal',matchSnapshot:prematch});
const noGoals=pick('200|gNoGoals||Yes',{matchId:'200',marketId:'200|gNoGoals|',marketName:'No Goals',outcomeName:'Yes',matchSnapshot:prematch});
const exactZero=pick('200|gExactGoals||0',{matchId:'200',marketId:'200|gExactGoals|',marketName:'Exact Goals',outcomeName:'0',matchSnapshot:prematch});
assert.equal(selectionConflict(underHalf,noGoals)?.family,'goals',
  'Under 0.5 and No Goals are the same zero-goal result');
assert.equal(selectionConflict(underHalf,exactZero)?.family,'goals',
  'Under 0.5 and Exact Goals: 0 are the same zero-goal result');
assert.equal(selectionConflict(noGoals,exactZero)?.family,'goals',
  'No Goals and Exact Goals: 0 cannot be stacked');
assert.equal(selectionConflict(underHalf,zeroZero)?.family,'goals',
  'Under 0.5 and Correct Score 0:0 represent the same no-goal outcome');
assert.equal(selectionConflict(underHalf,noFirstGoal)?.family,'goals',
  'Under 0.5 and First Goal: No Goal represent the same full-time outcome');
assert.equal(selectionConflict(zeroZero,noFirstGoal)?.family,'goals',
  'Correct Score 0:0 and First Goal: No Goal are equivalent');
assert.throws(()=>assertCompatibleSelections([underHalf,zeroZero,noFirstGoal]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');
const resolvedUnder = {matchId:'200',marketKey:'gGoals',line:'0.5',outcomeKey:'Under',outcomeName:'Under 0.5',
  marketName:'Total Goals',marketType:'over_under',acceptedLiveSnapshot:{isLive:false}};
const resolvedFirstGoal = {matchId:'200',marketKey:'gFirstGoal',line:'',outcomeKey:'None',outcomeName:'No Goal',
  marketName:'First Goal',acceptedLiveSnapshot:{isLive:false}};
assert.equal(selectionConflict(resolvedUnder,resolvedFirstGoal)?.family,'goals',
  'Server-resolved no-goal contracts conflict across provider market keys');
assert.throws(()=>assertCompatibleSelections([resolvedUnder,resolvedFirstGoal]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');

const bttsNo=pick('200|gBtts||No',{matchId:'200',marketId:'200|gBtts|',marketName:'Both Teams To Score',outcomeName:'No',matchSnapshot:prematch});
assert.equal(selectionConflict(underHalf,bttsNo)?.family,'goals',
  'Under 0.5 and BTTS No belong to the same Goals family');
const liveNoFirstGoal={...noFirstGoal,matchSnapshot:{status:'LIVE'}};
assert.equal(selectionConflict(underHalf,liveNoFirstGoal)?.family,'goals',
  'Live goal contracts remain exclusive within the same Goals family');

assert.equal(selectionConflict(matchResult,otherFixture),null);
assert.deepEqual(toggleCompatibleSelection([matchResult],matchResult),[],
  'Clicking a selected outcome removes it');
// Admin retains the pre-existing behavior: different markets on the same match coexist.
assert.deepEqual(toggleMarketSelection([matchResult],matchTotal),[matchResult,matchTotal]);
assert.doesNotThrow(()=>assertDistinctSelectionMarkets([matchResult,matchTotal]));
// The stricter legacy helper remains available to older callers, but is not used for player slips.
assert.deepEqual(toggleMatchSelection([matchResult],matchTotal),[matchTotal]);

// Reproduce the actual OddsButton payload: generic display labels, with
// the native Zizobet market key carried in extId/marketKey and outcomeId.
const nativeKeyFamilies = [
  ['goals','gGoals','gHomeGoals','Over/Under','Over/Under'],
  ['corners','gCorners','gCornerRange','Over/Under','Range'],
  ['cards','gCards','gCardRange','Over/Under','Range'],
  ['yellow cards','gYellowCards','gYellowCardRange','Over/Under','Range'],
  ['red cards','gRedCards','gRedCardRange','Over/Under','Range'],
  ['booking points','gBookingPoints','gBookingPointsRange','Over/Under','Range'],
  ['fouls','gFouls','gFoulRange','Over/Under','Range'],
  ['shots','gShots','gShotsRange','Over/Under','Range'],
  ['shots on target','gShotsOnTarget','gShotsOnTargetRange','Over/Under','Range'],
  ['offsides','gOffsides','gOffsideRange','Over/Under','Range'],
  ['throw-ins','gThrowIns','gThrowInRange','Over/Under','Range'],
  ['saves','gSaves','gSavesRange','Over/Under','Range'],
  ['penalties','gPenalties','gPenaltyRange','Over/Under','Range'],
];
for (const [family, totalKey, rangeKey, totalLabel, rangeLabel] of nativeKeyFamilies) {
  const total = pick(`200|${totalKey}|2.5|Over`, {
    matchId:'200', marketId:`200|${totalKey}|2.5`, extId:totalKey, marketKey:totalKey,
    marketName:totalLabel, marketType:'over_under', marketLine:'2.5', outcomeName:'Over 2.5'
  });
  const range = pick(`200|${rangeKey}|2-3|Range`, {
    matchId:'200', marketId:`200|${rangeKey}|2-3`, extId:rangeKey, marketKey:rangeKey,
    marketName:rangeLabel, marketType:'range', marketLine:'2-3', outcomeName:'2-3'
  });
  assert.equal(selectionConflict(total,range)?.family,
    ['yellow cards','red cards','booking points'].includes(family) ? 'cards' : family === 'shots on target' ? 'shots' : family === 'throw-ins' ? 'throw_ins' : family,
    `${family}: native camelCase provider keys conflict despite generic display labels`);
  assert.equal(selectionConflict(range,total)?.family,
    ['yellow cards','red cards','booking points'].includes(family) ? 'cards' : family === 'shots on target' ? 'shots' : family === 'throw-ins' ? 'throw_ins' : family,
    `${family}: native-key conflict works in reverse order`);
  assert.deepEqual(toggleCompatibleSelection([total],range),[total],
    `${family}: frontend locks a range market using native keys only`);
  assert.throws(()=>assertCompatibleSelections([total,range]),
    error=>error.code==='INCOMPATIBLE_SELECTIONS',
    `${family}: backend rejects native-key total plus range`);
}

// Home/away team totals must share the same goals family even when their
// only identifying evidence is the Zizobet camelCase key.
for (const teamKey of ['gHomeGoals','gAwayGoals','gHomeTeamGoals','gAwayTeamGoals']) {
  const team = pick(`200|${teamKey}|1.5|Over`, {
    matchId:'200',marketId:`200|${teamKey}|1.5`,extId:teamKey,marketKey:teamKey,
    marketName:'Over/Under',marketType:'over_under',marketLine:'1.5',outcomeName:'Over 1.5'
  });
  assert.equal(selectionConflict(matchTotal,team)?.family,'goals',
    `${teamKey}: team total conflicts with match total using native ID alone`);
  assert.deepEqual(toggleCompatibleSelection([matchTotal],team),[matchTotal]);
  assert.throws(()=>assertCompatibleSelections([matchTotal,team]),
    error=>error.code==='INCOMPATIBLE_SELECTIONS');
}

// Compound markets represent more than their visible category. They
// must be excluded against every family they encode.
for (const marketName of [
  'Home team wins to nil',
  'Away team wins to nil',
  'Home team wins any of the halves',
  'Home team wins both halves',
  'Away team wins any of the halves',
  'Away team wins both halves',
  'Draw or any clean sheet',
  'Home team wins or any clean sheet',
  'Away team win or any clean sheet',
  'Home team win or both teams to score',
  'Away team wins or both teams to score',
]) {
  const compound = pick(`200|${marketName}|Yes`, {
    matchId:'200', marketId:`200|${marketName}`, marketName, marketType:'other', outcomeName:'Yes'
  });
  assert.ok(selectionConflict(matchTotal,compound),
    `${marketName}: conflicts with Total Goals`);
  assert.ok(selectionConflict(matchResult,compound),
    `${marketName}: conflicts with Match Result`);
}
for (const marketName of ['Home team to score in both halves','Away team to score in both halves']) {
  const scoring = pick(`200|${marketName}|Yes`, {
    matchId:'200', marketId:`200|${marketName}`, marketName, marketType:'other', outcomeName:'Yes'
  });
  assert.ok(selectionConflict(matchTotal,scoring),
    `${marketName}: conflicts with Total Goals`);
  assert.equal(selectionConflict(matchResult,scoring),null,
    `${marketName}: remains distinct from Match Result`);
}

// Goal-family offers that have no "Goals" word in the visible title,
// including period-specific Home/Away team totals. All must conflict.
const goalFamilyExamples = [
  ['generic full-time total', 'Total', 'TOTAL', 'Over 3.5', 'zz-goal-total'],
  ['BTTS', 'Both Teams To Score', 'YES_NO', 'Yes', 'gBtts'],
  ['Home team total', 'Home Team Total', 'TOTAL', 'Over 0.5', 'gHomeGoals'],
  ['Away team total', 'Away Team Total', 'TOTAL', 'Over 0.5', 'gAwayGoals'],
  ['Home team exact goals', 'Home Team Exact Goals 3+', 'OTHER', 'Yes', 'gHomeExactGoals'],
  ['Away team exact goals', 'Away Team Exact Goals 3+', 'OTHER', 'Yes', 'gAwayExactGoals'],
  ['Exact goals 5+', 'Exact Goals 5+', 'OTHER', 'Yes', 'gExactGoals5Plus'],
  ['Exact goals 6+', 'Exact Goals 6+', 'OTHER', 'Yes', 'gExactGoals6Plus'],
  ['Exact goals 9+', 'Exact Goals 9+', 'OTHER', 'Yes', 'gExactGoals9Plus'],
  ['Number of Goals 6+', 'Number of Goals 6+', 'OTHER', 'Yes', 'gNumberGoals6Plus'],
  ['Correct score variant A', 'Correct Score', 'OTHER', '1:0', 'gCorrectScoreA'],
  ['Correct score variant B', 'Correct score', 'OTHER', '1:0', 'gCorrectScoreB'],
  ['Correct score variant C', 'Correct Score', 'OTHER', '1:0', 'gCorrectScoreC'],
  ['Both half goals under', 'Both Half Goals Under', 'OTHER', 'Yes', 'gBothHalfGoalsUnder'],
  ['Both half goals over', 'Both Half Goals Over', 'OTHER', 'Yes', 'gBothHalfGoalsOver'],
  ['2nd half Home team total', '2nd Half - Home Team Total', 'TOTAL', 'Over 0.5', 'gHomeGoals2h'],
  ['2nd half Away team total', '2nd Half - Away Team Total', 'TOTAL', 'Over 0.5', 'gAwayGoals2h'],
  ['1st half Home team total', '1st Half - Home Team Total', 'TOTAL', 'Over 0.5', 'gHomeGoals1h'],
  ['1st half Away team total', '1st Half - Away Team Total', 'TOTAL', 'Over 0.5', 'gAwayGoals1h'],
];
const goalFamilyPicks = goalFamilyExamples.map((entry,index) => {
  const [label,marketName,marketType,outcomeName,key] = entry;
  const period = key.endsWith('1h') ? 1 : key.endsWith('2h') ? 2 : 0;
  return pick('200|' + key + '|' + index + '|' + outcomeName, {
    matchId:'200', marketId:'200|' + key + '|' + index,
    marketKey:key, extId:key, marketName, nativeMarketName:marketName,
    marketType, marketLine:'0.5', outcomeName, period
  });
});
for (let i=0;i<goalFamilyPicks.length;i++) {
  for (let j=i+1;j<goalFamilyPicks.length;j++) {
    const first=goalFamilyPicks[i], second=goalFamilyPicks[j];
    assert.ok(selectionConflict(first,second),
      'Goal family pair is blocked: ' + goalFamilyExamples[i][0] + ' + ' + goalFamilyExamples[j][0]);
    assert.deepEqual(toggleCompatibleSelection([first],second),[first],
      'Frontend blocks ' + goalFamilyExamples[j][0] + ' after ' + goalFamilyExamples[i][0]);
    assert.throws(()=>assertCompatibleSelections([first,second]),
      error=>error.code==='INCOMPATIBLE_SELECTIONS',
      'Backend blocks ' + goalFamilyExamples[i][0] + ' + ' + goalFamilyExamples[j][0]);
  }
}
// Goals selections from either half remain combinable with unrelated families.
assert.equal(selectionConflict(goalFamilyPicks[0],corners),null);
assert.equal(selectionConflict(goalFamilyPicks[15],cards),null);

console.log('PASS compatible same-match combinations, result-family exclusions, statistic totals, periods, correlated no-goal picks, and backend-resolved contracts.');
