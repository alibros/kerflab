/**
 * Cradle rack: two cradle plates with a row of round hollows that round things lie in (bottles,
 * cans, rolls, tubes, pipes), held apart by two stretchers. Generic version of boxes.py
 * (florianfesti/boxes) BottleStack (bottlestack.py: a fridge bottle stacker; more bottles stack in
 * the hollows between those of the first row).
 *
 * Parts: cradle plates (W * height, show faces outwards) whose top edge is `count` circular hollows
 * of radius diameter / 2 + clearance, each a chord of 0.85 diameter wide, `web` apart; two stretchers
 * (vertical plates across the depth, `stretcher` high) under the outermost webs, fingered through
 * slot rows in both cradles.
 *
 * World frame: x along the row, y across (the items' axis), z up; outer size W, depth, height.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { STORAGE_CATEGORY } from './storage';
import { autoMate, slotInto } from './trays';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type CustomSide, type PanelSpec } from './walls';

const CHORD = 0.85; // hollow width as a fraction of the item diameter

const schema: Schema = [
  { key: 'count', label: 'Items', help: 'Number of hollows in a row', unit: '', group: 'Cradle', kind: 'int', min: 1, max: 12, default: 3 },
  { key: 'diameter', label: 'Diameter', help: 'Diameter of the items (bottle, can, roll)', unit: 'mm', group: 'Cradle', kind: 'number', min: 20, max: 200, default: 80, step: 1 },
  { key: 'clearance', label: 'Clearance', help: 'Extra radius of the hollows', unit: 'mm', group: 'Cradle', kind: 'number', min: 0, max: 10, default: 1, step: 0.5 },
  { key: 'web', label: 'Spacing', help: 'Width of the ridges between hollows and at the ends', unit: 'mm', group: 'Cradle', kind: 'number', min: 5, max: 60, default: 12, step: 0.5 },
  { key: 'depth', label: 'Depth', help: 'Distance between the two cradles\' outer faces', unit: 'mm', group: 'Cradle', kind: 'number', min: 40, max: 500, default: 120, step: 1 },
  { key: 'height', label: 'Height', help: 'Height of the cradles at the ridges', unit: 'mm', group: 'Cradle', kind: 'number', min: 20, max: 200, default: 50, step: 1 },
  { key: 'stretcher', label: 'Stretcher height', help: 'Height of the stretchers as a fraction of the material left below the hollows', unit: '',
    group: 'Cradle', kind: 'number', min: 0.3, max: 1, default: 0.8, step: 0.05 },
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

function dims(p: Params) {
  const n = num(p, 'count');
  const d = num(p, 'diameter');
  const R = d / 2 + num(p, 'clearance');
  const c = CHORD * d; // chord across the hollow at the ridge height
  const sag = R - Math.sqrt(R * R - (c / 2) ** 2);
  const web = num(p, 'web');
  return { n, R, c, sag, web, W: n * c + (n + 1) * web };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { n, R, c, sag, web, W } = dims(p);
  const H = num(p, 'height');
  const Y = num(p, 'depth');
  const below = H - sag; // material under the hollows' lowest point
  if (!(below >= 3 * t + 2)) throw new ParamError(`height too small: the hollows (${sag.toFixed(1)} mm deep) leave ${below.toFixed(1)} mm of cradle, needs ${(3 * t + 2).toFixed(1)} mm`, 'height');
  if (!(web >= 2 * t + 2)) throw new ParamError(`web too small: the end ridges carry the stretchers and need ${(2 * t + 2).toFixed(1)} mm`, 'web');
  const hs = num(p, 'stretcher') * (below - 1);
  requireJointLength('stretcher', hs, t, 'stretcher height');
  requireJointLength('depth', Y - 2 * t, t, 'inner depth');
  // Cradle top edge, travelling -x from the right end: web, hollow (an arc dipping sag), web, ...
  const ang = (2 * Math.asin(c / 2 / R) * 180) / Math.PI;
  const top: CustomSide = {
    start: 0, end: 0,
    draw: (tu) => {
      for (let k = 0; k < n; k++) {
        tu.forward(web);
        tu.turn(ang / 2); // left of travel is down, into the plate
        tu.arc(R, -ang);
        tu.turn(ang / 2);
      }
      tu.forward(web);
    },
  };
  // Cradle inner rectangle [0, W] x [0, H].
  const cradle = () => rectangularWall(W, H, ['flat', 'flat', top, 'flat'], ctx);
  // Show faces outwards: the front cradle's normal is +y, the back's -y (the profile is symmetric).
  const front = panel('front', 'Cradle', cradle(), at([W, 0, 0], [-1, 0, 0], [0, 0, 1]), []);
  const back = panel('back', 'Cradle', cradle(), at([0, Y, 0], [1, 0, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [front, back];
  // Stretchers under the end ridges: vertical plates across the depth, centred on the ridges.
  for (const [k, xc] of [[1, web / 2], [2, W - web / 2]] as const) {
    const st = panel(`stretcher${k}`, 'Stretcher', rectangularWall(Y - 2 * t, hs, ['flat', 'finger', 'flat', 'finger'], ctx),
      at([xc - t / 2, t, 1], [0, 1, 0], [0, 0, 1]), []);
    specs.push(st);
    slotInto(front, st, [3], ctx);
    slotInto(back, st, [1], ctx);
  }
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const cradleRack: Generator = {
  id: 'cradle',
  name: 'Cradle rack',
  category: STORAGE_CATEGORY,
  description: 'Two cradles with round hollows joined by stretchers, for bottles, cans, rolls or tubes lying down; more stack on top (BottleStack).',
  schema,
  presets: {
    'BottleStack (wine bottles)': { count: 3, diameter: 80, clearance: 1, web: 14, depth: 160, height: 50 },
    'Can rack': { count: 4, diameter: 66, clearance: 1, web: 10, depth: 100, height: 40 },
    'Paper roll cradle': { count: 1, diameter: 120, clearance: 3, web: 20, depth: 250, height: 70, thickness: 6 },
  },
  build,
  expectedSize: (p) => ({ x: dims(p).W, y: num(p, 'depth'), z: num(p, 'height') }),
};
