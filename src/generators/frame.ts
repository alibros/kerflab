/**
 * Picture frame / shadow box: a stack of glued layers, after boxes.py (florianfesti/boxes)
 * PhotoFrame (photoframe.py) and Shadowbox (shadowbox.py). From the bottom:
 *    back       solid plate, optional hanging slot near the top
 *    spacers    `spacers` rings with the visible opening (shadow box depth)
 *    rabbet     `rabbet` rings with an opening the picture (or glass) plus clearance: they hold it
 *    front      ring whose opening overlaps the picture by `lip` on every side
 * All layers share the outer size (picture + 2 x border). A stack (`assembly: 'loose'`), layer k in
 * z in [k t, (k + 1) t]; world x, y across the picture.
 */
import type { Generator, Part } from '../core/part';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { materialParams } from './gears';
import { stack, type Layer } from './roundparts';
import { STORAGE_CATEGORY } from './storage';
import { num, roundedRect } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Picture width', help: 'Width of the picture (or glass) the frame holds', unit: 'mm', group: 'Frame', kind: 'number', min: 30, max: 600, default: 100, step: 1 },
  { key: 'y', label: 'Picture height', help: 'Height of the picture (or glass)', unit: 'mm', group: 'Frame', kind: 'number', min: 30, max: 600, default: 150, step: 1 },
  { key: 'border', label: 'Border', help: 'Width of the frame outside the picture', unit: 'mm', group: 'Frame', kind: 'number', min: 6, max: 100, default: 20, step: 1 },
  { key: 'lip', label: 'Lip', help: 'How far the front overlaps the picture on each side', unit: 'mm', group: 'Frame', kind: 'number', min: 1, max: 30, default: 5, step: 0.5 },
  { key: 'clearance', label: 'Clearance', help: 'Extra room round the picture in the holding layers', unit: 'mm', group: 'Frame', kind: 'number', min: 0, max: 4, default: 1, step: 0.1 },
  { key: 'rabbet', label: 'Holding layers', help: 'Layers with the picture-sized opening (as thick as picture, glass and mat together)', unit: '',
    group: 'Frame', kind: 'int', min: 1, max: 4, default: 1 },
  { key: 'spacers', label: 'Depth layers', help: 'Layers behind the picture with the visible opening: a shadow box this many thicknesses deep', unit: '',
    group: 'Frame', kind: 'int', min: 0, max: 15, default: 0 },
  { key: 'radius', label: 'Corner radius', help: 'Radius of the frame\'s outer corners', unit: 'mm', group: 'Frame', kind: 'number', min: 0, max: 30, default: 0, step: 0.5 },
  { key: 'hang', label: 'Hanging slot', help: 'Slot near the top of the back plate to hang it on a nail or screw', group: 'Frame', kind: 'bool', default: true },
  ...materialParams,
];

function layers(p: Params): Layer[] {
  const x = num(p, 'x');
  const y = num(p, 'y');
  const b = num(p, 'border');
  const lip = num(p, 'lip');
  const c = num(p, 'clearance');
  if (!(Math.min(x, y) - 2 * lip >= 10)) throw new ParamError(`lip too wide: the visible opening would be under 10 mm`, 'lip');
  if (!(b - c / 2 >= 4)) throw new ParamError(`border too narrow for ${c} mm clearance: at least 4 mm of frame must remain`, 'border');
  const W = x + 2 * b;
  const H = y + 2 * b;
  const outer = roundedRect(W / 2, H / 2, W, H, Math.min(num(p, 'radius'), b - c / 2 - 2));
  const visible = roundedRect(W / 2, H / 2, x - 2 * lip, y - 2 * lip, 0);
  const holder = roundedRect(W / 2, H / 2, x + c, y + c, 0);
  const out: Layer[] = [];
  const hang = p.hang === true ? [roundedRect(W / 2, H - b - 10, 5, 14, 2.5)] : [];
  out.push({ id: 'back', name: 'Back', outline: outer, holes: hang });
  for (let k = 0; k < num(p, 'spacers'); k++) out.push({ id: `spacer${k + 1}`, name: 'Depth layer', outline: outer, holes: [visible] });
  for (let k = 0; k < num(p, 'rabbet'); k++) out.push({ id: `holder${k + 1}`, name: 'Holding layer', outline: outer, holes: [holder] });
  out.push({ id: 'front', name: 'Front', outline: outer, holes: [visible] });
  return out;
}

export const frame: Generator = {
  id: 'frame',
  name: 'Picture frame',
  category: STORAGE_CATEGORY,
  description: 'Layered picture frame or shadow box: front, picture-holding layers, depth spacers and a back with a hanging slot (PhotoFrame, Shadowbox, EngravingFrame).',
  schema,
  presets: {
    'PhotoFrame (10 x 15 cm)': { x: 100, y: 150, border: 20, lip: 5, rabbet: 1, spacers: 0 },
    'Shadowbox (A5, 30 mm deep)': { x: 148, y: 210, border: 25, lip: 8, rabbet: 1, spacers: 10, thickness: 3 },
    'EngravingFrame (rounded)': { x: 120, y: 80, border: 15, lip: 3, rabbet: 1, spacers: 0, radius: 8 },
  },
  build: (p: Params): Part[] => stack(layers(p), num(p, 'thickness'), effectiveKerf(p)),
  assembly: 'loose',
  expectedSize: (p) => ({ x: num(p, 'x') + 2 * num(p, 'border'), y: num(p, 'y') + 2 * num(p, 'border'),
    z: (2 + num(p, 'spacers') + num(p, 'rabbet')) * num(p, 'thickness') }),
};
