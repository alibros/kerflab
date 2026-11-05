/**
 * UnevenHeightBox: an open box with a different height at each corner (sloped top edges), ported
 * from boxes.py (florianfesti/boxes, boxes/generators/unevenheightbox.py).
 *
 * Edge assignment (bottom, right, top, left of each trapezoid wall; boxes.py UnevenHeightBox):
 *    front/back walls  x   [b, F, e, F]   own the vertical corner columns
 *    left/right walls  y   [b, f, e, f]   fingers into the front/back walls
 *    bottom            x * y   'ffff'     only with `bottom: 'closed'` (b = 'F', else 'e')
 * Each wall is a trapezoid whose left and right heights are the heights of the corners it spans;
 * the sloped top runs straight between them, and each corner column ends level with its corner.
 *
 * Corners: height0 front left (x = 0, y = 0), height1 front right, height2 back right, height3
 * back left. World frame: outer size [0, X] x [0, Y] x [0, Z], X = x + 2t, Y = y + 2t,
 * Z = max height (+ t with a bottom).
 *
 * Deliberate differences from boxes.py: no lid (`add_lid`, `lid_height`) and no grooved top edges
 * (`edge_types`); bottom is a finger-jointed panel or none.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type ParamDef, type Params, type Schema } from '../core/schema';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, trapezoidWall, type PanelSpec, type WallEdge } from './walls';

const CORNERS = ['front left', 'front right', 'back right', 'back left'];
const heightDef = (i: number, d: number): ParamDef => ({
  key: `height${i}`, label: `Height ${CORNERS[i]}`, help: `Height of the ${CORNERS[i]} corner (inner or outer, see "Inner dimensions")`,
  unit: 'mm', group: 'Size', kind: 'number', min: 10, max: 1000, default: d, step: 1,
});

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  heightDef(0, 50), heightDef(1, 50), heightDef(2, 100), heightDef(3, 100),
  { key: 'inside', label: 'Inner dimensions', help: 'On: sizes are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'bottom', label: 'Bottom', help: 'Finger-jointed bottom panel, or none', group: 'Box',
    kind: 'enum', options: ['closed', 'none'], default: 'closed' },
  ...commonParams,
];

function innerSize(p: Params): { x: number; y: number; hs: number[] } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  const dz = o && p.bottom !== 'none' ? t : 0;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), hs: [0, 1, 2, 3].map((i) => num(p, `height${i}`) - dz) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 2 * t, y: i.y + 2 * t, z: Math.max(...i.hs) + (p.bottom === 'none' ? 0 : t) };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, hs } = innerSize(p);
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  hs.forEach((h, i) => requireJointLength(`height${i}`, h, t, `inner height of the ${CORNERS[i]} corner`));
  const [h0, h1, h2, h3] = hs as [number, number, number, number];
  const bottom = p.bottom !== 'none';

  const X = x + 2 * t;
  const Y = y + 2 * t;
  const z0 = bottom ? t : 0;
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const b: WallEdge = bottom ? F : e;
  // trapezoidWall(w, left, right): left/right as seen from inside, i.e. local x = 0 / x = w
  const wall = (w: number, l: number, r: number, side: WallEdge) => trapezoidWall(w, l, r, [b, side, e, side], ctx);

  const panels: PanelSpec[] = [
    // local x = 0 at the front right corner
    panel('front', 'Front wall', wall(x, h1, h0, F), at([t + x, 0, z0], [-1, 0, 0], [0, 0, 1]),
      [bottom ? ['bottom', 0] : undefined, ['left', 3], undefined, ['right', 1]]),
    // local x = 0 at the back right corner
    panel('right', 'Right wall', wall(y, h2, h1, f), at([X, t + y, z0], [0, -1, 0], [0, 0, 1]),
      [bottom ? ['bottom', 1] : undefined, ['front', 3], undefined, ['back', 1]]),
    // local x = 0 at the back left corner
    panel('back', 'Back wall', wall(x, h3, h2, F), at([t, Y, z0], [1, 0, 0], [0, 0, 1]),
      [bottom ? ['bottom', 2] : undefined, ['right', 3], undefined, ['left', 1]]),
    // local x = 0 at the front left corner
    panel('left', 'Left wall', wall(y, h0, h3, f), at([0, t, z0], [0, 1, 0], [0, 0, 1]),
      [bottom ? ['bottom', 3] : undefined, ['back', 3], undefined, ['front', 1]]),
  ];
  if (bottom)
    panels.push(panel('bottom', 'Bottom', rectangularWall(x, y, [f, f, f, f], ctx), at([t, t, 0], [1, 0, 0], [0, 1, 0]),
      [['front', 0], ['right', 0], ['back', 0], ['left', 0]]));
  return finishPanels(panels, t, effectiveKerf(p));
}

export const unevenHeightBox: Generator = {
  id: 'unevenheightbox',
  name: 'Uneven height box',
  category: 'Boxes',
  description: 'Open box with a different height at each corner, so the top edges slope.',
  schema,
  presets: {
    'Magazine file': { x: 80, y: 240, height0: 120, height1: 120, height2: 300, height3: 300, inside: false, bottom: 'closed' },
    'Tool caddy': { x: 200, y: 120, height0: 60, height1: 120, height2: 120, height3: 60, inside: true, bottom: 'closed' },
  },
  build,
  expectedSize,
};
