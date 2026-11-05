/**
 * Gearbox: a folded reduction gear train in a stack of plates, after boxes.py GearBox
 * (florianfesti/boxes, boxes/generators/gearbox.py). Every stage is a pinion meshing with a wheel;
 * the wheel of one stage is glued to the pinion of the next on the same axle, and the axles
 * alternate between two shafts A (x = 0) and B (x = a, the centre distance m (pinion + wheel) / 2),
 * so the train folds back and forth between them. Total ratio (wheel / pinion) ^ stages.
 *
 * Parts, bottom up (`assembly: 'loose'`, a stack of plates along z, each one thickness):
 *    bottom plate   rectangle with both shaft holes and the corner bolt holes
 *    stage k        a frame (the same rectangle with the gear cavity cut out: an obround around
 *                   both shafts, the larger tip radius plus clearance) holding pinion k on shaft
 *                   A (k even) or B (k odd) and wheel k on the other shaft, meshed
 *    top plate      as the bottom plate
 * Bolts through the corners hold the stack together; the shafts are rods (or bolts) through the
 * gear bores and plate holes.
 *
 * World frame: shaft A on the z axis, shaft B on +x at x = a, the bottom plate in z in [0, t].
 *
 * Deliberate differences from boxes.py: the gears sit in spacer frames (boxes.py: gears and side
 * plates only, spaced by the user); one thickness per gear.
 */
import { centreDistance, checkGear, gearDims, gearOutline, type GearSpec } from '../core/gear';
import { mat3Multiply, mat3Rotate, mat3Translate, transform, type Path } from '../core/geometry';
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { checkBore, materialParams, MECHANICAL_CATEGORY } from './gears';
import { at, circle, num, roundedRect } from './walls';

const schema: Schema = [
  { key: 'module', label: 'Module', help: 'Tooth size: pitch diameter / teeth (mm)', unit: 'mm', group: 'Gears', kind: 'number', min: 0.8, max: 5, default: 1.5, step: 0.1 },
  { key: 'pinion', label: 'Pinion teeth', help: 'Teeth of the small (driving) gear of each stage', unit: '', group: 'Gears', kind: 'int', min: 8, max: 40, default: 10 },
  { key: 'wheel', label: 'Wheel teeth', help: 'Teeth of the large (driven) gear of each stage; the ratio per stage is wheel / pinion', unit: '', group: 'Gears', kind: 'int', min: 8, max: 100, default: 30 },
  { key: 'stages', label: 'Stages', help: 'Number of reduction stages (total ratio (wheel / pinion) ^ stages)', unit: '', group: 'Gears', kind: 'int', min: 1, max: 6, default: 3 },
  { key: 'pressure_angle', label: 'Pressure angle', help: 'Tooth flank angle; 20 degrees is standard', unit: 'deg', group: 'Gears', kind: 'number', min: 14.5, max: 25, default: 20, step: 0.5 },
  { key: 'backlash', label: 'Backlash', help: 'Play between meshing teeth along the pitch circle', unit: 'mm', group: 'Gears', kind: 'number', min: 0.05, max: 0.5, default: 0.1, step: 0.01 },
  { key: 'shaft', label: 'Shaft diameter', help: 'Diameter of the shaft holes in the gears and plates', unit: 'mm', group: 'Housing', kind: 'number', min: 1, max: 20, default: 4, step: 0.1 },
  { key: 'clearance', label: 'Gear clearance', help: 'Space between the gear tips and the frames\' cavity', unit: 'mm', group: 'Housing', kind: 'number', min: 0.5, max: 10, default: 2, step: 0.5 },
  { key: 'border', label: 'Border', help: 'Width of the frame round the gear cavity (the bolts sit in its corners)', unit: 'mm', group: 'Housing', kind: 'number', min: 5, max: 40, default: 10, step: 0.5 },
  { key: 'bolt', label: 'Bolt holes', help: 'Diameter of the corner bolt holes (0: none)', unit: 'mm', group: 'Housing', kind: 'number', min: 0, max: 10, default: 3.5, step: 0.1 },
  ...materialParams,
];

const spec = (p: Params, teeth: number): GearSpec =>
  ({ module: num(p, 'module'), teeth, pressureAngle: num(p, 'pressure_angle'), backlash: num(p, 'backlash') });

/** Closed CCW obround: the convex hull of circles of radius r about (0, 0) and (a, 0). */
function obround(a: number, r: number): Path {
  const t = new Turtle({ x: 0, y: -r });
  t.forward(a);
  t.arc(r, 180);
  t.forward(a);
  t.arc(r, 180);
  return t.toPath(true);
}

/** Centre distance, cavity radius and the plate rectangle [x0, x1] x [-h, h]. */
function dims(p: Params): { a: number; rc: number; x0: number; x1: number; h: number } {
  const z1 = num(p, 'pinion');
  const z2 = num(p, 'wheel');
  const a = centreDistance(num(p, 'module'), z1, z2);
  const ra = Math.max(gearDims(spec(p, z1)).ra, gearDims(spec(p, z2)).ra);
  const rc = ra + num(p, 'clearance');
  const b = num(p, 'border');
  return { a, rc, x0: -rc - b, x1: a + rc + b, h: rc + b };
}

function build(p: Params): Part[] {
  const t = num(p, 'thickness');
  const kerf = effectiveKerf(p);
  const z1 = num(p, 'pinion');
  const z2 = num(p, 'wheel');
  const n = num(p, 'stages');
  const g1 = spec(p, z1);
  const g2 = spec(p, z2);
  checkGear(g1, { teeth: 'pinion', backlash: 'backlash', module: 'module' });
  checkGear(g2, { teeth: 'wheel', backlash: 'backlash', module: 'module' });
  const shaft = num(p, 'shaft');
  checkBore('round', shaft, Math.min(gearDims(g1).rf, gearDims(g2).rf), 'shaft');
  const { a, rc, x0, x1, h } = dims(p);
  const b = num(p, 'border');
  const bolt = num(p, 'bolt');
  if (bolt > 0 && bolt + 2 > b) throw new ParamError(`bolt too large: a ${bolt} mm hole needs a border of at least ${(bolt + 2).toFixed(1)} mm`, 'bolt');
  const plate = roundedRect((x0 + x1) / 2, 0, x1 - x0, 2 * h, Math.min(b / 2, 5));
  const bolts: Path[] = bolt > 0
    ? [[x0 + b / 2, -h + b / 2], [x1 - b / 2, -h + b / 2], [x1 - b / 2, h - b / 2], [x0 + b / 2, h - b / 2]].map(([x, y]) => circle(x!, y!, bolt / 2))
    : [];
  const shafts = [circle(0, 0, shaft / 2), circle(a, 0, shaft / 2)];
  const parts: Part[] = [];
  const add = (id: string, name: string, outline: Path, holes: Path[], layer: number): void => {
    parts.push(finishWithKerf({ id, name, outline, holes, engrave: [], placement: at([0, 0, layer * t], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [] }, kerf));
  };
  add('bottom', 'Bottom plate', plate, [...shafts, ...bolts], 0);
  const pin = gearOutline(g1, 24, kerf);
  const whl = gearOutline(g2, 24, kerf);
  const hole = circle(0, 0, shaft / 2);
  for (let k = 0; k < n; k++) {
    const onA = k % 2 === 0; // pinion on shaft A, wheel on B (odd stages: the other way round)
    add(`frame${k + 1}`, `Stage ${k + 1} frame`, plate, [obround(a, rc), ...bolts], k + 1);
    // Shaft A side: tooth on +x for the pinion, a gap facing +x for the wheel; shaft B: turned 180.
    const mA = (z: number, gap: boolean): ReturnType<typeof mat3Rotate> => mat3Rotate(gap ? 180 / z : 0);
    const mB = (z: number, gap: boolean): ReturnType<typeof mat3Rotate> => mat3Multiply(mat3Translate(a, 0), mat3Rotate(180 - (gap ? 180 / z : 0)));
    const pm = onA ? mA(z1, false) : mB(z1, false);
    const wm = onA ? mB(z2, true) : mA(z2, true);
    add(`pinion${k + 1}`, `Stage ${k + 1} pinion (${z1} teeth)`, transform(pin, pm), [transform(hole, pm)], k + 1);
    add(`wheel${k + 1}`, `Stage ${k + 1} wheel (${z2} teeth)`, transform(whl, wm), [transform(hole, wm)], k + 1);
  }
  add('top', 'Top plate', plate, [...shafts, ...bolts], n + 1);
  return parts;
}

export const gearBox: Generator = {
  id: 'gearbox',
  name: 'Gearbox',
  category: MECHANICAL_CATEGORY,
  description: 'Folded multi-stage reduction gear train (pinion and wheel per stage on two alternating shafts) in a bolted stack of stage frames and end plates (GearBox).',
  schema,
  presets: {
    'GearBox (1:27, 3 stages)': { module: 1.5, pinion: 10, wheel: 30, stages: 3 },
    'Two stages 1:16': { module: 2, pinion: 12, wheel: 48, stages: 2, shaft: 5, thickness: 4 },
    'Small 4-stage (1:81)': { module: 1, pinion: 10, wheel: 30, stages: 4, shaft: 3, border: 8, bolt: 3 },
  },
  build,
  assembly: 'loose',
  expectedSize: (p) => {
    const { x0, x1, h } = dims(p);
    return { x: x1 - x0, y: 2 * h, z: (num(p, 'stages') + 2) * num(p, 'thickness') };
  },
  // The top plate and the stage frames would hide the gear train: draw them see-through.
  view: { ghost: (id) => id === 'top' || id.startsWith('frame') },
};
