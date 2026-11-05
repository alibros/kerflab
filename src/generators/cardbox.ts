/**
 * CardBox: a box for decks of playing cards in compartments side by side, with a lid that slides
 * out to the front over the lowered front wall, ported from boxes.py (florianfesti/boxes,
 * boxes/generators/cardbox.py, opening direction "front").
 *
 * Panels (edges bottom, right, top, left; Hs = h + t + m is the outer walls' inner height):
 *    floor          X * y    'f f f f'        slot rows for the dividers
 *    front          X * Hs   [F, F, inset, F] boxes.py InsetEdge 'a': the top is lowered by t + m
 *                                             between the corner columns, so the lid slides out over it;
 *                                             slot rows for the dividers
 *    back           X * Hs   'F F E F'        outset top, behind the lips; slot rows for the dividers
 *    sides          y * Hs   'F f F f'        notched top for the lips
 *    lips           y * t    'f e e e'        lie on the side walls (fingers into them), overhanging the lid
 *    inner sides    y * h    [e, e, A, e]     glued inside the side walls (no joints; resting on the floor);
 *                                             their tops carry the lid; finger cut-out 'A'
 *    dividers       y * h    [f, f, A, f]     fingers into the floor, front and back slot rows
 *    lid            (X - 2c) * y   [e, e, f, e]  fingers at the front into the grip rail
 *    grip rail      (X - 2c) * t   'F e e e'    stands on the front wall in front of the lid
 * X = sum(sx) + (n + 1) t (n compartments, two inner sides and n - 1 dividers). c = lid_clearance
 * (each side), m = margin_t (above the lid, below the lips).
 *
 * World frame: x across, y from the front (y = 0) to the back, z up. Outer size X + 2t, y + 2t,
 * h + 3t + m. The lid lies on the inner sides, the dividers and the front wall top (z = t + h), joined
 * to the front wall by a flat (resting) mate; each inner side rests on the floor (flat mate).
 *
 * Deliberate differences from boxes.py (docs/differences.md): opening direction "front" only;
 * lid clearances are parameters (boxes.py: 0.1 t at each side, none above); the grip rail is as wide
 * as the lid and stands on the front wall (boxes.py's outset rail ends sit over the corner columns);
 * no lid topper.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { fingerLayout } from '../core/edges/finger';
import { ParamError } from '../core/validate';
import { autoMate, LIST_PATTERN, parseList, rest, slotInto, slottedSide, TRAY_CATEGORY, wallOffsets, type PieceKind } from './trays';
import {
  at, finishPanels, num, panel, polyline, rectangularWall, requireJointLength,
  type CustomSide, type PanelSpec, type WallEdge, type WallEdges, type WallSide,
} from './walls';

const schema: Schema = [
  { key: 'sx', label: 'Compartment widths (mm)', help: 'Width of each card compartment (inner) in millimetres, even when showing inches; comma separated, e.g. "65,65,65"', group: 'Size',
    kind: 'text', default: '65,65,65,65', maxLength: 80, pattern: LIST_PATTERN, examples: ['65,65,65,65', '90', '60,60', '40,80,40'] },
  { key: 'y', label: 'Depth', help: 'Depth along y: the card width (inner), or the overall outer depth', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 300, default: 68, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the compartments: the card height (inner, floor to lid), or the overall outer height', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 300, default: 92, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: y and h are the inside. Off: they are the outside (the compartment widths are always inner)',
    group: 'Size', kind: 'bool', default: true },
  { key: 'fingerhole', label: 'Finger cut-out', help: 'Depth of the cut-out to grab the cards: regular (a quarter of the height, at most 35 mm), deep, or custom',
    group: 'Compartments', kind: 'enum', options: ['regular', 'deep', 'custom'], default: 'regular' },
  { key: 'fingerhole_depth', label: 'Custom cut-out depth', help: 'Depth of the cut-out when "Finger cut-out" is custom', unit: 'mm',
    group: 'Compartments', kind: 'number', min: 5, max: 200, default: 20, step: 1 },
  { key: 'lid_clearance', label: 'Lid side clearance', help: 'Gap between the lid and each side wall, in multiples of thickness. Zero would bind',
    unit: '', group: 'Lid', kind: 'number', min: 0.02, max: 0.5, default: 0.1, step: 0.01 },
  { key: 'margin_t', label: 'Lid vertical clearance', help: 'Gap above the lid, below the lips, in multiples of thickness (adds to the height). Zero would bind',
    unit: '', group: 'Lid', kind: 'number', min: 0.02, max: 0.5, default: 0.05, step: 0.01 },
  ...commonParams,
];

const GRIP_WIDTH = 20; // boxes.py FingerHoleEdge: 20 mm wide, 10 mm radius
const GRIP_RADIUS = 10;

function sizes(p: Params): { sx: number[]; y: number; h: number; m: number; c: number } {
  const t = num(p, 'thickness');
  const sx = parseList(p, 'sx', 12);
  if (sx.length === 0) throw new ParamError('sx must list at least one compartment width', 'sx');
  const m = num(p, 'margin_t') * t;
  const c = num(p, 'lid_clearance') * t;
  if (!(m > 0)) throw new ParamError('margin_t must be > 0: a lid without vertical clearance binds', 'margin_t');
  if (!(c > 0)) throw new ParamError('lid_clearance must be > 0: a lid without side clearance binds', 'lid_clearance');
  const o = p.inside === false;
  return { sx, y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o ? 3 * t + m : 0), m, c };
}

/** Inner width between the outer side walls. */
const innerWidth = (sx: number[], t: number): number => sx.reduce((a, b) => a + b, 0) + (sx.length + 1) * t;

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const s = sizes(p);
  return { x: innerWidth(s.sx, t) + 2 * t, y: s.y + 2 * t, z: s.h + 3 * t + s.m };
}

function gripDepth(p: Params, h: number, t: number): number {
  switch (p.fingerhole) {
    case 'deep': {
      const d = h - t - 10;
      if (!(d >= 1)) throw new ParamError(`h too small for a deep finger cut-out: it is ${d.toFixed(1)} mm deep (h - t - 10 mm)`, 'h');
      return d;
    }
    case 'custom': {
      const d = num(p, 'fingerhole_depth');
      if (!(d <= h - t)) throw new ParamError(`fingerhole_depth too large: at most h - t = ${(h - t).toFixed(1)} mm`, 'fingerhole_depth');
      return d;
    }
    default:
      return Math.min(h / 4, 35);
  }
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { sx, y, h, m, c } = sizes(p);
  for (const v of sx)
    if (!(v >= 2 * t)) throw new ParamError(`sx too small: compartment ${v} mm is less than two thicknesses (${(2 * t).toFixed(1)} mm)`, 'sx');
  requireJointLength('y', y, t, 'inner depth');
  requireJointLength('h', h, t, 'compartment height');
  if (!(y >= GRIP_WIDTH + 2 * t)) throw new ParamError(`y too small: the ${GRIP_WIDTH} mm finger cut-out needs ${(GRIP_WIDTH + 2 * t).toFixed(1)} mm`, 'y');
  const X = innerWidth(sx, t);
  const Hs = h + t + m;
  const xc = X - 2 * c; // lid width
  requireJointLength('sx', xc, t, 'lid width');
  // The front's corner columns are notched for the side walls' fingers; the topmost notch must stay
  // below the lowered top, or it would cut the column off.
  const fl = fingerLayout(Hs, ctx);
  if (fl.fingers > 0 && !(Hs - fl.margin + ctx.play / 2 < h - 1e-3))
    throw new ParamError(`h too small: the side walls' top finger reaches into the lid slot of the front wall (h = ${h.toFixed(1)} mm)`, 'h');
  const depth = gripDepth(p, h, t);
  const grip = { depth, rel: GRIP_WIDTH / y, radius: GRIP_RADIUS };
  const gripTop = (): WallSide => slottedSide({ pieces: [y], gaps: [] }, 'grip' satisfies PieceKind, 0, ctx, grip);

  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const wall = (w: number, hh: number, types: WallEdges) => rectangularWall(w, hh, types, ctx);
  /** boxes.py InsetEdge: the top lowered by d over its whole length. */
  const inset = (d: number): CustomSide => ({ start: 0, end: 0, draw: (tt, len) => polyline(tt, [0, 90, d, -90, len, -90, d, 90, 0]) });

  const XO = X + 2 * t;
  const YO = y + 2 * t;
  const zLid = 2 * t + h; // top face of the lid
  const zTop = 2 * t + Hs; // top of the lips, side and back walls

  const floor = panel('floor', 'Floor', wall(X, y, [f, f, f, f]), at([t, t, 0], [1, 0, 0], [0, 1, 0]), []);
  const front = panel('front', 'Front', wall(X, Hs, [F, F, inset(t + m), F]), at([t + X, 0, t], [-1, 0, 0], [0, 0, 1]), []);
  const back = panel('back', 'Back', wall(X, Hs, [F, F, 'outset', F]), at([t, YO, t], [1, 0, 0], [0, 0, 1]), []);
  const left = panel('left', 'Left side', wall(y, Hs, [F, f, F, f]), at([0, t, t], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right side', wall(y, Hs, [F, f, F, f]), at([XO, t + y, t], [0, -1, 0], [0, 0, 1]), []);
  // Lips: u along the side, v towards the box centre, normal -z (top face z = 0 at zTop).
  const lipL = panel('lipleft', 'Lip (left)', wall(y, t, [f, e, e, e]), at([t, t, zTop], [0, 1, 0], [1, 0, 0]), []);
  const lipR = panel('lipright', 'Lip (right)', wall(y, t, [f, e, e, e]), at([XO - t, t + y, zTop], [0, -1, 0], [-1, 0, 0]), []);
  // Inner sides, against the side walls; normal into the box.
  const innerL = panel('innerleft', 'Inner side (left)', wall(y, h, [e, e, gripTop(), e]), at([t, t, t], [0, 1, 0], [0, 0, 1]), []);
  const innerR = panel('innerright', 'Inner side (right)', wall(y, h, [e, e, gripTop(), e]), at([XO - t, t + y, t], [0, -1, 0], [0, 0, 1]), []);
  // Dividers: z = 0 face at x = 2t + offset, normal +x.
  const dividers = wallOffsets(sx, t).map((o, i) =>
    panel(`divider${i + 1}`, 'Divider', wall(y, h, [f, f, gripTop(), f]), at([2 * t + o, t, t], [0, 1, 0], [0, 0, 1]), []));
  for (const d of dividers) {
    slotInto(floor, d, [0], ctx);
    slotInto(back, d, [1], ctx);
    slotInto(front, d, [3], ctx);
  }
  // Lid: u = +x from x = t + c, v = -y from the back wall's inner face, normal -z (top face z = 0).
  const lid = panel('lid', 'Lid', wall(xc, y, [e, e, f, e]), at([t + c, t + y, zLid], [1, 0, 0], [0, -1, 0]), []);
  // Grip rail: stands on the front wall in front of the lid's fingers; u = -x, normal +y. Its notched
  // bottom joint is declared on the lid's top face (the notch tops), where the lid's fingers end.
  const rail = wall(xc, t, [F, e, e, e]);
  rail.lines = rail.lines.map((l) => (l.side === 0 ? { ...l, from: { x: 0, y: 0 }, to: { x: xc, y: 0 } } : l));
  const gripRail = panel('griprail', 'Grip rail', rail, at([t + c + xc, 0, zLid], [-1, 0, 0], [0, 0, 1]), []);

  // The lid rests on the front wall top: along the front face at the lid's underside (its inner face).
  rest(lid, front, [t + c, 0, t + h], [t + c + xc, 0, t + h], 50, t, [true, false]);
  // Inner sides rest on the floor: along their outer faces at the floor's top (its inner face).
  rest(innerL, floor, [t, t, t], [t, t + y, t], 50, t, [false, true]);
  rest(innerR, floor, [XO - t, t + y, t], [XO - t, t, t], 51, t, [false, true]);

  const specs: PanelSpec[] = [floor, front, back, left, right, lipL, lipR, innerL, innerR, ...dividers, lid, gripRail];
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const cardBox: Generator = {
  id: 'cardbox',
  name: 'Card box',
  category: TRAY_CATEGORY,
  description: 'Box for decks of playing cards side by side, with finger cut-outs and a lid sliding out over the front.',
  schema,
  presets: {
    'Four decks': { sx: '65,65,65,65', y: 68, h: 92, fingerhole: 'regular', inside: true },
    'Two tarot decks': { sx: '75,75', y: 125, h: 75, fingerhole: 'deep', inside: true, thickness: 3 },
    'Single deck': { sx: '23', y: 68, h: 95, fingerhole: 'custom', fingerhole_depth: 25, inside: true, lid_clearance: 0.15, margin_t: 0.1 },
  },
  build,
  expectedSize,
};
