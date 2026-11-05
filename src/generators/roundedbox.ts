/**
 * RoundedBox: a box with its four vertical edges rounded, ported from boxes.py (florianfesti/boxes,
 * boxes/generators/roundedbox.py, RoundedBox; walls from Boxes.surroundingWall / roundedPlate).
 * ONE living-hinge wall wraps a rounded-rectangle bottom and top plate.
 *
 * Plates (inner x * y, corner radius r): fingers ('f') on the straight parts, plain arcs; the
 * front side is two fingered halves because the wall starts and ends in its middle. Wall (inner
 * height h): from the middle of the front, fingerHole spans over the straight parts (boxes.py 'F')
 * and four 90 degree living hinges (inner radius r); its two ends butt in the middle of the front.
 * Top: closed, or a rim with a rounded opening inset 2 thickness (boxes.py "hole").
 *
 * World frame: [0, x + 2t] x [0, y + 2t] x [0, h + 2t]; plates horizontal, wall vertical.
 *
 * Deliberate differences from boxes.py: one wall piece only (no `wallpieces`), its ends butt
 * instead of a dovetail; one compartment height (no `sh` shelves); edge style 'f' only; no loose
 * "lid" top; the radius is clamped so every straight part keeps 3 * thickness of fingers.
 */
import { edgeFor } from '../core/edges';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { flexParams, flexSettings, flexWall, requireFlexArc } from './flexwall';
import { at, finishPanels, num, requireJointLength, roundedRect, type PanelSpec, type Wall } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'radius', label: 'Corner radius', help: 'Inner radius of the rounded vertical edges (the living hinges)', unit: 'mm',
    group: 'Box', kind: 'number', min: 3, max: 300, default: 15, step: 0.5 },
  { key: 'top', label: 'Top', help: 'Closed top plate, or a rim with a rounded opening', group: 'Box',
    kind: 'enum', options: ['hole', 'closed'], default: 'hole' },
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
  return { x: i.x + 2 * t, y: i.y + 2 * t, z: i.h + 2 * t };
}

/** Rounded plate: sides 0/1 front halves (left, right), 2 right, 3 back, 4 left; lines one thickness out. */
export function roundedPlate(x: number, y: number, r: number, ctx: ReturnType<typeof edgeCtx>, holes: Wall['holes'] = []): Wall {
  const t = ctx.thickness;
  const f = edgeFor('finger');
  const tt = new Turtle({ x: r, y: 0 });
  f(tt, x / 2 - r, ctx); f(tt, x / 2 - r, ctx); tt.arc(r, 90);
  f(tt, y - 2 * r, ctx); tt.arc(r, 90);
  f(tt, x - 2 * r, ctx); tt.arc(r, 90);
  f(tt, y - 2 * r, ctx); tt.arc(r, 90);
  return {
    outline: tt.toPath(true), holes,
    lines: [
      { side: 0, type: 'finger', from: { x: r, y: -t }, to: { x: x / 2, y: -t } },
      { side: 1, type: 'finger', from: { x: x / 2, y: -t }, to: { x: x - r, y: -t } },
      { side: 2, type: 'finger', from: { x: x + t, y: r }, to: { x: x + t, y: y - r } },
      { side: 3, type: 'finger', from: { x: x - r, y: y + t }, to: { x: r, y: y + t } },
      { side: 4, type: 'finger', from: { x: -t, y: y - r }, to: { x: -t, y: r } },
    ],
  };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const fs = flexSettings(p);
  const { x, y, h } = inner(p);
  requireJointLength('h', h, t);
  requireJointLength('y', y, t);
  requireJointLength('x', x, 2 * t, 'inner x / 2'); // the front halves need 3t each
  const r = Math.min(num(p, 'radius'), x / 2 - 3 * t, (y - 3 * t) / 2);
  requireFlexArc('radius', r, 90, fs, t);

  const wall = flexWall([
    { kind: 'flat', length: x / 2 - r, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: y - 2 * r, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: x - 2 * r, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: y - 2 * r, edge: 'fingerHole' }, { kind: 'arc', angle: 90, r },
    { kind: 'flat', length: x / 2 - r, edge: 'fingerHole' },
  ], h, ['flat', 'flat'], ctx, fs);
  const bottom = roundedPlate(x, y, r, ctx);
  const top = roundedPlate(x, y, r, ctx, p.top === 'closed' ? [] : [roundedRect(x / 2, y / 2, x - 4 * t, y - 4 * t, r - 2 * t)]);
  // Wall span -> plate side. Bottom (u = +X): front-left 0, front-right 1, right 2, back 3, left 4.
  // Top (u = -X, seen from above mirrored): its sides 0/1 are the world front-right/-left, 2 left, 4 right.
  const toBottom: Record<number, number> = { 0: 0, 2: 4, 4: 3, 6: 2, 8: 1 };
  const toTop: Record<number, number> = { 0: 1, 2: 2, 4: 3, 6: 4, 8: 0 };
  const wallMates: PanelSpec['mates'] = [];
  const bm: PanelSpec['mates'] = [];
  const tm: PanelSpec['mates'] = [];
  for (const k of [0, 2, 4, 6, 8]) {
    wallMates[k] = ['bottom', toBottom[k]!]; bm[toBottom[k]!] = ['wall', k];
    wallMates[100 + k] = ['top', toTop[k]!]; tm[toTop[k]!] = ['wall', 100 + k];
  }
  const panels: PanelSpec[] = [
    { id: 'wall', name: 'Flex wall', ...wall, placement: at([t + x / 2, 0, t], [-1, 0, 0], [0, 0, 1]), mates: wallMates },
    { id: 'bottom', name: 'Bottom', ...bottom, placement: at([t, t, 0], [1, 0, 0], [0, 1, 0]), mates: bm },
    { id: 'top', name: p.top === 'closed' ? 'Top' : 'Top rim', ...top, placement: at([t + x, t, h + 2 * t], [-1, 0, 0], [0, 1, 0]), mates: tm },
  ];
  return finishPanels(panels, t, effectiveKerf(p));
}

export const roundedBox: Generator = {
  id: 'roundedbox',
  name: 'Rounded box',
  category: 'Flex',
  description: 'Box with rounded vertical edges: one living-hinge wall wraps a rounded bottom and top plate.',
  schema,
  presets: {
    Small: { x: 80, y: 60, h: 40, radius: 12, top: 'hole', inside: true },
    Tin: { x: 120, y: 120, h: 60, radius: 30, top: 'closed', inside: false },
    Planter: { x: 250, y: 120, h: 110, radius: 25, top: 'hole', inside: false },
  },
  build,
  expectedSize,
};
