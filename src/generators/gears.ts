/**
 * Gears: an involute spur gear, or a meshing pair, with a shaft bore (round, D or hex). Generic
 * version of boxes.py (florianfesti/boxes) Gears (boxes/generators/gear.py); the involute
 * geometry is in src/core/gear.ts.
 *
 * The pair is shown meshed at the standard centre distance m (z1 + z2) / 2: gear 1 centred on the
 * origin with a tooth on the +x axis, gear 2 on the +x axis turned so a tooth gap faces it. Both lie
 * in z in [0, t]. The parts are separate pieces (`assembly: 'loose'`); with backlash the teeth do not
 * touch, with none they touch along the flanks.
 *
 * Deliberate differences from boxes.py (docs/differences.md): no profile shift, no undercut
 * (radial flanks below the base circle), no spokes; the bore is round, D-shaped or hex.
 */
import { BORE_SHAPES, bore, boreRadius, centreDistance, checkGear, gearDims, gearOutline, rackOutline, type BoreShape, type GearSpec } from '../core/gear';
import { bounds, mat3Multiply, mat3Rotate, mat3Translate, transform, type Path } from '../core/geometry';
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { commonParams, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { at, num } from './walls';

export const MECHANICAL_CATEGORY = 'Mechanical';

/** The material params (thickness, kerf, burn, units) without the finger-joint settings. */
export const materialParams: Schema = commonParams.filter((d) => ['thickness', 'kerf', 'burn', 'units'].includes(d.key));

/** Bore params shared by the round parts (gears, pulleys, knobs). */
export const boreParams = (d: number): Schema => [
  { key: 'bore', label: 'Bore', help: 'Shaft hole: round, D-shaped (one flat, 0.1 x diameter deep) or hexagonal (diameter across flats)',
    group: 'Shaft', kind: 'enum', options: [...BORE_SHAPES], default: 'round' },
  { key: 'bore_d', label: 'Bore diameter', help: 'Shaft diameter (hex: across the flats)', unit: 'mm', group: 'Shaft', kind: 'number', min: 1, max: 60, default: d, step: 0.1 },
];

const schema: Schema = [
  { key: 'module', label: 'Module', help: 'Tooth size: pitch diameter / teeth (mm). Meshing gears need the same module', unit: 'mm',
    group: 'Gear', kind: 'number', min: 0.5, max: 8, default: 2, step: 0.1 },
  { key: 'teeth', label: 'Teeth', help: 'Number of teeth of the (first) gear', unit: '', group: 'Gear', kind: 'int', min: 6, max: 150, default: 20 },
  { key: 'teeth2', label: 'Second gear teeth', help: 'Teeth of a second gear meshing with the first (0: a single gear)', unit: '',
    group: 'Gear', kind: 'int', min: 0, max: 150, default: 0 },
  { key: 'pressure_angle', label: 'Pressure angle', help: 'Tooth flank angle; 20 degrees is standard, 14.5 older, 25 stronger teeth', unit: 'deg',
    group: 'Gear', kind: 'number', min: 14.5, max: 30, default: 20, step: 0.5 },
  { key: 'backlash', label: 'Backlash', help: 'Play between meshing teeth along the pitch circle (each gear\'s teeth are thinned by half)', unit: 'mm',
    group: 'Gear', kind: 'number', min: 0, max: 0.5, default: 0.1, step: 0.01 },
  { key: 'rack_length', label: 'Rack length', help: 'Length of a straight rack meshing with the first gear below it, running to the left (0: no rack)', unit: 'mm',
    group: 'Rack', kind: 'number', min: 0, max: 600, default: 0, step: 1 },
  { key: 'rack_height', label: 'Rack body', help: 'Height of the rack\'s body below the tooth roots', unit: 'mm', group: 'Rack', kind: 'number', min: 3, max: 50, default: 8, step: 0.5 },
  ...boreParams(5),
  { key: 'bore2_d', label: 'Second bore', help: 'Shaft diameter of the second gear (same shape)', unit: 'mm', group: 'Shaft', kind: 'number', min: 1, max: 60, default: 5, step: 0.1 },
  ...materialParams,
];

const spec = (p: Params, teeth: number): GearSpec =>
  ({ module: num(p, 'module'), teeth, pressureAngle: num(p, 'pressure_angle'), backlash: num(p, 'backlash') });

/** Checks a bore fits inside a gear's root circle with 1 mm (or 0.1 m) of material; ParamError names `key`. */
export function checkBore(shape: BoreShape, d: number, rf: number, key: string): void {
  const r = boreRadius(shape, d);
  const min = Math.max(1, 0.1 * rf);
  if (shape !== 'none' && !(r + min <= rf))
    throw new ParamError(`${key} too large: a ${d} mm bore leaves less than ${min.toFixed(1)} mm below the teeth (root radius ${rf.toFixed(2)} mm)`, key);
}

/** Nominal outlines and holes of the gear(s), in world xy (gear 1 at the origin). */
function gears(p: Params): { id: string; name: string; outline: Path; holes: Path[] }[] {
  const z1 = num(p, 'teeth');
  const z2 = num(p, 'teeth2');
  const shape = p.bore as BoreShape;
  const out = [];
  const g1 = spec(p, z1);
  checkGear(g1, { teeth: 'teeth', backlash: 'backlash', module: 'module' });
  checkBore(shape, num(p, 'bore_d'), gearDims(g1).rf, 'bore_d');
  const b1 = bore(shape, num(p, 'bore_d'));
  out.push({ id: 'gear1', name: `Gear ${z1} teeth`, outline: gearOutline(g1, 24, effectiveKerf(p)), holes: b1 ? [b1] : [] });
  if (z2 > 0) {
    const g2 = spec(p, z2);
    checkGear(g2, { teeth: 'teeth2', backlash: 'backlash', module: 'module' });
    checkBore(shape, num(p, 'bore2_d'), gearDims(g2).rf, 'bore2_d');
    const a = centreDistance(g1.module, z1, z2);
    const m = mat3Multiply(mat3Translate(a, 0), mat3Rotate(180 - 180 / z2));
    const b2 = bore(shape, num(p, 'bore2_d'));
    out.push({ id: 'gear2', name: `Gear ${z2} teeth`, outline: transform(gearOutline(g2, 24, effectiveKerf(p)), m), holes: b2 ? [transform(b2, m)] : [] });
  }
  const L = num(p, 'rack_length');
  if (L > 0) {
    // Rack under gear 1, pitch line tangent to its pitch circle at (0, -r). The gear tooth nearest
    // the bottom (angle -90 degrees) sits at pitch-line position s; the rack's gap is centred there.
    const { r } = gearDims(g1);
    const m = g1.module;
    if (!(L >= 3 * Math.PI * m)) throw new ParamError(`rack_length too short: a rack needs at least 3 teeth (${(3 * Math.PI * m).toFixed(1)} mm)`, 'rack_length');
    const k = Math.round((-Math.PI / 2) / ((2 * Math.PI) / z1));
    const s = r * ((2 * Math.PI * k) / z1 + Math.PI / 2);
    // The rack runs to the left (away from gear 2), 2 m past the contact point on the right.
    const rack = rackOutline(g1, 2 * m - L, 2 * m, -r, s, num(p, 'rack_height'));
    if (z2 > 0) {
      // Gear 2 (centre (a, 0)) must clear the rack's box.
      const a = centreDistance(m, z1, z2);
      const ra2 = gearDims(spec(p, z2)).ra;
      const dx = Math.max(0, a - 2 * m);
      const dy = Math.max(0, r - m); // the rack's top (tooth tips) is r - m below the gears' centres
      if (!(Math.hypot(dx, dy) > ra2 + 0.5))
        throw new ParamError('rack_length too long: the rack would run into the second gear', 'rack_length');
    }
    out.push({ id: 'rack', name: `Rack ${L} mm`, outline: rack, holes: [] });
  }
  return out;
}

function build(p: Params): Part[] {
  const t = num(p, 'thickness');
  const kerf = effectiveKerf(p);
  return gears(p).map((g) => finishWithKerf({ ...g, engrave: [], placement: at([0, 0, 0], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [] }, kerf));
}

export const gearsGenerator: Generator = {
  id: 'gears',
  name: 'Gears',
  category: MECHANICAL_CATEGORY,
  description: 'Involute spur gear, meshing gear pair and/or straight rack: module, teeth, pressure angle, backlash, round / D / hex shaft bore (Gears).',
  schema,
  presets: {
    'Gear pair 1:2': { module: 2, teeth: 15, teeth2: 30, pressure_angle: 20, backlash: 0.1, bore: 'round', bore_d: 5, bore2_d: 8 },
    'Small motor pinion (D-shaft)': { module: 1, teeth: 12, teeth2: 0, pressure_angle: 20, bore: 'd', bore_d: 5 },
    'Hex-bore gear': { module: 3, teeth: 24, teeth2: 0, bore: 'hex', bore_d: 8, thickness: 6 },
    'Rack and pinion': { module: 2, teeth: 12, teeth2: 0, rack_length: 150, rack_height: 10, bore: 'd', bore_d: 5 },
  },
  build,
  assembly: 'loose',
  expectedSize: (p) => {
    const bs = gears(p).map((g) => bounds(g.outline));
    const x = Math.max(...bs.map((b) => b.max.x)) - Math.min(...bs.map((b) => b.min.x));
    const y = Math.max(...bs.map((b) => b.max.y)) - Math.min(...bs.map((b) => b.min.y));
    return { x, y, z: num(p, 'thickness') };
  },
};
