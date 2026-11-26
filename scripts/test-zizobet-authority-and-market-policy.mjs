import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {isZizobetNativeOffer} from '../server/ledger/decided-markets.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {isExcludedOfferMarket,isPlayerOfferMarket,isRetiredPlayerOfferMarket} from '../server/market-policy.mjs';
import {isFinished,getResult,FINISHED_RESULT_INSERT} from '../server/ledger/results.mjs';
import {extractConfirmedHalfTimeCandidate} from '../server/ledger/halftime-results.mjs';
import {toDbOddsShape,buildMarkets} from '../server/collector.mjs';
import {SCHEMA_SQL} from '../server/schema.mjs';
import {MARKET_CATEGORY_IDS,catalogRows,setCatalogRows,marketIsEnabled} from '../server/market-catalog.mjs';
import {snapshotRow} from '../server/ledger/match-snapshots.mjs';
import {createEventEvidenceStore,gradeEventLine} from '../server/ledger/event-evidence.mjs';
import {eventMarketRequirement} from '../server/ledger/event-market-policy.mjs';

assert.equal(eventMarketRequirement({name:'Scoring Type'}),'GOAL_CONTRACT_DATA_REQUIRED',
 'Scoring Type cannot be settled from aggregate score without explicit goal-method facts');
assert.equal(isZizobetNativeOffer({key:'zz910@e30'}),true,
 'Zizobet market-key identities are recognized as native');
assert.equal(isZizobetNativeOffer({extId:'zz911@e30'}),true,
 'serialized native Zizobet extIds are recognized');
assert.equal(isZizobetNativeOffer({}, {raw:{provider:'ZIZOBET'}}),true,
 'Zizobet match identity is authoritative when the market key is legacy');
assert.equal(isZizobetNativeOffer({key:'yb910@e30'}),false,
 'YBets offers are not mistaken for Zizobet-native offers');

const interval=liveContract({
 market_name:'When will goal 2 be scored',
 outcome_name:'50+',
 market_key:'zz-test'
});
assert.deepEqual(interval,{
 version:1,kind:'nth-time',event:'goal',target:2,choice:'range',from:50,to:130
});

// At half-time, the first goal exists but goal #2 has not happened. The 50+
// interval is still ahead, so a half-time snapshot cannot mark it LOST.
const observed=new Date('2026-11-16T19:00:00.000Z');
const calls=[];
const halftime=await gradeStoredEventContract({
 id:'line-50-plus',match_id:123,
 live_contract:interval
 },null,{execute:async(sql)=>{
  calls.push(sql);
  return {rows:[{
   total:1,home:1,away:0,color_total:0,color_home:0,color_away:0,
   window_count:0,color_window_count:0,window_home:0,window_away:0,
   rolling_boundary_uncertain:false,ambiguous_order:false,minute_only:false,
   through_minute:45,count_home:1,count_away:0,complete:false,
   observed_at:observed,confirmed_at:observed,card_colors_verified:false,
   second_poll_at:observed,archive_poll_at:null,open_recovery_gap:false,
   last_team:'home',last_same_time:1,nth_team:null,nth_minute:null,nth_same_time:null,
   race_home:null,race_away:null,race_home_time:null,race_away_time:null
  }]};
 }});
assert.equal(halftime,null,'50+ stays pending at half-time');
assert.equal(calls.length,1,'only the Zizobet evidence query is used');

// A later Zizobet timeline proves the second goal occurred inside 50+.
const later=await gradeStoredEventContract({
 id:'line-50-plus',match_id:123,live_contract:interval
 },null,{execute:async()=>({rows:[{
  total:2,home:1,away:1,color_total:0,color_home:0,color_away:0,
  window_count:1,color_window_count:0,window_home:0,window_away:1,
  rolling_boundary_uncertain:false,ambiguous_order:false,minute_only:false,
  through_minute:61,count_home:1,count_away:1,complete:false,
  observed_at:observed,confirmed_at:observed,card_colors_verified:false,
  second_poll_at:observed,archive_poll_at:null,open_recovery_gap:false,
  last_team:'away',last_same_time:1,nth_team:'away',nth_minute:55,nth_same_time:1,
  race_home:null,race_away:null,race_home_time:null,race_away_time:null
 }]})});
assert.equal(later,'WON','a Zizobet-confirmed goal #2 in 50+ wins');

// No backup API may be queried to rescue missing primary evidence.
const providerQueries=[];
const noPrimary=await gradeStoredEventContract({
 id:'line-primary-only',match_id:124,
 live_contract:{version:1,kind:'window-total',event:'goal',from:50,to:60,choice:'over',threshold:0.5}
 },{home_score:1,away_score:0},{execute:async(sql)=>{
  providerQueries.push(sql);
  return {rows:[]};
 }});
assert.equal(noPrimary,null);
assert.equal(providerQueries.length,1,'missing Zizobet evidence remains pending without backup-provider queries');
assert.match(providerQueries[0],/provider=\$16::text/);

// The legacy event-evidence path is also pinned to Zizobet. A complete
// secondary timeline is not a settlement source.
assert.equal(gradeEventLine({
 market_name:'First Goal',outcome_name:'Home'
 },{
 home_score:1,away_score:0,
 event_evidence:{source:'fotmob',complete:true,events:[
  {id:'secondary-goal',type:'goal',team:'home',minute:20}
 ]}
}),null,'secondary provider timelines cannot grade legacy event contracts');
let evidenceQueries=0;
const evidenceStore=createEventEvidenceStore({runQuery:async()=>{
 evidenceQueries++;throw Error('secondary evidence must be rejected before storage');
}});
assert.equal(await evidenceStore.saveEventEvidence(999,{
 source:'aiscore',events:[{type:'goal',team:'home',minute:20}]
}),false);
assert.equal(evidenceQueries,0,'secondary evidence is not written to settlement evidence storage');

// Offers that the operator does not use are rejected at the global ingest gate.
for(const name of [
 'Asian Handicap','Total Fouls','Total Cards','Player Shots On Target',
 'Anytime Goalscorer','First Goal Scorer','Goalkeeper Saves','Total Tackles','Throw-ins'
])assert.equal(isExcludedOfferMarket({market_name:name}),true,name+' must be excluded');
assert.equal(isExcludedOfferMarket({market_name:'Total Goals'}),false);
assert.equal(isExcludedOfferMarket({market_name:'Total Corners'}),false);
assert.equal(isExcludedOfferMarket({market_name:'Corners and Total Cards'}),true,
 'a combined corners/cards offer must not bypass the explicit card exclusion');
assert.equal(isExcludedOfferMarket({market_name:'Corners and Total Shots'}),true,
 'a combined corners/shots offer must not bypass the explicit shots exclusion');
assert.equal(isExcludedOfferMarket({market_name:'Full Time Result'}),false);
assert.equal(isExcludedOfferMarket({market_name:'Early Payout'}),true,
 'early payout is excluded at publication and must also be rejected at native placement');
assert.equal(isExcludedOfferMarket({key:'zizobet:live:27073',name:'Special Offer'}),true,
 'the native early-payout ID stays excluded even when its display title is generic');
assert.equal(isExcludedOfferMarket({market_name:'Total Goals',pl:'player-42'}),true,
 'a native player parameter retires the market even if the display title hides the player');
assert.equal(isExcludedOfferMarket({market_name:'Total Goals {pl}'}),true,
 'an unresolved native player placeholder must not leak into public markets');


// All final-score paths require the primary feed identity, not merely an FT label.
const finishedRow={
 match_id:700,home:'A',away:'B',
 raw:{provider:'ZIZOBET'},feed_status:'Finished',
 home_score:2,away_score:1,
 score_at:'2026-11-16T18:00:00.000Z'
};

// Durable restart snapshots must retain the provider identity used by
// isFinished(), otherwise verified Zizobet results disappear after a restart.
assert.equal(snapshotRow(finishedRow).raw.provider,'ZIZOBET');

assert.equal(isFinished(finishedRow),true);
for(const provider of ['FOTMOB','AISCORE','YBETS','SPORTRADAR'])
 assert.equal(isFinished({...finishedRow,raw:{provider}}),false,
  provider+' cannot supply a financial final result');
assert.match(FINISHED_RESULT_INSERT,/source\s*\)\s*values[^;]*'ZIZOBET'/s);

// Half-time settlement also requires a positive Zizobet source identity.
const halftimeRow={
 ...finishedRow,home_score:1,away_score:0,feed_status:'HT',
 feed_status_at:'2026-11-16T18:00:00.000Z',
 clock_at:'2026-11-16T18:00:02.000Z',
 periods_score:[{t1:1,t2:0}]
};
assert.equal(extractConfirmedHalfTimeCandidate(halftimeRow)?.home,1);
for(const provider of ['FOTMOB','AISCORE','YBETS'])
 assert.equal(extractConfirmedHalfTimeCandidate({...halftimeRow,raw:{provider}}),null);

// Secondary statistics can be shown to admins but cannot fill missing
// Zizobet settlement statistics.
let resultQuery=0;
const stored=await getResult(700,{
 execute:async sql=>{
  resultQuery++;
  if(sql.includes('app_match_result'))return {rows:[{
   source:'ZIZOBET',home_score:1,away_score:0,
   statistics:{shots:{home:2,away:3}}
  }]};
  if(sql.includes('app_stat_review'))return {rows:[{payload:{
   complete:true,consensus:{shots:{home:99,away:99}},conflicts:{}
  }}]};
  return {rows:[]};
 },
 readEvidence:async()=>null
});
assert.deepEqual(stored.statistics,{shots:{home:2,away:3}});
assert.equal(stored.statistics_review.consensus.shots.home,99);
assert.equal(await getResult(701,{
 execute:async()=>({rows:[{source:'RECOVERY',home_score:4,away_score:0}]})
}),null,'secondary recovered score cannot enter settlement');

// Player markets are blocked even if the display title was normalized and
// the original native title/parameter still identifies the player quote.
assert.equal(isPlayerOfferMarket({market_name:'Total Goals',native_parameters:{pl:'player-7'}}),true);
assert.equal(isPlayerOfferMarket({market_name:'Total Goals',accepted_contract:{
 nativeParameters:{pl:'player-7'}
}}),true);
assert.equal(isPlayerOfferMarket({market_name:'Total Goals',native_market_name:'Anytime Goalscorer'}),true);
for(const market of [
 'Player Shots On Target','Anytime Goalscorer','First Goal Scorer',
 'Goalkeeper Saves','Total Fouls','Total Cards','Total Tackles','Throw-ins',
 'Asian Handicap'
])assert.equal(isRetiredPlayerOfferMarket({market_name:market}),true,market);
for(const market of ['Home team to score','Away team to win','Manchester United to win',
 'Total Goals','Full Time Result','Total Corners'])
 assert.equal(isRetiredPlayerOfferMarket({market_name:market}),false,market+' must not be misclassified');


// The admin market catalog must not reintroduce markets removed from the board.
setCatalogRows([
 {key:'player-market',name:'Anytime Goalscorer',enabled:true},
 {key:'cards-market',name:'Total Cards',enabled:true},
 {key:'handicap-market',name:'Asian Handicap',enabled:true},
 {key:'early-payout-market',name:'Early Payout',enabled:true},
 {key:'goals-market',name:'Total Goals',enabled:true}
]);
assert.deepEqual(catalogRows().map(row=>row.key),['goals-market']);
assert.equal(marketIsEnabled({market_name:'Early Payout'}),false,
 'excluded promotions cannot pass a catalog-only market check');
assert.equal(marketIsEnabled({market_name:'Asian Handicap'}),false,
 'excluded handicap offers cannot pass a catalog-only market check');
for(const category of ['players','cards','fouls'])
 assert.equal(MARKET_CATEGORY_IDS.includes(category),false,category+' category must not be offered');

// DB odds mode must retain the same native identity as memory mode. Otherwise
// placement silently stops recognizing a verified Zizobet quote.
const shaped=toDbOddsShape([{
 matchId:123,marketKey:'zz18639@eyJwMyI6IjE6MCJ9',marketName:'Correct score rest of match',
 line:'',outcomeKey:'z9',outcomeName:'1:0',price:2.5,suspended:false,
 providerId:'ZIZOBET',nativeMarketId:'18639',nativeOutcomeId:'9',
 nativeMarketName:'Correct score [{score}]',nativeOutcomeName:'1:0',
 nativeParameters:{p3:'1:0'},nativeQuote:{mid:18639,p3:'1:0',v:2.5}
}])[0];
assert.equal(shaped.provider_id,'ZIZOBET');
assert.equal(shaped.native_market_id,'18639');
assert.equal(shaped.native_outcome_id,'9');
assert.equal(shaped.native_market_name,'Correct score [{score}]');
assert.deepEqual(shaped.native_parameters,{p3:'1:0'});
assert.deepEqual(shaped.native_quote,{mid:18639,p3:'1:0',v:2.5});
for(const column of ['provider_id','native_market_id','native_outcome_id',
 'native_market_name','native_outcome_name','native_parameters','native_quote'])
 assert.match(SCHEMA_SQL,new RegExp('add column if not exists '+column));
const oldDbPlayerRow=buildMarkets([{
 match_id:123,market_key:'zz500@e30',market_name:'Total Goals',
 native_market_name:'Anytime Goalscorer',native_parameters:{pl:'player-42'},
 line:'',outcome_key:'yes',outcome_name:'Yes',price:2,suspended:false
}]);
assert.equal(oldDbPlayerRow.length,0,'legacy DB player quotes are hidden by native metadata');

console.log('PASS Zizobet-only settlement, 50+ halftime protection, and excluded-market policy');
