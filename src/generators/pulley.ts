/**
 * Pulley: a timing-belt pulley (GT2, HTD, T or MXL belts) or a plain round-belt pulley, built as a
 * stack of layers: as many toothed layers as the belt is wide, between two flanges. Generic version
 * of boxes.py (florianfesti/boxes) Pulley (boxes/generators/pulley.py, boxes/pulley.py).
 *
 * Tooth spaces: the belt's pitch line lies `pld` outside the pulley, so the pulley's outer radius
 * is z p / (2 pi) - pld. Each tooth space is cut as the belt tooth's shape plus `clearance`:
 * curvilinear belts (GT2, HTD) a U groove (round bottom), trapezoidal belts (T, MXL) a
 * trapezoid with 40 degree flanks. Belt data (pitch p, pitch line offset pld, tooth height h, tooth
 * width w) are the published nominal values.
 *
 * Deliberate differences from boxes.py (docs/differences.md): simplified tooth shapes (boxes.py
 * interpolates measured profiles); flanges and layers are separate parts of one stack.
 */
import { bore, boreRadius, type BoreShape } from '../core/gear';
import { bounds, type Path, type Seg, type Vec2 } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { boreParams, MECHANICAL_CATEGORY, materialParams } from './gears';
import { disc, stack, type Layer } from './roundparts';
import { num } from './walls';

type Belt = { p: number; pld: number; h: number; w: number; shape: 'u' | 'trap' };
const BELTS: Record<string, Belt> = {
  GT2_2mm: { p: 2, pld: 0.254, h: 0.75, w: 1.14, shape: 'u' },
  GT2_3mm: { p: 3, pld: 0.381, h: 1.14, w: 1.6, shape: 'u' },
  HTD_3mm: { p: 3, pld: 0.381, h: 1.17, w: 1.8, shape: 'u' },
  HTD_5mm: { p: 5, pld: 0.5715, h: 2.06, w: 3.05, shape: 'u' },
  T2_5: { p: 2.5, pld: 0.3, h: 0.7, w: 1.5, shape: 'trap' },
  T5: { p: 5, pld: 0.5, h: 1.2, w: 2.65, shape: 'trap' },
  MXL: { p: 2.032, pld: 0.254, h: 0.51, w: 1.14, shape: 'trap' },
};

const schema: Schema = [
  { key: 'profile', label: 'Belt', help: 'Timing belt profile, or "round" for a plain pulley (round belt, O-ring, string)', group: 'Pulley',
    kind: 'enum', options: [...Object.keys(BELTS), 'round'], default: 'GT2_2mm' },
  { key: 'teeth', label: 'Teeth', help: 'Number of teeth (timing belts)', unit: '', group: 'Pulley', kind: 'int', min: 10, max: 150, default: 20 },
  { key: 'diameter', label: 'Diameter', help: 'Round pulley: diameter at the bottom of the groove', unit: 'mm', group: 'Pulley', kind: 'number', min: 8, max: 300, default: 40, step: 0.5 },
  { key: 'width', label: 'Belt width', help: 'Width of the belt: the toothed part is this many layers of material, rounded up', unit: 'mm',
    group: 'Pulley', kind: 'number', min: 1, max: 50, default: 6, step: 0.5 },
  { key: 'flanges', label: 'Flanges', help: 'Add a flange on each side to keep the belt on', group: 'Pulley', kind: 'bool', default: true },
  { key: 'flange', label: 'Flange height', help: 'How far the flanges stand out past the pulley', unit: 'mm', group: 'Pulley', kind: 'number', min: 1, max: 15, default: 3, step: 0.5 },
  { key: 'clearance', label: 'Tooth clearance', help: 'Extra width and depth of the tooth spaces', unit: 'mm', group: 'Pulley', kind: 'number', min: 0, max: 0.5, default: 0.1, step: 0.01 },
  ...boreParams(5),
  ...materialParams,
];

/** Outer radius of the toothed (or plain) layers. */
function outerRadius(p: Params): number {
  const b = BELTS[String(p.profile)];
  return b ? (num(p, 'teeth') * b.p) / (2 * Math.PI) - b.pld : num(p, 'diameter') / 2;
}

/** Toothed outline: tooth space k centred at angle 2 pi k / z, as a groove in the local frame. */
function toothed(b: Belt, z: number, Ro: number, cl: number): Path {
  const w = b.w + cl;
  const h = b.h + cl;
  const c0 = { x: 0, y: 0 };
  const hw = w / 2;
  const xa = Math.sqrt(Ro * Ro - hw * hw);
  // Groove points in its own frame (x outwards along the centre line, y across), travelling +y.
  const groove: { to: Vec2; arc?: Vec2 }[] = b.shape === 'u'
    ? [{ to: { x: Ro - h + hw, y: -hw } }, { to: { x: Ro - h + hw, y: hw }, arc: { x: Ro - h + hw, y: 0 } }, { to: { x: xa, y: hw } }]
    : (() => {
        const bw = hw - h * Math.tan((20 * Math.PI) / 180);
        return [{ to: { x: Ro - h, y: -bw } }, { to: { x: Ro - h, y: bw } }, { to: { x: xa, y: hw } }];
      })();
  const rot = (q: Vec2, a: number): Vec2 => ({ x: q.x * Math.cos(a) - q.y * Math.sin(a), y: q.x * Math.sin(a) + q.y * Math.cos(a) });
  const segs: Seg[] = [];
  let start: Vec2 | undefined;
  for (let k = 0; k < z; k++) {
    const a = (2 * Math.PI * k) / z;
    const s = rot({ x: xa, y: -hw }, a);
    if (!start) start = s;
    else segs.push({ t: 'A', to: s, c: c0, ccw: true });
    for (const g of groove) segs.push(g.arc ? { t: 'A', to: rot(g.to, a), c: rot(g.arc, a), ccw: false } : { t: 'L', to: rot(g.to, a) });
  }
  segs.push({ t: 'A', to: start!, c: c0, ccw: true });
  return { start: start!, segs, closed: true };
}

function layers(p: Params): Layer[] {
  const t = num(p, 'thickness');
  const b = BELTS[String(p.profile)];
  const Ro = outerRadius(p);
  const cl = num(p, 'clearance');
  const shape = p.bore as BoreShape;
  const d = num(p, 'bore_d');
  if (b) {
    const z = num(p, 'teeth');
    // Tooth spaces must leave a land between them on the outer circle.
    const space = 2 * Math.asin(Math.min(1, (b.w + cl) / 2 / Ro));
    if (!((2 * Math.PI) / z - space > 0.2 / Ro)) throw new ParamError(`teeth too few for the ${String(p.profile)} belt: the tooth spaces would meet`, 'teeth');
  }
  const root = b ? Ro - b.h - num(p, 'clearance') : Ro;
  if (shape !== 'none' && !(boreRadius(shape, d) + 1.5 <= root))
    throw new ParamError(`bore_d too large: a ${d} mm bore needs at least 1.5 mm of material under the ${b ? 'teeth' : 'groove'} (radius ${root.toFixed(2)} mm)`, 'bore_d');
  const n = Math.max(1, Math.ceil(num(p, 'width') / t - 1e-9));
  const hole = bore(shape, d);
  const holes = hole ? [hole] : [];
  const body = b ? toothed(b, num(p, 'teeth'), Ro, cl) : disc(Ro);
  const out: Layer[] = Array.from({ length: n }, (_, k) => ({ id: `layer${k + 1}`, name: `${b ? 'Toothed' : 'Groove'} layer ${k + 1}`, outline: body, holes }));
  if (p.flanges !== false) {
    const f = disc(Ro + num(p, 'flange'));
    out.unshift({ id: 'flange1', name: 'Flange', outline: f, holes });
    out.push({ id: 'flange2', name: 'Flange', outline: f, holes });
  }
  return out;
}

function build(p: Params): Part[] {
  return stack(layers(p), num(p, 'thickness'), effectiveKerf(p));
}

export const pulley: Generator = {
  id: 'pulley',
  name: 'Pulley',
  category: MECHANICAL_CATEGORY,
  description: 'Timing-belt pulley (GT2, HTD, T, MXL) or plain round-belt pulley as a stack of layers with flanges and a round / D / hex bore (Pulley).',
  schema,
  presets: {
    'GT2 20 teeth, 6 mm belt': { profile: 'GT2_2mm', teeth: 20, width: 6, flanges: true, bore: 'round', bore_d: 5, thickness: 3 },
    'HTD 5M 30 teeth': { profile: 'HTD_5mm', teeth: 30, width: 9, bore: 'd', bore_d: 8, thickness: 3 },
    'Round belt 60 mm': { profile: 'round', diameter: 60, width: 4, flange: 4, bore: 'hex', bore_d: 6 },
  },
  build,
  assembly: 'loose',
  expectedSize: (p) => {
    const ls = layers(p);
    const bs = ls.map((l) => bounds(l.outline));
    const ext = (f: (b: ReturnType<typeof bounds>) => number, g: (...v: number[]) => number): number => g(...bs.map(f));
    return { x: ext((b) => b.max.x, Math.max) - ext((b) => b.min.x, Math.min), y: ext((b) => b.max.y, Math.max) - ext((b) => b.min.y, Math.min), z: ls.length * num(p, 'thickness') };
  },
};
