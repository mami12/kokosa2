import assert from 'node:assert/strict';
import {isCurrentSettlementCheckQuote} from '../server/ledger/settlement-check.mjs';
import {isDecidedLiveNumberedGoalWindow} from '../server/ledger/decided-markets.mjs';
import {isSettlementCheckFixture} from '../server/fixture-dates.mjs';

const now=1000;
const dateNow=new Date('2026-11-25T12:00:00+01:00');
assert.equal(isSettlementCheckFixture({start_at:'2026-11-25T22:00:00+01:00',service:'PREMATCH'},dateNow),true,
 'Tirane calendar date permits fixtures scheduled later today');
assert.equal(isSettlementCheckFixture({start_at:'2026-11-26T10:00:00+01:00',service:'PREMATCH'},dateNow),false,
 'tomorrow prematch fixture is excluded');
assert.equal(isSettlementCheckFixture({start_at:'2026-12-25T10:00:00+01:00',service:'PREMATCH'},dateNow),false,
 'next month prematch fixture is excluded');
assert.equal(isSettlementCheckFixture({start_at:'2026-11-24T22:00:00+01:00',service:'LIVE',status:'LIVE'},dateNow),true,
 'a match still live remains selectable even if it started yesterday');
const market={id:'m1',status:'ACTIVE',suspended:false};
const fresh={id:'o1',status:'ACTIVE',odds:2.25,priceValidUntil:2000};
assert.equal(isCurrentSettlementCheckQuote(market,fresh,now),true,
 'an active quote with a future provider freshness deadline is selectable');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,priceValidUntil:now},now),false,
 'a quote expiring at this instant is stale');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,priceValidUntil:999},now),false,
 'an expired quote is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,priceValidUntil:null},now),false,
 'a quote without a freshness deadline is excluded');
assert.equal(isCurrentSettlementCheckQuote({...market,status:'SUSPENDED'},fresh,now),false,
 'a suspended market is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,status:'SUSPENDED'},now),false,
 'a suspended outcome is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,quoteSuspended:true},now),false,
 'a quote explicitly marked stale is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,decided:true},now),false,
 'a provider-decided outcome is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,odds:1},now),false,
 'an invalid price is excluded');

const ordinalWindow={name:'Who scores goal 1 in minutes 46-60 (15-minute interval)',period:0};
const liveMatch=overrides=>({
 service:'LIVE',status:'LIVE',score_at:'2026-11-21T15:43:00.000Z',
 home_score:0,away_score:0,currentMinute:43,...overrides,
});
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:2}),ordinalWindow),true,
 'Goal 1 already occurred at 2-0 before minute 43, so every outcome in its 46-60 market is decided');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:1}),ordinalWindow),true,
 'the first match goal decides the full Goal 1 interval even before its window starts');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch(),ordinalWindow),false,
 'at 0-0 and minute 43, the future 46-60 interval is still open');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({currentMinute:46}),ordinalWindow),false,
 'at 0-0, the interval must not be decided at its opening minute');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({currentMinute:60}),ordinalWindow),false,
 'the interval remains open through minute 60');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({currentMinute:61}),ordinalWindow),true,
 'a no-goal result becomes decided only after minute 60 has elapsed');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:1}),{
 name:'Who scores goal 2 in minutes 46-60 (15-minute interval)',period:0,
}),false,'Goal 1 does not decide a market about Goal 2');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:2}),{
 name:'Who scores goal 2 in minutes 46-60 (15-minute interval)',period:0,
}),true,'Goal 2 already exists, so its interval market is fully decided');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:2,score_at:null}),ordinalWindow),false,
 'an unconfirmed placeholder score must not decide a live market');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({currentMinute:61,phase:'2H'}),{
 name:'Who scores goal 1 in minutes 41-45 (5-minute interval)',period:0,
}),true,'a completed first-half interval is excluded after the half has ended');

console.log('PASS settlement-check bulk quote freshness and active-status filters');
