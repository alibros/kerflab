/**
 * Strap clamp (step clamp / hold-down): a flat bar with a bolt slot, its rear end raised on a heel
 * of stacked plates as tall as the workpiece, so tightening a bolt or wing nut in the slot presses
 * the front end down on the work. Holds sheet or a jig on a laser bed with threaded holes or slots
 * in its frame, or work on a drill-press or router table. Generic stand-in for boxes.py
 * (florianfesti/boxes) LaserClamp (laserclamp.py, a scissor clamp with a threaded rod).
 *
 * Each clamp is a stack (`assembly: 'loose'`, glued plates face to face): `heel` plates of
 * `heel_length` x `width` at the rear, then the bar on top. Clamps are laid side by side along y.
 * World frame: x along the bar (front, the pressing end, at x = 0), z up.
 */
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { materialParams } from './gears';
import { JIGS_CATEGORY } from './holdfast';
import { at, num, roundedRect } from './walls';

const schema: Schema = [
  { key: 'length', label: 'Length', help: 'Length of the bar', unit: 'mm', group: 'Clamp', kind: 'number', min: 50, max: 250, default: 100, step: 1 },
  { key: 'width', label: 'Width', help: 'Width of the bar', unit: 'mm', group: 'Clamp', kind: 'number', min: 15, max: 60, default: 25, step: 1 },
  { key: 'bolt', label: 'Bolt', help: 'Bolt diameter (the slot is 0.5 mm wider)', unit: 'mm', group: 'Clamp', kind: 'number', min: 3, max: 12, default: 6, step: 0.5 },
  { key: 'slot', label: 'Slot length', help: 'Travel of the bolt slot (0: a round hole)', unit: 'mm', group: 'Clamp', kind: 'number', min: 0, max: 100, default: 25, step: 1 },
  { key: 'heel', label: 'Heel plates', help: 'Plates stacked under the rear end: make the heel as tall as the work you clamp', unit: '',
    group: 'Clamp', kind: 'int', min: 1, max: 10, default: 1 },
  { key: 'heel_length', label: 'Heel length', help: 'Length of the heel plates', unit: 'mm', group: 'Clamp', kind: 'number', min: 10, max: 60, default: 20, step: 1 },
  { key: 'count', label: 'Count', help: 'Number of clamps to cut', unit: '', group: 'Clamp', kind: 'int', min: 1, max: 8, default: 2 },
  ...materialParams,
];

function check(p: Params): void {
  const L = num(p, 'length');
  const w = num(p, 'width');
  const d = num(p, 'bolt') + 0.5;
  const hl = num(p, 'heel_length');
  if (!(d <= w - 6)) throw new ParamError(`bolt too large for a ${w} mm bar (at most ${(w - 6.5).toFixed(1)} mm)`, 'bolt');
  if (!(hl <= L / 3)) throw new ParamError(`heel_length too long: at most a third of the bar (${(L / 3).toFixed(1)} mm)`, 'heel_length');
  // The slot is centred at 45 % of the length: 10 mm clear of the front end, 3 mm clear of the heel.
  const room = Math.min(0.45 * L - 10, 0.55 * L - hl - 3) * 2 - d;
  if (!(num(p, 'slot') <= room)) throw new ParamError(`slot too long: at most ${Math.max(0, room).toFixed(1)} mm between the nose and the heel`, 'slot');
}

function build(p: Params): Part[] {
  check(p);
  const t = num(p, 'thickness');
  const kerf = effectiveKerf(p);
  const L = num(p, 'length');
  const w = num(p, 'width');
  const hl = num(p, 'heel_length');
  const n = num(p, 'heel');
  const d = num(p, 'bolt') + 0.5;
  const sl = num(p, 'slot');
  const r = Math.min(w / 4, 6);
  const bar = roundedRect(L / 2, w / 2, L, w, r);
  const slot = roundedRect(0.45 * L, w / 2, sl + d, d, d / 2);
  const heel = roundedRect(L - hl / 2, w / 2, hl, w, Math.min(r, hl / 2));
  const parts: Part[] = [];
  for (let c = 0; c < num(p, 'count'); c++) {
    const y = c * (w + 5);
    for (let k = 0; k < n; k++)
      parts.push(finishWithKerf({ id: `clamp${c + 1}_heel${k + 1}`, name: 'Heel plate', outline: heel, holes: [], engrave: [],
        placement: at([0, y, k * t], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [] }, kerf));
    parts.push(finishWithKerf({ id: `clamp${c + 1}_bar`, name: 'Bar', outline: bar, holes: [slot], engrave: [],
      placement: at([0, y, n * t], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [] }, kerf));
  }
  return parts;
}

export const strapClamp: Generator = {
  id: 'strapclamp',
  name: 'Strap clamp',
  category: JIGS_CATEGORY,
  description: 'Hold-down strap (step) clamp: a slotted bar on a stacked heel, bolted down to press work onto the laser bed or a machine table (LaserClamp).',
  schema,
  presets: {
    'LaserClamp (3 mm sheet)': { length: 100, width: 25, bolt: 6, slot: 25, heel: 1, heel_length: 20, count: 4, thickness: 3 },
    'Heavy hold-down (M8)': { length: 160, width: 40, bolt: 8, slot: 40, heel: 4, heel_length: 30, count: 2, thickness: 6 },
  },
  build,
  assembly: 'loose',
  expectedSize: (p) => {
    const c = num(p, 'count');
    const w = num(p, 'width');
    return { x: num(p, 'length'), y: (c - 1) * (w + 5) + w, z: (num(p, 'heel') + 1) * num(p, 'thickness') };
  },
};
