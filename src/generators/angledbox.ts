/**
 * AngledBox: a box whose two ends are cornered (half polygons), ported from boxes.py
 * (florianfesti/boxes, boxes/generators/angledbox.py). The floor is a (2n + 2)-gon with apothem
 * y/2 stretched along x: sides lx, n x side, lx, n x side, every corner turning 360 / (2n + 2)
 * degrees. Walls meet with angled finger joints (boxes.py FingerJointSettings angle, edges 'g'/'G')
 * and stand in notched floor/top plates; see polygonbox.ts for the joints and the world frame.
 *
 * Deliberate differences from boxes.py (docs/differences.md): the walls' fingers go into notched
 * plates (boxes.py: floor fingers into the walls' bottom edge); every wall has the same 'g'..'G'
 * ends; top styles reduced to none / closed / rim; when x < y the cornered ends are along y (boxes.py
 * swaps x and y, so its x is always the long side); the outer
 * size is exact (a polygon corner at the x extremes, even n, adds t / cos(180 / (2n + 2)), not t).
 */
import type { Vec2 } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { prismBox } from './polygonbox';
import { num } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Length', help: 'Size along x (inner or outer, see "Inner dimensions"); the cornered ends are on the longer of x and y', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 150, step: 1 },
  { key: 'y', label: 'Width', help: 'Width along y (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 60, step: 1 },
  { key: 'n', label: 'Walls per end', help: 'Number of angled walls at each end (1 is a plain rectangle)', unit: '',
    group: 'Size', kind: 'int', min: 1, max: 8, default: 5 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'bottom', label: 'Bottom', help: 'Finger-jointed floor, or none', group: 'Box',
    kind: 'enum', options: ['closed', 'none'], default: 'closed' },
  { key: 'top', label: 'Top', help: 'Open, a closed top plate, or a top rim one thickness wide', group: 'Box',
    kind: 'enum', options: ['none', 'closed', 'hole'], default: 'none' },
  ...commonParams,
];

const wallsPerEnd = (p: Params): number => {
  const n = num(p, 'n');
  if (!(Number.isInteger(n) && n >= 1)) throw new ParamError('n must be a positive integer', 'n');
  return n;
};

/** How far the outer outline reaches past the inner one at the x extremes (a side for odd n, a corner for even n). */
const xReach = (n: number, t: number): number => (n % 2 ? t : t / Math.cos(Math.PI / (2 * n + 2)));

const plates = (p: Params): number => (p.bottom === 'none' ? 0 : 1) + (p.top === 'none' ? 0 : 1);

/**
 * Inner size along the box's long axis (`long`, where the cornered ends are) and across it
 * (`short`), plus whether the long axis is world y (x < y; boxes.py swaps x and y instead).
 */
function inner(p: Params): { long: number; short: number; h: number; alongY: boolean } {
  const t = num(p, 'thickness');
  const n = wallsPerEnd(p);
  const alongY = num(p, 'y') > num(p, 'x');
  const L = alongY ? num(p, 'y') : num(p, 'x');
  const S = alongY ? num(p, 'x') : num(p, 'y');
  if (p.inside !== false) return { long: L, short: S, h: num(p, 'h'), alongY };
  return { long: L - 2 * xReach(n, t), short: S - 2 * t, h: num(p, 'h') - plates(p) * t, alongY };
}

/** boxes.py AngledBox.floor: the inner polygon, CCW, starting at the front-left corner of the front side. */
export function angledFloor(x: number, y: number, n: number): { pts: Vec2[]; lx: number; side: number } {
  const m = 2 * n + 2;
  const hp = y / 2; // apothem
  const side = 2 * Math.tan(Math.PI / m) * hp;
  const r = Math.hypot(side / 2, hp);
  const lx = n % 2 ? x - 2 * hp + side : x - 2 * r + side;
  const lens = [lx, ...Array<number>(n).fill(side), lx, ...Array<number>(n).fill(side)];
  const pts: Vec2[] = [];
  let px = 0;
  let py = 0;
  lens.forEach((l, k) => {
    pts.push({ x: px, y: py });
    const a = (2 * Math.PI * k) / m;
    px += l * Math.cos(a);
    py += l * Math.sin(a);
  });
  return { pts, lx, side };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const n = wallsPerEnd(p);
  const i = inner(p);
  const L = i.long + 2 * xReach(n, t);
  const S = i.short + 2 * t;
  return { x: i.alongY ? S : L, y: i.alongY ? L : S, z: i.h + plates(p) * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const n = wallsPerEnd(p);
  const { long, short, h, alongY } = inner(p);
  const [kl, ks] = alongY ? ['y', 'x'] : ['x', 'y'];
  if (!(short > 0)) throw new ParamError(`${ks} too small for the wall thickness`, ks);
  const f = angledFloor(long, short, n);
  if (!(f.lx > 3 * ctx.thickness))
    throw new ParamError(`${kl} too small: the long walls would be ${f.lx.toFixed(2)} mm wide, need at least 3 * thickness`, kl);
  // Long axis along world y: turn the floor a quarter turn (still CCW).
  const pts = alongY ? f.pts.map((q) => ({ x: -q.y, y: q.x })) : f.pts;
  const ends = (k: number): boolean => k !== 0 && k !== n + 1;
  return prismBox({
    inner: pts, h, ctx, kerf: effectiveKerf(p),
    bottom: p.bottom === 'none' ? 'none' : 'closed',
    top: p.top === 'closed' ? 'closed' : p.top === 'hole' ? 'hole' : 'none',
    keys: { side: (k) => (ends(k) ? 'n' : kl), h: 'h', corners: 'n' },
    wallName: (k) => (k === 0 ? 'Front wall' : k === n + 1 ? 'Back wall' : `End wall ${k < n + 1 ? k : k - 1}`),
  });
}

export const angledBox: Generator = {
  id: 'angledbox',
  name: 'Angled box',
  category: 'Polygon & special',
  description: 'Box with both ends cornered: half-polygon ends with angled finger joints at every corner.',
  schema,
  presets: {
    'Pencil case': { x: 200, y: 60, h: 40, n: 3, inside: true, bottom: 'closed', top: 'closed' },
    Planter: { x: 300, y: 150, h: 120, n: 2, inside: false, bottom: 'closed', top: 'hole' },
    Tray: { x: 160, y: 100, h: 35, n: 5, inside: true, bottom: 'closed', top: 'none' },
  },
  build,
  expectedSize,
};
