import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parseTeamCountMarket,liveContract,gradeLiveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';
import {goalTotalContract} from '../server/ledger/goal-total-contract.mjs';
const line=(market_name,outcome_name,amount='')=>({market_name,outcome_name,line:amount});
for(const [market,outcome,amount,event,side,kind] of [
 ['Home Team Total Corners','Over','2.5','corner','home','over'],
 ['Away Team Yellow Cards','Over','1.5','card','away','over'],
 ['Total Home Team Corners','Under','4.5','corner','home','under'],
 ['Total Corners Away Team','Exactly 2','','corner','away','exact'],
 ['Team 1 Total Corners','Over','2.5','corner','home','over'],
 ['Team 2 Total Cards','Under','3.5','card','away','under'],
 ['Full time - Home team Total Cards (3.5)','Over','3.5','card','home','over'],
 ['Home Team Total Goals','Over','1.5','goal','home','team-total-goals'],
 ['Home Team Total Fouls','2+','','foul','home','atLeast'],
 ['Hometeam total corners (8.5)','Over','8.5','corner','home','over'],
 ['Awayteam total corners (5.5)','Under','5.5','corner','away','under']
]){
 const quote=line(market,outcome,amount);
 const contract=event==='foul'?parseTeamCountMarket(quote):liveContract(quote);
 // Final-match fouls use certified statistics, not a fictitious live
 // foul-incident chronology. Their raw team/line grammar still parses.
 if(event==='foul')assert.equal(liveContract(quote),null,
  'Fouls must never be accepted as verified live event contracts');
 assert.equal(contract?.event,event,market+' event');
 assert.equal(contract?.side,side,market+' side');
 assert.equal(contract?.kind,kind,market+' kind');
 if(event==='goal'){
  assert.equal(contract.choice,'over','Team goal contract preserves the quoted Over direction');
  assert.equal(contract.threshold,1.5,'Team goal contract preserves the quoted 1.5 line');
 }

}
for(const input of [
 line('Home Team Total Corners','Over','2.25'),
 line('Home Team Total Corners (1.5)','Over','2.5'),
 line('Home Team Total Corners and Goals','Over','2.5'),
 line('Home Team Yellow Red Cards','Over','2.5'),
 line('1st Half - Home Team Total Cards','Over','2.5')
])assert.equal(parseTeamCountMarket(input),null,
 'Unsupported or inconsistent quote must not become an aggregate count: '+input.market_name);

const teamGoals=liveContract(line('Home Team Total Goals','Over','1.5'));
assert.equal(gradeLiveContract(teamGoals,{clock:65,
 teams:{goal:{home:1,away:5}}}),null,
 'Five away goals must not settle a home Over 1.5 market');
assert.equal(gradeLiveContract(teamGoals,{clock:66,
 teams:{goal:{home:2,away:5}}}),'WON',
 'Home Over 1.5 wins when two confirmed home goals exist');
const home=liveContract(line('Home Team Total Corners','Over','2.5'));
const frame={clock:45,counts:{corner:10},teams:{corner:{home:1,away:9}}};
assert.equal(gradeLiveContract(home,frame),null,'Nine away corners cannot win a HOME corner line');
assert.equal(gradeLiveContract(home,{...frame,teams:{corner:{home:3,away:7}}}),'WON');
const yellow=liveContract(line('Home Team Yellow Cards','Over','1.5'));
assert.equal(yellow.cardColor,'yellow');
assert.equal(gradeLiveContract(yellow,{clock:80,counts:{card:6},teams:{card:{home:3,away:3}}}),null,
 'Generic card counts cannot be used as yellow-card evidence');

const execute=async(sql,args)=>{
 assert.match(sql,/with covered as/);
 assert.equal(args[4],'home');
 assert.equal(args[14],'yellow');
 return {rows:[{
  home:2,away:2,total:4,count_home:2,count_away:2,
  color_home:2,color_away:0,color_total:2,
  through_minute:91,complete:true,card_colors_verified:true,
  observed_at:'2026-11-08T13:10:00Z',confirmed_at:'2026-11-08T13:10:00Z',
  second_poll_at:'2026-11-08T13:10:00Z',open_recovery_gap:false
 }]};
};
assert.equal(await gradeStoredEventContract({
 id:'00000000-0000-4000-8000-000000000001',match_id:11,
 live_contract:liveContract(line('Home Team Yellow Cards','Over','1.5'))
},{home_score:0,away_score:0,cards_home:2,cards_away:2},{execute}),'WON',
 'Persisted confirmed player/team card colors grade the correct home side');

// A completed Zizobet corner scoreboard is sufficient for full-match team
// totals and bands. These markets must not wait for the independent event
// chronology when its list is incomplete.
const finalCorners={home_team:'Rubin Kazan',away_team:'FK Zenit Saint Petersburg',
 home_score:3,away_score:1,corners_home:5,corners_away:4,source:'ZIZOBET'};
for(const [market,outcome,amount,expected] of [
 ['Total Corners Hometeam (3.5)','Over','3.5','WON'],
 ['Total Corners Awayteam (6.5)','Under','6.5','WON'],
 ['Corners Hometeam','5-6','','WON'],
 ['Corners Hometeam','7+','','LOST'],
 ['Corners Hometeam','3-4','','LOST'],
 ['Corners Awayteam','3-4','','WON'],
 ['Corners Awayteam','5-6','','LOST'],
 ['Corners Awayteam','0-2','','LOST']
]){
 const quote={...line(market,outcome,amount),outcome_key:outcome,
  live_contract:liveContract(line(market,outcome,amount))};
 assert.equal(gradeLine(quote,finalCorners),expected,market+' '+outcome);
 assert.equal(hasRequiredSettlementEvidence(quote,finalCorners),true,
  'Final Zizobet team corner counters are enough: '+market+' '+outcome);
}
const threeEach={home_team:'Real Madrid U19',away_team:'PSV Eindhoven U19',
 home_score:3,away_score:3};
for(const [market,scope] of [
 ['Total hometeam (4.5)','home'],['Total awayteam (4.5)','away'],
 ['Total hometeam (3.5)','home'],['Total awayteam (3.5)','away']
]){
 const under={...line(market,'Under',''),outcome_key:'under'};
 const over={...line(market,'Over',''),outcome_key:'over'};
 assert.equal(goalTotalContract(under)?.scope,scope,
  'Compact native team-total title preserves '+scope+' scope: '+market);
 assert.equal(gradeLine(under,threeEach),'WON',
  'Three goals are below the quoted team-total line: '+market+' Under');
 assert.equal(gradeLine(over,threeEach),'LOST',
  'Three goals are below the quoted team-total line: '+market+' Over');
 assert.equal(hasRequiredSettlementEvidence(under,threeEach),true);
 assert.equal(hasRequiredSettlementEvidence(over,threeEach),true);
}

// Exact Zizobet-style titles have the line in the market name and an
// empty DB line column. They must still freeze a team-scoped goal contract,
// then grade from the same confirmed Zizobet chronology used by settlement.
const nativeTeamGoalResult={home_team:'Real Madrid U19',away_team:'PSV Eindhoven U19',
 home_score:3,away_score:3,source:'ZIZOBET'};
const confirmedGoalRow={
 home:3,away:3,total:6,count_home:3,count_away:3,
 through_minute:130,complete:true,
 observed_at:'2026-11-24T17:00:00.000Z',
 confirmed_at:'2026-11-24T17:00:00.000Z',
 second_poll_at:'2026-11-24T17:00:00.000Z',
 open_recovery_gap:false
};
const goalFacts=async(sql,args)=>{
 assert.match(sql,/with covered as/,'team goal tickets use the PostgreSQL primary event grader');
 return {rows:[confirmedGoalRow]};
};
for(const [market,side] of [
 ['Total hometeam 4.5','home'],['Total awayteam 4.5','away'],
 ['Total hometeam 3.5','home'],['Total awayteam 3.5','away']
]){
 for(const [outcome,expected] of [['Under','WON'],['Over','LOST']]){
  const quote=line(market,outcome,'');
  const contract=liveContract(quote);
  assert.equal(contract?.kind,'team-total-goals',market+' freezes its native goal total');
  assert.equal(contract?.side,side,market+' freezes the correct team');
  assert.equal(contract?.threshold,Number(market.match(/\d+\.\d+/)?.[0]),market+' freezes the quoted threshold');
  assert.equal(contract?.choice,outcome.toLowerCase(),market+' retains the quoted direction');
  const wager={id:'00000000-0000-4000-8000-000000000001',match_id:9981,
   market_name:market,outcome_name:outcome,outcome_key:outcome,line:'',
   live_contract:contract};
  assert.equal(await gradeStoredEventContract(wager,nativeTeamGoalResult,{execute:goalFacts}),
   expected,market+' '+outcome+' must not be inverted by the primary settlement grader');
 }
}
for(const [market,outcome,expected] of [
 ['Total awayteam 2.5','Under','LOST'],
 ['Total awayteam 2.5','Over','WON'],
 ['Total hometeam 2.5','Under','LOST'],
 ['Total hometeam 2.5','Over','WON']
]){
 const contract=liveContract(line(market,outcome,''));
 assert.equal(contract?.kind,'team-total-goals');
 const wager={id:'00000000-0000-4000-8000-000000000002',match_id:9981,
  market_name:market,outcome_name:outcome,outcome_key:outcome,line:'',
  live_contract:contract};
 assert.equal(await gradeStoredEventContract(wager,nativeTeamGoalResult,{execute:goalFacts}),
  expected,market+' '+outcome+' above/below 3 goals');
}

const finalGoals={...finalCorners,home_score:0,away_score:1};
for(const [market,outcome,expected] of [
 ['Total hometeam (0.5)','Under','WON'],
 ['Total hometeam (0.5)','Over','LOST'],
 ['Total awayteam (0.5)','Over','WON'],
 ['Total awayteam (0.5)','Under','LOST']
]){
 const ticket={...line(market,outcome,'0.5'),outcome_key:outcome};
 assert.equal(goalTotalContract(ticket)?.scope,market.includes('home')?'home':'away',
  'Joined Zizobet team label must retain its side: '+market);
 assert.equal(gradeLine(ticket,finalGoals),expected,market+' '+outcome+' on 0:1');
 assert.equal(hasRequiredSettlementEvidence(ticket,finalGoals),true,
  'A verified final score is sufficient for team goal totals: '+market);
}

// Chronological corner markets are deliberately excluded from aggregate
// grading. A 5-4 counter cannot identify which team took the first corner
// in a time window.
const timedFirst={market_name:'Who takes first corner in minutes 61-75',
 outcome_name:'Rubin Kazan',outcome_key:'1',
 live_contract:liveContract({market_name:'Who takes first corner in minutes 61-75',
  outcome_name:'1'})};
assert.equal(gradeLine(timedFirst,finalCorners),null,
 'A final 5-4 corner total cannot settle a first-corner interval');
console.log('PASS scoped team goals/corners/cards/fouls parsing, counter-based final corner bands and interval safety');
