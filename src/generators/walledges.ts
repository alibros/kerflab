/**
 * Wall-system edges (port of the idea of boxes.py `walledges.py`, florianfesti/boxes): the back
 * edge of a wall-mounted part's side walls, made of
 *  - joint pieces: fingers that go through slot rows in the part's back plate (boxes.py 'b'), and
 *  - hook sections: the side wall passes through a rectangular hole in the back plate and carries
 *    a hook behind it that hangs on the wall system (French cleat, slat wall, IKEA Skadis board,
 *    DIN rail), or, for a plain wall, nothing (the back plate is screwed to the wall).
 *
 * Coordinates of a back edge: s runs along the edge from its start (the bottom) upwards, n
 * outwards (towards the wall, right of travel). The edge is drawn on the back plate's INNER face
 * (n = 0); fingers protrude t to its outer face; a section steps out t through the plate, draws its
 * hook profile from the outer face (n = t) and steps back.
 */
import { fingerJoint, fingerLayout } from '../core/edges/finger';
import type { EdgeCtx } from '../core/edges/types';
import type { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import type { CustomSide } from './walls';

export const WALL_TYPES = ['plain', 'french_cleat', 'slatwall', 'skadis', 'dinrail'] as const;
export type WallType = (typeof WALL_TYPES)[number];

/** A J hook: out `dist` (the wall system's lip thickness plus clearance), a bar `bar` tall, a prong `depth` deep reaching `overall` from the bar's bottom, up (behind a slat) or down. */
type JHook = { kind: 'j'; dist: number; depth: number; overall: number; bar: number; up: boolean };
/** French cleat tongue: out `depth`, its underside sloping down towards the wall at `angle`. */
type Cleat = { kind: 'cleat'; depth: number; angle: number };
type Hook = JHook | Cleat;

/** Piece of a back edge: [kind, length]; hooks carry their profile. */
export type BackPiece = { kind: 'joint'; length: number } | { kind: 'hook'; length: number; hook: Hook };

/** Along-edge length of a hook section (the part that passes through the back plate). */
const sectionLength = (h: Hook): number => (h.kind === 'cleat' ? h.depth * Math.tan((h.angle * Math.PI) / 180) + h.depth : h.bar);

/** How far a hook stands out behind the back plate's outer face. */
export const hookReach = (h: Hook): number => (h.kind === 'cleat' ? h.depth : h.dist + h.depth);

/** Hook profile of each wall system; `cleatDepth` for the French cleat (mm). */
function hookFor(type: WallType, cleatDepth: number): Hook[] {
  switch (type) {
    case 'french_cleat': return [{ kind: 'cleat', depth: cleatDepth, angle: 45 }];
    // boxes.py SlatWallSettings: hook_distance 5.5, hook_depth 4, hook_height 6, overall 12, pitch 101.6.
    case 'slatwall': return [{ kind: 'j', dist: 5.5, depth: 4, overall: 12, bar: 6, up: true }];
    // IKEA Skadis: 5.1 mm board, 5 x 15 mm slots on a 40 mm column pitch.
    case 'skadis': return [{ kind: 'j', dist: 5.3, depth: 4.5, overall: 10, bar: 4.5, up: true }];
    // 35 mm DIN rail (1 mm lips): a hook behind the top lip, a snap hook under the bottom lip 35 mm lower.
    case 'dinrail': return [{ kind: 'j', dist: 1.5, depth: 3, overall: 6, bar: 4, up: true }, { kind: 'j', dist: 1.5, depth: 3, overall: 6, bar: 4, up: false }];
    default: return [];
  }
}

/** Vertical repeat of hooks (0: one hook / pair only). */
const PITCH: Partial<Record<WallType, number>> = { slatwall: 101.6, skadis: 40 };

/**
 * Pieces of a back edge `length` long for wall system `type`: hooks from the top down (one
 * thickness below the top), repeated on the system's pitch while they fit, joints in between.
 * Throws ParamError naming `key` when the edge is too short for the first hook.
 */
export function backPieces(type: WallType, length: number, t: number, cleatDepth: number, key: string): BackPiece[] {
  const hooks = hookFor(type, cleatDepth);
  if (hooks.length === 0) return [{ kind: 'joint', length }];
  // Section starts (s), top down. A J hook's prong reaches `overall` from its bar's bottom (up) or top (down).
  const starts: { s: number; hook: Hook }[] = [];
  const top = (h: Hook): number => (h.kind === 'j' && h.up ? h.overall : sectionLength(h));
  const bottom = (h: Hook): number => (h.kind === 'j' && !h.up ? h.overall - h.bar : 0);
  if (type === 'dinrail') {
    const [a, b] = hooks as [JHook, JHook];
    const sa = length - t - a.overall;
    const sb = sa + a.bar - 35 - b.bar; // bottom hook's bar 35 mm below the top hook's bar top
    if (!(sb - bottom(b) >= 3 * t)) throw new ParamError(`${key} too small for a DIN rail mount: the edge must reach 35 mm plus the hooks (and 3 thicknesses) below the top`, key);
    starts.push({ s: sb, hook: b }, { s: sa, hook: a });
  } else {
    const h = hooks[0]!;
    const pitch = PITCH[type] ?? 0;
    let s = length - t - top(h);
    if (!(s - bottom(h) >= 3 * t)) throw new ParamError(`${key} too small for a ${type.replace('_', ' ')} hook: the edge needs ${(t + top(h) + 3 * t).toFixed(1)} mm`, key);
    starts.push({ s, hook: h });
    while (pitch > 0 && (s -= pitch) - bottom(h) >= 3 * t) starts.push({ s, hook: h });
    starts.reverse();
  }
  const out: BackPiece[] = [];
  let pos = 0;
  for (const { s, hook } of starts) {
    if (s - pos > 1e-9) out.push({ kind: 'joint', length: s - pos });
    const l = sectionLength(hook);
    out.push({ kind: 'hook', length: l, hook });
    pos = s + l;
  }
  if (length - pos > 1e-9) out.push({ kind: 'joint', length: length - pos });
  return out;
}

/** Joint pieces long enough for fingers (shorter ones are plain). */
export const fingered = (l: number, ctx: EdgeCtx): boolean => l >= 3 * ctx.thickness && fingerLayout(l, ctx).fingers > 0;

/** Draws a hook section `len` long from the back plate's outer face (turtle heading along the edge). */
function drawHook(tu: Turtle, h: Hook, len: number): void {
  if (h.kind === 'cleat') {
    // Points (n out, s along) from (0, 0): up the face to (0, hgt), down-out to the tip (d, 0)
    // at the wall, up the wall to (d, len), back to (0, len).
    const hgt = h.depth * Math.tan((h.angle * Math.PI) / 180);
    tu.forward(hgt);
    const back = (Math.atan2(-hgt, h.depth) * 180) / Math.PI; // heading of the underside, relative to +n
    tu.turn(-90 + back); tu.forward(Math.hypot(h.depth, hgt)); tu.turn(90 - back);
    tu.forward(len);
    tu.turn(90); tu.forward(h.depth); tu.turn(-90);
    return;
  }
  const a = h.dist + h.depth;
  if (h.up) {
    // Bar out to the prong, prong up to `overall`, back to `dist`, down to the bar's top, back in.
    tu.turn(-90); tu.forward(a); tu.turn(90);
    tu.forward(h.overall);
    tu.turn(90); tu.forward(h.depth); tu.turn(90);
    tu.forward(h.overall - h.bar);
    tu.turn(-90); tu.forward(h.dist); tu.turn(-90);
  } else {
    // Mirror: in at the bottom of the prong first.
    tu.turn(-90); tu.forward(h.dist); tu.turn(-90);
    tu.forward(h.overall - h.bar);
    tu.turn(90); tu.forward(h.depth); tu.turn(90);
    tu.forward(h.overall);
    tu.turn(90); tu.forward(a); tu.turn(-90);
  }
}

/**
 * The back edge as a rectangularWall custom side (start and end widths 0: drawn on the back
 * plate's inner face). Joint pieces long enough carry fingers (`fingered`).
 */
export function backEdge(pieces: BackPiece[], ctx: EdgeCtx): CustomSide {
  const t = ctx.thickness;
  return {
    start: 0, end: 0,
    draw: (tu) => {
      for (const p of pieces) {
        if (p.kind === 'joint') {
          if (fingered(p.length, ctx)) fingerJoint(tu, p.length, ctx);
          else tu.forward(p.length);
          continue;
        }
        tu.turn(-90); tu.forward(t); tu.turn(90);
        drawHook(tu, p.hook, p.length);
        tu.turn(90); tu.forward(t); tu.turn(-90);
      }
    },
  };
}

/** Farthest a back edge's hooks stand out behind the back plate's outer face (0 for plain). */
export const backReach = (pieces: BackPiece[]): number => Math.max(0, ...pieces.map((p) => (p.kind === 'hook' ? hookReach(p.hook) : 0)));
