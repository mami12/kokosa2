import fs from 'fs';

const items = JSON.parse(fs.readFileSync('scripts/missing-user-markets.json', 'utf8'));

const groups = {
  teamToWin: [],
  scoringProps: [],
  combos: [],
  intervals: [],
  restOfMatch: [],
  margin: [],
  outrightOrNonMatch: [],
  other: []
};

for (const it of items) {
  const t = it.title;
  if (/^(?:home|away)\s*team\s+to\s+win$/i.test(t)) {
    groups.teamToWin.push(t);
  } else if (/wins?\s+to\s+nil|wins?\s+(?:both|any\s+of\s+the)\s+halves|highest\s+scoring\s+team/i.test(t)) {
    groups.scoringProps.push(t);
  } else if (/&|\+|halftime\/fulltime|both teams to score and/i.test(t)) {
    groups.combos.push(t);
  } else if (/minute|interval|when will|who scores goal/i.test(t)) {
    groups.intervals.push(t);
  } else if (/rest\s+(?:of\s+the\s+)?(?:match|half)/i.test(t)) {
    groups.restOfMatch.push(t);
  } else if (/margin/i.test(t)) {
    groups.margin.push(t);
  } else if (/final|semifinal|qualify|tournament|free text|^-$|money line \(ot\)/i.test(t)) {
    groups.outrightOrNonMatch.push(t);
  } else {
    groups.other.push(t);
  }
}

for (const [k, arr] of Object.entries(groups)) {
  console.log(`\n=== ${k} (${arr.length}) ===`);
  console.log(arr.join('\n'));
}
