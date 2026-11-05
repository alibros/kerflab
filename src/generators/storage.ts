/**
 * Shared helpers for the storage & display generators (winerack, spicesrack, laptopstand,
 * bookholder, displayshelf, storageshelf): the category name, rigid re-placement of a whole set
 * of panels (a tray stood on its back becomes a shelf), renaming panels with their mates, and
 * polygon panels from explicit vertices.
 */
import { type Path, type Vec2 } from '../core/geometry';
import type { Placement, Vec3 } from '../core/part';
import type { Turtle } from '../core/turtle';
import type { PanelSpec } from './walls';

export const STORAGE_CATEGORY = 'Storage & display';

/** 3x3 rotation (rows) applied to a vector. */
export type Mat3x3 = [Vec3, Vec3, Vec3];
const mul = (m: Mat3x3, v: Vec3): Vec3 => [0, 1, 2].map((i) => m[i]![0] * v[0] + m[i]![1] * v[1] + m[i]![2] * v[2]) as Vec3;

/** Applies the rigid motion w -> m w + d to every panel's placement (m a rotation, det +1). */
export function moveSpecs(specs: PanelSpec[], m: Mat3x3, d: Vec3): void {
  for (const s of specs) {
    const pl: Placement = s.placement;
    const o = mul(m, pl.origin);
    s.placement = { origin: [o[0] + d[0], o[1] + d[1], o[2] + d[2]], x: mul(m, pl.x), y: mul(m, pl.y) };
  }
}

/** Renames panels (`ids[old] = [newId, newName]`) and every mate that points at them. */
export function renameSpecs(specs: PanelSpec[], rename: (id: string) => [string, string] | undefined): void {
  const map = new Map<string, string>();
  for (const s of specs) {
    const r = rename(s.id);
    if (!r) continue;
    map.set(s.id, r[0]);
    s.id = r[0];
    s.name = r[1];
  }
  for (const s of specs) s.mates = s.mates.map((m) => (m && map.has(m[0]) ? [map.get(m[0])!, m[1]] : m));
}

/** Closed polygon path through `pts` (made CCW). */
export function polygon(pts: Vec2[]): Path {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  const r = a < 0 ? [...pts].reverse() : pts;
  return { start: { ...r[0]! }, closed: true, segs: [...r.slice(1), r[0]!].map((p) => ({ t: 'L' as const, to: { ...p } })) };
}

/**
 * Draws straight lines from the turtle's position through the absolute points `pts` (panel-local),
 * then restores its heading: for custom sides traced point by point (e.g. elliptical bumps).
 */
export function traceTo(tt: Turtle, pts: Vec2[]): void {
  const h = tt.heading;
  for (const q of pts) {
    const p = tt.pos;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < 1e-9) continue;
    tt.turn((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI - tt.heading);
    tt.forward(d);
  }
  tt.turn(h - tt.heading);
}
