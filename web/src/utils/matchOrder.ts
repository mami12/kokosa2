import type { Match } from '../types';
const ordinal = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const tiranaFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit', day: '2-digit' });
const tiranaDay = (value: unknown) => {
  if (value == null || value === '') return '';
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) ? tiranaFormat.format(ms) : '';
};
const compareDays = (a: Match, b: Match) => {
  const da = tiranaDay(a.startTime ?? (a as { start_at?: unknown }).start_at);
  const db = tiranaDay(b.startTime ?? (b as { start_at?: unknown }).start_at);
  return da === db ? 0 : !da ? 1 : !db ? -1 : da.localeCompare(db);
};
/** Server-owned listing positions, never score, price or browser arrival. */
export function compareMatchDisplay(a: Match, b: Match): number {
  return Number(b.status === 'LIVE') - Number(a.status === 'LIVE')
    || (a.status === 'LIVE'
        ? ordinal(a.listingPriority) - ordinal(b.listingPriority)
        : compareDays(a, b) || ordinal(a.listingPriority) - ordinal(b.listingPriority))
    || ordinal(a.competitionOrder) - ordinal(b.competitionOrder)
    || String(a.tournament?.id ?? a.tournamentId ?? '').localeCompare(String(b.tournament?.id ?? b.tournamentId ?? ''), 'en', { numeric: true })
    || ordinal(a.displayOrder) - ordinal(b.displayOrder)
    || String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
}
