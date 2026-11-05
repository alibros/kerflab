/**
 * SpicesRack: a wall-hung back board carrying `numy` shelves of `numx` spice cans each; the cans
 * lean back through elongated holes in the shelves, which have a scalloped front edge, and the
 * shelves are propped by brackets under them. Ported from boxes.py (florianfesti/boxes,
 * boxes/generators/spicesrack.py).
 *
 * boxes.py's geometry (d = can diameter, s = space between cans, hc = supported can height):
 *   base angle 10 deg, base_r = d/2 cos 10, base_h = d/2 (1 - sin 10), lean = atan(base_r / hc),
 *   hole length l = hypot(base_h, hc), hole distance hd = (d - base_r) sin(lean),
 *   pitch P = (s + d) / cos(lean), shelf depth iw = hd + l/3 plus bumps ew = l * 2/3 + s/2.
 * Panels (local edges bottom, right, top, left):
 *    back        x * Hb        plain; Hb = numy P - P/2 + max(6t, 9 mm), x = numx (d + s); slot rows
 *                              for the shelves (mid-plane at (i + 1/2) P) and brackets; two 3 mm
 *                              hanging holes max(3t, 3 mm) from the top corners
 *    shelf i     x * iw        'f' into the back, plain sides, scalloped front (one half-ellipse
 *                              bump ew deep per can); per can a hole: the circular segment of the
 *                              can's foot (chord 2 base_r, radius d/2) stretched to length l
 *    bracket     iw * (P-t)/2  under each shelf between neighbouring cans: fingers into the back,
 *                              its top against the shelf's underside, a concave quarter circle
 *                              cut out of its lower front corner
 *
 * World frame: x across, y out from the wall (back's wall face at y = 0), z up. Outer size x,
 * t + iw + ew, Hb.
 *
 * Deliberate differences from boxes.py (docs/differences.md): no feet and no in-place brackets;
 * the can holes are centred on the cans (boxes.py shifts them by d (1 - cos 10) / 2); holes that
 * would break out of the scalloped edge are rejected (`can_space`).
 */
import type { Vec2 } from '../core/geometry';
import { edgeFor } from '../core/edges';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { Turtle } from '../core/turtle';
import { STORAGE_CATEGORY, polygon, traceTo } from './storage';
import { autoMate, holesInside, requireMaxSize, slotInto } from './trays';
import { at, circle, finishPanels, num, panel, polyline, rectangularWall, rect, requireJointLength, type PanelSpec, type Wall } from './walls';

const schema: Schema = [
  { key: 'diameter', label: 'Can diameter', help: 'Diameter of the spice cans', unit: 'mm',
    group: 'Cans', kind: 'number', min: 20, max: 120, default: 55, step: 1 },
  { key: 'height', label: 'Can height', help: 'Height of the cans that has to be supported', unit: 'mm',
    group: 'Cans', kind: 'number', min: 20, max: 200, default: 60, step: 1 },
  { key: 'can_space', label: 'Can spacing', help: 'Space between neighbouring cans', unit: 'mm',
    group: 'Cans', kind: 'number', min: 2, max: 40, default: 10, step: 0.5 },
  { key: 'numx', label: 'Cans per row', help: 'Number of cans on each shelf', unit: '', group: 'Layout', kind: 'int', min: 1, max: 8, default: 5 },
  { key: 'numy', label: 'Rows', help: 'Number of shelves', unit: '', group: 'Layout', kind: 'int', min: 1, max: 8, default: 6 },
  // Stock over 10 mm leaves the brackets no room for fingers.
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

type Dims = { x: number; P: number; Hb: number; iw: number; ew: number; hd: number; l: number; br: number; bh: number; r: number; lean: number; sh: number };

/** boxes.py's derived sizes (see the file comment). */
function dims(p: Params): Dims {
  const t = num(p, 'thickness');
  const d = num(p, 'diameter');
  const s = num(p, 'can_space');
  const hc = num(p, 'height');
  const base = (10 * Math.PI) / 180;
  const br = (d / 2) * Math.cos(base);
  const bh = (d / 2) * (1 - Math.sin(base));
  const lean = Math.atan(br / hc);
  const l = Math.hypot(bh, hc);
  const hd = (d - br) * Math.sin(lean);
  const P = (s + d) / Math.cos(lean);
  const x = num(p, 'numx') * (d + s);
  const Hb = num(p, 'numy') * P - P / 2 + Math.max(6 * t, 9);
  const iw = hd + l / 3;
  const ew = hd + l + s / 2 - iw;
  return { x, P, Hb, iw, ew, hd, l, br, bh, r: d / 2, lean, sh: (P - t) / 2 };
}

/** One can hole: the circular segment of its foot, stretched to length l; centre x cx. */
function canHole(D: Dims, cx: number): Vec2[] {
  const base = (10 * Math.PI) / 180;
  const k = D.l / D.bh;
  const cy = -D.r * Math.sin(base); // circle centre below the chord (chord at 0)
  const pts: Vec2[] = [{ x: cx - D.br, y: D.hd }, { x: cx + D.br, y: D.hd }];
  const N = 32;
  for (let i = 1; i < N; i++) {
    const a = base + ((Math.PI - 2 * base) * i) / N;
    pts.push({ x: cx + D.r * Math.cos(a), y: D.hd + k * (cy + D.r * Math.sin(a)) });
  }
  return pts;
}

/** Bracket: iw wide, sh tall, fingers on its back edge (x = 0), a concave quarter circle at the lower front. */
function bracket(D: Dims, t: number, ctx: ReturnType<typeof edgeCtx>): Wall {
  const w = D.iw;
  const h = D.sh;
  const r = Math.min(w - 2 * t, h - 2 * t);
  const tt = new Turtle({ x: 0, y: 0 });
  polyline(tt, [w - r, 90, 0, [-90, r], 0, 90, h - r, 90, w, 90]);
  edgeFor('finger')(tt, h, ctx);
  return { outline: tt.toPath(true), holes: [], lines: [{ side: 3, type: 'finger', from: { x: -t, y: h }, to: { x: -t, y: 0 } }] };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const D = dims(p);
  const d = num(p, 'diameter');
  const s = num(p, 'can_space');
  const nx = num(p, 'numx');
  const ny = num(p, 'numy');
  requireMaxSize('numx', D.x);
  requireMaxSize('numy', D.Hb);
  requireJointLength('diameter', D.sh, t, 'the bracket height ((shelf pitch - thickness) / 2)');
  if (nx > 1 && !(Math.min(D.iw, D.sh) - 2 * t > 1))
    throw new ParamError(`diameter too small for the thickness: the brackets (${D.iw.toFixed(1)} x ${D.sh.toFixed(1)} mm) need more than 2 * thickness + 1 mm`, 'diameter');
  // The brackets (one thickness) stand between neighbouring cans: the cans must clear them.
  if (nx > 1 && !(s >= t + 1))
    throw new ParamError(`can_space too small: the ${t} mm brackets between the cans need at least thickness + 1 mm = ${(t + 1).toFixed(1)} mm`, 'can_space');

  // Back: u = -x (local x from the right), v = +z, n = +y; wall face y = 0.
  const back: Wall = { outline: rect(0, 0, D.x, D.Hb), holes: [], lines: [] };
  const m = Math.max(3 * t, 3); // hanging holes: 3t (at least 3 mm) from the top corners
  back.holes.push(circle(m, D.Hb - m, 1.5), circle(D.x - m, D.Hb - m, 1.5));
  const backSpec = panel('back', 'Back', back, at([D.x, 0, 0], [-1, 0, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [backSpec];

  // Shelf: inner rect x * iw, scalloped front (half ellipses R x ew per can), can holes.
  const R = (d + s) / 2;
  const front = {
    start: 0, end: 0,
    draw: (tt: Turtle) => {
      const pts: Vec2[] = [];
      for (let k = nx - 1; k >= 0; k--) {
        const cx = (k + 0.5) * (d + s);
        for (let i = 1; i <= 24; i++) {
          const a = (Math.PI * i) / 24;
          pts.push({ x: cx + R * Math.cos(a), y: D.iw + D.ew * Math.sin(a) });
        }
      }
      traceTo(tt, pts);
    },
  };
  for (let i = 0; i < ny; i++) {
    const zc = (i + 0.5) * D.P;
    const w = rectangularWall(D.x, D.iw, ['finger', 'flat', front, 'flat'], ctx);
    w.holes.push(...Array.from({ length: nx }, (_, k) => polygon(canHole(D, (k + 0.5) * (d + s)))));
    if (i === 0 && !holesInside(w.outline, w.holes, 0.5))
      throw new ParamError(`can_space too small: the can holes would break out of the shelf's scalloped front edge`, 'can_space');
    // Shelf: u = +x, v = +y, n = +z; its z = 0 face is the underside.
    const shelf = panel(`shelf${i + 1}`, 'Shelf', w, at([0, t, zc - t / 2], [1, 0, 0], [0, 1, 0]), []);
    slotInto(backSpec, shelf, [0], ctx);
    specs.push(shelf);
    for (let j = 1; j < nx; j++) {
      const xj = j * (d + s);
      // Bracket: u = +y, v = +z, n = +x; mid-plane at x = xj, top against the shelf's underside.
      const b = panel(`bracket${i + 1}_${j}`, 'Bracket', bracket(D, t, ctx), at([xj - t / 2, t, zc - t / 2 - D.sh], [0, 1, 0], [0, 0, 1]), []);
      slotInto(backSpec, b, [3], ctx);
      specs.push(b);
    }
  }
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const spicesRack: Generator = {
  id: 'spicesrack',
  name: 'Spice rack',
  category: STORAGE_CATEGORY,
  description: 'Wall-hung rack of shelves with leaning holes for round spice cans, propped by brackets.',
  schema,
  presets: {
    'Spice rack 5 x 6': { diameter: 55, height: 60, can_space: 10, numx: 5, numy: 6 },
    'Small jars 4 x 3': { diameter: 40, height: 50, can_space: 8, numx: 4, numy: 3 },
    'Big tins 3 x 2': { diameter: 80, height: 100, can_space: 12, numx: 3, numy: 2, thickness: 4 },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    const D = dims(p);
    return { x: D.x, y: t + D.iw + D.ew, z: D.Hb };
  },
  // The shelves stick out +y from the back panel: look at the open side.
  view: { turn: 180 },
};
