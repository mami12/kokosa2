import assert from 'node:assert/strict';
import {parseEventWindow,parseSequenceBet,parseOrdinalGoalTime,parseLastEvent,parseCountMarket,parseSendingOffMarket,parseLeadUpMarket,liveContract,gradeLiveContract,gradeFromAcceptedCounters} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {eventContract,eventInWindow} from '../server/ledger/event-contract.mjs';

const windowLine=(market,side)=>({market_name:market,outcome_name:side});

// A live "next goal" interval is the next goal AFTER the accepted score,
// not an absolute reference to goal #1.
const nextGoalMarket={market_key:'zz901@e30',market_name:'When will next goal be scored',outcome_name:'31-45'};
assert.equal(parseOrdinalGoalTime(nextGoalMarket,{goal:{home:2,away:0}})?.target,3);
assert.equal(parseOrdinalGoalTime(nextGoalMarket,{goal:{home:0,away:0}})?.target,1);
assert.equal(parseOrdinalGoalTime(nextGoalMarket,{goal:{home:2,away:0}})?.from,31);
assert.equal(parseOrdinalGoalTime({...nextGoalMarket,market_name:'When will goal 3 be scored'},
 {goal:{home:0,away:0}})?.target,3,'explicit provider ordinal remains absolute');
assert.equal(parseOrdinalGoalTime(nextGoalMarket),null,
 'unknown accepted score cannot be guessed as goal number one');
const nextGoalAccepted={market_name:'Next Goal',accepted_contract:{acceptedLiveSnapshot:{
 isLive:true,scoreHome:0,scoreAway:1,counters:{goal:{home:0,away:1}}
}}};
assert.equal(eventContract(nextGoalAccepted).name,'who scores goal 2',
 'Legacy event settlement derives bare Next Goal from the frozen 0:1 acceptance score');
assert.equal(eventContract({market_name:'Next Goal 2nd'}).name,'next goal 2nd',
 'An explicitly numbered offer is not rewritten as a relative offer');
assert.equal(eventContract({market_name:'Next Goal'}).valid,false,
 'Without a frozen baseline or saved target, do not assume Next Goal means goal #1');

const nextHome=parseOrdinalGoalTime({market_name:'Next Home Goal Time',outcome_name:'31-45'},
 {goal:{home:2,away:1}});
assert.deepEqual({kind:nextHome?.kind,target:nextHome?.target,side:nextHome?.side,
 from:nextHome?.from,to:nextHome?.to},
 {kind:'team-nth-time',target:3,side:'home',from:31,to:45});
const nextAway=parseOrdinalGoalTime({market_name:'Next Away Goal Time',outcome_name:'46-60'},
 {goal:{home:3,away:1}});
assert.deepEqual({kind:nextAway?.kind,target:nextAway?.target,side:nextAway?.side},
 {kind:'team-nth-time',target:2,side:'away'});
const sendingOff=liveContract({market_name:'Sending off?',outcome_name:'Yes'});
assert.deepEqual({kind:sendingOff?.kind,event:sendingOff?.event,color:sendingOff?.cardColor,
 from:sendingOff?.from,to:sendingOff?.to,choice:sendingOff?.choice},
 {kind:'window',event:'card',color:'red',from:0,to:130,choice:true});
assert.deepEqual(parseSendingOffMarket({market_name:'Sending off?',outcome_name:'No'})?.choice,false);

const firstCornerWindow=liveContract({market_name:'Who takes first corner in minutes 21-30 (10-minute interval)',outcome_name:'1'});
assert.deepEqual({kind:firstCornerWindow?.kind,event:firstCornerWindow?.event,
 side:firstCornerWindow?.side,from:firstCornerWindow?.from,to:firstCornerWindow?.to},
 {kind:'window-first-event',event:'corner',side:'home',from:21,to:30});


const oddWindow=liveContract({market_name:'Odd/Even corners in minutes 21-30 (10-minute interval)',outcome_name:'Odd'});
assert.deepEqual({kind:oddWindow?.kind,event:oddWindow?.event,choice:oddWindow?.choice,
 from:oddWindow?.from,to:oddWindow?.to},
 {kind:'window-parity',event:'corner',choice:'odd',from:21,to:30});
const offsideWindow=liveContract({market_name:'Total 0.5 offsides in minutes 16-16 (1-minute interval)',outcome_name:'Over'});
assert.deepEqual({kind:offsideWindow?.kind,event:offsideWindow?.event,
 from:offsideWindow?.from,to:offsideWindow?.to},
 {kind:'window-total',event:'offside',from:16,to:16});
const intervalCornerHandicap=liveContract({market_name:'Corner handicap in minutes 21-30 (10-minute interval)',
 outcome_name:'1',line:'-0.5'});
assert.deepEqual({kind:intervalCornerHandicap?.kind,event:intervalCornerHandicap?.event,
 side:intervalCornerHandicap?.side,handicap:intervalCornerHandicap?.handicap,
 from:intervalCornerHandicap?.from,to:intervalCornerHandicap?.to},
 {kind:'interval-handicap',event:'corner',side:'home',handicap:-0.5,from:21,to:30});


// AAMS/lead-up contracts are intentionally disabled in this sportsbook.
// These provider labels must not be reconstructed as guessed event markets.
for(const [market,outcome]of [
 ['Full Time first valueUP','1'],['Full Time 1UP','1'],['Full Time 2UP','X'],
 ['Full Time 3UP','2']
]){
 assert.equal(liveContract({market_name:market,outcome_name:outcome}),null,
  'AAMS/lead-up market stays outside the supported settlement contract: '+market);
}
assert.equal(parseLeadUpMarket({market_name:'Full Time 2UP',outcome_name:'Draw'}),null);


const w=parseEventWindow(windowLine('Will there be a goal in minutes 20-45','Yes'));
assert.deepEqual([w.kind,w.event,w.from,w.to,w.choice],['window','goal',20,45,true]);
const obs=(event,events,clock,coverage)=>({
 clock,counts:{[event]:events.length},
 events:events.map((minute,index)=>({id:String(index),type:event,minute,team:'home'})),
 coverage:{[event+'Through']:coverage},
});
assert.equal(gradeLiveContract(w,obs('goal',[20],23,23)),'WON','Minute 20 is included');
assert.equal(gradeLiveContract(w,obs('goal',[],46,46)),'LOST','No goal by elapsed interval = yes lost');
assert.equal(gradeLiveContract(w,obs('goal',[],43,43)),null,'Do not settle no-event early');
assert.equal(gradeLiveContract(w,obs('goal',[],46,30)),null,'Missing coverage is pending');
const normal90Window=parseEventWindow(windowLine('Goal in minutes 76-90','Yes'));
const lateSecondHalf={id:'goal-90-plus-2',type:'goal',minute:92,minuteLabel:'90+2',phase:'2nd half',team:'home'};
assert.equal(gradeLiveContract(normal90Window,{
 clock:130,counts:{goal:1},events:[lateSecondHalf],coverage:{goalThrough:130}
}),'WON','90+2 is included in the conventional 76-90 interval');
const lateFirstHalf={type:'goal',minute:47,minuteLabel:'45+2',phase:'1st half',team:'home'};
const firstHalfWindow=eventContract({market_name:'1st half - total goals in minutes 31-45'});
assert.equal(eventInWindow(lateFirstHalf,firstHalfWindow),true,
 '45+2 belongs to the closing 31-45 first-half interval');
assert.equal(eventInWindow({...lateFirstHalf,phase:'2nd half',minuteLabel:'47'},firstHalfWindow),false,
 'A normal 2H minute 47 is not 1H stoppage time');
assert.equal(gradeLiveContract(normal90Window,{
 clock:130,counts:{goal:1},events:[{...lateSecondHalf,phase:'Extra Time'}],
 coverage:{goalThrough:130}
}),'LOST','An explicitly extra-time goal is excluded from the 76-90 interval');
assert.equal(gradeLiveContract(normal90Window,{
 clock:130,counts:{goal:1},events:[{type:'goal',minute:92,team:'home'}],
 coverage:{goalThrough:130}
}),null,'An unlabelled 92nd-minute event cannot be guessed as normal or extra time');
assert.equal(gradeLiveContract({
 kind:'sequence',event:'goal',target:1,side:'home'
},{clock:130,counts:{goal:1},events:[{id:'unknown-92',type:'goal',minute:92,team:'home'}],
 coverage:{goalThrough:130}},{ended:true}),null,
 'A post-90 event with unknown half/ET scope cannot settle a sequence market');
const no=parseEventWindow(windowLine('Goal in minutes 20-45','No'));
assert.equal(gradeLiveContract(no,obs('goal',[21],25,25)),'LOST','No goal bet loses as soon as goal verified');
assert.equal(gradeLiveContract(no,obs('goal',[],46,46)),'WON','No goal bet wins only after interval closes');
assert.equal(gradeLiveContract(no,obs('goal',[],46,30)),null,'No goal cannot win on a data gap');
const card=parseEventWindow(windowLine('Will there be a card in first 10 minutes','Yes'));
assert.equal(gradeLiveContract(card,obs('card',[9],9,9)),'WON');
assert.equal(gradeLiveContract(card,obs('card',[],11,11)),'LOST');
const corner=parseEventWindow(windowLine('Corner in next 10 minutes','Yes'),20);
assert.deepEqual([corner.from,corner.to,corner.startExclusive],[20,30,true]);
assert.equal(gradeLiveContract(corner,obs('corner',[20],22,22)),null,'Start excludes previous corner');
assert.equal(gradeLiveContract(corner,obs('corner',[21],22,22)),'WON');
assert.equal(gradeLiveContract(corner,obs('corner',[30],31,31)),null,'Minute-only event at closing boundary is ambiguous');
assert.equal(parseEventWindow(windowLine('Goal within 10 minutes','Yes')),null,'Unanchored rolling window is unsafe');
const next=parseSequenceBet(windowLine('Next Goal','Chelsea'),{goal:{home:1,away:0}});
assert.equal(next,null,'Unknown team labels must use explicit provider identity');
const g=parseSequenceBet(windowLine('Next Goal','2'),{goal:{home:1,away:0}});
assert.deepEqual([g.target,g.side],[2,'away']);
// The original Zizobet market title carries a FIXED goal ordinal. Never
// collapse "Next Goal 2nd" into the bare dynamic "Next Goal".
for(const [name,goalNumber] of [
 ['Next Goal 1st',1],['Next Goal 2nd',2],['Next Goal 3rd',3],
 ['Next Goal 4th',4],['Next Goal 10th',10],['Next Goal 2',2]
]){
 const c=parseSequenceBet(windowLine(name,'2'),{goal:{home:3,away:0}});
 assert.deepEqual([c?.kind,c?.event,c?.target,c?.side],['sequence','goal',goalNumber,'away'],
  'Provider ordinal preserved irrespective of current scoreboard: '+name);
}
const thirdCorner=parseSequenceBet(windowLine('Next Corner 3rd','1'),{corner:{home:4,away:4}});
assert.equal(thirdCorner?.target,3,'Numbered NEXT corner does not become corner #9');
assert.equal(parseSequenceBet(windowLine('Next Goal 2nd extra','2'),{goal:{home:0,away:0}}),null,
 'An unrecognized numbered market cannot default to the live next goal');
assert.equal(parseSequenceBet(windowLine('Next Goal 2nd half','2'),{goal:{home:0,away:0}}),null,
 'Half-specific NEXT cannot be graded from full match goals');
const early=obs('goal',[12,29],30,30);early.events[0].team='home';early.events[1].team='away';
assert.equal(gradeLiveContract(g,early),'WON');
assert.equal(gradeLiveContract({...g,side:'home'},early),'LOST');
assert.equal(gradeLiveContract({...g,side:'none'},early),'LOST');
assert.equal(gradeLiveContract({...g,target:3},early),null);
assert.equal(gradeLiveContract({...g,target:3,side:'none',noneOffered:true},early,{ended:true}),'WON');

const noFurtherGoal=obs('goal',[],90,90);
assert.equal(gradeLiveContract(g,noFurtherGoal,{ended:true}),'LOST',
 'Next Goal Home/Away loses when confirmed FT arrives without another goal; it is not VOID');
assert.equal(gradeLiveContract({...g,side:'home'},noFurtherGoal,{ended:true}),'LOST');
assert.equal(gradeLiveContract({...g,side:'none',noneOffered:true},noFurtherGoal,{ended:true}),'WON',
 'No Goal wins only when that exact outcome was offered');
assert.equal(gradeLiveContract({...g,side:'none',noneOffered:false},noFurtherGoal,{ended:true}),'LOST',
 'An unoffered No Goal selection cannot be invented at settlement');

for(const event of ['corner','card']){
 const noEventContract={version:1,kind:'sequence',event,target:1,side:'home'};
 assert.equal(gradeLiveContract(noEventContract,obs(event,[],90,90),{ended:true}),'VOID',
  event+' no-event rules must not inherit the Next Goal loss rule');
 assert.equal(gradeLiveContract({...noEventContract,side:'none',noneOffered:true},
  obs(event,[],90,90),{ended:true}),'WON');
}


assert.equal(parseSequenceBet(windowLine('Who scores goal 2','X')).target,2);
const ambiguous=obs('goal',[12,12],30,30);ambiguous.events[1].team='away';
assert.equal(gradeLiveContract(g,ambiguous),null,'Same-minute goal ordering cannot be guessed');
const race=parseSequenceBet(windowLine('Which team wins race to 3 corners','1'));
const corners=obs('corner',[2,5,10,25,30],35,35);
corners.events.forEach((e,i)=>{e.team=['home','away','home','away','home'][i];});
assert.equal(gradeLiveContract(race,corners),'WON');
assert.equal(gradeLiveContract({...race,side:'away'},corners),'LOST');
assert.equal(gradeLiveContract(race,{...corners,coverage:{cornerThrough:10}}),null);
assert.equal(gradeLiveContract({...race,target:6},corners,{ended:true}),'VOID','An unreached two-way race is refunded at confirmed FT');
assert.equal(gradeLiveContract(w,obs('goal',[],15,15),{ended:true}),null,'Abandoned early match is not an elapsed window');
// Last goal/corner/card are final-event bets: never declare a winner before FT.
for(const [name,event] of [['Last Goal','goal'],['Last Corner','corner'],['Last Card','card']]){
 const last=parseLastEvent(windowLine(name,'1'));
 assert.equal(last.kind,'last-event');
 assert.equal(last.event,event);
 const frame=obs(event,[10,20],90,90);
 frame.events[0].team='home';frame.events[1].team='away';
 assert.equal(gradeLiveContract(last,frame),null,'Last event is unknowable before FT');
 assert.equal(gradeLiveContract(last,frame,{ended:true}),'LOST');
 assert.equal(gradeLiveContract({...last,side:'away'},frame,{ended:true}),'WON');
 assert.equal(gradeLiveContract({...last,side:'none'},frame,{ended:true}),'LOST');
 assert.equal(gradeLiveContract({...last,noneOffered:true},obs(event,[],90,90),{ended:true}),'LOST');
 assert.equal(gradeLiveContract({...last,side:'none',noneOffered:true},obs(event,[],90,90),{ended:true}),'WON');
 assert.equal(gradeLiveContract(last,obs(event,[],90,90),{ended:true}),'VOID');
}
assert.equal(parseLastEvent(windowLine('2nd Half Last Goal','1')),null);
assert.equal(parseLastEvent(windowLine('Last Goalscorer','1')),null);
const over=parseCountMarket(windowLine('Total Goals','Over'));assert.equal(over,null,'Missing threshold cannot be invented');
const o=parseCountMarket({...windowLine('Total Goals','Over'),line:'2.5'});
assert.equal(gradeLiveContract(o,{counts:{goal:3}}),'WON');
assert.equal(gradeLiveContract(o,{counts:{goal:2}}),null);
assert.equal(gradeLiveContract(o,{counts:{goal:2}},{ended:true}),'LOST');
const u=parseCountMarket({...windowLine('Total Goals','Under'),line:'2.5'});
assert.equal(gradeLiveContract(u,{counts:{goal:3}}),'LOST');
assert.equal(gradeLiveContract(u,{counts:{goal:2}},{ended:true}),'WON');
const integer=parseCountMarket({...windowLine('Total Goals','Under'),line:'2'});
assert.equal(gradeLiveContract(integer,{counts:{goal:2}}),null);
assert.equal(gradeLiveContract(integer,{counts:{goal:2}},{ended:true}),'VOID');
const exact=parseCountMarket(windowLine('Total Corners','Exactly 2'));
assert.equal(gradeLiveContract(exact,{counts:{corner:2}}),null);
assert.equal(gradeLiveContract(exact,{counts:{corner:3}}),'LOST');
assert.equal(gradeLiveContract(exact,{counts:{corner:2}},{ended:true}),'WON');
const band=parseCountMarket(windowLine('Total Cards','1-4'));
assert.equal(gradeLiveContract(band,{counts:{card:3}}),null);
assert.equal(gradeLiveContract(band,{counts:{card:5}}),'LOST');
assert.equal(gradeLiveContract(band,{counts:{card:3}},{ended:true}),'WON');
const fouls=parseCountMarket(windowLine('Total Fouls','2+'));
assert.equal(gradeLiveContract(fouls,{counts:{foul:2}}),'WON');
const deltaNext={...g,baseline:{home:1,away:0}};
assert.equal(gradeFromAcceptedCounters(deltaNext,{teams:{goal:{home:1,away:1}}}),'WON');
assert.equal(gradeFromAcceptedCounters({...deltaNext,side:'home'},{teams:{goal:{home:1,away:1}}}),'LOST');
assert.equal(gradeFromAcceptedCounters(deltaNext,{teams:{goal:{home:2,away:1}}}),null,
 'Two goals between snapshots require history from the backup API');
assert.equal(gradeFromAcceptedCounters(deltaNext,{teams:{goal:{home:0,away:1}}}),null,
 'Score rollback or VAR correction must not pay');
assert.equal(gradeFromAcceptedCounters({...deltaNext,side:'none',noneOffered:true},
 {teams:{goal:{home:1,away:0}},ended:true}),'WON');
const deltaRace={...race,baseline:{home:2,away:1}};
assert.equal(gradeFromAcceptedCounters(deltaRace,{teams:{corner:{home:3,away:2}}}),'WON');
assert.equal(gradeFromAcceptedCounters(deltaRace,{teams:{corner:{home:3,away:3}}}),null,
 'If both sides crossed the threshold, order is unknown');
const integerOver=parseCountMarket({...windowLine('Total Goals','Over'),line:'2'});
assert.equal(gradeLiveContract(integerOver,{counts:{goal:2}}),null);
assert.equal(gradeLiveContract(integerOver,{counts:{goal:2}},{ended:true}),'VOID');
assert.equal(gradeLiveContract(integerOver,{counts:{goal:1}},{ended:true}),'LOST');
const missingMinute=obs('goal',[null],11,11);
const firstTen=parseEventWindow(windowLine('Goal in first 10 minutes','Yes'));
assert.equal(gradeLiveContract(firstTen,missingMinute),null,'Missing event minute is not minute zero');

const confirmedGoalFacts={
 through_minute:90,count_home:1,count_away:0,complete:true,
 observed_at:'2026-11-18T20:00:00.000Z',
 confirmed_at:'2026-11-18T19:59:50.000Z',
 archive_poll_at:'2026-11-18T20:00:00.000Z',
 second_poll_at:null,open_recovery_gap:false,
 home:1,away:0,total:1,nth_team:null,nth_minute:null,nth_same_time:null,
 last_team:'home',last_same_time:1,race_home_time:null,race_away_time:null,
 window_count:0,color_window_count:0,window_home:0,window_away:0,
 color_total:0,color_home:0,color_away:0,card_colors_verified:false,
 ambiguous_order:false,minute_only:false
};
const gradeNoNextGoal=async contract=>gradeStoredEventContract({
 id:'line-next-goal',match_id:7,live_contract:contract
 },{home_score:1,away_score:0,corners_home:0,corners_away:0,cards_home:0,cards_away:0},
 {execute:async()=>({rows:[confirmedGoalFacts]})});
assert.equal(await gradeNoNextGoal({version:1,kind:'sequence',event:'goal',target:2,side:'home'}),
 'LOST','Stored Zizobet event facts must settle Next Goal Home as LOST when FT has no second goal');
assert.equal(await gradeNoNextGoal({version:1,kind:'sequence',event:'goal',target:2,side:'away'}),
 'LOST','Stored Zizobet event facts must settle Next Goal Away as LOST when FT has no second goal');
assert.equal(await gradeNoNextGoal({version:1,kind:'sequence',event:'goal',target:2,side:'none',noneOffered:true}),
 'WON','Stored Zizobet event facts must settle the quoted No Goal outcome as WON');

// Older accepted tickets may contain stale sequence=1 despite their immutable
// acceptance snapshot already showing 0:1. Rebase only a bare relative Next Goal.
const staleNextGoalFacts={...confirmedGoalFacts,
 home:0,away:1,count_home:0,count_away:1,total:1,normal_home:0,normal_away:1};
const gradeFrozenNextGoal=async side=>gradeStoredEventContract({
 id:'line-next-goal-stale-sequence',match_id:77,market_name:'Next Goal',
 accepted_contract:{providerMarketName:'Next Goal',acceptedLiveSnapshot:{
  isLive:true,scoreHome:0,scoreAway:1,counters:{goal:{home:0,away:1}}
 }},
 live_contract:{version:1,kind:'sequence',event:'goal',target:1,side,noneOffered:true}
},{home_score:0,away_score:1,corners_home:0,corners_away:0,cards_home:0,cards_away:0},
 {execute:async(_sql,args)=>{
  assert.equal(args[7],2,'Relative Next Goal queries goal #2 from the accepted 0:1 snapshot');
  return {rows:[staleNextGoalFacts]};
 }});
assert.equal(await gradeFrozenNextGoal('none'),'WON',
 'No Goal wins when no second goal followed the accepted 0:1 score');
assert.equal(await gradeFrozenNextGoal('away'),'LOST',
 'Away loses Next Goal when no goal followed the accepted 0:1 score');

const extraTimeGoalFacts={...confirmedGoalFacts,count_home:0,count_away:1,home:0,away:1,total:1,
 normal_home:0,normal_away:0,phase_ambiguous:false,nth_team:null,nth_minute:null,nth_same_time:null};
const gradeNoRegulationGoal=async contract=>gradeStoredEventContract({
 id:'line-next-goal-extra-time',match_id:8,live_contract:contract
 },{home_score:0,away_score:1,corners_home:0,corners_away:0,cards_home:0,cards_away:0},
 {execute:async(sql,args)=>{
  assert.match(sql,/normal_ordered/);
  assert.match(sql,/phase_order/);
  assert.equal(args[19],true,'event contracts must request regulation-time-only chronology');
  return {rows:[extraTimeGoalFacts]};
 }});
assert.equal(await gradeNoRegulationGoal({version:1,kind:'sequence',event:'goal',target:1,side:'home',normalTimeOnly:true}),'LOST',
 'A goal scored only in extra time cannot trigger a regulation-time Next Goal selection');
assert.equal(await gradeNoRegulationGoal({version:1,kind:'sequence',event:'goal',target:1,side:'none',noneOffered:true,normalTimeOnly:true}),'WON',
 'No Goal wins when no regulation-time goal was scored, even if extra time later contains a goal');


const teamNthFacts={...confirmedGoalFacts,count_home:1,count_away:1,home:1,away:1,total:2,
 team_nth_minute:72,team_nth_same_time:1};
const gradeTeamNth=async(contract,facts=teamNthFacts)=>gradeStoredEventContract({
 id:'line-team-goal-time',match_id:8,live_contract:contract
 },{home_score:1,away_score:1,corners_home:0,corners_away:0,cards_home:0,cards_away:0},
 {execute:async()=>({rows:[facts]})});
const awayGoalTime={version:1,kind:'team-nth-time',event:'goal',target:1,
 side:'away',choice:'range',from:60,to:75};
assert.equal(await gradeTeamNth(awayGoalTime),'WON',
 'Next Away Goal Time grades against the next away-team goal, not the global next goal');
assert.equal(await gradeTeamNth({...awayGoalTime,from:30,to:60}),'LOST',
 'A team goal outside the selected time band loses');
assert.equal(await gradeTeamNth(awayGoalTime,{...teamNthFacts,team_nth_minute:null,
 through_minute:90}), 'LOST',
 'A fully covered match with no next team goal loses the time selection');
const redCardFacts={...confirmedGoalFacts,count_home:0,count_away:1,home:0,away:1,total:1,
 color_window_count:1,color_total:1,card_colors_verified:true};
const gradeSendingOff=async(contract,facts,result={home_score:0,away_score:0,
 corners_home:0,corners_away:0,cards_home:0,cards_away:1})=>gradeStoredEventContract({
 id:'line-sending-off',match_id:9,live_contract:contract
 },result,{execute:async()=>({rows:[facts]})});
assert.equal(await gradeSendingOff(sendingOff,redCardFacts),'WON',
 'A verified red card proves Sending Off Yes');
assert.equal(await gradeSendingOff({...sendingOff,choice:false},redCardFacts),'LOST');

const noRedFacts={...confirmedGoalFacts,count_home:0,count_away:0,home:0,away:0,total:0,
 color_window_count:0,color_total:0,card_colors_verified:true,phase_ambiguous:false};
assert.equal(await gradeSendingOff(sendingOff,noRedFacts,{home_score:0,away_score:0,
 corners_home:0,corners_away:0,cards_home:0,cards_away:0}),'LOST',
 'Confirmed absence of red cards through normal time settles Sending Off No');
assert.equal(await gradeSendingOff(sendingOff,{...noRedFacts,phase_ambiguous:true},{home_score:0,away_score:0,
 corners_home:0,corners_away:0,cards_home:0,cards_away:0}),null,
 'Unknown post-90 card phase cannot be guessed as stoppage time or extra time');

assert.equal(await gradeSendingOff(sendingOff,{...redCardFacts,color_window_count:0,
 color_total:0,card_colors_verified:false}),null,
 'Unknown card color cannot prove that no sending off occurred');

const homeLedThenLost={...confirmedGoalFacts,count_home:1,count_away:2,home:1,away:2,total:3,
 max_home_lead_since_entry:1,max_away_lead_since_entry:2,ambiguous_order_since_entry:false,
 normal_home:1,normal_away:2,phase_ambiguous:false};
const gradeLeadUp=async(contract,facts,result)=>gradeStoredEventContract({
 id:'line-lead-up',match_id:10,live_contract:contract
 },result,{execute:async()=>({rows:[facts]})});
const oneUpHome={version:1,kind:'lead-up',event:'goal',target:1,side:'home',baseline:{home:0,away:0}};
assert.equal(await gradeLeadUp(oneUpHome,homeLedThenLost,
 {home_score:1,away_score:2,corners_home:0,corners_away:0,cards_home:0,cards_away:0}),'WON',
 '1UP remains WON after the selected team later loses the match');
assert.equal(await gradeLeadUp({...oneUpHome,target:2},homeLedThenLost,
 {home_score:1,away_score:2,corners_home:0,corners_away:0,cards_home:0,cards_away:0}),'LOST',
 '2UP loses when the team never reached a two-goal lead');
const bothTeamsLed={...confirmedGoalFacts,count_home:2,count_away:3,home:2,away:3,total:5,
 max_home_lead_since_entry:1,max_away_lead_since_entry:1,ambiguous_order_since_entry:false,
 normal_home:2,normal_away:3,phase_ambiguous:false};
assert.equal(await gradeLeadUp(oneUpHome,bothTeamsLed,
 {home_score:2,away_score:3,corners_home:0,corners_away:0,cards_home:0,cards_away:0}),'WON');
assert.equal(await gradeLeadUp({...oneUpHome,side:'away'},bothTeamsLed,
 {home_score:2,away_score:3,corners_home:0,corners_away:0,cards_home:0,cards_away:0}),'WON',
 'Both sides can independently satisfy 1UP during a comeback');
const drawFacts={...confirmedGoalFacts,count_home:1,count_away:1,home:1,away:1,total:2,
 normal_home:1,normal_away:1,phase_ambiguous:false};
assert.equal(await gradeLeadUp({...oneUpHome,side:'draw'},drawFacts,
 {home_score:1,away_score:1,corners_home:0,corners_away:0,cards_home:0,cards_away:0}),'WON',
 'The draw selection follows the final 1X2 result');
assert.equal(await gradeLeadUp(oneUpHome,{...drawFacts,max_home_lead_since_entry:1,
 ambiguous_order_since_entry:true},
 {home_score:1,away_score:1,corners_home:0,corners_away:0,cards_home:0,cards_away:0}),null,
 'Ambiguous same-time goal order cannot prove an early lead');

const extraTimeOnly={...confirmedGoalFacts,count_home:0,count_away:1,home:0,away:1,total:1,
 normal_home:0,normal_away:0,phase_ambiguous:false,
 max_home_lead_since_entry:null,max_away_lead_since_entry:null,ambiguous_order_since_entry:false};
const afterExtraTime={home_score:0,away_score:1,corners_home:0,corners_away:0,cards_home:0,cards_away:0};
assert.equal(await gradeLeadUp(oneUpHome,extraTimeOnly,afterExtraTime),'LOST',
 'A lead reached only in extra time does not trigger 1UP');
assert.equal(await gradeLeadUp({...oneUpHome,side:'away'},extraTimeOnly,afterExtraTime),'LOST',
 'An extra-time goal cannot trigger the away 1UP selection');
assert.equal(await gradeLeadUp({...oneUpHome,side:'draw'},extraTimeOnly,afterExtraTime),'WON',
 'The draw selection uses the regulation-time score even if extra time decides the overall match');
assert.equal(await gradeLeadUp(oneUpHome,{...extraTimeOnly,phase_ambiguous:true},afterExtraTime),null,
 'Unlabelled goals after minute 90 cannot be guessed as stoppage time or extra time');


const cornerFacts={...confirmedGoalFacts,count_home:2,count_away:1,home:2,away:1,total:3,
 window_home:2,window_away:1,window_first_team:'home',window_first_minute:22};
const gradeCornerContract=async(contract,facts=cornerFacts,result={home_score:0,away_score:0,
 corners_home:2,corners_away:1,cards_home:0,cards_away:0})=>gradeStoredEventContract({
 id:'line-corner-interval',match_id:11,live_contract:contract
 },result,{execute:async()=>({rows:[facts]})});
assert.equal(await gradeCornerContract(firstCornerWindow),'WON',
 'First corner in a quoted interval is graded from the first corner inside that interval');
assert.equal(await gradeCornerContract({...firstCornerWindow,side:'away'}),'LOST');
assert.equal(await gradeCornerContract({...firstCornerWindow,side:'none'}),'LOST');
assert.equal(await gradeCornerContract({...firstCornerWindow,side:'none'},
 {...cornerFacts,window_first_team:null,window_first_minute:null,window_home:0,window_away:0,
  count_home:0,count_away:0,home:0,away:0,total:0},
 {home_score:0,away_score:0,corners_home:0,corners_away:0,cards_home:0,cards_away:0}),'WON',
 'Neither wins only when the interval closes with no corner');
assert.equal(await gradeCornerContract(intervalCornerHandicap),'WON',
 'A corner handicap uses only corners inside its quoted interval');
assert.equal(await gradeCornerContract({...intervalCornerHandicap,handicap:-1.5}),'LOST');

const offsideFacts={...confirmedGoalFacts,count_home:1,count_away:0,home:1,away:0,total:1,
 window_count:1};
const gradeOffside=async(facts)=>gradeStoredEventContract({
 id:'line-offside-window',match_id:12,live_contract:offsideWindow
 },null,{execute:async()=>({rows:[facts]})});
assert.equal(await gradeOffside(offsideFacts),'WON',
 'A confirmed Zizobet offside inside the accepted minute window settles Over');
assert.equal(await gradeOffside({...offsideFacts,count_home:0,home:0,total:0,
 window_count:0,through_minute:17}),'LOST',
 'A fully covered one-minute offside window with no event settles Under/Over correctly');

const oddFacts={...cornerFacts,window_count:3};
const gradeOdd=async(facts)=>gradeStoredEventContract({
 id:'line-odd-corners',match_id:13,live_contract:oddWindow
 },{home_score:0,away_score:0,corners_home:2,corners_away:1,cards_home:0,cards_away:0},
 {execute:async()=>({rows:[facts]})});
assert.equal(await gradeOdd(oddFacts),'WON');
assert.equal(await gradeOdd({...oddFacts,window_count:2}),'LOST',
 'Odd/even is calculated from the accepted interval only');






console.log('PASS live event window yes/no, next goal, race, irreversible totals, exact and range');

const homeWindow=parseEventWindow(windowLine('Home team corner in minutes 20-45','Yes'));
assert.equal(homeWindow.side,'home');
const awayCorner=obs('corner',[20],25,25);
awayCorner.events[0].team='away';
assert.equal(gradeLiveContract(homeWindow,awayCorner),null);
assert.equal(gradeLiveContract(homeWindow,{...awayCorner,clock:46,coverage:{cornerThrough:46}}),'LOST');
assert.equal(gradeLiveContract(homeWindow,obs('corner',[20],25,25)),'WON');
assert.equal(gradeLiveContract({...homeWindow,choice:false},obs('corner',[20],25,25)),'LOST');
