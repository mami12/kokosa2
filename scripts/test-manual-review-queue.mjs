import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {reviewReason,manualReviewQueue} from '../server/ledger/manual-review-queue.mjs';
import {manualSettlement} from '../server/ledger/financial-monitoring.mjs';
import {SETTLEMENT_REVIEW_SQL} from '../server/ledger/settlement-review.mjs';

const now=Date.parse('2026-11-05T20:00:00Z');
const base={line_id:'line-a',ticket_id:'ticket-a',match_id:123,
 market_key:'corner-five',line:'11-15',outcome_key:'Yes',
 market_name:'Corner in minutes 11-15',outcome_name:'Yes',match_name:'Home - Away',
 line_status:'PENDING',ticket_status:'PENDING',result_id:123,
 placed_at:new Date(now-86400000).toISOString(),stake:100,odds_at_placement:2,
 username:'tester',home_score:2,away_score:1,statistics_review:null,
 corners_home:4,corners_away:2,cards_home:1,cards_away:1,result_source:'ZIZOBET',
 final_statistics:{shots:{home:7,away:6},shotsOnTarget:{home:3,away:2},fouls:{home:8,away:9},offsides:{home:1,away:2}},
 placement_snapshot:{isLive:true,scoreHome:1,scoreAway:0,clockMilliseconds:20*60000,
  counters:{goal:{home:1,away:0}},statistics:{home:{shots:3,shotsOnTarget:1},away:{shots:2,shotsOnTarget:0}}},
 feed_status:'FT',match_status:'ended'};
assert.equal(reviewReason(base,now),'MISSING_EVENT_TIMELINE');
assert.equal(reviewReason({...base,market_name:'Total Corners'},now),'MISSING_MARKET_STATISTICS');
assert.equal(reviewReason({...base,market_name:'Total Shots on Target',
 statistics_review:{conflicts:{shotsOnTarget:{a:{home:2,away:3},b:{home:4,away:2}}}}},now),'CONFLICTING_API_STATISTICS');
assert.equal(reviewReason({...base,line_status:'VOID',ticket_status:'VOID'},now),'VOID_NEEDS_CONFIRMATION');
assert.equal(reviewReason({...base,line_status:'VOID',ticket_status:'VOID',
 market_name:'Scoring Type',outcome_name:'Penalty'},now),'MISSING_GOAL_METHOD_EVIDENCE',
 'a Scoring Type VOID stays visible with the precise missing method-evidence reason');
assert.equal(reviewReason({...base,market_name:'Scoring Type',
 accepted_contract:{settlementHold:'NATIVE_FINAL_RULE_UNMAPPED'},
 settlement_reason:'NATIVE_RULE_REVIEW'},now),'MISSING_GOAL_METHOD_EVIDENCE',
 'Scoring Type is identified as missing primary goal-method proof');
assert.equal(reviewReason({...base,market_name:'Native market not mapped',
 accepted_contract:{settlementHold:'NATIVE_FINAL_RULE_UNMAPPED'},
 settlement_reason:'NATIVE_RULE_REVIEW'},now),'NATIVE_CONTRACT_REVIEW');

// A two-way integer total that exactly meets its line is a legitimate push.
// It should not generate a false administrator alert.
const fullTimePush={...base,line_status:'VOID',ticket_status:'VOID',
 market_name:'Total 5',line:'5',outcome_key:'under',outcome_name:'Under',
 home_score:2,away_score:3};
assert.equal(reviewReason(fullTimePush,now),null,'confirmed full-time total push is not a manual-review anomaly');
const halfTimePush={...base,line_status:'VOID',ticket_status:'VOID',
 market_name:'Halftime - Total 3',line:'3',outcome_key:'over',outcome_name:'Over',
 accepted_contract:{providerPeriod:1},home_score:2,away_score:3,
 half_home_score:2,half_away_score:1};
assert.equal(reviewReason(halfTimePush,now),null,'confirmed HT total push is not a manual-review anomaly');
const unknownVoid={...base,line_status:'VOID',ticket_status:'VOID',
 market_name:'Scoring type',line:'',outcome_name:'Penalty'};
assert.equal(reviewReason(unknownVoid,now),'MISSING_GOAL_METHOD_EVIDENCE',
 'Scoring Type VOID keeps its precise missing method-evidence review reason');
assert.equal(reviewReason({...base,result_id:null,match_status:'live',feed_status:'live'},now),null,'active fixtures are not invalid');
assert.equal(reviewReason({...base,result_id:null,match_status:'ended',feed_status:'ended'},now),'MISSING_FINAL_RESULT');
assert.equal(reviewReason({...base,result_id:null,start_at:new Date(now+86400000).toISOString(),match_status:'ended',feed_status:'ended'},now),null,
 'a scheduled future match must not create a missing-final-result review');

const rows=[
 base,
 {...base,line_id:'line-b',ticket_id:'ticket-b',market_name:'Total Corners'},
 {...base,line_id:'line-c',ticket_id:'ticket-c',line_status:'VOID',ticket_status:'VOID'},
 {...base,line_id:'line-d',ticket_id:'ticket-d',result_id:null,feed_status:'live',match_status:'live'},
 {...fullTimePush,line_id:'line-e',ticket_id:'ticket-e'},
 {...halfTimePush,line_id:'line-f',ticket_id:'ticket-f'},
 {...unknownVoid,line_id:'line-g',ticket_id:'ticket-g'},
];
let observedSql='',observedParams,noticeBatchCalls=0;
const notices=new Map();
const runQuery=async(sql,params)=>{
 if(sql.includes('insert into app_manual_review_notice')){
  noticeBatchCalls++;
  for(const id of params[0])if(!notices.has(id))notices.set(id,params[1]);
  return {rows:[]};
 }
 if(sql.includes('select line_id,first_seen_at from app_manual_review_notice')){
  return {rows:params[0].filter(id=>notices.has(id)).map(id=>({line_id:id,first_seen_at:notices.get(id)}))};
 }
 if(sql.includes('from app_zizobet_match_incident z')){
  return {rows:[{match_id:123,provider_event_id:'corner-90-plus-4',kind:'corner',
   team:'home',minute:94,detail:{minuteLabel:'90+4',seconds:5646,phase:'2nd half'}}]};
 }
 if(sql.includes('from app_match_event_coverage c')){
  return {rows:[
   {match_id:123,coverage_kind:'goal',through_minute:90,complete:true,
    confirmed_at:new Date(now).toISOString(),count_home:2,count_away:1,
    card_colors_verified:false,provider_event_id:'goal-24',event_kind:'goal',
    team:'home',minute:24,seconds:1450,player_name:'Test Scorer',card_color:null,
    own_goal:false,phase:'2'},
   {match_id:123,coverage_kind:'corner',through_minute:90,complete:true,
    confirmed_at:null,count_home:4,count_away:2,
    card_colors_verified:false,provider_event_id:'corner-31',event_kind:'corner',
    team:'away',minute:31,seconds:1870,player_name:null,card_color:null,
    own_goal:null,phase:'2'},
   {match_id:123,coverage_kind:'card',through_minute:90,complete:true,
    confirmed_at:new Date(now).toISOString(),count_home:1,count_away:1,
    card_colors_verified:true,provider_event_id:'card-40',event_kind:'card',
    team:'home',minute:40,seconds:2405,player_name:'Booked Player',card_color:'yellow',
    own_goal:null,phase:'2'},
   {match_id:123,coverage_kind:'foul',through_minute:90,complete:true,
    confirmed_at:null,count_home:8,count_away:6,
    card_colors_verified:false,provider_event_id:'foul-42',event_kind:'foul',
    team:'away',minute:42,seconds:2530,player_name:null,card_color:null,
    own_goal:null,phase:'2'},
  ]};
 }
 observedSql=sql;observedParams=params;
 return {rows:rows.map(row=>({...row,first_seen_at:notices.get(row.line_id)}))};
};
const queue=await manualReviewQueue({runQuery,now,limit:25});
assert.equal(queue.notificationCount,4);
assert.equal(noticeBatchCalls,1,'all first-seen notices are registered in one batch query');
assert.equal(queue.items[0].noticeExpiresAt,new Date(now+48*3600000).toISOString());
const justBefore=await manualReviewQueue({runQuery,now:now+48*3600000-1,limit:25});
assert.equal(justBefore.notificationCount,4);
const expired=await manualReviewQueue({runQuery,now:now+48*3600000,limit:25});
assert.equal(expired.notificationCount,0);
assert.equal(expired.items.length,5,'expiry does not close unresolved cases and ordinary Pending tickets stay listed');
assert.equal(expired.items.find(item=>item.lineId==='line-d').reason,'AWAITING_RESULT');
assert.equal(expired.items.find(item=>item.lineId==='line-d').requiresReview,false);
assert.equal(expired.items.find(item=>item.lineId==='line-d').notificationActive,false);
assert.match(observedSql,/o.status='PENDING'/,'an explicit pending decision keeps the review open');
assert.equal(queue.items.length,5,'all Pending players are listed, even when no manual-review reason exists');
assert.deepEqual(queue.items.map(r=>r.lineId),['line-a','line-b','line-c','line-d','line-g']);
assert.deepEqual(queue.items.filter(item=>item.requiresReview).map(item=>item.lineId),['line-a','line-b','line-c','line-g']);
assert.equal(queue.items[0].finalScore,'2 - 1');
assert.equal(queue.items[0].finalCounters.corners.home,4);
assert.equal(queue.items[0].finalCounters.cards.away,1);
assert.equal(queue.items[0].finalCounters.statistics.shotsOnTarget.home,3);
assert.equal(queue.items[0].finalCounters.source,'ZIZOBET');
assert.equal(queue.items[0].placementSnapshot.scoreHome,1);
assert.equal(queue.items[0].placementSnapshot.scoreAway,0);
assert.equal(queue.items[0].eventTimeline.length,5,
 'Raw Zizobet archive events remain visible when no canonical fact row is available');
assert.equal(queue.items[0].eventTimeline[0].minute,24);
assert.equal(queue.items[0].eventTimeline[0].playerName,'Test Scorer');
assert.equal(queue.items[0].eventTimeline[1].kind,'corner');
assert.equal(queue.items[0].eventTimeline[1].verified,false,'archived but unconfirmed incidents remain visible and clearly labelled');
assert.equal(queue.items[0].eventTimeline[2].kind,'card');
assert.equal(queue.items[0].eventTimeline[2].cardColor,'yellow');
assert.equal(queue.items[0].eventTimeline[3].kind,'foul');
assert.equal(queue.items[0].eventTimeline[4].minute,94);
assert.equal(queue.items[0].eventTimeline[4].minuteLabel,'90+4');
assert.equal(queue.items[0].eventTimeline[4].verified,false,
 'The 90+4 native incident is visible but remains explicitly unconfirmed');
assert.equal(queue.items[0].eventCoverage.find(item=>item.kind==='card').cardColorsVerified,true);
assert.equal(queue.items[0].eventCoverage.find(item=>item.kind==='goal').countHome,2);
assert.equal(queue.items[0].eventTimelineSource,'ZIZOBET_ARCHIVED');
assert.equal(queue.items[2].lineStatus,'VOID');
assert.match(observedSql,/app_settlement_override/);
assert.deepEqual(observedParams,[25,0,false]);
const expanded=await manualReviewQueue({runQuery,now,limit:1800});
assert.equal(expanded.items.length,5);
assert.deepEqual(observedParams,[1800,0,false],'regular Pending view pages the requested 1,800 rows');
const reviewOnly=await manualReviewQueue({runQuery,now,limit:25,reviewOnly:true});
assert.equal(reviewOnly.items.length,4,'Stitch alert queue stays limited to actual review cases');
assert.ok(reviewOnly.items.every(item=>item.requiresReview));
assert.deepEqual(observedParams,[250,0,true]);
await manualReviewQueue({runQuery,now,limit:25,offset:25});
assert.deepEqual(observedParams,[25,25,false],'Pending list supports offset pagination');

// Simulate one approved selection only, in a two-line ticket. No live DB
// or wallet is used; assert that only the selected UUID is changed.
const admin={id:'admin',username:'admin'};
const ticketId='00000000-0000-4000-8000-000000000001';
const lineId='00000000-0000-4000-8000-000000000002';
const otherId='00000000-0000-4000-8000-000000000003';
const lines=[
 {id:lineId,ticket_id:ticketId,match_id:123,market_key:'corner',line:'',outcome_key:'Yes',status:'PENDING',odds_at_placement:2},
 {id:otherId,ticket_id:ticketId,match_id:124,market_key:'result',line:'',outcome_key:'1',status:'PENDING',odds_at_placement:2},
];
const ticket={id:ticketId,user_id:'player',stake:100,status:'PENDING',potential_payout:400,original_potential_payout:400};
const writes=[],calls=[];
const client={async query(sql,params=[]){
 calls.push(sql);
 if(sql==='select role,status,deleted_at from app_user where id=$1 for share')return {rows:[{role:'ADMIN',status:'ACTIVE',deleted_at:null}]};
 if(sql==='select * from app_ticket_line where id=$1')return {rows:lines.filter(l=>l.id===params[0]).map(l=>({...l}))};
 if(sql==='select * from app_ticket where id=$1 for update')return {rows:[{...ticket}]};
 if(sql==='select * from app_ticket_line where ticket_id=$1 order by id for update')return {rows:lines.map(l=>({...l}))};
 if(sql.startsWith('update app_ticket_line')){writes.push({id:params[0],status:params[1]});return {rowCount:1};}
 if(sql.startsWith('insert into app_settlement_override'))return {rowCount:1};
 if(sql.startsWith('update app_ticket set'))return {rowCount:1};
 if(sql.startsWith('insert into app_admin_audit'))return {rowCount:1};
 if(sql==='begin'||sql==='commit'||sql==='rollback')return {};
 throw Error('Unexpected SQL: '+sql);
 },release(){}};
const database={connect:async()=>client};
const result=await manualSettlement({lineId,status:'VOID',reason:'Confirmed market cancellation',source:'Official provider'},admin,{database});
assert.equal(result.changed.length,1);
assert.deepEqual(writes,[{id:lineId,status:'VOID'}]);
assert.match(SETTLEMENT_REVIEW_SQL,/PENDING','WON','LOST','VOID/);
await assert.rejects(()=>manualSettlement({lineId:otherId,status:'NOT_VALID',reason:'x',source:'x'},admin,{database}),e=>e.status===400);
console.log('PASS manual review queue and selection-specific audited decisions; no real wallet writes');
