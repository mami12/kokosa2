/**
 * Knockout / Outright qualification markets:
 *  - "To Qualify"
 *  - "Who advances to the next round" / "Who advances"
 *  - "To reach the final:" / "To reach the final"
 *  - "To reach the semifinal:" / "To reach the semifinal"
 *
 * Outcomes:
 *  - "1" / "Home" / "Home Team Name"
 *  - "2" / "Away" / "Away Team Name"
 *  - "Yes" / "No" (when team is named in market or selection)
 */

const norm = v => String(v ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export function isQualificationMarket(name = '') {
  const s = String(name).toLowerCase().trim();
  return /^(?:to\s+qualify|who\s+advances(?:\s+to\s+(?:the\s+)?next\s+round)?\??|to\s+reach\s+the\s+(?:semi)?final:?)\s*$/i.test(s) ||
    /\b(?:to\s+qualify|who\s+advances\s+to\s+(?:the\s+)?next\s+round|to\s+reach\s+the\s+(?:semi)?final)\b/i.test(s);
}

export function gradeQualification(line, result) {
  const fh = Number(result?.home_score);
  const fa = Number(result?.away_score);
  if (!Number.isFinite(fh) || !Number.isFinite(fa)) return null;

  const raw = norm(line?.outcome_name ?? line?.outcome_key ?? '');
  const homeName = norm(result?.home_team);
  const awayName = norm(result?.away_team);

  // Determine winning / advancing side:
  let winningSide = null;
  if (fh > fa) {
    winningSide = 'home';
  } else if (fa > fh) {
    winningSide = 'away';
  } else {
    // Regular time is a draw: check for extra time / penalty shootout facts
    const extraWinner = norm(
      result?.qualifying_team ?? result?.qualifier ?? result?.advancing_team ??
      result?.winner ?? result?.penalty_winner ?? result?.winner_team
    );
    if (extraWinner) {
      if (['1', 'home', 'hometeam', homeName].includes(extraWinner)) winningSide = 'home';
      else if (['2', 'away', 'awayteam', awayName].includes(extraWinner)) winningSide = 'away';
    }
    // If it's a draw and no extra-time / penalty winner is verified yet, stay PENDING
    if (!winningSide) return null;
  }

  // 1) 2-way selection by code or team label
  if (['1', 'home', 'hometeam', 'team 1'].includes(raw) || (homeName && raw === homeName)) {
    return winningSide === 'home' ? 'WON' : 'LOST';
  }
  if (['2', 'away', 'awayteam', 'team 2'].includes(raw) || (awayName && raw === awayName)) {
    return winningSide === 'away' ? 'WON' : 'LOST';
  }

  // 2) Yes/No selection for team named in market title
  const marketName = norm(line?.market_name ?? line?.marketName ?? '');
  let teamInQuestion = null;
  if (homeName && marketName.includes(homeName)) teamInQuestion = 'home';
  else if (awayName && marketName.includes(awayName)) teamInQuestion = 'away';

  if (teamInQuestion) {
    const isYes = /^(?:yes|po)$/.test(raw);
    const isNo = /^(?:no|jo)$/.test(raw);
    if (isYes) return winningSide === teamInQuestion ? 'WON' : 'LOST';
    if (isNo) return winningSide === teamInQuestion ? 'LOST' : 'WON';
  }

  // 3) Fallback substring match on team names
  if (homeName && raw.includes(homeName)) return winningSide === 'home' ? 'WON' : 'LOST';
  if (awayName && raw.includes(awayName)) return winningSide === 'away' ? 'WON' : 'LOST';

  return null;
}
