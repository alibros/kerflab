/**
 * StorageShelf: an open-fronted shelf box divided into rows by horizontal shelves and into columns
 * by vertical dividers that cross the shelves in half-depth slots (egg-crate), ported from boxes.py
 * (florianfesti/boxes, boxes/generators/storageshelf.py).
 *
 * It is typetray's grid tray (`gridTray`) stood on its back: the tray floor is the back panel,
 * its front and back walls are the bottom and top, its inner x walls the shelves and its inner y
 * walls the dividers; the open top faces the front. Panels (tray edges, see typetray.ts):
 *    back          X * H    'f f f f'   slot rows for every shelf and divider piece
 *    bottom, top   X * d    'F F e F'   own the corner columns; slot rows for the dividers
 *    left, right   H * d    'F f e f'   slot rows for the shelves
 *    shelves       X * d    sides 'f' into the side walls; slotted from the front at each divider
 *    dividers      H * d    ends 'f' into bottom and top; slotted from the back at each shelf
 * X = sum(column widths) + (cols - 1) t, H = sum(row heights) + (rows - 1) t, d the inner depth.
 *
 * World frame: x across, y from the open front (y = 0) to the back, z up. Outer size X + 2t, d + t,
 * H + 2t.
 *
 * Deliberate differences from boxes.py (docs/differences.md): plain open front and plain bottom
 * and top (boxes.py offers top and bottom edge styles and lids); no retainer walls; column and row
 * sizes are counts or relative lists of the overall size (boxes.py: absolute sy / sh lists).
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { STORAGE_CATEGORY, moveSpecs, renameSpecs } from './storage';
import { autoMate, equal, LIST_PATTERN, parseList, proportional } from './trays';
import { checkGrid, gridTray } from './typetray';
import { finishPanels, num, requireJointLength } from './walls';

const MAX_LIST = 10;

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Overall width (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 1500, default: 400, step: 1 },
  { key: 'h', label: 'Height', help: 'Overall height (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 1500, default: 300, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth from the open front to the back (inner, in front of the back panel; or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 600, default: 200, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, h, y are the inner size. Off: they are the overall outer size',
    group: 'Size', kind: 'bool', default: false },
  { key: 'cols', label: 'Columns', help: 'Number of compartments across', unit: '', group: 'Compartments', kind: 'int', min: 1, max: 8, default: 3 },
  { key: 'rows', label: 'Rows', help: 'Number of shelves of compartments, bottom to top', unit: '', group: 'Compartments', kind: 'int', min: 1, max: 8, default: 2 },
  { key: 'sx', label: 'Column sizes', help: 'Optional relative column widths, left to right, comma-separated (e.g. 2,1,1); overrides Columns',
    group: 'Compartments', kind: 'text', default: '', maxLength: 80, pattern: LIST_PATTERN, examples: ['1', '2,1,1', '1,1,2,1,1'] },
  { key: 'sh', label: 'Row sizes', help: 'Optional relative row heights, bottom to top, comma-separated (e.g. 2,1); overrides Rows',
    group: 'Compartments', kind: 'text', default: '', maxLength: 80, pattern: LIST_PATTERN, examples: ['1', '2,1', '1,1,1,2'] },
  ...commonParams,
];

/** Inner column widths, row heights and depth (mm). */
function sizes(p: Params): { sx: number[]; sh: number[]; d: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  const axis = (len: number, countKey: string, listKey: string): number[] => {
    const list = parseList(p, listKey, MAX_LIST);
    const n = list.length || num(p, countKey);
    const free = len - (o ? 2 * t : 0) - (n - 1) * t;
    return list.length ? proportional(free, list) : equal(free, n);
  };
  return { sx: axis(num(p, 'x'), 'cols', 'sx'), sh: axis(num(p, 'h'), 'rows', 'sh'), d: num(p, 'y') - (o ? t : 0) };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { sx, sh, d } = sizes(p);
  checkGrid(sx, sh, t, { x: parseList(p, 'sx', MAX_LIST).length ? 'sx' : 'x', y: parseList(p, 'sh', MAX_LIST).length ? 'sh' : 'h' });
  requireJointLength('y', d, t, 'inner depth');
  const tray = gridTray({ sx, sy: sh, h: d, hi: d, floor: true, fingerholes: 'none', gripDepth: 0 }, ctx);
  autoMate(tray.specs);
  // Stand the tray on its back: tray (x, y, z) -> shelf (x, D - z, y), D = d + t its full height.
  moveSpecs(tray.specs, [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [0, d + t, 0]);
  const names: Record<string, [string, string]> = {
    floor: ['back', 'Back'], front: ['bottom', 'Bottom'], back: ['top', 'Top'], left: ['left', 'Left side'], right: ['right', 'Right side'],
  };
  renameSpecs(tray.specs, (id) => names[id]
    ?? (id.startsWith('innerx') ? [`shelf${id.slice(6)}`, 'Shelf'] : id.startsWith('innery') ? [`divider${id.slice(6)}`, 'Divider'] : undefined));
  return finishPanels(tray.specs, t, effectiveKerf(p));
}

export const storageShelf: Generator = {
  id: 'storageshelf',
  name: 'Storage shelf',
  category: STORAGE_CATEGORY,
  description: 'Open-fronted shelf box divided into rows and columns by crossing shelves and dividers, e.g. to hold type trays.',
  schema,
  presets: {
    'Book cube': { x: 400, h: 300, y: 250, cols: 2, rows: 2, sx: '', sh: '', inside: false },
    'Tray shelf': { x: 300, h: 400, y: 200, cols: 1, rows: 5, sx: '', sh: '', inside: true },
    'Mixed cubbies': { x: 450, h: 360, y: 180, sx: '2,1,1', sh: '1,2', inside: false, thickness: 4 },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    const s = sizes(p);
    const w = (v: number[]): number => v.reduce((a, b) => a + b, 0) + (v.length + 1) * t;
    return { x: w(s.sx), y: s.d + t, z: w(s.sh) };
  },
};
