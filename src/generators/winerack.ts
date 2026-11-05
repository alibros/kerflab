/**
 * WineRack: a honeycomb wine rack: hexagonal cells (pointy top) whose walls stand between a front
 * plate with a bottle hole per cell and a closed back plate, fingered into slot rows in both; a
 * cover with the same bottle holes is glued over the front plate to hide the slots. Ported from
 * boxes.py (florianfesti/boxes, boxes/generators/winerack.py).
 *
 * boxes.py's grid: hexagon side r = 2 (radius + t) tan 30 (apothem radius + t, so a wall's inner
 * face is t/2 outside the bottle hole of radius `radius`), dx = r cos 30, dy = r / 2;
 * cx = floor((x - 2t) / 2dx) cells in the even rows (cx - 1 in the odd rows, offset by dx),
 * cy = floor((y - dy - t) / (r + dy)) rows, the grid centred on the plates. Every hexagon edge in
 * the chosen set is a wall (r - 2 delta) * h, delta = t / (2 sqrt 3), so three walls meeting at a
 * corner touch along their edges without overlapping:
 *    all            every edge of every cell
 *    no_verticals   the slanted edges only (zig-zag bands)
 *    minimal        the slanted edges under a cell (each bottle lies in a V)
 *
 * Panels: cover x * y (bottle holes), front plate x * y (bottle holes, slot rows), back plate
 * x * y (slot rows), walls (r - 2 delta) * h 'f e f e'. World frame: x across, y from the front
 * (cover face y = 0) to the back, z up. Outer size x, h + 3t, y.
 *
 * Deliberate differences from boxes.py (docs/differences.md): the wall sets are defined per cell
 * as above (boxes.py's loops differ at the outermost cells of some rows); the cover is a part of
 * the assembly resting on the front plate (boxes.py draws it as a third plate).
 */
import type { Vec2 } from '../core/geometry';
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { STORAGE_CATEGORY } from './storage';
import { autoMate, holesInside, requireMaxSize, rest, slotInto } from './trays';
import { at, circle, finishPanels, num, panel, rect, rectangularWall, type PanelSpec, type Wall } from './walls';

export const WALLS = ['all', 'no_verticals', 'minimal'] as const;

/** Most honeycomb walls accepted (each is a finger-jointed part). */
const MAX_WALLS = 48;

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width of the plates', unit: 'mm', group: 'Size', kind: 'number', min: 100, max: 600, default: 400, step: 1 },
  { key: 'y', label: 'Height', help: 'Height of the plates', unit: 'mm', group: 'Size', kind: 'number', min: 100, max: 600, default: 300, step: 1 },
  { key: 'h', label: 'Depth', help: 'Depth of the honeycomb between the front and back plates', unit: 'mm', group: 'Size', kind: 'number', min: 30, max: 400, default: 210, step: 1 },
  { key: 'radius', label: 'Hole radius', help: 'Radius of the bottle holes: the bottle\'s radius plus 1–2 mm clearance so it slides in (the cells are a thickness larger)', unit: 'mm',
    group: 'Cells', kind: 'number', min: 30, max: 80, default: 46, step: 0.5 },
  { key: 'walls', label: 'Walls', help: 'Which honeycomb walls to add: all, the slanted ones only, or only those under a bottle',
    group: 'Cells', kind: 'enum', options: [...WALLS], default: 'all' },
  // Stock over 10 mm leaves the short walls no room for fingers.
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

type Grid = { r: number; centres: Vec2[]; edges: [Vec2, Vec2][] };

/** Cell centres and wall edges (plate coordinates: x across, y up), see the file comment. */
export function honeycomb(p: Params): Grid {
  const t = num(p, 'thickness');
  const x = num(p, 'x');
  const y = num(p, 'y');
  const r = 2 * (num(p, 'radius') + t) * Math.tan(Math.PI / 6);
  const dx = r * Math.cos(Math.PI / 6);
  const dy = r / 2;
  const cx = Math.floor((x - 2 * t) / (2 * dx));
  const cy = Math.floor((y - dy - t) / (r + dy));
  if (cx < 1) throw new ParamError(`x too small for one cell of radius ${num(p, 'radius')} mm (needs ${(2 * dx + 2 * t).toFixed(1)} mm)`, 'x');
  if (cy < 1) throw new ParamError(`y too small for one cell of radius ${num(p, 'radius')} mm (needs ${(r + 2 * dy + t).toFixed(1)} mm)`, 'y');
  const ty = cy % 2 ? Math.floor(cy / 2) * (2 * dy + 2 * r) + 2 * dy + r : (cy / 2) * (2 * dy + 2 * r) + dy;
  const ox = (x - 2 * dx * cx) / 2;
  const oy = (y - ty) / 2;
  const centres: Vec2[] = [];
  for (let k = 0; k < cy; k++)
    for (let j = k % 2 ? 1 : 0; j < cx; j++) centres.push({ x: ox + (k % 2 ? 0 : dx) + 2 * dx * j, y: oy + r + k * (r + dy) });
  const corner = (c: Vec2, deg: number): Vec2 => ({ x: c.x + r * Math.cos((deg * Math.PI) / 180), y: c.y + r * Math.sin((deg * Math.PI) / 180) });
  const mode = p.walls as (typeof WALLS)[number];
  const seen = new Map<string, [Vec2, Vec2]>();
  const key = (v: Vec2): string => `${v.x.toFixed(6)},${v.y.toFixed(6)}`;
  for (const c of centres) {
    const angles = mode === 'minimal' ? [[210, 270], [270, 330]] : [[30, 90], [90, 150], [150, 210], [210, 270], [270, 330], [330, 390]];
    for (const [a0, a1] of angles) {
      const A = corner(c, a0!);
      const B = corner(c, a1!);
      if (mode !== 'all' && Math.abs(A.x - B.x) < 1e-6) continue; // vertical
      const k = [key(A), key(B)].sort().join('|');
      if (!seen.has(k)) seen.set(k, [A, B]);
    }
  }
  return { r, centres, edges: [...seen.values()] };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const x = num(p, 'x');
  const y = num(p, 'y');
  const h = num(p, 'h');
  const rb = num(p, 'radius');
  requireMaxSize('x', x);
  requireMaxSize('y', y);
  const g = honeycomb(p);
  if (g.edges.length > MAX_WALLS)
    throw new ParamError(`radius too small for ${x} × ${y} mm plates: ${g.edges.length} walls (at most ${MAX_WALLS}). Use larger holes or smaller plates`, 'radius');
  const delta = t / (2 * Math.sqrt(3));
  const L = g.r - 2 * delta;

  const holes = () => g.centres.map((c) => circle(x - c.x, c.y, rb)); // front-local (u = -x)
  const plate = (withHoles: boolean): Wall => ({ outline: rect(0, 0, x, y), holes: withHoles ? holes() : [], lines: [] });
  // Cover and front plate: u = -x, v = +z, n = +y; the back plate: u = +x, n = -y.
  const cover = panel('cover', 'Cover', plate(true), at([x, 0, 0], [-1, 0, 0], [0, 0, 1]), []);
  const front = panel('front', 'Front plate', plate(true), at([x, t, 0], [-1, 0, 0], [0, 0, 1]), []);
  const back = panel('back', 'Back plate', plate(false), at([0, 3 * t + h, 0], [1, 0, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [cover, front, back];
  g.edges.forEach(([A, B], i) => {
    const ex = (B.x - A.x) / g.r;
    const ez = (B.y - A.y) / g.r;
    // Wall: u along the edge, v = +y (depth), n = (-ez, 0, ex); mid-plane on the edge line.
    const origin: Vec3 = [A.x + delta * ex + (t / 2) * ez, 2 * t, A.y + delta * ez - (t / 2) * ex];
    const w = panel(`wall${i + 1}`, 'Wall', rectangularWall(L, h, ['finger', 'flat', 'finger', 'flat'], ctx), at(origin, [ex, 0, ez], [0, 1, 0]), []);
    slotInto(front, w, [0], ctx);
    slotInto(back, w, [2], ctx);
    specs.push(w);
  });
  for (const s of [front, back])
    if (!holesInside(s.outline, s.holes, 0))
      throw new ParamError('y too small: the outermost slot rows would reach the plate edge', 'y');
  // The cover rests on the front plate: its inner face on the front plate's outer face.
  rest(cover, front, [x, t, 0], [0, t, 0], 50, t, [true, false]);
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const wineRack: Generator = {
  id: 'winerack',
  name: 'Wine rack',
  category: STORAGE_CATEGORY,
  description: 'Honeycomb wine rack: hexagonal cells between a front plate with bottle holes and a back plate.',
  schema,
  presets: {
    'Wine rack': { x: 400, y: 300, h: 210, radius: 46, walls: 'all' },
    'Zig-zag rack': { x: 500, y: 350, h: 200, radius: 46, walls: 'no_verticals', thickness: 4 },
    'Small, minimal': { x: 300, y: 250, h: 150, radius: 40, walls: 'minimal' },
  },
  build,
  expectedSize: (p) => ({ x: num(p, 'x'), y: num(p, 'h') + 3 * num(p, 'thickness'), z: num(p, 'y') }),
};
