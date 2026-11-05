/**
 * Hook: a J-shaped wall hook cut as one flat profile from thick stock (or several glued side by
 * side): a back strip with screw holes, a rounded bend, a mouth `depth` deep and a tip with a round
 * end. Generic stand-in for boxes.py (florianfesti/boxes) Hook (hooks.py, a box-shaped hook with a
 * rectangular mouth built from several plates); `count` hooks are cut at once (separate pieces,
 * `assembly: 'loose'`, laid side by side).
 *
 * Profile (x out from the wall, y up): back strip, half-circle bend `mouth` wide inside, tip
 * strip; see `profile`. `mount: pole` (boxes.py PoleHook) ends the back strip in a ring that slides
 * onto a pole or rail instead of the round end and screw holes.
 */
import { bounds } from '../core/geometry';
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { Turtle } from '../core/turtle';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { materialParams } from './gears';
import { at, circle, num } from './walls';
import { WALL_CATEGORY } from './wallholder';

const schema: Schema = [
  { key: 'back', label: 'Back length', help: 'Straight length of the back strip above the bend', unit: 'mm', group: 'Hook', kind: 'number', min: 10, max: 300, default: 50, step: 1 },
  { key: 'mouth', label: 'Mouth', help: 'Gap between the back and the tip (the bend is a half circle this wide inside)', unit: 'mm', group: 'Hook', kind: 'number', min: 8, max: 150, default: 26, step: 1 },
  { key: 'tip', label: 'Tip length', help: 'Straight length of the tip above the bend', unit: 'mm', group: 'Hook', kind: 'number', min: 0, max: 150, default: 15, step: 1 },
  { key: 'strip', label: 'Strip width', help: 'Width of the hook\'s material strip', unit: 'mm', group: 'Hook', kind: 'number', min: 8, max: 40, default: 14, step: 0.5 },
  { key: 'screw', label: 'Screw hole', help: 'Diameter of the screw holes in the back strip (0: none)', unit: 'mm', group: 'Hook', kind: 'number', min: 0, max: 6, default: 4, step: 0.1 },
  { key: 'count', label: 'Count', help: 'Number of hooks to cut', unit: '', group: 'Hook', kind: 'int', min: 1, max: 12, default: 2 },
  ...materialParams,
  { key: 'mount', label: 'Mount', help: 'Wall: a back strip with screw holes. Pole: a ring at the top of the back that slides onto a pole or rail (PoleHook)',
    group: 'Mount', kind: 'enum', options: ['wall', 'pole'], default: 'wall' },
  { key: 'pole_d', label: 'Pole diameter', help: 'Pole mount: diameter of the pole or rail the ring slides onto', unit: 'mm', group: 'Mount', kind: 'number', min: 8, max: 60, default: 25, step: 0.5 },
];

/**
 * Profile: back strip x in [0, s] rising `back` above the bend's centre, a half-circle bend (inner
 * radius mouth / 2, outer mouth / 2 + s) and the tip strip rising `tip` above it, both ending in a
 * round end of diameter s. Screw holes in the back strip (one, or two when it is long enough).
 */
function profile(p: Params) {
  const s = num(p, 'strip');
  const ri = num(p, 'mouth') / 2;
  const R = ri + s;
  const bk = num(p, 'back');
  const tp = num(p, 'tip');
  const tu = new Turtle({ x: 0, y: R + bk }, 270);
  tu.forward(bk);
  tu.arc(R, 180);
  tu.forward(tp);
  tu.arc(s / 2, 180);
  tu.forward(tp);
  tu.arc(ri, -180);
  tu.forward(bk);
  const holes = [];
  let width = 2 * R;
  if (p.mount === 'pole') {
    // Ring of outer radius Ro round a pole hole, centred above the back strip (whose top corners lie on it).
    const pr = num(p, 'pole_d') / 2;
    const Ro = pr + s;
    const k = Math.sqrt(Ro * Ro - (s * s) / 4);
    const beta = (Math.asin(s / (2 * Ro)) * 180) / Math.PI;
    if (s / 2 + Ro > 2 * R - s - 1 && !(tp + s / 2 + 1 <= bk))
      throw new ParamError(`tip too long for the pole ring: it reaches the ring (at most ${(bk - s / 2 - 1).toFixed(1)} mm, or make the mouth wider)`, 'tip');
    tu.turn((Math.atan2(s / 2, k) * 180) / Math.PI - 90);
    tu.arc(Ro, 360 - 2 * beta);
    holes.push(circle(s / 2, R + bk + k, pr));
    width = Math.max(2 * R, s / 2 + Ro) - Math.min(0, s / 2 - Ro);
    return { outline: tu.toPath(true), holes, width };
  }
  tu.arc(s / 2, 180);
  const outline = tu.toPath(true);
  const sd = num(p, 'screw');
  if (sd > 0) {
    if (!(sd + 2 <= s)) throw new ParamError(`screw too large for a ${s} mm strip (at most ${s - 2} mm)`, 'screw');
    if (!(bk >= sd + 2)) throw new ParamError(`back too short for a ${sd} mm screw hole`, 'back');
    const top = R + bk - sd / 2 - 1;
    holes.push(circle(s / 2, top, sd / 2));
    const low = R + sd / 2 + 1;
    if (top - low >= sd + 4) holes.push(circle(s / 2, low, sd / 2));
  }
  return { outline, holes, width };
}

function build(p: Params): Part[] {
  const t = num(p, 'thickness');
  const kerf = effectiveKerf(p);
  const { outline, holes } = profile(p);
  const pitch = profile(p).width + 3;
  return Array.from({ length: num(p, 'count') }, (_, k) => finishWithKerf({
    id: `hook${k + 1}`, name: `Hook ${k + 1}`, outline, holes, engrave: [],
    placement: at([k * pitch, 0, 0], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [],
  }, kerf));
}

export const hook: Generator = {
  id: 'hook',
  name: 'Hook',
  category: WALL_CATEGORY,
  description: 'J-shaped hook cut as a flat profile (glue several for a thicker hook), screwed to a wall or hung from a pole or rail by a ring: coats, towels, tools, cables (Hook, PoleHook).',
  schema,
  presets: {
    'Coat hook': { back: 60, mouth: 26, tip: 15, strip: 14, screw: 4, count: 2, thickness: 6 },
    'Towel hook (deep)': { back: 45, mouth: 45, tip: 10, strip: 12, screw: 4, count: 2 },
    'Cable hook': { back: 30, mouth: 20, tip: 10, strip: 10, screw: 3.5, count: 4 },
    'PoleHook (25 mm rail)': { back: 30, mouth: 30, tip: 12, strip: 12, count: 2, mount: 'pole', pole_d: 25, thickness: 6 },
  },
  build,
  assembly: 'loose',
  expectedSize: (p) => {
    const b = bounds(profile(p).outline);
    const n = num(p, 'count');
    return { x: (n - 1) * (profile(p).width + 3) + (b.max.x - b.min.x), y: b.max.y - b.min.y, z: num(p, 'thickness') };
  },
};
