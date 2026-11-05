/**
 * StackableBin: an open-fronted parts bin with a sloped retainer at the front and feet that locate
 * on the bin below, ported from boxes.py (florianfesti/boxes, boxes/generators/stackablebin.py,
 * StackableEdge 's'/'S' from boxes/edges.py).
 *
 * Panels (edges listed bottom, right, top, left; boxes.py names in quotes):
 *    sides     d * h   's h S b'   feet + slot row for the bottom; slots for the back's fingers;
 *                                  stacking tongue on top; front profile 'b' (open upper front, then
 *                                  a 45 degree slant with fingers into the retainer)
 *    back      X * h   's f S f'   feet + slot row; fingers into the sides' slots
 *    bottom    X * d   'f f G f'   fingers into the slot rows; 45 degree angled notches at the front
 *    retainer  X * Lr  'g F e F'   45 degree angled fingers into the bottom; notched for the sides
 *    dividers  d * h   'f f S b'   stand in slot rows in the bottom, back and retainer
 * X = sections * x + (sections - 1) * t, Lr = h * front * sqrt(2). The retainer leans out at 45
 * degrees; bottom and retainer meet with angled finger joints (core angledFinger edges).
 * Feet (boxes.py StackableSettings defaults): 2t high, 4t wide, 60 degree flanks, one thickness
 * between the feet line and the bottom slots, so the bottom's top face is 4t above the feet. The
 * top edges carry a tongue 2t high between the end feet positions, which sits between the feet of
 * the bin above.
 *
 * World frame: x across (left side's outer face at x = 0), y from the front (the retainer's top
 * outer edge at y = 0) to the back, z up (feet at z = 0). The inner front corner (bottom top face
 * meets the retainer's inner face) is the line y = F0, z = 4t with F0 = h * front + t / sqrt(2).
 *
 * Deliberate differences from boxes.py (docs/differences.md): equal sections (`sections` x `x`)
 * instead of the free sx list; no bottom stabilizer strips and no label strip; finger margins use
 * the common surrounding spaces (2) instead of 0.5; outer depth counts the retainer's thickness.
 */
import { fingerHolesFor, fingerJoint } from '../core/edges/finger';
import { angledFingerWidths } from '../core/edges';
import type { EdgeCtx } from '../core/edges/types';
import { mat3Multiply, mat3Rotate, mat3Translate, transform, type Path, type Vec2 } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import type { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type CustomSide, type PanelSpec, type WallLine } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Section width', help: 'Width of each section (inner), or the overall outer width when "Inner dimensions" is off', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 70, step: 1 },
  { key: 'sections', label: 'Sections', help: 'Number of side-by-side compartments (dividers between them)', unit: '',
    group: 'Size', kind: 'int', min: 1, max: 8, default: 1 },
  { key: 'd', label: 'Depth', help: 'Bin depth (inner bottom, or the overall outer depth)', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Inner height above the bottom, or the overall height including feet and tongue', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 50, step: 1 },
  { key: 'front', label: 'Front', help: 'Fraction of the height covered by the sloped retainer at the front', unit: '',
    group: 'Size', kind: 'number', min: 0.1, max: 0.9, default: 0.4, step: 0.05 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, d, h are inner sizes. Off: overall outer width, depth and height',
    group: 'Size', kind: 'bool', default: true },
  ...commonParams,
];

const S2 = Math.SQRT1_2;

/** Inner sizes: section width, section count, depth, height, front fraction. */
function inner(p: Params): { x: number; n: number; d: number; h: number; front: number } {
  const t = num(p, 'thickness');
  const n = num(p, 'sections');
  if (!(Number.isInteger(n) && n >= 1)) throw new ParamError('sections must be a positive integer', 'sections');
  const front = num(p, 'front');
  if (!(front > 0 && front < 1)) throw new ParamError('front must be between 0 and 1', 'front');
  if (p.inside !== false) return { x: num(p, 'x'), n, d: num(p, 'd'), h: num(p, 'h'), front };
  const h = num(p, 'h') - 6 * t;
  return { x: (num(p, 'x') - 2 * t - (n - 1) * t) / n, n, d: num(p, 'd') - 2 * t - h * front - t * S2, h, front };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = inner(p);
  const X = i.n * i.x + (i.n - 1) * t;
  return { x: X + 2 * t, y: i.h * i.front + t * S2 + i.d + 2 * t, z: i.h + 6 * t };
}

/**
 * boxes.py StackableBaseEdge: feet ('s', bottom) or the stacking tongue ('S', top). The recess
 * between the feet is `clearance` (mm, total) longer than the tongue below it, so bins stack
 * without binding (boxes.py draws both the same size).
 */
function stackable(t: number, bottom: boolean, clearance = 0): CustomSide {
  const ft = 2 * t; // feet height
  const fw = 4 * t - (bottom ? clearance / 2 : 0); // feet width (narrower by half the clearance each)
  const ang = 60;
  const r = ft / 2 / (1 - Math.cos((ang * Math.PI) / 180));
  const p = bottom ? 1 : -1;
  const w = bottom ? ft + t + t : 0; // feet line below the inner rectangle: feet + holedistance + slot
  return {
    start: w, end: w,
    draw: (tu: Turtle, length: number) => {
      const l = r * Math.sin((ang * Math.PI) / 180);
      tu.forward(fw);
      tu.arc(r, p * ang);
      tu.arc(r, -p * ang);
      tu.forward(length - 2 * fw - 4 * l);
      tu.arc(r, -p * ang);
      tu.arc(r, p * ang);
      tu.forward(fw);
    },
  };
}

/** Total in-plane clearance between a bin's stacking tongue and the recess of the bin above, mm. */
export const stackClearance = (ctx: EdgeCtx): number => Math.max(ctx.play, 0.1 * ctx.thickness);

/** Length the feet / tongue need: two feet plus four flank runs. */
const stackMin = (t: number): number => 8 * t + 4 * 2 * t * Math.sin(Math.PI / 3);

/**
 * boxes.py StackableBinEdge 'b': the front profile. Left variant (side 3, drawn top -> bottom):
 * out to (-h f, h f), then a 45 degree slant back to (0, 0) with fingers. Right variant (side 1,
 * bottom -> top) is the mirror image (boxes.py polyline reversal).
 */
function frontProfile(h: number, front: number, ctx: EdgeCtx, right: boolean): CustomSide {
  const a1 = (Math.atan(front / (1 - front)) * 180) / Math.PI;
  const a2 = 45 + a1;
  const le = h * Math.hypot(front, 1 - front);
  const lf = h * front * Math.SQRT2;
  return {
    start: 0, end: 0,
    draw: right
      ? (tu) => { tu.turn(-45); fingerJoint(tu, lf, ctx); tu.turn(a2); tu.forward(le); tu.turn(-a1); }
      : (tu) => { tu.turn(-a1); tu.forward(le); tu.turn(a2); fingerJoint(tu, lf, ctx); tu.turn(-45); },
  };
}

/**
 * Joint line of the front profile's finger slant (one thickness outside it, on the retainer's
 * outer face), in panel-local 2D, running CCW, cut back by `c` at the bottom end where the
 * retainer is cut back at its angled joint. `x0` is the inner rectangle's front edge.
 */
function slantLine(x0: number, hf: number, t: number, c: number, right: boolean): { from: Vec2; to: Vec2 } {
  if (!right) // travel (-hf, hf) -> (0, 0), outward normal (-1, -1)/sqrt2
    return { from: { x: x0 - hf - t * S2, y: hf - t * S2 }, to: { x: x0 - t * S2 - c * S2, y: -t * S2 + c * S2 } };
  return { from: { x: x0 + t * S2 + c * S2, y: -t * S2 + c * S2 }, to: { x: x0 + hf + t * S2, y: hf - t * S2 } };
}

/** Slot row for a finger edge of length `len` along +x from `o` (or +y when `vertical`), boxes.py fingerHolesAt. */
function slotRow(len: number, o: Vec2, vertical: boolean, ctx: EdgeCtx): Path[] {
  const m = vertical ? mat3Multiply(mat3Translate(o.x, o.y), mat3Rotate(90)) : mat3Translate(o.x, o.y);
  return fingerHolesFor(len, ctx).map((sl) => transform(sl, m));
}

/** Adds a slot row to a panel as an interior joint line (PartEdge.holes) mated to `mate`. */
function addRow(spec: PanelSpec, side: number, slots: Path[], line: { from: Vec2; to: Vec2 }, mate: [string, number]): void {
  const holes = slots.map((_, k) => spec.holes.length + k);
  spec.lines = [...spec.lines, { side, type: 'fingerHole', ...line, holes } satisfies WallLine];
  spec.holes = [...spec.holes, ...slots];
  spec.mates[side] = mate;
}

/** Largest overall width (mm) accepted. */
const MAX_WIDTH = 5000;

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, n, d, h, front } = inner(p);
  const X = n * x + (n - 1) * t;
  if (X + 2 * t > MAX_WIDTH) throw new ParamError(`sections too many: overall width exceeds ${MAX_WIDTH} mm`, 'sections');
  requireJointLength('x', x, t, 'section width');
  requireJointLength('h', h, t);
  requireJointLength('d', d, t);
  for (const [k, v] of [['x', X], ['d', d]] as const)
    if (!(v > stackMin(t) + t))
      throw new ParamError(`${k} too small: the feet and stacking tongue need ${(stackMin(t) + t).toFixed(1)} mm, got ${v.toFixed(1)} mm`, k);
  const hf = h * front;
  const lr = hf * Math.SQRT2;
  requireJointLength('front', lr, t, 'retainer height');
  if (!(h * (1 - front) > t)) throw new ParamError('front too large: no opening left above the retainer', 'front');

  const a45: EdgeCtx = { ...ctx, angle: 45 };
  const c = -angledFingerWidths(45, t).base; // how far the retainer is cut back at its angled joint
  const F0 = hf + t * S2;
  const sBot = stackable(t, true, stackClearance(ctx));
  const sTop = stackable(t, false);
  const bottomRow = (len: number): Path[] => slotRow(len, { x: 0, y: -t / 2 }, false, ctx);
  const rowLine = (len: number) => ({ from: { x: 0, y: -t }, to: { x: len, y: -t } });

  // Sides: inner rectangle [0, d] x [0, h]; the left side's front is local x = 0 (u = +y), the
  // right side is drawn mirrored (front at local x = d, u = -y).
  const left = panel('left', 'Left side', rectangularWall(d, h, [sBot, 'fingerHoles', sTop, frontProfile(h, front, ctx, false)], ctx),
    at([0, F0, 4 * t], [0, 1, 0], [0, 0, 1]), [undefined, ['back', 3], undefined, ['retainer', 1]]);
  left.lines = [...left.lines, { side: 3, type: 'finger', ...slantLine(0, hf, t, c, false) }];
  addRow(left, 0, bottomRow(d), rowLine(d), ['bottom', 1]);
  const right = panel('right', 'Right side', rectangularWall(d, h, [sBot, frontProfile(h, front, ctx, true), sTop, 'fingerHoles'], ctx),
    at([X + 2 * t, F0 + d, 4 * t], [0, -1, 0], [0, 0, 1]), [undefined, ['retainer', 3], undefined, ['back', 1]]);
  right.lines = [...right.lines, { side: 1, type: 'finger', ...slantLine(d, hf, t, c, true) }];
  addRow(right, 0, bottomRow(d), rowLine(d), ['bottom', 3]);

  // Back: inner [0, X] x [0, h], outer face at y = F0 + d + t, local x = world x - t.
  const back = panel('back', 'Back', rectangularWall(X, h, [sBot, 'finger', sTop, 'finger'], ctx),
    at([t, F0 + d + t, 4 * t], [1, 0, 0], [0, 0, 1]), [undefined, ['right', 3], undefined, ['left', 1]]);
  addRow(back, 0, bottomRow(X), rowLine(X), ['bottom', 0]);

  // Bottom: inner [0, X] x [0, d] seen from below (u = -x, v = -y): local y = 0 at the back.
  const bottom = panel('bottom', 'Bottom', rectangularWall(X, d, ['finger', 'finger', 'angledFingerHole', 'finger'], a45),
    at([t + X, F0 + d, 3 * t], [-1, 0, 0], [0, -1, 0]), [['back', 0], ['left', 0], ['retainer', 0], ['right', 0]]);

  // Retainer: leans out at 45 degrees; local y runs up the slant from the inner front corner, u = -x.
  const retainer = panel('retainer', 'Retainer', rectangularWall(X, lr, ['angledFinger', 'fingerHole', 'flat', 'fingerHole'], a45),
    at([t + X, F0 - t * S2, 4 * t - t * S2], [-1, 0, 0], [0, -S2, S2]), [['bottom', 2], ['left', 3], undefined, ['right', 1]]);

  // Dividers stand in slot rows; divider i's outer (z = 0) face is at inner x = i (x + t) - t.
  const dividers: PanelSpec[] = [];
  for (let i = 1; i < n; i++) {
    const face = i * (x + t) - t; // inner x of the divider's z = 0 face
    const id = `divider${i}`;
    const s = 10 + i;
    const div = panel(id, 'Divider', rectangularWall(d, h, ['finger', 'finger', sTop, frontProfile(h, front, ctx, false)], ctx),
      at([t + face, F0, 4 * t], [0, 1, 0], [0, 0, 1]), [['bottom', s], ['back', s], undefined, ['retainer', s]]);
    div.lines = [...div.lines, { side: 3, type: 'finger', ...slantLine(0, hf, t, c, false) }];
    dividers.push(div);
    const bx = X - face; // bottom / retainer local x of the divider's face (u = -x)
    addRow(bottom, s, slotRow(d, { x: bx - t / 2, y: 0 }, true, ctx), { from: { x: bx, y: 0 }, to: { x: bx, y: d } }, [id, 0]);
    addRow(back, s, slotRow(h, { x: face + t / 2, y: 0 }, true, ctx), { from: { x: face, y: 0 }, to: { x: face, y: h } }, [id, 1]);
    addRow(retainer, s, slotRow(lr, { x: bx - t / 2, y: 0 }, true, ctx), { from: { x: bx, y: c }, to: { x: bx, y: lr } }, [id, 3]);
  }
  return finishPanels([left, right, back, bottom, retainer, ...dividers], t, effectiveKerf(p));
}

export const stackableBin: Generator = {
  id: 'stackablebin',
  name: 'Stackable bin',
  category: 'Polygon & special',
  description: 'Open-fronted parts bin with a 45 degree retainer, feet and a stacking tongue so bins stack.',
  schema,
  presets: {
    'Parts bin': { x: 70, sections: 1, d: 100, h: 50, front: 0.4, inside: true },
    'Wide bin, 3 sections': { x: 60, sections: 3, d: 150, h: 80, front: 0.35, inside: true },
    'Shelf bin': { x: 200, sections: 2, d: 250, h: 120, front: 0.3, inside: false },
  },
  build,
  expectedSize,
};
