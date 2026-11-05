/**
 * RegularBox: a box on a regular polygon with 4 to 12 sides, ported from boxes.py
 * (florianfesti/boxes, boxes/generators/regularbox.py). Walls meet at the polygon's corners with
 * angled finger joints (boxes.py FingerJointSettings angle = 360/n, edges 'g'/'G'), and stand in
 * notched polygon plates (bottom, optional top or top rim). See polygonbox.ts for the joints and
 * the world frame; the polygon has side 0 at the front (y min), centred on the origin.
 *
 * Deliberate differences from boxes.py (docs/differences.md): straight walls only (one radius,
 * no tapered radius_top), no lids (angled/round/bayonet), every wall has the same 'g'..'G' ends,
 * at least 4 sides (a triangle's 60 degree corners are too sharp for square-cut angled fingers).
 */
import type { Vec2 } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { outerFootprint, prismBox } from './polygonbox';
import { num } from './walls';

const schema: Schema = [
  { key: 'n', label: 'Sides', help: 'Number of sides of the polygon (4 to 12)', unit: '',
    group: 'Size', kind: 'int', min: 4, max: 12, default: 5 },
  { key: 'radius', label: 'Corner radius', help: 'Distance from the centre to a corner (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 500, default: 50, step: 1 },
  { key: 'h', label: 'Height', help: 'Height (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: radius and height are measured inside the walls. Off: outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'bottom', label: 'Bottom', help: 'Finger-jointed bottom plate, or none', group: 'Box',
    kind: 'enum', options: ['closed', 'none'], default: 'closed' },
  { key: 'top', label: 'Top', help: 'Open, a closed top plate, or a top rim one thickness wide', group: 'Box',
    kind: 'enum', options: ['none', 'closed', 'hole'], default: 'none' },
  ...commonParams,
];

const sides = (p: Params): number => {
  const n = num(p, 'n');
  if (!(Number.isInteger(n) && n >= 4 && n <= 12)) throw new ParamError('n must be an integer from 4 to 12', 'n');
  return n;
};

/** Inner corner radius and inner wall height. */
function inner(p: Params): { r: number; h: number } {
  const t = num(p, 'thickness');
  const n = sides(p);
  if (p.inside !== false) return { r: num(p, 'radius'), h: num(p, 'h') };
  const plates = (p.bottom === 'none' ? 0 : 1) + (p.top === 'none' ? 0 : 1);
  return { r: num(p, 'radius') - t / Math.cos(Math.PI / n), h: num(p, 'h') - plates * t };
}

/** Inner polygon: corner radius r, side 0 horizontal at the front, CCW about the origin. */
export function regularPolygon(n: number, r: number): Vec2[] {
  return Array.from({ length: n }, (_, k) => {
    const th = ((-90 - 180 / n + (360 * k) / n) * Math.PI) / 180;
    return { x: r * Math.cos(th), y: r * Math.sin(th) };
  });
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const n = sides(p);
  const i = inner(p);
  const f = outerFootprint(regularPolygon(n, i.r), t);
  const plates = (p.bottom === 'none' ? 0 : 1) + (p.top === 'none' ? 0 : 1);
  return { x: f.x, y: f.y, z: i.h + plates * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const n = sides(p);
  const { r, h } = inner(p);
  if (!(r > 0)) throw new ParamError('radius too small for the wall thickness', 'radius');
  return prismBox({
    inner: regularPolygon(n, r), h, ctx, kerf: effectiveKerf(p),
    bottom: p.bottom === 'none' ? 'none' : 'closed',
    top: p.top === 'closed' ? 'closed' : p.top === 'hole' ? 'hole' : 'none',
    keys: { side: () => 'radius', h: 'h', corners: 'n' },
  });
}

export const regularBox: Generator = {
  id: 'regularbox',
  name: 'Regular polygon box',
  category: 'Polygon & special',
  description: 'Box on a regular polygon (4 to 12 sides) with angled finger joints at the corners.',
  schema,
  presets: {
    Pentagon: { n: 5, radius: 50, h: 60, inside: true, bottom: 'closed', top: 'none' },
    'Hexagon tin': { n: 6, radius: 60, h: 80, inside: false, bottom: 'closed', top: 'closed' },
    'Octagon planter': { n: 8, radius: 90, h: 120, inside: false, bottom: 'closed', top: 'hole' },
  },
  build,
  expectedSize,
};
