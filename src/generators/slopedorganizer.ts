/**
 * Sloped organizer: one row of compartments with a back wall and a (usually lower) front wall,
 * the side walls and dividers running from one to the other in a straight slope or an S curve.
 * Generic version of boxes.py (florianfesti/boxes) SlantedTray (boxes/generators/slantedtray.py),
 * MagazineFile (magazinefile.py) and, with a full-height front and grip cut-outs, NotesHolder
 * (notesholder.py); those are presets.
 *
 * Joints (edges listed bottom, right, top, left of each panel; boxes.py SlantedTray in brackets):
 *    back      x * h    'f F e F'   fingers into the bottom; owns the back corners   ('eFfF')
 *    bottom    x * y    'f F F F'   fingers into the front wall                      ('FFfF')
 *    front     x * hf   'F F g F'   notched for the bottom; owns the front corners; optional
 *                                   rounded grip cut-out over each compartment     ('FFeF')
 *    sides     profile  'f f ~ f'   y deep, hf at the front, h at the back           ('ffef')
 *    dividers  as the sides, fingers through slot rows in the back, bottom and front
 * The S curve (boxes.py MagazineFile `side`): from the back's top towards the front a convex
 * quarter circle, a straight drop, a concave quarter circle; radius min(h - hf, y) / 2, straight
 * parts taking up the rest.
 *
 * World frame: x across (compartments left to right), y from the front (y = 0) to the back, z up;
 * outer size x, y, h.
 *
 * Deliberate differences from boxes.py (docs/differences.md): equal compartments; the front height
 * is a fraction of the back height; MagazineFile's sides are fingered into the front and back
 * (boxes.py: the walls are fingered into the sides) and it has no mounting holes; NotesHolder's
 * open front slots are rounded grip cut-outs (no stackable feet, no U-slot in the bottom).
 */
import { fingerJoint } from '../core/edges/finger';
import type { EdgeCtx } from '../core/edges/types';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { mirrorWall } from './flexwall';
import { traceTo } from './storage';
import { autoMate, equal, requireMaxSize, slotInto, slottedSide, span, TRAY_CATEGORY, wallOffsets } from './trays';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec, type Wall } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Compartment width', help: 'Width of each compartment (inner), or the overall outer width when "Inner dimensions" is off', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 400, default: 40, step: 1 },
  { key: 'cols', label: 'Compartments', help: 'Number of compartments side by side', unit: '', group: 'Size', kind: 'int', min: 1, max: 10, default: 3 },
  { key: 'y', label: 'Depth', help: 'Depth from the front to the back (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 400, default: 40, step: 1 },
  { key: 'h', label: 'Back height', help: 'Height of the back wall (inner, above the bottom; or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 500, default: 40, step: 1 },
  { key: 'front', label: 'Front height', help: 'Height of the front wall as a fraction of the back height (1: as high)', unit: '',
    group: 'Size', kind: 'number', min: 0.1, max: 1, default: 0.3, step: 0.05 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x is one compartment, y and h the inside. Off: they are the overall outer size',
    group: 'Size', kind: 'bool', default: true },
  { key: 'profile', label: 'Side profile', help: 'Side walls sloping straight from the back to the front, or sweeping down in an S curve (magazine file)',
    group: 'Shape', kind: 'enum', options: ['straight', 'curve'], default: 'straight' },
  { key: 'grip', label: 'Front cut-out', help: 'Rounded cut-out in the front wall over each compartment, as a fraction of its width (0: none)', unit: '',
    group: 'Shape', kind: 'number', min: 0, max: 0.8, default: 0, step: 0.05 },
  { key: 'grip_depth', label: 'Cut-out depth', help: 'Depth of the front cut-outs as a fraction of the front height', unit: '',
    group: 'Shape', kind: 'number', min: 0.1, max: 0.8, default: 0.5, step: 0.05 },
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

function inner(p: Params): { sx: number[]; y: number; h: number; hf: number } {
  const t = num(p, 'thickness');
  const n = num(p, 'cols');
  const out = p.inside === false;
  const sx = out ? equal(num(p, 'x') - (n + 1) * t, n) : equal(n * num(p, 'x'), n);
  const y = num(p, 'y') - (out ? 2 * t : 0);
  const h = num(p, 'h') - (out ? t : 0);
  return { sx, y, h, hf: num(p, 'front') * h };
}

/**
 * Side / divider profile: local x from the front inner face (x = 0) to the back one (x = w), y up
 * from the bottom's top face; fingers on the bottom (side 0), back (side 1) and front (side 3).
 */
export function profileWall(w: number, hf: number, h: number, curve: boolean, ctx: EdgeCtx): Wall {
  const t = ctx.thickness;
  const tt = new Turtle({ x: 0, y: 0 });
  fingerJoint(tt, w, ctx);
  tt.turn(90);
  fingerJoint(tt, h, ctx);
  tt.turn(90);
  const d = h - hf;
  if (curve && d > 1e-6) {
    const r = Math.min(d, w) / 2;
    tt.forward(d > w ? 0 : (w - 2 * r) / 2);
    tt.arc(r, 90);
    tt.forward(d > w ? d - w : 0);
    tt.arc(r, -90);
    tt.forward(d > w ? 0 : (w - 2 * r) / 2);
  } else traceTo(tt, [{ x: 0, y: hf }]);
  tt.turn(90);
  fingerJoint(tt, hf, ctx);
  tt.turn(90);
  return {
    outline: tt.toPath(true), holes: [],
    lines: [
      { side: 0, type: 'finger', from: { x: 0, y: -t }, to: { x: w, y: -t } },
      { side: 1, type: 'finger', from: { x: w + t, y: 0 }, to: { x: w + t, y: h } },
      { side: 3, type: 'finger', from: { x: -t, y: hf }, to: { x: -t, y: 0 } },
    ],
  };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { sx, y, h, hf } = inner(p);
  requireJointLength('x', sx[0]!, t, 'compartment width');
  requireJointLength('y', y, t);
  requireJointLength('h', h, t, 'inner back height');
  if (!(hf >= 3 * t))
    throw new ParamError(`front too small: the front wall would be ${hf.toFixed(1)} mm high inside, needs at least 3 * thickness = ${(3 * t).toFixed(1)} mm`, 'front');
  const x = span(sx, t);
  requireMaxSize('x', x);
  const X = x + 2 * t;
  const Y = y + 2 * t;
  const curve = p.profile === 'curve';
  const g = num(p, 'grip');
  // Grip cut-outs end at least 2t above the bottom's top face (clear of the bottom's fingers).
  const gd = Math.min(num(p, 'grip_depth') * hf, hf - 2 * t);
  const top = g > 0 && gd > 1e-6
    ? slottedSide({ pieces: sx, gaps: sx.slice(1).map(() => t) }, 'grip', 0, ctx, { depth: gd, rel: g })
    : 'flat' as const;

  const back = panel('back', 'Back', rectangularWall(x, h, ['finger', 'fingerHole', 'flat', 'fingerHole'], ctx), at([t, Y, t], [1, 0, 0], [0, 0, 1]), []);
  const bottom = panel('bottom', 'Bottom', rectangularWall(x, y, ['finger', 'fingerHole', 'fingerHole', 'fingerHole'], ctx), at([t, t, 0], [1, 0, 0], [0, 1, 0]), []);
  const frontWall = rectangularWall(x, hf, ['fingerHole', 'fingerHole', top, 'fingerHole'], ctx);
  const front = panel('front', 'Front', frontWall, at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]), []);
  const side = profileWall(y, hf, h, curve, ctx);
  const specs: PanelSpec[] = [back, bottom, front,
    panel('left', 'Left side', side, at([0, t, t], [0, 1, 0], [0, 0, 1]), []),
    panel('right', 'Right side', mirrorWall(side, y), at([X, t + y, t], [0, -1, 0], [0, 0, 1]), [])];
  wallOffsets(sx, t).forEach((o, k) => {
    const d = panel(`divider${k + 1}`, `Divider ${k + 1}`, profileWall(y, hf, h, curve, ctx), at([t + o, t, t], [0, 1, 0], [0, 0, 1]), []);
    slotInto(bottom, d, [0], ctx);
    slotInto(back, d, [1], ctx);
    slotInto(front, d, [3], ctx);
    specs.push(d);
  });
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const slopedOrganizer: Generator = {
  id: 'slopedorganizer',
  name: 'Sloped organizer',
  category: TRAY_CATEGORY,
  description: 'Row of compartments with a high back and a low front, straight or S-curved sides: slanted tray, magazine file, notes or card holder (SlantedTray, MagazineFile, NotesHolder).',
  schema,
  presets: {
    'SlantedTray': { x: 40, cols: 3, y: 40, h: 40, front: 0.3, profile: 'straight', grip: 0, inside: true },
    'MagazineFile': { x: 100, cols: 1, y: 200, h: 300, front: 0.5, profile: 'curve', grip: 0, inside: true },
    'NotesHolder (sticky notes)': { x: 78, cols: 2, y: 78, h: 35, front: 1, profile: 'straight', grip: 0.4, grip_depth: 0.6, inside: true },
    'Card piles': { x: 70, cols: 4, y: 95, h: 60, front: 0.35, profile: 'straight', grip: 0, inside: true },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    const { sx, y, h } = inner(p);
    return { x: span(sx, t) + 2 * t, y: y + 2 * t, z: h + t };
  },
};
