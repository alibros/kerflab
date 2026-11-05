/**
 * Holdfast: hooks that hold sheet material down on a laser cutter's honeycomb bed. The shaft goes
 * into a honeycomb cell and the arc-shaped foot presses on the material; the hook at the top
 * catches the cell wall. Ported from boxes.py (florianfesti/boxes, boxes/generators/laserholdfast.py),
 * with a `count` to cut several at once (separate pieces, `assembly: 'loose'`, laid side by side).
 *
 * Profile (boxes.py polyline): shaft `shaftwidth` wide and h + hookheight tall with a round end,
 * the foot an arc of 30 degrees reaching x out, the hook `hookheight` tall.
 */
import { bounds } from '../core/geometry';
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { materialParams } from './gears';
import { traceTo } from './storage';
import { polyline, num, at } from './walls';

export const JIGS_CATEGORY = 'Jigs & tools';

const schema: Schema = [
  { key: 'x', label: 'Reach', help: 'How far the foot reaches from the shaft', unit: 'mm', group: 'Holdfast', kind: 'number', min: 10, max: 80, default: 25, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the shaft below the hook', unit: 'mm', group: 'Holdfast', kind: 'number', min: 15, max: 100, default: 40, step: 1 },
  { key: 'hookheight', label: 'Hook height', help: 'Height of the top hook', unit: 'mm', group: 'Holdfast', kind: 'number', min: 2, max: 15, default: 5, step: 0.5 },
  { key: 'shaftwidth', label: 'Shaft width', help: 'Width of the shaft (must fit the honeycomb cells)', unit: 'mm', group: 'Holdfast', kind: 'number', min: 2, max: 15, default: 5, step: 0.5 },
  { key: 'count', label: 'Count', help: 'Number of holdfasts to cut', unit: '', group: 'Holdfast', kind: 'int', min: 1, max: 12, default: 4 },
  ...materialParams,
];

/** Outline of one holdfast (boxes.py LaserHoldfast.render). */
function outline(p: Params) {
  const x = num(p, 'x');
  const h = num(p, 'h');
  const hh = num(p, 'hookheight');
  const sw = num(p, 'shaftwidth');
  const a = 30;
  const r = x / ((a * Math.PI) / 180);
  if (!(sw - Math.sin(((a / 2) * Math.PI) / 180) * hh >= 1))
    throw new ParamError(`hookheight too large for the shaft: the hook would cut through a ${sw} mm shaft (at most ${((sw - 1) / Math.sin(((a / 2) * Math.PI) / 180)).toFixed(1)} mm)`, 'hookheight');
  const tu = new Turtle();
  polyline(tu, [hh + h, [180, sw / 2], h, -90 + a / 2, 0, [-a, r], 0, [180, hh / 2], 0, [a, r + hh], 0, -a / 2]);
  // boxes.py ends with a run of sw - sin(a / 2) hh that misses the start by a fraction of a
  // millimetre; close with a straight line back to the start instead.
  traceTo(tu, [{ x: 0, y: 0 }]);
  return tu.toPath(true);
}

function layout(p: Params) {
  const o = outline(p);
  const b = bounds(o);
  return { o, b, pitch: b.max.y - b.min.y + 3 };
}

function build(p: Params): Part[] {
  const t = num(p, 'thickness');
  const kerf = effectiveKerf(p);
  const { o, pitch } = layout(p);
  return Array.from({ length: num(p, 'count') }, (_, k) => finishWithKerf({
    id: `holdfast${k + 1}`, name: `Holdfast ${k + 1}`, outline: o, holes: [], engrave: [],
    placement: at([0, k * pitch, 0], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [],
  }, kerf));
}

export const holdfast: Generator = {
  id: 'holdfast',
  name: 'Laser holdfast',
  category: JIGS_CATEGORY,
  description: 'Hooks that hold material down on a laser cutter\'s honeycomb bed (LaserHoldfast).',
  schema,
  presets: {
    'LaserHoldfast': { x: 25, h: 40, hookheight: 5, shaftwidth: 5, count: 4 },
    'Long reach': { x: 45, h: 50, hookheight: 6, shaftwidth: 6, count: 4, thickness: 4 },
  },
  build,
  assembly: 'loose',
  expectedSize: (p) => {
    const { b, pitch } = layout(p);
    return { x: b.max.x - b.min.x, y: (num(p, 'count') - 1) * pitch + (b.max.y - b.min.y), z: num(p, 'thickness') };
  },
};
