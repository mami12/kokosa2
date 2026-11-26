import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {marketIsEnabled,nativeMarketPolicyKeys} from '../server/market-catalog.mjs';
import {refreshMarketCatalog,seedNativeMarketCatalog,assertMarketEnabled} from '../server/ledger/market-catalog-store.mjs';
import {persistProviderMarketDefinitions} from '../server/ledger/provider-offer-archive.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {hasFinalSettlementRule} from '../server/ledger/market-settlement-preflight.mjs';
import {gradeLine} from '../server/ledger/settler.mjs';
import {oddsOf,dedupeMarketRows,infoOf} from '../server/zizobet/normalize.mjs';

assert.match(LEDGER_SQL,/create table if not exists app_supplemental_match_incident/i,
 'Supplemental incidents must be created on ledger boot even with STATS_PROVIDERS_ENABLED=false');
assert.match(LEDGER_SQL,/create table if not exists app_supplemental_match_snapshot/i);

const db=new PGlite(),database={query:(...args)=>db.query(...args)};
// Two native IDs remain separate even when their display labels and lines match.
const sameLabelDifferentIds=dedupeMarketRows([
 {marketKey:'zz910@e30',marketName:'Total Goals',line:'2.5',period:0,outcomeName:'Over',outcomeKey:'z1'},
 {marketKey:'zz911@e30',marketName:'Total Goals',line:'2.5',period:0,outcomeName:'Over',outcomeKey:'z1'}
]);
assert.equal(sameLabelDifferentIds.length,2,
 'different native market IDs must never be collapsed by display-name deduplication');
const separateCorrectScores=dedupeMarketRows([
 {marketKey:'zz912@e30',marketName:'Correct score',line:'',period:0,outcomeName:'1:0',outcomeKey:'z1'},
 {marketKey:'zz913@e30',marketName:'Correct score',line:'',period:0,outcomeName:'1:0',outcomeKey:'z1'}
]);
assert.equal(separateCorrectScores.length,2,
 'correct-score grids from different native IDs must remain separate contracts');

const nativeGrid=(id,over=1.91,under=1.91)=>[
 {matchId:72,marketKey:`zz${id}@e30`,line:'2.5',period:0,marketName:'Total Goals',
  nativeMarketId:String(id),nativeMarketName:'Total Goals',nativeParameters:{p1:25},
  nativeOutcomeId:`${id}-over`,nativeOutcomeName:'Over',outcomeName:'Over',outcomeKey:'z-over',price:over,suspended:false},
 {matchId:72,marketKey:`zz${id}@e30`,line:'2.5',period:0,marketName:'Total Goals',
  nativeMarketId:String(id),nativeMarketName:'Total Goals',nativeParameters:{p1:25},
  nativeOutcomeId:`${id}-under`,nativeOutcomeName:'Under',outcomeName:'Under',outcomeKey:'z-under',price:under,suspended:false}
];
assert.equal(dedupeMarketRows([...nativeGrid(920),...nativeGrid(921)]).length,2,
 'fully identical native offers are collapsed even when the provider repeats them under another ID');
assert.equal(dedupeMarketRows([...nativeGrid(920),...nativeGrid(921,1.89,1.93)]).length,4,
 'same-looking offers with different prices remain distinct');

const competitorMeta={positions:new Map(),liveMarkets:new Map(),preMarkets:new Map([
 [930,{Name:'{$competitor1} to win',pos:[{id:1,nm:'{$competitor2}'}]}],
 [931,{Name:'{$competitor1} no bet',pos:[{id:1,nm:'Draw'}]}]
])};
const competitorOffers=oddsOf({match_id:73,home:'Arsenal',away:'Chelsea'},[
 {mid:930,id:9301,pos:1,coef:1.95},
 {mid:931,id:9311,pos:1,coef:2.05}
],competitorMeta,false,true);
assert.equal(competitorOffers.find(row=>row.nativeMarketId==='930')?.marketName,'Arsenal to win');
assert.equal(competitorOffers.find(row=>row.nativeMarketId==='930')?.outcomeName,'Chelsea');
assert.equal(competitorOffers.find(row=>row.nativeMarketId==='931')?.marketName,'Arsenal no bet');
// Native decimal totals use the quoted threshold directly; integer lines still push at equality.
for(const line of ['0.25','0.75','1.25','1.75']){
 const offer={provider_id:'ZIZOBET',market_name:'Total Goals',outcome_name:'Over',
  outcome_key:'Over',line};
 assert.equal(hasFinalSettlementRule(offer),true,
  'quoted decimal total '+line+' must have an exact Over/Under settlement rule');
}
assert.equal(hasFinalSettlementRule({provider_id:'ZIZOBET',market_name:'Total Goals',
 outcome_name:'Over',outcome_key:'Over',line:'2.5'}),true,
 'ordinary half-goal totals retain their existing settlement rule');

const fiveGoals={home_score:3,away_score:2,half_home_score:1,half_away_score:1,
 corners_home:4,corners_away:3,cards_home:1,cards_away:0};
assert.equal(gradeLine({market_name:'Total Goals',outcome_name:'Over',outcome_key:'Over',line:'4.75'},fiveGoals),'WON');
assert.equal(gradeLine({market_name:'Total Goals',outcome_name:'Under',outcome_key:'Under',line:'5.75'},fiveGoals),'WON');
assert.equal(gradeLine({market_name:'Home Team Total Corners',outcome_name:'Over',outcome_key:'Over',line:'3.75'},
 {...fiveGoals,corners_home:4,corners_away:3}),'WON');

assert.equal(hasFinalSettlementRule({provider_id:'ZIZOBET',market_name:'Total Goals 1.25',
 outcome_name:'Over',outcome_key:'Over',line:''}),true,
 'quarter thresholds embedded in provider market titles must also be graded');
for(const market of ['Total Corners','Home Team Total Corners']){
 assert.equal(hasFinalSettlementRule({provider_id:'ZIZOBET',market_name:market,
  outcome_name:'Over',outcome_key:'Over',line:'1.75'}),true,
  market+' decimal total must use its exact quoted threshold');
}
try{
 await db.exec(LEDGER_SQL);
 await refreshMarketCatalog({initialize:true,database});
 const archived=await persistProviderMarketDefinitions([
  {provider:'ZIZOBET',sportId:1,scope:'LIVE',id:800,name:'Total Corners',definition:{ID:800,Name:'Total Corners'}},
  {provider:'ZIZOBET',sportId:1,scope:'PREMATCH',id:448,name:'Match result',definition:{ID:448,Name:'Match result'}},
  {provider:'ZIZOBET',sportId:1,scope:'PREMATCH',id:800,name:'Total Corners',definition:{ID:800,Name:'Total Corners'}},
  {provider:'ZIZOBET',sportId:1,scope:'LIVE',id:27073,name:'1X2 (XUP)',definition:{ID:27073,Name:'1X2 (XUP)'}},
  // Generic labels are not enough to identify a sport. These must be rejected
  // because the global LIVE dictionary did not establish football provenance.
  {provider:'ZIZOBET',sportId:2,scope:'LIVE',id:991,name:'Winner',definition:{ID:991,Name:'Winner'}},
  {provider:'ZIZOBET',sportId:3,scope:'LIVE',id:992,name:'Set Winner',definition:{ID:992,Name:'Set Winner'}},
  {provider:'ZIZOBET',scope:'LIVE',id:993,name:'Total Points',definition:{ID:993,Name:'Total Points'}}
 ],{execute:(...args)=>database.query(...args)});
 assert.equal(archived.seen,4,'only explicit Zizobet football (sport 1) definitions are persisted');
 // Simulate rows written by the old unscoped global dictionary.
 await db.query(`insert into app_provider_market_definition
  (provider_id,sport_id,scope,native_market_id,native_market_name,definition)
  values ('ZIZOBET',null,'LIVE','999','Set Winner','{}'::jsonb),
         ('ZIZOBET',2,'LIVE','991','Winner','{}'::jsonb),
         ('ZIZOBET',3,'LIVE','992','Total Points','{}'::jsonb)`);
 await db.query(`insert into app_market_catalog(key,name) values
  ('zizobet:live:999','[LIVE] Set Winner'),('set winner','Set Winner'),
  ('total points','Total Points'),('winner','Winner')`);
 const list=await seedNativeMarketCatalog({database});
 const keys=['zizobet:live:800','zizobet:prematch:448','zizobet:prematch:800'];
 for(const key of keys)assert.ok(list.find(row=>row.key===key),'Dictionary market missing: '+key);
 assert.equal(list.some(row=>row.key==='zizobet:live:27073'),false,
  'the native early-payout ID must not re-enter the admin market catalog');
 assert.equal(list.some(row=>row.key==='zizobet:live:991'||row.key==='zizobet:live:992'),false,
  'live market IDs from other sports cannot enter the admin catalogue');
 assert.equal(list.some(row=>/set winner|total points/i.test(row.name)),false,
  'stale non-football rows from the old global dictionary are removed');
 const unscoped=(await db.query(`select native_market_id from app_provider_market_definition
   where provider_id='ZIZOBET' and scope='LIVE' and sport_id is null`)).rows;
 assert.equal(unscoped.length,0,'legacy unscoped live definitions are removed');
 const quoted={market_key:'zz800@e30',market_name:'Total Corners'};
 const live={service:'LIVE'},prematch={service:'PREMATCH'};
 assert.deepEqual(nativeMarketPolicyKeys(quoted,live),['zizobet:live:800']);
 assert.deepEqual(nativeMarketPolicyKeys(quoted,prematch),['zizobet:prematch:800']);
 await db.query("update app_market_catalog set enabled=false where key='zizobet:live:800'");
 await refreshMarketCatalog({database});
 assert.equal(marketIsEnabled(quoted,live),false,'Live native ID admin switch blocks this quote');
 assert.equal(marketIsEnabled(quoted,prematch),true,'Live switch does not block prematch scope');
 await assert.rejects(assertMarketEnabled(quoted,(...args)=>db.query(...args),live),
  error=>error?.code==='MARKET_NOT_OFFERED');
 await assertMarketEnabled(quoted,(...args)=>db.query(...args),prematch);
 await assert.rejects(assertMarketEnabled({market_name:'Early Payout'},async()=>{
  throw Error('excluded markets must be rejected before any policy query');
 }),error=>error?.code==='MARKET_NOT_OFFERED');
 await db.query("update app_market_catalog set enabled=false where key='zizobet:prematch:800'");
 await refreshMarketCatalog({database});
 assert.equal(marketIsEnabled(quoted,prematch),false,'Prematch native ID block applies');

const totalDefinition={Name:'Total Goals',IsOverUnder:true,N:1,
 pos:[{id:1,nm:'Over'},{id:2,nm:'Under'}]};
const totalMeta={positions:new Map(),liveMarkets:new Map(),
 preMarkets:new Map([[901,totalDefinition]])};
const quarterTotals=oddsOf({match_id:55},[
 {mid:901,id:1,pos:1,h:0.25,coef:1.91},
 {mid:901,id:2,pos:2,h:0.25,coef:1.91},
 {mid:901,id:3,pos:1,h:0.75,coef:2.1},
 {mid:901,id:4,pos:2,h:0.75,coef:1.72}
],totalMeta,false,true);
assert.deepEqual(quarterTotals.map(row=>row.line),['0.25','0.25','0.75','0.75'],
 'valid native quarter goal-total lines must not be discarded by a generic IsOverUnder filter');
const flagMeta={positions:new Map(),liveMarkets:new Map(),preMarkets:new Map(
 [920,921,922,923].map(id=>[id,totalDefinition]))};
const flagRows=oddsOf({match_id:57},[
 {mid:920,id:1,pos:1,coef:1.95,visible:1,lock:0,res:'0'},
 {mid:921,id:2,pos:1,coef:1.95,visible:0,lock:0,res:'0'},
 {mid:922,id:3,pos:1,coef:1.95,visible:1,lock:1,res:'0'},
 {mid:923,id:4,pos:1,coef:1.95,visible:1,lock:0,res:'1'}
],flagMeta,false,true);
assert.equal(flagRows.find(row=>row.nativeMarketId==='920')?.suspended,false,
 'numeric visible/lock and string zero result flags must preserve an open quote');
const infoMeta={statuses:new Map(),teams:new Map(),regions:new Map(),champs:new Map()};
assert.equal(infoOf({service:'LIVE'},{LiveBetStatus:1,EventStatus:10,Score:'0:0'},infoMeta).hasOpenOdds,true,
 'numeric live open flag must be treated as open');
assert.equal(infoOf({service:'LIVE'},{LiveBetStatus:'0',EventStatus:10,Score:'0:0'},infoMeta).hasOpenOdds,false,
 'string zero live open flag must be treated as closed');
assert.equal(infoOf({service:'PREMATCH'},{s:0},infoMeta).hasOpenOdds,true,
 'numeric prematch zero suspension bit must be treated as open');
assert.equal(infoOf({service:'PREMATCH'},{s:'1'},infoMeta).hasOpenOdds,false,
 'string prematch one suspension bit must be treated as closed');
assert.equal(infoOf({service:'PREMATCH'},{s:true},infoMeta).hasOpenOdds,true,
 'boolean prematch open flags retain their legacy meaning');
assert.equal(infoOf({service:'PREMATCH'},{s:false},infoMeta).hasOpenOdds,false,
 'boolean prematch closed flags retain their legacy meaning');
for(const id of ['921','922','923'])assert.equal(
 flagRows.find(row=>row.nativeMarketId===id)?.suspended,true,
 'numeric hidden/locked/resolved quote flags must suspend native market '+id);

const incompleteDictionaryQuote=oddsOf({match_id:56},[
 {mid:902,id:5,pos:99,pn:'Over',coef:1.95}
],{positions:new Map(),liveMarkets:new Map(),
 preMarkets:new Map([[902,{Name:'Total [total]',IsOverUnder:true}]])},false,true);
assert.equal(incompleteDictionaryQuote.length,1,
 'a quoted offer with a missing dictionary position must use its own native label');
assert.equal(incompleteDictionaryQuote[0].marketName,'Total [total]',
 'an unresolved native template remains visible under its exact provider title');
assert.equal(incompleteDictionaryQuote[0].outcomeName,'Over');

// A native LIVE quote can carry its own market/outcome labels even when the
// shared market dictionary omitted that ID. It must survive normalization.
const missingLiveDefinitionReport={};
const missingLiveDefinition=oddsOf({match_id:561},[
 {marketId:906,id:44,positionName:'Over',marketName:'Total Goals',price:1.88}
],{positions:new Map(),liveMarkets:new Map(),preMarkets:new Map()},true,true,missingLiveDefinitionReport);
assert.equal(missingLiveDefinition.length,1,
 'a quote with native market and outcome labels must survive a missing LIVE dictionary entry');
assert.equal(missingLiveDefinition[0].nativeMarketId,'906');
assert.equal(missingLiveDefinition[0].nativeOutcomeId,'44');
assert.equal(missingLiveDefinition[0].marketName,'Total Goals');
assert.equal(missingLiveDefinition[0].outcomeName,'Over');
assert.equal(missingLiveDefinition[0].price,1.88,
 'native quote price fallback must preserve the provider price');
assert.equal(missingLiveDefinitionReport.rawQuotes,1);
assert.equal(missingLiveDefinitionReport.normalizedRows,1);
assert.equal(missingLiveDefinitionReport.missingMarketDefinition,undefined);

// Explicit exclusions still win even when a quote supplies its own title and
// no dictionary entry exists.
const missingDefinitionExcluded=oddsOf({match_id:562},[
 {mid:907,id:45,pn:'Over',marketName:'Total Cards',v:1.9}
],{positions:new Map(),liveMarkets:new Map(),preMarkets:new Map()},true,true,{});
assert.equal(missingDefinitionExcluded.length,0,
 'missing dictionary metadata must not bypass the operator card exclusion');
const nmDictionaryQuote=oddsOf({match_id:58},[
 {mid:903,id:6,pos:1,pn:'Over',coef:1.95}
],{positions:new Map(),liveMarkets:new Map(),
 preMarkets:new Map([[903,{nm:'Total Goals',pos:[{id:1,nm:'Over'}]}]])},false,true);
assert.equal(nmDictionaryQuote.length,1,
 'native market definitions using the provider nm field must not be dropped');
assert.equal(nmDictionaryQuote[0].marketName,'Total Goals');
const p4Quote=oddsOf({match_id:59},[
 {mid:904,id:7,pos:1,p4:42,coef:1.95}
],{positions:new Map(),liveMarkets:new Map(),
 preMarkets:new Map([[904,{Name:'Total Goals [p4]',pos:[{id:1,nm:'Over'}]}]])},false,true)[0];
assert.equal(p4Quote.marketName,'Total Goals 42');
assert.equal(p4Quote.nativeParameters.p4,42,
 'numbered native parameters beyond p1-p3 must be preserved');
assert.equal(p4Quote.nativeQuote.p4,42,
 'the complete native quote snapshot must retain p4');
const quoteOnlyNative=oddsOf({match_id:61},[
 {market_id:906,outcome_id:10,market_name:'Total Corners',position_name:'Over',
  total:8.5,odds:1.91,visible:1,lock:0,res:'0',p4:77}
],{positions:new Map(),liveMarkets:new Map(),preMarkets:new Map()},false,true);
assert.equal(quoteOnlyNative.length,1,
 'a football quote with its own native market/outcome labels survives a missing dictionary entry');
assert.equal(quoteOnlyNative[0].nativeMarketId,'906');
assert.equal(quoteOnlyNative[0].nativeOutcomeId,'10');
assert.equal(quoteOnlyNative[0].marketName,'Total Corners');
assert.equal(quoteOnlyNative[0].outcomeName,'Over');
assert.equal(quoteOnlyNative[0].line,'8.5');
assert.equal(quoteOnlyNative[0].price,1.91);
assert.equal(quoteOnlyNative[0].nativeQuote.p4,77,
 'all provider quote fields remain available for downstream audit and settlement');
const nestedQuoteOnly=oddsOf({match_id:62},[
 {marketId:907,selectionId:11,market:{nm:'Both Teams To Score'},
  position:{nm:'Yes'},price:2.05}
],{positions:new Map(),liveMarkets:new Map(),preMarkets:new Map()},false,true);
assert.equal(nestedQuoteOnly.length,1,
 'nested native quote title and outcome metadata are accepted without the dictionary');
assert.equal(nestedQuoteOnly[0].marketName,'Both Teams To Score');
assert.equal(nestedQuoteOnly[0].outcomeName,'Yes');
assert.equal(nestedQuoteOnly[0].price,2.05);
const missingNativeLabels=oddsOf({match_id:63},[
 {mid:908,id:12,pos:1,coef:1.9}
],{positions:new Map(),liveMarkets:new Map(),preMarkets:new Map()},false,true);
assert.equal(missingNativeLabels.length,0,
 'quotes without any market title or outcome label are not guessed');
const excludedNativeRows=oddsOf({match_id:60},[
 {mid:27073,id:8,pos:1,coef:1.9},
 {mid:905,id:9,pos:1,coef:1.9}
],{positions:new Map(),liveMarkets:new Map(),preMarkets:new Map([
 [27073,{Name:'Special Offer',pos:[{id:1,nm:'Yes'}]}],
 [905,{Name:'Early Payout',pos:[{id:1,nm:'Yes'}]}]
])},false,true);
assert.equal(excludedNativeRows.length,0,
 'early-payout offers must be excluded by both native ID and title at ingestion');
}finally{await db.close();}
console.log('PASS complete native market catalog, LIVE/PREMATCH scoping, wager preflight and optional table migration');
