import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../api/client';
import {
  AlertTriangle, RefreshCw, Calendar, Clock, User,
  CheckCircle2, XCircle, RotateCcw, ShieldCheck, Ticket,
  Search, History, Gauge
} from 'lucide-react';

type Pair = { home?: number | string | null; away?: number | string | null };
type PlacementSnapshot = {
  isLive?: boolean;
  capturedAt?: string;
  scoreHome?: number | string | null;
  scoreAway?: number | string | null;
  scoreObservedAt?: string | null;
  clockMilliseconds?: number | null;
  feedPhase?: string | null;
  counters?: Record<string, Pair | null>;
  statistics?: Record<string, Record<string, number | string | null> | null>;
};
type TimelineEvent = {
  id: string;
  kind: 'goal' | 'corner' | 'card' | 'foul' | string;
  team: 'home' | 'away' | string;
  minute: number;
  minuteLabel?: string | null;
  seconds?: number | null;
  playerName?: string | null;
  cardColor?: string | null;
  ownGoal?: boolean | null;
  phase?: string | null;
  verified?: boolean;
};
type EventCoverage = {
  kind: string;
  throughMinute: number;
  complete: boolean;
  confirmed?: boolean;
  confirmedAt: string | null;
  countHome: number;
  countAway: number;
  cardColorsVerified?: boolean;
};
type ReviewItem = {
  finalCounters?: {
    corners?: Pair | null;
    cards?: Pair | null;
    statistics?: Record<string, Pair | null>;
    source?: string | null;
  } | null;
  lineId: string;
  ticketId: string;
  matchId: string;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  marketName: string;
  matchName: string;
  outcomeName: string;
  marketLine: string;
  lineStatus: string;
  ticketStatus: string;
  requiresReview: boolean;
  username: string | null;
  placedAt: string;
  stake: string | number;
  odds: string | number;
  potentialPayout?: string | number;
  notificationActive: boolean;
  noticeExpiresAt: string | null;
  finalScore: string | null;
  reason: string;
  conflicts?: Record<string, unknown> | null;
  placementSnapshot?: PlacementSnapshot | null;
  liveContract?: Record<string, any> | null;
  finalStatistics?: Record<string, any> | null;
  eventTimeline?: TimelineEvent[];
  eventCoverage?: EventCoverage[];
  eventTimelineSource?: string;
};
type Decision = { status: string; reason: string; source: string };

const labels: Record<string, string> = {
  VOID_NEEDS_CONFIRMATION: 'E pavlefshme: kontrollo nëse anulimi ishte i justifikuar',
  CONFLICTING_API_STATISTICS: 'Mospërputhje mes burimeve të statistikave të ndeshjes',
  MISSING_EVENT_TIMELINE: 'Mungon kronologjia e ngjarjeve (gol, korner ose interval)',
  MISSING_GOAL_METHOD_EVIDENCE: 'Mungon prova e llojit të golit nga burimi kryesor (penallti, kokë ose këmbë)',
  NATIVE_CONTRACT_REVIEW: 'Tregu pranohet nga Zizobet, por kërkon rregull të verifikuar për shlyerje',
  MISSING_MARKET_STATISTICS: 'Mungojnë statistikat e nevojshme për mbylljen e tregut',
  UNRESOLVED_FINAL_SELECTION: 'Ndeshja ka përfunduar, por përzgjedhja ende nuk është zgjidhur automatikisht',
  MISSING_FINAL_RESULT: 'Mungon rezultati përfundimtar i konfirmuar nga burimi sportiv',
  AWAITING_RESULT: 'Në pritje të rezultatit ose provës së mjaftueshme nga burimi sportiv',
};

const fresh: Decision = { status: 'PENDING', reason: '', source: '' };
const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const money = (value: unknown) => Number(value || 0).toLocaleString('sq-AL', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('sq-AL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
function pairText(pair?: Pair | null) {
  const home = asNumber(pair?.home), away = asNumber(pair?.away);
  return home === null || away === null ? null : `${home} – ${away}`;
}
function eventTitle(event: TimelineEvent, ordinal?: number) {
  if (event.kind === 'goal') return ordinal ? `Goli #${ordinal}` : event.ownGoal ? 'Autogol' : 'Gol';
  if (event.kind === 'corner') return ordinal ? `Korneri #${ordinal}` : 'Korner';
  if (event.kind === 'card') {
    const label = event.cardColor === 'red' ? 'Kartoni i kuq'
      : event.cardColor === 'yellow' ? 'Kartoni i verdhë' : 'Kartoni';
    return ordinal ? `${label} #${ordinal}` : label;
  }
  if (event.kind === 'foul') return ordinal ? `Faulli #${ordinal}` : 'Faull';
  return event.kind;
}
function eventRelation(event: TimelineEvent, snapshot?: PlacementSnapshot | null) {
  if (snapshot?.isLive === false) return 'Pas bastit';
  const clock = asNumber(snapshot?.clockMilliseconds);
  if (clock === null) return null;
  if (event.seconds != null && Number.isFinite(Number(event.seconds))) {
    const delta = Number(event.seconds) - clock / 1000;
    if (delta < -1) return 'Para bastit';
    if (delta > 1) return 'Pas bastit';
    return 'Rreth momentit të bastit';
  }
  const betMinute = Math.floor(clock / 60000);
  if (event.minute < betMinute) return 'Para bastit';
  if (event.minute > betMinute) return 'Pas bastit';
  return 'E njëjta minutë';
}
function eventMinuteLabel(event: TimelineEvent) {
  const saved = String(event.minuteLabel ?? '').trim();
  if (saved) return saved;
  const phase = String(event.phase ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['2','2h','h2','2ndhalf','secondhalf'].includes(phase) &&
      event.minute > 90 && event.minute <= 105) return '90+' + (event.minute - 90);
  if (['1','1h','h1','1sthalf','firsthalf'].includes(phase) &&
      event.minute > 45 && event.minute <= 60) return '45+' + (event.minute - 45);
  return String(event.minute);
}
function eventTime(event: TimelineEvent) {
  const seconds = event.seconds != null
    ? ' · ' + Math.floor(Number(event.seconds) % 60).toString().padStart(2, '0') + 's' : '';
  return eventMinuteLabel(event) + "'" + seconds;
}
function statusText(status: string) {
  return ({ WON: 'Fituese', LOST: 'Humbëse', VOID: 'E pavlefshme', PENDING: 'Në pritje' } as Record<string, string>)[status] ?? status;
}

function PlacementEvidence({ item }: { item: ReviewItem }) {
  const snapshot = item.placementSnapshot ?? (item.liveContract?.acceptedLiveSnapshot as PlacementSnapshot | undefined) ?? null;
  const contract = item.liveContract as any;
  const baseline = contract?.entryBaseline as Pair | undefined;
  const scoreHome = asNumber(snapshot?.scoreHome) ?? asNumber(baseline?.home);
  const scoreAway = asNumber(snapshot?.scoreAway) ?? asNumber(baseline?.away);
  const score = scoreHome !== null && scoreAway !== null ? `${scoreHome} – ${scoreAway}`
    : snapshot?.isLive === false ? '0 – 0' : null;
  const minute = asNumber(snapshot?.clockMilliseconds);
  const counters = snapshot?.counters ?? {};
  const statistics = snapshot?.statistics ?? {};
  const home = (statistics.home ?? {}) as Record<string, number | string | null>;
  const away = (statistics.away ?? {}) as Record<string, number | string | null>;
  const totalCards = (side: Record<string, any>) => {
    const yellow = asNumber(side.yellow), red = asNumber(side.red);
    return yellow === null && red === null ? null : (yellow ?? 0) + (red ?? 0);
  };
  const goalBaseline = contract?.event === 'goal' ? pairText(contract?.entryBaseline) : null;
  const metricRows: { label: string; value: string | null }[] = [
    { label: 'Golat', value: score ?? (snapshot?.isLive === false ? pairText(counters.goal) : goalBaseline) },
    { label: 'Kornerat', value: pairText(counters.corner) ?? pairText({ home: home.corners, away: away.corners }) },
    { label: 'Kartona gjithsej', value: pairText(counters.card) ?? pairText({ home: totalCards(home), away: totalCards(away) }) },
    { label: 'Faulle', value: pairText(counters.foul) ?? pairText({ home: home.fouls, away: away.fouls }) },
  ];
  const extraStats = [
    ['Gjuajtje', 'shots'], ['Gjuajtje në kuadrat', 'shotsOnTarget'],
    ['Pozicion', 'possession'], ['Jashtë loje', 'offsides'],
    ['Kartona të verdhë', 'yellow'], ['Kartona të kuq', 'red'],
  ] as const;
  const finalStatistics = item.finalCounters?.statistics ?? item.finalStatistics ?? {};
  const finalRows = [
    { label: 'Kornera', value: pairText(item.finalCounters?.corners) },
    { label: 'Kartona', value: pairText(item.finalCounters?.cards) },
    { label: 'Gjuajtje', value: pairText(finalStatistics.shots) },
    { label: 'Gjuajtje në kuadrat', value: pairText(finalStatistics.shotsOnTarget) },
    { label: 'Faulle', value: pairText(finalStatistics.fouls) },
    { label: 'Jashtë loje', value: pairText(finalStatistics.offsides) },
  ].filter(row => row.value !== null);
  const otherRows = extraStats.map(([label, key]) => {
    const value = pairText({ home: home[key], away: away[key] });
    return { label, value: key === 'possession' && value ? value.replace(' – ', '% – ') + '%' : value };
  }).filter(row => row.value !== null);

  return (
    <section className="rounded-xl border border-tertiary bg-primary/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Gauge size={16} className="text-sky-400" />
          Gjendja në momentin e bastit
        </div>
        <span className="text-[11px] text-text-secondary">
          {snapshot?.capturedAt ? `Snapshot: ${formatDateTime(snapshot.capturedAt)}` : 'Snapshot historik'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-tertiary bg-secondary/70 p-3">
          <div className="text-[10px] uppercase tracking-wider text-text-secondary">Rezultati në vendosje</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-white">{score ?? 'Nuk ruhet'}</div>
        </div>
        <div className="rounded-lg border border-tertiary bg-secondary/70 p-3">
          <div className="text-[10px] uppercase tracking-wider text-text-secondary">Minuta në vendosje</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-white">
            {minute === null ? 'Nuk ruhet' : `${Math.floor(minute / 60000)}′`}
          </div>
          <div className="text-[11px] text-text-secondary">{snapshot?.feedPhase ?? 'Faza nuk ruhet'}</div>
        </div>
        <div className="rounded-lg border border-tertiary bg-secondary/70 p-3">
          <div className="text-[10px] uppercase tracking-wider text-text-secondary">Rezultati final</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-white">{item.finalScore ?? 'Ende pa rezultat'}</div>
        </div>
      </div>
      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Numëruesit në vendosje</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metricRows.map(row => (
            <div key={row.label} className="rounded-lg border border-tertiary/80 bg-secondary/50 px-3 py-2">
              <div className="text-[10px] text-text-secondary">{row.label}</div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-white">{row.value ?? 'Pa të dhëna'}</div>
            </div>
          ))}
        </div>
      </div>
      {otherRows.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Statistika shtesë në vendosje</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {otherRows.map(row => (
              <div key={row.label} className="flex items-center justify-between gap-2 rounded-lg border border-tertiary/80 bg-secondary/50 px-3 py-2">
                <span className="text-[11px] text-text-secondary">{row.label}</span>
                <span className="text-xs font-bold tabular-nums text-white">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {finalRows.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Statistika finale të arkivuara</div>
            <span className="text-[10px] text-text-secondary">Burimi: {item.finalCounters?.source ?? 'I panjohur'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {finalRows.map(row => (
              <div key={row.label} className="flex items-center justify-between gap-2 rounded-lg border border-tertiary/80 bg-secondary/50 px-3 py-2">
                <span className="text-[11px] text-text-secondary">{row.label}</span>
                <span className="text-xs font-bold tabular-nums text-white">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!snapshot && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          Për këtë biletë historike nuk është ruajtur snapshot-i i plotë në momentin e vendosjes. Vlerat që mungojnë nuk plotësohen me hamendësime.
        </p>
      )}
    </section>
  );
}

function MatchTimeline({ item }: { item: ReviewItem }) {
  const events = item.eventTimeline ?? [];
  const snapshot = item.placementSnapshot ?? (item.liveContract?.acceptedLiveSnapshot as PlacementSnapshot | undefined) ?? null;
  const coverage = item.eventCoverage ?? [];
  const coverageLabels: Record<string, string> = { goal: 'Gola', corner: 'Kornera', card: 'Kartona', foul: 'Faulle' };
  const eventOrdinals = new Map<string, number>();
  const scoreAfterGoal = new Map<string, string>();
  for (const kind of ['goal', 'corner', 'card', 'foul']) {
    const proof = coverage.find(entry => entry.kind === kind);
    const kindEvents = events.filter(event => event.kind === kind);
    if (proof?.confirmed && proof.complete &&
        proof.countHome + proof.countAway === kindEvents.length && kindEvents.length > 0) {
      kindEvents.forEach((event, index) => eventOrdinals.set(event.id, index + 1));
      if (kind === 'goal' && !kindEvents.some(event => event.ownGoal === true)) {
        let homeGoals = 0, awayGoals = 0;
        for (const event of kindEvents) {
          if (event.team === 'home') homeGoals++;
          else if (event.team === 'away') awayGoals++;
          scoreAfterGoal.set(event.id, `${homeGoals} – ${awayGoals}`);
        }
      }
    }
  }

  return (
    <section className="rounded-xl border border-tertiary bg-primary/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <History size={16} className="text-sky-400" />
          Kronologjia e ndeshjes
        </div>
        <span className="text-[11px] text-text-secondary">{events.length} ngjarje në arkiv</span>
      </div>
      {coverage.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {coverage.map(entry => (
            <span key={entry.kind} className="inline-flex items-center gap-1.5 rounded-md border border-tertiary bg-secondary/70 px-2 py-1 text-[10px] text-text-secondary">
              <span className="font-semibold text-white">{coverageLabels[entry.kind] ?? entry.kind}</span>
              <span>{entry.countHome}–{entry.countAway}</span>
              <span>deri në {entry.throughMinute}′</span>
              <span className={entry.complete ? 'text-emerald-300' : 'text-amber-300'}>{entry.complete ? 'E plotë' : 'Pjesore'}</span>
              <span className={entry.confirmed ? 'text-emerald-300' : 'text-amber-300'}>{entry.confirmed ? 'Konfirmuar' : 'Pakonfirmuar'}</span>
            </span>
          ))}
        </div>
      )}
      {events.length > 0 ? (
        <div className="relative space-y-2 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-tertiary">
          {events.map(event => {
            const relation = eventRelation(event, snapshot);
            const isHome = event.team === 'home';
            return (
              <div key={event.id} className="relative flex items-start gap-3">
                <span className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-tertiary bg-secondary text-[10px] font-black tabular-nums text-white">
                  {eventMinuteLabel(event)}′
                </span>
                <div className="min-w-0 flex-1 rounded-lg border border-tertiary/80 bg-secondary/50 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-xs font-bold text-white">{eventTitle(event, eventOrdinals.get(event.id))}</span>
                    <span className="text-[10px] text-text-secondary">{eventTime(event)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-secondary">
                    <span>{isHome ? (item.homeTeamName || 'Vendasit') : (item.awayTeamName || 'Miqtë')}</span>
                    {scoreAfterGoal.has(event.id) && (
                      <span className="font-semibold text-white">Rezultati: {scoreAfterGoal.get(event.id)}</span>
                    )}
                    {event.playerName && <span className="font-medium text-white">{event.playerName}</span>}
                    {event.phase && <span>· {event.phase}</span>}
                    {relation && (
                      <span className={relation === 'Pas bastit' ? 'font-semibold text-emerald-300' : 'text-sky-300'}>
                        · {relation}
                      </span>
                    )}
                    <span className={event.verified ? 'text-emerald-300' : 'text-amber-300'}>
                      · {event.verified ? 'E konfirmuar' : 'E arkivuar, pa konfirmim'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-3">
          <div className="text-xs font-semibold text-amber-200">Nuk ka ngjarje të arkivuara për këtë ndeshje.</div>
          <p className="mt-1 text-[11px] text-text-secondary">
            Kjo nuk do të thotë se nuk pati ngjarje. Sistemi nuk shfaq ngjarje pa prova të ruajtura nga burimi kryesor.
          </p>
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-text-secondary">
        Kronologjia përfshin ngjarjet e arkivuara të Zizobet. Çdo rresht shënohet si i konfirmuar ose jo; vetëm ngjarjet e konfirmuara janë prova të verifikuara. Gjuajtjet dhe pozicioni ruhen si numërues në snapshot, jo si ngjarje individuale.
      </p>
    </section>
  );
}

export default function ManualReviewQueue({ onlyLineId, onSaved }: { onlyLineId?: string; onSaved?: () => void } = {}) {
  const [approval, setApproval] = useState<{ item: ReviewItem; decision: Decision } | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  async function load(append = false) {
    setRefreshing(true);
    const offset = append ? nextOffset : 0;
    try {
      const res = await apiClient.get('/admin/settlement-review-queue', { params: { limit: 2000, offset } });
      const incoming: ReviewItem[] = Array.isArray(res.data?.items)
        ? res.data.items.filter((item: ReviewItem) => !onlyLineId || item.lineId === onlyLineId)
        : [];
      setItems(previous => {
        if (append) {
          const seen = new Set(previous.map(item => item.lineId));
          return [...previous, ...incoming.filter(item => !seen.has(item.lineId))];
        }
        return incoming;
      });
      setNextOffset(Number(res.data?.nextOffset ?? (offset + incoming.length)));
      setHasMore(res.data?.hasMore === true);
      setError('');
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Lista e verifikimeve nuk u ngarkua.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [onlyLineId]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter(item => {
      if (statusFilter !== 'ALL' && item.lineStatus !== statusFilter) return false;
      if (!term) return true;
      return [
        item.matchName, item.marketName, item.outcomeName, item.username,
        item.ticketId, item.lineId, item.matchId, item.reason,
      ].some(value => String(value ?? '').toLowerCase().includes(term));
    });
  }, [items, search, statusFilter]);

  const change = (id: string, key: keyof Decision, value: string) => setDecisions(prev => ({
    ...prev,
    [id]: { ...(prev[id] ?? fresh), [key]: value }
  }));

  async function decide(item: ReviewItem, entry: Decision) {
    setBusy(item.lineId);
    setError('');
    setNotice('');
    try {
      const res = await apiClient.post('/admin/manual-settlement', {
        lineId: item.lineId,
        status: entry.status,
        reason: entry.reason?.trim() || 'Ndryshim manual nga administratori',
        source: entry.source?.trim() || 'ADMIN',
      });
      setNotice('Vendimi u regjistrua me sukses për ' + (res.data.changed?.length ?? 0) + ' biletë/a.');
      setDecisions(prev => {
        const next = { ...prev };
        delete next[item.lineId];
        return next;
      });
      setApproval(null);
      onSaved?.();
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Vendimi manual dështoi.');
    } finally {
      setBusy(null);
    }
  }

  const activeNotices = items.filter(item => item.notificationActive).length;
  const pendingCount = items.filter(item => item.lineStatus === 'PENDING').length;
  const voidCount = items.filter(item => item.lineStatus === 'VOID').length;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-3 sm:p-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-tertiary bg-secondary/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-white sm:text-xl">
            <ShieldCheck size={21} className="text-sky-400" />
            Bileta Pending · të gjithë lojtarët
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-text-secondary">
            Lista përfshin të gjitha biletat Pending të çdo lojtari. Rastet që kërkojnë ndërhyrje manuale dallohen veçmas; biletat normale që presin rezultatin nuk shënohen si gabim.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-tertiary bg-primary px-4 py-2.5 text-xs font-semibold text-white transition hover:border-sky-500/50 hover:bg-primary/80 disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Rifresko listën
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-tertiary bg-secondary/60 p-3.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Bileta në listë</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-white">{items.length.toLocaleString('sq-AL')}</div>
        </div>
        <div className="rounded-xl border border-tertiary bg-secondary/60 p-3.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Njoftime aktive</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-amber-300">{activeNotices.toLocaleString('sq-AL')}</div>
        </div>
        <div className="rounded-xl border border-tertiary bg-secondary/60 p-3.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Në pritje / të pavlefshme</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-white">{pendingCount} <span className="text-sm font-medium text-text-secondary">/</span> {voidCount}</div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-tertiary bg-secondary/60 p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Kërko ndeshje, treg, lojtar ose ID bilete…"
            className="w-full rounded-lg border border-tertiary bg-primary py-2.5 pl-9 pr-3 text-xs text-white outline-none placeholder:text-text-secondary/70 focus:border-sky-500/60"
          />
        </div>
        <select
          value={statusFilter}
          onChange={event => setStatusFilter(event.target.value)}
          className="rounded-lg border border-tertiary bg-primary px-3 py-2.5 text-xs text-white outline-none focus:border-sky-500/60"
        >
          <option value="ALL">Të gjitha statuset</option>
          <option value="PENDING">Në pritje</option>
          <option value="VOID">Të pavlefshme</option>
        </select>
        <div className="px-1 text-[11px] tabular-nums text-text-secondary">{visibleItems.length} të shfaqura</div>
      </div>

      {hasMore && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-tertiary bg-secondary/60 px-3 py-3">
          <span className="text-xs text-text-secondary">Ka bileta të tjera jashtë kësaj faqeje.</span>
          <button type="button" onClick={() => void load(true)} disabled={refreshing}
            className="rounded-lg border border-tertiary bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {refreshing ? 'Duke ngarkuar…' : 'Ngarko më shumë bileta'}
          </button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-semibold text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-200">{notice}</p>}
      {loading && <p className="py-6 text-center text-sm text-text-secondary">Duke ngarkuar biletat…</p>}

      {!loading && !visibleItems.length && (
        <div className="rounded-2xl border border-tertiary bg-secondary/60 p-10 text-center">
          <ShieldCheck size={32} className="mx-auto mb-2 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">{items.length ? 'Nuk u gjet asnjë rast për këtë kërkim' : 'Nuk ka bileta që kërkojnë verifikim manual'}</h3>
          <p className="mt-1 text-xs text-text-secondary">{items.length ? 'Ndrysho tekstin ose filtrin e statusit.' : 'Rastet e pazgjidhura do të shfaqen këtu.'}</p>
        </div>
      )}

      {approval && items.some(item => item.lineId === approval.item.lineId) && (
        <section aria-label="Miratimi i vendimit" className="rounded-xl border border-amber-400/40 bg-amber-950/30 p-4 sm:p-5 space-y-3">
          <p className="font-bold text-white">Konfirmo vendimin për këtë përzgjedhje</p>
          <p className="text-xs text-amber-100">
            {approval.item.matchName} · {approval.item.marketName} · <strong>{approval.item.outcomeName}</strong>
          </p>
          <p className="text-xs font-semibold text-white">Statusi i ri: {statusText(approval.decision.status)}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={busy !== null} className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50" onClick={() => void decide(approval.item, approval.decision)}>
              Po, mirato
            </button>
            <button type="button" disabled={busy !== null} className="rounded-lg border border-tertiary px-4 py-2 text-xs font-semibold text-text-secondary hover:text-white" onClick={() => setApproval(null)}>
              Kthehu
            </button>
          </div>
        </section>
      )}

      <div className="space-y-4">
        {visibleItems.map(item => {
          const decision = decisions[item.lineId] ?? fresh;
          const stakeNum = Number(item.stake || 0);
          const oddsNum = Number(item.odds || 0);
          const potentialNum = item.potentialPayout ? Number(item.potentialPayout) : stakeNum * oddsNum;
          const evidenceExpanded = expandedItems[item.lineId] === true;

          return (
            <article key={item.lineId} className="overflow-hidden rounded-xl border border-tertiary bg-secondary/60 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-tertiary bg-primary/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-tertiary bg-secondary px-2.5 py-1 font-mono text-[11px] font-bold text-white">
                    <Ticket size={13} className="text-sky-400" />
                    #{item.ticketId.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
                    <Calendar size={13} />
                    {formatDateTime(item.placedAt)}
                  </span>
                  {item.username && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
                      <User size={13} />
                      <strong className="font-semibold text-white">{item.username}</strong>
                    </span>
                  )}
                </div>
                <span className={`w-fit rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  item.lineStatus === 'VOID'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                }`}>
                  {statusText(item.lineStatus)}
                </span>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_1fr_0.8fr]">
                  <div className="rounded-lg border border-tertiary bg-primary/50 p-3.5">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Ndeshja</div>
                    <h3 className="text-sm font-bold leading-snug text-white">{item.matchName}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-secondary">
                      <span>ID: {item.matchId}</span>
                      <span>·</span>
                      <span>Rezultati final: {item.finalScore ?? 'I padisponueshëm'}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-tertiary bg-primary/50 p-3.5">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Tregu dhe përzgjedhja</div>
                    <div className="text-xs font-semibold text-white">{item.marketName} {item.marketLine}</div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-md border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-xs font-bold text-sky-100">{item.outcomeName}</span>
                      <span className="font-mono text-sm font-bold text-white">@{oddsNum.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-tertiary bg-primary/50 p-3.5">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Financat</div>
                    <div className="flex items-center justify-between gap-2 text-xs"><span className="text-text-secondary">Basti</span><strong className="font-mono text-white">{money(stakeNum)} Lek</strong></div>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-tertiary pt-2 text-xs"><span className="text-text-secondary">Fitimi i mundshëm</span><strong className="font-mono text-amber-300">{money(potentialNum)} Lek</strong></div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    aria-expanded={evidenceExpanded}
                    onClick={() => setExpandedItems(prev => ({ ...prev, [item.lineId]: !evidenceExpanded }))}
                    className="inline-flex items-center gap-2 rounded-lg border border-tertiary bg-primary/60 px-3 py-2 text-[11px] font-semibold text-sky-200 transition hover:border-sky-500/50 hover:bg-primary"
                  >
                    <History size={14} />
                    {evidenceExpanded ? 'Mbyll provat dhe kronologjinë' : 'Shfaq snapshot-in dhe kronologjinë'}
                  </button>
                </div>
                {evidenceExpanded && (
                  <div className="space-y-3">
                    <PlacementEvidence item={item} />
                    <MatchTimeline item={item} />
                  </div>
                )}

                <div className={"rounded-lg p-3.5 " + (item.requiresReview ? 'border border-amber-500/25 bg-amber-500/5' : 'border border-tertiary bg-primary/40')}>
                  <div className="flex items-start gap-2.5">
                    {item.requiresReview ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-400" /> : <Clock size={17} className="mt-0.5 shrink-0 text-text-secondary" />}
                    <div className="min-w-0">
                      <div className={"text-xs font-bold " + (item.requiresReview ? 'text-amber-100' : 'text-text-secondary')}>
                        {labels[item.reason] ?? item.reason}
                      </div>
                      {item.requiresReview && <div className="mt-1 text-[10px] text-text-secondary">
                        {item.notificationActive ? 'Njoftimi aktiv deri më ' + formatDateTime(item.noticeExpiresAt) : 'Njoftimi ka skaduar · Verifikimi mbetet i hapur'}
                      </div>}
                      {item.conflicts && Object.keys(item.conflicts).length > 0 && (
                        <div className="mt-1 text-[11px] font-semibold text-rose-300">Statistika kontradiktore: {Object.keys(item.conflicts).join(', ')}</div>
                      )}
                    </div>
                  </div>
                </div>

                {item.requiresReview && <div className="flex flex-col gap-3 border-t border-tertiary pt-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-semibold text-text-secondary">Vendimi:</span>
                    {[
                      { value: 'WON', label: 'Fituese', icon: CheckCircle2, activeClass: 'border-emerald-500 bg-emerald-500/15 text-emerald-200' },
                      { value: 'LOST', label: 'Humbëse', icon: XCircle, activeClass: 'border-rose-500 bg-rose-500/15 text-rose-200' },
                      { value: 'VOID', label: 'Anulo', icon: RotateCcw, activeClass: 'border-slate-400 bg-slate-500/15 text-slate-200' },
                      { value: 'PENDING', label: 'Në pritje', icon: Clock, activeClass: 'border-amber-400 bg-amber-500/15 text-amber-100' },
                    ].map(option => {
                      const selected = decision.status === option.value;
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => change(item.lineId, 'status', option.value)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition ${
                            selected ? option.activeClass : 'border-tertiary bg-primary/60 text-text-secondary hover:bg-primary hover:text-white'
                          }`}
                        >
                          <Icon size={13} />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onlyLineId ? setApproval({ item, decision: { ...decision } }) : void decide(item, decision)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-white disabled:opacity-40 lg:ml-auto"
                  >
                    <ShieldCheck size={14} />
                    {busy === item.lineId ? 'Duke ruajtur…' : 'Ruaj vendimin'}
                  </button>
                </div>}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
