/**
 * BookHolder: an angled display stand for books, ring files or postcards: two profiled side walls
 * carrying a back plate the book leans against (`angle` from the floor) and a bottom plate square
 * to it that the book stands on; optionally a ledge at the bottom plate's front edge to hold the
 * book open, and a stretcher between the side walls. Ported from boxes.py (florianfesti/boxes,
 * boxes/generators/bookholder.py).
 *
 * Side wall profile (boxes.py sideWall; q = depth from the front, z up; a = H sin(angle),
 * b = H cos(angle), c = D cos(angle), d = D sin(angle), R = radius): the floor line, the back edge
 * up to a + bottom_support + R, a rounded corner, the notched edge of the back plate (length
 * H = book_height) down to the valley K, the notched edge of the bottom plate (length D =
 * book_depth) up to the front, a rounded corner and the front edge down. Total depth
 * 2R + R cos + b + d + R sin.
 *
 * Panels (local edges bottom, right, top, left; w = book_width - 2t):
 *    side walls   the profile; slot row for the stretcher (at height 2t, from q = bottom_support)
 *    back plate   w * H   'f f e f'   lies in the side walls' notches; fingers at K into the
 *                                     bottom plate's notched edge; its sides are plain over the
 *                                     top t tan(angle) + t, where the side wall's corner is too
 *                                     narrow for notches
 *    bottom plate w * D   'e|f f F f' front edge fingered into the ledge when there is one
 *    ledge        w * L   'F e e e'   stands on the bottom plate's front edge, L = ledge_height
 *    stretcher    w * S   'e f e f'   horizontal, S = back_support (0: none)
 * The plates' show faces are the faces the book touches. At K (and at the ledge) the joint line is
 * where the two show faces meet.
 *
 * World frame: x across, y from the front to the back, z up; outer size book_width, the profile's
 * depth and height (a ledge may stand out above or in front of it).
 *
 * Deliberate differences from boxes.py (docs/differences.md): `radius` is in mm with 0 allowed
 * (boxes.py: negative means one thickness); the back plate's side joints stop t tan(angle) + t
 * short of the top (boxes.py notches right into the acute corner, which can cut through it);
 * impossible sizes raise errors.
 */
import { bounds, type Vec2 } from '../core/geometry';
import { edgeFor } from '../core/edges';
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { Turtle } from '../core/turtle';
import { STORAGE_CATEGORY } from './storage';
import { autoMate, holesInside, requireMaxSize, slotInto } from './trays';
import { mirrorWall } from './flexwall';
import { at, finishPanels, num, panel, polyline, rectangularWall, requireJointLength, type PanelSpec, type Wall } from './walls';

const schema: Schema = [
  { key: 'book_width', label: 'Width', help: 'Total width of the stand', unit: 'mm', group: 'Book', kind: 'number', min: 40, max: 800, default: 297, step: 1 },
  { key: 'book_height', label: 'Back height', help: 'Height of the back plate the book leans against', unit: 'mm', group: 'Book', kind: 'number', min: 30, max: 500, default: 210, step: 1 },
  { key: 'book_depth', label: 'Book depth', help: 'Depth of the bottom plate the book stands on (thicker books need more)', unit: 'mm', group: 'Book', kind: 'number', min: 10, max: 200, default: 40, step: 1 },
  { key: 'angle', label: 'Angle', help: 'Angle between the floor and the back plate', unit: 'deg', group: 'Stand', kind: 'number', min: 45, max: 85, default: 75, step: 1 },
  { key: 'ledge_height', label: 'Ledge', help: 'Height of a ledge at the front of the bottom plate to hold the book open (0: none)', unit: 'mm',
    group: 'Stand', kind: 'number', min: 0, max: 60, default: 0, step: 1 },
  { key: 'bottom_support', label: 'Raise', help: 'Extra material below the plates, raising the book', unit: 'mm', group: 'Stand', kind: 'number', min: 0, max: 100, default: 20, step: 1 },
  { key: 'back_support', label: 'Stretcher', help: 'Depth of the stretcher plate between the side walls near the floor (0: none)', unit: 'mm',
    group: 'Stand', kind: 'number', min: 0, max: 150, default: 50, step: 1 },
  { key: 'radius', label: 'Corner radius', help: 'Radius of the side walls\' two sharp corners', unit: 'mm', group: 'Stand', kind: 'number', min: 0, max: 20, default: 3, step: 0.5 },
  // Stock over 10 mm leaves no room for the joints of a stand of display size.
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

type Profile = { wall: Wall; Y: number; Z: number; T: Vec2; K: Vec2; F: Vec2; h: Vec2; dd: Vec2 };

/**
 * Plain run at the top of the back plate's notched edge: the side wall's top corner is only
 * 90 - angle degrees wide, so notches start where the wedge is a thickness wide (t tan(angle) + t).
 */
const plainTop = (p: Params, t: number): number => t * Math.tan((num(p, 'angle') * Math.PI) / 180) + t;

/** Side wall profile (left wall's local frame = world (y, z)) and its key points. */
function profile(p: Params, ctx: ReturnType<typeof edgeCtx>): Profile {
  const t = ctx.thickness;
  const al = (num(p, 'angle') * Math.PI) / 180;
  const H = num(p, 'book_height');
  const D = num(p, 'book_depth');
  const BS = num(p, 'bottom_support');
  const R = num(p, 'radius');
  const a = H * Math.sin(al);
  const b = H * Math.cos(al);
  const c = D * Math.cos(al);
  const d = D * Math.sin(al);
  const hb = a + BS + R;
  const hf = c + BS + R;
  const os = Math.sin(al) * R;
  const oc = Math.cos(al) * R;
  const Y = R + oc + b + d + os + R;
  const deg = num(p, 'angle');
  const tt = new Turtle({ x: 0, y: 0 });
  polyline(tt, [Y, 90, hb - oc - R, [90 + deg, R], plainTop(p, t)]);
  const T = tt.pos;
  edgeFor('fingerHole')(tt, H - plainTop(p, t), ctx);
  const K = tt.pos;
  tt.turn(-90);
  edgeFor('fingerHole')(tt, D, ctx);
  const F = tt.pos;
  polyline(tt, [0, [180 - deg, R], hf - os - R, 90, 0]);
  const wall: Wall = {
    outline: tt.toPath(true), holes: [],
    lines: [{ side: 4, type: 'fingerHole', from: T, to: K }, { side: 5, type: 'fingerHole', from: K, to: F }],
  };
  return { wall, Y, Z: Math.max(hb, hf), T, K, F, h: { x: -Math.cos(al), y: -Math.sin(al) }, dd: { x: -Math.sin(al), y: Math.cos(al) } };
}

/** World bounding box (y, z) of the profile, the plates and the ledge. */
function extents(p: Params, P: Profile, t: number): { y: [number, number]; z: [number, number] } {
  const L = num(p, 'ledge_height');
  const b = bounds(P.wall.outline);
  const pts: Vec2[] = [b.min, b.max];
  const add = (o: Vec2, a: Vec2, s: number, b: Vec2, r: number): void => { pts.push({ x: o.x + s * a.x + r * b.x, y: o.y + s * a.y + r * b.y }); };
  // the back plate's top end (its body can stand out of the acute corner), the bottom plate's
  // front fingers and the ledge: from F along D-dir, depth along h (into the body)
  const H = num(p, 'book_height');
  const top = { x: P.K.x - H * P.h.x, y: P.K.y - H * P.h.y };
  for (const r of [0, t]) add(top, P.dd, -r, P.h, 0);
  for (const s of L > 0 ? [0, t] : [0]) for (const r of [0, t]) add(P.F, P.dd, s, P.h, r); // fingers only with a ledge
  if (L > 0) {
    const O = { x: P.F.x + t * P.dd.x, y: P.F.y + t * P.dd.y };
    const up = { x: -P.h.x, y: -P.h.y };
    const back = { x: -P.dd.x, y: -P.dd.y };
    for (const s of [-t, L]) for (const r of [0, t]) add(O, up, s, back, r);
  }
  const ys = pts.map((q) => q.x);
  const zs = pts.map((q) => q.y);
  return { y: [Math.min(...ys), Math.max(...ys)], z: [Math.min(...zs), Math.max(...zs)] };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const W = num(p, 'book_width');
  const w = W - 2 * t;
  const H = num(p, 'book_height');
  const D = num(p, 'book_depth');
  const L = num(p, 'ledge_height');
  const S = num(p, 'back_support');
  const BS = num(p, 'bottom_support');
  requireJointLength('book_width', w, t, 'inner width');
  requireMaxSize('book_width', W);
  requireJointLength('book_height', H, t, 'back plate height');
  requireJointLength('book_depth', D, t, 'bottom plate depth');
  const m = plainTop(p, t);
  requireJointLength('book_height', H - m, t, `the back plate's jointed length (book_height minus ${m.toFixed(1)} mm plain at the top at this angle)`);
  const P = profile(p, ctx);
  const E = extents(p, P, t);
  const oy = -E.y[0]; // shift so the stand starts at y = 0
  // Lowest point of the plates' bodies: the corner column at K (and the bottom plate's front end).
  const low = Math.min(P.K.y + t * P.h.y - t * P.dd.y, P.K.y + t * P.h.y, P.F.y + t * P.h.y);
  const floor = S > 0 ? 2.5 * t : 0;
  if (!(low >= floor + 0.5))
    throw new ParamError(`bottom_support too small: the plates would reach ${low.toFixed(1)} mm above the floor, they need ${(floor + 0.5).toFixed(1)} mm${S > 0 ? ' (clear of the stretcher)' : ''}`, 'bottom_support');

  // Side walls: left u = +y, v = +z (n = +x); right is its mirror image, u = -y.
  const left = panel('left', 'Left side', P.wall, at([0, oy, 0], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right side', mirrorWall(P.wall, P.Y), at([W, oy + P.Y, 0], [0, -1, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [left, right];
  const world = (q: Vec2, x: number): Vec3 => [x, oy + q.x, q.y];
  const v3 = (q: Vec2): Vec3 => [0, q.x, q.y];
  const neg = (q: Vec2): Vec2 => ({ x: -q.x, y: -q.y });

  // Back plate: from K (y = 0) up to T, v = -h, u = -x, n = -dd (into the body). Joint at K on its show face.
  const bw = rectangularWall(w, H, ['finger', { pieces: [['finger', H - m], ['flat', m]] }, 'flat', { pieces: [['flat', m], ['finger', H - m]] }], ctx);
  bw.lines = bw.lines.map((l) => (l.side === 0 ? { ...l, from: { x: 0, y: 0 }, to: { x: w, y: 0 } } : l));
  const backPlate = panel('backplate', 'Back plate', bw, at(world(P.K, t + w), [-1, 0, 0], v3(neg(P.h))), []);
  // Bottom plate: from its front end F (y = 0) to K (y = D), v = -dd, u = -x, n = h (into the body).
  const ow = rectangularWall(w, D, [L > 0 ? 'finger' : 'flat', 'finger', 'fingerHole', 'finger'], ctx);
  ow.lines = ow.lines.map((l) => (l.side === 2 ? { ...l, from: { x: w, y: D }, to: { x: 0, y: D } } : l));
  const bottomPlate = panel('bottomplate', 'Bottom plate', ow, at(world(P.F, t + w), [-1, 0, 0], v3(neg(P.dd))), []);
  specs.push(backPlate, bottomPlate);
  if (L > 0) {
    // Ledge: front face through F + t dd, v = -h (up, towards the book), u = -x, n = -dd. Its
    // notched bottom meets the bottom plate's fingers; the joint line is on the bottom plate's show face.
    const lw = rectangularWall(w, L, ['fingerHole', 'flat', 'flat', 'flat'], ctx);
    lw.lines = lw.lines.map((l) => (l.side === 0 ? { ...l, from: { x: 0, y: 0 }, to: { x: w, y: 0 } } : l));
    const O = { x: P.F.x + t * P.dd.x, y: P.F.y + t * P.dd.y };
    specs.push(panel('ledge', 'Ledge', lw, at(world(O, t + w), [-1, 0, 0], v3(neg(P.h))), []));
  }
  if (S > 0) {
    requireJointLength('back_support', S, t, 'stretcher depth');
    if (!(BS + S <= P.Y))
      throw new ParamError(`back_support too large: the stretcher would end ${(BS + S).toFixed(1)} mm from the front, the side walls are ${P.Y.toFixed(1)} mm deep`, 'back_support');
    const st = panel('stretcher', 'Stretcher', rectangularWall(w, S, ['flat', 'finger', 'flat', 'finger'], ctx), at([t, oy + BS, 1.5 * t], [1, 0, 0], [0, 1, 0]), []);
    slotInto(left, st, [3], ctx);
    slotInto(right, st, [1], ctx);
    if (!holesInside(left.outline, left.holes, 0.5))
      throw new ParamError(`back_support too large: the stretcher's slots would break out of the side walls (from ${BS} mm, the walls are ${P.Y.toFixed(1)} mm deep)`, 'back_support');
    specs.push(st);
  }
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const bookHolder: Generator = {
  id: 'bookholder',
  name: 'Book holder',
  category: STORAGE_CATEGORY,
  description: 'Angled display stand for books, ring files, flyers, leaflets or postcards: two side walls, a back and a bottom plate (BookHolder, Display).',
  schema,
  presets: {
    'A4 landscape': { book_width: 297, book_height: 210, book_depth: 40, angle: 75, ledge_height: 0, bottom_support: 20, back_support: 50, radius: 3 },
    'Postcards with ledge': { book_width: 160, book_height: 100, book_depth: 15, angle: 70, ledge_height: 10, bottom_support: 10, back_support: 0, radius: 3 },
    'Cookbook': { book_width: 260, book_height: 180, book_depth: 60, angle: 65, ledge_height: 25, bottom_support: 25, back_support: 60, radius: 5, thickness: 4 },
    'Display (A4 leaflets)': { book_width: 230, book_height: 230, book_depth: 12, angle: 75, ledge_height: 20, bottom_support: 15, back_support: 40, radius: 3 },
  },
  build,
  expectedSize: (p) => {
    const ctx = edgeCtx(p);
    const P = profile(p, ctx);
    const E = extents(p, P, ctx.thickness);
    return { x: num(p, 'book_width'), y: E.y[1] - E.y[0], z: E.z[1] - E.z[0] };
  },
};
