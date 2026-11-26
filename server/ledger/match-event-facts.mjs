import crypto from 'node:crypto';
import {gradeMultiCornerFacts} from './multi-corners.mjs';
import {gradeCornerComparisonFacts} from './corner-comparisons.mjs';
import {gradeHandicapContract,gradeHalfCornerHandicapFacts} from './handicap-contracts.mjs';
import {gradePlayerOrdinalScorerFacts} from './player-ordinal-scorer.mjs';
import {gradePlayerGoalSpecial} from './player-goal-specials.mjs';
import {gradeHalfExactFacts} from './half-exact-markets.mjs';
import {gradeHalfCombination} from './half-combinations.mjs';
import {gradePeriodGoalTotal} from './period-goal-totals.mjs';
import {HISTORICAL_GOAL_PROVIDERS} from './historical-event-facts.mjs';
/**
 * Persistent PRIMARY-feed football incidents. Provider IDs and player names are
 * preserved verbatim. Only an incident list reconciled with the same provider's
 * counters may replace the current active facts. Missing evidence never deletes
 * previously verified facts or grades a losing selection.
 */
export const MATCH_EVENT_FACT_SQL = String.raw`
create table if not exists app_match_event_fact (
 match_id bigint not null,
 provider text not null,
 provider_event_id text not null,
 kind text not null check (kind in ('goal','corner','card','foul')),
 team text not null check (team in ('home','away')),
 minute integer not null check (minute between 0 and 130),
 seconds numeric(12,3),
 player_id text,
 player_name text,
 card_color text check(card_color in ('yellow','red') or card_color is null),
 own_goal boolean,
 aiscore_player_id text,
 aiscore_player_name text,
 aiscore_verified boolean not null default false,
 fotmob_player_name text,
 fotmob_verified boolean not null default false,
 supplemental_player_name text,
 supplemental_actor_provider text,
 supplemental_verified boolean not null default false,
 phase text,
 active boolean not null default true,
 observed_at timestamptz not null default now(),
 primary key(match_id,provider,provider_event_id,kind)
);
alter table app_match_event_fact add column if not exists card_color text;
alter table app_match_event_fact add column if not exists own_goal boolean;
alter table app_match_event_fact add column if not exists aiscore_player_id text;
alter table app_match_event_fact add column if not exists aiscore_player_name text;
alter table app_match_event_fact add column if not exists aiscore_verified boolean not null default false;
alter table app_match_event_fact add column if not exists fotmob_player_name text;
alter table app_match_event_fact add column if not exists fotmob_verified boolean not null default false;
alter table app_match_event_fact add column if not exists supplemental_player_name text;
alter table app_match_event_fact add column if not exists supplemental_actor_provider text;
alter table app_match_event_fact add column if not exists supplemental_verified boolean not null default false;
create index if not exists app_match_event_fact_lookup
 on app_match_event_fact(match_id,provider,kind,active,minute,seconds);
create table if not exists app_match_event_coverage (
 match_id bigint not null,
 provider text not null,
 kind text not null,
 through_minute numeric(10,4) not null,
 count_home integer not null,
 count_away integer not null,
 complete boolean not null default false,
 observed_at timestamptz not null default now(),
 primary key(match_id,provider,kind)
);
alter table app_match_event_coverage add column if not exists card_colors_verified boolean not null default false;
alter table app_match_event_coverage add column if not exists sample_signature text;
alter table app_match_event_coverage add column if not exists sample_first_seen_at timestamptz;
alter table app_match_event_coverage add column if not exists confirmed_at timestamptz;
`;
const validKind = new Set(['goal','corner','card','foul','offside']);
const validSide = new Set(['home','away']);
/**
 * A newer contradictory Zizobet counter/timeline suspends a previous proof.
 * Keep the last good incident rows for audit, but never sell their old
 * confirmed coverage as proof of the currently observed count. Recovery
 * must supply two new matching provider samples, even after process restart.
 * An absent timeline with unchanged counters does not invalidate coverage.
 */
export async function invalidateContradictedEventCoverage(matchId,frame,execute,observedAt=new Date()){
 if(frame?.source!=='zizobet'||typeof execute!=='function')return 0;
 const clock=Number.isFinite(frame.clock)?frame.clock:frame.ended===true?130:null;
 if(clock===null)return 0;
 const observed=new Date(observedAt);
 if(!Number.isFinite(observed.getTime()))return 0;
 let invalidated=0;
 for(const kind of validKind){
  const counts=frame.teams?.[kind];
  if(!counts||!['home','away'].every(s=>Number.isSafeInteger(counts[s])&&counts[s]>=0))continue;
  if(!frame.rawTimelineTruncated&&frame.coverage?.[kind+'Through']!=null)continue;
  const timelineDisagrees=frame.eventListAvailable===true;
  const result=await execute(
   "update app_match_event_coverage set confirmed_at=null,sample_signature=null,"+
   "sample_first_seen_at=null where match_id=$1 and provider='zizobet' and kind=$2 "+
   "and confirmed_at is not null and observed_at<$5::timestamptz and through_minute<=$6 "+
   "and (count_home<>$3 or count_away<>$4 or $7::boolean) returning kind",
   [matchId,kind,counts.home,counts.away,observed,clock,timelineDisagrees]);
  invalidated+=result.rowCount??result.rows?.length??0;
 }
 return invalidated;
}
/** Called INSIDE the existing live-frame SQL transaction. */
export async function persistVerifiedEventFacts(matchId, frame, execute, observedAt=new Date()) {
 const observed=new Date(observedAt);
 if(!Number.isFinite(observed.getTime()))throw new Error('Invalid event observation timestamp');
 if(frame?.source!=='zizobet'||!Array.isArray(frame.events))return 0;
 let stored=0;
 for(const kind of validKind){
  const through=Number(frame.coverage?.[kind+'Through']);
  if(frame.coverage?.[kind+'Through']==null||!Number.isFinite(through)||through<0||through>130)continue;
  const counts=frame.teams?.[kind];
  if(!counts||!['home','away'].every(side=>Number.isSafeInteger(counts[side])&&counts[side]>=0))continue;
  const relevant=frame.events.filter(event=>event.type===kind);
  if(relevant.some(event=>!validSide.has(event.team)||!Number.isInteger(event.minute)||
      event.minute<0||event.minute>130||event.id==null||String(event.id)===''||
      (event.seconds!=null&&(!Number.isFinite(event.seconds)||event.seconds<0))))continue;
  // Only compare complete provider event lists with its own live counters.
  if(relevant.filter(e=>e.team==='home').length!==counts.home||
     relevant.filter(e=>e.team==='away').length!==counts.away)continue;
  // Drop out-of-order or stale samples; they cannot rewrite accepted facts.
  const earlier=await execute(`select through_minute,complete,sample_signature,sample_first_seen_at,confirmed_at
     from app_match_event_coverage where match_id=$1 and provider='zizobet' and kind=$2 for update`,
     [matchId,kind]);
  const previous=earlier.rows[0];
  if(previous&&(Number(previous.through_minute)>through||
    (previous.complete===true&&frame.ended!==true)))continue;
  const identifiers=relevant.map(e=>String(e.id));
  if(new Set(identifiers).size!==identifiers.length)continue;
  // An advancing clock is harmless; corrected incident identity/time is not.
  const signature=crypto.createHash('sha256').update(JSON.stringify({
   kind,home:counts.home,away:counts.away,ended:frame.ended===true,
   colorVerified:kind==='card'&&frame.cardColorsVerified===true,
   events:relevant.map(e=>[String(e.id),e.team,e.minute,e.seconds??null,e.cardColor??null,e.ownGoal??null,e.playerId??null,e.player??null])
     .sort((a,b)=>a[0].localeCompare(b[0]))
  })).digest('hex');
  const facts=relevant.map(e=>({id:String(e.id),team:e.team,minute:e.minute,seconds:e.seconds??null,
   playerId:e.playerId==null?null:String(e.playerId),
   playerName:typeof e.player==='string'?e.player:null,
   ownGoal:typeof e.ownGoal==='boolean'?e.ownGoal:null,
   cardColor:kind==='card'?e.cardColor??null:null,phase:e.phase??null}));
  // The source event set is content-addressed. A second identical poll
  // MUST advance evidence confirmation but MUST NOT rewrite every incident.
  // This matters with hundreds of fixtures and a small PostgreSQL server.
  if(previous?.sample_signature!==signature){
  // A correction may remove/replace a provider event, but the raw live-frame
  // archive remains intact. Changes are atomic with coverage and the new frame.
  await execute(`update app_match_event_fact set active=false,observed_at=now()
     where match_id=$1 and provider='zizobet' and kind=$2 and active=true
     and not(provider_event_id=any($3::text[]))`,[matchId,kind,identifiers]);
  if(facts.length)await execute(`insert into app_match_event_fact
    (match_id,provider,provider_event_id,kind,team,minute,seconds,player_id,
     player_name,card_color,own_goal,phase,active)
    select $1,'zizobet',f.id,$2,f.team,f.minute,f.seconds,f.player_id,
     f.player_name,f.card_color,f.own_goal,f.phase,true
    from jsonb_to_recordset($3::jsonb)
     as f(id text,team text,minute integer,seconds numeric,player_id text,
       player_name text,card_color text,own_goal boolean,phase text)
    on conflict(match_id,provider,provider_event_id,kind) do update
    set team=excluded.team,minute=excluded.minute,seconds=excluded.seconds,
        player_id=excluded.player_id,player_name=excluded.player_name,
        card_color=excluded.card_color,own_goal=excluded.own_goal,
        aiscore_verified=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute
          and (excluded.player_name is null or app_match_event_fact.aiscore_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.aiscore_player_name))
          then app_match_event_fact.aiscore_verified else false end,
        aiscore_player_name=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute
          and (excluded.player_name is null or app_match_event_fact.aiscore_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.aiscore_player_name))
          then app_match_event_fact.aiscore_player_name else null end,
        aiscore_player_id=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute
          and (excluded.player_name is null or app_match_event_fact.aiscore_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.aiscore_player_name))
          then app_match_event_fact.aiscore_player_id else null end,
        fotmob_verified=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute and excluded.own_goal=false
          and (excluded.player_name is null or app_match_event_fact.fotmob_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.fotmob_player_name))
          then app_match_event_fact.fotmob_verified else false end,
        fotmob_player_name=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute and excluded.own_goal=false
          and (excluded.player_name is null or app_match_event_fact.fotmob_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.fotmob_player_name))
          then app_match_event_fact.fotmob_player_name else null end,
        supplemental_verified=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute
          and (excluded.kind<>'goal' or excluded.own_goal=false)
          and (excluded.player_name is null or app_match_event_fact.supplemental_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.supplemental_player_name))
          then app_match_event_fact.supplemental_verified else false end,
        supplemental_player_name=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute
          and (excluded.kind<>'goal' or excluded.own_goal=false)
          and (excluded.player_name is null or app_match_event_fact.supplemental_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.supplemental_player_name))
          then app_match_event_fact.supplemental_player_name else null end,
        supplemental_actor_provider=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute
          and (excluded.kind<>'goal' or excluded.own_goal=false)
          and (excluded.player_name is null or app_match_event_fact.supplemental_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.supplemental_player_name))
          then app_match_event_fact.supplemental_actor_provider else null end,
        phase=excluded.phase,active=true,observed_at=now()`,
   [matchId,kind,JSON.stringify(facts.map(f=>({
    id:f.id,team:f.team,minute:f.minute,seconds:f.seconds,player_id:f.playerId,
    player_name:f.playerName,card_color:f.cardColor,own_goal:f.ownGoal,phase:f.phase})))]);
  }
  await execute(`insert into app_match_event_coverage
    (match_id,provider,kind,through_minute,count_home,count_away,complete,
     sample_signature,sample_first_seen_at,confirmed_at,observed_at,card_colors_verified)
    values ($1,'zizobet',$2,$3,$4,$5,$6,$7,$8::timestamptz,null,$8::timestamptz,$9::boolean)
    on conflict(match_id,provider,kind) do update
    set through_minute=excluded.through_minute,count_home=excluded.count_home,
        count_away=excluded.count_away,complete=excluded.complete,
        card_colors_verified=excluded.card_colors_verified,
        sample_signature=excluded.sample_signature,
        sample_first_seen_at=case
          when app_match_event_coverage.sample_signature=excluded.sample_signature
          then coalesce(app_match_event_coverage.sample_first_seen_at,excluded.sample_first_seen_at)
          else excluded.sample_first_seen_at end,
        confirmed_at=case
          when app_match_event_coverage.sample_signature=excluded.sample_signature
            and app_match_event_coverage.sample_first_seen_at is not null
            and (app_match_event_coverage.confirmed_at is not null or
              excluded.observed_at-app_match_event_coverage.sample_first_seen_at>=interval '5 seconds')
          then coalesce(app_match_event_coverage.confirmed_at,excluded.observed_at)
          else null end,
        observed_at=excluded.observed_at
    where excluded.through_minute>=app_match_event_coverage.through_minute
       or excluded.complete=true`,
   [matchId,kind,through,counts.home,counts.away,frame.ended===true,signature,observed,
    kind==='card'&&frame.cardColorsVerified===true]);
  stored+=facts.length;
 }
 return stored;
}
export const SUPPORTED_FACT_KINDS=new Set(['window','sequence','race','last-event','over','under','exact','atLeast','range','team-total-goals','interval-result','interval-leader','window-total','nth-time','lead-up','team-nth-time','window-first-event','window-parity','interval-handicap','player-goal','player-ordinal-goal','player-goal-special','player-card','half-combo','period-goal-total','half-first-event','half-last-event','half-race','half-next-event','half-sequence','half-parity','half-exact-count','multi-corners','corner-comparison','score-handicap','half-total']);
/** A complete, independently reconciled match-corner timeline is required
 * before first-half "First Corner / None" can be decided. Unlabelled stoppage
 * and minute-45+ events cannot be assigned to a half from the minute alone.
 * A clear corner before minute 45 CAN still prove the first team, provided
 * same-minute incidents have an unambiguous order.
 */
export function gradeFirstHalfCornerFacts(contract,facts,{complete=false}={}){
 if(!complete||contract?.kind!=='half-first-event'||contract?.event!=='corner'||
    contract?.half!==1||!['home','away','none'].includes(contract?.side)||
    !Array.isArray(facts))return null;
 const first=[],uncertain=[];
 const firstLabels=new Set(['1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1']);
 const secondLabels=new Set(['2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2']);
 for(const item of facts){
  const minute=Number(item?.minute),seconds=item?.seconds==null?null:Number(item.seconds);
  if(!Number.isSafeInteger(minute)||minute<0||minute>130||
     (seconds!==null&&(!Number.isFinite(seconds)||seconds<0))||
     !['home','away'].includes(item?.team))return null;
  const phase=String(item?.phase??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let which=null;
  if(firstLabels.has(phase)){
   if(minute>75)return null;
   which='first';
  }else if(secondLabels.has(phase)){
   if(minute<45)return null;
   which='second';
  }else if(phase){
   // Unknown phases include possible extra-time / penalty periods. An
   // absolute-looking minute does not authorize assigning those to 1H.
   return null;
  }else which=minute<45?'first':minute>45&&minute<=90?'second':'unknown';
  const event={minute,seconds,team:item.team};
  if(which==='first')first.push(event);
  else if(which==='unknown')uncertain.push(event);
 }
 if(!first.length){
  if(uncertain.length)return null;
  return contract.side==='none'?'WON':'LOST';
 }
 // One proven 1H corner is enough to disprove NONE, even when its
 // exact position relative to another same-minute corner is unclear.
 if(contract.side==='none')return 'LOST';
 first.sort((a,b)=>a.minute-b.minute||
   (a.seconds!=null&&b.seconds!=null?a.seconds-b.seconds:0));
 const leader=first[0];
 if(uncertain.some(e=>e.minute<=leader.minute))return null;
 for(const contender of first.slice(1)){
  if(contender.minute!==leader.minute)break;
  if(leader.seconds==null||contender.seconds==null||
     leader.seconds===contender.seconds||contender.seconds<leader.seconds)return null;
 }
 return contract.side===(leader.team)?'WON':'LOST';
}

/** Exact half ordering for race/first/last markets. An unlabelled 45+
 * incident could be first-half stoppage or second-half play, so never
 * allocate it to a period by guessing. Event lists must already reconcile
 * against the provider's complete final counters.
 */
export function gradeHalfEventFacts(contract,facts,{complete=false,halfScore=null}={}){
 if(!complete||!['half-race','half-first-event','half-last-event','half-next-event','half-sequence'].includes(contract?.kind)||
    ![1,2].includes(contract.half)||!['goal','corner','card'].includes(contract.event)||
    !['home','away','none'].includes(contract.side)||!Array.isArray(facts))return null;
 if(['half-race','half-next-event','half-sequence'].includes(contract.kind)&&(!Number.isSafeInteger(contract.target)||
    contract.target<1||contract.target>200))return null;
 if(contract.kind==='half-next-event'&&(
    contract.event!=='goal'||contract.half!==1||
    !Number.isSafeInteger(contract.baseline?.home)||contract.baseline.home<0||
    !Number.isSafeInteger(contract.baseline?.away)||contract.baseline.away<0||
    contract.target!==contract.baseline.home+contract.baseline.away+1))return null;
 const first=new Set(['1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1']);
 const second=new Set(['2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2']);
 const events=[],m45=[],p1={home:0,away:0},p2={home:0,away:0};
 for(const item of facts){
  const minute=Number(item?.minute),seconds=item?.seconds==null?null:Number(item.seconds);
  if(!Number.isSafeInteger(minute)||minute<0||minute>130||
     (seconds!==null&&(!Number.isFinite(seconds)||seconds<0))||
     !['home','away'].includes(item?.team))return null;
  const phase=String(item.phase??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let period=null;
  if(first.has(phase)){if(minute>75)return null;period=1;}
  else if(second.has(phase)){if(minute<45)return null;period=2;}
  else if(phase)return null;
  else if(minute<45)period=1;
  else if(minute===45){
   m45.push({minute,seconds,team:item.team});
   continue;
  }
  else if(minute>45&&minute<=90)period=2;
  else return null;
  if(period===1)p1[item.team]++;
  else if(period===2)p2[item.team]++;
  if(period===contract.half)events.push({minute,seconds,team:item.team});
 }
 if(m45.length){
  // An unlabelled minute-45 event without phase cannot be guessed for corners/cards.
  // For goals ONLY, verified confirmed HT (and optional FT) counts mathematically prove
  // the half when all unlabelled minute-45 goals for a team uniquely belong to 1H or 2H.
  if(contract.event!=='goal'||!halfScore)return null;
  const hh=Number(halfScore.hh),ha=Number(halfScore.ha);
  if(!Number.isSafeInteger(hh)||hh<0||!Number.isSafeInteger(ha)||ha<0)return null;
  const hasFt=halfScore.fh!=null&&halfScore.fa!=null;
  const fh=hasFt?Number(halfScore.fh):null,fa=hasFt?Number(halfScore.fa):null;
  if(hasFt&&(!Number.isSafeInteger(fh)||!Number.isSafeInteger(fa)||fh<hh||fa<ha))return null;
  for(const side of ['home','away']){
   const side45=m45.filter(e=>e.team===side);
   if(!side45.length)continue;
   const htVal=side==='home'?hh:ha;
   const need1=htVal-p1[side];
   if(need1<0)return null;
   let resolvedPeriod=null;
   if(hasFt){
    const ftVal=side==='home'?fh:fa;
    const need2=(ftVal-htVal)-p2[side];
    if(need2<0||need1+need2!==side45.length)return null;
    if(need1===side45.length&&need2===0)resolvedPeriod=1;
    else if(need2===side45.length&&need1===0)resolvedPeriod=2;
    else return null;
   }else{
    const hasLater=facts.some(f=>f.team===side&&Number(f.minute)>45);
    if(need1===side45.length&&p2[side]===0&&!hasLater)resolvedPeriod=1;
    else if(need1===0)resolvedPeriod=2;
    else return null;
   }
   if(resolvedPeriod===contract.half)events.push(...side45);
  }
 }
 // Same minute without distinct second-level timestamps has unknown order
 // between opposing teams; never use a provider's arbitrary array order.
 events.sort((a,b)=>a.minute-b.minute||
   (a.seconds!=null&&b.seconds!=null?a.seconds-b.seconds:0));
 for(let i=1;i<events.length;i++){
  const a=events[i-1],b=events[i];
  if(a.minute===b.minute&&(a.seconds==null||b.seconds==null||
      a.seconds===b.seconds)&&a.team!==b.team)return null;
 }
 const decided=winner=>winner===contract.side?'WON':'LOST';
 const noEvent=()=>contract.noneOffered===true?
   (contract.side==='none'?'WON':'LOST'):'VOID';
 if(contract.kind==='half-first-event'||contract.kind==='half-last-event'){
  if(!events.length)return noEvent();
  const winner=(contract.kind==='half-first-event'?events[0]:events.at(-1)).team;
  return decided(winner);
 }
 if(contract.kind==='half-next-event'){
  const baseline=contract.baseline.home+contract.baseline.away;
  if(events.length<baseline)return null; // provider correction: accepted history disappeared
  const next=events[contract.target-1];
  return next?decided(next.team):noEvent();
 }
 if(contract.kind==='half-sequence'){
  const nth=events[contract.target-1];
  return nth?decided(nth.team):noEvent();
 }
 const counts={home:0,away:0};
 for(const event of events){
  counts[event.team]++;
  if(counts[event.team]===contract.target)return decided(event.team);
 }
 return noEvent();
}
/** A 1H or 2H corner odd/even bet is graded only from a FULL timeline
 * with explicit phase for 45+ incidents. Retakes are deduplicated at ingestion.
 * Missing phase is not an excuse to classify second-half incidents by minute.
 */
export function gradeHalfParityFacts(contract,facts,{complete=false}={}){
 if(!complete||contract?.kind!=='half-parity'||contract.event!=='corner'||
    ![1,2].includes(contract.half)||!['odd','even'].includes(contract.choice)||
    contract.side!=null&&!['home','away'].includes(contract.side)||
    !Array.isArray(facts))return null;
 const first=new Set(['1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1']);
 const second=new Set(['2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2']);
 let count=0;
 for(const e of facts){
  const minute=Number(e?.minute),seconds=e?.seconds==null?null:Number(e.seconds);
  if(!Number.isSafeInteger(minute)||minute<0||minute>130||
     seconds!==null&&(!Number.isFinite(seconds)||seconds<0)||
     !['home','away'].includes(e?.team))return null;
  const raw=String(e?.phase??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let phase;
  if(first.has(raw)){if(minute>75)return null;phase=1;}
  else if(second.has(raw)){if(minute<45)return null;phase=2;}
  else if(raw)return null;
  else if(minute<45)phase=1;
  else if(minute>45&&minute<=90)phase=2;
  else return null;
  if(phase===contract.half&&(contract.side==null||e.team===contract.side))count++;
 }
 return (count%2===(contract.choice==='even'?0:1))?'WON':'LOST';
}
/** Period-sensitive totals require the FULL reconciled event chronology.
 * 45+/90+ incidents belong to the recorded half, not a numeric <=45/<=90
 * cutoff. An unlabelled minute >=45 is ambiguous (it can be 45+ injury
 * time), so an ambiguous phase remains PENDING rather than paying wrongly.
 */
export function gradeHalfTotalFacts(contract,facts,{complete=false,cardColorsVerified=false}={}){
 if(!complete||contract?.kind!=='half-total'||
    !['corner','card'].includes(contract.event)||![1,2].includes(contract.half)||
    !['over','under'].includes(contract.choice)||
    (contract.side!=null&&!['home','away'].includes(contract.side))||
    !Number.isFinite(contract.threshold)||contract.threshold<0||
    !Number.isInteger(contract.threshold*2)||!Array.isArray(facts))return null;
 if(contract.cardColor!=null&&(contract.event!=='card'||
    !['yellow','red'].includes(contract.cardColor)||!cardColorsVerified))return null;
 const first=new Set(['1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1']);
 const second=new Set(['2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2']);
 let count=0;
 for(const fact of facts){
  const minute=Number(fact?.minute);
  const seconds=fact?.seconds==null?null:Number(fact.seconds);
  if(!Number.isSafeInteger(minute)||minute<0||minute>130||
     (seconds!==null&&(!Number.isFinite(seconds)||seconds<0))||
     !['home','away'].includes(fact?.team))return null;
  const phase=String(fact?.phase??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let half;
  if(first.has(phase)){if(minute>75)return null;half=1;}
  else if(second.has(phase)){if(minute<45)return null;half=2;}
  else if(phase)return null; // unknown phase, extra-time, penalties, etc
  else if(minute<45)half=1;
  else if(minute>45&&minute<=90)half=2;
  else return null; // minute 45 without a phase can be 1H stoppage or 2H start
  if(half!==contract.half||contract.side!=null&&fact.team!==contract.side)continue;
  if(contract.cardColor){
   if(fact.card_color!=null&&!['yellow','red'].includes(fact.card_color))return null;
   if(fact.card_color===contract.cardColor)count++;
   else if(fact.card_color==null)return null;
  }else count++;
 }
 if(count===contract.threshold&&Number.isInteger(contract.threshold))return 'VOID';
 return (contract.choice==='over'?count>contract.threshold:count<contract.threshold)?'WON':'LOST';
}
/**
 * PostgreSQL counts the accepted, verified incidents. Returns null when the
 * accepted structured contract, ordering or coverage cannot prove an answer.
 * Do not infer a loss from an absent row or an incomplete timeline.
 */

function gradeOfficialCornerPeriodContract(contract,result){
 const kind=contract?.kind;
 const eligible=contract?.event==='corner'&&(
  ['half-total','half-exact-count','half-parity','corner-comparison','multi-corners'].includes(kind)||
  kind==='score-handicap'&&[1,2].includes(contract.half));
 if(!eligible)return undefined;
 if(String(result?.source??'').toUpperCase()!=='ZIZOBET')return undefined;
 const stats=typeof result.statistics==='string'?(()=>{
  try{return JSON.parse(result.statistics);}catch{return null;}
 })():result.statistics;
 const periods=stats?.cornerPeriods;
 // Missing period aggregates are not a contradiction: continue to the
 // independently confirmed Zizobet event chronology below. Only a present,
 // malformed or non-reconciling primary period snapshot is a hard hold.
 if(!periods)return undefined;
 const periodsSource=String(periods.source??'').toUpperCase();
 if(periodsSource!=='ZIZOBET'&&
    !(periodsSource==='FOTMOB'&&result.corners_home!=null&&result.corners_away!=null))return null;
 const read=value=>{
  if(value?.home==null||value?.away==null)return null;
  const home=Number(value.home),away=Number(value.away);
  return Number.isSafeInteger(home)&&home>=0&&Number.isSafeInteger(away)&&away>=0
   ?{home,away}:null;
 };
 const first=read(periods.firstHalf),second=read(periods.secondHalf),full=read(periods.fullTime);
 if(!first||!second||!full||
    first.home+second.home!==full.home||first.away+second.away!==full.away||
    result.corners_home!=null&&Number(result.corners_home)!==full.home||
    result.corners_away!=null&&Number(result.corners_away)!==full.away)return null;
 const half=contract.half===1?first:contract.half===2?second:null;
 if(kind==='score-handicap'){
  if(!half)return null;
  return gradeHandicapContract({...contract,half:0},
   {corners_home:half.home,corners_away:half.away});
 }
 if(kind==='corner-comparison'){
  const winner=(pair)=>pair.home>pair.away?'home':pair.away>pair.home?'away':'none';
  if(contract.mode==='full-result'){
   if(!['home','away','none'].includes(contract.side))return null;
   const side=winner(full);
   return side==='none'&&contract.drawOffered!==true?'VOID':side===contract.side?'WON':'LOST';
  }
  if(contract.mode==='period-result'){
   if(!half||!['home','away','none'].includes(contract.side))return null;
   const side=winner(half);
   return side==='none'&&contract.drawOffered!==true?'VOID':side===contract.side?'WON':'LOST';
  }
  if(contract.mode==='most-half'){
   if(![0,1,2].includes(contract.choice)||
      contract.scope!=null&&!['home','away'].includes(contract.scope))return null;
   const count=pair=>contract.scope?pair[contract.scope]:pair.home+pair.away;
   const a=count(first),b=count(second),selected=a>b?1:b>a?2:0;
   return selected===contract.choice?'WON':'LOST';
  }
  if(contract.mode==='wins-both'){
   if(!['home','away','none'].includes(contract.side))return null;
   const home=first.home>first.away&&second.home>second.away;
   const away=first.away>first.home&&second.away>second.home;
   const selected=home?'home':away?'away':'none';
   return selected===contract.side?'WON':'LOST';
  }
  return null;
 }
 if(kind==='half-total'){
  if(!half||!['over','under'].includes(contract.choice)||
     !Number.isFinite(contract.threshold)||contract.threshold<0||
     !Number.isInteger(contract.threshold*2)||
     contract.side!=null&&!['home','away'].includes(contract.side))return null;
  const count=contract.side?half[contract.side]:half.home+half.away;
  if(count===contract.threshold&&Number.isInteger(contract.threshold))return 'VOID';
  return (contract.choice==='over'?count>contract.threshold:count<contract.threshold)?'WON':'LOST';
 }
 if(kind==='half-exact-count'){
  if(!half||contract.side!=null&&!['home','away'].includes(contract.side))return null;
  const count=contract.side?half[contract.side]:half.home+half.away;
  if(contract.choice==='exact'&&Number.isSafeInteger(contract.target)&&contract.target>=0)
   return count===contract.target?'WON':'LOST';
  if(contract.choice==='atLeast'&&Number.isSafeInteger(contract.target)&&contract.target>=0)
   return count>=contract.target?'WON':'LOST';
  if(contract.choice==='range'&&Number.isSafeInteger(contract.min)&&
     Number.isSafeInteger(contract.max)&&contract.min>=0&&contract.max>=contract.min)
   return count>=contract.min&&count<=contract.max?'WON':'LOST';
  return null;
 }
 if(kind==='half-parity'){
  if(!half||!['odd','even'].includes(contract.choice)||
     contract.side!=null&&!['home','away'].includes(contract.side))return null;
  const count=contract.side?half[contract.side]:half.home+half.away;
  return (count%2===1?'odd':'even')===contract.choice?'WON':'LOST';
 }
 if(kind==='multi-corners'){
  if(contract.side!=null&&!['home','away'].includes(contract.side))return null;
  const v=pair=>contract.side?pair[contract.side]:pair.home+pair.away;
  const total=v(first)*v(second);
  if(contract.choice==='over'||contract.choice==='under'){
   const t=contract.threshold;
   if(!Number.isFinite(t)||t<0||!Number.isSafeInteger(t*2))return null;
   if(total===t&&Number.isSafeInteger(t))return 'VOID';
   return (contract.choice==='over'?total>t:total<t)?'WON':'LOST';
  }
  if(contract.choice==='exact')
   return Number.isSafeInteger(contract.target)&&contract.target>=0?(total===contract.target?'WON':'LOST'):null;
  if(contract.choice==='range')
   return Number.isSafeInteger(contract.min)&&Number.isSafeInteger(contract.max)&&
    contract.min>=0&&contract.max>=contract.min?(total>=contract.min&&total<=contract.max?'WON':'LOST'):null;
  return null;
 }
 return null;
}
async function gradeSingleEventProvider(line,result,{execute,provider='zizobet'}={}){
 const c2=line?.live_contract;
 if(provider!=='zizobet'){
  if(!HISTORICAL_GOAL_PROVIDERS.has(provider)||!validKind.has(c2?.event))return null;
 }
 const c=line?.live_contract;
 if(!c||!SUPPORTED_FACT_KINDS.has(c.kind)||!validKind.has(c.event)||typeof execute!=='function')return null;
 const periodCornerResult=gradeOfficialCornerPeriodContract(c,result);
 if(periodCornerResult!==undefined)return periodCornerResult;
 const normalTimeOnly=c.normalTimeOnly!==false&&c.event!=null;
 const {rows}=await execute(`with covered as (
   select through_minute,count_home,count_away,complete,observed_at,confirmed_at,card_colors_verified from app_match_event_coverage
   where match_id=$1 and provider=$16::text and kind=$2
 ), raw_events as (
   select f.*,
     case
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') in
        ('1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1') and f.minute>45 then 45
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') ~ '^45[0-9]{1,2}$' and f.minute>45 then 45
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') in
        ('2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2') and f.minute>90 then 90
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') ~ '^90[0-9]{1,2}$' and f.minute>90 then 90
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') in
        ('regular','regulartime','ft','fulltime','normal','normaltime','regulation','regulationtime',
         '90','stoppage','stoppagetime','injurytime') and f.minute>90 then 90
       else f.minute end as contract_minute,
     (regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') in
       ('1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1',
        '2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2',
        'regular','regulartime','ft','fulltime','normal','normaltime','regulation','regulationtime',
        '90','stoppage','stoppagetime','injurytime')
       or regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') ~ '^45[0-9]{1,2}$'
       or regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') ~ '^90[0-9]{1,2}$'
       or (nullif(trim(coalesce(f.phase,'')),'') is null and f.minute<=90)) as normal_time,
     case
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') in
        ('1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1') then 1
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') in
        ('2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2') then 2
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') ~ '^45[0-9]{1,2}$' then 1
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') ~ '^90[0-9]{1,2}$' then 2
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') in
        ('regular','regulartime','ft','fulltime','normal','normaltime','regulation','regulationtime',
         '90','stoppage','stoppagetime','injurytime') then case when f.minute<=45 then 1 else 2 end
       when nullif(trim(coalesce(f.phase,'')),'') is null and f.minute<=45 then 1
       when nullif(trim(coalesce(f.phase,'')),'') is null and f.minute<=90 then 2
       when regexp_replace(lower(coalesce(f.phase,'')),'[^a-z0-9]','','g') in
        ('et','extratime','aet','overtime','extratimefirsthalf','extratimesecondhalf') then 3
       else 4
     end as phase_order
   from app_match_event_fact f
   where f.match_id=$1 and f.provider=$16::text and f.kind=$2 and f.active
 ), ordered as (
   select raw_events.*,
     row_number() over(order by phase_order,coalesce(seconds,minute*60),minute,provider_event_id) as ordinal,
     row_number() over(partition by team order by phase_order,coalesce(seconds,minute*60),minute,provider_event_id) as team_ordinal,
     count(*) over(partition by phase_order,coalesce(seconds,minute*60)) as same_time
   from raw_events
 ), normal_ordered as (
   select * from ordered where normal_time
 ), aggregate as (
   select count(*)::int as total,
    count(*) filter(where team='home')::int as home,
    count(*) filter(where team='away')::int as away,
    (select count(*)::int from normal_ordered where team='home') as normal_home,
    (select count(*)::int from normal_ordered where team='away') as normal_away,
    bool_or($21::boolean=true and seconds is null and minute between $3::numeric and $4::numeric + 1) as clock_boundary_uncertain,
    bool_or(minute>90 and not normal_time and (nullif(trim(coalesce(phase,'')),'') is null or regexp_replace(lower(coalesce(phase,'')),'[^a-z0-9]','','g') not in ('et','extratime','aet','overtime','extratimefirsthalf','extratimesecondhalf'))) as phase_ambiguous,
    count(*) filter(where card_color=$15::text)::int as color_total,
    count(*) filter(where team='home' and card_color=$15::text)::int as color_home,
    count(*) filter(where team='away' and card_color=$15::text)::int as color_away,
    -- Fixed 10-20 minute markets use inclusive provider minutes.
    -- Rolling windows and clock-formatted score intervals instead use seconds.
    count(*) filter(where (
        ($10::boolean=true and coalesce(seconds,minute*60)>$11::numeric
         and coalesce(seconds,minute*60)<=$12::numeric)
        or ($21::boolean=true and coalesce(seconds,minute*60)>=$11::numeric
         and coalesce(seconds,minute*60)<$12::numeric)
        or ($10::boolean=false and $21::boolean=false and ($3::numeric is null or contract_minute >= $3)
         and ($4::numeric is null or contract_minute <= $4)))
      and ($5::text is null or team=$5)
      and ($17::boolean=false or (team='home' and team_ordinal>$18::int)
       or (team='away' and team_ordinal>$19::int))
      and ($20::boolean=false or normal_time))::int as window_count,
    count(*) filter(where (
        ($10::boolean=true and coalesce(seconds,minute*60)>$11::numeric
         and coalesce(seconds,minute*60)<=$12::numeric)
        or ($21::boolean=true and coalesce(seconds,minute*60)>=$11::numeric
         and coalesce(seconds,minute*60)<$12::numeric)
        or ($10::boolean=false and $21::boolean=false and ($3::numeric is null or contract_minute >= $3)
         and ($4::numeric is null or contract_minute <= $4)))
      and ($5::text is null or team=$5)
      and card_color=$15::text
      and ($17::boolean=false or (team='home' and team_ordinal>$18::int)
       or (team='away' and team_ordinal>$19::int))
      and ($20::boolean=false or normal_time))::int as color_window_count,
    count(*) filter(where (
      ($13::boolean=true and coalesce(seconds,minute*60)>=$11::numeric
       and coalesce(seconds,minute*60)<$12::numeric)
      or ($14::boolean=true and contract_minute>=$3::numeric and contract_minute<=$4::numeric))
      and team='home' and ($17::boolean=false or team_ordinal>$18::int)
      and ($20::boolean=false or normal_time))::int as window_home,
    count(*) filter(where (
      ($13::boolean=true and coalesce(seconds,minute*60)>=$11::numeric
       and coalesce(seconds,minute*60)<$12::numeric)
      or ($14::boolean=true and contract_minute>=$3::numeric and contract_minute<=$4::numeric))
      and team='away' and ($17::boolean=false or team_ordinal>$19::int)
      and ($20::boolean=false or normal_time))::int as window_away,
    bool_or($10::boolean=true and seconds is null
      and (minute=floor($11::numeric/60) or minute=floor($12::numeric/60))) as rolling_boundary_uncertain,
    count(*) filter(where (own_goal=false or (own_goal is null and aiscore_verified=true))
     and (($6::text is not null and (
       (player_id is not null and player_id=$6) or
       (aiscore_verified=true and aiscore_player_id is not null and aiscore_player_id=$6)))
      or ($6::text is null and (
       (player_name is not null and lower(player_name)=lower($7)) or
       (aiscore_verified=true and aiscore_player_name is not null
         and lower(aiscore_player_name)=lower($7)) or
       (own_goal=false and fotmob_verified=true and fotmob_player_name is not null
         and lower(fotmob_player_name)=lower($7)) or
       (own_goal=false and supplemental_verified=true and supplemental_player_name is not null
         and lower(supplemental_player_name)=lower($7))))))::int as player_goals,
    bool_or(same_time>1) as ambiguous_order,
    bool_or(seconds is null) as minute_only
   from ordered
 )
 select a.*,c.through_minute,c.count_home,c.count_away,c.complete,c.observed_at,c.confirmed_at,c.card_colors_verified,
  -- Each valid writer has its own timestamp. Do NOT use greatest() here:
  -- the watched gap cursor may be updated after the archive proof but
  -- before the next settlement pass, and must not hide valid evidence.
  (select last_seen_at from app_live_event_cursor where match_id=$1) as second_poll_at,
  (select evidence_observed_at from app_zizobet_match_history where match_id=$1) as archive_poll_at,
  exists(select 1 from app_live_event_recovery g
    where g.match_id=$1 and g.status='AWAITING_BACKUP_API' and $9::uuid=any(g.line_ids)
      and $16::text='zizobet') as open_recovery_gap,
   (select team from ordered where ordinal=(select max(ordinal) from ordered)) as last_team,
   (select same_time from ordered where ordinal=(select max(ordinal) from ordered)) as last_same_time,
   (select team from normal_ordered where ordinal=(select max(ordinal) from normal_ordered)) as normal_last_team,
   (select same_time from normal_ordered where ordinal=(select max(ordinal) from normal_ordered)) as normal_last_same_time,
   (select bool_or(same_time>1) from normal_ordered) as normal_ambiguous_order,
   (select team from ordered where ordinal=$8 and ($20::boolean=false or normal_time)) as nth_team,
   (select contract_minute from ordered where ordinal=$8 and ($20::boolean=false or normal_time)) as nth_minute,
   (select same_time from ordered where ordinal=$8 and ($20::boolean=false or normal_time)) as nth_same_time,
   (select contract_minute from ordered where team=$5::text and team_ordinal=$8 and ($20::boolean=false or normal_time)) as team_nth_minute,
   (select same_time from ordered where team=$5::text and team_ordinal=$8 and ($20::boolean=false or normal_time)) as team_nth_same_time,
   (select team from ordered where contract_minute>=$3::numeric and contract_minute<=$4::numeric
     and ($17::boolean=false or (team='home' and team_ordinal>$18::int) or (team='away' and team_ordinal>$19::int))
     and ($20::boolean=false or normal_time) order by ordinal limit 1) as window_first_team,
   (select contract_minute from ordered where contract_minute>=$3::numeric and contract_minute<=$4::numeric
     and ($17::boolean=false or (team='home' and team_ordinal>$18::int) or (team='away' and team_ordinal>$19::int))
     and ($20::boolean=false or normal_time) order by ordinal limit 1) as window_first_minute,
   (select same_time from ordered where contract_minute>=$3::numeric and contract_minute<=$4::numeric
     and ($17::boolean=false or (team='home' and team_ordinal>$18::int) or (team='away' and team_ordinal>$19::int))
     and ($20::boolean=false or normal_time) order by ordinal limit 1) as window_first_same_time,
   (select max((home_count-$18::int)-(away_count-$19::int)) from (
     select ordinal,team,team_ordinal,
       count(*) filter(where team='home') over(order by ordinal) as home_count,
       count(*) filter(where team='away') over(order by ordinal) as away_count
     from normal_ordered
   ) lead where (team='home' and team_ordinal>$18::int) or (team='away' and team_ordinal>$19::int)) as max_home_lead_since_entry,
   (select max((away_count-$19::int)-(home_count-$18::int)) from (
     select ordinal,team,team_ordinal,
       count(*) filter(where team='home') over(order by ordinal) as home_count,
       count(*) filter(where team='away') over(order by ordinal) as away_count
     from normal_ordered
   ) lead where (team='home' and team_ordinal>$18::int) or (team='away' and team_ordinal>$19::int)) as max_away_lead_since_entry,
   (select bool_or(same_time>1 and ((team='home' and team_ordinal>$18::int) or (team='away' and team_ordinal>$19::int))) from normal_ordered) as ambiguous_order_since_entry,
   (select min(ordinal) from (
     select ordinal,team,count(*) over(partition by team order by ordinal) as team_number
     from ordered where ($20::boolean=false or normal_time)
   ) race where team_number=$8 and team='home') as race_home,
   (select min(ordinal) from (
     select ordinal,team,count(*) over(partition by team order by ordinal) as team_number
     from ordered where ($20::boolean=false or normal_time)
   ) race where team_number=$8 and team='away') as race_away,
   (select coalesce(seconds,minute*60) from ordered where ordinal=(
     select min(ordinal) from (
       select ordinal,team,count(*) over(partition by team order by ordinal) as team_number
       from ordered where ($20::boolean=false or normal_time)
     ) race where team_number=$8 and team='home'
   )) as race_home_time,
   (select coalesce(seconds,minute*60) from ordered where ordinal=(
     select min(ordinal) from (
       select ordinal,team,count(*) over(partition by team order by ordinal) as team_number
       from ordered where ($20::boolean=false or normal_time)
     ) race where team_number=$8 and team='away'
   )) as race_away_time,
   case when (c.through_minute is null or c.complete=false) and $16::text='zizobet' then (
     select e.provider from app_match_event_coverage e
     where e.match_id=$1 and e.kind=$2 and e.complete=true and e.confirmed_at is not null
       and e.provider in ('fotmob','apifootball','sportapi','goalapi','bsd','worldcup26')
     order by case e.provider when 'fotmob' then 1 when 'apifootball' then 2 when 'sportapi' then 3 when 'goalapi' then 4 when 'bsd' then 5 when 'worldcup26' then 6 else 9 end
     limit 1
   ) else null end as fallback_provider
 from aggregate a left join covered c on true`,
 [line.match_id,c.event,
  c.kind==='interval-result'?c.fromSeconds/60:c.from??null,
  c.kind==='interval-result'?(c.toExclusiveSeconds-1)/60:c.to??null,
  c.side??null,c.playerId??null,c.playerName??null,c.target??1,line.id,
  c.kind==='window'&&c.startExclusive===true,
  (c.kind==='interval-result'||(c.kind==='window-total'&&Number.isSafeInteger(c.fromSeconds)))?c.fromSeconds:c.kind==='window'?c.from*60:null,
  (c.kind==='interval-result'||(c.kind==='window-total'&&Number.isSafeInteger(c.toExclusiveSeconds)))?c.toExclusiveSeconds:c.kind==='window'?c.to*60:null,
  c.kind==='interval-result',c.kind==='interval-leader',c.cardColor??null,provider,
  c.entryBaseline!=null,c.entryBaseline?.home??0,c.entryBaseline?.away??0,normalTimeOnly,
  c.kind==='window-total'&&Number.isSafeInteger(c.fromSeconds)&&Number.isSafeInteger(c.toExclusiveSeconds)]);
 const data=rows[0];
 if(provider==='zizobet'&&(data?.through_minute==null||(data?.complete===false&&result!=null))&&
    data?.fallback_provider&&HISTORICAL_GOAL_PROVIDERS.has(data.fallback_provider)){
  return gradeSingleEventProvider(line,result,{execute,provider:data.fallback_provider});
 }
 if(!data||data.through_minute==null||data.open_recovery_gap===true)return null;
 // A partial/corrected frame must not silently reclassify a missing event.
 if(Number(data.home)!==Number(data.count_home)||
    Number(data.away)!==Number(data.count_away))return null;
 // After provider corrections, the accepted counters cannot exceed the
 // present complete chronology. Hold the ticket for review if they do.
 if(c.entryBaseline!=null&&(
    !Number.isSafeInteger(c.entryBaseline.home)||c.entryBaseline.home<0||
    !Number.isSafeInteger(c.entryBaseline.away)||c.entryBaseline.away<0||
    c.entryBaseline.home>Number(data.count_home)||
    c.entryBaseline.away>Number(data.count_away)))return null;
 const stats=typeof result?.statistics==='string'?(()=>{
  try{return JSON.parse(result.statistics);}catch{return null;}
 })():result?.statistics;
 const totalFor=kind=>kind==='goal'?[result?.home_score,result?.away_score]:
   kind==='corner'?[result?.corners_home,result?.corners_away]:
   kind==='card'?[result?.cards_home,result?.cards_away]:
   kind==='foul'?[stats?.fouls?.home,stats?.fouls?.away]:
   kind==='offside'?[stats?.offsides?.home,stats?.offsides?.away]:[null,null];
 const expectedTotals=totalFor(c.event);
 const finalCounts=expectedTotals.every(x=>x!=null&&Number.isSafeInteger(Number(x))&&Number(x)>=0);
 const full=!!(result&&data.complete===true&&finalCounts&&
   Number(data.home)===Number(expectedTotals[0])&&Number(data.away)===Number(expectedTotals[1]));
 const matchFinished=!!(result&&data.complete===true);
 const normalFull=normalTimeOnly?matchFinished:full;
 // Only the confirmed Zizobet timeline and its own second-poll/archive
 // cursor can authorize a settlement decision.
 if(data.confirmed_at==null||data.observed_at==null)return null;
 const confirmed=new Date(data.confirmed_at).getTime();
 const stored=new Date(data.observed_at).getTime();
 if(![confirmed,stored].every(Number.isFinite)||confirmed>stored)return null;
 // The cursor and archive timestamps describe the whole match, while
 // app_match_event_coverage.confirmed_at is the per-kind proof for this
 // contract. A later corner/card/goal sample must not invalidate an already
 // confirmed kind whose own coverage is complete and reconciled.
 // Historical providers are verified at write time but lack a live cursor.
 // A final-score mismatch (Zizobet total differs from historical count) is a
 // hard conflict: never issue a verdict from a provider whose totals disagree.
 if(provider!=='zizobet'&&!full)return null;
 if(c.cardColor!=null&&
   (c.event!=='card'||!['yellow','red'].includes(c.cardColor)||
    data.card_colors_verified!==true))return null;
 const through=Number(data.through_minute);
 const decision=truth=>truth?'WON':'LOST';
 // Half-time is a valid end of the FIRST-HALF event scope, but only once
 // a separately confirmed Zizobet HT score exists AND the chronological
 // coverage has been reconfirmed by another primary poll at/after that HT.
 // The entire match is still unfinished: 2H/FT contracts remain untouched.
 let firstHalfComplete=false,confirmedHalf=null;
 if(!full&&provider==='zizobet'&&c.half===1&&Number.isFinite(through)&&through>=45){
  const ht=(await execute(
   "select h.confirmed_at,h.half_home_score,h.half_away_score from app_match_half_result h where h.match_id=$1 and h.source='ZIZOBET' and h.confirmed_at is not null and exists(select 1 from app_match_snapshot s where s.match_id=h.match_id and s.snapshot->'raw'->>'provider'='ZIZOBET' and s.snapshot->'periods_score'->0->>'t1'=h.half_home_score::text and s.snapshot->'periods_score'->0->>'t2'=h.half_away_score::text)",
   [line.match_id])).rows[0];
  const at=ht?.confirmed_at==null?NaN:new Date(ht.confirmed_at).getTime();
  firstHalfComplete=Number.isFinite(at)&&stored>=at;
  if(firstHalfComplete&&ht?.half_home_score!=null&&ht?.half_away_score!=null){
   confirmedHalf={hh:Number(ht.half_home_score),ha:Number(ht.half_away_score)};
  }
 }
 const completedScope=full||firstHalfComplete;
 if(c.kind==='score-handicap'&&c.event==='corner'&&c.half){
  if(!completedScope)return null;
  const {rows:facts}=await execute(`select minute,seconds,team,phase
    from app_match_event_fact where match_id=$1 and provider=$2
      and kind='corner' and active=true`,[line.match_id,provider]);
  return gradeHalfCornerHandicapFacts(c,facts,{complete:true});
 }
 if(c.kind==='corner-comparison'){
  if(!full||c.event!=='corner')return null;
  const {rows:facts}=await execute(`select minute,seconds,team,phase
    from app_match_event_fact where match_id=$1 and provider=$2
      and kind='corner' and active=true`,[line.match_id,provider]);
  return gradeCornerComparisonFacts(c,facts,{complete:true});
 }
 if(c.kind==='multi-corners'){
  if(!full||c.event!=='corner')return null;
  const {rows:facts}=await execute(`select minute,seconds,team,phase
    from app_match_event_fact where match_id=$1 and provider=$2
      and kind='corner' and active=true`,[line.match_id,provider]);
  return gradeMultiCornerFacts(c,facts,{complete:true});
 }
 if(c.kind==='half-parity'){
  if(!completedScope||c.event!=='corner')return null;
  const {rows:facts}=await execute(`select minute,seconds,team,phase
    from app_match_event_fact where match_id=$1 and provider=$2
      and kind='corner' and active=true`,[line.match_id,provider]);
  return gradeHalfParityFacts(c,facts,{complete:true});
 }
 if(c.kind==='half-exact-count'){
  if(!completedScope||!['corner','card'].includes(c.event))return null;
  const {rows:facts}=await execute(`select minute,seconds,team,phase,card_color
    from app_match_event_fact
    where match_id=$1 and provider=$2 and kind=$3 and active=true`,
    [line.match_id,provider,c.event]);
  return gradeHalfExactFacts(c,facts,{complete:true,
    cardColorsVerified:data.card_colors_verified===true});
 }
 if(c.kind==='half-total'){
  if(!completedScope||!['corner','card'].includes(c.event))return null;
  const {rows:facts}=await execute(`select minute,seconds,team,phase,card_color
    from app_match_event_fact
    where match_id=$1 and provider=$2 and kind=$3 and active=true`,
    [line.match_id,provider,c.event]);
  return gradeHalfTotalFacts(c,facts,{complete:true,
    cardColorsVerified:data.card_colors_verified===true});
 }
 if(['half-first-event','half-last-event','half-race','half-next-event','half-sequence'].includes(c.kind)){
  if(!completedScope||!['goal','corner','card'].includes(c.event))return null;
  const events=(await execute(`select minute,seconds,team,phase
    from app_match_event_fact where match_id=$1 and provider=$2
      and kind=$3 and active=true`,[line.match_id,provider,c.event])).rows;
  // Historical 1H first-corner contracts preserve their existing
  // proven three-way "None" settlement semantics.
  if(c.kind==='half-first-event'&&c.event==='corner'&&c.half===1&&
     c.noneOffered===undefined)
    return gradeFirstHalfCornerFacts(c,events,{complete:true});
  const halfScore=c.event==='goal'?(
   result?.home_score!=null&&result?.away_score!=null&&
   result?.half_home_score!=null&&result?.half_away_score!=null
    ?{hh:Number(result.half_home_score),ha:Number(result.half_away_score),
      fh:Number(result.home_score),fa:Number(result.away_score)}
    :confirmedHalf
  ):null;
  return gradeHalfEventFacts(c,events,{complete:true,halfScore});
 }
 if(c.kind==='lead-up'){
  const base=c.entryBaseline??c.baseline;
  if(c.event!=='goal'||!Number.isInteger(c.target)||c.target<1||
     !base||!Number.isSafeInteger(base.home)||!Number.isSafeInteger(base.away)||
     base.home<0||base.away<0||!['home','away','draw'].includes(c.side))return null;
  const nh=Number(data.normal_home),na=Number(data.normal_away);
  if(!Number.isSafeInteger(nh)||!Number.isSafeInteger(na)||nh<base.home||na<base.away)return null;
  if(c.side==='draw')return normalFull&&data.phase_ambiguous!==true?decision(nh===na):null;
  const afterHome=nh-base.home,afterAway=na-base.away;
  const currentLead=c.side==='home'?afterHome-afterAway:afterAway-afterHome;
  if(currentLead>=c.target)return 'WON';
  const maximum=Number(c.side==='home'?data.max_home_lead_since_entry:data.max_away_lead_since_entry);
  if(Number.isFinite(maximum)&&maximum>=c.target){
   if(data.ambiguous_order_since_entry===true)return null;
   return 'WON';
  }
  if(!normalFull||data.phase_ambiguous===true||data.ambiguous_order_since_entry===true)return null;
  return 'LOST';
 }
 if(c.kind==='window-first-event'){
  const closesAt=Math.floor(Number(c.to))+1;
  if(!Number.isFinite(closesAt)||!['home','away','none'].includes(c.side))return null;
  if(data.window_first_team!=null){
   if(Number(data.window_first_same_time)>1)return null;
   return c.side==='none'?'LOST':data.window_first_team===c.side?'WON':'LOST';
  }
  if(normalTimeOnly&&c.to>=90&&data.phase_ambiguous===true)return null;
  return normalFull||through>=closesAt?(c.side==='none'?'WON':'LOST'):null;
 }
 if(c.kind==='window-parity'){
  const closesAt=Math.floor(Number(c.to))+1;
  if(c.event!=='corner'||!['odd','even'].includes(c.choice)||
     !Number.isInteger(c.from)||!Number.isInteger(c.to)||c.from<0||c.to<c.from)return null;
  if(!normalFull&&through<closesAt)return null;
  if(normalTimeOnly&&c.to>=90&&data.phase_ambiguous===true)return null;
  const found=Number(data.window_count);
  if(!Number.isSafeInteger(found)||found<0)return null;
  return (found%2===1?'odd':'even')===c.choice?'WON':'LOST';
 }
 if(c.kind==='interval-handicap'){
  const closesAt=Math.floor(Number(c.to))+1;
  if(c.event!=='corner'||!Number.isFinite(c.handicap)||
     !['home','away','none'].includes(c.side)||!Number.isFinite(closesAt)||
     (!normalFull&&through<closesAt))return null;
  if(normalTimeOnly&&c.to>=90&&data.phase_ambiguous===true)return null;
  const h=Number(data.window_home),a=Number(data.window_away);
  if(!Number.isSafeInteger(h)||!Number.isSafeInteger(a))return null;
  const signed=c.side==='home'?h+c.handicap-a:a+c.handicap-h;
  if(c.threeWay===true){
   if(c.side==='none')return signed===0?'WON':'LOST';
   return c.side==='home'?decision(signed>0):decision(signed<0);
  }
  if(signed===0)return 'VOID';
  return c.side==='home'?decision(signed>0):decision(signed<0);
 }
 if(c.kind==='team-nth-time'){
  if(!Number.isInteger(c.target)||c.target<1||!['home','away'].includes(c.side)||
     !Number.isInteger(c.from)||!Number.isInteger(c.to))return null;
  if(data.team_nth_minute!=null){
   if(Number(data.team_nth_same_time)>1)return null;
   const minute=Number(data.team_nth_minute),inside=minute>=c.from&&minute<=c.to;
   return c.choice==='none'?decision(!inside):decision(inside);
  }
  if(normalFull||through>c.to){
   if(normalTimeOnly&&c.to>=90&&data.phase_ambiguous===true)return null;
   return c.choice==='none'?'WON':'LOST';
  }
  return null;
 }
 const scopeEnded=full||(Number.isFinite(c.to)&&through>Number(c.to));
 const count=Number(c.cardColor?(c.side==='home'?data.color_home:c.side==='away'?data.color_away:data.color_total):
   (c.side==='home'?data.home:c.side==='away'?data.away:data.total));
 const expected=Number(c.target??c.threshold);
 if(c.kind==='window'){
  // A proven event decides YES immediately and NO as lost; a verified
  // absence cannot win until the full quoted time window is complete.
  const closesAt=c.startExclusive===true?Number(c.to):Math.floor(Number(c.to))+1;
  if(!Number.isFinite(closesAt)||typeof c.choice!=='boolean')return null;
  // A rolling exact-second market cannot be judged from minute-only boundary
  // incidents. Hold for the provider's precise timestamp.
  if(c.startExclusive===true&&data.rolling_boundary_uncertain===true)return null;
  const num=Number(c.cardColor?data.color_window_count:data.window_count);
  if(num>0)return decision(c.choice);
  if(normalTimeOnly&&c.to>=90&&data.phase_ambiguous===true)return null;
  return normalFull||through>=closesAt?decision(!c.choice):null;
 }
 if(c.kind==='interval-result'){
  if(!Number.isSafeInteger(c.toExclusiveSeconds)||(!normalFull&&through*60<c.toExclusiveSeconds)||
     normalTimeOnly&&c.to>=90&&data.phase_ambiguous===true)return null;
  const h=Number(data.window_home),a=Number(data.window_away);
  return decision((h>a?'home':a>h?'away':'none')===c.side);
 }
 if(c.kind==='interval-leader'){
  const closesAt=Math.floor(Number(c.to))+1;
  if(!Number.isFinite(closesAt)||(!normalFull&&through<closesAt)||
     !['home','away','none'].includes(c.side)||
     normalTimeOnly&&c.to>=90&&data.phase_ambiguous===true)return null;
  const h=Number(data.window_home),a=Number(data.window_away);
  return decision((h>a?'home':a>h?'away':'none')===c.side);
 }
 if(c.kind==='window-total'){
  const hasClockBounds=Number.isSafeInteger(c.fromSeconds)&&Number.isSafeInteger(c.toExclusiveSeconds);
  const closesAt=hasClockBounds?c.toExclusiveSeconds/60:Math.floor(Number(c.to))+1;
  if(!Number.isFinite(closesAt))return null;
  if(hasClockBounds&&data.clock_boundary_uncertain===true)return null;
  const found=Number(c.cardColor?data.color_window_count:data.window_count);
  const closed=normalFull||through>=closesAt;
  if(normalTimeOnly&&c.to>=90&&data.phase_ambiguous===true)return null;
  if(c.choice==='over'||c.choice==='under'){
   if(!Number.isFinite(c.threshold)||!Number.isInteger(c.threshold*2))return null;
   // Once the accepted-event count crosses the line it can only increase.
   // Over is already WON; Under is already LOST.
   if(found>c.threshold)return c.choice==='over'?'WON':'LOST';
   if(!closed)return null;
   if(found===c.threshold&&Number.isInteger(c.threshold))return 'VOID';
   return c.choice==='over'?'LOST':'WON';
  }
  if(c.choice==='exact'&&Number.isInteger(c.target)){
   if(found>c.target)return 'LOST';
   return closed?decision(found===c.target):null;
  }
  if(c.choice==='atLeast'&&Number.isInteger(c.target)){
   if(found>=c.target)return 'WON';
   return closed?'LOST':null;
  }
  return null;
 }
 if(c.kind==='nth-time'){
  if(!Number.isInteger(c.target)||c.target<1)return null;
  const isPrematch = (line?.accepted_contract?.acceptedLiveSnapshot == null && c.entryBaseline == null && line?.accepted_contract != null);
  if(isPrematch && !normalFull) return null;
  if(data.nth_team!=null){
   if(Number(data.nth_same_time)>1)return null;
   // A fixed "Who scores goal N in minutes A-B" three-way quote uses
   // Neither when goal N is outside THAT window. General goal-N time
   // markets without a window still mean "no Nth goal before FT".
   if(c.choice==='none'&&Number.isInteger(c.from)&&Number.isInteger(c.to))
    return decision(!(Number(data.nth_minute)>=c.from&&Number(data.nth_minute)<=c.to));
   if(c.choice==='none')return 'LOST';
   if(!Number.isInteger(c.from)||!Number.isInteger(c.to))return null;
   const inside=Number(data.nth_minute)>=c.from&&Number(data.nth_minute)<=c.to;
   if(c.choice==='team-window')
     return ['home','away'].includes(c.side)?decision(inside&&data.nth_team===c.side):null;
   if(c.choice!=='range')return null;
   return decision(inside);
  }
  // No positive evidence yet — wait for coverage window to elapse before
  // declaring LOST (goal N did not happen within range).
  const scopeClosed=normalFull||(Number.isInteger(c.to)&&through>c.to);
  if(!scopeClosed||normalTimeOnly&&c.to>=90&&data.phase_ambiguous===true)return null;
  return c.choice==='none'?'WON':'LOST';
 }
 if(c.kind==='last-event'){
  if(!normalFull||data.phase_ambiguous===true||!['home','away','none'].includes(c.side))return null;
  const lastTeam=normalTimeOnly?data.normal_last_team:data.last_team;
  const lastSameTime=normalTimeOnly?data.normal_last_same_time:data.last_same_time;
  if(lastTeam!=null){
   if(Number(lastSameTime)>1)return null;
   return decision(lastTeam===c.side);
  }
  return c.noneOffered===true?(c.side==='none'?'WON':'LOST'):'VOID';
 }
 if(c.kind==='sequence'){
  if(data.nth_team!=null){
   if(Number(data.nth_same_time)>1)return null;
   return decision(data.nth_team===c.side);
  }
  if(!normalFull||data.phase_ambiguous===true)return null;
  if(c.event==='goal')return c.noneOffered===true&&c.side==='none'?'WON':'LOST';
  return c.noneOffered===true?(c.side==='none'?'WON':'LOST'):'VOID';
 }
 if(c.kind==='race'){
  if(!Number.isInteger(c.target)||c.target<1||
     !['home','away','none'].includes(c.side))return null;
  // At full time, provider counters settle an unambiguous race even if a
  // late 90+ incident is missing from Zizobet's timeline. This is valid only
  // when exactly one side reached the threshold: with both sides at/above it,
  // the chronological winner remains pending for the reconciled timeline.
  if(result&&c.event==='corner'&&
     Number.isSafeInteger(Number(result?.corners_home))&&
     Number.isSafeInteger(Number(result?.corners_away))){
   const homeCorners=Number(result.corners_home),awayCorners=Number(result.corners_away);
   const homeReached=homeCorners>=c.target,awayReached=awayCorners>=c.target;
   if(homeReached!==awayReached){
    const winner=homeReached?'home':'away';
    if(c.side==='none')return 'LOST';
    return decision(c.side===winner);
   }
   if(!homeReached&&!awayReached){
    if(c.side==='none')return c.noneOffered===true?'WON':'LOST';
    return c.noneOffered===true?'LOST':'VOID';
   }
  }
  const h=data.race_home_time==null?null:Number(data.race_home_time);
  const a=data.race_away_time==null?null:Number(data.race_away_time);
  // The quoted third selection is a real outcome, not a refundable push:
  // neither side reached X => None wins after confirmed FT completeness.
  // A reached threshold proves None lost without knowing which side was first.
  if(c.side==='none'){
   if(h!==null||a!==null)return 'LOST';
   return normalFull&&data.phase_ambiguous!==true&&c.noneOffered===true?'WON':null;
  }
  if(h===null&&a===null)return normalFull&&data.phase_ambiguous!==true?(c.noneOffered===true?'LOST':'VOID'):null;
  // Simultaneous or minute-only indistinguishable milestones require review.
  if(h!==null&&a!==null&&h===a)return null;
  return decision(c.side===(h!==null&&(a===null||h<a)?'home':'away'));
 }
 if(c.kind==='player-goal-special'){
  // Proven positive 2+/3+ and already-exceeded totals can settle before FT
  // from reconfirmed primary scorer facts. An UNDER/no/exact that still
  // depends on future events stays PENDING until the relevant scope ends.
  if(c.event!=='goal'||(!full&&provider!=='zizobet'))return null;
  const {rows:facts}=await execute(`select minute,seconds,team,phase,player_id,
    player_name,aiscore_player_id,aiscore_player_name,aiscore_verified,
    fotmob_player_name,fotmob_verified,supplemental_player_name,
    supplemental_verified,own_goal
    from app_match_event_fact where match_id=$1 and provider=$2
      and kind='goal' and active=true`,[line.match_id,provider]);
  return gradePlayerGoalSpecial(c,facts,{complete:full});
 }
 if(c.kind==='player-ordinal-goal'){
  // FIRST scorer becomes irreversible when the verified first eligible
  // scorer is known. LAST scorer and "none won" still require FT.
  if(c.event!=='goal'||(!full&&(provider!=='zizobet'||c.position!=='first')))return null;
  const {rows:facts}=await execute(`select minute,seconds,team,player_id,
    player_name,aiscore_player_id,aiscore_player_name,aiscore_verified,
    fotmob_player_name,fotmob_verified,supplemental_player_name,
    supplemental_verified,own_goal
    from app_match_event_fact where match_id=$1 and provider=$2
      and kind='goal' and active=true`,[line.match_id,provider]);
  const result=gradePlayerOrdinalScorerFacts(c,facts,{complete:true});
  if(!full)return c.choice==='none'?(result==='LOST'?'LOST':null):
    result==='WON'?'WON':null;
  return result;
 }
 if(c.kind==='player-card'){
  if(typeof c.choice!=='boolean'||(!c.playerName&&!c.playerId))return null;
  if(c.cardColor&&data.card_colors_verified!==true)return null;
  const person=v=>{
   const raw=String(v??'').trim();
   const pieces=raw.includes(',')?raw.split(',').map(x=>x.trim()).reverse():[raw];
   return pieces.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
     .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  };
  const expected=person(c.playerName);
  const {rows:actors}=await execute(
    "select player_id,player_name,card_color,supplemental_player_name,supplemental_verified from app_match_event_fact "+
    "where match_id=$1 and provider=$2 and kind='card' and active=true",
    [line.match_id,provider]);
  const booked=actors.some(actor=>
    (!c.cardColor||actor.card_color===c.cardColor)&&
    (c.playerId!=null&&actor.player_id!=null?
      String(c.playerId)===String(actor.player_id):
      !!expected&&(person(actor.player_name)===expected||
       actor.supplemental_verified===true&&person(actor.supplemental_player_name)===expected)));
  if(booked)return c.choice?'WON':'LOST';
  // Absent bookings do not prove that the named player entered the pitch.
  // The non-participation/void rule still needs verified lineup facts.
  return null;
 }
 if(c.kind==='player-goal'){
  if((!c.playerName&&!c.playerId)||typeof c.choice!=='boolean')return null;
  // A verified scorer proves YES/NO immediately; absence does not prove
  // participation, an own goal, or a losing player proposition.
  if(Number(data.player_goals)>0)return c.choice?'WON':'LOST';
  // A missing scorer name does not prove a player played or failed to score.
  // Require verified player participation before a negative settlement.
  return null;
 }
 if(c.kind==='team-total-goals'){
  if(!Number.isFinite(c.threshold)||!['over','under'].includes(c.choice))return null;
  if(count>c.threshold)return c.choice==='over'?'WON':'LOST';
  if(!full)return null;
  if(count===c.threshold&&Number.isInteger(c.threshold))return 'VOID';
  return c.choice==='under'?'WON':'LOST';
 }
 if(c.kind==='over'||c.kind==='under'){
  if(!Number.isFinite(expected))return null;
  if(count>expected)return c.kind==='over'?'WON':'LOST';
  if(!full)return null;
  if(count===expected&&Number.isInteger(expected))return 'VOID';
  return c.kind==='under'?'WON':'LOST';
 }
 if(c.kind==='atLeast'){
  if(!Number.isInteger(c.target))return null;
  if(count>=c.target)return 'WON';
  return full?'LOST':null;
 }
 if(c.kind==='exact'){
  if(!Number.isInteger(c.target))return null;
  if(count>c.target)return 'LOST';
  return full?decision(count===c.target):null;
 }
 if(c.kind==='range'&&Number.isFinite(c.min)&&Number.isFinite(c.max)){
  if(count>c.max)return 'LOST';
  return full?decision(count>=c.min&&count<=c.max):null;
 }
 return null;
}

function freezeRelativeNextGoal(line){
 const title=String(line?.market_name??line?.accepted_contract?.providerMarketName??'')
  .split(' · ')[0].toLowerCase().replace(/\s+/g,' ').trim();
 if(!/^(?:next goal|next team to score|goli i radh[eë]s)$/.test(title))return line;
 const contract=line?.live_contract;
 if(!contract||!['sequence','nth-time'].includes(contract.kind)||contract.event!=='goal')return line;
 const snapshot=line?.accepted_contract?.acceptedLiveSnapshot;
 const whole=value=>value!=null&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
 const home=whole(snapshot?.scoreHome??snapshot?.counters?.goal?.home);
 const away=whole(snapshot?.scoreAway??snapshot?.counters?.goal?.away);
 if(home===null||away===null)return line;
 const target=home+away+1;
 if(contract.target===target)return line;
 return {...line,live_contract:{...contract,target}};
}

/** Keep historical incidents in their own provider rows. A verified primary
 * decision wins; a complete historical FT may fill a genuinely missing
 * primary timeline. Conflicting historical verdicts are never paid.
 */
export async function gradeStoredEventContract(line,result,{execute}={}){
 line=freezeRelativeNextGoal(line);
 const market=String(line?.market_name??'').trim();
 if(/^full[\s.-]*time[\s:.-]*(?:1up|2up|3up)$/i.test(market)){
  const home=Number(result?.home_score),away=Number(result?.away_score);
  if(!Number.isSafeInteger(home)||home<0||!Number.isSafeInteger(away)||away<0)return null;
  const pick=String(line?.outcome_name??line?.outcome_key??'').trim().toLowerCase();
  const homeName=String(result?.home_team??line?.home_team??'').trim().toLowerCase();
  const awayName=String(result?.away_team??line?.away_team??'').trim().toLowerCase();
  const side=/^(?:1|home|home team)$/.test(pick)||!!homeName&&pick===homeName?'home':
   /^(?:x|draw|tie)$/.test(pick)?'draw':
   /^(?:2|away|away team)$/.test(pick)||!!awayName&&pick===awayName?'away':null;
  if(!side)return null;
  return side==='home'?(home>away?'WON':'LOST'):
   side==='away'?(away>home?'WON':'LOST'):(home===away?'WON':'LOST');
 }
 if(line?.live_contract?.kind==='half-combo')
  return gradeHalfCombination(line.live_contract,result);
 if(line?.live_contract?.kind==='period-goal-total')
  return gradePeriodGoalTotal(line.live_contract,result);
 if(line?.live_contract?.kind==='score-handicap'&&
    !(line.live_contract.event==='corner'&&line.live_contract.half))
  return gradeHandicapContract(line.live_contract,result);
 return gradeSingleEventProvider(line,result,{execute,provider:'zizobet'});
}
