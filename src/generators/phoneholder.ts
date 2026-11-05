/**
 * PhoneHolder: a desk stand that holds a phone leaning back by `angle` from vertical on a front
 * plate, between two tabs of the side triangles, resting on two hooked supports that leave its
 * bottom free for a cable; ported from boxes.py (florianfesti/boxes,
 * boxes/generators/phoneholder.py).
 *
 * h = phone_height + bottom_margin is the front plate's length; the stand is
 * h sin(angle) deep and h cos(angle) high. In the side plane (q = depth from the front, z up) the
 * side triangles' hypotenuse is the front plate's back face, from the floor at the front to the top
 * of the back plate. Panels (w = phone_width):
 *    front plate  w * h    bottom: two notches t wide and bottom_margin deep for the supports and
 *                          a cable cut-out between them; sides: notched (F) for the triangles'
 *                          fingers, with fingers (f) over the tab length starting bottom_margin up,
 *                          which pass through slots in the triangles' tabs; slot rows for the supports
 *    back plate   w * (h cos)   bottom with a cable cut-out, sides notched for the triangles
 *    triangles    h sin x h cos 'e f hyp': fingers into the back plate; the hypotenuse is fingered
 *                          into the front plate except over the tab, which stands phone_depth out in
 *                          front of the plate (rounded) and has the slots
 *    supports (2) boxes.py's hook profile: on the floor under the plate, through the plate's
 *                          notches, a channel phone_depth wide in front of the plate whose floor is
 *                          bottom_margin up the plate, and fingers into the plate's slot rows over
 *                          the tab length
 *
 * World frame: x across, y from the front to the back, z up; the bounding box starts at the origin.
 *
 * Deliberate differences from boxes.py (docs/differences.md): the support spacing is at least the
 * cable cut-out plus a thickness (boxes.py: the cut-out alone, whose sides then run into the
 * notches'); impossible sizes raise errors (tab longer than the plate, supports wider than the
 * plate, ...).
 */
import { bounds, type Path, type Vec2 } from '../core/geometry';
import { edgeFor } from '../core/edges';
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { Turtle } from '../core/turtle';
import { STORAGE_CATEGORY } from './storage';
import { mirrorWall } from './flexwall';
import { autoMate, slotInto } from './trays';
import {
  at, finishPanels, num, panel, polyline, rectangularWall, requireJointLength,
  type CustomSide, type PanelSpec, type PolyItem, type Wall, type WallLine,
} from './walls';

const schema: Schema = [
  { key: 'phone_height', label: 'Phone height', help: 'Height of the phone', unit: 'mm', group: 'Phone', kind: 'number', min: 100, max: 300, default: 142, step: 1 },
  { key: 'phone_width', label: 'Phone width', help: 'Width of the phone (the plates are this wide inside)', unit: 'mm', group: 'Phone', kind: 'number', min: 40, max: 250, default: 73, step: 1 },
  { key: 'phone_depth', label: 'Phone depth', help: 'Thickness of the phone: the width of the supports\' channel and how far the tabs stand out', unit: 'mm',
    group: 'Phone', kind: 'number', min: 3, max: 20, default: 11, step: 0.5 },
  { key: 'angle', label: 'Angle', help: 'Lean of the phone from vertical', unit: 'deg', group: 'Stand', kind: 'number', min: 5, max: 60, default: 25, step: 1 },
  { key: 'bottom_margin', label: 'Bottom margin', help: 'Height of the supports below the phone, along the plate', unit: 'mm', group: 'Stand', kind: 'number', min: 15, max: 80, default: 30, step: 1 },
  { key: 'tab_size', label: 'Tab length', help: 'Length of the side tabs holding the phone, along the plate', unit: 'mm', group: 'Stand', kind: 'number', min: 45, max: 150, default: 76, step: 1 },
  { key: 'bottom_support_spacing', label: 'Support spacing', help: 'Space between the two supports, for the charging cable', unit: 'mm',
    group: 'Stand', kind: 'number', min: 5, max: 60, default: 16, step: 1 },
  // Stock over 10 mm leaves the tabs and supports no room for fingers.
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

const CABLE_R = 2.5;
const HOOK = 5;
const SMALL_R = 0.5;

type Geo = { a: number; deg: number; h: number; sd: number; sh: number; w: number; ts: number; tl: number; te: number; td: number; side: number; sp: number };

/** Narrowest support spacing: the cable cut-out plus half a thickness of plate either side. */
const minSpacing = (t: number): number => 2 * CABLE_R + t;

function geo(p: Params): Geo {
  const t = num(p, 'thickness');
  const deg = num(p, 'angle');
  const a = (deg * Math.PI) / 180;
  const bm = num(p, 'bottom_margin');
  const tl = num(p, 'tab_size');
  const h = num(p, 'phone_height') + bm;
  const w = num(p, 'phone_width');
  const sp = num(p, 'bottom_support_spacing'); // checks() rejects less than minSpacing(t)
  return { a, deg, h, sd: h * Math.sin(a), sh: h * Math.cos(a), w, ts: bm, tl, te: h - bm - tl, td: num(p, 'phone_depth'), side: (w - sp - 2 * t) / 2, sp };
}

/** boxes.py BottomEdge (support notches `depth` deep, the cable cut-out between them) as a custom side. */
function bottomEdge(g: Geo, t: number, depth: number): CustomSide {
  const half: PolyItem[] = depth > 0 ? [g.side, 90, depth, -90, t, -90, depth, 90, g.sp / 2 - CABLE_R, 90, 2 * CABLE_R] : [(g.w - 2 * CABLE_R) / 2, 90, 2 * CABLE_R];
  return { start: 0, end: 0, draw: (tt) => polyline(tt, [...half, [-180, CABLE_R], ...[...half].reverse()]) };
}

/** Front plate (inner w * h), its joint lines: side pieces 10 + k (right) and 40 + k (left), F/f/F. */
function frontPlate(g: Geo, t: number, ctx: ReturnType<typeof edgeCtx>): Wall {
  const lines: WallLine[] = [];
  const sideEdge = (left: boolean): CustomSide => ({
    start: t, end: t,
    draw: (tt) => {
      const runs = left ? [g.te, g.tl, g.ts] : [g.ts, g.tl, g.te];
      edgeFor('fingerHole')(tt, runs[0]!, ctx);
      polyline(tt, [0, 90, t, -90, 0]);
      edgeFor('finger')(tt, runs[1]!, ctx);
      polyline(tt, [0, -90, t, 90, 0]);
      edgeFor('fingerHole')(tt, runs[2]!, ctx);
    },
  });
  const wall = rectangularWall(g.w, g.h, [bottomEdge(g, t, g.ts), sideEdge(false), 'flat', sideEdge(true)], ctx);
  const y = [0, g.ts, g.ts + g.tl, g.h];
  const types = ['fingerHole', 'finger', 'fingerHole'] as const;
  for (let k = 0; k < 3; k++) {
    lines.push({ side: 10 + k, type: types[k]!, from: { x: g.w + t, y: y[k]! }, to: { x: g.w + t, y: y[k + 1]! } });
    lines.push({ side: 40 + k, type: types[2 - k]!, from: { x: -t, y: y[3 - k]! }, to: { x: -t, y: y[2 - k]! } });
  }
  return { ...wall, lines: [...wall.lines, ...lines] };
}

/** Left triangle (local x = q from the front corner, y = z): fingers on the back leg, tabbed hypotenuse. */
function triangle(g: Geo, t: number, ctx: ReturnType<typeof edgeCtx>): Wall {
  const tt = new Turtle({ x: 0, y: 0 });
  const lines: WallLine[] = [];
  const fingers = (len: number, side: number): void => {
    const p0 = tt.pos;
    const th = (tt.heading * Math.PI) / 180;
    edgeFor('finger')(tt, len, ctx);
    const p1 = tt.pos;
    const r = { x: t * Math.sin(th), y: -t * Math.cos(th) }; // right of travel: the finger tips
    lines.push({ side, type: 'finger', from: { x: p0.x + r.x, y: p0.y + r.y }, to: { x: p1.x + r.x, y: p1.y + r.y } });
  };
  tt.forward(g.sd);
  tt.turn(90);
  fingers(g.sh, 1);
  tt.turn(180 - g.deg);
  fingers(g.te, 10);
  polyline(tt, [0, -90, t, [90, g.td], g.tl - 2 * g.td, [90, g.td], t, -90, 0]);
  fingers(g.ts, 12);
  tt.turn(90 + g.deg);
  return { outline: tt.toPath(true), holes: [], lines };
}

/** Support (boxes.py frame: x towards the front from its back corner, y up) and its finger line. */
function support(g: Geo, t: number, ctx: ReturnType<typeof edgeCtx>): { wall: Wall; fl: number } {
  const full = g.ts + g.tl;
  const fl = full * Math.sin(g.a);
  const ah = full * Math.cos(g.a);
  const br = Math.min(g.ts, 3 * t + g.td);
  const tt = new Turtle({ x: 0, y: 0 });
  polyline(tt, [fl, g.deg, 3 * t + g.td - br, [90, br], HOOK + g.ts - br, [180, t], HOOK - SMALL_R, [-90, SMALL_R], t + g.td - SMALL_R, -90, 0]);
  const p0 = tt.pos;
  const th = (tt.heading * Math.PI) / 180;
  edgeFor('finger')(tt, g.tl, ctx);
  const p1 = tt.pos;
  polyline(tt, [0, 180 - g.deg, ah, 90, 0]);
  const r = { x: t * Math.sin(th), y: -t * Math.cos(th) };
  return { wall: { outline: tt.toPath(true), holes: [], lines: [{ side: 1, type: 'finger', from: { x: p0.x + r.x, y: p0.y + r.y }, to: { x: p1.x + r.x, y: p1.y + r.y } }] }, fl };
}

function checks(g: Geo, t: number): void {
  requireJointLength('bottom_margin', g.ts, t, 'bottom margin (fingered length below the tab)');
  requireJointLength('tab_size', g.tl, t, 'tab length');
  if (!(g.te >= 3 * t))
    throw new ParamError(`tab_size too large: the tab must end at least 3 * thickness below the top of the plate (${(g.h - g.ts - 3 * t).toFixed(1)} mm at most)`, 'tab_size');
  if (!(g.tl >= 2 * g.td + t)) throw new ParamError(`tab_size too small for the phone depth: the rounded tab needs ${(2 * g.td + t).toFixed(1)} mm`, 'tab_size');
  if (!(g.sp >= minSpacing(t)))
    throw new ParamError(`bottom_support_spacing too small: the cable cut-out between the supports needs ${minSpacing(t).toFixed(1)} mm (2 * ${CABLE_R} mm plus thickness)`, 'bottom_support_spacing');
  if (!(g.side >= 2 * t))
    throw new ParamError(`bottom_support_spacing too large for the phone width: the supports would sit ${g.side.toFixed(1)} mm from the plate's sides`, 'bottom_support_spacing');
  if (!(g.ts >= 3 * CABLE_R + t)) throw new ParamError(`bottom_margin too small for the cable cut-out (${(3 * CABLE_R + t).toFixed(1)} mm)`, 'bottom_margin');
  requireJointLength('phone_width', g.w, t, 'plate width');
}

/** All parts in world coordinates before the final shift (y0 = 0: the plate's back face meets the floor at y = 0). */
function parts(p: Params): { specs: PanelSpec[]; t: number } {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const g = geo(p);
  checks(g, t);
  const { a, w, sd, sh } = g;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const W = w + 2 * t;
  // Front plate: z = 0 face its front, origin at the front face's bottom; u = -x, v up the plate, n = (cos, -sin) into the stand.
  const front = panel('front', 'Front plate', frontPlate(g, t, ctx), at([t + w, -t * ca, t * sa], [-1, 0, 0], [0, sa, ca]), []);
  // Back plate: z = 0 face at q = sd + t, n = -y.
  const back = panel('back', 'Back plate', rectangularWall(w, sh, [bottomEdge(g, t, 0), 'fingerHole', 'flat', 'fingerHole'], ctx), at([t, sd + t, 0], [1, 0, 0], [0, 0, 1]), []);
  const tri = triangle(g, t, ctx);
  const left = panel('left', 'Left triangle', tri, at([0, 0, 0], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right triangle', mirrorWall(tri, sd), at([W, sd, 0], [0, -1, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [front, back, left, right];
  slotInto(left, front, [11], ctx);
  slotInto(right, front, [41], ctx);
  const s = support(g, t, ctx);
  // Supports: n = -x, their z = 0 face at the high-x side of the plate's notches; u = -y from the back corner.
  for (const [k, x0] of [[1, 2 * t + g.side], [2, w - g.side + t]] as const) {
    const sp = panel(`support${k}`, 'Support', s.wall, at([x0, s.fl, 0], [0, -1, 0], [0, 0, 1]), []);
    slotInto(front, sp, [1], ctx);
    specs.push(sp);
  }
  autoMate(specs);
  return { specs, t };
}

/** World bounding box of the panels' outlines (exact for these placements, which are axis-aligned in x). */
function box(specs: PanelSpec[], t: number): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of specs) {
    const { origin: o, x: u, y: v } = s.placement;
    const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    // flatten arcs through the bounding box of each segment's samples
    const pts = sample(s.outline);
    for (const q of pts) for (const z of [0, t]) for (let i = 0; i < 3; i++) {
      const c = o[i]! + q.x * u[i]! + q.y * v[i]! + z * n[i]!;
      min[i] = Math.min(min[i]!, c);
      max[i] = Math.max(max[i]!, c);
    }
  }
  return { min, max };
}

/** Outline points incl. arc extremes (via bounds of each arc's path). */
function sample(path: Path): Vec2[] {
  const pts: Vec2[] = [path.start];
  let cur = path.start;
  for (const sg of path.segs) {
    if (sg.t === 'A') {
      const b = bounds({ start: cur, closed: false, segs: [sg] });
      pts.push(b.min, b.max, { x: b.min.x, y: b.max.y }, { x: b.max.x, y: b.min.y });
    }
    pts.push(sg.to);
    cur = sg.to;
  }
  return pts;
}

function build(p: Params): Part[] {
  const { specs, t } = parts(p);
  // Shift so the bounding box starts at the origin.
  const b = box(specs, t);
  for (const s of specs) s.placement = { ...s.placement, origin: [s.placement.origin[0] - b.min[0], s.placement.origin[1] - b.min[1], s.placement.origin[2] - b.min[2]] };
  return finishPanels(specs, t, effectiveKerf(p));
}

export const phoneHolder: Generator = {
  id: 'phoneholder',
  name: 'Phone holder',
  category: STORAGE_CATEGORY,
  description: 'Desk stand holding a phone between two side tabs on hooked supports, with room for the charging cable.',
  schema,
  presets: {
    'Phone holder': { phone_height: 142, phone_width: 73, phone_depth: 11, angle: 25, bottom_margin: 30, tab_size: 76, bottom_support_spacing: 16 },
    'Big phone, upright': { phone_height: 165, phone_width: 78, phone_depth: 10, angle: 15, bottom_margin: 25, tab_size: 80, bottom_support_spacing: 20 },
    'Tablet': { phone_height: 240, phone_width: 170, phone_depth: 9, angle: 30, bottom_margin: 35, tab_size: 120, bottom_support_spacing: 30, thickness: 4 },
  },
  build,
  expectedSize: (p) => {
    const { specs, t } = parts(p);
    const b = box(specs, t);
    return { x: b.max[0] - b.min[0], y: b.max[1] - b.min[1], z: b.max[2] - b.min[2] };
  },
};
