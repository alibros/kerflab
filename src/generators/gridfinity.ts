/**
 * Gridfinity: the modular storage grid (42 mm pitch) in laser-cut form, after boxes.py
 * (florianfesti/boxes) GridfinityBase (gridfinitybase.py) and GridfinityTrayLayout
 * (gridfinitytraylayout.py).
 *
 *  - `mode: baseplate`: a grid plate with one rounded square opening per cell, on top of
 *    `layers` solid bottom plates (optionally with magnet holes under each opening). `fit_x` /
 *    `fit_y` fill a drawer: as many cells as fit, the rest becomes an even border.
 *  - `mode: bin`: a finger-jointed tray (typetray body: floor, walls, crossing inner walls for
 *    `cols` x `rows` compartments) whose outer size is the grid size less the clearance, with one
 *    foot plate glued under the floor per grid cell; the feet drop into the baseplate's openings.
 *
 * Both are `assembly: 'loose'`: glued stacks (plates face to face, feet under the floor) rather
 * than parts joined by mates; the bin's tray itself is fully finger-jointed.
 *
 * World frame: x, y across the grid, z up. Baseplate: plates in z in [k t, (k + 1) t], the grid
 * plate on top. Bin: feet in z in [-t, 0], the tray's floor underside at z = 0.
 */
import { type Path } from '../core/geometry';
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { autoMate, equal, TRAY_CATEGORY } from './trays';
import { checkGrid, gridTray } from './typetray';
import { at, circle, finishPanels, num, requireJointLength, roundedRect } from './walls';

/** Gridfinity magnet holes sit 13 mm from the cell centre (26 mm apart) at the standard 42 mm pitch. */
const MAGNET_OFFSET = 13 / 42;
/** Clearance between neighbouring bins (Gridfinity: a bin is 0.5 mm smaller than its grid). */
const BIN_CLEARANCE = 0.5;

const schema: Schema = [
  { key: 'mode', label: 'Part', help: 'Baseplate: the grid the bins drop into. Bin: a compartment tray with feet that fit the baseplate',
    group: 'Grid', kind: 'enum', options: ['baseplate', 'bin'], default: 'baseplate' },
  { key: 'nx', label: 'Cells across', help: 'Grid cells along x (ignored for a baseplate when "Fit width" is set)', unit: '', group: 'Grid', kind: 'int', min: 1, max: 8, default: 3 },
  { key: 'ny', label: 'Cells deep', help: 'Grid cells along y (ignored for a baseplate when "Fit depth" is set)', unit: '', group: 'Grid', kind: 'int', min: 1, max: 8, default: 2 },
  { key: 'pitch', label: 'Pitch', help: 'Grid pitch (Gridfinity: 42 mm)', unit: 'mm', group: 'Grid', kind: 'number', min: 30, max: 60, default: 42, step: 0.5 },
  { key: 'web', label: 'Web', help: 'Material left between neighbouring openings of the baseplate (opening = pitch - web; 4 mm gives the usual 38 mm openings); bin feet are the opening less the foot clearance',
    unit: 'mm', group: 'Grid', kind: 'number', min: 2, max: 12, default: 4, step: 0.1 },
  { key: 'radius', label: 'Corner radius', help: 'Corner radius of the openings and feet', unit: 'mm', group: 'Grid', kind: 'number', min: 0, max: 8, default: 2, step: 0.1 },
  { key: 'magnets', label: 'Magnet holes', help: 'Diameter of the magnet holes (Gridfinity: 6.5 mm for 6 x 2 mm magnets), four per cell; 0 for none',
    unit: 'mm', group: 'Grid', kind: 'number', min: 0, max: 10, default: 0, step: 0.1 },
  { key: 'layers', label: 'Bottom layers', help: 'Baseplate: solid plates under the grid plate (the magnets sit in the first one)', unit: '',
    group: 'Baseplate', kind: 'int', min: 0, max: 3, default: 1 },
  { key: 'fit_x', label: 'Fit width', help: 'Baseplate: width of the drawer to fill (as many cells as fit, the rest an even border); 0 to use "Cells across"',
    unit: 'mm', group: 'Baseplate', kind: 'number', min: 0, max: 600, default: 0, step: 1 },
  { key: 'fit_y', label: 'Fit depth', help: 'Baseplate: depth of the drawer to fill; 0 to use "Cells deep"', unit: 'mm', group: 'Baseplate', kind: 'number', min: 0, max: 600, default: 0, step: 1 },
  { key: 'height', label: 'Bin height', help: 'Bin: outer height of the tray above the feet (Gridfinity units are 7 mm)', unit: 'mm',
    group: 'Bin', kind: 'number', min: 14, max: 200, default: 42, step: 1 },
  { key: 'cols', label: 'Compartments across', help: 'Bin: compartments along x', unit: '', group: 'Bin', kind: 'int', min: 1, max: 6, default: 2 },
  { key: 'rows', label: 'Compartments deep', help: 'Bin: compartments along y', unit: '', group: 'Bin', kind: 'int', min: 1, max: 6, default: 1 },
  { key: 'foot_play', label: 'Foot clearance', help: 'Bin: how much smaller each foot is than the baseplate opening', unit: 'mm',
    group: 'Bin', kind: 'number', min: 0, max: 2, default: 0.5, step: 0.05 },
  // Bins are a few cells across: material up to 6 mm.
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 6 } : d)),
];

/** Cells and border of a baseplate (fit_x / fit_y fill a drawer). */
function grid(p: Params): { nx: number; ny: number; mx: number; my: number; pitch: number } {
  const pitch = num(p, 'pitch');
  const fit = (key: string, cells: string): [number, number] => {
    const f = num(p, key);
    if (!(f > 0) || p.mode !== 'baseplate') return [num(p, cells), 0];
    const n = Math.floor(f / pitch + 1e-9);
    if (n < 1) throw new ParamError(`${key} too small: a ${f} mm drawer does not fit one ${pitch} mm cell`, key);
    if (n > 20) throw new ParamError(`${key} too large: ${n} cells; at most 20 are supported`, key);
    return [n, (f - n * pitch) / 2];
  };
  const [nx, mx] = fit('fit_x', 'nx');
  const [ny, my] = fit('fit_y', 'ny');
  return { nx, ny, mx, my, pitch };
}

/**
 * Magnet holes of one cell centred on (cx, cy), at the Gridfinity offset or closer in when the
 * foot / opening (half side `half`) is small; none when the diameter is 0.
 */
function magnetHoles(p: Params, cx: number, cy: number, half: number, r: number): Path[] {
  const d = num(p, 'magnets');
  if (!(d > 0)) return [];
  // 1 mm of material to the straight sides, and to the rounded corner (centre half - r) on the diagonal.
  const room = r - 1 - d / 2;
  const o = Math.min(MAGNET_OFFSET * num(p, 'pitch'), half - 1 - d / 2, room > 0 ? half - r + room / Math.SQRT2 : Infinity);
  if (!(o >= d / 2 + 1))
    throw new ParamError(`magnets too large: ${d} mm holes ${o.toFixed(1)} mm off centre do not fit a ${(2 * half).toFixed(1)} mm foot or opening`, 'magnets');
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => circle(cx + sx! * o, cy + sy! * o, d / 2));
}

function opening(p: Params): { side: number; r: number } {
  const side = num(p, 'pitch') - num(p, 'web');
  return { side, r: Math.min(num(p, 'radius'), side / 2 - 0.5) };
}

function baseplate(p: Params): Part[] {
  const t = num(p, 'thickness');
  const kerf = effectiveKerf(p);
  const { nx, ny, mx, my, pitch } = grid(p);
  const { side, r } = opening(p);
  const W = nx * pitch + 2 * mx;
  const D = ny * pitch + 2 * my;
  const outline = roundedRect(W / 2, D / 2, W, D, Math.min(4, (pitch - side) / 2 + Math.min(mx, my)));
  const cells: [number, number][] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cells.push([mx + (i + 0.5) * pitch, my + (j + 0.5) * pitch]);
  const n = num(p, 'layers');
  const plates: { id: string; name: string; holes: Path[] }[] = [];
  for (let k = 0; k < n; k++)
    plates.push({ id: `bottom${k + 1}`, name: `Bottom plate ${k + 1}`, holes: k === 0 ? cells.flatMap(([x, y]) => magnetHoles(p, x, y, side / 2, r)) : [] });
  plates.push({ id: 'grid', name: 'Grid plate', holes: cells.map(([x, y]) => roundedRect(x, y, side, side, r)) });
  return plates.map((pl, k) => finishWithKerf({
    id: pl.id, name: pl.name, outline, holes: pl.holes, engrave: [],
    placement: at([0, 0, k * t], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [],
  }, kerf));
}

function binLayout(p: Params) {
  const t = num(p, 'thickness');
  const pitch = num(p, 'pitch');
  const nx = num(p, 'nx');
  const ny = num(p, 'ny');
  const outer = (n: number): number => n * pitch - BIN_CLEARANCE;
  const cols = num(p, 'cols');
  const rows = num(p, 'rows');
  const sx = equal(outer(nx) - (cols + 1) * t, cols);
  const sy = equal(outer(ny) - (rows + 1) * t, rows);
  const h = num(p, 'height') - t;
  return { t, pitch, nx, ny, sx, sy, h, X: outer(nx), Y: outer(ny) };
}

function bin(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const { t, pitch, nx, ny, sx, sy, h } = binLayout(p);
  checkGrid(sx, sy, t, { x: 'cols', y: 'rows' });
  requireJointLength('height', h, t, 'wall height');
  const { specs } = gridTray({ sx, sy, h, hi: h, floor: true, fingerholes: 'none', gripDepth: 0 }, ctx);
  autoMate(specs);
  const parts = finishPanels(specs, t, effectiveKerf(p));
  const { side, r } = opening(p);
  const foot = side - num(p, 'foot_play');
  if (!(foot >= 10)) throw new ParamError('foot_play too large: the feet would be smaller than 10 mm', 'foot_play');
  const fr = Math.min(r, foot / 2 - 0.5);
  // The bin is centred on its grid: cell centres sit half the clearance in from the outer walls' grid lines.
  const c0 = pitch / 2 - BIN_CLEARANCE / 2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    parts.push(finishWithKerf({
      id: `foot${j * nx + i + 1}`, name: 'Foot', outline: roundedRect(0, 0, foot, foot, fr), holes: magnetHoles(p, 0, 0, foot / 2, fr), engrave: [],
      placement: at([c0 + i * pitch, c0 + j * pitch, -t], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [],
    }, effectiveKerf(p)));
  }
  return parts;
}

export const gridfinity: Generator = {
  id: 'gridfinity',
  name: 'Gridfinity',
  category: TRAY_CATEGORY,
  description: 'Gridfinity modular storage, laser-cut: a baseplate grid (fills a drawer) and bins with feet that drop into it (GridfinityBase, GridfinityTrayLayout, GridfinityDrillBox).',
  schema,
  presets: {
    'GridfinityBase (3 x 2)': { mode: 'baseplate', nx: 3, ny: 2, layers: 1, magnets: 0 },
    'Baseplate for a drawer (magnets)': { mode: 'baseplate', fit_x: 300, fit_y: 210, layers: 1, magnets: 6.5 },
    'Gridfinity bin 2 x 1 (2 compartments)': { mode: 'bin', nx: 2, ny: 1, height: 42, cols: 2, rows: 1 },
    'GridfinityTrayLayout (3 x 2, 3 x 2 compartments)': { mode: 'bin', nx: 3, ny: 2, height: 35, cols: 3, rows: 2 },
  },
  build: (p) => (p.mode === 'bin' ? bin(p) : baseplate(p)),
  assembly: 'loose',
  expectedSize: (p) => {
    if (p.mode === 'bin') {
      const { X, Y, t } = binLayout(p);
      return { x: X, y: Y, z: num(p, 'height') + t };
    }
    const { nx, ny, mx, my, pitch } = grid(p);
    return { x: nx * pitch + 2 * mx, y: ny * pitch + 2 * my, z: (num(p, 'layers') + 1) * num(p, 'thickness') };
  },
};
