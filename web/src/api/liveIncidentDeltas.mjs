const keys = [
  ['corners','corner'],
  ['yellowCards','yellow-card'],
  ['redCards','red-card'],
  ['fouls','foul'],
  ['shotsOnTarget','shot-on-target'],
  ['offsides','offside'],
  ['shots','shot'],
];
const countOf = value => {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
};
const pairOf = (incoming, previous) => ({
  home: countOf(incoming?.home) ?? previous?.home ?? null,
  away: countOf(incoming?.away) ?? previous?.away ?? null,
});
/** Provisional dashboard alerts from provider counters, not settlement evidence or the official event timeline. */
export function collectLiveIncidentDeltas(snapshot, previous) {
  const candidateAt = Number(snapshot.at);
  const at = Number.isFinite(candidateAt) ? candidateAt : (previous?.at ?? 0);
  if (previous && at > 0 && previous.at > at) return { baseline: previous, alerts: [] };
  const counters = {};
  for (const [counter] of keys) counters[counter] = pairOf(snapshot.counters?.[counter], previous?.counters?.[counter]);
  const baseline = {
    matchId: String(snapshot.matchId),
    at: Math.max(at, previous?.at ?? 0),
    homeScore: countOf(snapshot.homeScore) ?? previous?.homeScore ?? null,
    awayScore: countOf(snapshot.awayScore) ?? previous?.awayScore ?? null,
    homeTeam: String(snapshot.homeTeam ?? '').trim() || previous?.homeTeam || null,
    awayTeam: String(snapshot.awayTeam ?? '').trim() || previous?.awayTeam || null,
    minute: countOf(snapshot.minute) ?? previous?.minute ?? null,
    counters,
  };
  if (!previous) return { baseline, alerts: [] };
  const alerts = [];
  const append = (kind, team, before, after) => {
    if (before === null || after === null || after <= before) return;
    alerts.push({
      id: [baseline.matchId, kind, team, before, after, baseline.at].join(':'),
      matchId: baseline.matchId, kind, team, count: after - before, at: baseline.at,
      minute: baseline.minute, homeTeam: baseline.homeTeam, awayTeam: baseline.awayTeam,
    });
  };
  append('goal','home',previous.homeScore,baseline.homeScore);
  append('goal','away',previous.awayScore,baseline.awayScore);
  for (const [counter,kind] of keys) {
    append(kind,'home',previous.counters?.[counter]?.home ?? null,baseline.counters[counter]?.home ?? null);
    append(kind,'away',previous.counters?.[counter]?.away ?? null,baseline.counters[counter]?.away ?? null);
  }
  return { baseline, alerts };
}
