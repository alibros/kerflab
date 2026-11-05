/**
 * ProfileBox: a closed box built round a side profile: two profile plates (left and right) and
 * one wall per profile side, x wide, the walls meeting at the profile's corners with angled finger
 * joints. Generic version of boxes.py (florianfesti/boxes) Console (boxes/generators/console.py:
 * a slanted control panel) and BirdHouse (birdhouse.py: a gable roof); those are presets.
 *
 * It is prismBox (polygonbox.ts) laid on its side: the profile is the prism's polygon, the walls
 * are its walls, the left and right plates its bottom and top plates. Every profile corner must
 * turn by at most 90 degrees (square-cut fingers cannot close an acute corner), so:
 *  - console: front (h high), the slanted panel rising at `angle` over `panel` of the depth, a
 *    level top to the back, the back and the bottom;
 *  - house: floor, two side walls h high and a gable roof at `angle` (at most 45 degrees, the
 *    ridge turns by twice the pitch); optional round entrance hole in the left gable.
 *
 * World frame: x across (the walls' width), y from the front (y = 0) to the back, z up; the left
 * plate's outer face at x = 0. Outer size: x + 2t across, the profile grown by t.
 *
 * Deliberate differences from boxes.py (docs/differences.md): the walls are fingered into the
 * profile plates and to each other with angled finger joints (boxes.py Console: polygonWalls, the
 * same idea); BirdHouse has no roof overhang, its roof panels are profile walls like the others,
 * and its large side windows are a single entrance hole.
 */
import type { Path, Vec2 } from '../core/geometry';
import type { Generator, Part, Placement, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { outerFootprint, prismBox } from './polygonbox';
import { circle, num } from './walls';

const schema: Schema = [
  { key: 'shape', label: 'Profile', help: 'Console: low front, slanted panel, level top. House: walls and a gable roof (bird house)',
    group: 'Shape', kind: 'enum', options: ['console', 'house'], default: 'console' },
  { key: 'x', label: 'Width', help: 'Inner width across (the length of every wall)', unit: 'mm', group: 'Size', kind: 'number', min: 30, max: 800, default: 200, step: 1 },
  { key: 'y', label: 'Depth', help: 'Inner depth of the profile (console: front to back; house: gable width)', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 600, default: 150, step: 1 },
  { key: 'h', label: 'Height', help: 'Console: inner height of the front below the panel. House: inner height of the walls below the roof', unit: 'mm',
    group: 'Size', kind: 'number', min: 15, max: 500, default: 40, step: 1 },
  { key: 'angle', label: 'Angle', help: 'Console: slope of the panel. House: roof pitch (at most 45 degrees)', unit: 'deg',
    group: 'Shape', kind: 'number', min: 10, max: 70, default: 30, step: 1 },
  { key: 'panel', label: 'Panel depth', help: 'Console: fraction of the depth covered by the slanted panel (the rest is the level top)', unit: '',
    group: 'Shape', kind: 'number', min: 0.2, max: 0.9, default: 0.6, step: 0.05 },
  { key: 'hole', label: 'Entrance hole', help: 'House: diameter of a round hole in the left gable (0: none)', unit: 'mm',
    group: 'Shape', kind: 'number', min: 0, max: 80, default: 0, step: 1 },
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

const rad = (d: number): number => (d * Math.PI) / 180;

/** Inner profile (CCW in the y-z plane, front at y = 0), wall names and the param key per side. */
function profile(p: Params): { pts: Vec2[]; names: string[]; keys: string[] } {
  const y = num(p, 'y');
  const h = num(p, 'h');
  const a = num(p, 'angle');
  if (p.shape === 'house') {
    if (!(a <= 45)) throw new ParamError(`angle too steep for a house: the ridge turns by twice the roof pitch, at most 90 degrees (pitch at most 45, got ${a})`, 'angle');
    const ridge = h + (y / 2) * Math.tan(rad(a));
    return {
      pts: [{ x: 0, y: 0 }, { x: y, y: 0 }, { x: y, y: h }, { x: y / 2, y: ridge }, { x: 0, y: h }],
      names: ['Floor', 'Back wall', 'Back roof', 'Front roof', 'Front wall'],
      keys: ['y', 'h', 'angle', 'angle', 'h'],
    };
  }
  const run = num(p, 'panel') * y;
  const H = h + run * Math.tan(rad(a));
  return {
    pts: [{ x: 0, y: 0 }, { x: y, y: 0 }, { x: y, y: H }, { x: run, y: H }, { x: 0, y: h }],
    names: ['Bottom', 'Back', 'Top', 'Panel', 'Front'],
    keys: ['y', 'h', 'panel', 'panel', 'h'],
  };
}

/** Prism (x, y, z) -> world (z, x, y): the prism's polygon plane becomes the y-z plane. */
const turn = (v: Vec3): Vec3 => [v[2], v[0], v[1]];
const turned = (pl: Placement): Placement => ({ origin: turn(pl.origin), x: turn(pl.x), y: turn(pl.y) });

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { pts, names, keys } = profile(p);
  const holes: Path[] = [];
  const d = num(p, 'hole');
  if (p.shape === 'house' && d > 0) {
    // Entrance centred across the gable, 60 % up the walls; it must clear the walls, floor and roof by t.
    const y = num(p, 'y');
    const h = num(p, 'h');
    const cy = 0.6 * h;
    const pitch = rad(num(p, 'angle'));
    const toRoof = (h + (y / 2) * Math.tan(pitch) - cy) * Math.cos(pitch); // centre to either roof's inner face
    if (!(d / 2 + t <= y / 2 && cy - d / 2 >= t && d / 2 + t <= toRoof))
      throw new ParamError(`hole too large: a ${d} mm entrance does not fit in the gable with a thickness of material round it`, 'hole');
    holes.push(circle(y / 2, cy, d / 2));
  }
  const parts = prismBox({
    inner: pts, h: num(p, 'x'), bottom: 'closed', top: 'closed', ctx, kerf: effectiveKerf(p), bottomHoles: holes,
    keys: { side: (k) => keys[k]!, h: 'x', corners: 'angle' }, wallName: (k) => names[k]!,
  });
  for (const part of parts) {
    part.placement = turned(part.placement);
    if (part.id === 'bottom') part.name = p.shape === 'house' ? 'Left gable' : 'Left side';
    if (part.id === 'top') part.name = p.shape === 'house' ? 'Right gable' : 'Right side';
  }
  return parts;
}

export const profileBox: Generator = {
  id: 'profilebox',
  name: 'Profile box',
  category: 'Polygon & special',
  description: 'Closed box round a side profile with angled joints: a console with a slanted control panel, or a house with a gable roof (Console, BirdHouse).',
  schema,
  presets: {
    'Console (arcade stick)': { shape: 'console', x: 300, y: 180, h: 40, angle: 15, panel: 0.75 },
    'Console (keyboard / mixer)': { shape: 'console', x: 400, y: 200, h: 30, angle: 30, panel: 0.5 },
    'BirdHouse': { shape: 'house', x: 150, y: 150, h: 150, angle: 45, hole: 32, thickness: 6 },
    'House-shaped box': { shape: 'house', x: 120, y: 80, h: 60, angle: 30, hole: 0 },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    const o = outerFootprint(profile(p).pts, t);
    return { x: num(p, 'x') + 2 * t, y: o.x, z: o.y };
  },
};
