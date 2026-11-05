/**
 * BinTray: an upright rack of open bins in rows and columns, each row with a retainer sloping out
 * at 45 degrees at its front, to stand on a shelf or hang on a wall. Ported from boxes.py
 * (florianfesti/boxes, boxes/generators/bintray.py, BinFrontEdge 'b'/'B'); the front geometry is
 * stackablebin's (one bin row) repeated per row.
 *
 * Panels (edges bottom, right, top, left of each panel):
 *    back          X * H   'f f f f'   slot rows for every inner wall piece
 *    bottom, top   X * y   back 'F', sides 'f', front: 45 degree angled notches (bottom) / plain
 *    sides         y * H   'F F F b'   b: per row the open front slanting out to the retainer,
 *                                      45 degree finger slant into it, then one thickness down
 *    shelves       X * y   (rows - 1) inner horizontal walls: back fingers per column, slotted half
 *                          way in from the back at the inner vertical walls; 'f' into the sides;
 *                          front: angled notches for the retainer of the row above
 *    dividers      y * H   (cols - 1) inner vertical walls: back fingers per row, 'f' into bottom
 *                          and top, front 'B': the side profile with a slot half way in at each shelf
 *    retainers     X * Lr  one per row, Lr = h front sqrt 2, angled fingers into the row's floor,
 *                          notched for the sides, slot rows for the dividers
 * X = cols * x + (cols - 1) t, H = rows * h + (rows - 1) t.
 *
 * World frame: x across, y from the front (the retainers' top outer edges at y = 0) to the back,
 * z up (bottom underside at z = 0). The inner front corner of row i (its floor's top face meets the
 * retainer's inner face) is the line y = F0, z = t + i (h + t), F0 = h front + t / sqrt 2.
 * Outer size X + 2t, F0 + y + t, H + 2t.
 *
 * Deliberate differences from boxes.py (docs/differences.md): equal columns and rows (x, h)
 * instead of sx/sh lists; the retainers' and floors' angled joints run continuously across all
 * columns (boxes.py interrupts them at the dividers); no mounting holes.
 */
import { angledFingerWidths } from '../core/edges';
import { fingerJoint } from '../core/edges/finger';
import type { EdgeCtx } from '../core/edges/types';
import type { Vec2 } from '../core/geometry';
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import type { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { autoMate, crossing, requireMaxSize, runsFor, slotInto, slotRanges, slottedSide, TRAY_CATEGORY } from './trays';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type CustomSide, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Bin width', help: 'Width of each bin (inner), or the overall outer width when "Inner dimensions" is off', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 400, default: 60, step: 1 },
  { key: 'h', label: 'Bin height', help: 'Height of each bin row (inner), or the overall outer height', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 800, default: 50, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth of the bins (inner, back to the front edge of the shelves), or the overall outer depth', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 500, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, h are one bin and y the inner depth. Off: they are the overall outer size',
    group: 'Size', kind: 'bool', default: true },
  { key: 'cols', label: 'Columns', help: 'Number of bins side by side', unit: '', group: 'Compartments', kind: 'int', min: 1, max: 8, default: 3 },
  { key: 'rows', label: 'Rows', help: 'Number of bin rows stacked', unit: '', group: 'Compartments', kind: 'int', min: 1, max: 8, default: 3 },
  { key: 'front', label: 'Front', help: 'Fraction of each bin’s height covered by its sloped retainer', unit: '',
    group: 'Compartments', kind: 'number', min: 0.1, max: 0.9, default: 0.4, step: 0.05 },
  ...commonParams,
];

const S2 = Math.SQRT1_2;

function inner(p: Params): { x: number; nx: number; h: number; ny: number; y: number; front: number } {
  const t = num(p, 'thickness');
  const nx = num(p, 'cols');
  const ny = num(p, 'rows');
  const front = num(p, 'front');
  if (!(front > 0 && front < 1)) throw new ParamError('front must be between 0 and 1', 'front');
  if (p.inside !== false) return { x: num(p, 'x'), nx, h: num(p, 'h'), ny, y: num(p, 'y'), front };
  const h = (num(p, 'h') - 2 * t - (ny - 1) * t) / ny;
  return { x: (num(p, 'x') - (nx + 1) * t) / nx, nx, h, ny, y: num(p, 'y') - t - (h * front + t * S2), front };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = inner(p);
  const X = i.nx * i.x + (i.nx - 1) * t;
  const H = i.ny * i.h + (i.ny - 1) * t;
  return { x: X + 2 * t, y: i.h * i.front + t * S2 + i.y + t, z: H + 2 * t };
}

/**
 * boxes.py BinFrontEdge 'b' (sides) / 'B' (dividers, with a slot half the depth deep at each
 * shelf), drawn top -> bottom on side 3, or its mirror image bottom -> top on side 1 (`right`).
 * The divider's slot is t + play wide, like the shelf's half of the crossing (boxes.py: t).
 */
function frontProfile(rows: number, h: number, front: number, y: number, ctx: EdgeCtx, slotted: boolean, right: boolean): CustomSide {
  const t = ctx.thickness;
  const play = ctx.play;
  const a1 = (Math.atan(front / (1 - front)) * 180) / Math.PI;
  const a2 = 45 + a1;
  const le = h * Math.hypot(front, 1 - front);
  const lf = h * front * Math.SQRT2;
  type Step = ['turn', number] | ['fwd', number] | ['finger', number];
  const steps: Step[] = [['turn', -a1]];
  for (let i = 0; i < rows; i++) {
    steps.push(['fwd', le], ['turn', a2], ['finger', lf]);
    if (i === rows - 1) steps.push(['turn', -45]);
    else if (slotted && play > 0)
      // Half-lap slot widened by the play, half on each side of the shelf (the mouth keeps its
      // corners: short steps along the front line open it up).
      steps.push(['turn', 135], ['fwd', play / 2], ['turn', -90], ['fwd', y / 2], ['turn', -90], ['fwd', t + play], ['turn', -90], ['fwd', y / 2], ['turn', -90], ['fwd', play / 2], ['turn', 180 - a1]);
    else if (slotted) steps.push(['turn', 45], ['fwd', y / 2], ['turn', -90], ['fwd', t], ['turn', -90], ['fwd', y / 2], ['turn', 90 - a1]);
    else steps.push(['turn', -45], ['fwd', t], ['turn', -a1]);
  }
  const seq = right ? [...steps].reverse() : steps;
  return {
    start: 0, end: 0,
    draw: (tu: Turtle) => {
      for (const [k, v] of seq) {
        if (k === 'turn') tu.turn(v);
        else if (k === 'fwd') tu.forward(v);
        else fingerJoint(tu, v, ctx);
      }
    },
  };
}

/**
 * Joint line of a row's finger slant (one thickness outside it, on the retainer's outer face), in
 * panel-local 2D running CCW, cut back by `c` at the bottom end (where the retainer is cut back at
 * its angled joint). `x0` is the front line, `v0` the row's floor level, `hf` = h front.
 */
function slantLine(x0: number, v0: number, hf: number, t: number, c: number, right: boolean): { from: Vec2; to: Vec2 } {
  if (!right) // travel (-hf, hf) -> (0, 0), outward normal (-1, -1)/sqrt2
    return { from: { x: x0 - hf - t * S2, y: v0 + hf - t * S2 }, to: { x: x0 - t * S2 - c * S2, y: v0 - t * S2 + c * S2 } };
  return { from: { x: x0 + t * S2 + c * S2, y: v0 - t * S2 + c * S2 }, to: { x: x0 + hf + t * S2, y: v0 + hf - t * S2 } };
}

const MAX_ROWS_SIZE = 5000;

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, nx, h, ny, y, front } = inner(p);
  requireJointLength('x', x, t, 'bin width');
  requireJointLength('h', h, t, 'bin height');
  requireJointLength('y', y, t);
  const X = nx * x + (nx - 1) * t;
  const H = ny * h + (ny - 1) * t;
  requireMaxSize('x', X + 2 * t);
  if (H + 2 * t > MAX_ROWS_SIZE) throw new ParamError(`rows too many: overall height exceeds ${MAX_ROWS_SIZE} mm`, 'rows');
  const hf = h * front;
  const lr = hf * Math.SQRT2;
  requireJointLength('front', lr, t, 'retainer height');
  if (!(h * (1 - front) > t)) throw new ParamError('front too large: no opening left above the retainer', 'front');

  const a45: EdgeCtx = { ...ctx, angle: 45 };
  const c = -angledFingerWidths(45, t).base; // how far a retainer is cut back at its angled joint
  const F0 = hf + t * S2;
  const zRow = (i: number): number => t + i * (h + t); // world z of row i's floor top
  const vRow = (i: number): number => i * (h + t); // the same in side / divider local v
  const xw = Array.from({ length: nx - 1 }, (_, j) => t + (j + 1) * x + j * t); // dividers' low faces (world x)
  const F = 'fingerHole' as const;
  const f = 'finger' as const;

  // Sides: u = y - F0 (left) or F0 + y - y_w (right), v = z - t.
  const left = panel('left', 'Left side', rectangularWall(y, H, [F, F, F, frontProfile(ny, h, front, y, ctx, false, false)], ctx),
    at([0, F0, t], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right side', rectangularWall(y, H, [F, frontProfile(ny, h, front, y, ctx, false, true), F, F], ctx),
    at([X + 2 * t, F0 + y, t], [0, -1, 0], [0, 0, 1]), []);
  for (let i = 0; i < ny; i++) {
    left.lines = [...left.lines, { side: 60 + i, type: f, ...slantLine(0, vRow(i), hf, t, c, false) }];
    right.lines = [...right.lines, { side: 60 + i, type: f, ...slantLine(y, vRow(i), hf, t, c, true) }];
  }
  // Back: u = x - t, v = z - t, outer face at y = F0 + y + t (normal -y).
  const back = panel('back', 'Back', rectangularWall(X, H, [f, f, f, f], ctx), at([t, F0 + y + t, t], [1, 0, 0], [0, 0, 1]), []);
  // Bottom seen from below (u = -x, v = -y, local y = 0 at the back); top seen from above (v = +y).
  const bottom = panel('bottom', 'Bottom', rectangularWall(X, y, [F, f, 'angledFingerHole', f], a45),
    at([t + X, F0 + y, 0], [-1, 0, 0], [0, -1, 0]), []);
  const top = panel('top', 'Top', rectangularWall(X, y, ['flat', f, F, f], ctx), at([t + X, F0, H + 2 * t], [-1, 0, 0], [0, 1, 0]), []);
  const specs: PanelSpec[] = [left, right, back, bottom, top];

  // Shelves between rows: like the bottom, u = -x; back fingers per column, slotted half way in.
  const shelves = Array.from({ length: ny - 1 }, (_, i) => {
    const runs = runsFor(0, X, y, slotRanges(xw.map((xx) => [t + X - xx - t, t + X - xx]), ctx.play));
    const s = panel(`shelf${i + 1}`, 'Shelf', rectangularWall(X, y, [slottedSide(runs, f, y / 2, ctx), f, 'angledFingerHole', f], a45),
      at([t + X, F0 + y, zRow(i + 1) - t], [-1, 0, 0], [0, -1, 0]), []);
    let a = 0;
    runs.pieces.forEach((l, k) => {
      s.lines = [...s.lines, { side: 100 + k, type: f, from: { x: a, y: -t }, to: { x: a + l, y: -t } }];
      a += l + (runs.gaps[k] ?? 0);
    });
    slotInto(left, s, [1], ctx);
    slotInto(right, s, [3], ctx);
    slotInto(back, s, s.lines.filter((l) => l.side >= 100).map((l) => l.side), ctx);
    return s;
  });
  // Retainers: lean out at 45 degrees; local y up the slant from row i's inner front corner, u = -x.
  const retainers = Array.from({ length: ny }, (_, i) => panel(`retainer${i + 1}`, 'Retainer',
    rectangularWall(X, lr, ['angledFinger', F, 'flat', F], a45), at([t + X, F0 - t * S2, zRow(i) - t * S2], [-1, 0, 0], [0, -S2, S2]), []));
  // Dividers: u = y - F0, v = z - t, z = 0 face at x = xw (normal +x).
  const dividers = xw.map((x0, j) => {
    const runs = runsFor(1, y, H, Array.from({ length: ny - 1 }, (_, i) => [vRow(i + 1) - t, vRow(i + 1)] as [number, number]));
    const d = panel(`divider${j + 1}`, 'Divider', rectangularWall(y, H, [f, slottedSide(runs, f, 0, ctx), f, frontProfile(ny, h, front, y, ctx, true, false)], ctx),
      at([x0, F0, t], [0, 1, 0], [0, 0, 1]), []);
    let a = 0;
    runs.pieces.forEach((l, k) => {
      d.lines = [...d.lines, { side: 200 + k, type: f, from: { x: y + t, y: a }, to: { x: y + t, y: a + l } }];
      a += l + (runs.gaps[k] ?? 0);
    });
    for (let i = 0; i < ny; i++) d.lines = [...d.lines, { side: 60 + i, type: f, ...slantLine(0, vRow(i), hf, t, c, false) }];
    slotInto(bottom, d, [0], ctx);
    slotInto(top, d, [2], ctx);
    slotInto(back, d, runs.pieces.map((_, k) => 200 + k), ctx);
    retainers.forEach((r, i) => slotInto(r, d, [60 + i], ctx, { [60 + i]: slantLine(0, vRow(i), hf, t, 0, false) }));
    shelves.forEach((s, i) => {
      // Crossing: the divider's front slot meets the shelf's back slot half way in, on the shelf's underside.
      const z = zRow(i + 1) - t;
      const cc = Math.min(t, y / 4);
      const q = (yy: number): Vec3 => [x0, yy, z];
      crossing(s, d, q(F0 + y / 2 - cc), q(F0 + y / 2 + cc));
    });
    return d;
  });
  specs.push(...shelves, ...retainers, ...dividers);
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const binTray: Generator = {
  id: 'bintray',
  name: 'Bin tray',
  category: TRAY_CATEGORY,
  description: 'Upright rack of open bins in rows and columns, each row with a sloped retainer, for a shelf or a wall.',
  schema,
  presets: {
    'Parts rack': { x: 60, h: 50, y: 100, cols: 3, rows: 3, front: 0.4, inside: true },
    'Wall bins': { x: 120, h: 80, y: 120, cols: 2, rows: 2, front: 0.35, inside: true },
    'Tall rack': { x: 400, h: 600, y: 150, cols: 4, rows: 6, front: 0.3, inside: false },
  },
  build,
  expectedSize,
};
