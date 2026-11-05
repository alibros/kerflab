/**
 * Hole patterns (reusable): fields of round, hexagonal-packed, square or slot holes filling a
 * rectangular or circular region, kept clear of fixed holes; plus the standard mounting layouts
 * for fans and NEMA stepper motors. Used by the pattern panel generator. Ideas from boxes.py
 * (florianfesti/boxes) HolePattern / FanHole / NemaPattern / SkadisBoard.
 */
import type { Path, Vec2 } from '../core/geometry';
import { ParamError } from '../core/validate';
import { circle, rect, roundedRect } from './walls';

export const PATTERNS = ['none', 'circles', 'hex', 'squares', 'slots', 'skadis'] as const;
export type PatternKind = (typeof PATTERNS)[number];

export type Region = { kind: 'rect'; x0: number; y0: number; x1: number; y1: number } | { kind: 'circle'; cx: number; cy: number; r: number };

/** A hole to keep clear of: centre and radius of its bounding circle. */
export type Keepout = { c: Vec2; r: number };

export type PatternSpec = { kind: PatternKind; hole: number; spacing: number; slot: number };

/** Most holes in one pattern (keeps cut files, checks and the 3D view manageable). */
export const MAX_HOLES = 1500;

type Cand = { c: Vec2; w: number; h: number; shape: 'circle' | 'square' | 'slot' };

function inRegion(q: Cand, rg: Region): boolean {
  const hw = q.w / 2;
  const hh = q.h / 2;
  if (rg.kind === 'rect') return q.c.x - hw >= rg.x0 && q.c.x + hw <= rg.x1 && q.c.y - hh >= rg.y0 && q.c.y + hh <= rg.y1;
  return Math.hypot(q.c.x - rg.cx, q.c.y - rg.cy) + Math.hypot(hw, hh) <= rg.r;
}

/**
 * Holes of pattern `s` inside region `rg`, centred on `centre`, none closer than `gap` to a keepout.
 * ParamErrors name `spacing` (holes would touch or there would be too many).
 */
export function patternHoles(s: PatternSpec, rg: Region, centre: Vec2, keep: Keepout[], gap: number,
  keys: { spacing: string; slot: string } = { spacing: 'spacing', slot: 'slot_length' }): Path[] {
  if (s.kind === 'none') return [];
  const skadis = s.kind === 'skadis';
  const w = skadis ? 5 : s.hole;
  const h = skadis ? 15 : s.kind === 'slots' ? s.slot : s.hole;
  if (s.kind === 'slots' && !(s.slot >= s.hole)) throw new ParamError(`${keys.slot} must be at least the hole size`, keys.slot);
  const web = s.spacing - w;
  if (!skadis && !(web >= 0.5)) throw new ParamError(`${keys.spacing} too small: ${s.spacing.toFixed(1)} mm between centres leaves no material between ${w.toFixed(1)} mm holes (at least 0.5 mm)`, keys.spacing);
  // Lattice: dx across, dy along, rows offset by `shift` on alternate rows.
  const dx = skadis ? 20 : s.spacing;
  const dy = skadis ? 20 : s.kind === 'hex' ? (s.spacing * Math.sqrt(3)) / 2 : s.kind === 'slots' ? s.slot + web : s.spacing;
  const shift = s.kind === 'hex' ? dx / 2 : 0;
  // Skadis: columns 20 mm apart, holes every 40 mm in a column, alternate columns offset by 20 mm.
  const ext = rg.kind === 'rect' ? { x0: rg.x0, y0: rg.y0, x1: rg.x1, y1: rg.y1 } : { x0: rg.cx - rg.r, y0: rg.cy - rg.r, x1: rg.cx + rg.r, y1: rg.cy + rg.r };
  const ni = Math.ceil((ext.x1 - ext.x0) / dx) + 2;
  const nj = Math.ceil((ext.y1 - ext.y0) / dy) + 2;
  if (ni * nj > 20 * MAX_HOLES) throw new ParamError(`${keys.spacing} too small: the pattern would have more than ${MAX_HOLES} holes`, keys.spacing);
  const out: Path[] = [];
  for (let j = -nj; j <= nj; j++) for (let i = -ni; i <= ni; i++) {
    if (skadis && (i + j) % 2 !== 0) continue;
    const c = { x: centre.x + i * dx + (j % 2 !== 0 ? shift : 0), y: centre.y + j * dy };
    const q: Cand = { c, w, h, shape: s.kind === 'squares' ? 'square' : s.kind === 'circles' || s.kind === 'hex' ? 'circle' : 'slot' };
    if (!inRegion(q, rg)) continue;
    const rq = Math.hypot(w / 2, h / 2);
    if (keep.some((k) => Math.hypot(c.x - k.c.x, c.y - k.c.y) < k.r + rq + gap)) continue;
    out.push(q.shape === 'circle' ? circle(c.x, c.y, w / 2) : q.shape === 'square' ? rect(c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2) : roundedRect(c.x, c.y, w, h, w / 2));
    if (out.length > MAX_HOLES) throw new ParamError(`${keys.spacing} too small: the pattern would have more than ${MAX_HOLES} holes`, keys.spacing);
  }
  return out;
}

/** Standard mounting layouts: hole spacing (square), screw hole diameter, centre opening diameter. */
export const MOUNTS: Record<string, { spacing: number; hole: number; centre: number; fan?: number }> = {
  fan40: { spacing: 32, hole: 3.4, centre: 0, fan: 40 },
  fan60: { spacing: 50, hole: 4.3, centre: 0, fan: 60 },
  fan80: { spacing: 71.5, hole: 4.3, centre: 0, fan: 80 },
  fan92: { spacing: 82.5, hole: 4.3, centre: 0, fan: 92 },
  fan120: { spacing: 105, hole: 4.3, centre: 0, fan: 120 },
  fan140: { spacing: 124.5, hole: 4.3, centre: 0, fan: 140 },
  nema17: { spacing: 31, hole: 3.2, centre: 22.5 },
  nema23: { spacing: 47.14, hole: 5.2, centre: 38.5 },
};
