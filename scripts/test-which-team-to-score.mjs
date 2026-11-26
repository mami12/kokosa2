import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {classify,gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';
import {eventMarketRequirement} from '../server/ledger/event-market-policy.mjs';

const quote=outcome_name=>({market_name:'Which team to score',outcome_name,line:'',period:0});
const result=(home_score,away_score)=>({
 home_team:'Denmark',away_team:'Norway',
 home_score,away_score,
 half_home_score:home_score,half_away_score:away_score
});
assert.equal(classify('Which team to score'),'WHICH_TEAM_TO_SCORE');
assert.equal(eventMarketRequirement({name:'Which team to score'}),null,
 'this is a team-scoring proposition, not an individual-player event market');

for(const [score,picks] of [
 [{home_score:2,away_score:3},{'Both teams':'WON','Only 1':'LOST','Only 2':'LOST','None':'LOST'}],
 [{home_score:2,away_score:0},{'Both teams':'LOST','Only 1':'WON','Only 2':'LOST','None':'LOST'}],
 [{home_score:0,away_score:3},{'Both teams':'LOST','Only 1':'LOST','Only 2':'WON','None':'LOST'}],
 [{home_score:0,away_score:0},{'Both teams':'LOST','Only 1':'LOST','Only 2':'LOST','None':'WON'}]
]){
 const final=result(score.home_score,score.away_score);
 assert.equal(hasRequiredSettlementEvidence(quote('Both teams'),final),true);
 for(const [selection,expected] of Object.entries(picks)){
  assert.equal(gradeLine(quote(selection),final),expected,
   selection+' against '+score.home_score+'-'+score.away_score);
 }
}
console.log('PASS Which team to score: both, home only, away only and no team');
