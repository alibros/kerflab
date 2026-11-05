/**
 * IntegratedHingeBox: a box with a lid on a hinge cut into the side walls (boxes.py chest hinge),
 * ported from boxes.py (florianfesti/boxes, boxes/generators/integratedhingebox.py and the
 * ChestHinge / ChestHingeTop / ChestHingePin edges in boxes/edges.py).
 *
 * The hinge: the top of each box side ends at the back in a ring (outer radius R = pin + strength)
 * around a round hole of radius `pin`, centred on the back face at the top of the box. A loose disc
 * turns in that hole; the lid back's pins (one at each end, one thickness long, `pinh` tall) sit in
 * a rectangular hole in the disc, so the lid turns about the ring centre. The lid sides end in a
 * concave arc that clears the ring by the hinge play.
 *
 * Parts (bottom, right, top, left of each panel; R = pin + strength, Rl = R + hinge play):
 *    box front     x * h         [F, F|E, e, E|F]   outset over the top R where the sides are plain
 *    box back      x * h         [F, F|e, e, e|F]   plain (narrower) over the top R, under the rings
 *    box sides     y * (h - R)   [F, f, hinge, f]   the hinge top with its ring
 *    bottom        x * y         'ffff'
 *    lid front     x * hl        [e, E|F, F, F|E]   rests on the box front
 *    lid back      x * (hl - Rl) [pins, F, F, F]    pins at the bottom, into the discs
 *    lid sides     y * (hl - Rl) [arc, f, F, f]     concave arc around the ring
 *    lid top       x * y         'ffff'
 *    discs (2)     radius pin - play/2, with the pin hole
 *
 * World frame: the closed box is [0, X] x [0, Y] x [0, Z], X = x + 2t, Y = y + 2t, Z = 2t + h + hl
 * (inner h, hl), plus the hinge rings, which stand R beyond the back face (y up to Y + R) around
 * the axis (y = Y, z = t + h).
 *
 * Joints: the lid front rests on the box front (a flat, resting mate); each lid-back pin is an
 * interior 'hinge' joint in its disc's 'slot' hole. The discs are loose in the rings (no mate).
 *
 * Deliberate differences from boxes.py: the disc is a separate part instead of a tabbed cut-out,
 * with the hinge play (> 0, or the disc binds) as clearance (boxes.py relies on the kerf); the box and lid fronts are
 * outset over the hinge band so their finger joints match the shorter side walls (boxes.py lays
 * the front fingers out over the full height); the lid sides' arc starts at the inner back face
 * instead of a hair-thin sliver to the outer face; no finger joints on the hinge itself
 * (`finger_joints_on_box` / `_on_lid` off).
 */
import { edgeFor } from '../core/edges';
import type { EdgeCtx } from '../core/edges/types';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import {
  at, circle, finishPanels, num, panel, pieceSide, polyline, rect, rectangularWall, requireJointLength,
  type CustomSide, type PanelSpec, type PolyItem, type Wall, type WallEdge, type WallEdges,
} from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y, front to hinge (inner or outer; the hinge rings stand out behind)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the box without the lid (inner: above the bottom; outer: including it)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'lidheight', label: 'Lid height', help: 'Height of the lid (inner: below the lid top; outer: including it)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 500, default: 30, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: sizes are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'pin', label: 'Pin radius', help: 'Radius of the disc turning in the hinge ring, in multiples of thickness',
    unit: '', group: 'Hinge', kind: 'number', min: 1.2, max: 4, default: 2, step: 0.1 },
  { key: 'strength', label: 'Hinge strength', help: 'Width of the ring holding the disc, in multiples of thickness',
    unit: '', group: 'Hinge', kind: 'number', min: 0.5, max: 3, default: 1, step: 0.1 },
  { key: 'hingeplay', label: 'Hinge play', help: 'Clearance between the lid and the hinge ring, and around the disc, in multiples of thickness',
    unit: '', group: 'Hinge', kind: 'number', min: 0.01, max: 0.2, default: 0.1, step: 0.01 },
  ...commonParams,
];

export function innerSize(p: Params): { x: number; y: number; h: number; hl: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o ? t : 0), hl: num(p, 'lidheight') - (o ? t : 0) };
}

/** Hinge geometry (mm): disc radius p, ring outer radius R, lid arc radius Rl, pin height, play q. */
export function hingeDims(p: Params): { p: number; R: number; Rl: number; pinh: number; q: number } {
  const t = num(p, 'thickness');
  const pr = num(p, 'pin') * t;
  const q = num(p, 'hingeplay') * t;
  const R = pr + num(p, 'strength') * t;
  return { p: pr, R, Rl: R + q, pinh: Math.sqrt((0.9 * pr) ** 2 - t * t), q };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 2 * t, y: i.y + 2 * t + hingeDims(p).R, z: i.h + i.hl + 2 * t };
}

/** Dimensions of a built chest-hinge box (mm, world frame as in the file comment). */
export type ChestHinge = { x: number; y: number; h: number; hl: number; H1: number; H2: number; X: number; Y: number; Z: number; R: number; Rl: number };

/**
 * The panels of the hinged box (shared with dicebox, which adds its plates); mates are set, call
 * finishPanels on the result. `inner` overrides the inner size (default from `x`, `y`, `h`,
 * `lidheight` and `inside`).
 *
 * `plates` (dicebox): the box front and back end at the top in a notched finger edge for a plate
 * whose top face is flush with the hinge axis plane (z = t + h), and the lid front and back
 * (between its pins) start at the bottom with one for a plate whose bottom face is that plane, so
 * the two plates touch when the lid is shut. Those four sides are left unmated (the caller adds
 * the plates and mates them) and the lid front no longer rests on the box front: the lid rests
 * on the box through the plates.
 */
export function chestHingePanels(p: Params, ctx: EdgeCtx, inner = innerSize(p), plates = false): { panels: PanelSpec[]; dims: ChestHinge } {
  const t = ctx.thickness;
  const { x, y, h, hl } = inner;
  const { p: pr, R, Rl, pinh, q } = hingeDims(p);
  const H1 = h - R; // box side wall height below the hinge band
  const H2 = hl - Rl; // lid side wall height above the hinge band
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  requireJointLength('h', H1, t, 'the box height below the hinge (h minus pin and strength)');
  requireJointLength('lidheight', H2, t, 'the lid height above the hinge (lid height minus pin, strength and play)');
  if (y < Rl + t)
    throw new ParamError(`y too small: inner depth ${y.toFixed(2)} mm, the hinge needs at least ${(Rl + t).toFixed(2)} mm`, 'y');

  const X = x + 2 * t;
  const Y = y + 2 * t;
  const Z = 2 * t + h + hl;
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const E: WallEdge = 'outset';
  const wall = (w: number, hh: number, types: WallEdges) => rectangularWall(w, hh, types, ctx);

  /** boxes.py ChestHinge ('o' / reversed 'O'): straight top, then the ring at the back. */
  const hingeTop = (reversed: boolean): CustomSide => ({
    start: reversed ? R : 0,
    end: reversed ? 0 : R,
    draw: (tt, len) => {
      const poly: PolyItem[] = [0, -180, t, [270, R], 0, -90, len + t - R];
      polyline(tt, reversed ? [...poly].reverse() : poly);
    },
  });
  /** boxes.py ChestHingeTop ('p' / 'P'): concave arc of radius Rl about the ring centre, then straight. */
  const c = Rl - Math.sqrt(Rl * Rl - t * t);
  const phi = (Math.atan2(Math.sqrt(Rl * Rl - t * t), t) * 180) / Math.PI;
  const lidArc = (reversed: boolean): CustomSide => ({
    start: reversed ? Rl : 0,
    end: reversed ? 0 : Rl,
    draw: (tt, len) => {
      const poly: PolyItem[] = [0, -90, c, phi, 0, [-phi, Rl], 0, 90, len + t - Rl];
      polyline(tt, reversed ? [...poly].reverse() : poly);
    },
  });
  /** boxes.py ChestHingePin ('q'): the lid back's bottom, pinh-tall pins one thickness out at both ends. */
  const pins: CustomSide = {
    start: 0,
    end: 0,
    draw: (tt, len) => {
      const poly: PolyItem[] = [0, -90, Rl - pinh, -90, t, 90, pinh, 90];
      polyline(tt, poly);
      if (plates) {
        tt.forward(t);
        edgeFor('fingerHole')(tt, len, ctx);
        tt.forward(t);
      } else tt.forward(len + 2 * t);
      polyline(tt, [0, ...[...poly].reverse()]);
    },
  };

  // Box. Side walls: local x = 0 at the back for the right wall (ring at x = -t), at the front for the left.
  const right = wall(y, H1, [F, f, hingeTop(true), f]);
  right.holes.push(circle(-t, h, pr));
  const left = wall(y, H1, [F, f, hingeTop(false), f]);
  left.holes.push(circle(y + t, h, pr));
  // With plates the box front and back are one thickness lower, their notched top edge drawn at z1.
  const pt = plates ? t : 0;
  const top: WallEdge = plates ? F : e;
  const front = wall(x, h - pt, [F, { pieces: [[F, H1], [E, R - pt]] }, top, { pieces: [[E, R - pt], [F, H1]] }]);
  const back = wall(x, h - pt, [F, { pieces: [[F, H1], [e, R - pt]] }, top, { pieces: [[e, R - pt], [F, H1]] }]);

  // Lid. With plates the lid front starts one thickness higher, its notched bottom edge drawn at z1.
  const lidFront = wall(x, hl - pt, [top, { pieces: [[E, Rl - pt], [F, H2]] }, F, { pieces: [[F, H2], [E, Rl - pt]] }]);
  const lidBack = wall(x, H2, [pins, F, F, F]);
  if (plates) lidBack.lines.push({ side: 0, type: 'fingerHole', from: { x: 0, y: -Rl }, to: { x, y: -Rl } });
  lidBack.lines.push(
    { side: 4, type: 'hinge', from: { x: -t, y: -(Rl - pinh) }, to: { x: -t, y: -Rl } },
    { side: 5, type: 'hinge', from: { x: x + t, y: -Rl }, to: { x: x + t, y: -(Rl - pinh) } },
  );
  const lidRight = wall(y, H2, [lidArc(false), f, F, f]);
  const lidLeft = wall(y, H2, [lidArc(true), f, F, f]);

  /** Loose disc in a ring, with the pin hole; local frame = its side wall's. */
  const disc = (cx: number, hx: number): Wall => ({
    outline: circle(cx, h, pr - q / 2),
    holes: [rect(Math.min(hx, cx), h, Math.max(hx, cx), h + pinh)],
    lines: [{ side: 0, type: 'slot', from: { x: cx, y: h }, to: { x: cx, y: h + pinh }, holes: [0] }],
  });

  const z1 = t + h; // hinge axis height, top of the box walls
  const panels: PanelSpec[] = [
    panel('front', 'Front wall', front, at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]),
      sparse([[0, 'bottom', 0], [pieceSide(1, 0), 'left', 3], ...(plates ? [] : [[2, 'lidfront', 0] as Mate]), [pieceSide(3, 1), 'right', 1]])),
    panel('right', 'Right wall', right, at([X, t + y, t], [0, -1, 0], [0, 0, 1]),
      [['bottom', 1], ['front', pieceSide(3, 1)], undefined, ['back', pieceSide(1, 0)]]),
    panel('back', 'Back wall', back, at([t, Y, t], [1, 0, 0], [0, 0, 1]),
      sparse([[0, 'bottom', 2], [pieceSide(1, 0), 'right', 3], [pieceSide(3, 1), 'left', 1]])),
    panel('left', 'Left wall', left, at([0, t, t], [0, 1, 0], [0, 0, 1]),
      [['bottom', 3], ['back', pieceSide(3, 1)], undefined, ['front', pieceSide(1, 0)]]),
    panel('bottom', 'Bottom', wall(x, y, [f, f, f, f]), at([t, t, 0], [1, 0, 0], [0, 1, 0]),
      [['front', 0], ['right', 0], ['back', 0], ['left', 0]]),
    panel('lidfront', 'Lid front', lidFront, at([t + x, 0, z1 + pt], [-1, 0, 0], [0, 0, 1]),
      sparse([...(plates ? [] : [[0, 'front', 2] as Mate]), [pieceSide(1, 1), 'lidleft', 3], [2, 'lidtop', 2], [pieceSide(3, 0), 'lidright', 1]])),
    panel('lidback', 'Lid back', lidBack, at([t, Y, z1 + Rl], [1, 0, 0], [0, 0, 1]),
      [undefined, ['lidright', 3], ['lidtop', 0], ['lidleft', 1], ['discleft', 0], ['discright', 0]]),
    panel('lidright', 'Lid right', lidRight, at([X, t + y, z1 + Rl], [0, -1, 0], [0, 0, 1]),
      [undefined, ['lidfront', pieceSide(3, 0)], ['lidtop', 1], ['lidback', 1]]),
    panel('lidleft', 'Lid left', lidLeft, at([0, t, z1 + Rl], [0, 1, 0], [0, 0, 1]),
      [undefined, ['lidback', 3], ['lidtop', 3], ['lidfront', pieceSide(1, 1)]]),
    panel('lidtop', 'Lid top', wall(x, y, [f, f, f, f]), at([t, t + y, Z], [1, 0, 0], [0, -1, 0]),
      [['lidback', 2], ['lidright', 2], ['lidfront', 2], ['lidleft', 2]]),
    panel('discright', 'Hinge disc right', disc(-t, 0), at([X, t + y, t], [0, -1, 0], [0, 0, 1]), [['lidback', 5]]),
    panel('discleft', 'Hinge disc left', disc(y + t, y), at([0, t, t], [0, 1, 0], [0, 0, 1]), [['lidback', 4]]),
  ];
  return { panels, dims: { x, y, h, hl, H1, H2, X, Y, Z, R, Rl } };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  return finishPanels(chestHingePanels(p, ctx).panels, ctx.thickness, effectiveKerf(p));
}

type Mate = [number, string, number];

/** Mates for sparse side ids: `[side, part, partSide]` entries. */
function sparse(entries: Mate[]): ([string, number] | undefined)[] {
  const m: ([string, number] | undefined)[] = [];
  for (const [s, part, ps] of entries) m[s] = [part, ps];
  return m;
}

export const integratedHingeBox: Generator = {
  id: 'integratedhinge',
  name: 'Integrated-hinge box',
  category: 'Lids & hinges',
  description: 'Box whose lid turns on a hinge cut into the side walls: rings, loose discs and pins, no hardware.',
  schema,
  presets: {
    'Keepsake box': { x: 120, y: 80, h: 60, lidheight: 30, inside: true },
    'Jewellery box': { x: 160, y: 100, h: 50, lidheight: 25, inside: false, thickness: 3, pin: 1.8, strength: 1.2 },
    'Tool chest': { x: 300, y: 180, h: 150, lidheight: 60, inside: false, thickness: 6, pin: 2, strength: 1 },
  },
  build,
  expectedSize,
};
