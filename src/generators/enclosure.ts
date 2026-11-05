/**
 * Enclosure: the generic screw-lid box for electronics, covering boxes.py (florianfesti/boxes)
 * ElectronicsBox, RackBox, Rack10Box and Rack19Box (boxes/generators/electronicsbox.py,
 * rackbox.py, rack10box.py, rack19box.py) as presets:
 * four finger-jointed walls on a notched bottom plate, four right-angled corner triangles held in
 * slot rows one and a half thicknesses below the top, and a plain lid that drops in flush with the
 * walls' tops and is screwed into the triangles.
 *
 * Joints (edges listed bottom, right, top, left of each panel):
 *    front/back walls  x * hw   'f F e F'   fingers into the bottom; they own the vertical corners
 *    left/right walls  y * hw   'f f e f'
 *    bottom            x * y    'F F F F'   notched, reaching the walls' outer faces
 *    triangles         tr * tr  'f e f'     legs fingered into slot rows in the two walls
 *    lid               x * y    'e e e e'   rests on the triangles (flat mates on their top faces)
 * A rack front panel replaces the front wall: 'F h e h' (boxes.py flangedWall), i.e. its bottom is
 * notched for the bottom plate's fingers (bottom 'f' at the front) and its sides are slot rows for
 * the side walls' fingers, set in by the rack ears.
 *
 * World frame: the walls' outer faces span [0, X] x [0, Y], z up, the bottom plate's underside at
 * z = 0 and the lid's top face at Z = t + hw (hw = wall height above the bottom plate). Bottom
 * plate flanges (mounting ears) and rack ears stand out past [0, X] along x.
 */
import type { EdgeCtx } from '../core/edges/types';
import type { Path, Vec2 } from '../core/geometry';
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { patternHoles, type Keepout, type PatternSpec, type Region } from './patterns';
import { autoMate, rest, slotInto } from './trays';
import { at, circle, finishPanels, num, panel, polygonPlate, rectangularWall, requireJointLength, roundedRect, type PanelSpec, type Wall, type WallEdge, type WallEdges } from './walls';

const VENT_W = 3;
const VENT_PITCH = 7;

export type EnclosureSpec = {
  /** Inner width (x), depth (y) and wall height above the bottom plate (hw, including the lid). */
  x: number;
  y: number;
  hw: number;
  /** Side of the corner triangles (mm) and the screw hole diameters in triangles / lid. */
  triangle: number;
  d1: number;
  d2: number;
  ctx: EdgeCtx;
  kerf: number;
  /** Mounting holes in the bottom plate: inside the box, or in flanges along x; none when absent. */
  mounts?: { d: number; dist: number; outside: boolean };
  /** Rack front panel: ear width past the side walls and the ear holes (panel-local, given the inner width). */
  rack?: { ear: number; holes: (x: number) => Path[] };
  /** Ventilation slots in the left and right walls. */
  vents?: boolean;
  /** A hole field (patterns.ts) in the lid, the front or the back panel. */
  holes?: { where: 'lid' | 'front' | 'back'; spec: PatternSpec };
  /** Param keys for ParamErrors. */
  keys: { x: string; y: string; hw: string };
};

const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Checks the triangles and screw holes fit; ParamErrors name `triangle`, `d1`, `d2`. */
function checkTriangles(s: EnclosureSpec): void {
  const t = s.ctx.thickness;
  const tr = s.triangle;
  requireJointLength('triangle', tr, t, 'triangle side');
  const most = Math.min(s.x, s.y) / 2 - t;
  if (!(tr <= most))
    throw new ParamError(`triangle too large: ${tr.toFixed(1)} mm triangles in opposite corners need sides of at most ${most.toFixed(1)} mm (half the shorter inner side less one thickness)`, 'triangle');
  // Holes centred on the triangle's centroid (tr/3, tr/3): the hypotenuse is tr / (3 sqrt 2) away.
  const room = tr / (3 * Math.SQRT2) - 0.5;
  if (!(s.d1 / 2 <= room))
    throw new ParamError(`d1 too large: a ${s.d1.toFixed(1)} mm hole does not fit in a ${tr.toFixed(1)} mm triangle (at most ${(2 * room).toFixed(1)} mm)`, 'd1');
  if (!(s.d2 / 2 <= Math.min(room, tr / 3 - 0.5)))
    throw new ParamError(`d2 too large: the lid's ${s.d2.toFixed(1)} mm hole over a ${tr.toFixed(1)} mm triangle must be at most ${(2 * room).toFixed(1)} mm`, 'd2');
}

/** Builds the enclosure; see the module comment for the parts and the world frame. */
export function enclosure(s: EnclosureSpec): Part[] {
  const { x, y, hw, ctx } = s;
  const t = ctx.thickness;
  requireJointLength(s.keys.x, x, t);
  requireJointLength(s.keys.y, y, t);
  // The triangles' slot rows sit 2t + play/2 below the top; the walls' bottom fingers need room too.
  if (!(hw >= 4 * t))
    throw new ParamError(`${s.keys.hw} too small: the walls are ${hw.toFixed(1)} mm high above the bottom, the lid and its triangles need at least ${(4 * t).toFixed(1)} mm`, s.keys.hw);
  checkTriangles(s);

  const X = x + 2 * t;
  const Y = y + 2 * t;
  const Z = t + hw;
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const wall = (w: number, h: number, types: WallEdges) => rectangularWall(w, h, types, ctx);

  // Vents: 3 mm slots on a 7 mm pitch over the middle 60 % of the side walls, from 2t above the
  // bottom to 4t below the top (clear of the lid triangles' slot rows); none when there is no room.
  const vented = (w: Wall): Wall => {
    const vh = hw - 6 * t;
    const n = Math.floor((0.6 * y - VENT_W) / VENT_PITCH) + 1;
    if (!s.vents || vh < 6 || n < 1) return w;
    for (let k = 0; k < n; k++) w.holes.push(roundedRect(y / 2 + (k - (n - 1) / 2) * VENT_PITCH, 2 * t + vh / 2, VENT_W, vh, VENT_W / 2));
    return w;
  };
  // Hole field in a wall: inside the inner rectangle less a margin, below the lid triangles' slot rows.
  const fm = Math.max(3, t);
  const field = (w: Wall, width: number, top: number, keep: Keepout[] = []): Wall => {
    const hs = s.holes!;
    const rg: Region = { kind: 'rect', x0: fm, y0: fm, x1: width - fm, y1: top };
    if (!(rg.x1 > rg.x0 && rg.y1 > rg.y0)) throw new ParamError(`panel_holes: no room for holes in the ${hs.where}`, 'panel_holes');
    const holes = patternHoles(hs.spec, rg, { x: (rg.x0 + rg.x1) / 2, y: (rg.y0 + rg.y1) / 2 }, keep, Math.max(1, hs.spec.spacing - hs.spec.hole),
      { spacing: 'hole_spacing', slot: 'hole_size' });
    if (holes.length === 0) throw new ParamError(`hole_size too large: no holes fit in the ${hs.where}`, 'hole_size');
    w.holes.push(...holes);
    return w;
  };
  const wallField = (where: 'front' | 'back', w: Wall): Wall => (s.holes?.where === where ? field(w, x, hw - 3 * t) : w);
  const rack = s.rack;
  const front = rack
    ? (() => {
        const w = rectangularWall(x, hw, [F, 'fingerHoles', e, 'fingerHoles'], ctx, { brim: rack.ear });
        w.holes.push(...rack.holes(x));
        wallField('front', w);
        return panel('front', 'Front panel', w, at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]), [['bottom', 0], ['left', 3], undefined, ['right', 1]]);
      })()
    : panel('front', 'Front wall', wallField('front', wall(x, hw, [f, F, e, F])), at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]), [['bottom', 0], ['left', 3], undefined, ['right', 1]]);
  const specs: PanelSpec[] = [
    front,
    panel('right', 'Right wall', vented(wall(y, hw, [f, f, e, f])), at([X, t + y, t], [0, -1, 0], [0, 0, 1]), [['bottom', 1], ['front', 3], undefined, ['back', 1]]),
    panel('back', 'Back wall', wallField('back', wall(x, hw, [f, F, e, F])), at([t, Y, t], [1, 0, 0], [0, 0, 1]), [['bottom', 2], ['right', 3], undefined, ['left', 1]]),
    panel('left', 'Left wall', vented(wall(y, hw, [f, f, e, f])), at([0, t, t], [0, 1, 0], [0, 0, 1]), [['bottom', 3], ['back', 3], undefined, ['front', 1]]),
  ];

  // Bottom plate: notched all round (a rack box has fingers into the front panel's notched bottom);
  // mounting holes inside, or in flanges along x reached through slot rows for the side walls.
  const m = s.mounts;
  const flange = m?.outside ? 2 * m.dist : 0;
  const side: WallEdge = flange > 0 ? 'fingerHoles' : F;
  const bw = rectangularWall(x, y, [rack ? f : F, side, F, side], ctx, flange > 0 ? { brim: flange } : {});
  if (m) {
    const r = m.d / 2;
    if (m.outside) {
      // Flange from t (past the slot row) to t + 2 dist outside each side wall: hole in its middle.
      if (!(m.dist >= r + 1))
        throw new ParamError(`holedist too small: the flange holes need at least the hole radius + 1 mm = ${(r + 1).toFixed(1)} mm`, 'holedist');
      // The flange's front edge is the plate's front edge: one thickness out ('F'), or on the inner
      // line where the plate's fingers go into a rack panel.
      const f0 = rack ? 0 : t;
      if (!(2 * m.dist + 2 * r + 2 <= y + t + f0))
        throw new ParamError(`holedist too large: the front and back flange holes would meet on a ${(y + t + f0).toFixed(1)} mm deep flange`, 'holedist');
      for (const cx of [-t - m.dist, x + t + m.dist]) for (const cy of [m.dist - f0, y + t - m.dist]) bw.holes.push(circle(cx, cy, r));
    } else {
      if (!(m.dist >= r + 1))
        throw new ParamError(`holedist too small: the mounting holes need at least the hole radius + 1 mm = ${(r + 1).toFixed(1)} mm from the walls`, 'holedist');
      if (!(2 * m.dist + 2 * r + 2 <= Math.min(x, y)))
        throw new ParamError(`holedist too large: the mounting holes would meet on a ${Math.min(x, y).toFixed(1)} mm inner side`, 'holedist');
      for (const cx of [m.dist, x - m.dist]) for (const cy of [m.dist, y - m.dist]) bw.holes.push(circle(cx, cy, r));
    }
  }
  specs.push(panel('bottom', 'Bottom', bw, at([t, t, 0], [1, 0, 0], [0, 1, 0]), [['front', 0], ['right', 0], ['back', 0], ['left', 0]]));

  // Lid: inset, top face flush with the walls (z = Z), outer face up.
  const tr = s.triangle;
  const c3 = tr / 3;
  const lidHoles = [circle(c3, c3, s.d2 / 2), circle(x - c3, c3, s.d2 / 2), circle(x - c3, y - c3, s.d2 / 2), circle(c3, y - c3, s.d2 / 2)];
  const lidWall: Wall = { outline: rectangularWall(x, y, [e, e, e, e], ctx).outline, holes: lidHoles, lines: [] };
  if (s.holes?.where === 'lid')
    field(lidWall, x, y - fm, [[c3, c3], [x - c3, c3], [x - c3, y - c3], [c3, y - c3]].map(([cx, cy]) => ({ c: { x: cx!, y: cy! }, r: Math.max(s.d2 / 2, tr / 2) })));
  const lid = panel('lid', 'Lid', lidWall,
    at([t, t + y, Z], [1, 0, 0], [0, -1, 0]), []);
  specs.push(lid);

  // Corner triangles: top face at z = hw (under the lid), normal down; local (0, 0) at the inner
  // corner, u and v along the two walls with u x v = -z. Side 0 (along u) fingers into the wall
  // behind -v, side 2 (along v) into the wall behind -u.
  const wallBehind = (d: Vec3): PanelSpec => {
    const id = d[0] > 0.5 ? 'left' : d[0] < -0.5 ? 'right' : d[1] > 0.5 ? 'front' : 'back';
    return specs.find((q) => q.id === id)!;
  };
  const corners: [Vec3, Vec3, Vec3][] = [
    [[t, t, hw], [1, 0, 0], [0, 1, 0]],
    [[t + x, t, hw], [-1, 0, 0], [0, 1, 0]],
    [[t + x, t + y, hw], [-1, 0, 0], [0, -1, 0]],
    [[t, t + y, hw], [1, 0, 0], [0, -1, 0]],
  ];
  const triPts: Vec2[] = [{ x: 0, y: 0 }, { x: tr, y: 0 }, { x: 0, y: tr }];
  corners.forEach(([P, a, b], k) => {
    const down = cross3(a, b)[2] < 0;
    const [u, v] = down ? [a, b] : [b, a];
    const tri = polygonPlate(triPts, ['finger', 'flat', 'finger'], ctx, [circle(c3, c3, s.d1 / 2)]);
    tri.lines = tri.lines.filter((l) => l.type !== 'flat');
    const spec = panel(`triangle${k + 1}`, `Lid triangle ${k + 1}`, tri, at(P, u, v), []);
    specs.push(spec);
    slotInto(wallBehind(v), spec, [0], ctx);
    slotInto(wallBehind(u), spec, [2], ctx);
    // The lid rests on the triangle along the wall behind -v (the triangle's leg on side 0).
    rest(lid, spec, P, [P[0] + tr * u[0], P[1] + tr * u[1], P[2] + tr * u[2]], 600 + k, t, [true, false]);
  });
  autoMate(specs);
  return finishPanels(specs, t, s.kerf);
}

// ---------------------------------------------------------------- the generator

export const ELECTRONICS_CATEGORY = 'Electronics';

/** One rack unit (mm), the clearance between stacked panels, ear slot size and EIA hole height. */
const U = 44.45;
const PANEL_GAP = 0.79;
const SLOT_W = 10;
const SLOT_H = 6.5;
const HOLE_Z = 6.35;

/** EIA-310 rack fronts: panel width, body width (passes between the rails), ear hole spacing. */
type RackStandard = { panel: number; body: number; spacing: number };
const RACKS: Record<string, RackStandard> = {
  rack19: { panel: 482.6, body: 448, spacing: 465.1 },
  rack10: { panel: 254, body: 219, spacing: 236.525 },
};

const schema: Schema = [
  { key: 'front', label: 'Front', help: 'Plain front wall, or a 19" / 10" rack panel with ears (then the width and height come from the rack standard and "Height units")',
    group: 'Type', kind: 'enum', options: ['plain', 'rack19', 'rack10'], default: 'plain' },
  { key: 'x', label: 'Width', help: 'Width along x (inner or outer, see "Inner dimensions"); fixed by the standard for a rack front', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 600, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 600, default: 80, step: 1 },
  { key: 'h', label: 'Height', help: 'Inner: usable height below the lid triangles. Outer: bottom to lid top. Ignored for a rack front', unit: 'mm',
    group: 'Size', kind: 'number', min: 15, max: 400, default: 50, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: the outside of the body (without flanges or ears)',
    group: 'Size', kind: 'bool', default: true },
  { key: 'rack_units', label: 'Height units', help: 'Rack front only: height in rack units (1 U = 44.45 mm)', unit: '', group: 'Size',
    kind: 'int', min: 1, max: 8, default: 2 },
  { key: 'triangle', label: 'Lid triangles', help: 'Side of the four corner triangles the lid is screwed into', unit: 'mm',
    group: 'Lid', kind: 'number', min: 10, max: 60, default: 25, step: 1 },
  { key: 'd1', label: 'Triangle hole', help: 'Screw hole in the triangles (the screw cuts its thread here, e.g. 2 mm for M2.5)', unit: 'mm',
    group: 'Lid', kind: 'number', min: 1, max: 6, default: 2, step: 0.1 },
  { key: 'd2', label: 'Lid hole', help: 'Clearance hole for the lid screws', unit: 'mm',
    group: 'Lid', kind: 'number', min: 1, max: 8, default: 3, step: 0.1 },
  { key: 'mounts', label: 'Mounting holes', help: 'Four holes in the bottom: in flanges left and right of the box, inside it (for standoffs or screws through the floor), or none',
    group: 'Mounting', kind: 'enum', options: ['flanges', 'inside', 'none'], default: 'flanges' },
  { key: 'd3', label: 'Mounting hole', help: 'Diameter of the mounting holes', unit: 'mm',
    group: 'Mounting', kind: 'number', min: 1, max: 10, default: 3, step: 0.1 },
  { key: 'holedist', label: 'Hole distance', help: 'Distance of the mounting holes from the walls (inside) or the flange edges (flanges are twice this wide)', unit: 'mm',
    group: 'Mounting', kind: 'number', min: 3, max: 20, default: 7, step: 0.5 },
  { key: 'vents', label: 'Vents', help: 'Rows of ventilation slots in the left and right walls', group: 'Mounting', kind: 'bool', default: false },
  { key: 'panel_holes', label: 'Hole field', help: 'A field of holes (vent, speaker grille, LED window) in the lid, front or back panel', group: 'Holes',
    kind: 'enum', options: ['none', 'lid', 'front', 'back'], default: 'none' },
  { key: 'hole_pattern', label: 'Hole pattern', help: 'Round holes on a square grid or hex-packed, squares or slots', group: 'Holes',
    kind: 'enum', options: ['hex', 'circles', 'squares', 'slots'], default: 'hex' },
  { key: 'hole_size', label: 'Hole size', help: 'Diameter of round holes, side of squares, width of slots', unit: 'mm', group: 'Holes', kind: 'number', min: 1, max: 20, default: 4, step: 0.1 },
  { key: 'hole_spacing', label: 'Hole spacing', help: 'Distance between hole centres', unit: 'mm', group: 'Holes', kind: 'number', min: 2, max: 40, default: 6, step: 0.1 },
  // Thicker stock leaves no room for the lid triangles of an enclosure this size.
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

const rackOf = (p: Params): RackStandard | undefined => RACKS[String(p.front)];
const panelHeight = (p: Params): number => num(p, 'rack_units') * U - PANEL_GAP;

/** Inner x, y and the walls' height above the bottom plate (triangle + lid included). */
function innerSize(p: Params): { x: number; y: number; hw: number } {
  const t = num(p, 'thickness');
  const out = p.inside === false;
  const y = num(p, 'y') - (out ? 2 * t : 0);
  const r = rackOf(p);
  if (r) return { x: r.body - 2 * t, y, hw: panelHeight(p) - t };
  if (out) return { x: num(p, 'x') - 2 * t, y, hw: num(p, 'h') - t };
  return { x: num(p, 'x'), y, hw: num(p, 'h') + 2 * t };
}

/** Rack panel ear slots, panel-local (inner rectangle from the body's inner corner, u = -x). */
function rackHoles(r: RackStandard, P: number, t: number): (w: number) => Path[] {
  const ear = (r.panel - r.body) / 2;
  const e = (r.panel - r.spacing) / 2; // slot centre from the panel's side edge
  const z0 = HOLE_Z - PANEL_GAP / 2; // slot centre above the panel's bottom edge
  return (w) => [t + w + ear - e, -t - ear + e].flatMap((cx) => [z0 - t, P - z0 - t].map((cy) => roundedRect(cx, cy, SLOT_W, SLOT_H, SLOT_H / 2)));
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, hw } = innerSize(p);
  const r = rackOf(p);
  const mounts = p.mounts === 'none' ? undefined : { d: num(p, 'd3'), dist: num(p, 'holedist'), outside: p.mounts !== 'inside' };
  return enclosure({
    x, y, hw, ctx, kerf: effectiveKerf(p),
    triangle: num(p, 'triangle'), d1: num(p, 'd1'), d2: num(p, 'd2'),
    ...(mounts ? { mounts } : {}),
    ...(r ? { rack: { ear: (r.panel - r.body) / 2, holes: rackHoles(r, panelHeight(p), t) } } : {}),
    vents: p.vents === true,
    ...(p.panel_holes && p.panel_holes !== 'none' ? { holes: { where: p.panel_holes as 'lid' | 'front' | 'back',
      spec: { kind: p.hole_pattern as PatternSpec['kind'], hole: num(p, 'hole_size'), spacing: num(p, 'hole_spacing'), slot: 4 * num(p, 'hole_size') } } } : {}),
    keys: r ? { x: 'thickness', y: 'y', hw: 'rack_units' } : { x: 'x', y: 'y', hw: 'h' },
  });
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const { x, y, hw } = innerSize(p);
  const body = x + 2 * t + (p.mounts === 'flanges' ? 4 * num(p, 'holedist') : 0);
  const r = rackOf(p);
  return { x: r ? Math.max(r.panel, body) : body, y: y + 2 * t, z: hw + t };
}

export const enclosureBox: Generator = {
  id: 'enclosure',
  name: 'Enclosure',
  category: ELECTRONICS_CATEGORY,
  description: 'Electronics enclosure with a flush screw-on lid: mounting flanges or standoff holes, vents, or a 19"/10" rack front (ElectronicsBox, RackBox, Rack19Box, Rack10Box).',
  schema,
  presets: {
    'ElectronicsBox': { front: 'plain', x: 100, y: 80, h: 50, inside: true, mounts: 'flanges' },
    'Arduino / Raspberry Pi case': { front: 'plain', x: 95, y: 70, h: 35, inside: true, triangle: 18, mounts: 'inside', holedist: 6, vents: true },
    'Rack19Box (19" 2U)': { front: 'rack19', y: 150, rack_units: 2, mounts: 'none' },
    'Rack10Box (10" 3U)': { front: 'rack10', y: 120, rack_units: 3, mounts: 'none', vents: true, thickness: 4 },
    'Power supply case': { front: 'plain', x: 200, y: 120, h: 80, inside: false, triangle: 30, d3: 4, holedist: 8, vents: true, thickness: 4 },
    'Speaker / fan box (grille lid)': { front: 'plain', x: 120, y: 120, h: 60, inside: true, triangle: 22, mounts: 'inside', panel_holes: 'lid', hole_pattern: 'hex', hole_size: 4, hole_spacing: 6 },
  },
  build,
  expectedSize,
};
