/**
 * DisplayShelf: two side walls carrying `num` shelves that slope down to the front by `angle`,
 * each with a lip at its front edge to stop things sliding off, optionally with a back panel;
 * ported from boxes.py (florianfesti/boxes, boxes/generators/displayshelf.py).
 *
 * Panels (edges bottom, right, top, left):
 *    side walls  D * H    plain ('f' at the back with a back panel); slot rows for the shelves and lips
 *    shelf i     w * sl   front 'f' into its lip (plain without a lip), sides 'f' into the side walls'
 *                         slot rows, back plain (it stops one thickness short of the back)
 *    lip i       w * fh   'F f e f': stands perpendicular to the shelf on its front edge, fh above the
 *                         shelf top; sides 'f' into the side walls' slot rows (plain when fh < 3t:
 *                         no room for fingers, the shelf's fingers hold it)
 *    back        w * H    'e F e F' (optional), owns the corner columns
 * w = x - 2t (inner width), D the side walls' depth (inner depth: in front of the back panel).
 *
 * In a side wall (q = depth from the front, z up), shelf i's front lower corner C_i is where the
 * lip's front face meets the shelf's underside: q = t + (t + fh) sin(angle) (the lip top keeps one
 * thickness from the front edge) and z = bottom_distance + t + i * P. The shelf's inner length is
 * sl = (D - t - C.q) / cos(angle) - t, so its back keeps one thickness from the back. The shelves are
 * spread evenly so the top one ends top_distance + t below the top; the pitch P must leave room
 * above each shelf (at least its own height plus a thickness).
 *
 * World frame: x across, y from the front (y = 0) to the back, z up; outer size x, y, h.
 *
 * Deliberate differences from boxes.py (docs/differences.md): shelves slope forward only (no
 * negative angles); no dividers (sx), no bottom or front panel and no sloped top; the shelf
 * layout is computed from the corners above (boxes.py's offsets differ slightly); a lip height of 0
 * leaves the shelf's front edge plain.
 */
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { STORAGE_CATEGORY } from './storage';
import { autoMate, requireMaxSize, slotInto } from './trays';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width (inner: between the side walls; or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 1500, default: 400, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth (inner: in front of the back panel; or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 400, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the side walls', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 1500, default: 300, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x and y are the inner size. Off: they are the outer size',
    group: 'Size', kind: 'bool', default: false },
  { key: 'num', label: 'Shelves', help: 'Number of shelves', unit: '', group: 'Shelves', kind: 'int', min: 1, max: 8, default: 3 },
  { key: 'angle', label: 'Slope', help: 'Slope of the shelves, front down (0: level)', unit: 'deg',
    group: 'Shelves', kind: 'number', min: 0, max: 45, default: 30, step: 1 },
  { key: 'front_wall_height', label: 'Lip height', help: 'Height of the lip at each shelf\'s front edge above the shelf (0: no lip)', unit: 'mm',
    group: 'Shelves', kind: 'number', min: 0, max: 60, default: 20, step: 1 },
  { key: 'bottom_distance', label: 'Space below', help: 'Extra height below the bottom shelf', unit: 'mm',
    group: 'Shelves', kind: 'number', min: 0, max: 200, default: 0, step: 1 },
  { key: 'top_distance', label: 'Space above', help: 'Extra height above the top shelf', unit: 'mm',
    group: 'Shelves', kind: 'number', min: 0, max: 200, default: 0, step: 1 },
  { key: 'include_back', label: 'Back panel', help: 'Add a back panel finger-jointed to the side walls', group: 'Shelves', kind: 'bool', default: false },
  // Stock over 10 mm would leave no room for lips and shelves of display size.
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

type Layout = { w: number; D: number; H: number; sl: number; fh: number; a: number; Cq: number; Cz: number[]; back: boolean };

/** Shelf layout (see the file comment); ParamErrors name params. */
function layout(p: Params): Layout {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  const back = p.include_back === true;
  const w = num(p, 'x') - (o ? 2 * t : 0);
  const D = num(p, 'y') - (o && back ? t : 0);
  const H = num(p, 'h');
  const n = num(p, 'num');
  const a = (num(p, 'angle') * Math.PI) / 180;
  const fh = num(p, 'front_wall_height');
  requireJointLength('x', w, t, 'inner width');
  requireMaxSize('x', w + 2 * t);
  const Cq = t + (t + fh) * Math.sin(a);
  const sl = (D - t - Cq) / Math.cos(a) - t;
  requireJointLength('y', sl, t, 'shelf length');
  // Height of a shelf with its lip above C: the shelf's top back corner and the lip's top back corner.
  const E = Math.max((t + sl) * Math.sin(a) + t * Math.cos(a), (t + fh) * Math.cos(a) + t * Math.sin(a));
  const z0 = num(p, 'bottom_distance') + t;
  const room = H - num(p, 'top_distance') - t - z0 - E; // for the pitches
  if (!(room >= 0)) throw new ParamError(`h too small: the shelves need ${(H - room).toFixed(1)} mm`, 'h');
  const P = n > 1 ? room / (n - 1) : 0;
  if (n > 1 && !(P >= E + t))
    throw new ParamError(`num too large for the height: shelves ${P.toFixed(1)} mm apart, each needs ${(E + t).toFixed(1)} mm`, 'num');
  return { w, D, H, sl, fh, a, Cq, Cz: Array.from({ length: n }, (_, i) => z0 + i * P), back };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const L = layout(p);
  const { w, D, H, sl, fh, a } = L;
  const X = w + 2 * t;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const e = 'flat' as const;
  const f = 'finger' as const;
  const F = 'fingerHole' as const;

  const left = panel('left', 'Left side', rectangularWall(D, H, [e, L.back ? f : e, e, e], ctx), at([0, 0, 0], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right side', rectangularWall(D, H, [e, e, e, L.back ? f : e], ctx), at([X, D, 0], [0, -1, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [left, right];
  if (L.back) specs.push(panel('back', 'Back', rectangularWall(w, H, [e, F, e, F], ctx), at([t, D + t, 0], [1, 0, 0], [0, 0, 1]), []));

  L.Cz.forEach((cz, i) => {
    const C: Vec3 = [0, L.Cq, cz]; // x set per panel
    // Shelf: z = 0 face its underside, v up the slope to the back, n up (front-up normal).
    const shelf = panel(`shelf${i + 1}`, 'Shelf', rectangularWall(w, sl, [fh > 0 ? f : e, f, e, f], ctx),
      at([t, C[1] + t * cos, C[2] + t * sin], [1, 0, 0], [0, cos, sin]), []);
    slotInto(left, shelf, [3], ctx);
    slotInto(right, shelf, [1], ctx);
    specs.push(shelf);
    if (fh > 0) {
      // Lip: z = 0 face its front, v along the shelf's up-normal, n back up the slope.
      // A lip lower than 3t has no room for fingers into the side walls: it is held by the shelf only.
      const sides = fh >= 3 * t;
      const lip = panel(`lip${i + 1}`, 'Lip', rectangularWall(w, fh, [F, sides ? f : e, e, sides ? f : e], ctx),
        at([t + w, C[1] - t * sin, C[2] + t * cos], [-1, 0, 0], [0, -sin, cos]), []);
      if (sides) {
        slotInto(right, lip, [3], ctx);
        slotInto(left, lip, [1], ctx);
      }
      specs.push(lip);
    }
  });
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

/** Shelf length and front-corner positions, for tests. */
export const displayShelfLayout = (p: Params): Layout => layout(p);

export const displayShelf: Generator = {
  id: 'displayshelf',
  name: 'Display shelf',
  category: STORAGE_CATEGORY,
  description: 'Two side walls carrying shelves that slope down to the front, each with a lip, to show off things.',
  schema,
  presets: {
    'Display shelf': { x: 400, y: 100, h: 300, num: 3, angle: 30, front_wall_height: 20, include_back: false, inside: false },
    'Comic rack with back': { x: 300, y: 80, h: 450, num: 3, angle: 15, front_wall_height: 30, include_back: true, inside: false, thickness: 4 },
    'Level shelves': { x: 250, y: 120, h: 250, num: 2, angle: 0, front_wall_height: 0, bottom_distance: 20, include_back: true, inside: true },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    const L = layout(p);
    return { x: L.w + 2 * t, y: L.D + (L.back ? t : 0), z: L.H };
  },
};
