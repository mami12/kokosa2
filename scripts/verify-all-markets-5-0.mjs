/**
 * Comprehensive contradiction checker for ALL market families.
 * Score: Germany 5 – Netherlands 0,  HT: 5-0 (all goals 1st half).
 *
 * For every market family, we test both "sides" of a bet (Yes/No, Over/Under,
 * Home/Away, etc.) and verify:
 *   1. No contradictions (same market giving WON to both sides)
 *   2. No false pending (null) when enough data exists
 *   3. Correct outcomes per the 5-0 score
 *
 * EXCLUDED (per user request): fouls, throw-ins, tackles, cards, saves,
 * shots on target, Asian handicap, bookings.
 */
import './fixtures/isolated-casino-env.mjs';
import { gradeLine, classify } from '../server/ledger/settler.mjs';

const R = {
  home_team: 'Germany', away_team: 'Netherlands',
  home_score: 5, away_score: 0,
  half_home_score: 5, half_away_score: 0,
  corners_home: 7, corners_away: 3,
};

// 2nd half: 0-0
const H = R.home_score - R.half_home_score; // 0
const A = R.away_score - R.half_away_score; // 0
const TOTAL = R.home_score + R.away_score;  // 5
const HT_TOTAL = R.half_home_score + R.half_away_score; // 5

let pass = 0, fail = 0, pendingReport = [];

function check(label, line, expected) {
  const got = gradeLine(line, R);
  if (got === expected) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL  ${label}`);
    console.log(`        market: ${line.market_name}`);
    console.log(`        outcome: ${line.outcome_name ?? line.outcome_key}`);
    console.log(`        expected: ${expected}  got: ${got}`);
  }
}

function checkPair(label, marketName, yesOutcome, noOutcome, expectedYes, expectedNo, extra = {}) {
  const lineY = { market_name: marketName, outcome_name: yesOutcome, outcome_key: yesOutcome?.toLowerCase?.(), ...extra };
  const lineN = { market_name: marketName, outcome_name: noOutcome, outcome_key: noOutcome?.toLowerCase?.(), ...extra };
  const gotY = gradeLine(lineY, R);
  const gotN = gradeLine(lineN, R);

  // Check contradiction
  if (gotY === 'WON' && gotN === 'WON') {
    fail++;
    console.log(`  CONTRADICTION  ${label}`);
    console.log(`     "${yesOutcome}" = WON  AND  "${noOutcome}" = WON`);
    return;
  }
  // Check individual results
  if (gotY !== expectedYes) {
    fail++;
    console.log(`  FAIL  ${label} [${yesOutcome}]  expected=${expectedYes}  got=${gotY}`);
  } else { pass++; }
  if (gotN !== expectedNo) {
    fail++;
    console.log(`  FAIL  ${label} [${noOutcome}]  expected=${expectedNo}  got=${gotN}`);
  } else { pass++; }

  // report any unexpected pending
  if (gotY === null && expectedYes !== null) pendingReport.push(`${label} [${yesOutcome}]`);
  if (gotN === null && expectedNo !== null) pendingReport.push(`${label} [${noOutcome}]`);
}

console.log('=== Score: Germany 5-0 Netherlands, HT 5-0 ===\n');

// ================================================================
// 1. FULL TIME RESULT (1X2)
// ================================================================
console.log('--- 1X2 / Match Result ---');
check('FT 1X2: Home', { market_name: 'Full time result', outcome_name: '1', outcome_key: '1' }, 'WON');
check('FT 1X2: Draw', { market_name: 'Full time result', outcome_name: 'X', outcome_key: 'x' }, 'LOST');
check('FT 1X2: Away', { market_name: 'Full time result', outcome_name: '2', outcome_key: '2' }, 'LOST');

// ================================================================
// 2. DOUBLE CHANCE
// ================================================================
console.log('--- Double Chance ---');
check('DC: 1X', { market_name: 'Double chance', outcome_name: '1X', outcome_key: '1x' }, 'WON');
check('DC: 12', { market_name: 'Double chance', outcome_name: '12', outcome_key: '12' }, 'WON');
check('DC: X2', { market_name: 'Double chance', outcome_name: 'X2', outcome_key: 'x2' }, 'LOST');

// ================================================================
// 3. BTTS (Both Teams To Score)
// ================================================================
console.log('--- BTTS ---');
// 5-0: only home scored → BTTS = No
checkPair('BTTS', 'Both teams to score', 'Yes', 'No', 'LOST', 'WON');

// ================================================================
// 4. OVER/UNDER (various thresholds)
// ================================================================
console.log('--- Over/Under ---');
for (const threshold of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]) {
  const overWins = TOTAL > threshold;
  checkPair(
    `O/U ${threshold}`,
    `Total goals over/under (${threshold})`,
    'Over', 'Under',
    overWins ? 'WON' : 'LOST',
    overWins ? 'LOST' : 'WON',
    { line: String(threshold) }
  );
}

// ================================================================
// 5. 1st HALF OVER/UNDER
// ================================================================
console.log('--- 1st Half Over/Under ---');
for (const threshold of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
  const overWins = HT_TOTAL > threshold;
  checkPair(
    `1H O/U ${threshold}`,
    `1st half - Total goals over/under (${threshold})`,
    'Over', 'Under',
    overWins ? 'WON' : 'LOST',
    overWins ? 'LOST' : 'WON',
    { line: String(threshold) }
  );
}

// ================================================================
// 6. 2nd HALF OVER/UNDER
// ================================================================
console.log('--- 2nd Half Over/Under ---');
const HALF2_TOTAL = H + A; // 0
for (const threshold of [0.5, 1.5, 2.5]) {
  const overWins = HALF2_TOTAL > threshold;
  checkPair(
    `2H O/U ${threshold}`,
    `2nd half - Total goals over/under (${threshold})`,
    'Over', 'Under',
    overWins ? 'WON' : 'LOST',
    overWins ? 'LOST' : 'WON',
    { line: String(threshold) }
  );
}

// ================================================================
// 7. ODD/EVEN
// ================================================================
console.log('--- Odd/Even ---');
// 5 goals = odd
checkPair('Odd/Even', 'Odd/Even', 'Odd', 'Even', 'WON', 'LOST');

// ================================================================
// 8. CORRECT SCORE
// ================================================================
console.log('--- Correct Score ---');
check('CS: 5-0', { market_name: 'Correct score', outcome_name: '5-0', outcome_key: '5:0' }, 'WON');
check('CS: 5-1', { market_name: 'Correct score', outcome_name: '5-1', outcome_key: '5:1' }, 'LOST');
check('CS: 0-0', { market_name: 'Correct score', outcome_name: '0-0', outcome_key: '0:0' }, 'LOST');
check('CS: 1-0', { market_name: 'Correct score', outcome_name: '1-0', outcome_key: '1:0' }, 'LOST');
check('CS: 0-5', { market_name: 'Correct score', outcome_name: '0-5', outcome_key: '0:5' }, 'LOST');

// ================================================================
// 9. DNB (Draw No Bet)
// ================================================================
console.log('--- DNB ---');
check('DNB: Home', { market_name: 'Draw no bet', outcome_name: '1', outcome_key: '1' }, 'WON');
check('DNB: Away', { market_name: 'Draw no bet', outcome_name: '2', outcome_key: '2' }, 'LOST');

// ================================================================
// 10. CLEAN SHEET
// ================================================================
console.log('--- Clean Sheet ---');
// 5-0: Home kept clean sheet (away scored 0), away did NOT keep CS (home scored 5)
checkPair('Home CS', 'Home team clean sheet', 'Yes', 'No', 'WON', 'LOST');
checkPair('Away CS', 'Away team clean sheet', 'Yes', 'No', 'LOST', 'WON');
checkPair('Any CS', 'Any clean sheet', 'Yes', 'No', 'WON', 'LOST');
checkPair('Draw or CS', 'Draw or any clean sheet', 'Yes', 'No', 'WON', 'LOST');
checkPair('Home win or CS', 'Home team wins or any clean sheet', 'Yes', 'No', 'WON', 'LOST');
// 5-0: Germany kept clean sheet (away=0), so 'any clean sheet' is TRUE => Yes is WON
checkPair('Away win or CS', 'Away team wins or any clean sheet', 'Yes', 'No', 'WON', 'LOST');

// ================================================================
// 11. HT/FT
// ================================================================
console.log('--- HT/FT ---');
// HT: 5-0 → Home wins (1). FT: 5-0 → Home wins (1). So HT/FT = 1/1
check('HT/FT 1/1', { market_name: 'Halftime/Fulltime', outcome_name: '1/1', outcome_key: '1/1' }, 'WON');
check('HT/FT 1/X', { market_name: 'Halftime/Fulltime', outcome_name: '1/X', outcome_key: '1/x' }, 'LOST');
check('HT/FT 1/2', { market_name: 'Halftime/Fulltime', outcome_name: '1/2', outcome_key: '1/2' }, 'LOST');
check('HT/FT X/1', { market_name: 'Halftime/Fulltime', outcome_name: 'X/1', outcome_key: 'x/1' }, 'LOST');
check('HT/FT X/X', { market_name: 'Halftime/Fulltime', outcome_name: 'X/X', outcome_key: 'x/x' }, 'LOST');
check('HT/FT 2/2', { market_name: 'Halftime/Fulltime', outcome_name: '2/2', outcome_key: '2/2' }, 'LOST');

// ================================================================
// 12. HT/FT CORRECT SCORE
// ================================================================
console.log('--- HT/FT Correct Score ---');
check('HTFT CS: 5-0 5-0', { market_name: 'Halftime/Fulltime correct score', outcome_name: '5-0 5-0' }, 'WON');
check('HTFT CS: 5-0 / 5+', { market_name: 'Halftime/Fulltime correct score', outcome_name: '5-0 / 5+' }, 'WON');
check('HTFT CS: 4+ / 4+', { market_name: 'Halftime/Fulltime correct score', outcome_name: '4+ / 4+' }, 'WON');
check('HTFT CS: 4+ / 5+', { market_name: 'Halftime/Fulltime correct score', outcome_name: '4+ / 5+' }, 'WON');
check('HTFT CS: 0-0 0-0', { market_name: 'Halftime/Fulltime correct score', outcome_name: '0-0 0-0' }, 'LOST');
check('HTFT CS: 1-0 1-0', { market_name: 'Halftime/Fulltime correct score', outcome_name: '1-0 1-0' }, 'LOST');
check('HTFT CS: 1-0 / 4+', { market_name: 'Halftime/Fulltime correct score', outcome_name: '1-0 / 4+' }, 'LOST');
check('HTFT CS: 0-3 / 4+', { market_name: 'Halftime/Fulltime correct score', outcome_name: '0-3 / 4+' }, 'LOST');

// ================================================================
// 13. HT/FT & TOTAL GOALS
// ================================================================
console.log('--- HT/FT & Total Goals ---');
check('HTFT+Total: 1/1 Over 2.5', { market_name: 'HT/FT & total goals', outcome_name: '1/1 & Over 2.5' }, 'WON');
check('HTFT+Total: 1/1 Under 2.5', { market_name: 'HT/FT & total goals', outcome_name: '1/1 & Under 2.5' }, 'LOST');
check('HTFT+Total: X/X Over 2.5', { market_name: 'HT/FT & total goals', outcome_name: 'X/X & Over 2.5' }, 'LOST');
check('HTFT+Total: 1/1 Over 4.5', { market_name: 'HT/FT & total goals', outcome_name: '1/1 & Over 4.5' }, 'WON');
check('HTFT+Total: 1/1 Under 4.5', { market_name: 'HT/FT & total goals', outcome_name: '1/1 & Under 4.5' }, 'LOST');

// ================================================================
// 14. HT/FT & EXACT GOALS
// ================================================================
console.log('--- HT/FT & Exact Goals ---');
check('HTFT+Exact: 1/1 - 5', { market_name: 'Halftime/fulltime & exact goals', outcome_name: '1/1 - 5' }, 'WON');
check('HTFT+Exact: 1/1 - 3', { market_name: 'Halftime/fulltime & exact goals', outcome_name: '1/1 - 3' }, 'LOST');
check('HTFT+Exact: X/X - 5', { market_name: 'Halftime/fulltime & exact goals', outcome_name: 'X/X - 5' }, 'LOST');
check('HTFT+Exact: 1/1 - 5+', { market_name: 'Halftime/fulltime & exact goals', outcome_name: '1/1 - 5+' }, 'WON');
check('HTFT+Exact: 1/1 - 6+', { market_name: 'Halftime/fulltime & exact goals', outcome_name: '1/1 - 6+' }, 'LOST');

// ================================================================
// 15. HT/FT & BTTS
// ================================================================
console.log('--- HT/FT & BTTS ---');
// 5-0: HT/FT = 1/1, BTTS = No
check('HTFT+BTTS: 1/1 & No', { market_name: 'Halftime/fulltime & both teams to score', outcome_name: '1/1 & No' }, 'WON');
check('HTFT+BTTS: 1/1 & Yes', { market_name: 'Halftime/fulltime & both teams to score', outcome_name: '1/1 & Yes' }, 'LOST');
check('HTFT+BTTS: X/X & No', { market_name: 'Halftime/fulltime & both teams to score', outcome_name: 'X/X & No' }, 'LOST');

// ================================================================
// 16. DC & BTTS
// ================================================================
console.log('--- DC & BTTS ---');
check('DC+BTTS: 1X & No', { market_name: 'Double chance & both teams to score', outcome_name: '1X & No' }, 'WON');
check('DC+BTTS: 1X & Yes', { market_name: 'Double chance & both teams to score', outcome_name: '1X & Yes' }, 'LOST');
check('DC+BTTS: X2 & No', { market_name: 'Double chance & both teams to score', outcome_name: 'X2 & No' }, 'LOST');
check('DC+BTTS: X2 & Yes', { market_name: 'Double chance & both teams to score', outcome_name: 'X2 & Yes' }, 'LOST');

// ================================================================
// 17. WINNER & TOTAL
// ================================================================
console.log('--- Winner & Total ---');
check('Win+Total: Home & Over 2.5', { market_name: 'Winner & total', outcome_name: 'Home & Over 2.5' }, 'WON');
check('Win+Total: Home & Under 2.5', { market_name: 'Winner & total', outcome_name: 'Home & Under 2.5' }, 'LOST');
check('Win+Total: Away & Over 2.5', { market_name: 'Winner & total', outcome_name: 'Away & Over 2.5' }, 'LOST');
check('Win+Total: Draw & Over 2.5', { market_name: 'Winner & total', outcome_name: 'Draw & Over 2.5' }, 'LOST');

// ================================================================
// 18. TEAM NOT TO LOSE & TOTAL
// ================================================================
console.log('--- Team Not To Lose & Total ---');
checkPair('Home NTL Over 2.5', 'Hometeam not to lose & total over 2.5', 'Yes', 'No', 'WON', 'LOST');
checkPair('Away NTL Over 2.5', 'Awayteam not to lose & total over 2.5', 'Yes', 'No', 'LOST', 'WON');
checkPair('Home NTL Under 2.5', 'Hometeam not to lose & total under 2.5', 'Yes', 'No', 'LOST', 'WON');

// ================================================================
// 19. BTTS & TOTAL
// ================================================================
console.log('--- BTTS & Total ---');
// BTTS = No at 5-0, so all BTTS+Total = LOST
checkPair('BTTS+Total Over 2.5', 'Both teams to score and total over 2.5', 'Yes', 'No', 'LOST', 'WON');
checkPair('BTTS+Total Under 2.5', 'Both teams to score and total under 2.5', 'Yes', 'No', 'LOST', 'WON');

// ================================================================
// 20. WINNING MARGIN
// ================================================================
console.log('--- Winning Margin ---');
// Home wins by 5
check('WM: Home by 5', { market_name: 'Winning margin', outcome_name: 'Home by 5' }, 'WON');
check('WM: Home by 5+', { market_name: 'Winning margin', outcome_name: 'Home by 5+' }, 'WON');
check('WM: Home by 4+', { market_name: 'Winning margin', outcome_name: 'Home by 4+' }, 'WON');
check('WM: Home by 1', { market_name: 'Winning margin', outcome_name: 'Home by 1' }, 'LOST');
check('WM: Home by 1-2', { market_name: 'Winning margin', outcome_name: 'Home by 1-2' }, 'LOST');
check('WM: Home by 3-4', { market_name: 'Winning margin', outcome_name: 'Home by 3-4' }, 'LOST');
check('WM: Away by 1', { market_name: 'Winning margin', outcome_name: 'Away by 1' }, 'LOST');
check('WM: Draw', { market_name: 'Winning margin', outcome_name: 'Draw' }, 'LOST');

// ================================================================
// 21. MULTISCORES
// ================================================================
console.log('--- Multiscores ---');
check('MS: includes 5:0', { market_name: 'Multiscores', outcome_name: '5:0, 6:0, 7:0' }, 'WON');
check('MS: does not include', { market_name: 'Multiscores', outcome_name: '1:0, 2:0, 3:0' }, 'LOST');
check('MS: away wins', { market_name: 'Multiscores', outcome_name: '0:1, 0:2, 0:3' }, 'LOST');

// ================================================================
// 22. EXACT GOALS (Bands)
// ================================================================
console.log('--- Exact Goals / Bands ---');
check('Exact: 5 goals', { market_name: 'Total goals (exact)', outcome_name: '5', outcome_key: '5' }, 'WON');
check('Exact: 4 goals', { market_name: 'Total goals (exact)', outcome_name: '4', outcome_key: '4' }, 'LOST');
check('Exact: 6 goals', { market_name: 'Total goals (exact)', outcome_name: '6', outcome_key: '6' }, 'LOST');
check('Exact: 5+ goals', { market_name: 'Total goals (exact)', outcome_name: '5+', outcome_key: '5+' }, 'WON');

// ================================================================
// 23. CHANCE MIX
// ================================================================
console.log('--- Chance Mix (X or Y) ---');
// 5-0: draw=no, BTTS=no → "Draw or BTTS" = No
checkPair('Draw or BTTS', 'Draw or both teams to score', 'Yes', 'No', 'LOST', 'WON');
// 5-0: home win=yes → "Home win or BTTS" = Yes
checkPair('Home win or BTTS', 'Home team wins or both teams to score', 'Yes', 'No', 'WON', 'LOST');
// 5-0: away win=no, BTTS=no → "Away win or BTTS" = No
checkPair('Away win or BTTS', 'Away team wins or both teams to score', 'Yes', 'No', 'LOST', 'WON');
// 5-0: draw=no, total over 2.5 = yes → "Draw or total over" = Yes
checkPair('Draw or Total Over 2.5', 'Draw or total goals over', 'Yes', 'No', 'WON', 'LOST', { line: '2.5' });
// 5-0: home win=yes → "Home win or Total Over" = Yes
checkPair('Home win or Total Over 2.5', 'Home team wins or total goals over', 'Yes', 'No', 'WON', 'LOST', { line: '2.5' });
// 5-0: draw=no, total under 2.5 = no → "Draw or total under 2.5" = No
checkPair('Draw or Total Under 2.5', 'Draw or total goals under', 'Yes', 'No', 'LOST', 'WON', { line: '2.5' });

// ================================================================
// 24. WILL THERE BE A TIE
// ================================================================
console.log('--- Will There Be A Tie ---');
checkPair('Tie', 'Will there be a tie', 'Yes', 'No', 'LOST', 'WON');

// ================================================================
// 25. HALFTIME RESULT (1st half 1X2)
// ================================================================
console.log('--- Halftime Result ---');
// HT: 5-0 → Home wins
check('HT 1X2: Home', { market_name: 'Halftime - 3 way', outcome_name: '1', outcome_key: '1' }, 'WON');
check('HT 1X2: Draw', { market_name: 'Halftime - 3 way', outcome_name: 'X', outcome_key: 'x' }, 'LOST');
check('HT 1X2: Away', { market_name: 'Halftime - 3 way', outcome_name: '2', outcome_key: '2' }, 'LOST');

// ================================================================
// 26. 1st HALF CORRECT SCORE
// ================================================================
console.log('--- 1st Half Correct Score ---');
check('1H CS: 5-0', { market_name: '1st half - Correct score', outcome_name: '5-0', outcome_key: '5:0' }, 'WON');
check('1H CS: 1-0', { market_name: '1st half - Correct score', outcome_name: '1-0', outcome_key: '1:0' }, 'LOST');
check('1H CS: 0-0', { market_name: '1st half - Correct score', outcome_name: '0-0', outcome_key: '0:0' }, 'LOST');

// ================================================================
// 27. HOME/AWAY TEAM TOTAL GOALS
// ================================================================
console.log('--- Home/Away Team Totals ---');
checkPair('Home Team Over 2.5', 'Home team total goals over/under', 'Over', 'Under', 'WON', 'LOST', { line: '2.5' });
checkPair('Home Team Over 4.5', 'Home team total goals over/under', 'Over', 'Under', 'WON', 'LOST', { line: '4.5' });
checkPair('Home Team Over 5.5', 'Home team total goals over/under', 'Over', 'Under', 'LOST', 'WON', { line: '5.5' });
checkPair('Away Team Over 0.5', 'Away team total goals over/under', 'Over', 'Under', 'LOST', 'WON', { line: '0.5' });

// ================================================================
// 28. RESULT + BTTS (e.g. "1 & GG")
// ================================================================
console.log('--- Result & BTTS ---');
// 5-0: Home wins, BTTS = No
check('Res+BTTS: 1 & NG', { market_name: 'Result & both teams to score', outcome_name: '1 & No', outcome_key: '1_ng' }, 'WON');
check('Res+BTTS: 1 & GG', { market_name: 'Result & both teams to score', outcome_name: '1 & Yes', outcome_key: '1_gg' }, 'LOST');
check('Res+BTTS: X & NG', { market_name: 'Result & both teams to score', outcome_name: 'X & No', outcome_key: 'x_ng' }, 'LOST');
check('Res+BTTS: 2 & GG', { market_name: 'Result & both teams to score', outcome_name: '2 & Yes', outcome_key: '2_gg' }, 'LOST');

// ================================================================
// 29. RESULT & TOTAL (e.g. "1 & Over 2.5")
// ================================================================
console.log('--- Result & Total ---');
check('Res+Total: 1 & Over 2.5', { market_name: 'Result & total goals', outcome_name: '1 & Over 2.5', outcome_key: '1_over_2.5' }, 'WON');
check('Res+Total: 1 & Under 2.5', { market_name: 'Result & total goals', outcome_name: '1 & Under 2.5', outcome_key: '1_under_2.5' }, 'LOST');
check('Res+Total: X & Over 2.5', { market_name: 'Result & total goals', outcome_name: 'X & Over 2.5', outcome_key: 'x_over_2.5' }, 'LOST');

// ================================================================
// 30. HOME/AWAY TEAM WINS BOTH HALVES
// ================================================================
console.log('--- Team Wins Both Halves ---');
// HT 5-0 (home wins), 2H 0-0 (draw) → Home does NOT win both halves
// Actually 2H is 0-0 so home doesn't win 2nd half
checkPair('Home wins both halves', 'Home team wins both halves', 'Yes', 'No', 'LOST', 'WON');
checkPair('Away wins both halves', 'Away team wins both halves', 'Yes', 'No', 'LOST', 'WON');

// ================================================================
// 31. HOME/AWAY TEAM WINS ANY HALF
// ================================================================
console.log('--- Team Wins Any Half ---');
// Home won 1st half → "Home wins any" = Yes
checkPair('Home wins any half', 'Home team wins any of the halves', 'Yes', 'No', 'WON', 'LOST');
// Away won neither half
checkPair('Away wins any half', 'Away team wins any of the halves', 'Yes', 'No', 'LOST', 'WON');

// ================================================================
// 32. HALFTIME - WHO WINS THE REST
// ================================================================
console.log('--- Who Wins The Rest ---');
// 2nd half 0-0 → Draw in rest
check('Rest: Home', { market_name: 'Halftime - Who wins the rest?', outcome_name: '1', outcome_key: '1' }, 'LOST');
check('Rest: Draw', { market_name: 'Halftime - Who wins the rest?', outcome_name: 'X', outcome_key: 'x' }, 'WON');
check('Rest: Away', { market_name: 'Halftime - Who wins the rest?', outcome_name: '2', outcome_key: '2' }, 'LOST');

// ================================================================
// 33. HOME/AWAY WINS TO NIL
// ================================================================
console.log('--- Win To Nil ---');
// Home 5, Away 0 → Home win to nil = Yes
checkPair('Home win to nil', 'Home team wins to nil', 'Yes', 'No', 'WON', 'LOST');
checkPair('Away win to nil', 'Away team wins to nil', 'Yes', 'No', 'LOST', 'WON');

// ================================================================
// 34. DC & 1ST HALF BTTS
// ================================================================
console.log('--- DC & 1st Half BTTS ---');
// 1st half 5-0 → BTTS in 1H = No. FT: Home win → 1X, 12 work
check('DC+1H BTTS: 1X & No', { market_name: 'Double chance & 1st half both teams to score', outcome_name: '1X & No' }, 'WON');
check('DC+1H BTTS: 1X & Yes', { market_name: 'Double chance & 1st half both teams to score', outcome_name: '1X & Yes' }, 'LOST');
check('DC+1H BTTS: X2 & No', { market_name: 'Double chance & 1st half both teams to score', outcome_name: 'X2 & No' }, 'LOST');

// ================================================================
// 35. TO QUALIFY
// ================================================================
console.log('--- Qualification ---');
check('Qualify: Home', { market_name: 'To Qualify', outcome_name: 'Germany' }, 'WON');
check('Qualify: Away', { market_name: 'To Qualify', outcome_name: 'Netherlands' }, 'LOST');

// ================================================================
// 36. TOTAL BTTS (Total goals & BTTS combined)
// ================================================================
console.log('--- Total & BTTS ---');
// BTTS=No so "Over 2.5 & GG" = LOST, "Over 2.5 & NG" = WON
check('Total+BTTS: Over 2.5 & NG', { market_name: 'Total goals & both teams to score', outcome_name: 'Over 2.5 & No', outcome_key: 'over_2.5_ng', line: '2.5' }, 'WON');
check('Total+BTTS: Over 2.5 & GG', { market_name: 'Total goals & both teams to score', outcome_name: 'Over 2.5 & Yes', outcome_key: 'over_2.5_gg', line: '2.5' }, 'LOST');
check('Total+BTTS: Under 2.5 & NG', { market_name: 'Total goals & both teams to score', outcome_name: 'Under 2.5 & No', outcome_key: 'under_2.5_ng', line: '2.5' }, 'LOST');

// ================================================================
// 37. MATCHBET & FIRST GOAL
// ================================================================
console.log('--- First Goal & Match Result ---');
check('1stGoal: Home/Home', { market_name: 'First goal & match result', outcome_name: '1st goal 1 / Result 1' }, 'WON');
check('1stGoal: Home/Draw', { market_name: 'First goal & match result', outcome_name: '1st goal 1 / Result X' }, 'LOST');
check('1stGoal: Home/Away', { market_name: 'First goal & match result', outcome_name: '1st goal 1 / Result 2' }, 'LOST');
check('1stGoal: Away/Away', { market_name: 'First goal & match result', outcome_name: '1st goal 2 / Result 2' }, 'LOST');

// ================================================================

// ================================================================
// 38. CORNER MARKETS (Totals across multiple lines & 1X2)
// ================================================================
console.log('--- Corner Markets ---');
const CORNER_TOTAL = R.corners_home + R.corners_away; // 10
for (const threshold of [6.5, 7.5, 8.5, 9.5, 10.5, 11.5]) {
  const overWins = CORNER_TOTAL > threshold;
  checkPair(
    `Corners O/U ${threshold}`,
    `Corners over/under (${threshold})`,
    'Over', 'Under',
    overWins ? 'WON' : 'LOST',
    overWins ? 'LOST' : 'WON',
    { line: String(threshold) }
  );
}

// Corner 1X2: Germany 7, Netherlands 3 -> Home wins
check('Corner 1X2: Home', { market_name: 'Corner 1x2', outcome_name: '1', outcome_key: '1' }, 'WON');
check('Corner 1X2: Draw', { market_name: 'Corner 1x2', outcome_name: 'X', outcome_key: 'x' }, 'LOST');
check('Corner 1X2: Away', { market_name: 'Corner 1x2', outcome_name: '2', outcome_key: '2' }, 'LOST');

// Team Corner Totals
checkPair('Home Corners Over 5.5', 'Home team corners over/under (5.5)', 'Over', 'Under', 'WON', 'LOST', { line: '5.5' });
checkPair('Home Corners Over 7.5', 'Home team corners over/under (7.5)', 'Over', 'Under', 'LOST', 'WON', { line: '7.5' });
checkPair('Away Corners Over 2.5', 'Away team corners over/under (2.5)', 'Over', 'Under', 'WON', 'LOST', { line: '2.5' });
checkPair('Away Corners Over 3.5', 'Away team corners over/under (3.5)', 'Over', 'Under', 'LOST', 'WON', { line: '3.5' });

// Exact Corners
check('Exact Corners: 10', { market_name: 'Exact corners', outcome_name: '10', outcome_key: '10' }, 'WON');
check('Exact Corners: 9', { market_name: 'Exact corners', outcome_name: '9', outcome_key: '9' }, 'LOST');
check('Exact Corners: 11', { market_name: 'Exact corners', outcome_name: '11', outcome_key: '11' }, 'LOST');
check('Exact Corners: 10+', { market_name: 'Exact corners', outcome_name: '10+', outcome_key: '10+' }, 'WON');

// SUMMARY
// ================================================================
console.log('\n=================================================');
console.log(`RESULTS:  ${pass} PASS,  ${fail} FAIL`);
if (pendingReport.length) {
  console.log(`\nUnexpected PENDING (null) results:`);
  pendingReport.forEach(p => console.log(`  - ${p}`));
}
if (fail === 0) {
  console.log('\n✅ ALL MARKETS PASS — no contradictions, no false pending.');
} else {
  console.log('\n❌ SOME MARKETS FAILED — see details above.');
}
console.log('=================================================');
process.exit(fail > 0 ? 1 : 0);
