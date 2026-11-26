import assert from 'node:assert/strict';
import {oddsOf} from '../server/zizobet/normalize.mjs';

const emptyMeta=()=>({positions:new Map(),liveMarkets:new Map(),preMarkets:new Map()});
const quoteOnly=oddsOf({match_id:61},[
 {market_id:906,outcome_id:10,market_name:'Total Corners',position_name:'Over',
  total:8.5,odds:1.91,visible:1,lock:0,res:'0',p4:77}
],emptyMeta(),false,true);
assert.equal(quoteOnly.length,1,'native quote labels must recover a missing dictionary entry');
assert.equal(quoteOnly[0].nativeMarketId,'906');
assert.equal(quoteOnly[0].nativeOutcomeId,'10');
assert.equal(quoteOnly[0].marketName,'Total Corners');
assert.equal(quoteOnly[0].outcomeName,'Over');
assert.equal(quoteOnly[0].line,'8.5');
assert.equal(quoteOnly[0].price,1.91);
assert.equal(quoteOnly[0].nativeQuote.p4,77,'raw provider parameters must be retained');

const nested=oddsOf({match_id:62},[
 {marketId:907,selectionId:11,market:{nm:'Both Teams To Score'},
  position:{nm:'Yes'},price:2.05}
],emptyMeta(),false,true);
assert.equal(nested.length,1,'nested native labels must recover missing dictionary metadata');
assert.equal(nested[0].marketName,'Both Teams To Score');
assert.equal(nested[0].outcomeName,'Yes');
assert.equal(nested[0].price,2.05);

const labelledPosition=oddsOf({match_id:63},[
 {mid:908,id:12,pos:99,pn:'Under',coef:1.87}
],{...emptyMeta(),preMarkets:new Map([[908,{Name:'Total Goals'}]])},false,true);
assert.equal(labelledPosition.length,1,'quote-native outcome labels must recover missing position definitions');
assert.equal(labelledPosition[0].outcomeName,'Under');

const liveQuote=oddsOf({match_id:66},[
 {mid:911,id:15,market_title:'Total Corners',outcome_name:'Under',v:1.93,h:7.5}
],emptyMeta(),true,true);
assert.equal(liveQuote.length,1,'LIVE quotes must use native labels when their dictionary entry is missing');
assert.equal(liveQuote[0].marketName,'Total Corners');
assert.equal(liveQuote[0].outcomeName,'Under');
assert.equal(liveQuote[0].price,1.93);
assert.equal(liveQuote[0].line,'7.5');

const unlabelled=oddsOf({match_id:64},[
 {mid:909,id:13,pos:1,coef:1.9}
],emptyMeta(),false,true);
assert.equal(unlabelled.length,0,'unknown market/outcome labels must not be guessed');

const excluded=oddsOf({match_id:65},[
 {market_id:910,outcome_id:14,market_name:'Total Shots',position_name:'Over',odds:1.9}
],emptyMeta(),false,true);
assert.equal(excluded.length,0,'explicitly excluded shot markets must remain hidden');

console.log('PASS Zizobet quote-native metadata fallback, ID/price/line aliases, raw quote retention and exclusions');
