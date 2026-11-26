import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {providerTimeline} from '../server/live-event-timeline.mjs';
import {parseHalfTotal} from '../server/ledger/live-contract-rules.mjs';
import {parseParityMarket} from '../server/ledger/parity-markets.mjs';
import {parseHalfExactMarket} from '../server/ledger/half-exact-markets.mjs';
import {parseCornerComparison} from '../server/ledger/corner-comparisons.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';

const frame=(corners,events)=>normalizeLiveFrame({
 Match:{Score:'0:0',MatchTimeExtended:'35:00',CornersTeam1:corners,
  CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
  RedCardsTeam1:0,RedCardsTeam2:0,EventStatus:6},
 TimeLines:events
});
// Zizobet may expose stoppage time as gt=90 plus a precise clk=94:06,
// or provide both minute=90 and gt=90+4. Both forms must survive Admin
// projection and become a 94th-minute second-half event in the fact store.
const lateCorner={id:'corner-90-plus-4',type:'corner_kick',team:1,
 gt:'90',minute:90,clk:'94:06',isTaken:true};
const lateProjection=providerTimeline(7199001,[lateCorner])[0];
assert.deepEqual(
 {minute:lateProjection.minute,addedMinute:lateProjection.addedMinute,minuteLabel:lateProjection.minuteLabel},
 {minute:90,addedMinute:4,minuteLabel:'90+4'},
 'Admin chronology keeps the provider 90+4 incident label'
);
const lateNormalized=normalizeLiveFrame({
 Match:{Score:'3:1',MatchTimeExtended:'94:06',CornersTeam1:1,CornersTeam2:0,EventStatus:40},
 TimeLines:[lateCorner]
}).events[0];
assert.equal(lateNormalized.minute,94,'The event fact uses absolute minute 94');
assert.equal(lateNormalized.seconds,94*60+6,'The event fact retains exact 94:06 clock');
assert.equal(lateNormalized.phase,'2nd half','Stoppage event remains in normal second-half scope');
const explicitLate=providerTimeline(7199001,[{...lateCorner,gt:'90+4'}])[0];
assert.equal(explicitLate.minuteLabel,'90+4',
 'An explicit gt=90+4 takes precedence over a numeric minute=90');
const awarded={id:'awarded',type:'corner_kick',team:1,gt:12,clk:'12:05',status:'awarded'};
const notTaken={id:'never-taken',type:'corner_kick',team:1,gt:13,clk:'13:05',isTaken:false};
const taken={id:'taken',type:'corner_kick',team:1,gt:14,clk:'14:05',isTaken:true};
const valid=frame(1,[awarded,notTaken,taken]);
assert.equal(valid.events.filter(e=>e.type==='corner').length,1,
 'An awarded or explicitly unexecuted corner does not count');
assert.equal(valid.coverage.cornerThrough,35,'Only the taken corner reconciles with provider tally');
const conflicting=frame(3,[awarded,notTaken,taken]);
assert.equal(conflicting.coverage.cornerThrough,undefined,
 'Conflicting corner count is not proof of a correct timeline');

const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const run=(sql,params=[])=>db.query(sql,params);
 const matchId=7199981,now=new Date();
 for(const [id,team,minute,seconds] of [
  ['kick-1','home',10,605],['kick-2','away',15,905],
  ['kick-3','home',23,1405]
 ]){
  await run(`insert into app_match_event_fact
    (match_id,provider,provider_event_id,kind,team,minute,seconds,active)
    values($1,'zizobet',$2,'corner',$3,$4,$5,true)`,
   [matchId,id,team,minute,seconds]);
 }
 await run(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'zizobet','corner',91,2,1,true,$2,$2)`,
  [matchId,now]);
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',
  [matchId,now]);
 const result={home_score:0,away_score:0};
 const contract=(kind,rest)=>({
  id:'00000000-0000-4000-8000-000000000001',
  match_id:matchId,live_contract:{version:1,kind,event:'corner',...rest}
 });
 const judge=(kind,rest,final=result)=>gradeStoredEventContract(
  contract(kind,rest),final,{execute:run});

 const officialCorners={
  source:'ZIZOBET',home_score:1,away_score:0,corners_home:10,corners_away:3,
  statistics:{cornerPeriods:{
   source:'ZIZOBET',
   firstHalf:{home:4,away:2},
   secondHalf:{home:6,away:1},
   fullTime:{home:10,away:3}
  }}
 };
 const noTimeline=async()=>{throw new Error('Official HT/FT corners should not require a reconstructed timeline');};
 const gradeOfficial=live_contract=>gradeStoredEventContract({
  id:'00000000-0000-4000-8000-000000000004',match_id:matchId,
  market_name:'Official period corner test',outcome_name:'test',live_contract
 },officialCorners,{execute:noTimeline});
 const firstHalfOver=parseHalfTotal({
  market_name:'1st half - Total corners',outcome_name:'Over',line:'5.5'
 });
 const firstHalfUnder=parseHalfTotal({
  market_name:'1st half - Total corners',outcome_name:'Under',line:'5.5'
 });
 const secondHalfOver=parseHalfTotal({
  market_name:'2nd half - Total corners',outcome_name:'Over',line:'6.5'
 });
 const secondHalfAway=parseHalfTotal({
  market_name:'2nd half - Away team total corners',outcome_name:'Over',line:'0.5'
 });
 assert.equal(await gradeOfficial(firstHalfOver),'WON',
  'HT 4-2 proves six first-half corners, Over 5.5');
 assert.equal(await gradeOfficial(firstHalfUnder),'LOST');
 assert.equal(await gradeOfficial(secondHalfOver),'WON',
  'FT 10-3 minus HT 4-2 proves seven second-half corners');
 assert.equal(await gradeOfficial(secondHalfAway),'WON',
  'Second-half away corners are exactly 3-2=1, not the full-time total');
 const exactSix=parseHalfExactMarket({
  market_name:'1st half - Exact corners',outcome_name:'6'
 });
 const exactFive=parseHalfExactMarket({
  market_name:'1st half - Exact corners',outcome_name:'5'
 });
 assert.equal(await gradeOfficial(exactSix),'WON');
 assert.equal(await gradeOfficial(exactFive),'LOST');
 const halfOdd=parseParityMarket({
  market_name:'2nd half - Corners odd/even',outcome_name:'Odd'
 });
 assert.equal(halfOdd?.kind,'half-parity');
 assert.equal(await gradeOfficial(halfOdd),'WON',
  'Seven second-half corners makes the second-half parity Odd');
 const halfResult=parseCornerComparison({
  market_name:'1st half corners result',outcome_name:'1'
 });
 assert.equal(await gradeOfficial(halfResult),'WON');
 const mostHalf=parseCornerComparison({
  market_name:'Half with most corners',outcome_name:'2'
 });
 assert.equal(await gradeOfficial(mostHalf),'WON',
  'Second half total 7 exceeds first half total 6');
 const winsBoth=parseCornerComparison({
  market_name:'Most corners in both halves',outcome_name:'1'
 });
 assert.equal(await gradeOfficial(winsBoth),'WON',
  'Chelsea won the corner count in both halves');
 const halfHandicap={version:1,kind:'score-handicap',event:'corner',half:2,
  side:'home',handicap:-4.5,threeWay:false,rest:false};
 assert.equal(await gradeOfficial(halfHandicap),'WON',
  '2H corner handicap uses the verified 6-1 interval totals');
 const inconsistent={...officialCorners,statistics:{cornerPeriods:{
  source:'ZIZOBET',firstHalf:{home:4,away:2},secondHalf:{home:5,away:1},
  fullTime:{home:10,away:3}
 }}};
 assert.equal(await gradeStoredEventContract({match_id:matchId,live_contract:firstHalfOver},
  inconsistent,{execute:noTimeline}),null,
  'Inconsistent HT plus 2H counts must stay pending');
 const wrongSource={...officialCorners,source:'ADMIN'};
 assert.equal(await gradeStoredEventContract({match_id:matchId,live_contract:firstHalfOver},
  wrongSource,{execute:run}),null,
  'Only official Zizobet corner period facts may settle automatically');

 assert.equal(await judge('race',{target:2,side:'home'}),'WON');
 assert.equal(await judge('race',{target:2,side:'away'}),'LOST');
 assert.equal(await judge('race',{target:4,side:'home'}),'VOID',
  'Unreached two-choice Race to X refunds at verified normal conclusion');
 assert.equal(await judge('race',{target:9,side:'home'},officialCorners),'WON',
  'A final corner counter with only Home reaching 9 proves the race winner despite late timeline gaps');
 assert.equal(await judge('race',{target:9,side:'away'},officialCorners),'LOST',
  'Away is not a race winner when Home is the only side reaching 9');
 assert.equal(await judge('window',{from:20,to:30,choice:true}),'WON');
 assert.equal(await judge('window',{from:20,to:30,choice:false}),'LOST');
 assert.equal(await judge('interval-leader',{from:20,to:30,side:'home'}),'WON');
 assert.equal(await judge('interval-leader',{from:20,to:30,side:'away'}),'LOST');
 assert.equal(await judge('window-total',{from:20,to:30,choice:'over',threshold:1}),'VOID');
 assert.equal(await judge('window-total',{from:20,to:30,choice:'exact',target:1}),'WON');
 assert.equal(await judge('window-total',{from:20,to:30,choice:'atLeast',target:2}),'LOST');

 // Offside is not a persisted match-event-fact kind in this ledger.
 // The Zizobet normalizer may display offside data, but it must not be inserted
 // into the goal/corner/card/foul financial fact table.



 // The quoted English ordinal survives acceptance and is the authority for
 // the PostgreSQL event ordinal, not the display translation or live score.
 const at=now.getTime();
 const base={service:'LIVE',home:'Arsenal',away:'Chelsea',home_score:0,away_score:0,
  match_time_ms:5*60000,score_at:now,clock_at:now};
 const first=frozenLiveContract({market_name:'Next Goal 1st',outcome_name:'1'},base,at);
 const second=frozenLiveContract({market_name:'Next Goal 2nd',outcome_name:'2'},base,at);
 assert.equal(first.target,1);assert.equal(second.target,2);
 assert.throws(()=>frozenLiveContract(
  {market_name:'Next Goal 1st',outcome_name:'1'},
  {...base,home_score:1,match_time_ms:20*60000},at),/ndodhur tashmë/,
  'A 1st goal offer cannot be purchased once goal #1 already occurred');
 assert.throws(()=>frozenLiveContract(
  {market_name:'Next Goal 2nd',outcome_name:'2'},
  {...base,home_score:2,match_time_ms:20*60000},at),/ndodhur tashmë/,
  'A 2nd goal offer cannot be reinterpreted as the third next goal');
 assert.equal(frozenLiveContract({market_name:'Next Goal',outcome_name:'2'},
  {...base,home_score:2,match_time_ms:20*60000},at).target,3,
  'Only a genuinely unnumbered Next Goal is relative to the score');

 const user=(await run("insert into app_user(username,password_hash,balance) values('ordinal-sql-test','isolated',1000) returning id")).rows[0].id;
 const ticket=(await run("insert into app_ticket(user_id,stake,total_odds,potential_payout,status,placed_at) values($1,10,5,50,'PENDING',$2) returning id",
  [user,new Date(at-60000)])).rows[0].id;
 const originals=[
  {title:'Next Goal 1st',key:'zz75001@eyJzZXEiOjF9',choice:'1',price:2.1,c:first},
  {title:'Next Goal 2nd',key:'zz75002@eyJzZXEiOjJ9',choice:'2',price:3.2,c:second}
 ];
 const storedLines=[];
 for(const quote of originals){
  const accepted={version:1,providerMarketKey:quote.key,providerMarketName:quote.title,
   providerOutcomeKey:quote.choice,providerOutcomeName:quote.choice,
   line:'',acceptedOdds:quote.price,liveTerms:quote.c};
  const {rows}=await run(`insert into app_ticket_line
   (ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,
    odds_at_placement,live_contract,accepted_contract)
   values($1,$2,$3,'',$4,$4,$5,'Arsenal - Chelsea',$6,$7::jsonb,$8::jsonb) returning *`,
   [ticket,matchId,quote.key,quote.choice,quote.title,quote.price,
    JSON.stringify(quote.c),JSON.stringify(accepted)]);
  storedLines.push(rows[0]);
 }
 assert.deepEqual(storedLines.map(l=>l.market_name),originals.map(q=>q.title));
 assert.deepEqual(storedLines.map(l=>l.live_contract.target),[1,2]);
 assert.deepEqual(storedLines.map(l=>l.accepted_contract.providerMarketKey),
  originals.map(q=>q.key),'Never merge two provider quoted market IDs');
 await run(`insert into app_match_event_fact
  (match_id,provider,provider_event_id,kind,team,minute,seconds,active)
  values ($1,'zizobet','goal-1','goal','home',4,245,true),
         ($1,'zizobet','goal-2','goal','away',22,1335,true)`,[matchId]);
 await run(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'zizobet','goal',91,1,1,true,$2,$2)`,[matchId,now]);
 assert.equal(await gradeStoredEventContract(storedLines[0],null,{execute:run}),'WON',
  'Goal #1 belongs to HOME');
 assert.equal(await gradeStoredEventContract(storedLines[1],null,{execute:run}),'WON',
  'Goal #2 belongs to AWAY, independent from the 1st goal');
 assert.equal(await gradeStoredEventContract(
  {...storedLines[1],live_contract:{...second,side:'home'}},null,{execute:run}),'LOST',
  '2nd goal HOME loses when #2 was scored by AWAY');
 assert.equal(Number((await run('select balance from app_user where id=$1',[user])).rows[0].balance),
  1000,'No wallet movement from reading or grading preserved quote identity');

 await run('update app_match_event_coverage set count_home=3 where match_id=$1 and kind=\'corner\'',[matchId]);
 assert.equal(await judge('race',{target:2,side:'home'}),null,
  'No financial decision when accepted incident facts disagree with source tally');
 // Regulation-time stoppage incidents keep their raw 47/92 minute but map
 // to the closing 45/90 minute bucket for fixed interval settlement.
 const lateMatch=matchId+1;
 await run(`insert into app_match_event_fact
  (match_id,provider,provider_event_id,kind,team,minute,phase,active)
  values($1,'zizobet','goal-89','goal','home',89,'2nd half',true),
        ($1,'zizobet','goal-90-plus-2','goal','home',92,'2nd half',true)`,[lateMatch]);
 await run(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'zizobet','goal',130,2,0,true,$2,$2)`,[lateMatch,now]);
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',[lateMatch,now]);
 const lateResult={home_score:2,away_score:0,corners_home:0,corners_away:0,cards_home:0,cards_away:0};
 const lateLine={id:'00000000-0000-4000-8000-000000000011',match_id:lateMatch,
  live_contract:{version:1,kind:'window',event:'goal',from:76,to:90,choice:true}};
 assert.equal(await gradeStoredEventContract(lateLine,lateResult,{execute:run}),'WON',
  'A verified 90+2 goal is counted in the 76-90 interval');

 const firstHalfLateMatch=lateMatch+1;
 await run(`insert into app_match_event_fact
  (match_id,provider,provider_event_id,kind,team,minute,phase,active)
  values($1,'zizobet','goal-45-plus-2','goal','home',47,'1st half',true)`,[firstHalfLateMatch]);
 await run(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'zizobet','goal',130,1,0,true,$2,$2)`,[firstHalfLateMatch,now]);
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',[firstHalfLateMatch,now]);
 assert.equal(await gradeStoredEventContract({...lateLine,id:'00000000-0000-4000-8000-000000000012',
  match_id:firstHalfLateMatch,live_contract:{version:1,kind:'window',event:'goal',from:31,to:45,choice:true}},
  {...lateResult,home_score:1},{execute:run}),'WON',
  'A verified 45+2 goal is counted in the 31-45 interval');

 const extraTimeMatch=lateMatch+2;
 await run(`insert into app_match_event_fact
  (match_id,provider,provider_event_id,kind,team,minute,phase,active)
  values($1,'zizobet','goal-extra-time','goal','home',92,'Extra Time',true)`,[extraTimeMatch]);
 await run(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'zizobet','goal',130,1,0,true,$2,$2)`,[extraTimeMatch,now]);
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',[extraTimeMatch,now]);
 const phaseProbe=await run(`select phase,
  regexp_replace(lower(coalesce(phase,'')),'[^a-z0-9]','','g') as phase_key,
  (regexp_replace(lower(coalesce(phase,'')),'[^a-z0-9]','','g') in
   ('et','extratime','aet','overtime','extratimefirsthalf','extratimesecondhalf')) as is_explicit_extra_time
  from app_match_event_fact where match_id=$1 and provider_event_id='goal-extra-time'`,[extraTimeMatch]);
 assert.equal(phaseProbe.rows[0].is_explicit_extra_time,true,
  'Extra Time labels are normalized before phase comparison');
 const extraTimeGrade=await gradeStoredEventContract({...lateLine,id:'00000000-0000-4000-8000-000000000013',
  match_id:extraTimeMatch},{...lateResult,home_score:1},{execute:run});
 assert.equal(extraTimeGrade,'LOST','Extra Time at 92 is excluded from the 76-90 interval');

 const unknownPhaseMatch=lateMatch+3;
 await run(`insert into app_match_event_fact
  (match_id,provider,provider_event_id,kind,team,minute,phase,active)
  values($1,'zizobet','goal-unknown-92','goal','home',92,null,true)`,[unknownPhaseMatch]);
 await run(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'zizobet','goal',130,1,0,true,$2,$2)`,[unknownPhaseMatch,now]);
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',[unknownPhaseMatch,now]);
 assert.equal(await gradeStoredEventContract({...lateLine,id:'00000000-0000-4000-8000-000000000014',
  match_id:unknownPhaseMatch},{...lateResult,home_score:1},{execute:run}),null,
  'An unlabelled event after 90 remains pending');
 console.log('PASS real PostgreSQL engine: taken-corner evidence, primary event races/windows/interval totals, stoppage-time and extra-time phase safeguards');
}finally{await db.close();}
