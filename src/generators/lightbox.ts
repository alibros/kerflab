/**
 * Light box: a finger-jointed box whose walls (and optionally top) are perforated with a hole
 * pattern, with a cable hole low in the back: a lantern, night light or lamp shade over an LED
 * strip or bulb. Generic stand-in for the boxes.py (florianfesti/boxes) lamps (NightLightBox,
 * Lamp, TriangleLamp): those are presets in spirit, see docs/coverage.md.
 *
 * Joints (edges listed bottom, right, top, left of each panel; as closedbox):
 *    front, back   x * h   'F F F|e F'   hole pattern; the back has the cable hole
 *    sides         y * h   'F f F|e f'   hole pattern
 *    bottom        x * y   'f f f f'
 *    top           x * y   'f f f f'     hole pattern (`top: pattern`), plain (`closed`) or none
 * Each pattern fills the panel's inner rectangle less `border` on every side, centred on it.
 *
 * World frame: as closedbox, outer size x + 2t, y + 2t, h + t (+ t with a top).
 *
 * Deliberate differences from boxes.py: one box shape with perforated walls instead of the
 * layered picture front of NightLightBox and the shade shapes of Lamp / TriangleLamp.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { ELECTRONICS_CATEGORY } from './enclosure';
import { patternHoles, type Keepout, type PatternSpec } from './patterns';
import { at, circle, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec, type Wall } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Inner width', unit: 'mm', group: 'Size', kind: 'number', min: 30, max: 500, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Inner depth', unit: 'mm', group: 'Size', kind: 'number', min: 30, max: 500, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Inner height above the bottom', unit: 'mm', group: 'Size', kind: 'number', min: 30, max: 600, default: 150, step: 1 },
  { key: 'top', label: 'Top', help: 'Perforated top, plain top, or open', group: 'Size', kind: 'enum', options: ['pattern', 'closed', 'none'], default: 'pattern' },
  { key: 'pattern', label: 'Pattern', help: 'Round holes on a hex or square grid, squares or slots', group: 'Pattern',
    kind: 'enum', options: ['hex', 'circles', 'squares', 'slots'], default: 'hex' },
  { key: 'hole', label: 'Hole size', help: 'Diameter of round holes, side of squares, width of slots (slots are 3 times as long)', unit: 'mm',
    group: 'Pattern', kind: 'number', min: 2, max: 40, default: 8, step: 0.5 },
  { key: 'spacing', label: 'Spacing', help: 'Distance between hole centres (across; slots: plus their length along)', unit: 'mm',
    group: 'Pattern', kind: 'number', min: 3, max: 80, default: 12, step: 0.5 },
  { key: 'border', label: 'Border', help: 'Unperforated margin round each panel\'s pattern', unit: 'mm', group: 'Pattern', kind: 'number', min: 3, max: 50, default: 10, step: 0.5 },
  { key: 'cable', label: 'Cable hole', help: 'Diameter of the cable hole low in the back (0: none)', unit: 'mm', group: 'Pattern', kind: 'number', min: 0, max: 20, default: 8, step: 0.5 },
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 8 } : d)),
];

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const x = num(p, 'x');
  const y = num(p, 'y');
  const h = num(p, 'h');
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  requireJointLength('h', h, t);
  const top = p.top !== 'none';
  const b = num(p, 'border');
  const hole = num(p, 'hole');
  const spec: PatternSpec = { kind: p.pattern as PatternSpec['kind'], hole, spacing: num(p, 'spacing'), slot: 3 * hole };
  const keys = { spacing: 'spacing', slot: 'hole' };
  if (2 * b + hole > Math.min(x, y, h))
    throw new ParamError(`border too wide: ${b} mm each side leaves no room for a ${hole} mm hole in the smallest panel`, 'border');
  /** Pattern over the inner w x hh rectangle less the border, clear of `keep`. */
  const perforate = (wall: Wall, w: number, hh: number, keep: Keepout[] = []): Wall => {
    wall.holes.push(...patternHoles(spec, { kind: 'rect', x0: b, y0: b, x1: w - b, y1: hh - b }, { x: w / 2, y: hh / 2 }, keep, 2, keys));
    return wall;
  };
  const X = x + 2 * t;
  const Y = y + 2 * t;
  const Z = h + (top ? 2 : 1) * t;
  const F = 'fingerHole' as const;
  const f = 'finger' as const;
  const rim = top ? F : 'flat';
  const back = rectangularWall(x, h, [F, F, rim, F], ctx);
  const cable = num(p, 'cable');
  const keep: Keepout[] = [];
  if (cable > 0) {
    const c = { x: x / 2, y: cable / 2 + 3 };
    back.holes.push(circle(c.x, c.y, cable / 2));
    keep.push({ c, r: cable / 2 });
  }
  const specs: PanelSpec[] = [
    panel('front', 'Front', perforate(rectangularWall(x, h, [F, F, rim, F], ctx), x, h), at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]),
      [['bottom', 0], ['left', 3], top ? ['top', 2] : undefined, ['right', 1]]),
    panel('right', 'Right side', perforate(rectangularWall(y, h, [F, f, rim, f], ctx), y, h), at([X, t + y, t], [0, -1, 0], [0, 0, 1]),
      [['bottom', 1], ['front', 3], top ? ['top', 1] : undefined, ['back', 1]]),
    panel('back', 'Back', perforate(back, x, h, keep), at([t, Y, t], [1, 0, 0], [0, 0, 1]),
      [['bottom', 2], ['right', 3], top ? ['top', 0] : undefined, ['left', 1]]),
    panel('left', 'Left side', perforate(rectangularWall(y, h, [F, f, rim, f], ctx), y, h), at([0, t, t], [0, 1, 0], [0, 0, 1]),
      [['bottom', 3], ['back', 3], top ? ['top', 3] : undefined, ['front', 1]]),
    panel('bottom', 'Bottom', rectangularWall(x, y, [f, f, f, f], ctx), at([t, t, 0], [1, 0, 0], [0, 1, 0]),
      [['front', 0], ['right', 0], ['back', 0], ['left', 0]]),
  ];
  if (top) {
    const lid = rectangularWall(x, y, [f, f, f, f], ctx);
    specs.push(panel('top', 'Top', p.top === 'pattern' ? perforate(lid, x, y) : lid, at([t, t + y, Z], [1, 0, 0], [0, -1, 0]),
      [['back', 2], ['right', 2], ['front', 2], ['left', 2]]));
  }
  return finishPanels(specs, t, effectiveKerf(p));
}

export const lightBox: Generator = {
  id: 'lightbox',
  name: 'Light box',
  category: ELECTRONICS_CATEGORY,
  description: 'Lantern / night light / lamp box with hole-pattern walls and a cable hole, over an LED strip or bulb (Lamp, NightLightBox, TriangleLamp).',
  schema,
  presets: {
    'Lantern (hex holes)': { x: 100, y: 100, h: 150, top: 'pattern', pattern: 'hex', hole: 8, spacing: 12 },
    'NightLightBox (low, slots)': { x: 160, y: 60, h: 100, top: 'closed', pattern: 'slots', hole: 4, spacing: 9, border: 12, cable: 6 },
    'Lamp shade (open top)': { x: 150, y: 150, h: 220, top: 'none', pattern: 'circles', hole: 12, spacing: 18, cable: 10, thickness: 4 },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    return { x: num(p, 'x') + 2 * t, y: num(p, 'y') + 2 * t, z: num(p, 'h') + (p.top === 'none' ? 1 : 2) * t };
  },
};
