/**
 * TrayInsert: a free-standing grid of crossing dividers (no floor, no outer walls) that drops into
 * an existing box or drawer, ported from boxes.py (florianfesti/boxes,
 * boxes/generators/trayinsert.py).
 *
 * Panels: (rows - 1) dividers along x, x * h, slotted half way down from the top at every
 * crossing; (cols - 1) dividers along y, y * h, slotted half way up from the bottom. All edges
 * are plain; the dividers hold each other at the crossings (crossSlot mates).
 *
 * World frame: the insert fills [0, x - clearance] x [0, y - clearance] x [0, h]: x, y are the
 * inside of the box it fits into and the insert is `clearance` smaller in total so it drops in.
 *
 * Deliberate differences from boxes.py (docs/differences.md): equal compartments (cols x rows over
 * the given x, y) instead of sx/sy lists plus extra margin walls; no draft angle (boxes.py
 * slants the ends of the dividers outwards towards the top).
 */
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { crossing, equal, requireMaxSize, runsFor, slotRanges, slottedSide, TRAY_CATEGORY, wallOffsets } from './trays';
import { at, finishPanels, num, panel, rectangularWall } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Inner width of the box the insert goes into (the insert’s length along x)', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 1500, default: 200, step: 1 },
  { key: 'y', label: 'Depth', help: 'Inner depth of the box the insert goes into', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 1500, default: 150, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the dividers', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 300, default: 40, step: 1 },
  { key: 'cols', label: 'Columns', help: 'Number of compartments along x (at least 2: the dividers must cross)', unit: '',
    group: 'Compartments', kind: 'int', min: 2, max: 10, default: 4 },
  { key: 'rows', label: 'Rows', help: 'Number of compartments along y (at least 2)', unit: '',
    group: 'Compartments', kind: 'int', min: 2, max: 10, default: 3 },
  ...commonParams,
  // Last, after the common params, so fuzz seeds for the earlier params stay stable.
  { key: 'clearance', label: 'Fit clearance', help: 'Total gap between the insert and the box walls: the insert is this much smaller than x and y so it drops in', unit: 'mm',
    group: 'Size', kind: 'number', min: 0.05, max: 5, default: 0.5, step: 0.05 },
];

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const x = num(p, 'x') - num(p, 'clearance');
  const y = num(p, 'y') - num(p, 'clearance');
  const h = num(p, 'h');
  const nx = num(p, 'cols');
  const ny = num(p, 'rows');
  if (!(nx >= 2)) throw new ParamError('cols must be at least 2: an insert needs crossing dividers', 'cols');
  if (!(ny >= 2)) throw new ParamError('rows must be at least 2: an insert needs crossing dividers', 'rows');
  requireMaxSize('x', x);
  requireMaxSize('y', y);
  const sx = equal(x - (nx - 1) * t, nx);
  const sy = equal(y - (ny - 1) * t, ny);
  if (!(sx[0]! >= 2 * t)) throw new ParamError(`x too small: compartments would be ${sx[0]!.toFixed(1)} mm wide, need at least 2 * thickness`, 'x');
  if (!(sy[0]! >= 2 * t)) throw new ParamError(`y too small: compartments would be ${sy[0]!.toFixed(1)} mm deep, need at least 2 * thickness`, 'y');
  if (!(h >= 3 * t)) throw new ParamError(`h too small: needs at least 3 * thickness = ${(3 * t).toFixed(1)} mm`, 'h');
  const xw = wallOffsets(sx, t);
  const yw = wallOffsets(sy, t);

  // Dividers along x: u = x, z = 0 face at y = yw + t (normal -y), slotted from the top.
  const xs = yw.map((y0, i) => {
    const top = runsFor(2, x, h, slotRanges(xw.map((a) => [a, a + t]), ctx.play));
    return panel(`dividerx${i + 1}`, 'Divider (x)', rectangularWall(x, h, ['flat', 'flat', slottedSide(top, 'flat', h / 2, ctx), 'flat'], ctx),
      at([0, y0 + t, 0], [1, 0, 0], [0, 0, 1]), []);
  });
  // Dividers along y: u = y, z = 0 face at x = xw (normal +x), slotted from the bottom.
  const ys = xw.map((x0, j) => {
    const bottom = runsFor(0, y, h, slotRanges(yw.map((a) => [a, a + t]), ctx.play));
    return panel(`dividery${j + 1}`, 'Divider (y)', rectangularWall(y, h, [slottedSide(bottom, 'flat', h / 2, ctx), 'flat', 'flat', 'flat'], ctx),
      at([x0, 0, 0], [0, 1, 0], [0, 0, 1]), []);
  });
  const c = Math.min(t, h / 4);
  xs.forEach((a, i) => ys.forEach((b, j) => {
    const q = (z: number): Vec3 => [xw[j]!, yw[i]! + t, z];
    crossing(a, b, q(h / 2 - c), q(h / 2 + c));
  }));
  return finishPanels([...xs, ...ys], t, effectiveKerf(p));
}

export const trayInsert: Generator = {
  id: 'trayinsert',
  name: 'Tray insert',
  category: TRAY_CATEGORY,
  description: 'Grid of crossing dividers without floor or walls, to divide an existing box or drawer.',
  schema,
  presets: {
    'Drawer divider': { x: 300, y: 400, h: 50, cols: 3, rows: 4 },
    'Box insert': { x: 200, y: 150, h: 40, cols: 4, rows: 3 },
    'Card sorter': { x: 100, y: 280, h: 60, cols: 2, rows: 6 },
  },
  build,
  expectedSize: (p) => ({ x: num(p, 'x') - num(p, 'clearance'), y: num(p, 'y') - num(p, 'clearance'), z: num(p, 'h') }),
};
