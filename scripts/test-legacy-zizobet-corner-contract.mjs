import assert from 'node:assert/strict';
import {recoverLegacyZizobetCornerContract} from '../server/ledger/legacy-zizobet-corner-contract.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const legacy=(nativeMarketName,nativeOutcomeName,providerPeriod=0,line='')=>({
 id:'00000000-0000-4000-8000-000000000099',
 match_id:99,
 market_key:'zz901@e30',
 market_name:'Përkthim i vjetër i marketit',
 outcome_key:nativeOutcomeName,
 outcome_name:nativeOutcomeName,
 line,
 period:providerPeriod,
 accepted_contract:{
  sourceProviderId:'ZIZOBET',
  providerMarketKey:'zz901@e30',
  providerMarketName:'Display title that must not decide settlement',
  providerOutcomeKey:nativeOutcomeName,
  providerOutcomeName:nativeOutcomeName,
  nativeMarketName,
  nativeOutcomeName,
  nativeMarketId:901,
  nativeParameters:{},
  providerPeriod,
  line
 }
});

const most=legacy('Most corners','1');
assert.deepEqual(
 {kind:recoverLegacyZizobetCornerContract(most)?.kind,
  mode:recoverLegacyZizobetCornerContract(most)?.mode,
  side:recoverLegacyZizobetCornerContract(most)?.side},
 {kind:'corner-comparison',mode:'full-result',side:'home'},
 'Old full-match Most Corners tickets recover only from the accepted Zizobet quote');

const highest=legacy('Highest scoring half in corners','2');
assert.deepEqual(
 {kind:recoverLegacyZizobetCornerContract(highest)?.kind,
  mode:recoverLegacyZizobetCornerContract(highest)?.mode,
  choice:recoverLegacyZizobetCornerContract(highest)?.choice},
 {kind:'corner-comparison',mode:'most-half',choice:2});

const home=legacy('Hometeam total corners (8.5)','Over',0,'8.5');
assert.deepEqual(
 {kind:recoverLegacyZizobetCornerContract(home)?.kind,
  event:recoverLegacyZizobetCornerContract(home)?.event,
  side:recoverLegacyZizobetCornerContract(home)?.side,
  threshold:recoverLegacyZizobetCornerContract(home)?.threshold},
 {kind:'over',event:'corner',side:'home',threshold:8.5});

const away=legacy('Awayteam total corners (5.5)','Under',0,'5.5');
assert.deepEqual(
 {kind:recoverLegacyZizobetCornerContract(away)?.kind,
  event:recoverLegacyZizobetCornerContract(away)?.event,
  side:recoverLegacyZizobetCornerContract(away)?.side,
  threshold:recoverLegacyZizobetCornerContract(away)?.threshold},
 {kind:'under',event:'corner',side:'away',threshold:5.5});

const awayHalf=legacy('2nd half - Awayteam total corners (1.5)','Over',2,'1.5');
assert.deepEqual(
 {kind:recoverLegacyZizobetCornerContract(awayHalf)?.kind,
  event:recoverLegacyZizobetCornerContract(awayHalf)?.event,
  half:recoverLegacyZizobetCornerContract(awayHalf)?.half,
  side:recoverLegacyZizobetCornerContract(awayHalf)?.side},
 {kind:'half-total',event:'corner',half:2,side:'away'});

assert.equal(recoverLegacyZizobetCornerContract({
 ...most,accepted_contract:{...most.accepted_contract,sourceProviderId:'AAMS'}
}),null,'AAMS is never recovered');
assert.equal(recoverLegacyZizobetCornerContract({
 ...most,accepted_contract:{...most.accepted_contract,nativeMarketName:'Correct score AAMS-logic'}
}),null,'AAMS-logic is outside this corner recovery path');
assert.equal(recoverLegacyZizobetCornerContract({
 ...most,accepted_contract:{...most.accepted_contract,settlementHold:'NATIVE_RULE_REVIEW'}
}),null,'An explicit native review hold cannot be bypassed');
assert.equal(recoverLegacyZizobetCornerContract({
 ...most,accepted_contract:{...most.accepted_contract,nativeMarketName:null}
}),null,'Missing native title stays pending');
assert.equal(recoverLegacyZizobetCornerContract({
 ...most,accepted_contract:null
}),null,'No accepted quote means no recovery');
assert.equal(recoverLegacyZizobetCornerContract({
 ...most,accepted_contract:JSON.stringify(most.accepted_contract)
 })?.kind,'corner-comparison','Stored JSON text is read conservatively');

const acceptedEvents=[
 {team:'away',minute:3,phase:'H1'},
 {team:'home',minute:10,phase:'H1'},
 {team:'home',minute:21,phase:'H1'},
 {team:'home',minute:32,phase:'H1'},
 {team:'home',minute:41,phase:'H1'},
 // Second-half Zizobet incidents without a phase are unambiguously minute 46-90.
 {team:'away',minute:53,phase:null},
 {team:'home',minute:58,phase:null},
 {team:'home',minute:67,phase:null},
 {team:'home',minute:71,phase:null},
 {team:'home',minute:73,phase:null},
 {team:'away',minute:74,phase:null},
 {team:'home',minute:78,phase:null},
 {team:'home',minute:86,phase:null}
];
const result={home_score:1,away_score:0,corners_home:10,corners_away:3,
 cards_home:1,cards_away:0};
const execute=async(sql,args)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:10,away:3,total:13,count_home:10,count_away:3,
  normal_home:10,normal_away:3,
  through_minute:90,complete:true,open_recovery_gap:false,
  observed_at:'2026-11-18T22:00:00Z',confirmed_at:'2026-11-18T22:00:00Z',
  second_poll_at:'2026-11-18T22:00:00Z',phase_ambiguous:false
 }]};
 if(sql.includes('select minute,seconds,team,phase'))return {rows:acceptedEvents};
 throw Error('Unexpected SQL '+sql.slice(0,120));
};
for(const [source,expected] of [
 [most,'WON'],
 [highest,'WON'],
 [home,'WON'],
 [away,'WON'],
 [awayHalf,'WON']
]){
 const contract=recoverLegacyZizobetCornerContract(source);
 assert.equal(await gradeStoredEventContract({...source,live_contract:contract},result,{execute}),expected,
  'Legacy native corner ticket must grade from the complete accepted provider chronology: '+source.accepted_contract.nativeMarketName);
}
console.log('PASS legacy Zizobet Most Corners, highest-scoring half and team/half corner recovery');
