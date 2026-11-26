import assert from 'node:assert/strict';
import {collectLiveIncidentDeltas} from '../web/src/api/liveIncidentDeltas.mjs';
const first=collectLiveIncidentDeltas({
 matchId:'100',at:1000,homeScore:0,awayScore:0,homeTeam:'Home',awayTeam:'Away',minute:20,
 counters:{corners:{home:2,away:1},yellowCards:{home:0,away:0},redCards:{home:0,away:0},
  fouls:{home:4,away:3},shotsOnTarget:{home:1,away:1},offsides:{home:0,away:0},shots:{home:2,away:2}}
},null);
assert.equal(first.alerts.length,0,'initial snapshot establishes baseline without false notification');
const update=collectLiveIncidentDeltas({
 matchId:'100',at:2000,homeScore:1,awayScore:0,homeTeam:'Home',awayTeam:'Away',minute:24,
 counters:{corners:{home:3,away:1},yellowCards:{home:1,away:0},redCards:{home:0,away:0},
  fouls:{home:5,away:3},shotsOnTarget:{home:2,away:1},offsides:{home:0,away:1},shots:{home:3,away:2}}
},first.baseline);
assert.deepEqual(update.alerts.map(alert=>[alert.kind,alert.team,alert.count]),[
 ['goal','home',1],['corner','home',1],['yellow-card','home',1],['foul','home',1],
 ['shot-on-target','home',1],['offside','away',1],['shot','home',1]
]);
assert.ok(update.alerts.every(alert=>alert.minute===24&&alert.matchId==='100'));
const repeated=collectLiveIncidentDeltas({matchId:'100',at:2000,homeScore:1,awayScore:0,counters:{corners:{home:3,away:1}}},update.baseline);
assert.equal(repeated.alerts.length,0,'replayed frames cannot duplicate alerts');
const stale=collectLiveIncidentDeltas({matchId:'100',at:1500,homeScore:0,awayScore:0},update.baseline);
assert.equal(stale.baseline.homeScore,1,'older snapshots cannot roll the baseline backwards');
assert.equal(stale.alerts.length,0);
console.log('PASS provisional live alerts: baseline, goal/stat deltas, no duplicates, stale snapshots ignored');
