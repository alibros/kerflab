/**
 * LaptopStand: two identical triangular plates crossing in an X (an egg-crate slot in each, one
 * from below, one from above), standing on the diagonals of a square footprint, so that a laptop
 * lying on their sloped top edges is tilted by `angle`; a nub at the low front end of each plate
 * stops it sliding off. Ported from boxes.py (florianfesti/boxes,
 * boxes/generators/laptopstand.py).
 *
 * Geometry (plate-local, x along the plate's diagonal from its front foot, y up):
 *   - the laptop's bottom face lies on the top edge, a line of slope b = atan(tan(angle) / sqrt 2)
 *     (the laptop's tilt seen along a diagonal), from its front point P_f at height ground_offset to
 *     the rear, spanning base = sqrt 2 * l_depth * cos(angle) horizontally and l_depth * sin(angle)
 *     in height: so the laptop plane through both plates' top edges is tilted by `angle` about x;
 *   - at the front the nub rises l_thickness above that line (perpendicular to it) and is
 *     nub_size long; the front face runs perpendicular to the top edge down to the ground;
 *   - the bottom has two feet (10 + nub_size long) and a 45 degree recess between them;
 *   - the plates cross at the middle of the top edge's span; plate 'bottom' is slotted from below,
 *     plate 'top' from above, each slot one thickness wide, meeting halfway between the recess and
 *     the top edge.
 *
 * World frame: x across, y from the front to the back, z up; the stand's bounding box starts at
 * the origin. Plate 'bottom' runs from front left to back right, plate 'top' from front right to
 * back left.
 *
 * Deliberate differences from boxes.py (docs/differences.md): the nub's corners are sharp (boxes.py
 * rounds two of them with r = 1 mm); the outline is computed from the vertices so it always
 * closes (boxes.py approximates the recess run by 7 mm and the slot depths by 3.5 mm); impossible
 * sizes raise errors instead of drawing overlapping outlines.
 */
import type { Vec2 } from '../core/geometry';
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { STORAGE_CATEGORY, polygon } from './storage';
import { crossing } from './trays';
import { at, finishPanels, num, panel, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'l_depth', label: 'Laptop depth', help: 'Depth of the laptop, front to back', unit: 'mm',
    group: 'Laptop', kind: 'number', min: 120, max: 500, default: 250, step: 1 },
  { key: 'l_thickness', label: 'Laptop thickness', help: 'Thickness of the laptop: how far the front nub stands above the support', unit: 'mm',
    group: 'Laptop', kind: 'number', min: 3, max: 40, default: 10, step: 0.5 },
  { key: 'angle', label: 'Tilt', help: 'Tilt of the keyboard', unit: 'deg',
    group: 'Stand', kind: 'number', min: 5, max: 40, default: 15, step: 0.5 },
  { key: 'ground_offset', label: 'Ground offset', help: 'Height of the laptop\'s front bottom edge above the ground', unit: 'mm',
    group: 'Stand', kind: 'number', min: 5, max: 100, default: 10, step: 0.5 },
  { key: 'nub_size', label: 'Nub size', help: 'Length of the nub at the front that stops the laptop sliding off', unit: 'mm',
    group: 'Stand', kind: 'number', min: 4, max: 40, default: 10, step: 0.5 },
  ...commonParams,
];

/** Recess between the feet: 5 mm chamfers at 45 degrees (boxes.py). */
const CHAMFER = 5 / Math.SQRT2;

type Plate = { outline: (slot: 'bottom' | 'top') => Vec2[]; xc: number; ym: number; x0: number; xr: number; ztop: number; slope: number };

/** Plate outline and key positions (plate-local mm, see the file comment); ParamErrors name params. */
function plate(p: Params): Plate {
  const t = num(p, 'thickness');
  const L = num(p, 'l_depth');
  const T = num(p, 'l_thickness');
  const a = (num(p, 'angle') * Math.PI) / 180;
  const g = num(p, 'ground_offset');
  const nb = num(p, 'nub_size');
  const b = Math.atan(Math.tan(a) / Math.SQRT2);
  const height = L * Math.sin(a);
  const base = Math.SQRT2 * L * Math.cos(a);
  const d = { x: Math.cos(b), y: Math.sin(b) };
  const n = { x: -Math.sin(b), y: Math.cos(b) };
  const xf = nb / Math.cos(b) - g * Math.tan(b);
  const Pf = { x: xf, y: g };
  const Q1 = { x: Pf.x + T * n.x, y: Pf.y + T * n.y };
  const Q2 = { x: Q1.x - nb * d.x, y: Q1.y - nb * d.y };
  if (!(Q2.y > t)) throw new ParamError(`nub_size too large for the tilt: the nub's front corner would be ${Q2.y.toFixed(1)} mm above the ground`, 'nub_size');
  const xr = xf + base;
  const Pr = { x: xr, y: g + height };
  const foot = 10 + nb;
  const e = CHAMFER;
  const xc = xf + base / 2;
  const top = (x: number): number => g + (x - xf) * Math.tan(b);
  // Crossing slots are t + play wide (the joint play), centred on the crossing.
  const sw = (t + num(p, 'play') * t) / 2;
  if (!(xc - sw - t >= foot + e && xc + sw + t <= xr - foot - e))
    throw new ParamError(`l_depth too small: the plates' crossing slots would cut into the feet (span ${base.toFixed(1)} mm, the feet need ${(2 * (foot + e + 1.5 * t - xf)).toFixed(1)} mm)`, 'l_depth');
  const ym = (e + top(xc)) / 2;
  if (!(ym - e >= 2 * t)) throw new ParamError(`ground_offset too small: the plates are ${(top(xc) - e).toFixed(1)} mm high where they cross, the slots need ${(4 * t).toFixed(1)} mm`, 'ground_offset');
  const feet: Vec2[] = [{ x: 0, y: 0 }, { x: foot, y: 0 }, { x: foot + e, y: e }];
  const rear: Vec2[] = [{ x: xr - foot - e, y: e }, { x: xr - foot, y: 0 }, { x: xr, y: 0 }, Pr];
  const front: Vec2[] = [Pf, Q1, Q2];
  const outline = (slot: 'bottom' | 'top'): Vec2[] => slot === 'bottom'
    ? [...feet, { x: xc - sw, y: e }, { x: xc - sw, y: ym }, { x: xc + sw, y: ym }, { x: xc + sw, y: e }, ...rear, ...front]
    : [...feet, ...rear, { x: xc + sw, y: top(xc + sw) }, { x: xc + sw, y: ym }, { x: xc - sw, y: ym }, { x: xc - sw, y: top(xc - sw) }, ...front];
  return { outline, xc, ym, x0: Math.min(0, Q2.x), xr, ztop: Math.max(Pr.y, Q1.y), slope: b };
}

const S = Math.SQRT1_2;
/** Plan directions of the two plates (front to back) and their normals (u x z). */
const DIRS: { u: Vec3; n: Vec3 }[] = [
  { u: [S, S, 0], n: [S, -S, 0] }, // 'bottom': front left -> back right
  { u: [-S, S, 0], n: [S, S, 0] }, // 'top': front right -> back left
];

/** Plan bounding box of both plates about their crossing point at the origin. */
function plan(pl: Plate, t: number): { min: [number, number]; max: [number, number] } {
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  for (const { u, n } of DIRS) for (const s of [pl.x0, pl.xr]) for (const w of [-t / 2, t / 2])
    for (let i = 0; i < 2; i++) {
      const v = (s - pl.xc) * u[i]! + w * n[i]!;
      min[i] = Math.min(min[i]!, v);
      max[i] = Math.max(max[i]!, v);
    }
  return { min, max };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const pl = plate(p);
  const box = plan(pl, t);
  const M: Vec3 = [-box.min[0], -box.min[1], 0]; // crossing point (mid-planes) in plan
  const specs: PanelSpec[] = (['bottom', 'top'] as const).map((slot, k) => {
    const { u, n } = DIRS[k]!;
    const origin: Vec3 = [0, 1, 2].map((i) => M[i]! - pl.xc * u[i]! - (t / 2) * n[i]!) as Vec3;
    const wall = { outline: polygon(pl.outline(slot)), holes: [], lines: [] };
    return panel(slot === 'bottom' ? 'plate1' : 'plate2', slot === 'bottom' ? 'Plate (slot from below)' : 'Plate (slot from above)',
      wall, at(origin, u, [0, 0, 1]), []);
  });
  // The plates' z = 0 faces meet on the vertical line through M - t/2 (n1 + n2), at the slot edges.
  const c = Math.min(t, (pl.ym - 0) / 4);
  const P = (z: number): Vec3 => [M[0] - (t / 2) * (DIRS[0]!.n[0] + DIRS[1]!.n[0]), M[1] - (t / 2) * (DIRS[0]!.n[1] + DIRS[1]!.n[1]), z];
  crossing(specs[0]!, specs[1]!, P(pl.ym - c), P(pl.ym + c));
  return finishPanels(specs, t, effectiveKerf(p));
}

/** Tilt of the laptop plane (degrees) and the slope along each plate, for tests. */
export function laptopGeometry(p: Params): { slope: number; xc: number; ym: number } {
  const pl = plate(p);
  return { slope: (pl.slope * 180) / Math.PI, xc: pl.xc, ym: pl.ym };
}

export const laptopStand: Generator = {
  id: 'laptopstand',
  name: 'Laptop stand',
  category: STORAGE_CATEGORY,
  description: 'Two crossing triangular plates that hold a laptop at a tilt, with a nub at the front.',
  schema,
  presets: {
    'Laptop, 15°': { l_depth: 250, l_thickness: 10, angle: 15, ground_offset: 10, nub_size: 10 },
    'Big laptop, steep': { l_depth: 300, l_thickness: 20, angle: 25, ground_offset: 15, nub_size: 12, thickness: 4 },
    'Tablet': { l_depth: 180, l_thickness: 8, angle: 30, ground_offset: 20, nub_size: 8 },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    const pl = plate(p);
    const b = plan(pl, t);
    return { x: b.max[0] - b.min[0], y: b.max[1] - b.min[1], z: pl.ztop };
  },
};
