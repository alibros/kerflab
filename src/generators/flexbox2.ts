/**
 * FlexBox2: box with the top two corners rounded, ported from boxes.py (florianfesti/boxes,
 * boxes/generators/flexbox2.py, FlexBox2). ONE living-hinge wall runs from the bottom of the back
 * up, over the top (two 90 degree hinges, inner radius r) and down the front as a door flap held
 * by a latch; a bottom plate, two side plates and a lower front panel close the box.
 *
 * Side profile (inner): y deep, h tall: finger (y) bottom, finger (h - r) back, arc, plain
 * (y - 2r) top (the lid; it rests on the plates), arc, latch bump (latch) + finger
 * (h - r - latch) front. Wall: fingerHole (h - r) back, arc, plain (y - 2r), arc, latch; its start
 * end has fingers into the bottom plate. Bottom: x * y, notched on all sides ('FFFF'). Front
 * panel: x * (h - r - latch), 'fFeF' (its plain top meets the door flap).
 *
 * World frame: width x along world X between the side plates, depth y along world Y (front at
 * Y = 0), height h along world Z. Outer size (x + 2t) x (y + 2t) x (h + 2t).
 *
 * Deliberate differences from boxes.py: latch grip plain; flex strips shortened by `stretch`;
 * the radius is clamped so the straight parts keep 3 * thickness.
 */
import { edgeFor } from '../core/edges';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { flexParams, flexSettings, flexWall, latchBump, mirrorWall, requireFlexArc } from './flexwall';
import { at, finishPanels, num, rectangularWall, requireJointLength, type PanelSpec, type Wall } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width between the side plates (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth, front to back (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'radius', label: 'Corner radius', help: 'Inner radius of the two rounded top corners (the living hinges)', unit: 'mm',
    group: 'Box', kind: 'number', min: 3, max: 300, default: 15, step: 0.5 },
  { key: 'latchsize', label: 'Latch', help: 'Length of the latch (door flap) in multiples of thickness', unit: '',
    group: 'Box', kind: 'number', min: 2, max: 20, default: 8, step: 0.5 },
  ...flexParams,
  ...commonParams,
];

function inner(p: Params): { x: number; y: number; h: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o ? 2 * t : 0) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = inner(p);
  return { x: i.x + 2 * t, y: i.y + 2 * t, z: i.h + 2 * t };
}

/** Side profile: 0 bottom, 1 back, 2 top (plain, line one thickness out), 3 front below the latch. */
function sidePlate(y: number, h: number, r: number, L: number, t: number, ctx: ReturnType<typeof edgeCtx>): Wall {
  const tt = new Turtle({ x: 0, y: 0 });
  const f = edgeFor('finger');
  f(tt, y, ctx); tt.turn(90);
  f(tt, h - r, ctx); tt.arc(r, 90);
  tt.forward(y - 2 * r); tt.arc(r, 90);
  latchBump(tt, L, t);
  f(tt, h - r - L, ctx); tt.turn(90);
  return {
    outline: tt.toPath(true), holes: [],
    lines: [
      { side: 0, type: 'finger', from: { x: 0, y: -t }, to: { x: y, y: -t } },
      { side: 1, type: 'finger', from: { x: y + t, y: 0 }, to: { x: y + t, y: h - r } },
      { side: 2, type: 'flat', from: { x: y - r, y: h + t }, to: { x: r, y: h + t } },
      { side: 3, type: 'finger', from: { x: -t, y: h - r - L }, to: { x: -t, y: 0 } },
    ],
  };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const fs = flexSettings(p);
  const { x, y, h } = inner(p);
  const L = num(p, 'latchsize') * t;
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  if (h - L < 3 * t) throw new ParamError(`h too small: h - latch is ${(h - L).toFixed(2)} mm, needs at least 3 * thickness`, 'h');
  const r = Math.min(num(p, 'radius'), y / 2, h - L - 3 * t);
  requireFlexArc('radius', r, 90, fs, t);

  const wall = flexWall([
    { kind: 'flat', length: h - r, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: y - 2 * r, edge: 'outset' }, { kind: 'arc', angle: 90, r },
    { kind: 'latch', length: L },
  ].filter((s) => s.kind !== 'flat' || (s.length ?? 0) > 1e-9) as Parameters<typeof flexWall>[0], x, ['finger', 'flat'], ctx, fs);
  const side = sidePlate(y, h, r, L, t, ctx);
  const top = y - 2 * r > 1e-9;
  if (!top) side.lines = side.lines.filter((l) => l.side !== 2);
  // Wall span 0 = back, span 2 = top (when present).
  const wallMates: PanelSpec['mates'] = [];
  const left: PanelSpec['mates'] = [];
  const right: PanelSpec['mates'] = [];
  const pairs: [number, number][] = top ? [[0, 1], [2, 2]] : [[0, 1]];
  for (const [k, s] of pairs) {
    wallMates[k] = ['right', s]; wallMates[100 + k] = ['left', s];
    right[s] = ['wall', k]; left[s] = ['wall', 100 + k];
  }
  wallMates[200] = ['bottom', 2];
  left[0] = ['bottom', 3]; right[0] = ['bottom', 1];
  left[3] = ['front', 1]; right[3] = ['front', 3];
  const F = 'fingerHole' as const;
  const bottom = rectangularWall(x, y, [F, F, F, F], ctx);
  const front = rectangularWall(x, h - r - L, ['finger', F, 'flat', F], ctx);
  const panels: PanelSpec[] = [
    // Starts at the bottom of the back (outer face Y = y + 2t), running up; local y = 0 at X = x + t.
    { id: 'wall', name: 'Flex wall', ...wall, placement: at([x + t, y + 2 * t, t], [0, 0, 1], [-1, 0, 0]), mates: wallMates },
    { id: 'left', name: 'Left side', ...side, placement: at([0, t, t], [0, 1, 0], [0, 0, 1]), mates: left },
    { id: 'right', name: 'Right side', ...mirrorWall(side, y), placement: at([x + 2 * t, t + y, t], [0, -1, 0], [0, 0, 1]), mates: right },
    { id: 'bottom', name: 'Bottom', ...bottom, placement: at([t, t, 0], [1, 0, 0], [0, 1, 0]),
      mates: [['front', 0], ['right', 0], ['wall', 200], ['left', 0]] },
    { id: 'front', name: 'Front', ...front, placement: at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]),
      mates: [['bottom', 0], ['left', 3], undefined, ['right', 3]] },
  ];
  return finishPanels(panels, t, effectiveKerf(p));
}

export const flexBox2: Generator = {
  id: 'flexbox2',
  name: 'Flex box (top rounded)',
  category: 'Flex',
  description: 'Box whose two top corners are living hinges: the wall runs up the back, over the top and down the front as a latched flap.',
  schema,
  presets: {
    Small: { x: 60, y: 60, h: 80, radius: 12, inside: true },
    Tall: { x: 80, y: 70, h: 160, radius: 20, inside: false },
    Wide: { x: 220, y: 120, h: 90, radius: 25, latchsize: 10, inside: true },
  },
  build,
  expectedSize,
};
