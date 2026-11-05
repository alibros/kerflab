/**
 * Job estimate from a nested layout: total cut length (outlines and holes of every placed part;
 * engraving is not counted), laser time at a constant speed, and the stock area the job occupies.
 */
import type { Layout } from './export/layout';
import { cutLength } from './build';

export interface EstimateOptions {
  /** Laser cutting speed, mm per second. */
  speed: number;
  cost?: { perM2: number };
}

export interface Estimate {
  /** Total cut length, mm. */
  cutLengthMm: number;
  /** Cutting time at `speed`, minutes (0 when speed is not positive). */
  minutes: number;
  /** Stock area used, mm2: the sheets the job fills, or the used extent on an unbounded sheet. */
  area: number;
  /** Material cost, when `cost.perM2` was given. */
  cost?: number;
}

export const DEFAULT_SPEED = 15;

export function estimate(layout: Layout, opts: EstimateOptions): Estimate {
  const cutLengthMm = cutLength(layout.placed.flatMap((p) => [p.part.outline, ...p.part.holes]));
  const minutes = opts.speed > 0 ? cutLengthMm / opts.speed / 60 : 0;
  const area = layout.sheets * layout.sheet.w * layout.sheet.h;
  const out: Estimate = { cutLengthMm, minutes, area };
  if (opts.cost) out.cost = (area / 1e6) * opts.cost.perM2;
  return out;
}

const SPEED_KEY = 'kerflab:speed';
export const SPEED_RANGE = { min: 1, max: 500 } as const;

export function clampSpeed(v: number): number {
  return Number.isFinite(v) ? Math.min(Math.max(v, SPEED_RANGE.min), SPEED_RANGE.max) : DEFAULT_SPEED;
}

/** Persisted laser speed (mm/s); the default when unset, unreadable or storage is blocked. */
export function loadSpeed(s?: Storage): number {
  try {
    const raw = (s ?? globalThis.localStorage)?.getItem(SPEED_KEY);
    const n = raw === null || raw === undefined || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? clampSpeed(n) : DEFAULT_SPEED;
  } catch {
    return DEFAULT_SPEED;
  }
}

export function saveSpeed(v: number, s?: Storage): void {
  try {
    (s ?? globalThis.localStorage)?.setItem(SPEED_KEY, String(v));
  } catch {
    /* not persisted */
  }
}

/** "< 1 min", "≈ 12 min", "≈ 1 h 05 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  const m = Math.round(minutes);
  return m < 60 ? `≈ ${m} min` : `≈ ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
