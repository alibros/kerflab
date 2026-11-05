/**
 * Shared helpers for the tray generators (typetray, traylayout, trayinsert, compartmentbox,
 * dividertray, smallpartstray, bintray): boxes.py SlottedEdge sides, slot rows placed from world
 * geometry, crossing-slot (egg-crate) joints, size lists, and automatic mating of coincident
 * joint lines.
 *
 * Grids of compartments have many joints, so generators here place panels in world space and let
 * `slotInto` / `crossing` / `autoMate` derive the interior slot rows and the mates from where the
 * joint lines actually are. That is a generator-side convenience only: the harness still checks
 * every mate independently (mutual, complementary, coincident lines, contact).
 */
import { complement } from '../core/edges';
import { fingerHolesFor, fingerJoint } from '../core/edges/finger';
import type { EdgeCtx } from '../core/edges/types';
import { flatten, mat3Multiply, mat3Rotate, mat3Translate, transform, type Path, type Vec2 } from '../core/geometry';
import { placementNormal, toLocal, toWorld, type Vec3 } from '../core/part';
import type { Params } from '../core/schema';
import type { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { sideLine, type CustomSide, type PanelSpec, type WallLine } from './walls';

export const TRAY_CATEGORY = 'Trays & organizers';

// ---------------------------------------------------------------- size lists

/** Pattern (schema `text` kind) for an optional comma-separated list of positive numbers. */
export const LIST_PATTERN = String.raw`\s*(?:\d+(?:\.\d*)?|\.\d+)?(?:\s*,\s*(?:\d+(?:\.\d*)?|\.\d+))*\s*`;

/** Parses a comma-separated list of positive numbers; empty text gives []. ParamError names `key`. */
export function parseList(p: Params, key: string, max: number): number[] {
  const raw = p[key];
  if (typeof raw !== 'string') throw new ParamError(`${key} must be text`, key);
  if (raw.trim() === '') return [];
  const out = raw.split(',').map((s) => Number(s.trim()));
  if (out.some((v) => !(Number.isFinite(v) && v > 0)))
    throw new ParamError(`${key} must be a comma-separated list of positive numbers, got "${raw}"`, key);
  if (out.length > max) throw new ParamError(`${key} has ${out.length} entries; at most ${max} are supported`, key);
  return out;
}

/** n equal parts of `total`. */
export const equal = (total: number, n: number): number[] => Array.from({ length: n }, () => total / n);

/** Splits `total` in proportion to `weights`. */
export const proportional = (total: number, weights: number[]): number[] => {
  const s = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (total * w) / s);
};

/** Total inner length of compartments `s` separated by walls of thickness t. */
export const span = (s: number[], t: number): number => s.reduce((a, b) => a + b, 0) + (s.length - 1) * t;

/** Start offsets of the walls between compartments `s` (each wall t thick), from the first compartment's start. */
export const wallOffsets = (s: number[], t: number): number[] => {
  const out: number[] = [];
  let a = 0;
  for (let i = 0; i + 1 < s.length; i++) {
    a += s[i]!;
    out.push(a);
    a += t;
  }
  return out;
};

// ---------------------------------------------------------------- slotted sides

/** Runs of a slotted side in travel order: pieces[k] separated by gaps[k] (length of the gap). */
export type Runs = { pieces: number[]; gaps: number[] };

/**
 * Pieces and gaps of side `side` (0..3, travel CCW as in rectangularWall) of a w x h inner
 * rectangle, given the gaps as local ranges along the side's axis (u for sides 0/2, v for 1/3).
 */
export function runsFor(side: number, w: number, h: number, ranges: [number, number][]): Runs {
  const len = side % 2 === 0 ? w : h;
  const rev = side === 2 || side === 3;
  const along = ranges.map(([a, b]) => (rev ? [len - Math.max(a, b), len - Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)]) as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const pieces: number[] = [];
  const gaps: number[] = [];
  let pos = 0;
  for (const [a, b] of along) {
    pieces.push(a - pos);
    gaps.push(b - a);
    pos = b;
  }
  pieces.push(len - pos);
  if (pieces.some((l) => !(l > 1e-9))) throw new Error(`runsFor: overlapping or out-of-range gaps on side ${side}`);
  return { pieces, gaps };
}

export type PieceKind = 'finger' | 'flat' | 'grip' | 'notch';

/** boxes.py FingerHoleEdge 'A' (typetray): a rounded cut-out `depth` deep, `rel` of the length wide. */
export type Grip = { depth: number; rel?: number; radius?: number };

function gripEdge(tu: Turtle, l: number, g: Grip): void {
  const width = Math.min((g.rel ?? 0.3) * l, l);
  const depth = g.depth;
  const r = Math.min(width / 2, depth, g.radius ?? 10);
  if (!(depth > 1e-9 && width > 1e-9 && r > 1e-9)) {
    tu.forward(l);
    return;
  }
  tu.forward((l - width) / 2);
  tu.turn(90);
  tu.forward(depth - r);
  tu.arc(r, -90);
  tu.forward(width - 2 * r);
  tu.arc(r, -90);
  tu.forward(depth - r);
  tu.turn(90);
  tu.forward((l - width) / 2);
}

/**
 * boxes.py DividerNotchesEdge (dividertray): a finger notch `depth` deep in the middle third of a
 * piece of length l, with rounded corners (upper radius 1 mm, lower 8 mm, both capped by the
 * depth). Too narrow a piece stays straight.
 */
export function notchEdge(tu: Turtle, l: number, depth: number): void {
  const ur = Math.min(1, depth / 4);
  const lr = Math.min(8, depth / 2);
  const third = (l - 2 * ur - 2 * lr) / 3;
  if (!(depth > 1e-9 && third > 1e-9)) {
    tu.forward(l);
    return;
  }
  const straight = depth - ur - lr;
  tu.forward(third);
  tu.arc(ur, 90);
  tu.forward(straight);
  tu.arc(lr, -90);
  tu.forward(third);
  tu.arc(lr, -90);
  tu.forward(straight);
  tu.arc(ur, 90);
  tu.forward(third);
}

/**
 * Gap ranges for crossing slots: each [a, b] (one thickness, the crossing panel's faces) widened
 * by the joint play, centred, so the slot is t + play wide. Pass these to runsFor for every side
 * whose gaps become slots (slotDepth > 0), and use the same Runs for that side's joint lines.
 */
export const slotRanges = (ranges: [number, number][], play: number): [number, number][] =>
  ranges.map(([a, b]) => [Math.min(a, b) - play / 2, Math.max(a, b) + play / 2]);

/**
 * boxes.py SlottedEdge: pieces of edge `kind` separated by gaps; with `slot` > 0 each gap is a
 * slot `slot` deep cut into the panel, exactly the gap wide. Callers size slot gaps with
 * slotRanges (t + play, so a crossing panel of one thickness slides in with the joint play).
 */
export function slottedSide(runs: Runs, kind: PieceKind, slotDepth: number | number[], ctx: EdgeCtx, grip?: Grip): CustomSide {
  // `grip` sizes the 'grip' cut-outs; for 'notch' pieces only its depth is used. `slotDepth` may
  // give one depth per gap (in travel order).
  return {
    start: 0, end: 0,
    draw: (tu) => {
      runs.pieces.forEach((l, k) => {
        if (kind === 'finger') fingerJoint(tu, l, ctx);
        else if (kind === 'grip' && grip) gripEdge(tu, l, grip);
        else if (kind === 'notch' && grip) notchEdge(tu, l, grip.depth);
        else tu.forward(l);
        const g = runs.gaps[k];
        if (g === undefined) return;
        const slot = typeof slotDepth === 'number' ? slotDepth : (slotDepth[k] ?? 0);
        if (slot > 0) {
          tu.turn(90); tu.forward(slot); tu.turn(-90);
          tu.forward(g);
          tu.turn(-90); tu.forward(slot); tu.turn(90);
        } else tu.forward(g);
      });
    },
  };
}

/** Side id of finger piece k on side `side` of a slotted panel. */
export const runSide = (side: number, k: number): number => 100 * (side + 1) + k;

/** Joint lines of the finger pieces of a slotted side (one thickness out, side ids runSide(side, k)). */
export function runLines(side: number, w: number, h: number, runs: Runs, t: number): WallLine[] {
  const out: WallLine[] = [];
  let a = 0;
  runs.pieces.forEach((l, k) => {
    out.push({ side: runSide(side, k), type: 'finger', ...sideLine(side, a, l, t, w, h) });
    a += l + (runs.gaps[k] ?? 0);
  });
  return out;
}

// ---------------------------------------------------------------- world-space joints

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** World point -> spec-local 2D; throws (generator bug) unless it lies in the spec's z = 0 plane. */
export function localOn(spec: PanelSpec, w: Vec3, what: string): Vec2 {
  const [x, y, z] = toLocal(spec.placement, w);
  if (Math.abs(z) > 1e-6) throw new Error(`${what}: point is ${z.toFixed(4)} mm off the z = 0 face of ${spec.id}`);
  return { x, y };
}

/**
 * Declares a flat resting mate between `a` and `b` along the world segment A..B (side id `side`
 * on both), on each part's z = 0 face or, where its entry in `inner` is true, on its inner face
 * (PartEdge.face, local z = t): put the line where the two parts actually touch.
 */
export function rest(a: PanelSpec, b: PanelSpec, A: Vec3, B: Vec3, side: number, t: number, inner: [boolean, boolean] = [false, false]): void {
  const on = (s: PanelSpec, w: Vec3, deep: boolean): Vec2 => {
    const [x, y, z] = toLocal(s.placement, w);
    const want = deep ? t : 0;
    if (Math.abs(z - want) > 1e-6) throw new Error(`rest ${a.id} / ${b.id}: point is ${(z - want).toFixed(4)} mm off the ${deep ? 'inner' : 'z = 0'} face of ${s.id}`);
    return { x, y };
  };
  const line = (s: PanelSpec, P: Vec3, Q: Vec3, deep: boolean): WallLine =>
    ({ side, type: 'flat', from: on(s, P, deep), to: on(s, Q, deep), ...(deep ? { face: 'inner' as const } : {}) });
  a.lines = [...a.lines, line(a, A, B, inner[0])];
  b.lines = [...b.lines, line(b, B, A, inner[1])];
  a.mates[side] = [b.id, side];
  b.mates[side] = [a.id, side];
}

/** Next free side id >= `from` on a spec. */
export function freeSide(spec: PanelSpec, from: number): number {
  const used = new Set(spec.lines.map((l) => l.side));
  let s = from;
  while (used.has(s)) s++;
  return s;
}

/**
 * Cuts a row of slots (boxes.py fingerHolesAt) into `target` for each listed finger line of
 * `source` (a panel standing on target's face, e.g. a divider on the floor), and declares it as
 * an interior joint (PartEdge.holes) on target's line at the same world position. The slots are
 * centred on the source's mid-plane (half a thickness along its normal from its z = 0 face).
 */
export function slotInto(target: PanelSpec, source: PanelSpec, sides: number[], ctx: EdgeCtx,
  fingers: Record<number, { from: Vec2; to: Vec2 }> = {}): void {
  const t = ctx.thickness;
  const n = placementNormal(source.placement);
  const d = { x: dot3(n, target.placement.x), y: dot3(n, target.placement.y) };
  for (const s of sides) {
    const line = source.lines.find((l) => l.side === s);
    if (!line) throw new Error(`slotInto: ${source.id} has no side ${s}`);
    const what = `slotInto ${source.id}:${s} -> ${target.id}`;
    const a = localOn(target, toWorld(source.placement, line.from), what);
    const b = localOn(target, toWorld(source.placement, line.to), what);
    // The slots follow the finger edge, which may be longer than the declared joint line (a line
    // cut back at an angled corner): `fingers[s]` gives the finger edge's own extent then.
    const fe = fingers[s];
    const fa = fe ? localOn(target, toWorld(source.placement, fe.from), what) : a;
    const fb = fe ? localOn(target, toWorld(source.placement, fe.to), what) : b;
    const len = Math.hypot(fb.x - fa.x, fb.y - fa.y);
    const ang = (Math.atan2(fb.y - fa.y, fb.x - fa.x) * 180) / Math.PI;
    const m = mat3Multiply(mat3Translate(fa.x + (d.x * t) / 2, fa.y + (d.y * t) / 2), mat3Rotate(ang));
    const slots: Path[] = fingerHolesFor(len, ctx).map((sl) => transform(sl, m));
    const side = freeSide(target, 500);
    target.lines = [...target.lines, { side, type: 'fingerHole', from: a, to: b, holes: slots.map((_, k) => target.holes.length + k) }];
    target.holes = [...target.holes, ...slots];
  }
}

/**
 * Declares a crossing-slot joint between two panels along the world segment A..B (on both
 * panels' z = 0 faces, i.e. their common line), mated both ways. Generators use a segment of
 * about two thicknesses centred where the two slots meet, so it hugs both outlines.
 */
export function crossing(a: PanelSpec, b: PanelSpec, A: Vec3, B: Vec3): void {
  const what = `crossing ${a.id} x ${b.id}`;
  const sa = freeSide(a, 1000);
  const sb = freeSide(b, 1000);
  a.lines = [...a.lines, { side: sa, type: 'crossSlot', from: localOn(a, A, what), to: localOn(a, B, what) }];
  b.lines = [...b.lines, { side: sb, type: 'crossSlot', from: localOn(b, A, what), to: localOn(b, B, what) }];
  a.mates[sa] = [b.id, sb];
  b.mates[sb] = [a.id, sa];
}

/**
 * Mates every not-yet-mated joint line (any type but 'flat') with the one line of another spec
 * whose world endpoints coincide (either direction) and whose type is its complement. Throws
 * (a generator bug) when a joint line has no partner or more than one.
 */
export function autoMate(specs: PanelSpec[]): void {
  type Entry = { spec: PanelSpec; line: WallLine; a: Vec3; b: Vec3 };
  const entries: Entry[] = [];
  for (const spec of specs) for (const line of spec.lines)
    if (line.type !== 'flat' && !spec.mates[line.side])
      entries.push({ spec, line, a: toWorld(spec.placement, line.from), b: toWorld(spec.placement, line.to) });
  const near = (p: Vec3, q: Vec3): boolean => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < 1e-6;
  const done = new Set<Entry>();
  for (const e of entries) {
    if (done.has(e)) continue;
    const want = complement(e.line.type);
    const hits = entries.filter((o) => o !== e && !done.has(o) && o.spec !== e.spec && o.line.type === want
      && ((near(o.a, e.a) && near(o.b, e.b)) || (near(o.a, e.b) && near(o.b, e.a))));
    if (hits.length !== 1) throw new Error(`autoMate: ${e.spec.id}:${e.line.side} (${e.line.type}) has ${hits.length} partners`);
    const o = hits[0]!;
    e.spec.mates[e.line.side] = [o.spec.id, o.line.side];
    o.spec.mates[o.line.side] = [e.spec.id, e.line.side];
    done.add(e);
    done.add(o);
  }
}

/**
 * True when every vertex of every hole lies inside `outline` farther than `margin` from it (holes
 * are convex slots here, so their vertices decide). For generators that must reject parameters
 * whose slots would break out of a panel.
 */
export function holesInside(outline: Path, holes: Path[], margin: number): boolean {
  const r = flatten(outline);
  const inside = (q: Vec2): boolean => {
    let odd = false;
    let near = Infinity;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i]!;
      const b = r[j]!;
      if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
      near = Math.min(near, Math.hypot(q.x - a.x - u * dx, q.y - a.y - u * dy));
    }
    return odd && near > margin;
  };
  return holes.every((h) => flatten(h).every(inside));
}

/** Largest overall tray dimension accepted (mm). */
export const MAX_SIZE = 5000;

/** ParamError naming `key` when an overall size exceeds MAX_SIZE. */
export function requireMaxSize(key: string, v: number): void {
  if (v > MAX_SIZE) throw new ParamError(`${key} too large: overall size ${v.toFixed(0)} mm exceeds ${MAX_SIZE} mm`, key);
}
