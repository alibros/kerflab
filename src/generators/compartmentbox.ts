/**
 * CompartmentBox: a type tray with a sliding lid that rests on the inner walls, held down by a lip
 * on each side wall, ported from boxes.py (florianfesti/boxes, boxes/generators/compartmentbox.py).
 *
 * Body: typetray's `gridTray` (floor, crossing inner walls of height h), with
 *    front        X * h            'F F e F'   the lid slides out over it
 *    back         X * (h + t + m)  'F F E F'   outset top: one thickness higher, behind the lips
 *    sides        Y * (h + t + m)  bottom 'F', top 'F' for the lip, back end 'f', front end
 *                                  compound 'f' (h) + 'E' (t + m) over the front wall
 *    lips         Y * t, lying on the side walls' tops ('f' into them), overhanging the lid by
 *                 one thickness; front end 'E' (outset to the front face) unless handle = lip
 * Lid: (X - 2 ms) wide, resting on the inner walls and the front wall top, m (margin_t) below the
 * lips. handle = lip: a lid of depth Y with fingers into a strip standing on the front wall
 * ("lid lip", t + m / 2 high above the lid); hole: depth Y + t with a rounded grip hole; none:
 * depth Y + t, plain. The lid is joined to the front wall by a flat (resting) mate.
 *
 * World frame: x across, y from the front (y = 0) to the back, z up. Outer size X + 2t, Y + 2t,
 * h + 3t + m (floor, lid, lip).
 *
 * Deliberate differences from boxes.py (docs/differences.md): equal compartments (x, y, cols,
 * rows) instead of sx/sy lists; always a finger-jointed floor (no stackable or plain bottom); split
 * lips only (no one-piece lip); one grip hole (`holes` as a fraction of the width, not a list).
 */
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { autoMate, equal, localOn, span, TRAY_CATEGORY } from './trays';
import { checkGrid, gridParams, gridTray } from './typetray';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, roundedRect, type CompoundSide, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Compartment width', help: 'Width of each compartment (inner), or the overall outer width when "Inner dimensions" is off', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 400, default: 50, step: 1 },
  { key: 'y', label: 'Compartment depth', help: 'Depth of each compartment (inner), or the overall outer depth', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 400, default: 50, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the compartments (inner, floor to lid), or the overall outer height', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 300, default: 40, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y are one compartment and h the inner height. Off: they are the overall outer size',
    group: 'Size', kind: 'bool', default: true },
  ...gridParams,
  { key: 'handle', label: 'Lid handle', help: 'How to grab the lid: a lip at its front edge, a grip hole, or none',
    group: 'Lid', kind: 'enum', options: ['lip', 'hole', 'none'], default: 'lip' },
  { key: 'radius', label: 'Grip hole radius', help: 'Corner radius (half the height) of the grip hole', unit: 'mm',
    group: 'Lid', kind: 'number', min: 2, max: 30, default: 10, step: 0.5 },
  { key: 'holes', label: 'Grip hole width', help: 'Width of the grip hole as a fraction of the lid width', unit: '',
    group: 'Lid', kind: 'number', min: 0.1, max: 1, default: 0.7, step: 0.05 },
  { key: 'margin_t', label: 'Vertical margin', help: 'Clearance above the lid, in multiples of thickness (adds to the height)', unit: '',
    group: 'Lid', kind: 'number', min: 0.02, max: 1, default: 0.1, step: 0.01 },
  { key: 'margin_s', label: 'Side margin', help: 'Clearance at each side of the lid, in multiples of thickness', unit: '',
    group: 'Lid', kind: 'number', min: 0.02, max: 0.5, default: 0.05, step: 0.01 },
  ...commonParams,
];

function inner(p: Params): { sx: number[]; sy: number[]; h: number } {
  const t = num(p, 'thickness');
  const nx = num(p, 'cols');
  const ny = num(p, 'rows');
  const mv = num(p, 'margin_t') * t;
  if (p.inside !== false) return { sx: equal(nx * num(p, 'x'), nx), sy: equal(ny * num(p, 'y'), ny), h: num(p, 'h') };
  return { sx: equal(num(p, 'x') - (nx + 1) * t, nx), sy: equal(num(p, 'y') - (ny + 1) * t, ny), h: num(p, 'h') - 3 * t - mv };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = inner(p);
  return { x: span(i.sx, t) + 2 * t, y: span(i.sy, t) + 2 * t, z: i.h + 3 * t + num(p, 'margin_t') * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { sx, sy, h } = inner(p);
  checkGrid(sx, sy, t, { x: 'x', y: 'y' });
  requireJointLength('h', h, t, 'inner height');
  const X = span(sx, t);
  const Y = span(sy, t);
  const mv = num(p, 'margin_t') * t;
  const ms = num(p, 'margin_s') * t;
  const handle = p.handle as 'lip' | 'hole' | 'none';
  const H = h + t + mv; // side and back walls (inner height above the floor)
  const xc = X - 2 * ms;
  requireJointLength('x', xc, t, 'lid width');

  const leftFront: CompoundSide = { pieces: [['outset', t + mv], ['finger', h]] }; // side 3 runs top -> bottom
  const rightFront: CompoundSide = { pieces: [['finger', h], ['outset', t + mv]] }; // side 1 runs bottom -> top
  const body = gridTray({
    sx, sy, h, hi: h, floor: true, fingerholes: 'none', gripDepth: 0,
    outer: {
      back: { h: H, edges: ['fingerHole', 'fingerHole', 'outset', 'fingerHole'] },
      left: { h: H, edges: ['fingerHole', 'finger', 'fingerHole', leftFront] },
      right: { h: H, edges: ['fingerHole', rightFront, 'fingerHole', 'finger'] },
    },
  }, ctx);
  const zf = body.zf;
  const zLid = zf + h + t; // top face of the lid
  const zTop = zLid + mv + t; // top of the lips, side and back walls

  // Lips: u = +y (left) / -y (right), v across towards the box centre, normal -z (top face z = 0).
  const lipEnd = handle === 'lip' ? 'flat' : 'outset';
  const lipL = panel('lipleft', 'Lip (left)', rectangularWall(Y, t, ['finger', 'flat', 'flat', lipEnd], ctx), at([t, t, zTop], [0, 1, 0], [1, 0, 0]), []);
  const lipR = panel('lipright', 'Lip (right)', rectangularWall(Y, t, ['finger', lipEnd, 'flat', 'flat'], ctx), at([X + t, t + Y, zTop], [0, -1, 0], [-1, 0, 0]), []);

  // Lid: u = +x from x = t + ms, v = -y from the back wall's inner face, normal -z (top face z = 0).
  const lidDepth = handle === 'lip' ? Y : Y + t;
  const lidWall = rectangularWall(xc, lidDepth, ['flat', 'flat', handle === 'lip' ? 'finger' : 'flat', 'flat'], ctx);
  const lid = panel('lid', 'Lid', lidWall, at([t + ms, t + Y, zLid], [1, 0, 0], [0, -1, 0]), []);
  const specs: PanelSpec[] = [...body.specs, lipL, lipR, lid];
  if (handle === 'hole') {
    const r = num(p, 'radius');
    if (!(2 * r <= Y - t)) throw new ParamError(`radius too large: the grip hole (${(2 * r).toFixed(1)} mm high) must fit the lid with a thickness to spare`, 'radius');
    const w = num(p, 'holes') * (xc - 2 * t);
    if (!(w >= 2 * r)) throw new ParamError(`holes too small: the grip hole is narrower (${w.toFixed(1)} mm) than its height (${(2 * r).toFixed(1)} mm)`, 'holes');
    lid.holes = [roundedRect(xc / 2, lidDepth - t - r, w, 2 * r, r)];
  }
  if (handle === 'lip') {
    // Lid lip: stands on the front wall in front of the lid's fingers; u = -x, normal +y. Its notched
    // bottom joint is declared on the lid's top face (the notch tops), where the lid's fingers end.
    const lh = t + mv / 2;
    const w = rectangularWall(xc, lh, ['fingerHole', 'flat', 'flat', 'flat'], ctx);
    w.lines = w.lines.map((l) => (l.side === 0 ? { ...l, from: { x: 0, y: 0 }, to: { x: xc, y: 0 } } : l));
    specs.push(panel('lidlip', 'Lid lip', w, at([t + ms + xc, 0, zLid], [-1, 0, 0], [0, 0, 1]), []));
  }
  // The lid rests on the front wall: flat mate along the front wall's outer face at the lid's top.
  const A: Vec3 = [t + ms, 0, zLid];
  const B: Vec3 = [t + ms + xc, 0, zLid];
  const f = body.front;
  lid.lines = [...lid.lines, { side: 50, type: 'flat', from: localOn(lid, A, 'lid rest'), to: localOn(lid, B, 'lid rest') }];
  f.lines = [...f.lines, { side: 50, type: 'flat', from: localOn(f, B, 'lid rest'), to: localOn(f, A, 'lid rest') }];
  lid.mates[50] = ['front', 50];
  f.mates[50] = ['lid', 50];
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const compartmentBox: Generator = {
  id: 'compartmentbox',
  name: 'Compartment box',
  category: TRAY_CATEGORY,
  description: 'Type tray with a sliding lid resting on the inner walls, held by lips on the side walls.',
  schema,
  presets: {
    'Bead box': { x: 40, y: 40, h: 25, cols: 4, rows: 3, handle: 'lip', inside: true },
    'Game box, grip hole': { x: 60, y: 90, h: 35, cols: 3, rows: 2, handle: 'hole', radius: 10, holes: 0.6, inside: true },
    'Pencil case': { x: 220, y: 90, h: 45, cols: 2, rows: 1, handle: 'none', inside: false },
  },
  build,
  expectedSize,
};
