/**
 * Pattern panel: a flat plate (any size, rounded corners) with a field of holes (round, hex-packed,
 * square, slots or an IKEA Skadis-style pegboard grid) and optional standard mounting holes
 * (corner screws, a 40-140 mm fan with its grille, a NEMA 17/23 stepper). Generic version of
 * boxes.py (florianfesti/boxes) HolePattern, FanHole, NemaPattern and SkadisBoard
 * (holepattern.py, fanhole.py, nemapattern.py, skadis.py); those are presets. Use it as a vent,
 * speaker grille, fan or motor mount plate, front panel blank or pegboard.
 *
 * The holes fill the plate less `margin` (or a centred circle; a fan mount fills the fan's
 * aperture) on a lattice centred on the plate, and stay one web (spacing - hole) clear of the
 * mounting holes. World frame: the plate in z in [0, t], x * y.
 *
 * Deliberate differences from boxes.py (docs/differences.md): fixed lattice styles; the fan grille
 * is a hole field in the aperture (boxes.py also draws spiral and ring grilles); the Skadis board
 * is the slot grid on a plain plate (no hooks).
 */
import type { Path, Vec2 } from '../core/geometry';
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { materialParams } from './gears';
import { MOUNTS, PATTERNS, patternHoles, type Keepout, type PatternKind, type Region } from './patterns';
import { at, circle, num, roundedRect } from './walls';

export const PANEL_CATEGORY = 'Panels & patterns';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width of the plate', unit: 'mm', group: 'Plate', kind: 'number', min: 20, max: 1000, default: 150, step: 1 },
  { key: 'y', label: 'Height', help: 'Height of the plate', unit: 'mm', group: 'Plate', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'radius', label: 'Corner radius', help: 'Radius of the plate corners', unit: 'mm', group: 'Plate', kind: 'number', min: 0, max: 30, default: 3, step: 0.5 },
  { key: 'margin', label: 'Margin', help: 'Plain border round the hole field', unit: 'mm', group: 'Plate', kind: 'number', min: 2, max: 50, default: 8, step: 0.5 },
  { key: 'pattern', label: 'Pattern', help: 'Hole field: round holes on a square grid or hex-packed, squares, slots, Skadis pegboard slots (5 x 15 mm, 20 mm grid), or none',
    group: 'Pattern', kind: 'enum', options: [...PATTERNS], default: 'hex' },
  { key: 'hole', label: 'Hole size', help: 'Diameter of round holes, side of squares, width of slots', unit: 'mm', group: 'Pattern', kind: 'number', min: 1, max: 50, default: 5, step: 0.1 },
  { key: 'spacing', label: 'Spacing', help: 'Distance between hole centres (across the slots for slots)', unit: 'mm', group: 'Pattern', kind: 'number', min: 2, max: 80, default: 7, step: 0.1 },
  { key: 'slot_length', label: 'Slot length', help: 'Length of slots', unit: 'mm', group: 'Pattern', kind: 'number', min: 2, max: 100, default: 15, step: 0.5 },
  { key: 'region', label: 'Field shape', help: 'Fill the plate (less the margin) or a centred circle', group: 'Pattern', kind: 'enum', options: ['rect', 'circle'], default: 'rect' },
  { key: 'mount', label: 'Mounting holes', help: 'Corner screw holes, a fan (its 4 screws; the grille fills its aperture) or a NEMA stepper (centre opening and 4 screws)',
    group: 'Mounting', kind: 'enum', options: ['none', 'corners', ...Object.keys(MOUNTS)], default: 'none' },
  { key: 'screw', label: 'Corner screw', help: 'Diameter of the corner screw holes', unit: 'mm', group: 'Mounting', kind: 'number', min: 2, max: 8, default: 3.5, step: 0.1 },
  ...materialParams,
];

function build(p: Params): Part[] {
  const X = num(p, 'x');
  const Y = num(p, 'y');
  const R = num(p, 'radius');
  const mg = num(p, 'margin');
  const t = num(p, 'thickness');
  if (!(2 * R <= Math.min(X, Y))) throw new ParamError('radius too large for the plate', 'radius');
  const c: Vec2 = { x: X / 2, y: Y / 2 };
  const fixed: Path[] = [];
  const keep: Keepout[] = [];
  const add = (q: Vec2, d: number): void => { fixed.push(circle(q.x, q.y, d / 2)); keep.push({ c: q, r: d / 2 }); };
  let region: Region = p.region === 'circle'
    ? { kind: 'circle', cx: c.x, cy: c.y, r: Math.min(X, Y) / 2 - mg }
    : { kind: 'rect', x0: mg, y0: mg, x1: X - mg, y1: Y - mg };
  const mount = String(p.mount);
  if (mount === 'corners') {
    const s = num(p, 'screw');
    const off = Math.max(2 * s, 0.3 * R + s);
    if (!(2 * off + s + 1 <= Math.min(X, Y))) throw new ParamError('screw too large for the plate: the corner holes would meet', 'screw');
    for (const q of [{ x: off, y: off }, { x: X - off, y: off }, { x: X - off, y: Y - off }, { x: off, y: Y - off }]) add(q, s);
  } else if (MOUNTS[mount]) {
    const m = MOUNTS[mount]!;
    const need = Math.max(m.fan ?? 0, m.spacing + m.hole + 2);
    if (!(need <= Math.min(X, Y))) throw new ParamError(`mount ${mount} needs a plate at least ${need} mm wide and high`, 'mount');
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) add({ x: c.x + (sx * m.spacing) / 2, y: c.y + (sy * m.spacing) / 2 }, m.hole);
    if (m.centre > 0) add(c, m.centre);
    if (m.fan) region = { kind: 'circle', cx: c.x, cy: c.y, r: m.fan / 2 - 1 };
  }
  if (region.kind === 'rect' ? !(region.x1 > region.x0 && region.y1 > region.y0) : !(region.r > 0))
    throw new ParamError('margin too large: no room left for the hole field', 'margin');
  const hole = num(p, 'hole');
  const spacing = num(p, 'spacing');
  const holes = patternHoles({ kind: p.pattern as PatternKind, hole, spacing, slot: num(p, 'slot_length') }, region, c, keep, Math.max(1, spacing - hole));
  return [finishWithKerf({
    id: 'panel', name: 'Panel', outline: roundedRect(c.x, c.y, X, Y, R), holes: [...fixed, ...holes], engrave: [],
    placement: at([0, 0, 0], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [],
  }, effectiveKerf(p))];
}

export const patternPanel: Generator = {
  id: 'patternpanel',
  name: 'Pattern panel',
  category: PANEL_CATEGORY,
  description: 'Flat plate with a hole field (round, hex, squares, slots, Skadis pegboard) and fan, NEMA stepper or corner mounting holes: vents, grilles, motor plates, pegboards (HolePattern, FanHole, NemaPattern, SkadisBoard).',
  schema,
  presets: {
    'HolePattern (hex vent)': { x: 150, y: 100, pattern: 'hex', hole: 5, spacing: 7, region: 'rect', mount: 'corners' },
    'FanHole 80 mm': { x: 90, y: 90, pattern: 'hex', hole: 4, spacing: 5.5, mount: 'fan80', radius: 4 },
    'NemaPattern 17': { x: 60, y: 60, pattern: 'none', mount: 'nema17', radius: 3 },
    'SkadisBoard (pegboard)': { x: 360, y: 260, pattern: 'skadis', margin: 10, mount: 'corners', screw: 5, thickness: 5 },
    'Speaker grille': { x: 120, y: 120, pattern: 'circles', hole: 3, spacing: 5, region: 'circle', margin: 6, mount: 'corners' },
  },
  build,
  expectedSize: (p) => ({ x: num(p, 'x'), y: num(p, 'y'), z: num(p, 'thickness') }),
};
