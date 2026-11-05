/**
 * TypeTray: an open tray divided into a grid of compartments by continuous inner walls that cross
 * each other in half-height slots (egg-crate), ported from boxes.py (florianfesti/boxes,
 * boxes/generators/typetray.py). `gridTray` builds the body and is shared with traylayout and
 * compartmentbox.
 *
 * Panels (edges bottom, right, top, left; b = bottom edge: 'F' notched with a floor, else flat):
 *    floor        X * Y    'f f f f'   slot rows for every inner wall piece (interior joints)
 *    front, back  X * h    'b F e F'   own the corner columns; slot rows for the inner y walls
 *    left, right  Y * h    'b f e f'   slot rows for the inner x walls
 *    inner x i    X * hi   bottom: a finger piece per column (flat gaps at the crossings), sides
 *                          'f' into the side walls, top: slotted half way down at each crossing
 *    inner y j    Y * hi   bottom: a finger piece per row, slotted half way up at each crossing,
 *                          sides 'f' into front and back, top plain
 * X = sum(sx) + (cols - 1) t, Y = sum(sy) + (rows - 1) t. The crossing inner walls are declared as
 * crossSlot mates along their common line where the two slots meet.
 *
 * World frame: x across (columns), y from the front (y = 0) to the back, z up (floor underside at
 * z = 0). Outer size X + 2t, Y + 2t, h (+ t with a floor).
 *
 * Deliberate differences from boxes.py (docs/differences.md): equal compartments (x, y per
 * compartment and cols x rows) instead of free sx/sy lists (traylayout has the lists); the inner
 * walls are at most as high as the outer walls (hi is a fraction <= 1); the grip hole is centred
 * over the middle compartment and sized relative to it; top edge always open (no lids, no
 * back_height/radius, no handle, no labels); `step` raises each row above the one in front
 * (boxes.py DrillStand, one step size instead of per-row heights); the 'A' finger-grip cut-outs are `fingerhole_depth`
 * of the inner wall height deep (boxes.py relative_depth).
 */
import type { EdgeCtx } from '../core/edges/types';
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import {
  autoMate, crossing, equal, requireMaxSize, runLines, runsFor, slotInto, slotRanges, slottedSide, span, TRAY_CATEGORY, wallOffsets,
  type Grip, type PieceKind,
} from './trays';
import {
  at, finishPanels, num, panel, rectangularWall, requireJointLength, roundedRect, steppedWall, type PanelSpec, type Wall, type WallEdges, type WallSide,
} from './walls';

export const FINGERHOLES = ['none', 'inside-only', 'front', 'back', 'front-and-back'] as const;
export type FingerHoles = (typeof FINGERHOLES)[number];

/** Outer wall override: its inner height and edges (bottom, right, top, left). */
export type OuterWall = { h: number; edges: WallEdges };

export type TrayBody = {
  sx: number[];
  sy: number[];
  /** Inner height of the outer walls above the floor. */
  h: number;
  /** Height of the inner walls (<= h). */
  hi: number;
  floor: boolean;
  fingerholes: FingerHoles;
  /** Depth of the 'A' finger-grip cut-outs (mm). */
  gripDepth: number;
  /** Rounded grip hole in the front wall over the middle compartment (boxes.py gripwidth x gripheight); width 0 for none. */
  gripHole?: { w: number; h: number };
  /** Outer wall overrides (compartmentbox); the bottom edge is always set by `floor`. */
  outer?: Partial<Record<'front' | 'back' | 'left' | 'right', OuterWall>>;
  /**
   * Height step per row (boxes.py DrillStand): row r (from the front) is h + r * rowStep tall
   * outside and hi * (h + r * rowStep) / h inside; the side and inner y walls get stepped tops, the
   * inner ones stepping on the front face of each inner x wall (which is as tall as the row behind
   * it), the outer ones one thickness further forward. 0 or absent: level walls.
   */
  rowStep?: number;
};

export type TrayBuilt = {
  specs: PanelSpec[];
  X: number;
  Y: number;
  /** World z of the floor's top face (0 without a floor). */
  zf: number;
  xWalls: PanelSpec[];
  yWalls: PanelSpec[];
  front: PanelSpec;
  back: PanelSpec;
  left: PanelSpec;
  right: PanelSpec;
};

/** Builds the tray body (see the file comment). Crossings are mated; call autoMate on the final spec list for the rest. */
export function gridTray(b: TrayBody, ctx: EdgeCtx): TrayBuilt {
  const t = ctx.thickness;
  const { sx, sy, h, hi } = b;
  const X = span(sx, t);
  const Y = span(sy, t);
  const zf = b.floor ? t : 0;
  const bot: WallSide = b.floor ? 'fingerHole' : 'flat';
  const xw = wallOffsets(sx, t).map((o) => t + o); // world x of each inner y wall's low face
  const yw = wallOffsets(sy, t).map((o) => t + o); // world y of each inner x wall's low face
  const grip: Grip = { depth: b.gripDepth };
  const fh = b.fingerholes;
  const frontGrip = fh === 'front' || fh === 'front-and-back';
  const backGrip = fh === 'back' || fh === 'front-and-back';
  const innerGrip = fh !== 'none';

  // Top side of a wall running along x with flat gaps (or cut-outs) at the inner y walls.
  const xTop = (w: number, u: (x: number) => number, kind: PieceKind): WallSide => {
    if (kind !== 'grip') return 'flat';
    return slottedSide(runsFor(2, w, 0, xw.map((x) => [u(x), u(x + t)])), 'grip', 0, ctx, grip);
  };
  const wall = (key: 'front' | 'back' | 'left' | 'right', def: OuterWall): OuterWall => {
    const o = b.outer?.[key] ?? def;
    return { h: o.h, edges: [bot, o.edges[1], o.edges[2], o.edges[3]] };
  };
  const fw = wall('front', { h, edges: [bot, 'fingerHole', xTop(X, (x) => t + X - x, frontGrip ? 'grip' : 'flat'), 'fingerHole'] });
  const bw = wall('back', { h, edges: [bot, 'fingerHole', xTop(X, (x) => x - t, backGrip ? 'grip' : 'flat'), 'fingerHole'] });
  const lw = wall('left', { h, edges: [bot, 'finger', 'flat', 'finger'] });
  const rw = wall('right', { h, edges: [bot, 'finger', 'flat', 'finger'] });

  const front = panel('front', 'Front', rectangularWall(X, fw.h, fw.edges, ctx), at([t + X, 0, zf], [-1, 0, 0], [0, 0, 1]), []);
  const step = b.rowStep ?? 0;
  const stepped = step > 0 && sy.length > 1;
  const yCuts = wallOffsets(sy, t); // local u of each step on walls running front to back
  const rowH = (base: number): number[] => sy.map((_, r) => base * (1 + (r * step) / h));
  const sideWall = (o: OuterWall, rev: boolean): Wall => {
    if (!stepped) return rectangularWall(Y, o.h, o.edges, ctx);
    const hs = rowH(o.h);
    const [e0, e1, , e3] = o.edges;
    if (typeof e0 === 'object' || typeof e1 === 'object' || typeof e3 === 'object') throw new Error('gridTray: stepped walls need plain side edges');
    // The outer walls step one thickness in front of each inner x wall, leaving a brim round its slots.
    const cuts = yCuts.map((c) => c - t);
    return rev ? steppedWall(Y, [...cuts].reverse().map((c) => Y - c), [...hs].reverse(), [e0, e1, e3], ctx) : steppedWall(Y, cuts, hs, [e0, e1, e3], ctx);
  };
  if (stepped) bw.h = rowH(bw.h)[sy.length - 1]!;
  const back = panel('back', 'Back', rectangularWall(X, bw.h, bw.edges, ctx), at([t, Y + 2 * t, zf], [1, 0, 0], [0, 0, 1]), []);
  const left = panel('left', 'Left side', sideWall(lw, false), at([0, t, zf], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right side', sideWall(rw, true), at([X + 2 * t, t + Y, zf], [0, -1, 0], [0, 0, 1]), []);
  if (b.gripHole && b.gripHole.w > 0) {
    const g = b.gripHole;
    front.holes = [...front.holes, roundedRect(gripCentre(sx, t), 1.5 * g.h, g.w, g.h, Math.min(g.w, g.h) / 2)];
  }
  const specs: PanelSpec[] = [front, back, left, right];
  const floor = b.floor
    ? panel('floor', 'Floor', rectangularWall(X, Y, ['finger', 'finger', 'finger', 'finger'], ctx), at([t, t, 0], [1, 0, 0], [0, 1, 0]), [])
    : undefined;
  if (floor) specs.push(floor);

  const piece: PieceKind = b.floor ? 'finger' : 'flat';
  // Inner x walls: u = x - t, z = 0 face at y = yw + t (normal -y). Slotted from the top.
  const his = stepped ? rowH(hi) : sy.map(() => hi); // inner wall height per row
  // Height of crossing i (x wall i meets the y walls): half the lower row's inner height, so the
  // y walls' slots stay below their step.
  const hc = (i: number): number => his[i]! / 2;
  const xWalls = yw.map((y0, i) => {
    const hx = his[i + 1]!; // the wall belongs to the (taller) row behind it
    const gaps = xw.map((x) => [x - t, x - t + t] as [number, number]);
    const bottom = runsFor(0, X, hx, gaps);
    const top = runsFor(2, X, hx, slotRanges(gaps, ctx.play));
    const w = rectangularWall(X, hx, [slottedSide(bottom, piece, 0, ctx), 'finger', slottedSide(top, innerGrip ? 'grip' : 'flat', hx - hc(i), ctx, grip), 'finger'], ctx);
    const s = panel(`innerx${i + 1}`, 'Inner wall (x)', w, at([t, y0 + t, zf], [1, 0, 0], [0, 0, 1]), []);
    if (b.floor) s.lines = [...s.lines, ...runLines(0, X, hx, bottom, t)];
    return s;
  });
  // Inner y walls: u = y - t, z = 0 face at x = xw (normal +x). Slotted from the bottom.
  const yWalls = xw.map((x0, j) => {
    const gaps = yw.map((y) => [y - t, y] as [number, number]);
    const bottom = runsFor(0, Y, hi, slotRanges(gaps, ctx.play));
    const w = stepped
      ? steppedWall(Y, yCuts, his, [slottedSide(bottom, piece, yw.map((_, i) => hc(i)), ctx), 'finger', 'finger'], ctx)
      : rectangularWall(Y, hi, [slottedSide(bottom, piece, hi / 2, ctx), 'finger', 'flat', 'finger'], ctx);
    const s = panel(`innery${j + 1}`, 'Inner wall (y)', w, at([x0, t, zf], [0, 1, 0], [0, 0, 1]), []);
    if (b.floor) s.lines = [...s.lines, ...runLines(0, Y, hi, bottom, t)];
    return s;
  });

  for (const s of xWalls) {
    slotInto(right, s, [1], ctx);
    slotInto(left, s, [3], ctx);
  }
  for (const s of yWalls) {
    slotInto(back, s, [1], ctx);
    slotInto(front, s, [3], ctx);
  }
  if (floor) for (const s of [...xWalls, ...yWalls]) slotInto(floor, s, s.lines.filter((l) => l.side >= 100 && l.side < 200).map((l) => l.side), ctx);
  // Crossings: the x wall's top slot meets the y wall's bottom slot at half height.
  xWalls.forEach((xs, i) => yWalls.forEach((ys, j) => {
    const zc = zf + hc(i);
    const c = Math.min(t, hc(i) / 2);
    const p = (z: number): Vec3 => [xw[j]!, yw[i]! + t, z];
    crossing(xs, ys, p(zc - c), p(zc + c));
  }));
  specs.push(...xWalls, ...yWalls);
  return { specs, X, Y, zf, xWalls, yWalls, front, back, left, right };
}

/**
 * Checks shared by the grid trays; ParamErrors name the param keys given. Compartments need room
 * for a finger joint (3t) when the inner walls are jointed into a floor, else two thicknesses.
 */
export function checkGrid(sx: number[], sy: number[], t: number, keys: { x: string; y: string }, floor = true): void {
  const min = (key: string, v: number, what: string): void => {
    if (floor) requireJointLength(key, v, t, what);
    else if (!(v >= 2 * t)) throw new ParamError(`${key} too small: ${what} is ${v.toFixed(2)} mm, needs at least 2 * thickness = ${(2 * t).toFixed(2)} mm`, key);
  };
  for (const v of sx) min(keys.x, v, 'compartment width');
  for (const v of sy) min(keys.y, v, 'compartment depth');
  requireJointLength(keys.x, span(sx, t), t, 'inner width');
  requireJointLength(keys.y, span(sy, t), t, 'inner depth');
  requireMaxSize(keys.x, span(sx, t) + 2 * t);
  requireMaxSize(keys.y, span(sy, t) + 2 * t);
}

/** Cut-out and grip-hole checks for the front wall; ParamErrors name fingerhole_depth / gripheight. */
export function checkGrips(b: TrayBody, t: number): void {
  const g = b.gripHole;
  const frontGrip = b.fingerholes === 'front' || b.fingerholes === 'front-and-back';
  if (b.fingerholes !== 'none' && !(b.gripDepth <= b.hi - t))
    throw new ParamError(`fingerhole_depth too large: the cut-outs must leave one thickness of wall (${(b.hi - t).toFixed(1)} mm deep at most)`, 'fingerhole_depth');
  if (!g || !(g.w > 0)) return;
  const top = 2 * g.h; // the hole spans 1.5 h +- h / 2
  const limit = (frontGrip ? b.h - b.gripDepth : b.h) - t;
  if (!(top <= limit)) throw new ParamError(`gripheight too large: the grip hole reaches ${top.toFixed(1)} mm, the front wall allows ${limit.toFixed(1)} mm`, 'gripheight');
}

/**
 * Front-local centre (u) of the grip hole: over the middle compartment (boxes.py centres it on the
 * wall, which for an even number of columns is an inner wall's slot row).
 */
export function gripCentre(sx: number[], t: number): number {
  const X = span(sx, t);
  const k = Math.floor((sx.length - 1) / 2);
  const x0 = sx.slice(0, k).reduce((a, v) => a + v + t, 0); // inner x of the middle compartment's start
  return X - (x0 + sx[k]! / 2); // the front's local u runs along -x
}

// ---------------------------------------------------------------- the generator

const sizeParams: Schema = [
  { key: 'x', label: 'Compartment width', help: 'Width of each compartment (inner), or the overall outer width when "Inner dimensions" is off', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 400, default: 50, step: 1 },
  { key: 'y', label: 'Compartment depth', help: 'Depth of each compartment (inner), or the overall outer depth when "Inner dimensions" is off', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 400, default: 50, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the outer walls (inner, above the floor; or the overall height)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 300, default: 40, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y are one compartment and h the inner height. Off: they are the overall outer size',
    group: 'Size', kind: 'bool', default: true },
];

export const gridParams: Schema = [
  { key: 'cols', label: 'Columns', help: 'Number of compartments along x', unit: '', group: 'Compartments', kind: 'int', min: 1, max: 8, default: 3 },
  { key: 'rows', label: 'Rows', help: 'Number of compartments along y', unit: '', group: 'Compartments', kind: 'int', min: 1, max: 8, default: 2 },
];

export const trayOptions: Schema = [
  { key: 'hi', label: 'Inner wall height', help: 'Height of the inner walls as a fraction of the outer walls (1: as high)', unit: '',
    group: 'Compartments', kind: 'number', min: 0.2, max: 1, default: 1, step: 0.05 },
  { key: 'bottom', label: 'Floor', help: 'Finger-jointed floor; off for a bottomless grid', group: 'Compartments', kind: 'bool', default: true },
  { key: 'fingerholes', label: 'Finger cut-outs', help: 'Rounded cut-outs in the top edges to reach into the compartments: inner walls only, or also the front and/or back wall',
    group: 'Compartments', kind: 'enum', options: [...FINGERHOLES], default: 'none' },
  { key: 'fingerhole_depth', label: 'Cut-out depth', help: 'Depth of the finger cut-outs as a fraction of the inner wall height', unit: '',
    group: 'Compartments', kind: 'number', min: 0.1, max: 0.9, default: 0.5, step: 0.05 },
  { key: 'gripwidth', label: 'Grip hole width', help: 'Width of a grip hole in the front wall, as a fraction of the middle compartment width; 0 for none', unit: '',
    group: 'Compartments', kind: 'number', min: 0, max: 0.8, default: 0, step: 0.05 },
  { key: 'gripheight', label: 'Grip hole height', help: 'Height of the front grip hole as a fraction of the wall height (its centre is 1.5 times this above the floor)', unit: '',
    group: 'Compartments', kind: 'number', min: 0.05, max: 0.3, default: 0.2, step: 0.01 },
];

const stepParams: Schema = [
  { key: 'step', label: 'Height step per row', help: 'Each row of compartments, from the front, is this much taller than the one in front of it (a stepped drill stand); 0 for level walls',
    unit: 'mm', group: 'Compartments', kind: 'number', min: 0, max: 100, default: 0, step: 1 },
];

const schema: Schema = [...sizeParams, ...gridParams, ...trayOptions, ...commonParams, ...stepParams];

/** Height params shared by the grid trays: outer wall height h and inner hi (inner, above the floor). */
export function heights(p: Params, t: number): { h: number; hi: number; floor: boolean } {
  const floor = p.bottom !== false;
  const h = num(p, 'h') - (p.inside === false && floor ? t : 0);
  const f = num(p, 'hi');
  if (!(f > 0 && f <= 1)) throw new ParamError('hi must be a fraction in (0, 1]', 'hi');
  requireJointLength('h', h, t, 'wall height');
  const hi = f * h;
  requireJointLength('hi', hi, t, 'inner wall height');
  return { h, hi, floor };
}

function sizes(p: Params): { sx: number[]; sy: number[] } {
  const t = num(p, 'thickness');
  const nx = num(p, 'cols');
  const ny = num(p, 'rows');
  if (p.inside !== false) return { sx: equal(nx * num(p, 'x'), nx), sy: equal(ny * num(p, 'y'), ny) };
  return { sx: equal(num(p, 'x') - (nx + 1) * t, nx), sy: equal(num(p, 'y') - (ny + 1) * t, ny) };
}

/** TrayBody from the shared typetray/traylayout params. */
export function trayBody(p: Params, sx: number[], sy: number[], t: number): TrayBody {
  const { h, hi, floor } = heights(p, t);
  const gw = num(p, 'gripwidth') * sx[Math.floor((sx.length - 1) / 2)]!;
  const body: TrayBody = {
    sx, sy, h, hi, floor,
    fingerholes: p.fingerholes as FingerHoles,
    gripDepth: num(p, 'fingerhole_depth') * hi,
    ...(gw > 0 ? { gripHole: { w: gw, h: num(p, 'gripheight') * h } } : {}),
  };
  checkGrips(body, t);
  return body;
}

export function traySize(sx: number[], sy: number[], p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const { h, floor } = heights(p, t);
  return { x: span(sx, t) + 2 * t, y: span(sy, t) + 2 * t, z: h + (floor ? t : 0) };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { sx, sy } = sizes(p);
  checkGrid(sx, sy, t, { x: 'x', y: 'y' }, p.bottom !== false);
  const { specs } = gridTray({ ...trayBody(p, sx, sy, t), rowStep: num(p, 'step') }, ctx);
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const typeTray: Generator = {
  id: 'typetray',
  name: 'Type tray',
  category: TRAY_CATEGORY,
  description: 'Open tray divided into a grid of equal compartments by crossing inner walls, like a printer’s type case (TypeTray); with a height step per row it becomes a stepped drill stand (DrillStand, DrillBox).',
  schema,
  presets: {
    'Sorting tray': { x: 50, y: 50, h: 40, cols: 4, rows: 3, inside: true },
    'Screw tray, finger cut-outs': { x: 40, y: 60, h: 35, cols: 5, rows: 2, fingerholes: 'inside-only', inside: true },
    'Tool tray with grip': { x: 240, y: 160, h: 60, cols: 3, rows: 1, gripwidth: 0.6, gripheight: 0.25, inside: false },
    'DrillStand (stepped rows)': { x: 30, y: 30, h: 40, cols: 5, rows: 4, step: 20, inside: true },
  },
  build,
  expectedSize: (p) => {
    const s = sizes(p);
    const z = traySize(s.sx, s.sy, p);
    return { ...z, z: z.z + (s.sy.length - 1) * num(p, 'step') };
  },
};

