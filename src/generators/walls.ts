/**
 * Shared panel helpers for the box generators (ported from boxes.py `rectangularWall` and
 * `trapezoidWall`, boxes/__init__.py), plus the PanelSpec -> Part plumbing every generator repeats.
 *
 * Conventions (see closedbox.ts for the worked example):
 *  - A wall's INNER rectangle (or trapezoid) starts at local (0, 0); each side is drawn by its edge
 *    type and pushed outwards by that edge's start width; corners are filled with straight runs.
 *  - Each side's joint line is the side of the inner shape pushed outwards by the joint depth, i.e.
 *    the outer corner line of the box edge, running CCW over the side's inner length.
 *  - Sides are numbered 0..3 = bottom, right, top, left (CCW).
 */
import { edgeFor, type EdgeType } from '../core/edges';
import { angledFingerWidths, fingerHolesFor } from '../core/edges/finger';
import type { EdgeCtx } from '../core/edges/types';
import { mat3Multiply, mat3Rotate, mat3Translate, transform, type Mat3, type Path, type Vec2 } from '../core/geometry';
import { finishWithKerf, type Bend, type Part, type PartEdge, type Placement, type Vec3 } from '../core/part';
import type { Params } from '../core/schema';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';

/**
 * A wall side: any edge type, `'fingerHoles'` (boxes.py 'h', FingerHoleEdge): a plain edge set
 * out by a brim (default one thickness) plus one thickness of slot, with a row of slots that the
 * mating panel's fingers ('finger') pass through, or `'outset'` (boxes.py 'E', OutSetEdge): a plain
 * edge set out by one thickness (it covers the corner column of a neighbouring panel). A
 * finger-hole side's joint metadata reports the type `'fingerHole'` (the complement of 'finger'):
 * it receives fingers, just through slots instead of open notches; an outset side reports 'flat'.
 */
export type WallEdge = EdgeType | 'fingerHoles' | 'outset';

/**
 * A side made of consecutive pieces (boxes.py CompoundEdge): `[type, length]` in travel order,
 * lengths summing to the side length. Each piece is drawn at its own start width, with a step
 * between pieces. Piece k of side s reports its joint line as side id `pieceSide(s, k)`.
 * 'fingerHoles' pieces are not supported.
 */
export type CompoundSide = { pieces: [WallEdge, number][] };

/**
 * A hand-drawn side (e.g. a hinge profile): `draw` must leave the turtle `end - start` further out
 * than it started, `length` along the start heading (part on the left, as for any Edge).
 * `start`/`end` are its start and end widths (boxes.py startwidth/endwidth). It records no joint
 * line; generators add any lines they need.
 */
export type CustomSide = { draw: (t: Turtle, length: number) => void; start: number; end: number };

export type WallSide = WallEdge | CompoundSide | CustomSide;

/** Sides of a panel: bottom, right, top, left (CCW). */
export type WallEdges = [WallSide, WallSide, WallSide, WallSide];

/** Plain edge types for the four sides (trapezoidWall). */
export type SimpleWallEdges = [WallEdge, WallEdge, WallEdge, WallEdge];

/** Side id of piece `k` of compound side `side` (0..3): 10 * (side + 1) + k, e.g. 20 = side 1 piece 0. */
export const pieceSide = (side: number, k: number): number => 10 * (side + 1) + k;

export type WallOpts = {
  /**
   * Brim outside the slots of 'fingerHoles' sides (boxes.py FingerJointSettings edge_width).
   * Default one thickness. When given, those sides' joint lines are declared against their slots
   * (PartEdge.holes) instead of the outline, so any brim passes the joint-line check.
   */
  brim?: number;
  /**
   * Corner turn per side (degrees) for 'angledFinger' / 'angledFingerHole' sides, overriding
   * `ctx.angle` for that side (e.g. a profile whose corners turn by different angles).
   */
  angles?: (number | undefined)[];
};

/**
 * How far an edge's drawn line sits outside the inner rectangle (boxes.py `startwidth`): notched
 * edges are drawn on the mating panel's outer face, one thickness out; fingers start on the inner
 * line and protrude one thickness; plain edges lie on the inner line; outset edges one thickness
 * out; finger-hole sides add the brim outside the slot.
 */
function startWidth(type: WallEdge, ctx: EdgeCtx, brim = ctx.thickness): number {
  if (type === 'fingerHoles') return ctx.thickness + brim;
  if (type === 'angledFinger') return angledFingerWidths(ctx.angle ?? 90, ctx.thickness).base;
  if (type === 'angledFingerHole') return angledFingerWidths(ctx.angle ?? 90, ctx.thickness).tip;
  return type === 'fingerHole' || type === 'outset' ? ctx.thickness : 0;
}

/**
 * Depth of the joint line below the inner rectangle: the shared outer corner line for finger
 * joints, the drawn line for outset edges, the inner line for other plain edges.
 */
function jointDepth(type: WallEdge, ctx: EdgeCtx): number {
  if (type === 'angledFinger' || type === 'angledFingerHole') return angledFingerWidths(ctx.angle ?? 90, ctx.thickness).tip;
  return type === 'finger' || type === 'fingerHole' || type === 'fingerHoles' || type === 'outset' ? ctx.thickness : 0;
}

/** Edge type recorded in the part's joint metadata. */
const reported = (type: WallEdge): EdgeType => (type === 'fingerHoles' ? 'fingerHole' : type === 'outset' ? 'flat' : type);

/** Drawn outline edge (finger-hole sides are straight; their slots are holes). */
const drawn = (type: WallEdge): EdgeType => (type === 'fingerHoles' || type === 'outset' ? 'flat' : type);

/** A joint line; `holes` (indices into the panel's holes) marks an interior joint, see PartEdge.holes; `face`, see PartEdge.face. */
export type WallLine = { side: number; type: EdgeType; from: Vec2; to: Vec2; holes?: number[]; face?: 'inner' };

export type Wall = {
  /** Nominal (pre-kerf) outline, closed and CCW. */
  outline: Path;
  /** Nominal slots (closed, CCW), from 'fingerHoles' sides. */
  holes: Path[];
  /** Joint lines in panel-local 2D, `side` 0..3 = bottom, right, top, left, or a pieceSide id. */
  lines: WallLine[];
};

/** Axis-aligned CCW rectangle [x0, x1] x [y0, y1]. */
export function rect(x0: number, y0: number, x1: number, y1: number): Path {
  return { start: { x: x0, y: y0 }, closed: true,
    segs: [{ t: 'L', to: { x: x1, y: y0 } }, { t: 'L', to: { x: x1, y: y1 } }, { t: 'L', to: { x: x0, y: y1 } }, { t: 'L', to: { x: x0, y: y0 } }] };
}

/**
 * Slots for a 'fingerHoles' side: boxes.py FingerHoles via `fingerHolesFor` (one slot per finger
 * of the mating 'finger' edge of the same length, (finger + play) x (thickness + play), centred on
 * the mating panel's mid-plane, i.e. half a thickness outside the side). `side` 0..3 of a w x h
 * inner rectangle, each running CCW.
 */
function sideSlots(side: number, len: number, w: number, h: number, ctx: EdgeCtx): Path[] {
  const t = ctx.thickness;
  const place: Mat3[] = [
    mat3Translate(0, -t / 2),
    mat3Multiply(mat3Translate(w + t / 2, 0), mat3Rotate(90)),
    mat3Multiply(mat3Translate(w, h + t / 2), mat3Rotate(180)),
    mat3Multiply(mat3Translate(-t / 2, h), mat3Rotate(270)),
  ];
  return fingerHolesFor(len, ctx).map((s) => transform(s, place[side]!));
}

const isCompound = (s: WallSide): s is CompoundSide => typeof s === 'object' && 'pieces' in s;
const isCustom = (s: WallSide): s is CustomSide => typeof s === 'object' && 'draw' in s;

/** boxes.py `step`: move `d` outwards (right of travel) keeping the heading; negative moves in. */
function step(t: Turtle, d: number): void {
  if (d > 1e-9) { t.turn(-90); t.forward(d); t.turn(90); } else if (d < -1e-9) { t.turn(90); t.forward(-d); t.turn(-90); }
}

/** Line `a`..`a + l` along side `side` of a w x h inner rectangle, pushed out by `d`, running CCW. */
export function sideLine(side: number, a: number, l: number, d: number, w: number, h: number): { from: Vec2; to: Vec2 } {
  switch (side) {
    case 0: return { from: { x: a, y: -d }, to: { x: a + l, y: -d } };
    case 1: return { from: { x: w + d, y: a }, to: { x: w + d, y: a + l } };
    case 2: return { from: { x: w - a, y: h + d }, to: { x: w - a - l, y: h + d } };
    default: return { from: { x: -d, y: h - a }, to: { x: -d, y: h - a - l } };
  }
}

/**
 * Port of boxes.py `rectangularWall`: a panel whose INNER rectangle is [0, w] x [0, h] in local
 * 2D, with each side drawn by its edge type and pushed outwards by that edge's start width; the
 * corners are filled with straight runs of the neighbours' end/start widths. The joint line of each
 * side is that side of the inner rectangle pushed outwards by the joint depth, i.e. the outer
 * corner line of the box edge, running CCW over the side's inner length (compound sides: one line
 * per piece; custom sides: none). Mated sides therefore run in opposite world directions; that is
 * fine for finger edges because their layout is symmetric, but an asymmetric edge type would need
 * its partner drawn reversed.
 */
export function rectangularWall(w: number, h: number, types: WallEdges, ctx0: EdgeCtx, opts: WallOpts = {}): Wall {
  const brim = opts.brim ?? ctx0.thickness;
  const ctxs = types.map((_, i) => (opts.angles?.[i] !== undefined ? { ...ctx0, angle: opts.angles[i] } : ctx0));
  const swOf = (e: WallEdge, i: number): number => startWidth(e, ctxs[i]!, brim);
  const first = (s: WallSide, i: number): number => (isCustom(s) ? s.start : isCompound(s) ? swOf(s.pieces[0]![0], i) : swOf(s, i));
  const last = (s: WallSide, i: number): number => (isCustom(s) ? s.end : isCompound(s) ? swOf(s.pieces[s.pieces.length - 1]![0], i) : swOf(s, i));
  const start = types.map(first);
  const end = types.map(last);
  const lengths = [w, h, w, h];
  const t = new Turtle({ x: -end[3]!, y: -start[0]! });
  for (let i = 0; i < 4; i++) {
    const s = types[i]!;
    const ctx = ctxs[i]!;
    const sw = (e: WallEdge): number => swOf(e, i);
    t.forward(end[(i + 3) % 4]!);
    if (isCustom(s)) s.draw(t, lengths[i]!);
    else if (isCompound(s)) {
      const total = s.pieces.reduce((a, [, l]) => a + l, 0);
      if (Math.abs(total - lengths[i]!) > 1e-6) throw new Error(`rectangularWall: compound side ${i} pieces sum to ${total}, not ${lengths[i]}`);
      let prev = first(s, i);
      for (const [e, l] of s.pieces) {
        if (e === 'fingerHoles') throw new Error('rectangularWall: fingerHoles pieces are not supported in compound sides');
        step(t, sw(e) - prev);
        edgeFor(drawn(e))(t, l, ctx);
        prev = sw(e);
      }
    } else edgeFor(drawn(s))(t, lengths[i]!, ctx);
    t.forward(start[(i + 1) % 4]!);
    t.turn(90);
  }
  const negative = [...start, ...end].some((v) => v < -1e-12);
  const outline = negative ? removeBacktracks(t.toPath(true)) : t.toPath(true);
  const holes: Path[] = [];
  const lines: WallLine[] = [];
  types.forEach((s, side) => {
    const ctx = ctxs[side]!;
    if (isCustom(s)) return;
    if (isCompound(s)) {
      let a = 0;
      s.pieces.forEach(([e, l], k) => {
        lines.push({ side: pieceSide(side, k), type: reported(e), ...sideLine(side, a, l, jointDepth(e, ctx), w, h) });
        a += l;
      });
      return;
    }
    // A neighbour drawn inside the inner rectangle (negative width: an angled finger side) cuts the
    // panel back there, so the joint line stops where the material does.
    const a0 = Math.max(0, -end[(side + 3) % 4]!);
    const a1 = Math.max(0, -start[(side + 1) % 4]!);
    const line: WallLine = { side, type: reported(s), ...sideLine(side, a0, lengths[side]! - a0 - a1, jointDepth(s, ctx), w, h) };
    if (s === 'fingerHoles') {
      const slots = sideSlots(side, lengths[side]!, w, h, ctx);
      if (opts.brim !== undefined) line.holes = slots.map((_, k) => holes.length + k);
      holes.push(...slots);
    }
    lines.push(line);
  });
  return { outline, holes, lines };
}

/**
 * Removes the back-and-forth runs a negative start width leaves (an angled finger side is drawn
 * inside the inner rectangle, boxes.py lets the turtle move backwards there): every vertex where
 * the outline reverses onto itself, and duplicate vertices, until none is left. Line-only paths.
 */
export function removeBacktracks(p: Path): Path {
  if (p.segs.some((sg) => sg.t !== 'L')) throw new Error('removeBacktracks: outline with arcs');
  const v: Vec2[] = [p.start, ...p.segs.map((sg) => sg.to)].slice(0, -1);
  const eps = 1e-9;
  for (let changed = true; changed && v.length > 2;) {
    changed = false;
    for (let i = 0; i < v.length && v.length > 2; i++) {
      const a = v[(i + v.length - 1) % v.length]!;
      const b = v[i]!;
      const c = v[(i + 1) % v.length]!;
      const d1 = { x: b.x - a.x, y: b.y - a.y };
      const d2 = { x: c.x - b.x, y: c.y - b.y };
      const l1 = Math.hypot(d1.x, d1.y);
      const l2 = Math.hypot(d2.x, d2.y);
      const back = l1 > eps && l2 > eps && Math.abs(d1.x * d2.y - d1.y * d2.x) <= 1e-9 * l1 * l2 && d1.x * d2.x + d1.y * d2.y < 0;
      if (l1 <= eps || back) {
        v.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return { start: { ...v[0]! }, closed: true, segs: [...v.slice(1), v[0]!].map((q) => ({ t: 'L', to: { ...q } })) };
}

/**
 * A flat plate on a convex polygon (boxes.py `polygonWall` / `regularPolygonWall` with one edge
 * type per side): `inner` are the inner polygon's vertices, CCW; side k runs from inner[k] to
 * inner[k+1] and is drawn by `types[k]` pushed outwards by its start width (as rectangularWall);
 * neighbouring sides' offset lines meet at the plate's corners. Joint lines: each side pushed out
 * by its joint depth over the inner side's length less `trim[k]` = [at start, at end] (where the
 * mating wall is cut back at an angled corner), side index k. Supported types: 'flat',
 * 'finger', 'fingerHole' (notched; the plate then reaches the walls' outer faces).
 */
export function polygonPlate(inner: Vec2[], types: EdgeType[], ctx: EdgeCtx, holes: Path[] = [], trim: [number, number][] = []): Wall {
  const n = inner.length;
  if (types.length !== n) throw new Error('polygonPlate: one edge type per side');
  if (types.some((e) => e !== 'flat' && e !== 'finger' && e !== 'fingerHole')) throw new Error('polygonPlate: unsupported side type');
  const dir = inner.map((a, k) => {
    const b = inner[(k + 1) % n]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l, l };
  });
  const turn = (k: number): number => { // turn at the end of side k (degrees, left positive)
    const a = dir[k]!;
    const b = dir[(k + 1) % n]!;
    return (Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * 180) / Math.PI;
  };
  for (let k = 0; k < n; k++) if (!(turn(k) > 1e-6 && turn(k) < 180 - 1e-6)) throw new Error('polygonPlate: polygon must be convex and CCW');
  const d = types.map((e) => startWidth(e, ctx));
  // Extension of side k past its end (towards corner k+1) and of side k+1 before its start.
  const ext = (k: number): [number, number] => {
    const a = (turn(k) * Math.PI) / 180;
    const d0 = d[k]!;
    const d1 = d[(k + 1) % n]!;
    return [(d1 - d0 * Math.cos(a)) / Math.sin(a), (d0 - d1 * Math.cos(a)) / Math.sin(a)];
  };
  const before = (k: number): number => ext((k + n - 1) % n)[1];
  const r0 = dir[0]!;
  const start = { x: inner[0]!.x + d[0]! * r0.y - before(0) * r0.x, y: inner[0]!.y - d[0]! * r0.x - before(0) * r0.y };
  const t = new Turtle(start, (Math.atan2(r0.y, r0.x) * 180) / Math.PI);
  for (let k = 0; k < n; k++) {
    t.forward(before(k));
    edgeFor(types[k]!)(t, dir[k]!.l, ctx);
    t.forward(ext(k)[0]);
    t.turn(turn(k));
  }
  const lines: WallLine[] = types.map((e, k) => {
    const a = inner[k]!;
    const r = dir[k]!;
    const j = jointDepth(e, ctx);
    const [c0, c1] = trim[k] ?? [0, 0];
    return { side: k, type: reported(e), from: { x: a.x + c0 * r.x + j * r.y, y: a.y + c0 * r.y - j * r.x },
      to: { x: a.x + (r.l - c1) * r.x + j * r.y, y: a.y + (r.l - c1) * r.y - j * r.x } };
  });
  return { outline: t.toPath(true), holes, lines };
}

/**
 * Closed CCW polygon: the convex CCW polygon `pts` with every side moved inwards by `d` (mitred
 * corners), e.g. the opening of a rim plate.
 */
export function insetPolygon(pts: Vec2[], d: number): Path {
  const n = pts.length;
  const lines = pts.map((a, k) => {
    const b = pts[(k + 1) % n]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / l;
    const ny = (b.x - a.x) / l;
    return { p: { x: a.x + d * nx, y: a.y + d * ny }, r: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } };
  });
  const v = lines.map((L0, k) => {
    const L1 = lines[(k + n - 1) % n]!;
    // intersection of L1 (previous side) and L0
    const den = L1.r.x * L0.r.y - L1.r.y * L0.r.x;
    const s = ((L0.p.x - L1.p.x) * L0.r.y - (L0.p.y - L1.p.y) * L0.r.x) / den;
    return { x: L1.p.x + s * L1.r.x, y: L1.p.y + s * L1.r.y };
  });
  return { start: v[0]!, closed: true, segs: [...v.slice(1), v[0]!].map((q) => ({ t: 'L', to: { ...q } })) };
}

/**
 * Port of boxes.py `trapezoidWall`: inner shape (0,0), (w,0), (w,h1), (0,h0) with a sloped top.
 * Sides 0, 1, 3 behave as in `rectangularWall` (side 3 is h0 tall, side 1 is h1 tall); the top
 * (side 2) must be 'flat' and runs straight from (w, h1) to (0, h0). Notched sides' corner columns
 * end level with their own height (boxes.py edgeCorner with a plain top).
 */
export function trapezoidWall(w: number, h0: number, h1: number, types: SimpleWallEdges, ctx: EdgeCtx): Wall {
  if (types[2] !== 'flat' || types.includes('fingerHoles') || types.includes('outset'))
    throw new Error('trapezoidWall: the sloped top must be flat and finger-hole/outset sides are not supported');
  const sw = types.map((e) => startWidth(e, ctx));
  const t = new Turtle({ x: -sw[3]!, y: -sw[0]! });
  t.forward(sw[3]!);
  edgeFor(drawn(types[0]!))(t, w, ctx);
  t.forward(sw[1]!);
  t.turn(90);
  t.forward(sw[0]!);
  edgeFor(drawn(types[1]!))(t, h1, ctx);
  t.turn(90);
  t.forward(sw[1]!);
  const a = (Math.atan2(h0 - h1, -w) * 180) / Math.PI; // heading of the slope; 180 when level
  t.turn(a - 180);
  t.forward(Math.hypot(w, h0 - h1));
  t.turn(180 - a);
  t.forward(sw[3]!);
  t.turn(90);
  edgeFor(drawn(types[3]!))(t, h0, ctx);
  t.forward(sw[0]!);
  const d = types.map((e) => jointDepth(e, ctx));
  const lines = [
    { from: { x: 0, y: -d[0]! }, to: { x: w, y: -d[0]! } },
    { from: { x: w + d[1]!, y: 0 }, to: { x: w + d[1]!, y: h1 } },
    { from: { x: w, y: h1 }, to: { x: 0, y: h0 } },
    { from: { x: -d[3]!, y: h0 }, to: { x: -d[3]!, y: 0 } },
  ].map((l, side) => ({ side, type: reported(types[side]!), ...l }));
  return { outline: t.toPath(true), holes: [], lines };
}

/**
 * A wall with a stepped top (boxes.py DrillStand walls): inner shape [0, w] wide, segment k of the
 * top (from cuts[k - 1] to cuts[k], cuts strictly increasing inside (0, w)) at height heights[k];
 * the left side is heights[0] tall, the right side heights[last]. Sides 0 (bottom, a plain edge
 * type or a CustomSide with equal start and end widths), 1 (right) and 3 (left) behave as in
 * `rectangularWall` (custom bottoms record no joint line); the top is plain and records none.
 */
export function steppedWall(w: number, cuts: number[], heights: number[], types: [WallEdge | CustomSide, WallEdge, WallEdge], ctx: EdgeCtx): Wall {
  if (heights.length !== cuts.length + 1) throw new Error('steppedWall: one height per segment');
  const [b, r, l] = types;
  if (r === 'fingerHoles' || l === 'fingerHoles' || b === 'fingerHoles') throw new Error('steppedWall: finger-hole sides are not supported');
  const sw0 = isCustom(b) ? b.start : startWidth(b, ctx);
  if (isCustom(b) && Math.abs(b.start - b.end) > 1e-9) throw new Error('steppedWall: custom bottom needs equal start and end widths');
  const sw1 = startWidth(r, ctx);
  const sw3 = startWidth(l, ctx);
  const h0 = heights[0]!;
  const h1 = heights[heights.length - 1]!;
  const t = new Turtle({ x: -sw3, y: -sw0 });
  t.forward(sw3);
  if (isCustom(b)) b.draw(t, w);
  else edgeFor(drawn(b))(t, w, ctx);
  t.forward(sw1);
  t.turn(90);
  t.forward(sw0);
  edgeFor(drawn(r))(t, h1, ctx);
  t.turn(90);
  t.forward(sw1);
  // Heading -x along the top from (w, h1): each step is a run then a vertical drop or rise.
  let x = w;
  let y = h1;
  for (let k = heights.length - 1; k >= 1; k--) {
    t.forward(x - cuts[k - 1]!);
    x = cuts[k - 1]!;
    const dy = heights[k - 1]! - y;
    if (Math.abs(dy) > 1e-9) { t.turn(dy > 0 ? -90 : 90); t.forward(Math.abs(dy)); t.turn(dy > 0 ? 90 : -90); }
    y = heights[k - 1]!;
  }
  t.forward(x + sw3);
  t.turn(90);
  edgeFor(drawn(l))(t, h0, ctx);
  t.forward(sw0);
  const lines: WallLine[] = [];
  if (!isCustom(b)) lines.push({ side: 0, type: reported(b), from: { x: 0, y: -jointDepth(b, ctx) }, to: { x: w, y: -jointDepth(b, ctx) } });
  const d1 = jointDepth(r, ctx);
  const d3 = jointDepth(l, ctx);
  lines.push({ side: 1, type: reported(r), from: { x: w + d1, y: 0 }, to: { x: w + d1, y: h1 } });
  lines.push({ side: 3, type: reported(l), from: { x: -d3, y: h0 }, to: { x: -d3, y: 0 } });
  return { outline: t.toPath(true), holes: [], lines };
}

// ---------------------------------------------------------------- params and parts

export const num = (p: Params, k: string): number => {
  const v = p[k];
  if (typeof v !== 'number') throw new ParamError(`${k} must be a number`, k);
  return v;
};

/** Throws ParamError naming `key` unless the inner size `v` is at least 3 * thickness (finger joints need it). */
export function requireJointLength(key: string, v: number, t: number, what = `inner ${key}`): void {
  if (v < 3 * t)
    throw new ParamError(`${key} too small: ${what} is ${v.toFixed(2)} mm, needs at least 3 * thickness = ${(3 * t).toFixed(2)} mm`, key);
}

export const at = (origin: Vec3, u: Vec3, v: Vec3): Placement => ({ origin, x: u, y: v });

/** One panel to build: its geometry, world placement and the mate of each joint side. */
export type PanelSpec = {
  id: string;
  name: string;
  outline: Path;
  holes: Path[];
  lines: WallLine[];
  placement: Placement;
  /** Mating `[partId, side]` per side index; undefined for plain (flat) sides. */
  mates: ([string, number] | undefined)[];
  /** Bend of a bent part (living hinge), see `Part.bend`. */
  bend?: Bend;
};

/** Spec from a Wall. */
export const panel = (id: string, name: string, wall: Wall, placement: Placement, mates: PanelSpec['mates']): PanelSpec =>
  ({ id, name, outline: wall.outline, holes: wall.holes, lines: wall.lines, placement, mates });

/** Turns specs into kerf-compensated parts with mated joint metadata. */
export function finishPanels(panels: PanelSpec[], thickness: number, kerf: number): Part[] {
  return panels.map((s) => {
    const edges: PartEdge[] = s.lines.map((l) => {
      const m = s.mates[l.side];
      return m ? { ...l, mate: { part: m[0], side: m[1] } } : l;
    });
    return finishWithKerf({ id: s.id, name: s.name, outline: s.outline, holes: s.holes, engrave: [],
      placement: s.placement, ...(s.bend ? { bend: s.bend } : {}), thickness, edges }, kerf);
  });
}

// ---------------------------------------------------------------- drawing helpers

/**
 * boxes.py `polyline`: alternating lengths and turns, starting with a length. A turn is degrees
 * (positive = left) or `[degrees, radius]` for an arc. `polyline(t, [...items].reverse())` draws
 * the mirror image (the trick boxes.py uses for edges that exist in a start and an end variant).
 */
export type PolyItem = number | [number, number];
export function polyline(t: Turtle, items: PolyItem[]): void {
  items.forEach((it, i) => {
    if (i % 2 === 0) {
      if (typeof it !== 'number') throw new Error('polyline: lengths must be numbers');
      t.forward(it);
      return;
    }
    const [a, r] = typeof it === 'number' ? [it, 0] : it;
    if (r > 0) t.arc(r, a);
    else t.turn(a);
  });
}

/** Closed CCW circle of radius r about (cx, cy), as two half arcs. */
export function circle(cx: number, cy: number, r: number): Path {
  const c = { x: cx, y: cy };
  return { start: { x: cx + r, y: cy }, closed: true,
    segs: [{ t: 'A', to: { x: cx - r, y: cy }, c, ccw: true }, { t: 'A', to: { x: cx + r, y: cy }, c, ccw: true }] };
}

/** Closed CCW w x h rectangle centred on (cx, cy) with corner radius r (clamped to the half sides, as boxes.py rectangularHole). */
export function roundedRect(cx: number, cy: number, w: number, h: number, r = 0): Path {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 1e-9) return rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  const t = new Turtle({ x: cx - w / 2 + rr, y: cy - h / 2 });
  for (const l of [w, h, w, h]) {
    t.forward(l - 2 * rr);
    t.arc(rr, 90);
  }
  return t.toPath(true);
}
