/**
 * SlidingLidBox: a box whose lid slides in over the lower front wall, between rails, ported from
 * boxes.py (florianfesti/boxes, boxes/generators/slidinglidbox.py).
 *
 * Parts (bottom, right, top, left of each panel; boxes.py SlidingLidBox; B = bottom edge choice):
 *    front          x * h          [B, F, e, F]      lower than the others: the lid slides over it
 *    back           x * (h+g)      [B, F, EfE, F]    raised corners cover the top rails' back ends
 *    sides          y * (h+g)      [B, fE, F, f]     front edge: fingers for h, outset for the gap g
 *    bottom         x * y          'ffff'
 *    lower rails    y * r          'feee'            fingers into a slot row in the side walls; the lid rests on them
 *    top rails      y * r          'fEee'            fingers into the side walls' top; outset front end
 *    back rail      (x - 2r) * r   'Feee'            on top of the back wall, between the top rails
 *    lid            y * (x - 2ms)  'eEee'            outset front end; optional grip hole or lip
 *    lid lip        (x - 2ms - 2r) * g  'Feee'       only with `lid: lip`, stands on the lid's front fingers
 * g = (1 + margin_t) * thickness is the lid gap, r the rail width, ms = margin_s * thickness.
 *
 * World frame: [0, X] x [0, Y] x [0, Z], X = x + 2t, Y = y + 2t, the front at y = 0. With finger
 * joints the bottom is [t, X - t]^2 x [0, t] (finger holes: raised to [t, 2t] with the walls'
 * slotted brim below), the lower rails' tops (and the front wall's top) are at zb + h, the lid
 * occupies [zb + h, zb + h + t], the top rails [zb + h + g, Z]; Z = zb + h + g + t.
 *
 * Joints: the sliding lid is held only by the rails. In the model it rests on the front wall top
 * where it slides in; that is declared as a flat (resting) mate between the lid's front end and
 * the front wall, and is what joins the lid to the box.
 *
 * Deliberate differences from boxes.py: bottom edge `s` (stackable) is not offered; the lower
 * rails' back ends butt against the back wall instead of a finger joint into it (a rail of the
 * default 1.5 thicknesses is too short for a finger joint); no burn correction of the rail margin
 * (kerf is compensated per part).
 */
import type { Generator, Part } from '../core/part';
import { fingerHolesFor } from '../core/edges/finger';
import { mat3Translate, transform } from '../core/geometry';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import {
  at, finishPanels, num, panel, pieceSide, rectangularWall, requireJointLength, roundedRect,
  type PanelSpec, type WallEdge, type WallEdges,
} from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x, across the lid (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 60, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y, the direction the lid slides (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 220, step: 1 },
  { key: 'h', label: 'Height', help: 'Inner: from the bottom to the underside of the lid. Outer: the whole box', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 60, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'bottom', label: 'Bottom', help: 'Bottom panel finger-jointed into the walls, or keyed through slots above a brim',
    group: 'Box', kind: 'enum', options: ['finger joints', 'finger holes'], default: 'finger joints' },
  { key: 'rail', label: 'Rail width', help: 'Width of the rails holding the lid, in multiples of thickness. Wider is sturdier but narrows the opening',
    unit: '', group: 'Lid', kind: 'number', min: 1, max: 5, default: 1.5, step: 0.1 },
  { key: 'margin_t', label: 'Vertical margin', help: 'Extra height of the lid gap, in multiples of thickness, so the lid slides freely',
    unit: '', group: 'Lid', kind: 'number', min: 0.02, max: 0.5, default: 0.1, step: 0.01 },
  { key: 'margin_s', label: 'Side margin', help: 'Clearance at each side of the lid, in multiples of thickness, so it does not jam',
    unit: '', group: 'Lid', kind: 'number', min: 0.02, max: 0.5, default: 0.05, step: 0.01 },
  { key: 'lid', label: 'Lid', help: 'Grip hole near the front of the lid, a lip to pull it by, or plain',
    group: 'Lid', kind: 'enum', options: ['hole', 'lip', 'none'], default: 'hole' },
  { key: 'hole_length', label: 'Grip hole length', help: 'Length of the grip hole across the lid', unit: 'mm',
    group: 'Lid', kind: 'number', min: 10, max: 200, default: 40, step: 1 },
  { key: 'hole_width', label: 'Grip hole width', help: 'Width of the grip hole along the lid', unit: 'mm',
    group: 'Lid', kind: 'number', min: 5, max: 100, default: 20, step: 1 },
  { key: 'hole_radius', label: 'Grip hole radius', help: 'Corner radius of the grip hole (limited to half its size)', unit: 'mm',
    group: 'Lid', kind: 'number', min: 0, max: 50, default: 10, step: 0.5 },
  ...commonParams,
];

const zBottom = (p: Params): number => (p.bottom === 'finger holes' ? 2 : 1) * num(p, 'thickness');
const gapOf = (p: Params): number => (1 + num(p, 'margin_t')) * num(p, 'thickness');

function innerSize(p: Params): { x: number; y: number; h: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o ? zBottom(p) + gapOf(p) + t : 0) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 2 * t, y: i.y + 2 * t, z: zBottom(p) + i.h + gapOf(p) + t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h } = innerSize(p);
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  requireJointLength('h', h, t, 'the height below the lid');
  const g = gapOf(p);
  const r = num(p, 'rail') * t;
  const ms = num(p, 'margin_s') * t;
  const lidW = x - 2 * ms;
  const lid = p.lid as 'hole' | 'lip' | 'none';
  requireJointLength('rail', x - 2 * r, t, 'the back rail (x minus two rails)');
  if (lid === 'lip') requireJointLength('rail', lidW - 2 * r, t, 'the lid lip (lid width minus two rails)');

  const zb = zBottom(p);
  const X = x + 2 * t;
  const Y = y + 2 * t;
  const zl = zb + h; // top of the lower rails and the front wall; underside of the lid
  const Z = zl + g + t;
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const E: WallEdge = 'outset';
  const B: WallEdge = p.bottom === 'finger holes' ? 'fingerHoles' : F;
  const wall = (w: number, hh: number, types: WallEdges) => rectangularWall(w, hh, types, ctx);

  // Side walls: the lower rails' slot row (an interior joint, side 4) with its top at h.
  const sideWall = (types: WallEdges) => {
    const wl = wall(y, h + g, types);
    const n = wl.holes.length;
    const slots = fingerHolesFor(y, ctx).map((s) => transform(s, mat3Translate(0, h - t / 2)));
    wl.holes.push(...slots);
    wl.lines.push({ side: 4, type: 'fingerHole', from: { x: 0, y: h - t }, to: { x: y, y: h - t }, holes: slots.map((_, k) => n + k) });
    return wl;
  };
  const right = sideWall([B, { pieces: [[f, h], [E, g]] }, F, f]);
  const left = sideWall([B, f, F, { pieces: [[E, g], [f, h]] }]);

  const back = wall(x, h + g, [B, F, { pieces: [[E, r], [f, x - 2 * r], [E, r]] }, F]);

  // Front wall; the lid's front end rests on its top (lines one thickness up, on the lid's top face).
  const front = wall(x, h, [B, F, e, F]);
  const lidEnds: [number, number][] = lid === 'lip' ? [[ms, ms + r], [x - ms - r, x - ms]] : [[ms, x - ms]];
  lidEnds.forEach(([a, b], k) => front.lines.push({ side: 4 + k, type: 'flat', from: { x: a, y: h + t }, to: { x: b, y: h + t } }));

  // Lid: local x along the slide (front at local x = y), local y across.
  const lidWall = wall(y, lidW, [e, lid === 'lip' ? { pieces: [[E, r], [f, lidW - 2 * r], [E, r]] } : E, e, e]);
  if (lid === 'hole') {
    const hw = num(p, 'hole_width');
    const hl = num(p, 'hole_length');
    if (y - 1.5 * hw < t)
      throw new ParamError(`hole_width too large: a ${hw.toFixed(1)} mm grip hole does not fit on a ${y.toFixed(1)} mm lid`, 'hole_width');
    if (hl > lidW - 2 * t)
      throw new ParamError(`hole_length too large: ${hl.toFixed(1)} mm leaves less than a thickness each side of a ${lidW.toFixed(1)} mm lid`, 'hole_length');
    lidWall.holes.push(roundedRect(y - hw, lidW / 2, hw, hl, num(p, 'hole_radius')));
  }

  const lowerRail = (types: WallEdges) => wall(y, r, types);
  const topRail = (types: WallEdges) => wall(y, r, types);

  const panels: PanelSpec[] = [
    panel('front', 'Front wall', front, at([t + x, 0, zb], [-1, 0, 0], [0, 0, 1]),
      lid === 'lip'
        ? [['bottom', 0], ['left', pieceSide(3, 1)], undefined, ['right', pieceSide(1, 0)], ['lid', pieceSide(1, 0)], ['lid', pieceSide(1, 2)]]
        : [['bottom', 0], ['left', pieceSide(3, 1)], undefined, ['right', pieceSide(1, 0)], ['lid', 1]]),
    panel('right', 'Right wall', right, at([X, t + y, zb], [0, -1, 0], [0, 0, 1]),
      sparse([[0, 'bottom', 1], [pieceSide(1, 0), 'front', 3], [2, 'toprailright', 0], [3, 'back', 1], [4, 'railright', 0]])),
    panel('back', 'Back wall', back, at([t, Y, zb], [1, 0, 0], [0, 0, 1]),
      sparse([[0, 'bottom', 2], [1, 'right', 3], [pieceSide(2, 1), 'backrail', 0], [3, 'left', 1]])),
    panel('left', 'Left wall', left, at([0, t, zb], [0, 1, 0], [0, 0, 1]),
      sparse([[0, 'bottom', 3], [1, 'back', 3], [2, 'toprailleft', 0], [pieceSide(3, 1), 'front', 1], [4, 'railleft', 0]])),
    panel('bottom', 'Bottom', wall(x, y, [f, f, f, f]), at([t, t, zb - t], [1, 0, 0], [0, 1, 0]),
      [['front', 0], ['right', 0], ['back', 0], ['left', 0]]),
    // Lower rails: horizontal, lower face at zl - t, fingers out through the side walls' slots.
    panel('railright', 'Lower rail right', lowerRail([f, e, e, e]), at([X - t, t, zl - t], [0, 1, 0], [-1, 0, 0]), [['right', 4]]),
    panel('railleft', 'Lower rail left', lowerRail([f, e, e, e]), at([t, t + y, zl - t], [0, -1, 0], [1, 0, 0]), [['left', 4]]),
    // Top rails: horizontal, upper face (z = 0 side) at Z, fingers into the side walls' notched tops.
    panel('toprailright', 'Top rail right', topRail([f, E, e, e]), at([X - t, t + y, Z], [0, -1, 0], [-1, 0, 0]), [['right', 2]]),
    panel('toprailleft', 'Top rail left', topRail([f, e, e, E]), at([t, t, Z], [0, 1, 0], [1, 0, 0]), [['left', 2]]),
    panel('backrail', 'Back rail', wall(x - 2 * r, r, [F, e, e, e]), at([t + r, Y - t, Z], [1, 0, 0], [0, -1, 0]),
      [['back', pieceSide(2, 1)]]),
    panel('lid', 'Lid', lidWall, at([t + x - ms, t + y, zl + t], [0, -1, 0], [-1, 0, 0]),
      lid === 'lip'
        ? sparse([[pieceSide(1, 0), 'front', 4], [pieceSide(1, 1), 'lip', 0], [pieceSide(1, 2), 'front', 5]])
        : sparse([[1, 'front', 4]])),
  ];
  if (lid === 'lip') {
    // Lip: stands on the lid's front fingers, flush with the front; its joint line is on the lid's top face.
    const lip = wall(lidW - 2 * r, g, [F, e, e, e]);
    lip.lines = lip.lines.map((l) => (l.side === 0 ? { ...l, from: { x: 0, y: 0 }, to: { x: lidW - 2 * r, y: 0 } } : l));
    panels.push(panel('lip', 'Lid lip', lip, at([t + x - ms - r, 0, zl + t], [-1, 0, 0], [0, 0, 1]), [['lid', pieceSide(1, 1)]]));
  }
  return finishPanels(panels, t, effectiveKerf(p));
}

/** Mates for sparse side ids: `[side, part, partSide]` entries. */
function sparse(entries: [number, string, number][]): ([string, number] | undefined)[] {
  const m: ([string, number] | undefined)[] = [];
  for (const [s, part, ps] of entries) m[s] = [part, ps];
  return m;
}

export const slidingLidBox: Generator = {
  id: 'slidinglid',
  name: 'Sliding-lid box',
  category: 'Lids & hinges',
  description: 'Box with a lid that slides in over the front wall between rails; optional grip hole or lip.',
  schema,
  presets: {
    'Pencil box': { x: 60, y: 220, h: 40, inside: true, lid: 'hole', hole_length: 40, hole_width: 20, hole_radius: 10 },
    'Card deck': { x: 70, y: 95, h: 25, inside: true, lid: 'lip', rail: 2, thickness: 3 },
    'Tool box': { x: 200, y: 300, h: 100, inside: false, bottom: 'finger holes', lid: 'none', rail: 2.5, thickness: 4 },
  },
  build,
  expectedSize,
};
