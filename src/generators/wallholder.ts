/**
 * Wall holder: a wall-mounted bin / rack / tool holder that hangs on a wall system. Generic
 * version of the boxes.py (florianfesti/boxes) wall-mounted family (walledges.py and the Wall*
 * generators): WallRack, WallTypeTray, WallStackableBin, WallDrillBox, WallChiselHolder,
 * WallSlottedHolder, WallPliersHolder, WallConsole; those are presets.
 *
 * Parts (edges listed bottom, right, top, left; see walledges.ts for the back edges):
 *    back plate   (x + 4t) * hb  'F e e e'   notched for the bottom; slot rows and hook holes for
 *                                            the side walls; two screw holes for a plain wall
 *    side walls   profile        'F wall ~ F'  notched along the bottom and front; the back edge
 *                                            carries fingers into the back plate and the hooks
 *    bottom       x * y          'f f f f'   (no front wall: plain front edge)
 *    front        x * hf         'F f e f'
 *    dividers     profile        fingers through slot rows in the bottom, back and front
 *    tool plate   x * y          'f f f f'   optional, one thickness below the front's top,
 *                                            through slot rows in all four walls, with a field of
 *                                            round holes (drill bits) or slots (chisels, pliers)
 * The side profile slopes from the back height hb down to the front height hf.
 *
 * Styles (`style`, default bin = the parts above): `hopper` adds a sloped floor plate (fingers
 * through slot rows in the side walls) from the back plate down to the front and cuts an opening
 * at the bottom of the front (WallHopper); `rod` keeps only the back plate and two brackets with a
 * hole for a rod (WallRollHolder, RollHolder). `steps` splits the tool plate into platforms rising
 * towards the back (WallStairs); only the first is jointed to the front, the last to the back.
 *
 * World frame: x across, y from the front (y = 0) to the back plate's outer face (the wall) at
 * y = y + 2t, z up; the hooks stand out behind the wall plane (they hang in the wall system).
 *
 * Deliberate differences from boxes.py (docs/differences.md): one generic holder instead of a
 * dozen generators; simplified hook shapes; no wall cleat / rail parts; dividers only without a tool
 * plate; the back plate is two thicknesses wider each side (room round the hook holes).
 */
import type { Path, Vec2 } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { edgeFor } from '../core/edges';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { mirrorWall } from './flexwall';
import { patternHoles } from './patterns';
import { profileWall } from './slopedorganizer';
import { traceTo } from './storage';
import { autoMate, equal, slotInto, span, wallOffsets } from './trays';
import { at, circle, finishPanels, num, panel, rect, rectangularWall, requireJointLength, type PanelSpec, type Wall } from './walls';
import { backEdge, backPieces, backReach, fingered, WALL_TYPES, type BackPiece, type WallType } from './walledges';

export const WALL_CATEGORY = 'Wall mount';

const schema: Schema = [
  { key: 'walltype', label: 'Wall system', help: 'What it hangs on: screwed to a plain wall, a French cleat, a slat wall, an IKEA Skadis pegboard or a 35 mm DIN rail',
    group: 'Wall', kind: 'enum', options: [...WALL_TYPES], default: 'french_cleat' },
  { key: 'cleat_depth', label: 'Cleat depth', help: 'French cleat: depth of the tongue that hooks behind the wall cleat', unit: 'mm',
    group: 'Wall', kind: 'number', min: 6, max: 30, default: 12, step: 0.5 },
  { key: 'x', label: 'Compartment width', help: 'Inner width of each compartment', unit: 'mm', group: 'Size', kind: 'number', min: 20, max: 400, default: 120, step: 1 },
  { key: 'cols', label: 'Compartments', help: 'Number of compartments side by side (open holders only)', unit: '', group: 'Size', kind: 'int', min: 1, max: 8, default: 1 },
  { key: 'y', label: 'Depth', help: 'Inner depth from the front to the back plate', unit: 'mm', group: 'Size', kind: 'number', min: 20, max: 300, default: 60, step: 1 },
  { key: 'h', label: 'Back height', help: 'Inner height of the back plate above the bottom', unit: 'mm', group: 'Size', kind: 'number', min: 40, max: 500, default: 100, step: 1 },
  { key: 'front', label: 'Front height', help: 'Height of the front wall as a fraction of the back height', unit: '', group: 'Size', kind: 'number', min: 0.15, max: 1, default: 0.4, step: 0.05 },
  { key: 'tools', label: 'Tool plate', help: 'Plate near the top of the front with holes (drill bits, screwdrivers) or slots (chisels, pliers, wrenches); none for an open bin',
    group: 'Tools', kind: 'enum', options: ['none', 'holes', 'slots'], default: 'none' },
  { key: 'tool_d', label: 'Tool hole', help: 'Diameter of the holes / width of the slots in the tool plate; rod style: the rod diameter', unit: 'mm', group: 'Tools', kind: 'number', min: 2, max: 40, default: 8, step: 0.5 },
  { key: 'tool_spacing', label: 'Tool spacing', help: 'Distance between hole (or slot) centres', unit: 'mm', group: 'Tools', kind: 'number', min: 4, max: 80, default: 15, step: 0.5 },
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 8 } : d)),
  { key: 'style', label: 'Style', help: 'bin: open bin or tool rack; hopper: a sloped inner floor feeds small parts to an opening at the bottom of the front; rod: two brackets holding a rod (roll holder) through holes of the tool hole diameter',
    group: 'Style', kind: 'enum', options: ['bin', 'hopper', 'rod'], default: 'bin' },
  { key: 'steps', label: 'Steps', help: 'Tool plate split into this many platforms rising towards the back like stairs (1: one level plate)',
    unit: '', group: 'Tools', kind: 'int', min: 1, max: 6, default: 1 },
  { key: 'slope', label: 'Hopper slope', help: 'Hopper: slope of the inner floor down to the front', unit: 'deg', group: 'Style',
    kind: 'number', min: 10, max: 60, default: 30, step: 1 },
  { key: 'opening', label: 'Hopper opening', help: 'Hopper: height of the opening at the bottom of the front, one thickness above the inner floor', unit: 'mm',
    group: 'Style', kind: 'number', min: 5, max: 150, default: 30, step: 1 },
];

/** Side wall profile (left, local x from the front inner face to the back plate's inner face). */
function sideWall(y: number, hf: number, hb: number, pieces: BackPiece[], ctx: ReturnType<typeof edgeCtx>): Wall {
  const t = ctx.thickness;
  const F = edgeFor('fingerHole');
  const tt = new Turtle({ x: -t, y: -t });
  tt.forward(t);
  F(tt, y, ctx);
  tt.turn(90);
  tt.forward(t);
  backEdge(pieces, ctx).draw(tt, hb);
  tt.turn(90);
  traceTo(tt, [{ x: 0, y: hf }, { x: -t, y: hf }]);
  tt.turn(90);
  F(tt, hf, ctx);
  tt.forward(t);
  tt.turn(90);
  const lines: Wall['lines'] = [
    { side: 0, type: 'fingerHole', from: { x: 0, y: -t }, to: { x: y, y: -t } },
    { side: 3, type: 'fingerHole', from: { x: -t, y: hf }, to: { x: -t, y: 0 } },
  ];
  let s = 0;
  pieces.forEach((p, k) => {
    if (p.kind === 'joint' && fingered(p.length, ctx)) lines.push({ side: 10 + k, type: 'finger', from: { x: y + t, y: s }, to: { x: y + t, y: s + p.length } });
    s += p.length;
  });
  return { outline: tt.toPath(true), holes: [], lines };
}

/** Rod bracket (left, local x as sideWall): plain bottom, the back edge, a slope down to the front, with the rod hole. */
function rodBracket(y: number, hf: number, hb: number, pieces: BackPiece[], rod: number, ctx: ReturnType<typeof edgeCtx>): Wall {
  const t = ctx.thickness;
  const tt = new Turtle({ x: -t, y: 0 });
  tt.forward(y + t);
  tt.turn(90);
  backEdge(pieces, ctx).draw(tt, hb);
  tt.turn(90);
  traceTo(tt, [{ x: -t, y: hf }]);
  tt.turn(90);
  tt.forward(hf);
  const lines: Wall['lines'] = [];
  let s = 0;
  pieces.forEach((p, k) => {
    if (p.kind === 'joint' && fingered(p.length, ctx)) lines.push({ side: 10 + k, type: 'finger', from: { x: y + t, y: s }, to: { x: y + t, y: s + p.length } });
    s += p.length;
  });
  return { outline: tt.toPath(true), holes: [circle(rod / 2 + t, hf / 2, rod / 2)], lines };
}

type Dims = { sx: number[]; x: number; y: number; hb: number; hf: number; pieces: BackPiece[] };

function dims(p: Params): Dims {
  const t = num(p, 'thickness');
  const n = p.tools === 'none' && (p.style ?? 'bin') === 'bin' ? num(p, 'cols') : 1;
  const sx = equal(n * num(p, 'x'), n);
  const hb = num(p, 'h');
  return { sx, x: span(sx, t), y: num(p, 'y'), hb, hf: num(p, 'front') * hb, pieces: backPieces(p.walltype as WallType, hb, t, num(p, 'cleat_depth'), 'h') };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { sx, x, y, hb, hf, pieces } = dims(p);
  requireJointLength('x', sx[0]!, t, 'compartment width');
  requireJointLength('y', y, t);
  if (!(hf >= 4 * t)) throw new ParamError(`front too small: the front wall would be ${hf.toFixed(1)} mm high, needs at least 4 * thickness = ${(4 * t).toFixed(1)} mm`, 'front');
  const X = x + 2 * t;
  const Y = y + 2 * t;
  const B = 2 * t; // back plate brim past each side wall's inner face: the wall (t) plus t of material
  const style = p.style ?? 'bin';
  const tools = p.tools !== 'none' && style === 'bin';
  if (style === 'rod') return buildRod(p, ctx);

  // Back plate: inner rectangle [0, x] x [0, hb] (world x from t, z from t), outer face at y = Y.
  const backWall = rectangularWall(x, hb, ['fingerHole', { start: B, end: B, draw: (tu, l) => tu.forward(l) }, 'flat', { start: B, end: B, draw: (tu, l) => tu.forward(l) }], ctx);
  const back = panel('back', 'Back plate', backWall, at([t, Y, t], [1, 0, 0], [0, 0, 1]), []);
  const bottom = panel('bottom', 'Bottom', rectangularWall(x, y, ['finger', 'finger', 'finger', 'finger'], ctx), at([t, t, 0], [1, 0, 0], [0, 1, 0]), []);
  const front = panel('front', 'Front', rectangularWall(x, hf, ['fingerHole', 'finger', 'flat', 'finger'], ctx), at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]), []);
  const side = sideWall(y, hf, hb, pieces, ctx);
  const left = panel('left', 'Left side', side, at([0, t, t], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right side', mirrorWall(side, y), at([X, t + y, t], [0, -1, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [back, bottom, front, left, right];
  const jointSides = side.lines.filter((l) => l.side >= 10).map((l) => l.side);
  slotInto(back, left, jointSides, ctx);
  slotInto(back, right, jointSides, ctx);
  // Hook holes: where a side wall passes through the back plate (side thickness by section length).
  let s = 0;
  for (const pc of pieces) {
    if (pc.kind === 'hook') for (const x0 of [-t, x]) back.holes = [...back.holes, rect(x0, s, x0 + t, s + pc.length)];
    s += pc.length;
  }
  if (tools) {
    // Tool plate(s): the first one's top face one thickness below the front's top; with steps,
    // `steps` platforms of equal depth, each one rise higher towards the back (WallStairs).
    const n = num(p, 'steps');
    const rise = (hb - hf) / n;
    if (n > 1 && rise < t)
      throw new ParamError(`steps too many: ${n} steps between the front (${hf.toFixed(0)} mm) and back (${hb.toFixed(0)} mm) heights rise ${rise.toFixed(1)} mm each, at least the thickness ${t} mm`, 'steps');
    const yk = y / n;
    const m = 2 * t;
    const d = num(p, 'tool_d');
    const sp = num(p, 'tool_spacing');
    const kind = p.tools === 'holes' ? 'circles' as const : 'slots' as const;
    for (let k = 0; k < n; k++) {
      const first = k === 0;
      const last = k === n - 1;
      const plate = panel(n === 1 ? 'plate' : `plate${k + 1}`, n === 1 ? 'Tool plate' : `Step ${k + 1}`,
        rectangularWall(x, yk, [first ? 'finger' : 'flat', 'finger', last ? 'finger' : 'flat', 'finger'], ctx),
        at([t, t + k * yk, hf - t + k * rise], [1, 0, 0], [0, 1, 0]), []);
      const holes = patternHoles({ kind, hole: d, spacing: sp, slot: Math.max(d, 0.6 * yk) },
        { kind: 'rect', x0: m, y0: m, x1: x - m, y1: yk - m }, { x: x / 2, y: yk / 2 }, [], 0, { spacing: 'tool_spacing', slot: 'tool_d' });
      if (holes.length === 0) throw new ParamError(`tool_d too large: no ${p.tools} fit in the ${x.toFixed(0)} x ${yk.toFixed(0)} mm tool plate`, 'tool_d');
      plate.holes = holes;
      if (first) slotInto(front, plate, [0], ctx);
      slotInto(right, plate, [1], ctx);
      if (last) slotInto(back, plate, [2], ctx);
      slotInto(left, plate, [3], ctx);
      specs.push(plate);
    }
  } else if (style === 'hopper') {
    // Sloped inner floor from the back plate down to the front, ends one thickness from the walls;
    // the front has the opening from one thickness above the floor's front end.
    const a = (num(p, 'slope') * Math.PI) / 180;
    const c = t;
    const lo = { y: c, z: t / Math.cos(a) + 1 };
    const hi = { y: y - c, z: lo.z + (y - 2 * c) * Math.tan(a) };
    if (hi.z + 2 * t > hb)
      throw new ParamError(`slope too steep: the hopper floor rises to ${hi.z.toFixed(0)} mm at the back, above the back height ${hb.toFixed(0)} mm less two thicknesses`, 'slope');
    const o0 = lo.z + t;
    const o1 = o0 + num(p, 'opening');
    if (o1 + t > hf)
      throw new ParamError(`opening too high: the opening reaches ${o1.toFixed(0)} mm, the front is ${hf.toFixed(0)} mm high (less one thickness above it)`, 'opening');
    front.holes = [...front.holes, rect(t, o0, x - t, o1)];
    const L = Math.hypot(hi.y - lo.y, hi.z - lo.z);
    requireJointLength('y', L, t, 'hopper floor length');
    const floor = panel('floor', 'Hopper floor', rectangularWall(x, L, ['flat', 'finger', 'flat', 'finger'], ctx),
      at([t + x, t + lo.y, t + lo.z], [-1, 0, 0], [0, (hi.y - lo.y) / L, (hi.z - lo.z) / L]), []);
    slotInto(left, floor, [1], ctx);
    slotInto(right, floor, [3], ctx);
    specs.push(floor);
  } else {
    wallOffsets(sx, t).forEach((o, k) => {
      const dv = panel(`divider${k + 1}`, `Divider ${k + 1}`, profileWall(y, hf, hb, false, ctx), at([t + o, t, t], [0, 1, 0], [0, 0, 1]), []);
      slotInto(bottom, dv, [0], ctx);
      slotInto(back, dv, [1], ctx);
      slotInto(front, dv, [3], ctx);
      specs.push(dv);
    });
  }
  if (p.walltype === 'plain') {
    // Two screw holes near the top of the back plate, centred on the outer compartments (clear of
    // the dividers' slot rows); below a tool plate's slot rows when they would meet.
    const r = Math.min(2.5, t);
    let z = hb - 3 * t;
    if (tools && Math.abs(z - (hf - 1.5 * t)) < r + 2 * t) z = (hf - 3 * t) / 2;
    const cx = [sx[0]! / 2, x - sx[sx.length - 1]! / 2];
    const at2: Vec2[] = sx.length === 1 ? [{ x: x / 4, y: z }, { x: (3 * x) / 4, y: z }] : cx.map((c) => ({ x: c, y: z }));
    const extra: Path[] = at2.map((q) => circle(q.x, q.y, r));
    back.holes = [...back.holes, ...extra];
  }
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

/** Rod style (WallRollHolder): the back plate and two brackets holding a rod; no bottom or front. */
function buildRod(p: Params, ctx: ReturnType<typeof edgeCtx>): Part[] {
  const t = ctx.thickness;
  const { x, y, hb, hf, pieces } = dims(p);
  const rod = num(p, 'tool_d');
  if (rod + 4 * t > hf || rod + 4 * t > y)
    throw new ParamError(`tool_d too large: a ${rod} mm rod needs brackets at least ${(rod + 4 * t).toFixed(1)} mm deep and high at the front`, 'tool_d');
  const X = x + 2 * t;
  const Y = y + 2 * t;
  const B = 2 * t;
  const plain = { start: B, end: B, draw: (tu: Turtle, l: number) => tu.forward(l) };
  const back = panel('back', 'Back plate', rectangularWall(x, hb, ['flat', plain, 'flat', plain], ctx), at([t, Y, t], [1, 0, 0], [0, 0, 1]), []);
  const side = rodBracket(y, hf, hb, pieces, rod, ctx);
  const left = panel('left', 'Left bracket', side, at([0, t, t], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right bracket', mirrorWall(side, y), at([X, t + y, t], [0, -1, 0], [0, 0, 1]), []);
  const jointSides = side.lines.filter((l) => l.side >= 10).map((l) => l.side);
  slotInto(back, left, jointSides, ctx);
  slotInto(back, right, jointSides, ctx);
  let s = 0;
  for (const pc of pieces) {
    if (pc.kind === 'hook') for (const x0 of [-t, x]) back.holes = [...back.holes, rect(x0, s, x0 + t, s + pc.length)];
    s += pc.length;
  }
  if (p.walltype === 'plain') {
    const r = Math.min(2.5, t);
    back.holes = [...back.holes, circle(x / 4, hb - 3 * t, r), circle((3 * x) / 4, hb - 3 * t, r)];
  }
  const specs = [back, left, right];
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const wallHolder: Generator = {
  id: 'wallholder',
  name: 'Wall holder',
  category: WALL_CATEGORY,
  description: 'Wall-mounted bin, rack, hopper, stepped tool stand or roll holder hanging on a French cleat, slat wall, Skadis pegboard, DIN rail or screws (WallRack, WallTypeTray, WallDrillBox, WallChiselHolder, WallPliersHolder, WallStackableBin, WallHopper, WallStairs, WallRollHolder, WallCaliper).',
  schema,
  presets: {
    'WallRack (French cleat)': { walltype: 'french_cleat', x: 200, cols: 1, y: 50, h: 100, front: 0.25, tools: 'none' },
    'WallTypeTray (slat wall)': { walltype: 'slatwall', x: 50, cols: 4, y: 60, h: 130, front: 0.5, tools: 'none' },
    'WallDrillBox': { walltype: 'french_cleat', x: 150, cols: 1, y: 60, h: 120, front: 0.7, tools: 'holes', tool_d: 8, tool_spacing: 16 },
    'WallChiselHolder / WallPliersHolder': { walltype: 'french_cleat', x: 240, cols: 1, y: 70, h: 100, front: 0.6, tools: 'slots', tool_d: 12, tool_spacing: 30 },
    'Skadis bin': { walltype: 'skadis', x: 76, cols: 1, y: 50, h: 80, front: 0.5, tools: 'none' },
    'DIN rail box': { walltype: 'dinrail', x: 70, cols: 1, y: 60, h: 90, front: 0.9, tools: 'none' },
    'WallStackableBin (screwed)': { walltype: 'plain', x: 100, cols: 1, y: 80, h: 80, front: 0.5, tools: 'none' },
    'WallHopper': { walltype: 'french_cleat', x: 100, cols: 1, y: 80, h: 160, front: 0.5, tools: 'none', style: 'hopper', slope: 30, opening: 30 },
    'WallStairs (3 steps)': { walltype: 'french_cleat', x: 150, cols: 1, y: 90, h: 140, front: 0.4, tools: 'holes', tool_d: 10, tool_spacing: 20, steps: 3 },
    'WallRollHolder (paper towel)': { walltype: 'french_cleat', x: 290, cols: 1, y: 90, h: 120, front: 0.6, tools: 'none', style: 'rod', tool_d: 25 },
    'WallCaliper (slot plate)': { walltype: 'french_cleat', x: 40, cols: 1, y: 40, h: 100, front: 0.9, tools: 'slots', tool_d: 6, tool_spacing: 60 },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    const { x, y, hb, pieces } = dims(p);
    return { x: x + 4 * t, y: y + 2 * t + backReach(pieces), z: hb + (p.style === 'rod' ? 0 : t) };
  },
};
