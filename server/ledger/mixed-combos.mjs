/** Provider-defined correlated full-time markets. Never fabricate an odd or a selection. */
export const isResultTotalMarket = (name = '') => /^\s*(?:full\s*time\.?\s*)?result\s+and\s+total\s*$/i.test(name);
export const isTotalBttsMarket = (name = '') =>
  /^\s*(?:full\s*time\.?\s*)?total\s+and\s+(?:both\s+teams?\s+(?:to\s+)?score|btts)\s*$/i.test(name);
export const isFirstHalfResultBtts = (name = '') =>
  /^\s*(?:1st|first)\s+half\.\s*result\s+and\s+both\s+teams?\s+(?:to\s+)?score\s*$/i.test(name);

/** "Winner & total" or "value goal & result" */
export const isWinnerTotalMarket = (name = '') =>
  /^\s*winner\s*&\s*total\s*$/i.test(name) ||
  /^\s*(?:\S+\s+)?goal\s*&\s*result\s*$/i.test(name);

/** "[Home/Away]team not to lose & total [over/under]" (with optional line e.g. "total over 2.5") */
export const isTeamNotToLoseTotalMarket = (name = '') =>
  /^\s*(?:home|away)\s*team\s+not\s+to\s+lose\s*&\s*total\s+(?:over|under)(?:\s+\d+(?:[.,]\d+)?)?\s*$/i.test(name);

/** "Both teams to score and total [over/under]" (the "and" variant, Cyrillic Т included, optional line) */
export const isBttsTotalAndMarket = (name = '') =>
  /^\s*both\s+teams?\s+to\s+score\s+and\s+[ТтTt]?otal\s+(?:over|under)(?:\s+\d+(?:[.,]\d+)?)?\s*$/i.test(name);

const fold = (value) => String(value ?? '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const resultOf = (part, home, away) => {
  const p = fold(part);
  if (['1', 'home', 'home win', 'w1'].includes(p) || (fold(home) && p === fold(home))) return '1';
  if (['x', 'draw', 'tie'].includes(p)) return 'X';
  if (['2', 'away', 'away win', 'w2'].includes(p) || (fold(away) && p === fold(away))) return '2';
  return null;
};
const totalOf = (part) => {
  const m = String(part ?? '').trim().match(/^(over|under)\s*(\d+(?:[.,]\d+)?)$/i);
  if (!m) return null;
  return { side: m[1].toLowerCase(), line: Number(m[2].replace(',', '.')) };
};
const bttsOf = (part) => {
  const p = fold(part)
  if (['yes', 'gg', 'po'].includes(p)) return true;
  if (['no', 'ng', 'nil', 'jo'].includes(p)) return false;
  return null;
};
export function parseResultTotal(value, home = '', away = '') {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(.+?)\s+(?:and|&)\s+(.+)$/i);
  if (!m) return null;
  const result = resultOf(m[1], home, away);
  const total = totalOf(m[2]);
  return result !== null && total ? { result, ...total } : null;
}
export function parseTotalBtts(value) {
  const m = String(value ?? '').trim().match(/^(.+?)\s+(?:and|&)\s+(.+)$/i);
  if (!m) return null;
  const total = totalOf(m[1]);
  const btts = bttsOf(m[2]);
  return total && btts !== null ? { ...total, btts } : null;
}

/** Parse "Winner & total" / "goal & result" outcome: e.g. "Home win and Over 2.5" */
export function parseWinnerTotal(value, home = '', away = '') {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(.+?)\s+(?:and|&)\s+(.+)$/i);
  if (!m) return null;
  const result = resultOf(m[1], home, away);
  const total = totalOf(m[2]);
  return result !== null && total ? { result, ...total } : null;
}

/**
 * Parse "[Home/Away]team not to lose & total over/under" market.
 * The side (over/under) is in the market name; the line may be in market name or outcome value.
 */
export function parseTeamNotToLoseTotal(marketName, outcomeValue) {
  const name = String(marketName ?? '').toLowerCase().trim();
  const isHome = /^(?:home\s*team|hometeam)\s+not\s+to\s+lose/i.test(name);
  const isAway = /^(?:away\s*team|awayteam)\s+not\s+to\s+lose/i.test(name);
  if (!isHome && !isAway) return null;
  const totalSideMatch = name.match(/&\s*total\s+(over|under)/i);
  if (!totalSideMatch) return null;
  const side = totalSideMatch[1].toLowerCase();
  const raw = String(outcomeValue ?? '').trim();
  const lineMatch = raw.match(/(\d+(?:[.,]\d+)?)/) ?? name.match(/(?:over|under)\s+(\d+(?:[.,]\d+)?)/i);
  if (!lineMatch) return null;
  const line = Number((lineMatch[1] ?? lineMatch[0]).replace(',', '.'));
  const negate = /^(?:no|jo)$/i.test(raw);
  return { team: isHome ? 'home' : 'away', side, line, negate };
}

/** Parse "Both teams to score and total over/under" outcome */
export function parseBttsTotal(marketName, outcomeValue) {
  const name = String(marketName ?? '');
  const sideMatch = name.match(/and\s+[ТтTt]?otal\s+(over|under)/i);
  if (!sideMatch) return null;
  const side = sideMatch[1].toLowerCase();
  const raw = String(outcomeValue ?? '').trim();
  const lineMatch = raw.match(/(\d+(?:[.,]\d+)?)/) ?? name.match(/(?:over|under)\s+(\d+(?:[.,]\d+)?)/i);
  if (!lineMatch) return null;
  const line = Number((lineMatch[1] ?? lineMatch[0]).replace(',', '.'));
  const negate = /^(?:no|jo)$/i.test(raw);
  return { side, line, negate };
}

export function gradeMixedTotal(marketName, selection, homeScore, awayScore) {
  const home = Number(homeScore), away = Number(awayScore);
  if (!selection || !Number.isFinite(home) || !Number.isFinite(away)) return null;
  const total = home + away;
  // A provider mixed quote wins only when both conditions win.
  if (total === selection.line) return 'LOST';
  const totalWins = selection.side === 'over' ? total > selection.line : total < selection.line;
  const result = home > away ? '1' : home < away ? '2' : 'X';
  const second = isResultTotalMarket(marketName) || isWinnerTotalMarket(marketName)
    ? selection.result === result
    : selection.btts === (home > 0 && away > 0);
  return totalWins && second ? 'WON' : 'LOST';
}

/** Grade "Hometeam/Awayteam not to lose & total over/under" */
export function gradeTeamNotToLoseTotal(selection, home, away) {
  if (!selection || !Number.isFinite(home) || !Number.isFinite(away)) return null;
  const total = home + away;
  // DNB-style: team wins or draws (not loses)
  const teamNotLost = selection.team === 'home' ? home >= away : away >= home;
  if (total === selection.line) return 'LOST'; // push on total = lost for combo
  const totalWins = selection.side === 'over' ? total > selection.line : total < selection.line;
  const win = teamNotLost && totalWins;
  if (selection.negate) return win ? 'LOST' : 'WON';
  return win ? 'WON' : 'LOST';
}

/** Grade "Both teams to score and total over/under" */
export function gradeBttsTotal(selection, home, away) {
  if (!selection || !Number.isFinite(home) || !Number.isFinite(away)) return null;
  const total = home + away;
  const btts = home > 0 && away > 0;
  if (total === selection.line) return 'LOST'; // push = lost for combo
  const totalWins = selection.side === 'over' ? total > selection.line : total < selection.line;
  const win = btts && totalWins;
  if (selection.negate) return win ? 'LOST' : 'WON';
  return win ? 'WON' : 'LOST';
}
