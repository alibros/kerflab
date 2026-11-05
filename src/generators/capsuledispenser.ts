/**
 * Capsule dispenser: a wall-mounted (or under-shelf) dispenser for capsules or any round-rimmed
 * items that hang by their rim (coffee capsules, test tubes with caps, ...), ported from
 * boxes.py (florianfesti/boxes, boxes/generators/coffeecapsulesholder.py). Three plates are screwed
 * together: the back plate, a middle plate with one channel per column that is as wide as the
 * capsules' lids, and a front plate whose narrower channels hold the capsules by their lids while
 * the bodies poke through. Capsules go in at the round opening at the top of each front channel
 * and slide down.
 *
 * Layout (boxes.py): 7 mm outer margin, columns lid + 2 mm wide and 5 mm apart, rows + 0.6 capsule
 * pitches tall (room for the opening), 3 mm corner radius, screw holes 6 mm from the corners
 * (the front plate's are `screw_head` wide so the heads sink in).
 *
 * World frame: the plates stand in x-z planes against a wall at y = 0, back to front along +y,
 * x across, z up; outer size W x (2 or 3) t x H.
 *
 * Deliberate differences from boxes.py (docs/differences.md): screw sizes are params (boxes.py:
 * 7 mm front, 3.5 mm otherwise); impossible sizes raise errors.
 */
import type { Path, Vec2 } from '../core/geometry';
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { STORAGE_CATEGORY } from './storage';
import { rest } from './trays';
import { at, circle, finishPanels, num, panel, roundedRect, type PanelSpec } from './walls';

const MARGIN = 7;
const COL_SPACE = 5;
const CORNER = 3;
const SCREW_INSET = 6;
const EXTRA_ROWS = 0.6;

const schema: Schema = [
  { key: 'columns', label: 'Columns', help: 'Number of capsule columns', unit: '', group: 'Capsules', kind: 'int', min: 1, max: 8, default: 4 },
  { key: 'rows', label: 'Capsules per column', help: 'Number of capsules each column holds', unit: '', group: 'Capsules', kind: 'int', min: 1, max: 12, default: 5 },
  { key: 'lid_size', label: 'Lid diameter', help: 'Diameter of the capsules\' lids (rim)', unit: 'mm', group: 'Capsules', kind: 'number', min: 25, max: 60, default: 37, step: 0.5 },
  { key: 'body_size', label: 'Body width', help: 'Width of the capsules\' bodies just below the lid: the front channels are this wide', unit: 'mm',
    group: 'Capsules', kind: 'number', min: 10, max: 55, default: 30, step: 0.5 },
  { key: 'backplate', label: 'Back plate', help: 'Add a closed back plate (off: the middle plate goes straight onto the wall)', group: 'Mounting', kind: 'bool', default: true },
  { key: 'screw', label: 'Screw hole', help: 'Diameter of the screw holes in the back and middle plates', unit: 'mm', group: 'Mounting', kind: 'number', min: 2, max: 5, default: 3.5, step: 0.1 },
  { key: 'screw_head', label: 'Front screw hole', help: 'Diameter of the screw holes in the front plate (wide enough for the heads to sink in)', unit: 'mm',
    group: 'Mounting', kind: 'number', min: 2, max: 9, default: 7, step: 0.1 },
  ...commonParams,
];

type Layout = { W: number; H: number; D: number; lid: number; cols: number[]; yTop: number; yBot: number };

function layout(p: Params): Layout {
  const lid = num(p, 'lid_size');
  const D = lid + 2;
  const n = num(p, 'columns');
  const rows = num(p, 'rows') + EXTRA_ROWS;
  const W = n * (D + COL_SPACE) - COL_SPACE + 2 * MARGIN;
  const H = rows * lid + 2 * MARGIN;
  const cols = Array.from({ length: n }, (_, k) => MARGIN + k * (D + COL_SPACE) + D / 2);
  const yTop = MARGIN + (rows - 0.5) * lid;
  return { W, H, D, lid, cols, yTop, yBot: yTop - (rows - 1) * lid };
}

const arc = (to: Vec2, c: Vec2) => ({ t: 'A' as const, to, c, ccw: true });

/** Front channel: an opening of radius R at yTop over a channel w / 2 wide down to yBot (round end). */
function frontChannel(xc: number, yTop: number, yBot: number, R: number, w: number): Path {
  const hw = w / 2;
  const s = Math.sqrt(R * R - hw * hw);
  const top = { x: xc, y: yTop };
  const bot = { x: xc, y: yBot };
  return {
    start: { x: xc + hw, y: yBot }, closed: true,
    segs: [
      { t: 'L', to: { x: xc + hw, y: yTop - s } },
      arc({ x: xc, y: yTop + R }, top),
      arc({ x: xc - hw, y: yTop - s }, top),
      { t: 'L', to: { x: xc - hw, y: yBot } },
      arc({ x: xc, y: yBot - hw }, bot),
      arc({ x: xc + hw, y: yBot }, bot),
    ],
  };
}

/** Middle channel: a slot R wide (radius) from yBot to yTop with round ends. */
function middleChannel(xc: number, yTop: number, yBot: number, R: number): Path {
  const top = { x: xc, y: yTop };
  const bot = { x: xc, y: yBot };
  return {
    start: { x: xc + R, y: yBot }, closed: true,
    segs: [
      { t: 'L', to: { x: xc + R, y: yTop } },
      arc({ x: xc, y: yTop + R }, top),
      arc({ x: xc - R, y: yTop }, top),
      { t: 'L', to: { x: xc - R, y: yBot } },
      arc({ x: xc, y: yBot - R }, bot),
      arc({ x: xc + R, y: yBot }, bot),
    ],
  };
}

function build(p: Params): Part[] {
  const t = num(p, 'thickness');
  const L = layout(p);
  const R = L.D / 2;
  const body = num(p, 'body_size');
  if (!(body / 2 <= R - 1))
    throw new ParamError(`body_size too large: the front channels (${body.toFixed(1)} mm) must be narrower than the lids' channel (${L.D.toFixed(1)} mm) by 2 mm to hold the capsules`, 'body_size');
  const screw = num(p, 'screw');
  const head = num(p, 'screw_head');
  // A corner screw hole and the nearest channel end (centre (inset + 1 + R, inset + R) from the corner).
  const gap = Math.hypot(1 + R, R) - R;
  for (const [k, d] of [['screw', screw], ['screw_head', head]] as const)
    if (!(d / 2 + 1 <= gap) || !(d / 2 + 1 <= SCREW_INSET))
      throw new ParamError(`${k} too large: a ${d.toFixed(1)} mm screw hole ${SCREW_INSET} mm from the corner would run into a capsule channel or the edge (at most ${(2 * Math.min(gap, SCREW_INSET) - 2).toFixed(1)} mm)`, k);

  const outline = roundedRect(L.W / 2, L.H / 2, L.W, L.H, CORNER);
  const screws = (d: number): Path[] => [SCREW_INSET, L.W - SCREW_INSET].flatMap((x) => [SCREW_INSET, L.H - SCREW_INSET].map((y) => circle(x, y, d / 2)));
  const back = p.backplate !== false;
  const Y = (back ? 3 : 2) * t;
  // Back and middle plates: u = -x so their normal (+y) points away from the wall; the layout is
  // symmetric across x, so the channels and holes line up with the front plate's.
  const specs: PanelSpec[] = [];
  if (back) specs.push(panel('back', 'Back plate', { outline, holes: screws(screw), lines: [] }, at([L.W, 0, 0], [-1, 0, 0], [0, 0, 1]), []));
  const middle = panel('middle', 'Middle plate', { outline, holes: [...screws(screw), ...L.cols.map((c) => middleChannel(c, L.yTop, L.yBot, R))], lines: [] },
    at([L.W, back ? t : 0, 0], [-1, 0, 0], [0, 0, 1]), []);
  const front = panel('front', 'Front plate', { outline, holes: [...screws(head), ...L.cols.map((c) => frontChannel(c, L.yTop, L.yBot, R, body))], lines: [] },
    at([0, Y, 0], [1, 0, 0], [0, 0, 1]), []);
  specs.push(middle, front);
  // The plates rest on each other face to face; mates along their bottom edges.
  const line = (y: number): [Vec3, Vec3] => [[CORNER + 1, y, 0], [L.W - CORNER - 1, y, 0]];
  if (back) rest(specs[0]!, middle, ...line(t), 1, t, [true, false]);
  rest(middle, front, ...line(Y - t), 2, t, [true, true]);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const capsuleDispenser: Generator = {
  id: 'capsuledispenser',
  name: 'Capsule dispenser',
  category: STORAGE_CATEGORY,
  description: 'Wall or under-shelf dispenser for coffee capsules or other rimmed items: three screwed plates with channels they slide down (CoffeeCapsuleHolder).',
  schema,
  presets: {
    'CoffeeCapsuleHolder (Nespresso, 4 x 5)': { columns: 4, rows: 5, lid_size: 37, body_size: 30 },
    'Under-shelf, 6 x 4': { columns: 6, rows: 4, lid_size: 37, body_size: 30, backplate: false },
    'Dolce Gusto, 3 x 6': { columns: 3, rows: 6, lid_size: 53, body_size: 46, thickness: 4 },
  },
  build,
  expectedSize: (p) => {
    const L = layout(p);
    return { x: L.W, y: (p.backplate !== false ? 3 : 2) * num(p, 'thickness'), z: L.H };
  },
  // The capsule slots face +y (away from the default camera): look at that side.
  view: { turn: 180 },
};
