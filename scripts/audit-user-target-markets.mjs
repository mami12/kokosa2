import fs from 'fs';
import { 
  classify, 
  gradeHeldNativeCombo, 
  unverifiedCompositeLine 
} from '../server/ledger/settler.mjs';
import { liveContract } from '../server/ledger/live-contract-rules.mjs';
import { isResultBttsMarket } from '../server/ledger/result-btts.mjs';
import { isResultTotalMarket, isTotalBttsMarket, isFirstHalfResultBtts,
  isWinnerTotalMarket, isTeamNotToLoseTotalMarket, isBttsTotalAndMarket } from '../server/ledger/mixed-combos.mjs';
import { isDcBttsMarket } from '../server/ledger/dc-btts.mjs';
import { isHalfComboFamily } from '../server/ledger/half-combinations.mjs';
import { isPeriodGoalTotal } from '../server/ledger/period-goal-totals.mjs';
import { isScoringPropMarket } from '../server/ledger/scoring-props.mjs';
import { isParityLikeMarket } from '../server/ledger/parity-markets.mjs';
import { isHtFtMarket } from '../server/ledger/ht-ft.mjs';
import { goalTotalContract } from '../server/ledger/goal-total-contract.mjs';
import { cornerTotalContract } from '../server/ledger/corner-total-contract.mjs';
import { isWinningMarginMarket } from '../server/ledger/winning-margin.mjs';
import { isDcHalfBttsMarket } from '../server/ledger/dc-half-btts.mjs';
import { isHtFtComboMarket } from '../server/ledger/htft-combo.mjs';
import { isMultiscoresMarket, isMatchbetFirstGoalMarket } from '../server/ledger/multiscores.mjs';
import { isQualificationMarket } from '../server/ledger/qualification.mjs';

const raw = fs.readFileSync('scripts/user-raw-input.txt', 'utf8');
const blocks = raw.split(/\bOrder\s*\n/);
const items = [];

for (const b of blocks) {
  if (!b.trim()) continue;
  const lines = b.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const orderNum = parseInt(lines[0], 10);
  if (isNaN(orderNum)) continue;
  const titleLine = lines[1] || '';
  let cleanTitle = titleLine.replace(/^(?:Live|Pre-match)\s*·\s*/i, '').trim();
  items.push({ order: orderNum, title: cleanTitle });
}

// User exclusions:
// 1. NON-FOOTBALL:
const NON_FOOTBALL_PATTERN = new RegExp([
  '\\b(?:innings?|boundary|wicket|wickets|batsman|bowler|runs?|sixes|fours|day\\s+session|partnership|first\\s+over|per\\s+over|super\\s+over)\\b',
  '\\bcricket\\b',
  '\\b(?:aces?|tie.?break|deuce|breakpoint|service\\s+fault|penta|to\\s+retire|retirements?|sets?|best\\s+of\\s+\\d+|game\\s+handicap|game\\s+winner)\\b',
  '\\b(?:frames?|break\\s+50\\+|break\\s+100\\+|highest\\s+break|century\\s+break|colour\\s+potted|180s?|checkouts?|segment\\s+winner|snooker|darts?|legs?)\\b',
  '\\b(?:quarters?|points?|rebounds?|dunks?|free\\s+throw|field\\s+goal|jump\\s+ball|basketball)\\b',
  '\\b(?:home\\s+run|strikeouts?|pitcher|batting|batter|base\\s+on\\s+balls|at\\s+bat|time\\s+at\\s+bat|pitch\\b|baseball)\\b',
  '\\b(?:touchdowns?|touchdown|try|tries|conversion|quarterback|passing\\s+yards|rushing\\s+yards|drive\\s+play|first\\s+down|pass\\s+completion|sack|yards?\\s+gained|rugby|nfl)\\b',
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

// 2. USER EXPLICIT DISCARD:
// - handicap: "kurse handicap mos i bej fare" -> NO HANDICAPS AT ALL
// - cards/bookings: "nuk do besh vetem kartonat" / "pervec kartonave bookings" -> NO CARDS/BOOKINGS AT ALL
// - fouls, tackles, throwins, shots, saves, offsides, player props, extra time/penalties:
const USER_DISCARD_REGEX = new RegExp([
  'handicap',
  'fora',
  'card',
  'booking',
  'foul',
  'tackle',
  'throw-in',
  'throwin',
  'shot',
  'substition',
  'sure sub',
  'substitut',
  'overtime',
  'over time',
  'extra time',
  'extratime',
  'penalty shootout',
  'ot only',
  'ot & pen',
  'incl\\. ot',
  'player',
  'goalscorer',
  'scorer',
  'assist',
  'carded',
  'sent off',
  'passes',
  'performance',
  'saves?',
  'offside'
].join('|'), 'i');

function checkSupported(title) {
  const normTitle = title.toLowerCase().trim();
  const dummyResult = {
    home_score: 2,
    away_score: 1,
    half_home_score: 1,
    half_away_score: 0,
    corners_home: 5,
    corners_away: 4,
    home_team: 'Home',
    away_team: 'Away',
    status: 'ended'
  };

  const dummyLine = { market_name: title, outcome_name: '1', outcome_key: '1', line: '2.5' };

  if (liveContract(dummyLine)) return true;

  for (const outcome of ['1', 'Yes', 'yes', 'Over', 'over', '1/1', 'Odd', 'None', 'home', 'away']) {
    const l = { market_name: title, outcome_name: outcome, outcome_key: outcome, line: '2.5' };
    if (gradeHeldNativeCombo(l, dummyResult) !== null) return true;
    if (liveContract(l)) return true;
  }

  if (unverifiedCompositeLine(dummyLine, dummyResult)) {
    return false;
  }

  if (isResultBttsMarket(normTitle)) return true;
  if (isResultTotalMarket(normTitle)) return true;
  if (isTotalBttsMarket(normTitle)) return true;
  if (isDcBttsMarket(normTitle)) return true;
  if (isWinnerTotalMarket(normTitle)) return true;
  if (isTeamNotToLoseTotalMarket(normTitle)) return true;
  if (isBttsTotalAndMarket(normTitle)) return true;
  if (isWinningMarginMarket(dummyLine)) return true;
  if (isDcHalfBttsMarket(normTitle)) return true;
  if (isHtFtComboMarket(normTitle)) return true;
  if (isMultiscoresMarket(normTitle)) return true;
  if (isMatchbetFirstGoalMarket(normTitle)) return true;
  if (isQualificationMarket(normTitle)) return true;
  if (isHalfComboFamily(dummyLine)) return true;
  if (isPeriodGoalTotal(dummyLine)) return true;
  if (isScoringPropMarket(dummyLine)) return true;
  if (isParityLikeMarket(dummyLine)) return true;
  if (isHtFtMarket(normTitle)) return true;
  if (goalTotalContract(dummyLine)) return true;
  if (cornerTotalContract(dummyLine)) return true;

  const fam = classify(normTitle);
  if (['1X2', 'TOTAL', 'BTTS', 'DC', 'DNB', 'CORRECT_SCORE', 'ODD_EVEN', 'CLEAN_SHEET', 'BANDS_EXACT',
       'ANY_TEAM_WIN', 'REST_OF_MATCH', 'TEAM_TO_SCORE_2ND_HALF', 'CORNERS', 'CORNER_1X2',
       'WILL_TIE', 'WINNING_MARGIN', 'WINNER_TOTAL', 'TEAM_NOT_TO_LOSE_TOTAL', 'BTTS_TOTAL_AND',
       'DC_HALF_BTTS', 'HTFT_COMBO', 'MULTISCORES', 'MATCHBET_FIRST_GOAL', 'TO_QUALIFY'].includes(fam)) {
    return true;
  }

  return false;
}

const targetItems = [];
const discarded = [];

for (const it of items) {
  if (NON_FOOTBALL_PATTERN.test(it.title)) {
    discarded.push({ ...it, reason: 'non-football' });
    continue;
  }
  if (USER_DISCARD_REGEX.test(it.title)) {
    discarded.push({ ...it, reason: 'user-excluded' });
    continue;
  }
  targetItems.push(it);
}

const uniqueTargets = new Map();
for (const it of targetItems) {
  const k = it.title.toLowerCase().trim();
  if (!uniqueTargets.has(k)) {
    uniqueTargets.set(k, { title: it.title, orders: [], supported: checkSupported(it.title) });
  }
  uniqueTargets.get(k).orders.push(it.order);
}

const missing = [];
const alreadyDone = [];
for (const v of uniqueTargets.values()) {
  if (v.supported) alreadyDone.push(v);
  else missing.push(v);
}

console.log('=== TARGET AUDIT ===');
console.log('Total items matching user football criteria:', targetItems.length);
console.log('Unique titles matching user football criteria:', uniqueTargets.size);
console.log('Already supported in code:', alreadyDone.length);
console.log('Missing/needs implementation:', missing.length);

fs.writeFileSync('scripts/missing-user-markets.json', JSON.stringify(missing, null, 2));
console.log('Wrote missing markets to scripts/missing-user-markets.json');
