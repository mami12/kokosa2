import fs from 'fs';
import { 
  classify, 
  gradeHeldNativeCombo, 
  unverifiedCompositeLine 
} from '../server/ledger/settler.mjs';
import { isResultBttsMarket } from '../server/ledger/result-btts.mjs';
import { liveContract } from '../server/ledger/live-contract-rules.mjs';
import { isResultTotalMarket, isTotalBttsMarket, isFirstHalfResultBtts } from '../server/ledger/mixed-combos.mjs';
import { isDcBttsMarket } from '../server/ledger/dc-btts.mjs';
import { isHalfComboFamily } from '../server/ledger/half-combinations.mjs';
import { isPeriodGoalTotal } from '../server/ledger/period-goal-totals.mjs';
import { isScoringPropMarket } from '../server/ledger/scoring-props.mjs';
import { isParityLikeMarket } from '../server/ledger/parity-markets.mjs';
import { isHtFtMarket } from '../server/ledger/ht-ft.mjs';
import { goalTotalContract } from '../server/ledger/goal-total-contract.mjs';
import { cornerTotalContract } from '../server/ledger/corner-total-contract.mjs';

const raw = fs.readFileSync('scripts/user-raw-input.txt', 'utf8');

const blocks = raw.split(/\bOrder\s*\n/);
const items = [];

for (const b of blocks) {
  if (!b.trim()) continue;
  const lines = b.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const orderNum = parseInt(lines[0], 10);
  if (isNaN(orderNum)) continue;

  const titleLine = lines[1] || '';
  const statusLine = lines[lines.length - 1]; // Enabled or Hidden

  let cleanTitle = titleLine.replace(/^(?:Live|Pre-match)\s*·\s*/i, '').trim();

  items.push({
    order: orderNum,
    title: cleanTitle,
    rawTitle: titleLine,
    status: statusLine,
    fullText: b
  });
}

// User explicit exclusions:
// "pervec asian handicap mi listo ketu pervec foule tackles throwins shot on target substition over time penalty dhe shenon gol x lojtar"
const USER_EXCLUDE_REGEX = new RegExp([
  'asian',
  'fouls?',
  'tackles?',
  'throw[\\s-]?ins?',
  'shots?\\s+on\\s+(?:target|goal)',
  'substition',
  'substitut',
  'overtime',
  'over time',
  'extra time',
  'extratime',
  'penalt(?:y|ies)',
  'ot only',
  'ot & pen',
  'incl\\. ot',
  '(?:anytime )?goalscorers?',
  'scores?\\s+№?.*goal\\s*&\\s*correct score',
  'player.*(?:to score|scores?\\s+(?:a )?goal|goalscorer)',
].join('|'), 'i');

// Non-football sports:
const NON_FOOTBALL_PATTERN = new RegExp([
  '\\b(?:innings?|boundary|wicket|wickets|batsman|bowler|runs?|sixes|fours|day\\s+session|partnership|first\\s+over|per\\s+over|super\\s+over)\\b',
  '\\bcricket\\b',
  '\\b(?:aces?|tie.?break|deuce|breakpoint|service\\s+fault|penta|to\\s+retire|retirements?|sets?|best\\s+of\\s+\\d+|game\\s+handicap|game\\s+winner)\\b',
  '\\b(?:frames?|break\\s+50\\+|break\\s+100\\+|highest\\s+break|century\\s+break|colour\\s+potted|180s?|checkouts?|segment\\s+winner|snooker|darts?|legs?)\\b',
  '\\b(?:quarters?|points?|rebounds?|dunks?|free\\s+throw|field\\s+goal|jump\\s+ball|basketball)\\b',
  '\\b(?:home\\s+run|strikeouts?|pitcher|batting|batter|base\\s+on\\s+balls|at\\s+bat|time\\s+at\\s+bat|pitch\\b|baseball)\\b',
  '\\b(?:touchdowns?|touchdown|try|tries|conversion|quarterback|passing\\s+yards|rushing\\s+yards|drive\\s+play|first\\s+down|pass\\s+completion|sack|yards?\\s+gained|rugby|nfl)\\b',
  '\\b(?:h2h|money line \\(ot\\)|next first value scoring play|result of range hit|round advantage|top second value|top 3 \\(teams\\)|when will the match be decided|winning method|2nd place in the tournament|which team will win the final|free text market|short term free text market)\\b',

  '\\b(?:puck|puck\\s+line|powerplay|empty\\s+net|period\\s+and\\s+matchbet|period\\s+result|hockey)\\b',
  '\\b(?:periods?\\b)',
  '\\b(?:knockout|tko|submission|round\\s+\\d+|rounds?\\s+handicap|rounds?\\s+odd|method\\s+of\\s+victory|fighter|knockdowns?|strikes?\\s+landed|boxing|mma|ufc|fight\\s+ends)\\b',
  '\\b(?:maps?|kills?|dragon|baron|roshan|pistol\\s+round|first\\s+blood|bomb\\s+defused|bomb\\s+planted|aegis|barracks|inhibitor|tower|esports?)\\b',
  '\\b(?:stage|pole\\s+position|fastest\\s+lap|lap\\s+-|pit\\s+stop|finishers|formula)\\b',
  '\\bwindex\\b',
  '\\bsupremacy\\b',
  '\\bdismissal\\b',
  '\\bgrid\\s+position\\b'
].join('|'), 'i');

function hasNativeParameterizedSettlementPath(title) {
  const t=String(title??'').toLowerCase().replace(/\s+/g,' ').trim();
  if(/^\d{1,2} minutes? - (?:total (?:goals?|corners?|cards?|offsides?)|(?:home|away)team total corners|(?:corner|card) result|corner handicap|1st corner|odd\/even corners?|(?:home|away)team red card|red card|№ value goal|result) from first value/.test(t))return true;
  if(/^1 minute - total (?:goals?|corners?|offsides?) from first value:00 to value min$/.test(t))return true;
  if(/\bin minutes time range(?: \(\d{1,2}-minute interval\))?$/.test(t)&&
     /^(?:total |who scores|who takes|who receives|corner handicap)/.test(t))return true;
  if(/\bin \d{1,2} minutes? interval \d{1,3}-\d{1,3}$/.test(t)&&
     /^(?:total |who scores|who takes|who receives|corner handicap)/.test(t))return true;
  return false;
}

function isSupportedInSettler(title) {
  const normTitle = title.toLowerCase().trim();
  if (hasNativeParameterizedSettlementPath(title)) return true;
  const dummyResult = {
    home_score: 2,
    away_score: 1,
    half_home_score: 1,
    half_away_score: 0,
    home_team: 'Home',
    away_team: 'Away',
    status: 'ended'
  };

  for (const outcome of ['1', 'X', '2', 'Yes', 'No', 'Over 0.5', 'Under 0.5', '1/1', 'Odd', 'Even', 'None', 'home', 'away']) {
    const dummyLine = { market_name: title, outcome_name: outcome, outcome_key: outcome };
    if (gradeHeldNativeCombo(dummyLine, dummyResult) !== null) return true;
    try {
      if (liveContract(dummyLine, {counts:{goal:{home:0,away:0},corner:{home:0,away:0},card:{home:0,away:0}},clock:0,teams:{home:'Home',away:'Away'}})) return true;
    } catch {}
  }

  const dummyLine = { market_name: title, outcome_name: '1', outcome_key: '1' };

  if (unverifiedCompositeLine(dummyLine, dummyResult)) {
    return false;
  }

  if (isResultBttsMarket(normTitle)) return true;
  if (isResultTotalMarket(normTitle)) return true;
  if (isTotalBttsMarket(normTitle)) return true;
  if (isDcBttsMarket(normTitle)) return true;
  if (isHalfComboFamily(dummyLine)) return true;
  if (isPeriodGoalTotal(dummyLine)) return true;
  if (isScoringPropMarket(dummyLine)) return true;
  if (isParityLikeMarket(dummyLine)) return true;
  if (isHtFtMarket(normTitle)) return true;
  if (goalTotalContract(dummyLine)) return true;
  if (cornerTotalContract(dummyLine)) return true;

  const fam = classify(normTitle);
  if (['1X2', 'TOTAL', 'BTTS', 'DC', 'DNB', 'CORRECT_SCORE', 'ODD_EVEN', 'CLEAN_SHEET', 'BANDS_EXACT', 'ANY_TEAM_WIN', 'REST_OF_MATCH', 'TEAM_TO_SCORE_2ND_HALF'].includes(fam)) {
    return true;
  }

  return false;
}

const excludedByUser = [];
const nonFootball = [];
const hiddenByUser = [];
const alreadySupported = [];
const notImplementedYet = [];

for (const it of items) {
  const t = it.title;

  // The supplied catalog explicitly marks disabled markets. They are not
  // part of the user's active settlement scope and must not inflate gaps.
  if (it.status !== 'Enabled') {
    hiddenByUser.push(it);
    continue;
  }

  if (NON_FOOTBALL_PATTERN.test(t)) {
    nonFootball.push(it);
    continue;
  }

  if (USER_EXCLUDE_REGEX.test(t)) {
    excludedByUser.push(it);
    continue;
  }

  const supported = isSupportedInSettler(t);
  if (supported) {
    alreadySupported.push(it);
  } else {
    notImplementedYet.push(it);
  }
}

console.log('=== EXACT BREAKDOWN ===');
console.log('Total items in raw user list:', items.length);
console.log('1. Excluded by user explicit instruction (Asian, player, fouls, tackles, throwins, shots, sub, OT/pen):', excludedByUser.length);
console.log('2. Hidden/disabled in the supplied catalog:', hiddenByUser.length);
console.log('3. Excluded non-football sports (cricket, tennis, snooker, rugby, baseball, etc.):', nonFootball.length);
console.log('4. Real Football - Të bëra (Në rregull / Mbulohen):', alreadySupported.length);
console.log('5. Real Football - Të pa-implementuara akoma:', notImplementedYet.length);

const uniqueNotImpl = new Map();
for (const it of notImplementedYet) {
  const k = it.title.toLowerCase().trim();
  if (!uniqueNotImpl.has(k)) {
    uniqueNotImpl.set(k, { title: it.title, orders: [] });
  }
  uniqueNotImpl.get(k).orders.push(it.order);
}

console.log('\nUnique Not Implemented count:', uniqueNotImpl.size);

// Group not implemented into logical families:
const families = {
  intervals: [],
  halfProps: [],
  combos: [],
  handicaps: [],
  cards: [],
  other: []
};

for (const [k, v] of uniqueNotImpl.entries()) {
  const t = v.title;
  if (/minute|interval|when will|who scores goal in/i.test(t)) {
    families.intervals.push(v);
  } else if (/card|booking|red card/i.test(t)) {
    families.cards.push(v);
  } else if (/corner/i.test(t)) {
    families.halfProps.push(v);
  } else if (/&|\+|halftime\/fulltime &|double chance &/i.test(t)) {
    families.combos.push(v);
  } else if (/handicap/i.test(t)) {
    families.handicaps.push(v);
  } else {
    families.other.push(v);
  }
}


const uniqueMissing=[...uniqueNotImpl.values()].map(v=>({
 title:v.title,orders:v.orders,supported:false
}));
fs.writeFileSync('scripts/missing-user-markets.json',
 JSON.stringify(uniqueMissing,null,2),'utf8');

fs.writeFileSync('scripts/audit-families.json', JSON.stringify(families, null, 2), 'utf8');
console.log('Families breakdown:');
for (const [fam, arr] of Object.entries(families)) {
  console.log(`- ${fam}: ${arr.length} unique markets`);
}
