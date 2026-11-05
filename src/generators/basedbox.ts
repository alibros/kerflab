/**
 * BasedBox: a closed box standing on a base plate that is one thickness wider all round, ported
 * from boxes.py (florianfesti/boxes, boxes/generators/basedbox.py).
 *
 * Edge assignment (bottom, right, top, left of each panel; boxes.py BasedBox):
 *    front/back walls  x * h   'fFFF'   fingers down through the base, own the vertical corners
 *    left/right walls  y * h   'ffFf'   fingers down through the base and into front/back
 *    base              x * y   'hhhh'   finger-hole edges: a brim of one thickness outside a row
 *                                       of slots that take the walls' bottom fingers
 *    top               x * y   'ffff'   (only with `top: 'closed'`)
 * With `top: 'none'` the walls' top sides are plain.
 *
 * World frame: the base occupies [0, X] x [0, Y] x [0, t] with X = x + 4t, Y = y + 4t; the walls
 * stand on it at [t, X - t] x [t, Y - t]. Inner space is [2t, 2t+x] x [2t, 2t+y] x [t, t+h].
 *
 * Deliberate differences from boxes.py: the brim (FingerJointSettings edge_width) is fixed at one
 * thickness; the lid choices of boxes.py `top_edge` are reduced to a finger-jointed top or none;
 * slots fit the fingers without extra play across the slot (see docs/differences.md).
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec, type WallEdge } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width of the box (walls, not the base) along x, inner or outer', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth of the box (walls, not the base) along y, inner or outer', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height including base and top (outer) or between them (inner)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside of the walls',
    group: 'Size', kind: 'bool', default: true },
  { key: 'top', label: 'Top', help: 'Closed top panel, or open at the top', group: 'Box',
    kind: 'enum', options: ['closed', 'none'], default: 'closed' },
  ...commonParams,
];

const zWalls = (p: Params): number => (p.top === 'none' ? 1 : 2);

function innerSize(p: Params): { x: number; y: number; h: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o ? zWalls(p) * t : 0) };
}

/** Bounding box: the base plate (walls plus a one-thickness brim) by the full height. */
function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 4 * t, y: i.y + 4 * t, z: i.h + zWalls(p) * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h } = innerSize(p);
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  requireJointLength('h', h, t);
  const top = p.top !== 'none';

  const X = x + 4 * t;
  const Y = y + 4 * t;
  const Z = h + (top ? 2 : 1) * t;
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const H: WallEdge = 'fingerHoles';
  const rim: WallEdge = top ? F : 'flat';
  const wall = (w: number, hh: number, types: [WallEdge, WallEdge, WallEdge, WallEdge]) => rectangularWall(w, hh, types, ctx);

  // Walls stand on the base (z = t) with their bottom fingers through its slots.
  const panels: PanelSpec[] = [
    panel('front', 'Front wall', wall(x, h, [f, F, rim, F]), at([2 * t + x, t, t], [-1, 0, 0], [0, 0, 1]),
      [['base', 0], ['left', 3], top ? ['top', 2] : undefined, ['right', 1]]),
    panel('right', 'Right wall', wall(y, h, [f, f, rim, f]), at([X - t, 2 * t + y, t], [0, -1, 0], [0, 0, 1]),
      [['base', 1], ['front', 3], top ? ['top', 1] : undefined, ['back', 1]]),
    panel('back', 'Back wall', wall(x, h, [f, F, rim, F]), at([2 * t, Y - t, t], [1, 0, 0], [0, 0, 1]),
      [['base', 2], ['right', 3], top ? ['top', 0] : undefined, ['left', 1]]),
    panel('left', 'Left wall', wall(y, h, [f, f, rim, f]), at([t, 2 * t, t], [0, 1, 0], [0, 0, 1]),
      [['base', 3], ['back', 3], top ? ['top', 3] : undefined, ['front', 1]]),
    panel('base', 'Base', wall(x, y, [H, H, H, H]), at([2 * t, 2 * t, 0], [1, 0, 0], [0, 1, 0]),
      [['front', 0], ['right', 0], ['back', 0], ['left', 0]]),
  ];
  if (top)
    panels.push(panel('top', 'Top', wall(x, y, [f, f, f, f]), at([2 * t, 2 * t + y, Z], [1, 0, 0], [0, -1, 0]),
      [['back', 2], ['right', 2], ['front', 2], ['left', 2]]));
  return finishPanels(panels, t, effectiveKerf(p));
}

export const basedBox: Generator = {
  id: 'basedbox',
  name: 'Box on a base',
  category: 'Boxes',
  description: 'Closed box standing on a base plate with a brim; the walls key into slots in the base.',
  schema,
  presets: {
    Plinth: { x: 120, y: 120, h: 80, inside: true, top: 'closed' },
    Planter: { x: 200, y: 120, h: 100, inside: false, top: 'none' },
  },
  build,
  expectedSize,
};
