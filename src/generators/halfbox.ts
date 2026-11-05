/**
 * HalfBox: half of a box cut along a diagonal, an L of a bottom and a back held square by
 * triangular supports. Works as a bookend, a hanging shelf or an angle clamping jig. Ported from
 * boxes.py (florianfesti/boxes, boxes/generators/halfbox.py, the default non-sturdy layout).
 *
 * Parts (edges bottom, right, top, left; triangles listed along their outline):
 *    bottom   x * W   [F, e, F, f]   notched for the end supports, fingers into the back, plus a
 *                                    slot row (interior joint, side 3 + i) per middle support
 *    back     W * h   [F, F, e, F]   notched for the bottom and the end supports (owns the corner
 *                                    cubes), plus a slot row per middle support
 *    supports  legs x and h, both 'f', hypotenuse 'e': one at each end, one between sections
 * with W = sections * y + (sections - 1) * t (y is the width of one section).
 *
 * World frame: the back stands at x in [0, t], the bottom lies at z in [0, t]; outer size
 * X = x + t, Y = W + 2t, Z = h + t. Inner space is [t, t+x] x [t, t+W] x [t, t+h].
 *
 * Deliberate differences from boxes.py: equal sections (`sections` x `y`) instead of a free
 * `sy` list; the end supports key into notched plate edges rather than slots touching the plate
 * edge; no Sturdy, Clamping or Mounting options (see docs/differences.md).
 */
import { edgeFor, type EdgeType } from '../core/edges';
import type { EdgeCtx } from '../core/edges/types';
import { mat3Multiply, mat3Rotate, mat3Translate, transform, type Path, type Vec2 } from '../core/geometry';
import { fingerHolesFor } from '../core/edges/finger';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec, type WallEdge, type WallLine } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Depth', help: 'Length of the bottom, from the back outwards (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Width', help: 'Inner: width of each section between supports. Outer: overall width', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 50, step: 1 },
  { key: 'sections', label: 'Sections', help: 'Number of equal sections side by side, with a support between each', unit: '',
    group: 'Size', kind: 'int', min: 1, max: 10, default: 2 },
  { key: 'h', label: 'Height', help: 'Height of the back (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: sizes are measured inside the L. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  ...commonParams,
];

/** Inner sizes; `y` is the width of one section (sections are separated by one support each). */
function innerSize(p: Params): { x: number; y: number; h: number; n: number } {
  const t = num(p, 'thickness');
  const n = num(p, 'sections');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? t : 0), y: o ? (num(p, 'y') - (n + 1) * t) / n : num(p, 'y'), h: num(p, 'h') - (o ? t : 0), n };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + t, y: i.n * i.y + (i.n + 1) * t, z: i.h + t };
}

/**
 * Right triangle drawn CCW from `pts[0]`, side i from pts[i] to pts[i+1] with edge type types[i].
 * Finger edges protrude outwards (to the right of travel) from the inner triangle, so no corner
 * fill is needed (all start widths are 0); joint lines are the finger sides pushed out by t.
 */
function triangle(pts: Vec2[], types: EdgeType[], ctx: EdgeCtx): { outline: PanelSpec['outline']; lines: WallLine[] } {
  const tu = new Turtle(pts[0], 0);
  const lines: WallLine[] = [];
  let heading = 0;
  for (let i = 0; i < 3; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % 3]!;
    const dir = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    tu.turn(dir - heading);
    heading = dir;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    edgeFor(types[i]!)(tu, len, ctx);
    const d = types[i] === 'finger' ? ctx.thickness : 0;
    const o = { x: ((b.y - a.y) / len) * d, y: (-(b.x - a.x) / len) * d }; // outward normal * depth
    lines.push({ side: i, type: types[i]!, from: { x: a.x + o.x, y: a.y + o.y }, to: { x: b.x + o.x, y: b.y + o.y } });
  }
  return { outline: tu.toPath(true), lines };
}

/** Slot row (boxes.py fingerHolesAt) for a finger edge of length `len`, along +x from `o` or along +y when `vertical`. */
function slotRow(len: number, o: Vec2, vertical: boolean, ctx: EdgeCtx): Path[] {
  const m = vertical ? mat3Multiply(mat3Translate(o.x, o.y), mat3Rotate(90)) : mat3Translate(o.x, o.y);
  return fingerHolesFor(len, ctx).map((sl) => transform(sl, m));
}

/** Largest overall width (mm) accepted; several wide sections quickly exceed any sheet. */
const MAX_WIDTH = 5000;

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h, n } = innerSize(p);
  requireJointLength('x', x, t);
  requireJointLength('y', y, t, 'section width');
  requireJointLength('h', h, t);

  const W = n * y + (n - 1) * t; // inner width between the end supports
  if (W + 2 * t > MAX_WIDTH)
    throw new ParamError(`sections too many: overall width ${(W + 2 * t).toFixed(0)} mm exceeds ${MAX_WIDTH} mm (reduce sections or y)`, 'sections');
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const sup = (i: number): string => `support${i}`;

  // Near support (y in [0, t], normal +y): local x runs towards the back (-x world), so the right
  // angle sits at local (x, 0). Supports 1..n (normal -y, outer face at y = i (y + t) + t): local
  // x runs +x world. Supports 1..n-1 stand in slot rows in the middle of the bottom and back
  // (interior joints, PartEdge.holes); support n keys into the notched far edges.
  const near = triangle([{ x: 0, y: 0 }, { x, y: 0 }, { x, y: h }], ['finger', 'finger', 'flat'], ctx);
  const far = triangle([{ x: 0, y: 0 }, { x, y: 0 }, { x: 0, y: h }], ['finger', 'flat', 'finger'], ctx);

  const bottomWall = rectangularWall(x, W, [F, e, F, f], ctx);
  const backWall = rectangularWall(W, h, [F, F, e, F], ctx);
  const bottom = panel('bottom', 'Bottom', bottomWall, at([t, t, 0], [1, 0, 0], [0, 1, 0]),
    [[sup(0), 0], undefined, [sup(n), 0], ['back', 0]]);
  const back = panel('back', 'Back', backWall, at([0, t, t], [0, 1, 0], [0, 0, 1]),
    [['bottom', 3], [sup(n), 2], undefined, [sup(0), 1]]);
  const supports: PanelSpec[] = [
    { id: sup(0), name: 'Support', ...near, holes: [], placement: at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]),
      mates: [['bottom', 0], ['back', 3], undefined] },
  ];
  for (let i = 1; i <= n; i++) {
    const face = i * (y + t); // the support's outer face, in bottom/back local coordinates
    const mid = i < n;
    supports.push({ id: sup(i), name: 'Support', ...far, holes: [], placement: at([t, face + t, t], [1, 0, 0], [0, 0, 1]),
      mates: mid ? [['bottom', 3 + i], undefined, ['back', 3 + i]] : [['bottom', 2], undefined, ['back', 1]] });
    if (!mid) continue;
    const bs = slotRow(x, { x: 0, y: face - t / 2 }, false, ctx);
    const ks = slotRow(h, { x: face - t / 2, y: 0 }, true, ctx);
    const idx = (spec: PanelSpec, add: Path[]): number[] => add.map((_, k) => spec.holes.length + k);
    bottom.lines = [...bottom.lines, { side: 3 + i, type: 'fingerHole', from: { x: 0, y: face }, to: { x, y: face }, holes: idx(bottom, bs) }];
    back.lines = [...back.lines, { side: 3 + i, type: 'fingerHole', from: { x: face, y: 0 }, to: { x: face, y: h }, holes: idx(back, ks) }];
    bottom.holes = [...bottom.holes, ...bs];
    back.holes = [...back.holes, ...ks];
    bottom.mates[3 + i] = [sup(i), 0];
    back.mates[3 + i] = [sup(i), 2];
  }
  return finishPanels([bottom, back, ...supports], t, effectiveKerf(p));
}

export const halfBox: Generator = {
  id: 'halfbox',
  name: 'Half box',
  category: 'Boxes',
  description: 'An L of bottom and back braced by triangular supports: bookend, hanging shelf or clamping jig.',
  schema,
  presets: {
    Bookend: { x: 100, y: 120, h: 160, sections: 1, inside: false },
    'Wall shelf': { x: 150, y: 140, h: 120, sections: 3, inside: true },
  },
  build,
  expectedSize,
};
