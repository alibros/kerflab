/**
 * Silverware: a cutlery caddy, an open tray split lengthwise by a centre wall that rises into a
 * carrying handle, with dividers on both sides; ported from boxes.py (florianfesti/boxes,
 * boxes/generators/silverwarebox.py).
 *
 * Panels (edges bottom, right, top, left):
 *    floor          x * y    'f f f f'     slot rows for the centre wall and the dividers
 *    front, back    x * h    'F F e F'     own the corner columns; slot rows for the dividers
 *    left, right    y * h    'F f e f'     a slot row for the centre wall
 *    centre wall    x * hi   [f, f, handle, f]  fingers into the floor and the side walls; the top
 *                                          is boxes.py's handle (Bezier shoulders) with a grip hole
 *    dividers       l * hi   [f, f, e, f]  fingers into the floor, the front or back wall and the
 *                                          centre wall (slot rows), l = (y - t) / 2
 * hi = h - inner_drop. Front side: front_compartments equal compartments (front_compartments - 1
 * dividers), back side likewise. A back divider within two thicknesses of a front divider butts
 * flat against the centre wall instead (their fingers would meet in the same slot).
 *
 * World frame: x along the caddy, y from the front (y = 0) to the back, z up (floor underside at
 * z = 0); the centre wall's front face at y = t + l. Outer size x + 2t, y + 2t,
 * t + max(h, hi + handleheight).
 *
 * Deliberate differences from boxes.py (docs/differences.md): square corners instead of the flex
 * rounded wall (`cornerradius`): bent parts are not modelled yet; divider counts per side are
 * parameters (boxes.py: fixed at 2 + 1 at fixed positions); the handle corner radius is limited to
 * fit the handle; the grip hole starts a thickness above the dividers' tops.
 */
import type { Generator, Part } from '../core/part';
import type { Vec2 } from '../core/geometry';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { autoMate, equal, slotInto, TRAY_CATEGORY, wallOffsets } from './trays';
import {
  at, finishPanels, num, panel, rectangularWall, requireJointLength, roundedRect, sideLine,
  type CustomSide, type PanelSpec, type WallEdge, type WallEdges,
} from './walls';

const schema: Schema = [
  { key: 'x', label: 'Length', help: 'Length along x (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 100, max: 800, default: 250, step: 1 },
  { key: 'y', label: 'Width', help: 'Width along y, across the centre wall (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 500, default: 154, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the outer walls (inner: above the floor; outer: including it)', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 400, default: 120, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside. Off: they are the outside (the handle stands above)',
    group: 'Size', kind: 'bool', default: true },
  { key: 'inner_drop', label: 'Inner walls lower by', help: 'How much lower the dividers (and the centre wall below its handle) are than the outer walls', unit: 'mm',
    group: 'Compartments', kind: 'number', min: 0, max: 50, default: 10, step: 1 },
  { key: 'front_compartments', label: 'Front compartments', help: 'Number of equal compartments in front of the centre wall', unit: '',
    group: 'Compartments', kind: 'int', min: 1, max: 6, default: 3 },
  { key: 'back_compartments', label: 'Back compartments', help: 'Number of equal compartments behind the centre wall', unit: '',
    group: 'Compartments', kind: 'int', min: 1, max: 6, default: 2 },
  { key: 'handleheight', label: 'Handle height', help: 'Height of the handle above the dividers', unit: 'mm',
    group: 'Handle', kind: 'number', min: 20, max: 300, default: 150, step: 1 },
  { key: 'handlewidth', label: 'Grip hole width', help: 'Width of the grip hole in the handle', unit: 'mm',
    group: 'Handle', kind: 'number', min: 20, max: 200, default: 120, step: 1 },
  ...commonParams,
];

function innerSize(p: Params): { x: number; y: number; h: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o ? t : 0) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  const hi = i.h - num(p, 'inner_drop');
  return { x: i.x + 2 * t, y: i.y + 2 * t, z: t + Math.max(i.h, hi + num(p, 'handleheight')) };
}

/** Point on the cubic Bezier p0, c1, c2, p3 at s. */
function bezier(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, s: number): Vec2 {
  const u = 1 - s;
  const a = u * u * u;
  const b = 3 * u * u * s;
  const c = 3 * u * s * s;
  const d = s * s * s;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
}

/**
 * boxes.py `handle(x, h, hl, r)` as a custom top side: shoulders rising d = (len - hl - 2r) / 2 along
 * and H - r up as Bezier curves (flattened), rounded by r into a flat top hl long, H above the side's
 * line. Points are in the turtle's start frame (x forward, y left; "up" is to the right).
 */
function handle(H: number, hl: number, r: number): CustomSide {
  return {
    start: 0, end: 0,
    draw: (tt, len) => {
      const d = (len - hl - 2 * r) / 2;
      const P = (x: number, y: number): Vec2 => ({ x, y });
      const curves: [Vec2, Vec2, Vec2, Vec2][] = [
        [P(0, 0), P(d, 0), P(d, 0), P(d, -(H - r))],
        [P(d, -(H - r)), P(d, -H), P(d, -H), P(d + r, -H)],
        [P(d + r + hl, -H), P(d + 2 * r + hl, -H), P(d + 2 * r + hl, -H), P(d + 2 * r + hl, -(H - r))],
        [P(d + 2 * r + hl, -(H - r)), P(d + 2 * r + hl, 0), P(d + 2 * r + hl, 0), P(len, 0)],
      ];
      const pts: Vec2[] = [];
      const N = 16;
      curves.forEach((c, k) => {
        for (let i = 1; i <= N; i++) pts.push(bezier(c[0], c[1], c[2], c[3], i / N));
        if (k === 1) pts.push(P(d + r + hl, -H)); // the straight top
      });
      const h0 = tt.heading;
      const o = tt.pos;
      const rad = (h0 * Math.PI) / 180;
      const fw = { x: Math.cos(rad), y: Math.sin(rad) };
      const lf = { x: -fw.y, y: fw.x };
      for (const q of pts) {
        const w = { x: o.x + q.x * fw.x + q.y * lf.x, y: o.y + q.x * fw.y + q.y * lf.y };
        const cur = tt.pos;
        const dist = Math.hypot(w.x - cur.x, w.y - cur.y);
        if (dist < 1e-9) continue;
        const a = (Math.atan2(w.y - cur.y, w.x - cur.x) * 180) / Math.PI;
        tt.turn(((a - tt.heading) % 360 + 540) % 360 - 180);
        tt.forward(dist);
      }
      tt.turn(((h0 - tt.heading) % 360 + 540) % 360 - 180);
    },
  };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h } = innerSize(p);
  requireJointLength('x', x, t);
  requireJointLength('h', h, t, 'wall height');
  const hi = h - num(p, 'inner_drop');
  if (!(hi >= 3 * t))
    throw new ParamError(`inner_drop too large: the inner walls would be ${hi.toFixed(1)} mm high, they need at least 3 * thickness = ${(3 * t).toFixed(1)} mm`, 'inner_drop');
  const l = (y - t) / 2;
  requireJointLength('y', l, t, 'divider length (half of y, less the centre wall)');
  const n1 = num(p, 'front_compartments');
  const n2 = num(p, 'back_compartments');
  for (const [key, n] of [['front_compartments', n1], ['back_compartments', n2]] as const) {
    const cw = (x - (n - 1) * t) / n;
    if (!(cw >= 2 * t)) throw new ParamError(`${key} too large: compartments would be ${cw.toFixed(1)} mm, less than two thicknesses`, key);
  }
  const H = num(p, 'handleheight');
  const hl = num(p, 'handlewidth');
  if (!(H >= 4 * t)) throw new ParamError(`handleheight too small: at least four thicknesses (${(4 * t).toFixed(1)} mm)`, 'handleheight');
  const r = Math.min(30, hl / 2.5, (H - t) / 4);
  const d = (x - hl - 2 * r) / 2;
  if (!(d >= t)) throw new ParamError(`handlewidth too large: the handle (${(hl + 2 * r).toFixed(1)} mm with its shoulders) leaves less than a thickness each side on a ${x.toFixed(1)} mm wall`, 'handlewidth');

  const X = x + 2 * t;
  const Y = y + 2 * t;
  const yc = t + l; // centre wall's front face
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const wall = (w: number, hh: number, types: WallEdges) => rectangularWall(w, hh, types, ctx);
  const front = panel('front', 'Front', wall(x, h, [F, F, e, F]), at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right side', wall(y, h, [F, f, e, f]), at([X, t + y, t], [0, -1, 0], [0, 0, 1]), []);
  const back = panel('back', 'Back', wall(x, h, [F, F, e, F]), at([t, Y, t], [1, 0, 0], [0, 0, 1]), []);
  const left = panel('left', 'Left side', wall(y, h, [F, f, e, f]), at([0, t, t], [0, 1, 0], [0, 0, 1]), []);
  const floor = panel('floor', 'Floor', wall(x, y, [f, f, f, f]), at([t, t, 0], [1, 0, 0], [0, 1, 0]), []);

  // Centre wall: u = -x, normal +y, z = 0 face at y = yc. Local x = t + x - world x.
  const cw = wall(x, hi, [f, f, handle(H, hl, r), f]);
  cw.holes.push(roundedRect(x / 2, hi + t + (H - r - t) / 2, hl, H - r - t, r));
  const centre = panel('centre', 'Centre wall with handle', cw, at([t + x, yc, t], [-1, 0, 0], [0, 0, 1]), []);
  slotInto(floor, centre, [0], ctx);
  slotInto(left, centre, [1], ctx);
  slotInto(right, centre, [3], ctx);

  const xs = (n: number): number[] => wallOffsets(equal(x - (n - 1) * t, n), t).map((o) => t + o); // world x of each divider's low face
  const fx = xs(n1);
  const bx = xs(n2);
  // Front dividers: u = +y from the front wall's inner face, normal +x. Their fingers pass through the
  // centre wall; that joint line is declared on the centre wall's front (z = 0) face.
  const fronts = fx.map((x0, i) => {
    const w = wall(l, hi, [f, f, e, f]);
    w.lines = w.lines.map((ln) => (ln.side === 1 ? { ...ln, ...sideLine(1, 0, hi, 0, l, hi) } : ln));
    const s = panel(`frontdivider${i + 1}`, 'Divider (front)', w, at([x0, t, t], [0, 1, 0], [0, 0, 1]), []);
    slotInto(floor, s, [0], ctx);
    slotInto(front, s, [3], ctx);
    slotInto(centre, s, [1], ctx);
    return s;
  });
  // Back dividers: u = +y from the centre wall's back face, normal +x; fingers through the centre wall
  // reach its front face (the default joint line), unless a front divider is in the way.
  const backs = bx.map((x0, i) => {
    const clash = fx.some((xf) => Math.abs(xf - x0) < 2 * t);
    const s = panel(`backdivider${i + 1}`, 'Divider (back)', wall(l, hi, [f, f, e, clash ? e : f]), at([x0, yc + t, t], [0, 1, 0], [0, 0, 1]), []);
    slotInto(floor, s, [0], ctx);
    slotInto(back, s, [1], ctx);
    if (!clash) slotInto(centre, s, [3], ctx);
    return s;
  });

  const specs: PanelSpec[] = [front, right, back, left, floor, centre, ...fronts, ...backs];
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const silverware: Generator = {
  id: 'silverware',
  name: 'Silverware caddy',
  category: TRAY_CATEGORY,
  description: 'Cutlery caddy: a tray split by a centre wall that rises into a carrying handle, with compartments on both sides.',
  schema,
  presets: {
    'Cutlery caddy': { x: 250, y: 154, h: 120, handleheight: 150, handlewidth: 120, front_compartments: 3, back_compartments: 2, inside: true },
    'Picnic caddy': { x: 300, y: 180, h: 100, handleheight: 120, handlewidth: 110, front_compartments: 2, back_compartments: 2, inside: false, thickness: 4 },
    'Utensil holder, low handle': { x: 200, y: 120, h: 90, handleheight: 60, handlewidth: 90, front_compartments: 4, back_compartments: 1, inner_drop: 0, inside: true },
  },
  build,
  expectedSize,
};
