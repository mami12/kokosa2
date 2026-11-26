export type LiveIncidentKind =
  | 'goal' | 'corner' | 'yellow-card' | 'red-card' | 'foul'
  | 'shot-on-target' | 'offside' | 'shot';
export type IncidentPair = { home?: number | null; away?: number | null };
export type IncidentCounterKey = 'corners' | 'yellowCards' | 'redCards' | 'fouls' | 'shotsOnTarget' | 'offsides' | 'shots';
export interface LiveIncidentSnapshot {
  matchId: string; at: number; homeScore?: number | null; awayScore?: number | null;
  homeTeam?: string | null; awayTeam?: string | null; minute?: number | null;
  counters?: Partial<Record<IncidentCounterKey, IncidentPair | null>>;
}
export interface LiveIncidentBaseline {
  matchId: string; at: number; homeScore: number | null; awayScore: number | null;
  homeTeam: string | null; awayTeam: string | null; minute: number | null;
  counters: Record<IncidentCounterKey, {home:number|null;away:number|null}>;
}
export interface LiveIncidentAlert {
  id: string; matchId: string; kind: LiveIncidentKind; team: 'home' | 'away';
  count: number; at: number; minute: number | null;
  homeTeam: string | null; awayTeam: string | null;
}
export function collectLiveIncidentDeltas(
  snapshot: LiveIncidentSnapshot,
  previous: LiveIncidentBaseline | null,
): { baseline: LiveIncidentBaseline; alerts: LiveIncidentAlert[] };
