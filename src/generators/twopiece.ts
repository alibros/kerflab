/**
 * TwoPiece: a box in two shells, the lid shell slipping over the body shell, ported from boxes.py
 * (florianfesti/boxes, boxes/generators/two_piece.py).
 *
 * Parts (bottom, right, top, left of each panel; boxes.py TwoPiece):
 *    base              x * y          'hhhh'   finger-hole sides: slots for the body walls, then a
 *                                              brim of thickness + clearance that the lid stands on
 *    body front/back   x * hi         'fFeF'   fingers down through the base, own the corners
 *    body left/right   y * hi         'ffef'
 *    lid front/back    (x+d) * h      'eFfF'   plain foot resting on the base brim, fingers up
 *    lid left/right    (y+d) * h      'efff'   into the lid top
 *    lid top           (x+d) * (y+d)  'FFFF'
 * with d = 2 * (thickness + clearance): the lid shell's walls stand `clearance` outside the body
 * walls all round.
 *
 * World frame: the base occupies [0, X] x [0, Y] x [0, t] with X = x + 4t + 2c, Y = y + 4t + 2c
 * (c = clearance in mm); the closed box is [0, X] x [0, Y] x [0, h + 2t]. Body walls stand on the
 * base at [t + c, X - t - c] in x and y; lid walls at [0, X] x [0, Y], from z = t up to the top.
 *
 * Joints: the lid shell rests on the base brim, declared as flat (resting) mates between each lid
 * wall's foot and a brim line of the base; that is what joins the two shells in the model.
 *
 * Deliberate differences from boxes.py: `hi` is a percentage of h and cannot exceed it (in boxes.py
 * a taller body lifts the lid off the brim); the lid clearance is its own parameter `clearance`
 * (boxes.py `play`), separate from the finger-joint play.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec, type WallEdge, type WallEdges } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x: inside the body shell, or outside the lid shell (see "Inner dimensions")',
    unit: 'mm', group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y: inside the body shell, or outside the lid shell', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 80, step: 1 },
  { key: 'h', label: 'Height', help: 'Height between base and lid top (inner), or of the closed box (outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 60, step: 1 },
  { key: 'hi', label: 'Body height', help: 'Height of the body walls as a percentage of the lid walls. Lower leaves a short ridge so the contents are easier to reach',
    unit: '', group: 'Size', kind: 'number', min: 20, max: 100, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'clearance', label: 'Lid play', help: 'Gap between the lid walls and the body walls, in multiples of thickness (boxes.py play)',
    unit: '', group: 'Box', kind: 'number', min: 0.02, max: 0.5, default: 0.15, step: 0.01 },
  ...commonParams,
];

/** Inner sizes: body inner x, y; lid wall height h; body wall height hb; c = clearance (mm). */
function innerSize(p: Params): { x: number; y: number; h: number; hb: number; c: number } {
  const t = num(p, 'thickness');
  const c = num(p, 'clearance') * t;
  const o = p.inside === false;
  const h = num(p, 'h') - (o ? 2 * t : 0);
  return { x: num(p, 'x') - (o ? 4 * t + 2 * c : 0), y: num(p, 'y') - (o ? 4 * t + 2 * c : 0), h, hb: (h * num(p, 'hi')) / 100, c };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 4 * t + 2 * i.c, y: i.y + 4 * t + 2 * i.c, z: i.h + 2 * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h, hb, c } = innerSize(p);
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  requireJointLength('h', h, t);
  requireJointLength('hi', hb, t, 'the body wall height');

  const d = 2 * (t + c);
  const X = x + 4 * t + 2 * c;
  const Y = y + 4 * t + 2 * c;
  const Z = h + 2 * t;
  const o = 2 * t + c; // body inner space starts here in x and y
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const H: WallEdge = 'fingerHoles';
  const e: WallEdge = 'flat';
  const wall = (w: number, hh: number, types: WallEdges) => rectangularWall(w, hh, types, ctx);

  // Base: slots for the body walls, brim of t + c outside them (lines declared against the slots).
  const base = rectangularWall(x, y, [H, H, H, H], ctx, { brim: t + c });
  // Brim lines (sides 4..7) where the lid walls' feet rest: the base outline, over each lid wall's inner span.
  const r = t + c;
  base.lines.push(
    { side: 4, type: 'flat', from: { x: -r, y: -o }, to: { x: x + r, y: -o } },
    { side: 5, type: 'flat', from: { x: x + o, y: -r }, to: { x: x + o, y: y + r } },
    { side: 6, type: 'flat', from: { x: x + r, y: y + o }, to: { x: -r, y: y + o } },
    { side: 7, type: 'flat', from: { x: -o, y: y + r }, to: { x: -o, y: -r } },
  );

  /** Lid wall: plain foot whose joint line is moved one thickness down, onto the base's lower face. */
  const lidWall = (w: number, types: WallEdges) => {
    const wl = wall(w, h, types);
    wl.lines = wl.lines.map((l) => (l.side === 0 ? { ...l, from: { x: 0, y: -t }, to: { x: w, y: -t } } : l));
    return wl;
  };

  const panels: PanelSpec[] = [
    panel('base', 'Base', base, at([o, o, 0], [1, 0, 0], [0, 1, 0]),
      [['front', 0], ['right', 0], ['back', 0], ['left', 0], ['lidfront', 0], ['lidright', 0], ['lidback', 0], ['lidleft', 0]]),
    // Body shell (boxes.py: the inner walls), fingers down through the base slots.
    panel('front', 'Body front', wall(x, hb, [f, F, e, F]), at([o + x, t + c, t], [-1, 0, 0], [0, 0, 1]),
      [['base', 0], ['left', 3], undefined, ['right', 1]]),
    panel('right', 'Body right', wall(y, hb, [f, f, e, f]), at([X - t - c, o + y, t], [0, -1, 0], [0, 0, 1]),
      [['base', 1], ['front', 3], undefined, ['back', 1]]),
    panel('back', 'Body back', wall(x, hb, [f, F, e, F]), at([o, Y - t - c, t], [1, 0, 0], [0, 0, 1]),
      [['base', 2], ['right', 3], undefined, ['left', 1]]),
    panel('left', 'Body left', wall(y, hb, [f, f, e, f]), at([t + c, o, t], [0, 1, 0], [0, 0, 1]),
      [['base', 3], ['back', 3], undefined, ['front', 1]]),
    // Lid shell, standing on the brim; its walls are `c` outside the body walls.
    panel('lidfront', 'Lid front', lidWall(x + d, [e, F, f, F]), at([t + x + d, 0, t], [-1, 0, 0], [0, 0, 1]),
      [['base', 4], ['lidleft', 3], ['lidtop', 2], ['lidright', 1]]),
    panel('lidright', 'Lid right', lidWall(y + d, [e, f, f, f]), at([X, t + y + d, t], [0, -1, 0], [0, 0, 1]),
      [['base', 5], ['lidfront', 3], ['lidtop', 1], ['lidback', 1]]),
    panel('lidback', 'Lid back', lidWall(x + d, [e, F, f, F]), at([t, Y, t], [1, 0, 0], [0, 0, 1]),
      [['base', 6], ['lidright', 3], ['lidtop', 0], ['lidleft', 1]]),
    panel('lidleft', 'Lid left', lidWall(y + d, [e, f, f, f]), at([0, t, t], [0, 1, 0], [0, 0, 1]),
      [['base', 7], ['lidback', 3], ['lidtop', 3], ['lidfront', 1]]),
    panel('lidtop', 'Lid top', wall(x + d, y + d, [F, F, F, F]), at([t, t + y + d, Z], [1, 0, 0], [0, -1, 0]),
      [['lidback', 2], ['lidright', 2], ['lidfront', 2], ['lidleft', 2]]),
  ];
  return finishPanels(panels, t, effectiveKerf(p));
}

export const twoPiece: Generator = {
  id: 'twopiece',
  name: 'Two-piece box',
  category: 'Lids & hinges',
  description: 'Box in two finger-jointed shells: the lid shell slips over the body shell and rests on the base brim.',
  schema,
  presets: {
    'Gift box': { x: 120, y: 120, h: 60, hi: 100, inside: true, clearance: 0.15 },
    'Display box': { x: 160, y: 100, h: 80, hi: 40, inside: false, clearance: 0.2 },
    'Card box': { x: 70, y: 95, h: 30, hi: 100, inside: true, clearance: 0.1, thickness: 2 },
  },
  build,
  expectedSize,
};
