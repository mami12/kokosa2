import {query} from '../db.mjs';
import {eventMarketRequirement} from './event-market-policy.mjs';
import {settlementStatisticFields} from './settlement-review.mjs';
import {isProvenTwoWayTotalPush} from './settler.mjs';

const NOTICE_LIFETIME_MS=48*60*60*1000;
const text=value=>String(value??'').trim();
const nowDate=value=>{const n=new Date(value).getTime();return Number.isFinite(n)?n:0;};
/** Why this specific selection should be reviewed, never an automatic decision. */
export function reviewReason(row,now=Date.now()){
 if(row.result_id==null&&row.start_at!=null&&nowDate(row.start_at)>now)return null;
 const market=text(row.market_name);
 // Scoring Type is a goal-method contract. The current Zizobet timeline
 // adapter preserves own-goal hints, but not verified penalty/header/foot data.
 // Keep this explicit reason even when an earlier attempt marked the line VOID.
 if(/\bscoring type\b/i.test(market)&&['PENDING','VOID'].includes(row.line_status))
  return 'MISSING_GOAL_METHOD_EVIDENCE';
 if(row.line_status==='VOID'){
  // A confirmed two-way integer Over/Under push is already a valid settlement,
  // not an API anomaly for the administrator to resolve manually.
  if(isProvenTwoWayTotalPush(row,row))return null;
  return 'VOID_NEEDS_CONFIRMATION';
 }
 if(row.line_status!=='PENDING'||row.ticket_status!=='PENDING')return null;
 // Native offers accepted without a proven settlement rule are visible to
 // staff immediately, even while their match is still LIVE.
 if(row.accepted_contract?.settlementHold||row.settlement_reason==='NATIVE_RULE_REVIEW')
  return 'NATIVE_CONTRACT_REVIEW';
 const review=row.statistics_review;
 if(row.result_id!=null){
  const fields=settlementStatisticFields(row);
  if(fields.some(field=>review?.conflicts?.[field]))return 'CONFLICTING_API_STATISTICS';
  if(eventMarketRequirement(row)||/\b(?:interval|minute|next goal|next corner|race to|early payout)\b/i.test(market))return 'MISSING_EVENT_TIMELINE';
  if(fields.length||/\b(?:half|period)\b/i.test(market))return 'MISSING_MARKET_STATISTICS';
  // Every unresolved final-market selection deserves an admin decision.
  return 'UNRESOLVED_FINAL_SELECTION';
 }
 // A live/prematch market cannot be called invalid merely because it has no FT.
 const status=text(row.feed_status??row.match_status).toLowerCase();
 if(/^(?:live|1h|2h|first half|second half|prematch|scheduled)$/.test(status))return null;
 if(now-nowDate(row.placed_at)<6*60*60*1000)return null;
 return 'MISSING_FINAL_RESULT';
}
export async function manualReviewQueue({runQuery=query,limit=150,offset=0,reviewOnly=false,now=Date.now()}={}){
 const cap=Math.min(2000,Math.max(1,Math.trunc(Number(limit)||150)));
 const start=Math.max(0,Math.trunc(Number(offset)||0));
 const scanLimit=Math.min(20000,cap*(reviewOnly?10:1));
 const rows=(await runQuery(`select l.id as line_id,l.ticket_id,l.match_id,l.market_key,l.line,l.outcome_key,
    l.outcome_name,l.market_name,l.match_name,l.status as line_status,l.odds_at_placement,
    l.accepted_contract,l.live_contract,
    l.accepted_contract->'acceptedLiveSnapshot' as placement_snapshot,
    l.accepted_contract->>'homeTeamName' as home_team_name,
    l.accepted_contract->>'awayTeamName' as away_team_name,
    l.settlement_reason,
    t.status as ticket_status,t.placed_at,t.stake,t.original_potential_payout,
    u.username,r.match_id as result_id,r.home_score,r.away_score,r.statistics as final_statistics,r.source as result_source,
    r.half_home_score,r.half_away_score,r.corners_home,r.corners_away,r.cards_home,r.cards_away,
    sr.payload as statistics_review,m.status as match_status,m.feed_status,m.start_at,
    o.status as override_status,n.first_seen_at
    from app_ticket_line l
    join app_ticket t on t.id=l.ticket_id
    left join app_user u on u.id=t.user_id
    left join app_match_result r on r.match_id=l.match_id
    left join app_stat_review sr on sr.match_id=l.match_id
    left join matches m on m.match_id=l.match_id
    left join app_settlement_override o on o.line_id=l.id
    left join app_manual_review_notice n on n.line_id=l.id
    where ((l.status='PENDING' and t.status='PENDING') or l.status='VOID')
      and t.status not in ('CANCELLED','REVERTED','CASHED_OUT')
      and (o.line_id is null or o.status='PENDING')
      and ($3::boolean=false or l.status='VOID' or r.match_id is not null
        or coalesce(l.accepted_contract->>'settlementHold','')<>''
        or (t.placed_at<now()-interval '6 hours' and lower(coalesce(m.status,'')) in ('ended','closed','finished')))
    order by case when l.status='PENDING' then 0 else 1 end,t.placed_at desc,t.id desc,l.id
    limit $1 offset $2`,[scanLimit,start,reviewOnly])).rows;
 const eligible=[];
 for(const row of rows){
  const reason=reviewReason(row,now);
  if(reason)eligible.push({row,reason,requiresReview:true});
  else if(row.line_status==='PENDING'&&row.ticket_status==='PENDING'&&!reviewOnly)
   eligible.push({row,reason:'AWAITING_RESULT',requiresReview:false});
  if(eligible.length>=cap)break;
 }
 // Register unseen notices in one batch. Expanding the review queue must not
 // turn 2,000 tickets into 2,000 sequential database round trips.
 const reviewEligible=eligible.filter(item=>item.requiresReview);
 const missingNoticeIds=reviewEligible.filter(({row})=>!row.first_seen_at).map(({row})=>row.line_id);
 const noticeTimes=new Map(reviewEligible.filter(({row})=>row.first_seen_at)
  .map(({row})=>[String(row.line_id),row.first_seen_at]));
 if(missingNoticeIds.length){
  await runQuery(`insert into app_manual_review_notice(line_id,first_seen_at)
   select unnest($1::uuid[]),$2::timestamptz
   on conflict(line_id) do nothing`,[missingNoticeIds,new Date(now)]);
  const saved=(await runQuery(
   'select line_id,first_seen_at from app_manual_review_notice where line_id=any($1::uuid[])',
   [missingNoticeIds])).rows;
  for(const row of saved)noticeTimes.set(String(row.line_id),row.first_seen_at);
 }
 const items=[];
 for(const {row,reason,requiresReview} of eligible){
  const firstSeenAt=requiresReview?(noticeTimes.get(String(row.line_id))??new Date(now)):null;
  const noticeExpiresAt=firstSeenAt?new Date(nowDate(firstSeenAt)+NOTICE_LIFETIME_MS):null;
  items.push({requiresReview,noticeExpiresAt:noticeExpiresAt?.toISOString()??null,notificationActive:requiresReview&&now<noticeExpiresAt.getTime(),lineId:row.line_id,ticketId:row.ticket_id,matchId:String(row.match_id),
   marketKey:row.market_key,marketLine:row.line??'',marketName:row.market_name,
   matchName:row.match_name,outcomeKey:row.outcome_key,outcomeName:row.outcome_name,
   lineStatus:row.line_status,ticketStatus:row.ticket_status,username:row.username??null,
   placedAt:row.placed_at,stake:row.stake,odds:row.odds_at_placement,
   potentialPayout:row.original_potential_payout,
   finalScore:row.result_id!=null?row.home_score+' - '+row.away_score:null,
   placementSnapshot:row.placement_snapshot??null,
   homeTeamName:row.home_team_name??null,awayTeamName:row.away_team_name??null,
   liveContract:row.live_contract??null,
   finalStatistics:row.final_statistics??null,
   finalCounters:row.result_id!=null?{
    corners:{home:row.corners_home,away:row.corners_away},
    cards:{home:row.cards_home,away:row.cards_away},
    statistics:row.final_statistics??{},source:row.result_source??null
   }:null,
   reason,conflicts:row.statistics_review?.conflicts??null});
 }
 const matchIds=[...new Set(items.map(item=>Number(item.matchId)).filter(id=>Number.isSafeInteger(id)&&id>0))];
 const eventsByMatch=new Map(),coverageByMatch=new Map();
 if(matchIds.length){
  const eventRows=(await runQuery(`with confirmed as (
    select c.match_id,c.kind as coverage_kind,c.through_minute,c.complete,
      c.confirmed_at,c.count_home,c.count_away,c.card_colors_verified,
      f.provider_event_id,f.kind as event_kind,f.team,f.minute,f.seconds,
      case when f.supplemental_verified then f.supplemental_player_name
        when f.aiscore_verified then f.aiscore_player_name
        when f.fotmob_verified then f.fotmob_player_name
        else f.player_name end as player_name,
      f.card_color,f.own_goal,f.phase,
      row_number() over(partition by c.match_id,c.kind
        order by f.minute,f.seconds nulls last,f.provider_event_id) as event_index
    from app_match_event_coverage c
    left join app_match_event_fact f
      on f.match_id=c.match_id and f.provider=c.provider
      and f.kind=c.kind and f.active=true
    where c.match_id=any($1::bigint[]) and c.provider='zizobet'
      and c.kind in ('goal','corner','card','foul')
  )
  select * from confirmed where event_index<=250
  order by match_id,minute,seconds nulls last,provider_event_id`,[matchIds])).rows;
  for(const row of eventRows){
   const id=String(row.match_id),kind=String(row.coverage_kind??'');
   if(!coverageByMatch.has(id))coverageByMatch.set(id,new Map());
   if(kind&&!coverageByMatch.get(id).has(kind)){
    coverageByMatch.get(id).set(kind,{
     kind,throughMinute:Number(row.through_minute),complete:row.complete===true,
     confirmed:row.confirmed_at!=null,confirmedAt:row.confirmed_at,
     countHome:Number(row.count_home),countAway:Number(row.count_away),
     cardColorsVerified:row.card_colors_verified===true
    });
   }
   if(row.event_kind&&row.provider_event_id!=null){
    if(!eventsByMatch.has(id))eventsByMatch.set(id,[]);
    eventsByMatch.get(id).push({
     id:String(row.provider_event_id),kind:String(row.event_kind),team:String(row.team),
     minute:Number(row.minute),seconds:row.seconds==null?null:Number(row.seconds),
     playerName:row.player_name??null,cardColor:row.card_color??null,
     ownGoal:row.own_goal??null,phase:row.phase??null,verified:row.confirmed_at!=null
    });
   }
  }
 }
 if(matchIds.length){
  // The raw Zizobet archive is deliberately separate from financial facts.
  // If a timeline fails reconciliation, keep its native incidents visible in
  // Admin as unconfirmed instead of making them disappear from the audit.
  const archivedRows=(await runQuery(`with archived as (
    select z.match_id,z.provider_event_id,z.kind,z.team,z.minute,z.detail,
      row_number() over(partition by z.match_id order by z.minute,
        nullif(z.detail->>'seconds','')::numeric nulls last,z.provider_event_id) as event_index
    from app_zizobet_match_incident z
    where z.match_id=any($1::bigint[]) and z.active=true
      and not exists(
       select 1 from app_match_event_fact f
       join app_match_event_coverage c
        on c.match_id=f.match_id and c.provider=f.provider and c.kind=f.kind
       where f.match_id=z.match_id and f.provider='zizobet'
         and f.provider_event_id=z.provider_event_id and f.kind=z.kind and f.active=true)
   )
   select match_id,provider_event_id,kind,team,minute,detail
   from archived where event_index<=250
   order by match_id,minute,nullif(detail->>'seconds','')::numeric nulls last,provider_event_id`,[matchIds])).rows;
  for(const row of archivedRows){
   const id=String(row.match_id);
   let detail=row.detail??{};
   if(typeof detail==='string'){try{detail=JSON.parse(detail);}catch{detail={};}}
   if(!eventsByMatch.has(id))eventsByMatch.set(id,[]);
   eventsByMatch.get(id).push({
    id:String(row.provider_event_id),kind:String(row.kind),team:String(row.team),
    minute:Number(row.minute),
    seconds:detail.seconds==null?null:Number(detail.seconds),
    minuteLabel:detail.minuteLabel??null,
    playerName:detail.playerName??detail.player??null,
    cardColor:detail.cardColor??null,ownGoal:detail.ownGoal??null,
    phase:detail.phase??null,verified:false
   });
  }
  for(const events of eventsByMatch.values())
   events.sort((a,b)=>a.minute-b.minute||
    (a.seconds??Infinity)-(b.seconds??Infinity)||a.id.localeCompare(b.id));
 }
 for(const item of items){
  const id=String(item.matchId);
  item.eventTimeline=eventsByMatch.get(id)??[];
  item.eventCoverage=[...(coverageByMatch.get(id)?.values()??[])];
  item.eventTimelineSource=!item.eventTimeline.length?'UNAVAILABLE':
   item.eventTimeline.every(event=>event.verified)?'ZIZOBET_CONFIRMED':'ZIZOBET_ARCHIVED';
 }
 return {items,count:items.length,notificationCount:items.filter(item=>item.notificationActive).length,
  hasMore:rows.length===scanLimit,nextOffset:start+rows.length,offset:start,reviewOnly};
}
