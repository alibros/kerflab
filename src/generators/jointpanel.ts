/**
 * Joined panel: a panel larger than the laser's bed, cut as a grid of tiles that interlock with
 * dovetails along every seam. Generic version of boxes.py (florianfesti/boxes) JointPanel
 * (jointpanel.py, DoveTailJoint edges).
 *
 * The panel (x * y) is split into nx * ny equal tiles, nx and ny the fewest that keep every tile,
 * tails included, within `tile_x` * `tile_y`. Each tile carries tails on its right and top seams
 * and matching sockets on its left and bottom seams. Tails flare from `tail` wide at the seam to
 * tail + 2 depth tan(angle) at their tip, spread evenly along the seam (centred, at least depth + 1
 * mm from the panel's corners); tails are `clearance` narrower than their sockets. Tiles are
 * separate pieces lying in the panel's plane (`assembly: 'loose'`).
 *
 * Deliberate differences from boxes.py (docs/differences.md): straight-sided dovetails (boxes.py
 * rounds the corners); the tile grid comes from the maximum tile size.
 */
import type { Path, Vec2 } from '../core/geometry';
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { materialParams } from './gears';
import { PANEL_CATEGORY } from './patternpanel';
import { at, num } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width of the whole panel', unit: 'mm', group: 'Panel', kind: 'number', min: 100, max: 3000, default: 600, step: 1 },
  { key: 'y', label: 'Height', help: 'Height of the whole panel', unit: 'mm', group: 'Panel', kind: 'number', min: 100, max: 3000, default: 400, step: 1 },
  { key: 'tile_x', label: 'Max tile width', help: 'Largest piece your laser can cut, across (tails included)', unit: 'mm', group: 'Panel', kind: 'number', min: 80, max: 1500, default: 300, step: 1 },
  { key: 'tile_y', label: 'Max tile height', help: 'Largest piece your laser can cut, up (tails included)', unit: 'mm', group: 'Panel', kind: 'number', min: 80, max: 1500, default: 300, step: 1 },
  { key: 'tail', label: 'Tail width', help: 'Width of a dovetail at the seam', unit: 'mm', group: 'Dovetails', kind: 'number', min: 5, max: 40, default: 12, step: 0.5 },
  { key: 'depth', label: 'Tail depth', help: 'How far the dovetails reach into the neighbouring tile', unit: 'mm', group: 'Dovetails', kind: 'number', min: 3, max: 25, default: 8, step: 0.5 },
  { key: 'angle', label: 'Flare', help: 'Flare angle of the dovetails\' sides', unit: 'deg', group: 'Dovetails', kind: 'number', min: 5, max: 20, default: 12, step: 0.5 },
  { key: 'clearance', label: 'Clearance', help: 'How much narrower the tails are than their sockets', unit: 'mm', group: 'Dovetails', kind: 'number', min: 0, max: 0.5, default: 0.1, step: 0.01 },
  ...materialParams,
];

/** Most tiles in one panel. */
const MAX_TILES = 64;

type Grid = { nx: number; ny: number; w: number; h: number };

function grid(p: Params): Grid {
  const d = num(p, 'depth');
  const X = num(p, 'x');
  const Y = num(p, 'y');
  const nx = Math.max(1, Math.ceil(X / (num(p, 'tile_x') - d)));
  const ny = Math.max(1, Math.ceil(Y / (num(p, 'tile_y') - d)));
  if (nx * ny > MAX_TILES) throw new ParamError(`tile_x too small: the panel would need ${nx} x ${ny} tiles (at most ${MAX_TILES})`, 'tile_x');
  return { nx, ny, w: X / nx, h: Y / ny };
}

/**
 * Points of one seam from a to b (excluding a, including b): dovetails `out` (+1: tails to the right of
 * travel, -1: sockets into the left), centred along the seam.
 */
function seam(a: Vec2, b: Vec2, out: 1 | -1, p: Params, narrow: number): Vec2[] {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const r = { x: u.y, y: -u.x }; // right of travel
  const d = num(p, 'depth');
  const tw = num(p, 'tail') - narrow;
  const full = num(p, 'tail') + 2 * d * Math.tan((num(p, 'angle') * Math.PI) / 180);
  const tip = full - narrow;
  // Pitch and count from the full (socket) size, so a seam's tails and sockets line up.
  const pitch = num(p, 'tail') + full;
  const end = d + 1;
  const n = Math.max(0, Math.floor((L - 2 * end - full) / pitch) + 1);
  const at = (s: number, o: number): Vec2 => ({ x: a.x + s * u.x + o * out * r.x, y: a.y + s * u.y + o * out * r.y });
  const pts: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const c = L / 2 + (k - (n - 1) / 2) * pitch;
    pts.push(at(c - tw / 2, 0), at(c - tip / 2, d), at(c + tip / 2, d), at(c + tw / 2, 0));
  }
  pts.push(b);
  return pts;
}

function tiles(p: Params): { id: string; name: string; outline: Path }[] {
  const g = grid(p);
  const L = Math.min(g.w, g.h);
  const d = num(p, 'depth');
  const tip = num(p, 'tail') + 2 * d * Math.tan((num(p, 'angle') * Math.PI) / 180);
  if (!(L >= 2 * (d + 1) + tip)) throw new ParamError(`tail too large: a ${tip.toFixed(1)} mm dovetail does not fit on a ${L.toFixed(0)} mm seam`, 'tail');
  if (!(2 * d + 2 <= L)) throw new ParamError('depth too large for the tiles', 'depth');
  const c = num(p, 'clearance');
  const out = [];
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const x0 = i * g.w; const x1 = x0 + g.w; const y0 = j * g.h; const y1 = y0 + g.h;
    const A = { x: x0, y: y0 }; const B = { x: x1, y: y0 }; const C = { x: x1, y: y1 }; const D = { x: x0, y: y1 };
    // Bottom: sockets for the tile below's tails; right: tails; top: tails; left: sockets.
    const pts: Vec2[] = [A,
      ...(j > 0 ? seam(A, B, -1, p, 0) : [B]),
      ...(i < g.nx - 1 ? seam(B, C, 1, p, c) : [C]),
      ...(j < g.ny - 1 ? seam(C, D, 1, p, c) : [D]),
      ...(i > 0 ? seam(D, A, -1, p, 0).slice(0, -1) : [])];
    out.push({ id: `tile_${i + 1}_${j + 1}`, name: `Tile ${i + 1}, ${j + 1}`,
      outline: { start: pts[0]!, closed: true, segs: [...pts.slice(1), pts[0]!].map((to) => ({ t: 'L' as const, to })) } });
  }
  return out;
}

function build(p: Params): Part[] {
  const t = num(p, 'thickness');
  const kerf = effectiveKerf(p);
  return tiles(p).map((q) => finishWithKerf({ ...q, holes: [], engrave: [], placement: at([0, 0, 0], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [] }, kerf));
}

export const jointPanel: Generator = {
  id: 'jointpanel',
  name: 'Joined panel',
  category: PANEL_CATEGORY,
  description: 'Panel larger than your laser bed, cut as tiles that interlock with dovetails (JointPanel).',
  schema,
  presets: {
    'JointPanel (600 x 400 on a 300 mm bed)': { x: 600, y: 400, tile_x: 300, tile_y: 300 },
    'Table top on a small laser': { x: 800, y: 500, tile_x: 280, tile_y: 200, tail: 15, depth: 10, thickness: 6 },
  },
  build,
  assembly: 'loose',
  expectedSize: (p) => ({ x: num(p, 'x'), y: num(p, 'y'), z: num(p, 'thickness') }),
};
