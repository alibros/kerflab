/**
 * OpenBox: a box open at the top and at the front, ported from boxes.py
 * (florianfesti/boxes, boxes/generators/openbox.py).
 *
 * Edge assignment (bottom, right, top, left of each panel; boxes.py OpenBox):
 *    back wall     x * h   'FFeF'   notched bottom and sides; owns the two back corner columns
 *    left wall     y * h   'Ffee'   notched bottom, fingers into the back wall, open front
 *    right wall    y * h   'Feef'   (mirror of the left wall)
 *    bottom        x * y   'efff'   open front, fingers into the three walls
 *
 * World frame: outer size [0, X] x [0, Y] x [0, Z]; the open front is at y = 0, the back wall at
 * y = Y - t. Inner space is [t, t+x] x [0, y] x [t, t+h].
 *
 * Deliberate differences from boxes.py: the `edgetype` option ('F' finger joints / 'h' finger
 * holes) is fixed to finger joints.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type WallEdge } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth from the open front to the back wall (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  ...commonParams,
];

/** Inner dimensions (outer minus two side walls in x, the back wall in y, the bottom in h). */
function innerSize(p: Params): { x: number; y: number; h: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false ? 1 : 0;
  return { x: num(p, 'x') - 2 * o * t, y: num(p, 'y') - o * t, h: num(p, 'h') - o * t };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 2 * t, y: i.y + t, z: i.h + t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h } = innerSize(p);
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  requireJointLength('h', h, t);

  const X = x + 2 * t;
  const Y = y + t;
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const wall = (w: number, hh: number, types: [WallEdge, WallEdge, WallEdge, WallEdge]) => rectangularWall(w, hh, types, ctx);

  return finishPanels([
    // local x runs left -> right seen from inside, i.e. +x world; normal -y (into the box)
    panel('back', 'Back wall', wall(x, h, [F, F, e, F]), at([t, Y, t], [1, 0, 0], [0, 0, 1]),
      [['bottom', 2], ['right', 3], undefined, ['left', 1]]),
    // local x from the back (y = Y - t) to the open front; normal -x
    panel('right', 'Right wall', wall(y, h, [F, e, e, f]), at([X, y, t], [0, -1, 0], [0, 0, 1]),
      [['bottom', 1], undefined, undefined, ['back', 1]]),
    // local x from the open front to the back; normal +x
    panel('left', 'Left wall', wall(y, h, [F, f, e, e]), at([0, 0, t], [0, 1, 0], [0, 0, 1]),
      [['bottom', 3], ['back', 3], undefined, undefined]),
    panel('bottom', 'Bottom', wall(x, y, [e, f, f, f]), at([t, 0, 0], [1, 0, 0], [0, 1, 0]),
      [undefined, ['right', 0], ['back', 0], ['left', 0]]),
  ], t, effectiveKerf(p));
}

export const openBox: Generator = {
  id: 'openbox',
  name: 'Open box',
  category: 'Boxes',
  description: 'Box open at the top and the front, like a shelf cubby or a desk caddy.',
  schema,
  presets: {
    Cubby: { x: 300, y: 300, h: 300, inside: false },
    'Desk caddy': { x: 160, y: 80, h: 60, inside: true },
  },
  build,
  expectedSize,
};
