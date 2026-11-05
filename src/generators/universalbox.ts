/**
 * UniversalBox: a rectangular box with a choice of top, bottom and vertical-edge construction,
 * ported from boxes.py (florianfesti/boxes, boxes/generators/universalbox.py).
 *
 * Edge assignment (bottom, right, top, left of each panel; boxes.py UniversalBox):
 *    front/back walls  x * h   [b, s, tp, s]   s = 'F' (finger joints) or 'h' (finger holes)
 *    left/right walls  y * h   [b, f, tp, f]   fingers into the front/back walls
 *    bottom            x * y   'ffff'          only with `bottom: 'closed'` (b = 'F', else 'e')
 *    top               x * y   'ffff'          only with `top: 'closed'` (tp = 'F', else 'e')
 * With finger holes the front and back walls run past the side walls by a one-thickness brim and
 * the side walls' fingers pass through slots in them.
 *
 * World frame: outer size [0, X] x [0, Y] x [0, Z]; X = x + 2t (finger joints) or x + 4t (finger
 * holes), Y = y + 2t, Z = h plus one thickness per closed bottom/top.
 *
 * Deliberate differences from boxes.py: the many `top_edge` lid styles are reduced to a
 * finger-jointed top or open; `bottom_edge` to a finger-jointed bottom or none; no bed bolts.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec, type WallEdge } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'top', label: 'Top', help: 'Finger-jointed top panel, or open', group: 'Box',
    kind: 'enum', options: ['closed', 'open'], default: 'closed' },
  { key: 'bottom', label: 'Bottom', help: 'Finger-jointed bottom panel, or none (a frame or sleeve)', group: 'Box',
    kind: 'enum', options: ['closed', 'none'], default: 'closed' },
  { key: 'vertical', label: 'Vertical edges', help: 'Finger joints at the corners, or side walls keyed through slots in the front and back walls',
    group: 'Box', kind: 'enum', options: ['finger joints', 'finger holes'], default: 'finger joints' },
  ...commonParams,
];

const zWalls = (p: Params): number => (p.top === 'open' ? 0 : 1) + (p.bottom === 'none' ? 0 : 1);
/** Thickness the front/back walls add at each side in x: one wall, or wall plus brim with finger holes. */
const xSide = (p: Params): number => (p.vertical === 'finger holes' ? 2 : 1);

function innerSize(p: Params): { x: number; y: number; h: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * xSide(p) * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o ? zWalls(p) * t : 0) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 2 * xSide(p) * t, y: i.y + 2 * t, z: i.h + zWalls(p) * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h } = innerSize(p);
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  requireJointLength('h', h, t);
  const top = p.top !== 'open';
  const bottom = p.bottom !== 'none';

  const s = xSide(p) * t; // inner x starts here
  const Y = y + 2 * t;
  const z0 = bottom ? t : 0; // inner z starts here
  const Z = h + z0 + (top ? t : 0);
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const side: WallEdge = p.vertical === 'finger holes' ? 'fingerHoles' : F;
  const b: WallEdge = bottom ? F : 'flat';
  const tp: WallEdge = top ? F : 'flat';
  const wall = (w: number, hh: number, types: [WallEdge, WallEdge, WallEdge, WallEdge]) => rectangularWall(w, hh, types, ctx);

  const panels: PanelSpec[] = [
    panel('front', 'Front wall', wall(x, h, [b, side, tp, side]), at([s + x, 0, z0], [-1, 0, 0], [0, 0, 1]),
      [bottom ? ['bottom', 0] : undefined, ['left', 3], top ? ['top', 2] : undefined, ['right', 1]]),
    panel('right', 'Right wall', wall(y, h, [b, f, tp, f]), at([s + x + t, t + y, z0], [0, -1, 0], [0, 0, 1]),
      [bottom ? ['bottom', 1] : undefined, ['front', 3], top ? ['top', 1] : undefined, ['back', 1]]),
    panel('back', 'Back wall', wall(x, h, [b, side, tp, side]), at([s, Y, z0], [1, 0, 0], [0, 0, 1]),
      [bottom ? ['bottom', 2] : undefined, ['right', 3], top ? ['top', 0] : undefined, ['left', 1]]),
    panel('left', 'Left wall', wall(y, h, [b, f, tp, f]), at([s - t, t, z0], [0, 1, 0], [0, 0, 1]),
      [bottom ? ['bottom', 3] : undefined, ['back', 3], top ? ['top', 3] : undefined, ['front', 1]]),
  ];
  if (bottom)
    panels.push(panel('bottom', 'Bottom', wall(x, y, [f, f, f, f]), at([s, t, 0], [1, 0, 0], [0, 1, 0]),
      [['front', 0], ['right', 0], ['back', 0], ['left', 0]]));
  if (top)
    panels.push(panel('top', 'Top', wall(x, y, [f, f, f, f]), at([s, t + y, Z], [1, 0, 0], [0, -1, 0]),
      [['back', 2], ['right', 2], ['front', 2], ['left', 2]]));
  return finishPanels(panels, t, effectiveKerf(p));
}

export const universalBox: Generator = {
  id: 'universalbox',
  name: 'Universal box',
  category: 'Boxes',
  description: 'Rectangular box with a choice of top, bottom and corner construction (finger joints or slotted walls).',
  schema,
  presets: {
    'Slotted box': { x: 120, y: 80, h: 60, inside: true, top: 'closed', bottom: 'closed', vertical: 'finger holes' },
    Sleeve: { x: 100, y: 60, h: 150, inside: false, top: 'open', bottom: 'none', vertical: 'finger joints' },
    'Open crate': { x: 300, y: 200, h: 150, inside: false, top: 'open', bottom: 'closed', vertical: 'finger holes' },
  },
  build,
  expectedSize,
};
