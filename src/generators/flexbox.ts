/**
 * FlexBox: a box whose wall is ONE living-hinge part wrapped around two rounded-rectangle side
 * plates, ported from boxes.py (florianfesti/boxes, boxes/generators/flexbox.py, FlexBox).
 *
 * Side profile (inner): x wide, y tall, all four corners rounded with radius r. Side plate edges,
 * CCW from the bottom: finger (x - 2r), arc, finger (y - 2r) (back), arc, plain (x - 2r) (top: the
 * lid), arc, latch bump (latch) + finger (y - 2r - latch) (front), arc. The wall starts on the
 * front just below the latch, runs down, round the bottom, up the back and over the top, and ends
 * as a door flap over the latch: fingerHole spans where the plates have fingers, plain over the
 * top and the four 90 degree living-hinge arcs (inner radius r), and the latch notch. The top is
 * not glued (only rests on the plates), so the top + front-top corner + flap bend open.
 *
 * World frame: the profile is in x (world X) and y (world Z, up); the plates are h apart along
 * world Y. Outer size (x + 2t) x (h + 2t) x (y + 2t), inner space [t, t + x] x [t, t + h] x [t, t + y].
 *
 * Deliberate differences from boxes.py: the latch grip is a plain edge; the flex strips are
 * shortened by `stretch` (see docs/differences.md); the radius is clamped so every straight part
 * keeps 3 * thickness for its fingers (boxes.py: so they stay >= 0).
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { flexParams, flexSettings, flexWall, latchBump, mirrorWall, requireFlexArc } from './flexwall';
import { at, finishPanels, num, requireJointLength, type PanelSpec, type Wall } from './walls';
import { edgeFor } from '../core/edges';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width of the side profile (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Height', help: 'Height of the side profile (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Depth', help: 'Distance between the two side plates (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'radius', label: 'Corner radius', help: 'Inner radius of the four rounded corners (the living hinges)', unit: 'mm',
    group: 'Box', kind: 'number', min: 3, max: 300, default: 15, step: 0.5 },
  { key: 'latchsize', label: 'Latch', help: 'Length of the latch (door flap) in multiples of thickness', unit: '',
    group: 'Box', kind: 'number', min: 2, max: 20, default: 8, step: 0.5 },
  ...flexParams,
  ...commonParams,
];

function inner(p: Params): { x: number; y: number; h: number } {
  const d = p.inside === false ? 2 * num(p, 'thickness') : 0;
  return { x: num(p, 'x') - d, y: num(p, 'y') - d, h: num(p, 'h') - d };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = inner(p);
  return { x: i.x + 2 * t, y: i.h + 2 * t, z: i.y + 2 * t };
}

/** Side profile: sides 0 bottom, 1 back, 2 top (plain, line one thickness out), 3 front below the latch. */
function sidePlate(x: number, y: number, r: number, L: number, t: number, ctx: ReturnType<typeof edgeCtx>): Wall {
  const tt = new Turtle({ x: r, y: 0 });
  const f = edgeFor('finger');
  f(tt, x - 2 * r, ctx); tt.arc(r, 90);
  f(tt, y - 2 * r, ctx); tt.arc(r, 90);
  tt.forward(x - 2 * r); tt.arc(r, 90);
  latchBump(tt, L, t);
  f(tt, y - 2 * r - L, ctx); tt.arc(r, 90);
  return {
    outline: tt.toPath(true), holes: [],
    lines: [
      { side: 0, type: 'finger', from: { x: r, y: -t }, to: { x: x - r, y: -t } },
      { side: 1, type: 'finger', from: { x: x + t, y: r }, to: { x: x + t, y: y - r } },
      { side: 2, type: 'flat', from: { x: x - r, y: y + t }, to: { x: r, y: y + t } },
      { side: 3, type: 'finger', from: { x: -t, y: y - r - L }, to: { x: -t, y: r } },
    ],
  };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const fs = flexSettings(p);
  const { x, y, h } = inner(p);
  const L = num(p, 'latchsize') * t;
  requireJointLength('h', h, t);
  requireJointLength('x', x, t);
  if (y - L < 3 * t) throw new ParamError(`y too small: y - latch is ${(y - L).toFixed(2)} mm, needs at least 3 * thickness`, 'y');
  // boxes.py clamps the radius so the straight parts fit (here: at least 3 * thickness for the fingers).
  const r = Math.min(num(p, 'radius'), (x - 3 * t) / 2, (y - L - 3 * t) / 2);
  requireFlexArc('radius', r, 90, fs, t);

  const wall = flexWall([
    { kind: 'flat', length: y - 2 * r - L, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: x - 2 * r, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: y - 2 * r, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: x - 2 * r, edge: 'outset' }, { kind: 'arc', angle: 90, r },
    { kind: 'latch', length: L },
  ], h, ['flat', 'flat'], ctx, fs);
  const side = sidePlate(x, y, r, L, t, ctx);
  // Wall flat spans 0, 2, 4, 6 lie on side-plate sides 3, 0, 1, 2.
  const sideOf: Record<number, number> = { 0: 3, 2: 0, 4: 1, 6: 2 };
  const wallMates: PanelSpec['mates'] = [];
  const frontMates: PanelSpec['mates'] = [];
  const backMates: PanelSpec['mates'] = [];
  for (const [k, s] of Object.entries(sideOf).map(([a, b]) => [Number(a), b] as const)) {
    wallMates[k] = ['front', s];
    wallMates[100 + k] = ['back', s];
    frontMates[s] = ['wall', k];
    backMates[s] = ['wall', 100 + k];
  }
  const panels: PanelSpec[] = [
    { id: 'wall', name: 'Flex wall', outline: wall.outline, holes: wall.holes, lines: wall.lines, bend: wall.bend,
      placement: at([0, t, t + y - r - L], [0, 0, -1], [0, 1, 0]), mates: wallMates },
    { id: 'back', name: 'Back side', ...side, placement: at([t, h + 2 * t, t], [1, 0, 0], [0, 0, 1]), mates: backMates },
    { id: 'front', name: 'Front side', ...mirrorWall(side, x), placement: at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]), mates: frontMates },
  ];
  return finishPanels(panels, t, effectiveKerf(p));
}

export const flexBox: Generator = {
  id: 'flexbox',
  name: 'Flex box',
  category: 'Flex',
  description: 'Box with round corners: one living-hinge wall wraps two side plates; the top opens as a flap held by a latch.',
  schema,
  presets: {
    Small: { x: 80, y: 60, h: 50, radius: 12, inside: true },
    Tall: { x: 70, y: 150, h: 70, radius: 20, inside: false },
    Wide: { x: 200, y: 90, h: 120, radius: 25, latchsize: 10, inside: true },
  },
  build,
  expectedSize,
};
