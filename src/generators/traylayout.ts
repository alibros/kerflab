/**
 * TrayLayout: a type tray whose columns and rows can have different sizes, given as
 * comma-separated lists. boxes.py (florianfesti/boxes, boxes/generators/traylayout.py) is a
 * two-stage generator: TrayLayout turns sx/sy lists into an ASCII-art layout that the user edits
 * (removing wall segments), then TrayLayout2 builds the tray from that text. KerfLab is
 * schema-driven instead (docs/differences.md):
 *
 *  - x, y, h are the overall tray size (outer, or inner with "Inner dimensions" on);
 *  - `cols` / `rows` give equal columns / rows, OR the optional lists `sx` / `sy` give each
 *    column's / row's relative size ("2,1,1" makes the first column twice as wide as the others);
 *    a non-empty list overrides the count. The inner space left after the walls is split in those
 *    proportions, so the headline size is always exactly x * y * h;
 *  - walls are continuous (every grid line is a full wall, crossing the others in half-height
 *    slots), as in TypeTray: removing single wall segments (TrayLayout2's free layouts) is not
 *    supported.
 *
 * The body (floor, outer walls, crossing inner walls, finger cut-outs, grip hole) is typetray's
 * `gridTray`.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { autoMate, equal, LIST_PATTERN, parseList, proportional, TRAY_CATEGORY } from './trays';
import { checkGrid, gridParams, gridTray, heights, trayBody, trayOptions, traySize } from './typetray';
import { finishPanels, num } from './walls';

/** Most entries accepted in a size list (one wall per entry). */
const MAX_LIST = 12;

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Overall width along x (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 1500, default: 200, step: 1 },
  { key: 'y', label: 'Depth', help: 'Overall depth along y (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 1500, default: 150, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the outer walls (inner, above the floor; or the overall height)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 300, default: 40, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inner size. Off: they are the overall outer size',
    group: 'Size', kind: 'bool', default: false },
  ...gridParams,
  { key: 'sx', label: 'Column sizes', help: 'Optional relative column widths, comma-separated (e.g. 2,1,1); overrides Columns. Empty: equal columns',
    group: 'Compartments', kind: 'text', default: '', maxLength: 80, pattern: LIST_PATTERN, examples: ['1', '2,1,1', '1,1,2,1,1', '3,1,1,1,1,1,1,1,1,3'] },
  { key: 'sy', label: 'Row sizes', help: 'Optional relative row depths, comma-separated (e.g. 1,2); overrides Rows. Empty: equal rows',
    group: 'Compartments', kind: 'text', default: '', maxLength: 80, pattern: LIST_PATTERN, examples: ['1', '1,2', '1,1,1,3', '2,1,1,1,1,1,1,2'] },
  ...trayOptions,
  ...commonParams,
];

/** Compartment sizes (inner) along x and y. */
function sizes(p: Params): { sx: number[]; sy: number[] } {
  const t = num(p, 'thickness');
  const o = p.inside === false ? 2 * t : 0;
  const axis = (len: number, countKey: string, listKey: string): number[] => {
    const list = parseList(p, listKey, MAX_LIST);
    const n = list.length || num(p, countKey);
    const free = len - o - (n - 1) * t;
    return list.length ? proportional(free, list) : equal(free, n);
  };
  return { sx: axis(num(p, 'x'), 'cols', 'sx'), sy: axis(num(p, 'y'), 'rows', 'sy') };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { sx, sy } = sizes(p);
  const keys = { x: parseList(p, 'sx', MAX_LIST).length ? 'sx' : 'x', y: parseList(p, 'sy', MAX_LIST).length ? 'sy' : 'y' };
  heights(p, t);
  checkGrid(sx, sy, t, keys, p.bottom !== false);
  const { specs } = gridTray(trayBody(p, sx, sy, t), ctx);
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const trayLayout: Generator = {
  id: 'traylayout',
  name: 'Tray layout',
  category: TRAY_CATEGORY,
  description: 'Tray of the overall size you give, divided into columns and rows of individual sizes (comma-separated lists).',
  schema,
  presets: {
    'Desk organiser': { x: 300, y: 200, h: 50, sx: '2,1,1', sy: '1,2', inside: false },
    'Drawer insert': { x: 400, y: 300, h: 45, sx: '1,1,2,1,1', sy: '1,1', bottom: true, inside: false },
    'Bit tray, cut-outs': { x: 240, y: 120, h: 30, cols: 6, rows: 2, sx: '', sy: '', fingerholes: 'inside-only', inside: true },
  },
  build,
  expectedSize: (p) => {
    const s = sizes(p);
    return traySize(s.sx, s.sy, p);
  },
};
