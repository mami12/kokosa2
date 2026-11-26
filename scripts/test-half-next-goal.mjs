import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parseHalfEventContract,liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeHalfEventFacts,SUPPORTED_FACT_KINDS} from '../server/ledger/match-event-facts.mjs';

const counts={goal:{home:2,away:0}};
const market=outcome_name=>({market_name:'Halftime - Next goal',outcome_name});
const away=parseHalfEventContract(market('2'),counts);
assert.equal(liveContract(market('2'),{counts})?.kind,'half-next-event',
 'the production live-contract dispatcher must recognize the halftime next-goal market');
assert.equal(SUPPORTED_FACT_KINDS.has('half-next-event'),true,
 'the primary settlement worker must accept the frozen half-next-event contract');
assert.deepEqual(
 [away.kind,away.event,away.half,away.side,away.target,away.baseline.home,away.baseline.away],
 ['half-next-event','goal',1,'away',3,2,0]
);
const facts=[
 {minute:11,seconds:672,team:'home',phase:'1st half'},
 {minute:14,seconds:852,team:'home',phase:'1st half'},
 {minute:37,seconds:2232,team:'away',phase:'1st half'},
 {minute:83,seconds:4980,team:'away',phase:'2nd half'}
];
assert.equal(gradeHalfEventFacts(away,facts,{complete:true}),'WON',
 'goal #3 at 37 is the next 1H goal after accepted 2-0');
assert.equal(gradeHalfEventFacts({...away,side:'home'},facts,{complete:true}),'LOST',
 'the next 1H goal was scored by the away team');
const none=parseHalfEventContract(market('No goal'),counts);
assert.equal(none.noneOffered,true);
assert.equal(gradeHalfEventFacts(none,facts.slice(0,2),{complete:true}),'WON',
 'a quoted no-goal outcome wins when no later first-half goal occurred');
assert.equal(parseHalfEventContract(market('2')),null,
 'an absent accepted live score must not be guessed as 0-0');
console.log('PASS Halftime - Next goal uses purchase-time first-half score and confirmed period chronology');
