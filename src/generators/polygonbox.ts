/**
 * Shared builder for prism boxes on a convex polygon whose corners turn by at most 90 degrees
 * (boxes.py RegularBox and AngledBox share this structure, ProfileBox lays it on its side): one
 * rectangular wall per polygon side, an optional polygon bottom and top plate. Each corner's
 * angled finger joint uses that corner's own turn.
 *
 * Joints (edges listed bottom, right, top, left of each wall):
 *    wall k    L_k * h   'f g f G'   fingers into the plates; angled finger joints at both corners
 *    plates              'F' x n     notched sides reaching the walls' outer faces
 * Every wall has the protruding angled side ('angledFinger', boxes.py 'g') at its right end and the
 * notched one ('angledFingerHole', 'G') at its left end, so any number of sides works and all
 * walls are identical for a regular polygon. The vertical joint lines are the outer corner lines
 * (where neighbouring walls' outer faces meet).
 *
 * World frame: the inner polygon (vertices `inner`, CCW seen from above) lies in z = const planes,
 * the bottom plate's outer face at z = 0 (or the walls' feet when there is no bottom), z up.
 * Wall k stands on side k (inner[k] -> inner[k+1]); its outer face is t outside that side; its
 * local x runs from inner[k+1] to inner[k] (u = -side direction), local y up, normal into the box.
 * The top plate is placed face down (local y = -world y), so its local side j is world side n-1-j.
 */
import { angledFingerWidths } from '../core/edges';
import type { EdgeCtx } from '../core/edges/types';
import type { Path, Vec2 } from '../core/geometry';
import type { Part } from '../core/part';
import { ParamError } from '../core/validate';
import { at, finishPanels, insetPolygon, panel, polygonPlate, rectangularWall, requireJointLength, type PanelSpec, type WallEdges } from './walls';

export type PrismBoxSpec = {
  /** Inner polygon, convex and CCW, every corner turning by at most 90 degrees (corners may differ). */
  inner: Vec2[];
  /** Holes in the bottom plate (its local frame is the inner polygon's). */
  bottomHoles?: Path[];
  /** Inner height of the walls. */
  h: number;
  bottom: 'closed' | 'none';
  /** 'hole': a rim plate whose opening is the inner polygon inset by one thickness. */
  top: 'closed' | 'none' | 'hole';
  ctx: EdgeCtx;
  kerf: number;
  /** Param keys to name in ParamErrors: the one controlling side lengths and the height. */
  keys: { side: (k: number) => string; h: string; corners: string };
  /** Part name for wall k. */
  wallName?: (k: number) => string;
};

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** Exterior turn (degrees) at every corner of a CCW polygon. */
export function cornerTurns(inner: Vec2[]): number[] {
  const n = inner.length;
  return inner.map((_, k) => {
    const a = sub(inner[k]!, inner[(k + n - 1) % n]!);
    const b = sub(inner[(k + 1) % n]!, inner[k]!);
    return (Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * 180) / Math.PI;
  });
}

/** Outer polygon (walls' outer faces): the inner one moved out by t; its bbox is the box footprint. */
export function outerFootprint(inner: Vec2[], t: number): { x: number; y: number } {
  const o = insetPolygon(inner, -t);
  const v = [o.start, ...o.segs.map((s) => s.to)];
  const xs = v.map((q) => q.x);
  const ys = v.map((q) => q.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
}

export function prismBox(s: PrismBoxSpec): Part[] {
  const { inner, h, ctx } = s;
  const t = ctx.thickness;
  const n = inner.length;
  const turns = cornerTurns(inner).map((a) => Math.min(a, 90));
  for (const a of cornerTurns(inner))
    if (!(a > 0 && a <= 90 + 1e-9))
      throw new ParamError(`${s.keys.corners}: corners turning by ${a.toFixed(1)} degrees are too sharp for angled finger joints (max 90)`, s.keys.corners);
  const len = inner.map((p, k) => Math.hypot(inner[(k + 1) % n]!.x - p.x, inner[(k + 1) % n]!.y - p.y));
  len.forEach((l, k) => requireJointLength(s.keys.side(k), l, t, `inner wall ${k + 1} width`));
  requireJointLength(s.keys.h, h, t, 'inner height');

  const bottom = s.bottom === 'closed';
  const top = s.top !== 'none';
  const z0 = bottom ? t : 0;
  const Z = z0 + h + (top ? t : 0);
  const actx: EdgeCtx = { ...ctx, angle: turns[0]! };
  const sides: WallEdges = [bottom ? 'finger' : 'flat', 'angledFinger', top ? 'finger' : 'flat', 'angledFingerHole'];
  const wallId = (k: number): string => `wall${((k % n) + n) % n}`;

  const panels: PanelSpec[] = inner.map((p, k) => {
    const q = inner[(k + 1) % n]!;
    const d = { x: (q.x - p.x) / len[k]!, y: (q.y - p.y) / len[k]! };
    const o = { x: d.y, y: -d.x };
    return panel(wallId(k), s.wallName?.(k) ?? `Wall ${k + 1}`, rectangularWall(len[k]!, h, sides, actx, { angles: [undefined, turns[k]!, undefined, turns[(k + 1) % n]!] }),
      at([q.x + t * o.x, q.y + t * o.y, z0], [-d.x, -d.y, 0], [0, 0, 1]),
      [bottom ? ['bottom', k] : undefined, [wallId(k - 1), 3], top ? ['top', n - 1 - k] : undefined, [wallId(k + 1), 1]]);
  });
  const notched = inner.map(() => 'fingerHole' as const);
  // Each wall is cut back by -base at its 'angledFinger' end (inner[k] of side k); the plates'
  // joint lines stop there too so they coincide with the walls' (see rectangularWall).
  const cut = (k: number): number => -angledFingerWidths(turns[k]!, t).base;
  if (bottom)
    panels.push(panel('bottom', 'Bottom', polygonPlate(inner, notched, ctx, s.bottomHoles ?? [], inner.map((_, k) => [cut(k), 0])), at([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      inner.map((_, k) => [wallId(k), 0])));
  if (top) {
    const local = inner.map((_, j) => inner[(n - j) % n]!).map((v) => ({ x: v.x, y: -v.y }));
    const holes = s.top === 'hole' ? [insetPolygon(local, t)] : [];
    panels.push(panel('top', s.top === 'hole' ? 'Top rim' : 'Top', polygonPlate(local, notched, ctx, holes, local.map((_, j) => [0, cut(n - 1 - j)])),
      at([0, 0, Z], [1, 0, 0], [0, -1, 0]), local.map((_, j) => [wallId(n - 1 - j), 2])));
  }
  return finishPanels(panels, t, s.kerf);
}
