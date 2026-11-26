/**
 * Admin overrides (suspend a match/market/outcome, pin a price).
 *
 * The board is fed continuously, so a plain "edit the price" would be overwritten by the
 * next frame. Overrides are stored separately in app_feed_override and applied when the app
 * view is built and when a bet is validated - which is also what lets the admin panel
 * suspend something and have it actually stick.
 *
 * Reads come from a short-lived in-memory snapshot so the view can stay synchronous.
 */
import { query } from '../db.mjs';

const TTL_MS = 4000;
let cache = { at: 0, match: new Map(), market: new Map(), outcome: new Map(), competition: new Map() };

/** the view is built synchronously, so staleness triggers a background reload instead of a wait */
let reloading = false;
function ensureFresh() {
  if (reloading || Date.now() - cache.at < TTL_MS) return;
  reloading = true;
  refresh()
    .catch(() => {})
    .finally(() => {
      reloading = false;
    });
}

const refOfMarket = (matchId, marketKey, line) => `${matchId}|${marketKey}|${line ?? ''}`;
const refOfOutcome = (matchId, marketKey, line, outcomeKey) => `${refOfMarket(matchId, marketKey, line)}|${outcomeKey}`;

/** reloads the snapshot (throttled unless `force`) */
export async function refresh(force = false) {
  if (!force && Date.now() - cache.at < TTL_MS) return cache;
  try {
    const res = await query('select kind, ref, suspended, price, hidden from app_feed_override');
    const match = new Map();
    const market = new Map();
    const outcome = new Map();
    const competition = new Map();
    for (const row of res.rows) {
      const entry = { hidden: row.hidden === true, suspended: row.suspended === true, price: row.price === null ? null : Number(row.price) };
      if (row.kind === 'match') match.set(row.ref, entry);
      else if (row.kind === 'market') market.set(row.ref, entry);
      else if (row.kind === 'outcome') outcome.set(row.ref, entry);
      else if (row.kind === 'competition') competition.set(row.ref, entry);
    }
    cache = { at: Date.now(), match, market, outcome, competition };
  } catch {
    /* database down: keep the previous snapshot, the board must not care */
  }
  return cache;
}

export const snapshot = () => cache;
export const matchOverride = (matchId) => {
  ensureFresh();
  return cache.match.get(String(matchId)) ?? null;
};
const refOfCompetition = (countrySlug, tournamentId = '') => `${String(countrySlug ?? '').trim().toLowerCase()}|${String(tournamentId ?? '').trim()}`;
export const competitionOverride = (countrySlug, tournamentId = '') => {
  ensureFresh();
  const country = String(countrySlug ?? '').trim().toLowerCase();
  if (!country) return null;
  if (String(tournamentId ?? '').trim()) {
    const exact = cache.competition.get(refOfCompetition(country, tournamentId));
    if (exact) return exact;
  }
  return cache.competition.get(refOfCompetition(country)) ?? null;
};
export const isMatchHidden = (matchOrId) => {
  const id = typeof matchOrId === 'object' && matchOrId !== null ? matchOrId.match_id ?? matchOrId.id : matchOrId;
  if (matchOverride(id)?.hidden === true) return true;
  const match = typeof matchOrId === 'object' && matchOrId !== null ? matchOrId : null;
  if (!match) return false;
  const country = match.category_slug ?? match.categorySlug ?? match.league?.slug ?? match.tournament?.category?.slug;
  const tournamentId = match.tournament_id ?? match.tournamentId ?? match.tournament?.id;
  return competitionOverride(country, tournamentId)?.hidden === true;
};
export const marketOverride = (matchId, marketKey, line) => {
  ensureFresh();
  return cache.market.get(refOfMarket(matchId, marketKey, line)) ?? null;
};
export const outcomeOverride = (matchId, marketKey, line, outcomeKey) => {
  ensureFresh();
  return cache.outcome.get(refOfOutcome(matchId, marketKey, line, outcomeKey)) ?? null;
};

const KINDS = new Set(['match', 'market', 'outcome']);

export async function upsert(kind, ref, { suspended = null, price = null } = {}) {
  if (!KINDS.has(kind)) throw Object.assign(new Error('kind must be match, market or outcome'), { status: 400 });
  if (!ref) throw Object.assign(new Error('ref is required'), { status: 400 });

  await query(
    `insert into app_feed_override (kind, ref, suspended, price)
     values ($1, $2, $3, $4)
     on conflict (kind, ref) do update set
       suspended  = coalesce(excluded.suspended, app_feed_override.suspended),
       price      = coalesce(excluded.price, app_feed_override.price),
       updated_at = now()`,
    [kind, String(ref), suspended, price],
  );
  await refresh(true);
  return list();
}

export async function suspendMarkets(refs, suspended) {
  if (typeof suspended !== 'boolean') throw Object.assign(new Error('suspended must be a boolean'), { status: 400 });
  const unique = [...new Set((Array.isArray(refs) ? refs : []).map(String).filter(Boolean))];
  if (unique.length > 50_000) throw Object.assign(new Error('Too many markets in one bulk operation'), { status: 413 });
  if (!unique.length) return 0;
  await query(
    `insert into app_feed_override (kind, ref, suspended, price)
     select 'market', x.ref, $2, null
     from jsonb_to_recordset($1::jsonb) as x(ref text)
     on conflict (kind, ref) do update set suspended = excluded.suspended, updated_at = now()`,
    [JSON.stringify(unique.map(ref => ({ ref }))), suspended],
  );
  await refresh(true);
  return unique.length;
}

export async function clear(kind, ref) {
  await query('delete from app_feed_override where kind = $1 and ref = $2', [kind, String(ref)]);
  await refresh(true);
  return list();
}

export async function list() {
  const res = await query('select kind, ref, suspended, price, updated_at from app_feed_override order by updated_at desc');
  return res.rows.map((r) => ({
    kind: r.kind,
    ref: r.ref,
    suspended: r.suspended,
    price: r.price === null ? null : Number(r.price),
    updatedAt: r.updated_at,
  }));
}
const visibilityListeners=new Set();
export const onVisibilityChange=fn=>{visibilityListeners.add(fn);return()=>visibilityListeners.delete(fn);};
export async function setMatchHidden(id,hidden){
 if(!/^\d{1,16}$/.test(String(id))||typeof hidden!=='boolean')throw Object.assign(new Error('Zgjidh ndeshjen dhe gjendjen e fshehjes.'),{status:400});
 await query("insert into app_feed_override(kind,ref,hidden)values('match',$1,$2)on conflict(kind,ref)do update set hidden=excluded.hidden,updated_at=now()",[String(id),hidden]);
 await refresh(true);for(const notify of visibilityListeners)notify({matchId:String(id),hidden});
 return {success:true,hidden};
}
export async function setCompetitionHidden(countrySlug,tournamentId,hidden){
 const country=String(countrySlug??'').trim().toLowerCase();
 const tournament=String(tournamentId??'').trim();
 if(!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(country)||tournament.length>120||typeof hidden!=='boolean')
  throw Object.assign(new Error('Zgjidh një shtet ose kampionat dhe gjendjen e dukshmërisë.'),{status:400});
 const ref=refOfCompetition(country,tournament);
 await query("insert into app_feed_override(kind,ref,hidden)values('competition',$1,$2)on conflict(kind,ref)do update set hidden=excluded.hidden,updated_at=now()",[ref,hidden]);
 await refresh(true);for(const notify of visibilityListeners)notify({countrySlug:country,tournamentId:tournament||null,hidden});
 return {success:true,countrySlug:country,tournamentId:tournament||null,hidden};
}
export async function listCompetitionVisibility(){
 await refresh();
 return [...cache.competition.entries()].map(([ref,entry])=>{const split=ref.indexOf('|');return {countrySlug:ref.slice(0,split),tournamentId:ref.slice(split+1)||null,hidden:entry.hidden};});
}
