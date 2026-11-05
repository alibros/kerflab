/**
 * UBox: an open box whose wall is ONE living-hinge part bent into a U between two U-shaped side
 * plates, ported from boxes.py (florianfesti/boxes, boxes/generators/ubox.py, UBox).
 *
 * U plate (inner x wide, y tall, bottom corners rounded with radius r): finger (x - 2r) bottom,
 * arc, finger (y - r) right, plain top (x), finger (y - r) left, arc. Wall (inner height h between
 * the plates): fingerHole (y - r) down the left, a 90 degree living hinge (inner radius r),
 * fingerHole (x - 2r) along the bottom, hinge, fingerHole (y - r) up the right; plain ends.
 *
 * World frame: the U profile in world X (x) and Z (y, up); the plates h apart along world Y.
 * Outer size (x + 2t) x (h + 2t) x (y + t); open at the top.
 *
 * Deliberate differences from boxes.py: no lid / top-edge options (the top is plain); flex strips
 * shortened by `stretch`; the radius is clamped so the straight parts keep 3 * thickness.
 */
import { edgeFor } from '../core/edges';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { flexParams, flexSettings, flexWall, mirrorWall, requireFlexArc } from './flexwall';
import { at, finishPanels, num, requireJointLength, type PanelSpec, type Wall } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width of the U (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Height', help: 'Height of the U (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Depth', help: 'Distance between the two U plates (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'radius', label: 'Corner radius', help: 'Inner radius of the two rounded bottom corners (the living hinges)', unit: 'mm',
    group: 'Box', kind: 'number', min: 3, max: 300, default: 30, step: 0.5 },
  ...flexParams,
  ...commonParams,
];

function inner(p: Params): { x: number; y: number; h: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? t : 0), h: num(p, 'h') - (o ? 2 * t : 0) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = inner(p);
  return { x: i.x + 2 * t, y: i.h + 2 * t, z: i.y + t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const fs = flexSettings(p);
  const { x, y, h } = inner(p);
  requireJointLength('h', h, t);
  requireJointLength('x', x, t);
  requireJointLength('y', y, 2 * t, 'inner y / 2');
  const r = Math.min(num(p, 'radius'), (x - 3 * t) / 2, y - 3 * t);
  requireFlexArc('radius', r, 90, fs, t);

  const f = edgeFor('finger');
  const tt = new Turtle({ x: r, y: 0 });
  f(tt, x - 2 * r, ctx); tt.arc(r, 90);
  f(tt, y - r, ctx); tt.turn(90);
  tt.forward(x); tt.turn(90);
  f(tt, y - r, ctx); tt.arc(r, 90);
  const side: Wall = {
    outline: tt.toPath(true), holes: [],
    lines: [
      { side: 0, type: 'finger', from: { x: r, y: -t }, to: { x: x - r, y: -t } },
      { side: 1, type: 'finger', from: { x: x + t, y: r }, to: { x: x + t, y } },
      { side: 3, type: 'finger', from: { x: -t, y }, to: { x: -t, y: r } },
    ],
  };
  const wall = flexWall([
    { kind: 'flat', length: y - r, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: x - 2 * r, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: y - r, edge: 'fingerHole' },
  ], h, ['flat', 'flat'], ctx, fs);
  const sideOf: Record<number, number> = { 0: 3, 2: 0, 4: 1 };
  const wm: PanelSpec['mates'] = [];
  const fm: PanelSpec['mates'] = [];
  const bm: PanelSpec['mates'] = [];
  for (const k of [0, 2, 4]) {
    const s = sideOf[k]!;
    wm[k] = ['front', s]; wm[100 + k] = ['back', s];
    fm[s] = ['wall', k]; bm[s] = ['wall', 100 + k];
  }
  const panels: PanelSpec[] = [
    { id: 'wall', name: 'Flex wall', ...wall, placement: at([0, t, t + y], [0, 0, -1], [0, 1, 0]), mates: wm },
    { id: 'back', name: 'Back U', ...side, placement: at([t, h + 2 * t, t], [1, 0, 0], [0, 0, 1]), mates: bm },
    { id: 'front', name: 'Front U', ...mirrorWall(side, x), placement: at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]), mates: fm },
  ];
  return finishPanels(panels, t, effectiveKerf(p));
}

export const uBox: Generator = {
  id: 'ubox',
  name: 'U-box',
  category: 'Flex',
  description: 'Open box whose wall is one living-hinge part bent into a U between two U-shaped side plates.',
  schema,
  presets: {
    Small: { x: 80, y: 60, h: 60, radius: 20, inside: true },
    Trough: { x: 120, y: 80, h: 250, radius: 40, inside: false },
    Deep: { x: 100, y: 160, h: 100, radius: 30, inside: true },
  },
  build,
  expectedSize,
};
