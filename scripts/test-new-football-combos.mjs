import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { isWinningMarginMarket, gradeWinningMargin } from '../server/ledger/winning-margin.mjs';
import { isDcHalfBttsMarket, gradeDcHalfBtts } from '../server/ledger/dc-half-btts.mjs';
import { isHtFtComboMarket, gradeHtFtCombo } from '../server/ledger/htft-combo.mjs';
import { isMultiscoresMarket, gradeMultiscores } from '../server/ledger/multiscores.mjs';
import { isQualificationMarket, gradeQualification } from '../server/ledger/qualification.mjs';
import { 
  isWinnerTotalMarket, isTeamNotToLoseTotalMarket, isBttsTotalAndMarket,
  parseWinnerTotal, parseTeamNotToLoseTotal, parseBttsTotal,
  gradeMixedTotal, gradeTeamNotToLoseTotal, gradeBttsTotal 
} from '../server/ledger/mixed-combos.mjs';
import { gradeLine } from '../server/ledger/settler.mjs';

const match = {
  home_team: 'Arsenal',
  away_team: 'Chelsea',
  home_score: 2,
  away_score: 1,
  half_home_score: 1,
  half_away_score: 0
};

// ==========================================
// 1. WINNING MARGIN TESTS
// ==========================================
assert.equal(isWinningMarginMarket({ market_name: 'Winning margin' }), true);
assert.equal(isWinningMarginMarket({ market_name: '1st half - Winning margin' }), true);
assert.equal(isWinningMarginMarket({ market_name: 'Winning margins' }), true);

// FT score 2 - 1 -> Home wins by 1
assert.equal(gradeWinningMargin({ market_name: 'Winning margin', outcome_name: 'Home by 1' }, match), 'WON');
assert.equal(gradeWinningMargin({ market_name: 'Winning margin', outcome_name: 'Arsenal by 1' }, match), 'WON');
assert.equal(gradeWinningMargin({ market_name: 'Winning margin', outcome_name: 'Home by 2' }, match), 'LOST');
assert.equal(gradeWinningMargin({ market_name: 'Winning margin', outcome_name: 'Away by 1' }, match), 'LOST');
assert.equal(gradeWinningMargin({ market_name: 'Winning margin', outcome_name: 'Draw' }, match), 'LOST');
assert.equal(gradeWinningMargin({ market_name: 'Winning margin', outcome_name: 'Home by 1-2' }, match), 'WON');
assert.equal(gradeWinningMargin({ market_name: 'Winning margin', outcome_name: 'Home by 2+' }, match), 'LOST');
assert.equal(gradeWinningMargin({ market_name: 'Winning margin', outcome_name: 'Any other result' }, match), 'LOST');

// 1st half score 1 - 0 -> Home wins by 1
assert.equal(gradeWinningMargin({ market_name: '1st half - Winning margin', outcome_name: 'Home by 1' }, match), 'WON');
assert.equal(gradeWinningMargin({ market_name: '1st half - Winning margin', outcome_name: 'Draw' }, match), 'LOST');

// Via gradeLine:
assert.equal(gradeLine({ market_name: 'Winning margin', outcome_name: 'Arsenal by 1' }, match), 'WON');
assert.equal(gradeLine({ market_name: 'Winning margin', outcome_name: 'Chelsea by 1' }, match), 'LOST');

// ==========================================
// 2. DC + HALF BTTS TESTS
// ==========================================
assert.equal(isDcHalfBttsMarket('Double chance & 1st half both teams to score'), true);
assert.equal(isDcHalfBttsMarket('Double chance & 2nd half both teams to score'), true);

// 1H score is 1-0: BTTS in 1H is NO. FT is 2-1: 1X is YES, 12 is YES, X2 is NO.
assert.equal(gradeDcHalfBtts({ 
  market_name: 'Double chance & 1st half both teams to score', 
  outcome_name: '1X & No' 
}, match), 'WON');
assert.equal(gradeDcHalfBtts({ 
  market_name: 'Double chance & 1st half both teams to score', 
  outcome_name: '1X & Yes' 
}, match), 'LOST');
assert.equal(gradeDcHalfBtts({ 
  market_name: 'Double chance & 1st half both teams to score', 
  outcome_name: 'X2 & No' 
}, match), 'LOST');

// Via gradeLine:
assert.equal(gradeLine({ 
  market_name: 'Double chance & 1st half both teams to score', 
  outcome_name: '1X & No' 
}, match), 'WON');

// ==========================================
// 3. HT/FT COMBO TESTS
// ==========================================
// HT: 1-0 (1), FT: 2-1 (1) -> HT/FT is 1/1. Total goals: 3. 1H goals: 1.
assert.equal(isHtFtComboMarket('HT/FT & total goals'), true);
assert.equal(isHtFtComboMarket('HT/FT & 1st half total goals'), true);
assert.equal(isHtFtComboMarket('HT/FT & exact goals'), true);
assert.equal(isHtFtComboMarket('HT/FT correct score'), true);

assert.equal(gradeHtFtCombo({ 
  market_name: 'HT/FT & total goals', 
  outcome_name: '1/1 & Over 2.5' 
}, match), 'WON');
assert.equal(gradeHtFtCombo({ 
  market_name: 'HT/FT & total goals', 
  outcome_name: '1/1 & Under 2.5' 
}, match), 'LOST');
assert.equal(gradeHtFtCombo({ 
  market_name: 'HT/FT & total goals', 
  outcome_name: 'X/1 & Over 2.5' 
}, match), 'LOST');

assert.equal(gradeHtFtCombo({ 
  market_name: 'HT/FT & 1st half total goals', 
  outcome_name: '1/1 & Over 0.5' 
}, match), 'WON');
assert.equal(gradeHtFtCombo({ 
  market_name: 'HT/FT & 1st half total goals', 
  outcome_name: '1/1 & Under 0.5' 
}, match), 'LOST');

assert.equal(gradeHtFtCombo({ 
  market_name: 'HT/FT & exact goals', 
  outcome_name: '1/1 & 3' 
}, match), 'WON');
assert.equal(gradeHtFtCombo({ 
  market_name: 'HT/FT & exact goals', 
  outcome_name: '1/1 & 2' 
}, match), 'LOST');

assert.equal(gradeHtFtCombo({ 
  market_name: 'HT/FT correct score', 
  outcome_name: '1:0 / 2:1' 
}, match), 'WON');
assert.equal(gradeHtFtCombo({ 
  market_name: 'HT/FT correct score', 
  outcome_name: '1:0 / 3:1' 
}, match), 'LOST');

// Via gradeLine:
assert.equal(gradeLine({ 
  market_name: 'HT/FT & total goals', 
  outcome_name: '1/1 & Over 2.5' 
}, match), 'WON');

// ==========================================
// 4. MULTISCORES TESTS
// ==========================================
assert.equal(isMultiscoresMarket('Multiscores'), true);
assert.equal(isMultiscoresMarket('Multi scores'), true);

// FT is 2 - 1
assert.equal(gradeMultiscores({ market_name: 'Multiscores', outcome_name: '2:1, 3:1, 4:1' }, match), 'WON');
assert.equal(gradeMultiscores({ market_name: 'Multiscores', outcome_name: '1:0, 2:0, 3:0' }, match), 'LOST');
assert.equal(gradeMultiscores({ market_name: 'Multiscores', outcome_name: '0:1, 0:2, 0:3' }, match), 'LOST');
assert.equal(gradeMultiscores({ market_name: 'Multiscores', outcome_name: '1:2, 1:3, 1:4' }, match), 'LOST');
assert.equal(gradeMultiscores({ market_name: 'Multiscores', outcome_name: 'Other' }, match), null);

// Via gradeLine:
assert.equal(gradeLine({ market_name: 'Multiscores', outcome_name: '2:1, 3:1, 4:1' }, match), 'WON');

// ==========================================
// 5. MIXED COMBOS: WINNER+TOTAL, TEAM NOT TO LOSE+TOTAL, BTTS+TOTAL
// ==========================================
// FT: 2-1 (Arsenal win, Chelsea loss, Total: 3, BTTS: Yes)
const selWin1 = parseWinnerTotal('Home & Over 2.5');
assert.equal(gradeMixedTotal('Winner & total', selWin1, match.home_score, match.away_score), 'WON');
const selWin2 = parseWinnerTotal('Home & Under 2.5');
assert.equal(gradeMixedTotal('Winner & total', selWin2, match.home_score, match.away_score), 'LOST');
const selWin3 = parseWinnerTotal('Away & Over 2.5');
assert.equal(gradeMixedTotal('Winner & total', selWin3, match.home_score, match.away_score), 'LOST');

// Via gradeLine:
assert.equal(gradeLine({ market_name: 'Winner & total', outcome_name: 'Home & Over 2.5' }, match), 'WON');
assert.equal(gradeLine({ market_name: 'Winner & total', outcome_name: 'Home & Under 2.5' }, match), 'LOST');
assert.equal(gradeLine({ market_name: 'Winner & total', outcome_name: 'Away & Over 2.5' }, match), 'LOST');

// Team not to lose & total (Arsenal 1X = true, Chelsea X2 = false)
const selTnl1 = parseTeamNotToLoseTotal('Hometeam not to lose & total over 2.5', 'Yes');
assert.equal(gradeTeamNotToLoseTotal(selTnl1, match.home_score, match.away_score), 'WON');
const selTnl2 = parseTeamNotToLoseTotal('Hometeam not to lose & total over 2.5', 'No');
assert.equal(gradeTeamNotToLoseTotal(selTnl2, match.home_score, match.away_score), 'LOST');
const selTnl3 = parseTeamNotToLoseTotal('Awayteam not to lose & total over 2.5', 'Yes');
assert.equal(gradeTeamNotToLoseTotal(selTnl3, match.home_score, match.away_score), 'LOST');

// BTTS and total (BTTS = Yes, Total = 3)
const selBtts1 = parseBttsTotal('Both teams to score and total over 2.5', 'Yes');
assert.equal(gradeBttsTotal(selBtts1, match.home_score, match.away_score), 'WON');
const selBtts2 = parseBttsTotal('Both teams to score and total over 2.5', 'No');
assert.equal(gradeBttsTotal(selBtts2, match.home_score, match.away_score), 'LOST');
const selBtts3 = parseBttsTotal('Both teams to score and total under 2.5', 'Yes');
assert.equal(gradeBttsTotal(selBtts3, match.home_score, match.away_score), 'LOST');

// Via gradeLine:
assert.equal(gradeLine({ 
  market_name: 'Hometeam not to lose & total over 2.5', 
  outcome_name: 'Yes' 
}, match), 'WON');
assert.equal(gradeLine({ 
  market_name: 'Both teams to score and total over 2.5', 
  outcome_name: 'Yes' 
}, match), 'WON');

// ==========================================
// 6. WILL THERE BE A TIE
// ==========================================
// Score 2-1: Not a tie -> No is WON, Yes is LOST
assert.equal(gradeLine({ market_name: 'Will there be a tie', outcome_name: 'No' }, match), 'WON');
assert.equal(gradeLine({ market_name: 'Will there be a tie', outcome_name: 'Yes' }, match), 'LOST');

// Draw match: 1-1
const drawMatch = { ...match, home_score: 1, away_score: 1 };
assert.equal(gradeLine({ market_name: 'Will there be a tie', outcome_name: 'Yes' }, drawMatch), 'WON');
assert.equal(gradeLine({ market_name: 'Will there be a tie', outcome_name: 'No' }, drawMatch), 'LOST');

// ==========================================
// 7. QUALIFICATION / ADVANCEMENT / REACH FINAL
// ==========================================
assert.equal(isQualificationMarket('To Qualify'), true);
assert.equal(isQualificationMarket('Who advances to the next round'), true);
assert.equal(isQualificationMarket('To reach the final:'), true);
assert.equal(isQualificationMarket('To reach the semifinal:'), true);

// Regular time 2-1 (Arsenal wins over Chelsea)
assert.equal(gradeQualification({ market_name: 'To Qualify', outcome_name: '1' }, match), 'WON');
assert.equal(gradeQualification({ market_name: 'To Qualify', outcome_name: 'Arsenal' }, match), 'WON');
assert.equal(gradeQualification({ market_name: 'To Qualify', outcome_name: '2' }, match), 'LOST');
assert.equal(gradeQualification({ market_name: 'To Qualify', outcome_name: 'Chelsea' }, match), 'LOST');

assert.equal(gradeQualification({ market_name: 'Who advances to the next round', outcome_name: 'Arsenal' }, match), 'WON');
assert.equal(gradeQualification({ market_name: 'Who advances to the next round', outcome_name: 'Chelsea' }, match), 'LOST');

assert.equal(gradeQualification({ market_name: 'To reach the final:', outcome_name: 'Arsenal' }, match), 'WON');
assert.equal(gradeQualification({ market_name: 'To reach the final:', outcome_name: 'Chelsea' }, match), 'LOST');

// Via gradeLine:
assert.equal(gradeLine({ market_name: 'To Qualify', outcome_name: 'Arsenal' }, match), 'WON');
assert.equal(gradeLine({ market_name: 'Who advances to the next round', outcome_name: 'Chelsea' }, match), 'LOST');
assert.equal(gradeLine({ market_name: 'To reach the final:', outcome_name: '1' }, match), 'WON');

// Draw in 90 min: pending if no extra-time winner
assert.equal(gradeQualification({ market_name: 'To Qualify', outcome_name: 'Arsenal' }, drawMatch), null);

// Draw with penalty shootout winner
const penMatch = { ...drawMatch, qualifying_team: 'away' };
assert.equal(gradeQualification({ market_name: 'To Qualify', outcome_name: 'Arsenal' }, penMatch), 'LOST');
assert.equal(gradeQualification({ market_name: 'To Qualify', outcome_name: 'Chelsea' }, penMatch), 'WON');

// ==========================================
// 8. REST OF MATCH (Halftime - Who wins the rest?)
// ==========================================
// Kazakhstan vs Slovakia: FT 2-2, HT 1-0 -> 2nd half 1-2 (Slovakia wins rest)
const kazSvk = { home_score: 2, away_score: 2, half_home_score: 1, half_away_score: 0 };
assert.equal(gradeLine({ market_name: 'Halftime - Who wins the rest?', outcome_name: '2', outcome_key: '2' }, kazSvk), 'WON');
assert.equal(gradeLine({ market_name: 'Halftime - Who wins the rest?', outcome_name: '1', outcome_key: '1' }, kazSvk), 'LOST');
assert.equal(gradeLine({ market_name: 'Halftime - Who wins the rest?', outcome_name: 'X', outcome_key: 'x' }, kazSvk), 'LOST');

// ==========================================
// 9. REAL SPORTSBOOK USER MARKETS TESTS
// ==========================================
// HT 1-0, FT 1-0 (Germany vs Netherlands)
const gerNed = {
  home_team: 'Germany',
  away_team: 'Netherlands',
  home_score: 1,
  away_score: 0,
  half_home_score: 1,
  half_away_score: 0
};

// Halftime/Fulltime correct score
assert.equal(gradeLine({ market_name: 'Halftime/Fulltime correct score', outcome_name: '1-0 1-0' }, gerNed), 'WON');
assert.equal(gradeLine({ market_name: 'Halftime/Fulltime correct score', outcome_name: '1-0 / 4+' }, gerNed), 'LOST');
assert.equal(gradeLine({ market_name: 'Halftime/Fulltime correct score', outcome_name: '4+ / 4+' }, gerNed), 'LOST');
assert.equal(gradeLine({ market_name: 'Halftime/Fulltime correct score', outcome_name: '0-0 0-0' }, gerNed), 'LOST');

// Halftime/Fulltime & 1st half total goals
assert.equal(gradeLine({ market_name: 'Halftime/Fulltime & 1st half total goals (2.5)', outcome_name: '1/1 and Under', line: '2.5' }, gerNed), 'WON');
assert.equal(gradeLine({ market_name: 'Halftime/Fulltime & 1st half total goals (1.5)', outcome_name: '1/1 and Under', line: '1.5' }, gerNed), 'WON');
assert.equal(gradeLine({ market_name: 'Halftime/Fulltime & 1st half total goals (0.5)', outcome_name: '1/1 and Over', line: '0.5' }, gerNed), 'WON');
assert.equal(gradeLine({ market_name: 'Halftime/Fulltime & 1st half total goals (0.5)', outcome_name: '1/1 and Under', line: '0.5' }, gerNed), 'LOST');
assert.equal(gradeLine({ market_name: 'Halftime/Fulltime & 1st half total goals (2.5)', outcome_name: '2/2 and Under', line: '2.5' }, gerNed), 'LOST');

// Halftime/fulltime & exact goals
assert.equal(gradeLine({ market_name: 'Halftime/fulltime & exact goals', outcome_name: '1/1 - 1' }, gerNed), 'WON');
assert.equal(gradeLine({ market_name: 'Halftime/fulltime & exact goals', outcome_name: '1/1 - 5+' }, gerNed), 'LOST');
assert.equal(gradeLine({ market_name: 'Halftime/fulltime & exact goals', outcome_name: '2/2 - 5+' }, gerNed), 'LOST');
assert.equal(gradeLine({ market_name: 'Halftime/fulltime & exact goals', outcome_name: 'X/X - 0' }, gerNed), 'LOST');

// Draw or any clean sheet (FT 1-0 -> Netherlands clean sheet: No, Germany clean sheet: Yes -> Any clean sheet: Yes)
assert.equal(gradeLine({ market_name: 'Draw or any clean sheet', outcome_name: 'Yes' }, gerNed), 'WON');
assert.equal(gradeLine({ market_name: 'Draw or any clean sheet', outcome_name: 'No' }, gerNed), 'LOST');

// First goal & match result (Germany scored 1, match ended 1-0)
assert.equal(gradeLine({ market_name: 'First goal & match result', outcome_name: '1st goal 1 / Result 1' }, gerNed), 'WON');
assert.equal(gradeLine({ market_name: 'First goal & match result', outcome_name: '1st goal 2 / Result 2' }, gerNed), 'LOST');
assert.equal(gradeLine({ market_name: 'First goal & match result', outcome_name: '1st goal 1 / Result X' }, gerNed), 'LOST');

// Chance mix: Draw or both teams to score (FT 1-0 -> neither draw nor BTTS -> No is WON, Yes is LOST)
assert.equal(gradeLine({ market_name: 'Draw or both teams to score', outcome_name: 'No' }, gerNed), 'WON');
assert.equal(gradeLine({ market_name: 'Draw or both teams to score', outcome_name: 'Yes' }, gerNed), 'LOST');
// FT 1-1 -> draw is true -> Yes is WON
assert.equal(gradeLine({ market_name: 'Draw or both teams to score', outcome_name: 'Yes' }, drawMatch), 'WON');

console.log('PASS new football combos: Winning Margin, DC+Half BTTS, HT/FT Combos, Multiscores, Winner+Total, Team not to lose+Total, BTTS+Total, Will there be a tie, Qualification, Halftime Rest of Match, Clean Sheets, First Goal & Result, Chance Mix');
