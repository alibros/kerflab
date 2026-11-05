/**
 * Planetary gear set: a sun gear, `planets` equal planet gears and an internal ring gear, shown
 * meshed in one plane. Generic version of boxes.py (florianfesti/boxes) Planetary (planetary.py);
 * the involute geometry, including the ring's internal teeth, is in src/core/gear.ts.
 *
 * Ring teeth = sun + 2 x planet. The planets sit at the centre distance m (sun + planet) / 2, at
 * the meshing positions (multiples of 360 / (sun + ring) degrees) nearest to even spacing: evenly
 * spaced when sun + ring divides by the number of planets (the assembly condition); each planet is turned to mesh with the sun and the ring is turned to mesh with the
 * first planet (the condition makes it mesh with all). An optional carrier plate with a hole for
 * each planet's axle is stacked underneath (one thickness below the gears, so the gear train stays
 * in view from above). Separate pieces:
 * `assembly: 'loose'`.
 *
 * World frame: the sun centred on the origin with a tooth on +x, planet 1 on the +x axis; gears in
 * z in [0, t], the carrier in z in [-t, 0].
 */
import { bore, centreDistance, checkGear, checkRing, gearDims, gearOutline, ringDims, ringHole, type BoreShape, type GearSpec } from '../core/gear';
import { mat3Multiply, mat3Rotate, mat3Translate, transform, type Path } from '../core/geometry';
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { boreParams, checkBore, materialParams, MECHANICAL_CATEGORY } from './gears';
import { at, circle, num } from './walls';

const schema: Schema = [
  { key: 'module', label: 'Module', help: 'Tooth size: pitch diameter / teeth (mm)', unit: 'mm', group: 'Gears', kind: 'number', min: 1, max: 5, default: 1.5, step: 0.1 },
  { key: 'sun', label: 'Sun teeth', help: 'Teeth of the sun gear in the middle', unit: '', group: 'Gears', kind: 'int', min: 8, max: 60, default: 12 },
  { key: 'planet', label: 'Planet teeth', help: 'Teeth of each planet gear (the ring gets sun + 2 x planet teeth)', unit: '', group: 'Gears', kind: 'int', min: 8, max: 36, default: 18 },
  { key: 'planets', label: 'Planets', help: 'Number of planet gears; they are evenly spaced when sun + ring teeth divide by it, else as close to it as the teeth allow', unit: '', group: 'Gears', kind: 'int', min: 1, max: 4, default: 3 },
  { key: 'pressure_angle', label: 'Pressure angle', help: 'Tooth flank angle; 20 degrees is standard', unit: 'deg', group: 'Gears', kind: 'number', min: 14.5, max: 25, default: 20, step: 0.5 },
  { key: 'backlash', label: 'Backlash', help: 'Play between meshing teeth along the pitch circle', unit: 'mm', group: 'Gears', kind: 'number', min: 0.05, max: 0.5, default: 0.1, step: 0.01 },
  { key: 'rim', label: 'Ring rim', help: 'Width of the ring gear\'s rim outside its tooth roots', unit: 'mm', group: 'Gears', kind: 'number', min: 2, max: 40, default: 6, step: 0.5 },
  { key: 'carrier', label: 'Carrier plate', help: 'Plate stacked under the gears with an axle hole for each planet (and the output shaft)', group: 'Gears', kind: 'bool', default: true },
  ...boreParams(5).map((d) => (d.key === 'bore_d' && d.kind === 'number' ? { ...d, max: 20 } : d)),
  { key: 'axle_d', label: 'Planet axle', help: 'Diameter of the planets\' axle holes (in the planets and the carrier)', unit: 'mm', group: 'Shaft', kind: 'number', min: 1, max: 8, default: 3, step: 0.1 },
  ...materialParams,
];

type Piece = { id: string; name: string; outline: Path; holes: Path[]; z: number };

function layout(p: Params): { pieces: Piece[]; R: number } {
  const zs = num(p, 'sun');
  const zp = num(p, 'planet');
  const zr = zs + 2 * zp;
  const n = num(p, 'planets');
  const g = (z: number): GearSpec => ({ module: num(p, 'module'), teeth: z, pressureAngle: num(p, 'pressure_angle'), backlash: num(p, 'backlash') });
  const gs = g(zs);
  const gp = g(zp);
  const gr = g(zr);
  checkGear(gs, { teeth: 'sun', backlash: 'backlash', module: 'module' });
  checkGear(gp, { teeth: 'planet', backlash: 'backlash', module: 'module' });
  checkRing(gr, zp, { teeth: 'planet', pinion: 'sun' });
  const m = num(p, 'module');
  const a = centreDistance(m, zs, zp);
  const rp = gearDims(gp);
  // Planets can only mesh with both the sun and the ring at multiples of 2 pi / (sun + ring): each
  // goes to the allowed angle nearest to even spacing (exactly even when sun + ring divides by n).
  const step = (2 * Math.PI) / (zs + zr);
  const angles = Array.from({ length: n }, (_, j) => Math.round((j * (zs + zr)) / n) * step);
  const gapMin = Math.min(...angles.map((th, j) => (j + 1 < n ? angles[j + 1]! : angles[0]! + 2 * Math.PI) - th));
  if (n > 1 && !(2 * a * Math.sin(gapMin / 2) > 2 * rp.ra + 1))
    throw new ParamError(`planets: ${n} planets of ${zp} teeth collide; use fewer planets or a larger sun`, 'planets');
  const shape = p.bore as BoreShape;
  checkBore(shape, num(p, 'bore_d'), gearDims(gs).rf, 'bore_d');
  const ad = num(p, 'axle_d');
  if (!(ad / 2 + Math.max(1, 0.1 * rp.rf) <= rp.rf)) throw new ParamError(`axle_d too large for the ${zp}-tooth planets`, 'axle_d');
  const pieces: Piece[] = [];
  const sb = bore(shape, num(p, 'bore_d'));
  pieces.push({ id: 'sun', name: `Sun ${zs} teeth`, outline: gearOutline(gs, 24, effectiveKerf(p)), holes: sb ? [sb] : [], z: 0 });
  // Planet j at angle th: the sun tooth nearest th is d off it (sun angle); rolling, the planet's
  // gap facing the sun is offset by -d rs / rp (planet angle) from th + pi.
  const pitchS = (2 * Math.PI) / zs;
  const pitchP = (2 * Math.PI) / zp;
  const rs = gearDims(gs).r;
  const rpp = rp.r;
  const turns: number[] = [];
  for (let j = 0; j < n; j++) {
    const th = angles[j]!;
    const d = Math.round(th / pitchS) * pitchS - th;
    const gamma = th + Math.PI - (d * rs) / rpp - pitchP / 2; // planet rotation: tooth 0 at gamma
    turns.push(gamma);
    const mt = mat3Multiply(mat3Translate(a * Math.cos(th), a * Math.sin(th)), mat3Rotate((gamma * 180) / Math.PI));
    pieces.push({ id: `planet${j + 1}`, name: `Planet ${zp} teeth`, outline: transform(gearOutline(gp, 24, effectiveKerf(p)), mt), holes: [transform(circle(0, 0, ad / 2), mt)], z: 0 });
  }
  // Ring: a space must face planet 1's tooth nearest +x (planet 1 sits on the +x axis).
  const e = ((((0 - turns[0]!) % pitchP) + pitchP) % pitchP); // planet angle from its tooth to +x
  const eps = e > pitchP / 2 ? e - pitchP : e; // nearest tooth is at -eps from +x (planet angle)
  const beta = (-eps * rpp) / gearDims(gr).r;
  const R = ringDims(gr).ro + num(p, 'rim');
  pieces.push({ id: 'ring', name: `Ring ${zr} teeth`, outline: circle(0, 0, R), holes: [transform(ringHole(gr), mat3Rotate((beta * 180) / Math.PI))], z: 0 });
  if (p.carrier === true) {
    const cr = a + rp.ra; // covers the planets
    const holes: Path[] = [];
    for (let j = 0; j < n; j++) {
      const th = angles[j]!;
      holes.push(circle(a * Math.cos(th), a * Math.sin(th), ad / 2));
    }
    if (sb) holes.push(sb);
    pieces.push({ id: 'carrier', name: 'Carrier', outline: circle(0, 0, cr), holes, z: -1 });
  }
  return { pieces, R };
}

function build(p: Params): Part[] {
  const t = num(p, 'thickness');
  const kerf = effectiveKerf(p);
  return layout(p).pieces.map((q) => finishWithKerf({ id: q.id, name: q.name, outline: q.outline, holes: q.holes, engrave: [],
    placement: at([0, 0, q.z * t], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [] }, kerf));
}

export const planetary: Generator = {
  id: 'planetary',
  name: 'Planetary gears',
  category: MECHANICAL_CATEGORY,
  description: 'Planetary (epicyclic) gear set: sun, planets and an internal ring gear with involute teeth, plus a planet carrier plate (Planetary).',
  schema,
  presets: {
    'Planetary 12 / 18 / 48 (3 planets)': { module: 1.5, sun: 12, planet: 18, planets: 3 },
    'Reduction 1:5 (4 planets)': { module: 1, sun: 16, planet: 24, planets: 4, bore: 'd', bore_d: 5 },
  },
  build,
  assembly: 'loose',
  expectedSize: (p) => {
    const R = layout(p).R;
    return { x: 2 * R, y: 2 * R, z: (p.carrier === true ? 2 : 1) * num(p, 'thickness') };
  },
};
