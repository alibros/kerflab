/**
 * ClosedBox: a six-sided finger-jointed box (or five-sided with `top: 'none'`), ported from
 * boxes.py (florianfesti/boxes, boxes/generators/closedbox.py, and the `top` option of
 * openbox.py). This is the reference generator: later generators copy its structure.
 *
 * Generator pattern (copy this):
 *  1. `schema`: own params first, then `...commonParams`.
 *  2. `build(p)`: read params, derive INNER dimensions, check feasibility and throw ParamError
 *     naming the offending param key, draw each panel at nominal size with `rectangularWall`
 *     (shared helpers in walls.ts), place it, then `finishPanels`, which calls `finishWithKerf`
 *     once per part (turns kerf collapse into a ParamError naming `kerf`; a GeometryError that
 *     escapes is a generator bug).
 *  3. `expectedSize(p)`: outer assembled size, so the harness can check the dimensions.
 *
 * Edge assignment (boxes.py ClosedBox; edges listed bottom, right, top, left of each panel):
 *    front/back walls  x * h   'FFFF'   notched on all sides; they own the 4 vertical corner columns
 *    left/right walls  y * h   'FfFf'   notched top/bottom, fingers into the front/back walls
 *    bottom/top        x * y   'ffff'   fingers on all sides into the walls
 * With `top: 'none'` the walls' top sides become plain ('FFeF' / 'FfeF', boxes.py OpenBox).
 * Every finger edge ('f', fingerJoint) mates a notched edge ('F', fingerHoleEdge) of the same
 * length over the same world span, so the symmetric finger layouts interleave exactly; the
 * corner cubes and edge strips not covered by fingers belong to the 'F' panel, whose outline is
 * extended by one thickness past each neighbouring 'F' side.
 *
 * World frame: the assembled box occupies [0, X] x [0, Y] x [0, Z] (outer size), z up, the front
 * wall at y = 0. Inner space is [t, t+x] x [t, t+y] x [t, t+h].
 *
 * Deliberate differences from boxes.py: no bed bolts, no labels; `inside: true` corresponds to
 * boxes.py `outside: false`. The `top` option is new (boxes.py has a separate OpenBox).
 */
import type { EdgeType } from '../core/edges';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { at, finishPanels, num, panel, rectangularWall, type PanelSpec, type WallEdges } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'top', label: 'Top', help: 'Closed lid panel, or an open-top box', group: 'Box',
    kind: 'enum', options: ['closed', 'none'], default: 'closed' },
  ...commonParams,
];

/** Number of walls along z: bottom always, plus the top panel when closed. */
const zWalls = (p: Params): number => (p.top === 'none' ? 1 : 2);

/** Inner dimensions from params (subtracting the walls when `inside` is off). */
function innerSize(p: Params): { x: number; y: number; h: number } {
  const t = num(p, 'thickness');
  const d = p.inside === false ? 2 * t : 0;
  return { x: num(p, 'x') - d, y: num(p, 'y') - d, h: num(p, 'h') - (p.inside === false ? zWalls(p) * t : 0) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 2 * t, y: i.y + 2 * t, z: i.h + zWalls(p) * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h } = innerSize(p);
  const top = p.top !== 'none';
  for (const [k, v] of [['x', x], ['y', y], ['h', h]] as const)
    if (v < 3 * t)
      throw new ParamError(`${k} too small: inner ${k} is ${v.toFixed(2)} mm, needs at least 3 * thickness = ${(3 * t).toFixed(2)} mm`, k);

  const X = x + 2 * t;
  const Y = y + 2 * t;
  const Z = h + (top ? 2 : 1) * t;
  const F: EdgeType = 'fingerHole';
  const f: EdgeType = 'finger';
  const rim: EdgeType = top ? F : 'flat';

  // Placements map the inner rectangle's local (0,0) to the inner corner of the face, with the
  // normal u x v pointing into the box. Mates are [part, side] with sides bottom/right/top/left.
  const wall = (w: number, hh: number, types: WallEdges) => rectangularWall(w, hh, types, ctx);
  const panels: PanelSpec[] = [
    panel('front', 'Front wall', wall(x, h, [F, F, rim, F]), at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]),
      [['bottom', 0], ['left', 3], top ? ['top', 2] : undefined, ['right', 1]]),
    panel('right', 'Right wall', wall(y, h, [F, f, rim, f]), at([X, t + y, t], [0, -1, 0], [0, 0, 1]),
      [['bottom', 1], ['front', 3], top ? ['top', 1] : undefined, ['back', 1]]),
    panel('back', 'Back wall', wall(x, h, [F, F, rim, F]), at([t, Y, t], [1, 0, 0], [0, 0, 1]),
      [['bottom', 2], ['right', 3], top ? ['top', 0] : undefined, ['left', 1]]),
    panel('left', 'Left wall', wall(y, h, [F, f, rim, f]), at([0, t, t], [0, 1, 0], [0, 0, 1]),
      [['bottom', 3], ['back', 3], top ? ['top', 3] : undefined, ['front', 1]]),
    panel('bottom', 'Bottom', wall(x, y, [f, f, f, f]), at([t, t, 0], [1, 0, 0], [0, 1, 0]),
      [['front', 0], ['right', 0], ['back', 0], ['left', 0]]),
  ];
  if (top)
    panels.push(panel('top', 'Top', wall(x, y, [f, f, f, f]), at([t, t + y, Z], [1, 0, 0], [0, -1, 0]),
      [['back', 2], ['right', 2], ['front', 2], ['left', 2]]));

  return finishPanels(panels, t, effectiveKerf(p));
}

export const closedBox: Generator = {
  id: 'closedbox',
  name: 'Closed box',
  category: 'Boxes',
  description: 'Six-sided box with finger joints on every edge; optionally open at the top.',
  schema,
  presets: {
    Small: { x: 60, y: 40, h: 30, inside: true, top: 'closed' },
    Shoebox: { x: 330, y: 200, h: 120, inside: false, top: 'none' },
    Cube: { x: 100, y: 100, h: 100, inside: false, top: 'closed' },
  },
  build,
  expectedSize,
};
