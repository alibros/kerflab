/**
 * Spool: a drum of two round flanges joined by `staves` flat staves round the core, each stave
 * fingered into a slot row in both flanges, with an axle bore and optional rim holes to tie a
 * thread or filament end. Generic version of boxes.py (florianfesti/boxes) Spool and
 * FilamentSpool (spool.py, filamentspool.py); those are presets. Use it for cable, rope, thread,
 * tape or 3D-printer filament.
 *
 * Geometry: the axis is world z; flange 1 in z in [0, t] (show face down), flange 2 in
 * z in [w + t, w + 2t] (show face up), w = the inner width. Stave k is a plate tangent to the core
 * circle (its outer face at radius core / 2) at angle 2 pi k / staves, `stave_width` wide, its
 * fingers reaching the flanges' outer faces.
 *
 * Deliberate differences from boxes.py (docs/differences.md): staves instead of boxes.py's
 * polygon core walls (Spool) or bayonet-locked halves (FilamentSpool); no reinforcement rings.
 */
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { bore, boreRadius, type BoreShape } from '../core/gear';
import { ParamError } from '../core/validate';
import { boreParams, MECHANICAL_CATEGORY } from './gears';
import { disc } from './roundparts';
import { autoMate, holesInside, slotInto } from './trays';
import { at, circle, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'diameter', label: 'Flange diameter', help: 'Outer diameter of the two flanges', unit: 'mm', group: 'Spool', kind: 'number', min: 60, max: 600, default: 200, step: 1 },
  { key: 'core', label: 'Core', help: 'Diameter of the core the material is wound on (the staves\' outer faces), as a fraction of the flange diameter', unit: '',
    group: 'Spool', kind: 'number', min: 0.2, max: 0.9, default: 0.5, step: 0.01 },
  { key: 'width', label: 'Width', help: 'Inner width between the flanges', unit: 'mm', group: 'Spool', kind: 'number', min: 15, max: 400, default: 60, step: 1 },
  { key: 'staves', label: 'Staves', help: 'Number of staves round the core', unit: '', group: 'Spool', kind: 'int', min: 3, max: 16, default: 6 },
  { key: 'stave_width', label: 'Stave width', help: 'Width of each stave', unit: 'mm', group: 'Spool', kind: 'number', min: 8, max: 40, default: 20, step: 0.5 },
  { key: 'rim_holes', label: 'Rim holes', help: 'Two small holes near each flange\'s rim to tie the end of the material', group: 'Spool', kind: 'bool', default: true },
  ...boreParams(20).map((d) => (d.key === 'bore_d' && d.kind === 'number' ? { ...d, max: 60 } : d)),
  // Spools are light parts; thick stock leaves no room for the staves of a small spool.
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 6 } : d)),
];

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const R = num(p, 'diameter') / 2;
  const rc = (num(p, 'core') * num(p, 'diameter')) / 2;
  const w = num(p, 'width');
  const n = num(p, 'staves');
  const s = num(p, 'stave_width');
  requireJointLength('width', w, t, 'inner width');
  requireJointLength('stave_width', s, t);
  if (!(rc + 3 * t <= R)) throw new ParamError(`core too large: the flanges need at least 3 thicknesses of rim outside the core (at most ${((R - 3 * t) / R).toFixed(2)} of the diameter)`, 'core');
  // Neighbouring staves' inner corners must not meet: each takes 2 atan(s / 2 / (rc - t)) of the circle.
  if (!(rc - t > s / 2 && n * 2 * Math.atan(s / 2 / (rc - t)) < 2 * Math.PI - 0.1))
    throw new ParamError(`staves too many (or too wide) for a ${(2 * rc).toFixed(0)} mm core: ${n} staves of ${s} mm would touch`, 'staves');
  const shape = p.bore as BoreShape;
  const d = num(p, 'bore_d');
  // The bore must clear the staves' slots (inner face at rc - t, less the slot's play).
  if (shape !== 'none' && !(boreRadius(shape, d) + 2 <= rc - 2 * t))
    throw new ParamError(`bore_d too large for the core: keep it under ${(2 * (rc - 3 * t)).toFixed(1)} mm`, 'bore_d');
  const hole = bore(shape, d);
  const flangeHoles = hole ? [hole] : [];
  if (p.rim_holes !== false) {
    // Staves sit at odd multiples of 180 / staves degrees; the holes at even ones, about opposite.
    const rr = (R + rc) / 2;
    const b = (2 * Math.PI * Math.floor(n / 2)) / n;
    flangeHoles.push(circle(rr, 0, 1.5), circle(rr * Math.cos(b), rr * Math.sin(b), 1.5));
  }
  const flange = (id: string, name: string, z: number, up: boolean): PanelSpec =>
    panel(id, name, { outline: disc(R), holes: flangeHoles.map((h) => h), lines: [] },
      at([0, 0, z], [1, 0, 0], up ? [0, -1, 0] : [0, 1, 0]), []);
  const f1 = flange('flange1', 'Flange', 0, false);
  const f2 = flange('flange2', 'Flange', w + 2 * t, true);
  const specs: PanelSpec[] = [f1, f2];
  for (let k = 0; k < n; k++) {
    const a = ((2 * k + 1) * Math.PI) / n;
    const er: Vec3 = [Math.cos(a), Math.sin(a), 0];
    const et: Vec3 = [-Math.sin(a), Math.cos(a), 0];
    // u = +z (along the axis), v = tangent: n = u x v = -radial (inwards).
    const o: Vec3 = [rc * er[0] - (s / 2) * et[0], rc * er[1] - (s / 2) * et[1], t];
    const st = panel(`stave${k + 1}`, `Stave ${k + 1}`, rectangularWall(w, s, ['flat', 'finger', 'flat', 'finger'], ctx), at(o, [0, 0, 1], et), []);
    specs.push(st);
    slotInto(f1, st, [3], ctx);
    slotInto(f2, st, [1], ctx);
  }
  if (!holesInside(f1.outline, f1.holes, 0.5)) throw new ParamError('core too large: the stave slots break out of the flanges', 'core');
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const spool: Generator = {
  id: 'spool',
  name: 'Spool',
  category: MECHANICAL_CATEGORY,
  description: 'Drum spool: two flanges joined by finger-jointed staves round a core, with an axle bore and rim holes, for cable, rope, thread or 3D-printer filament (Spool, FilamentSpool).',
  schema,
  presets: {
    'Spool (cable)': { diameter: 150, core: 0.4, width: 50, staves: 5, stave_width: 18, bore: 'round', bore_d: 12 },
    'FilamentSpool (1 kg)': { diameter: 200, core: 0.5, width: 65, staves: 8, stave_width: 25, bore: 'round', bore_d: 53, rim_holes: true },
    'Thread bobbin': { diameter: 60, core: 0.5, width: 25, staves: 4, stave_width: 10, bore: 'round', bore_d: 6, thickness: 2 },
  },
  build,
  expectedSize: (p) => ({ x: num(p, 'diameter'), y: num(p, 'diameter'), z: num(p, 'width') + 2 * num(p, 'thickness') }),
};
