/**
 * Knob: a grip knob for a shaft, built as a stack of layers with a round / D / hex bore, an
 * optional closed cap layer on top and an engraved pointer. Generic version of boxes.py
 * (florianfesti/boxes) WavyKnob and ConcaveKnob (boxes/generators/wavyknob.py, concaveknob.py):
 *  - wavy: the rim rises and falls `lobes` times (a cosine wave `depth` deep);
 *  - concave: `lobes` round scallops cut into the rim (`depth` is their radius);
 *  - polygon: a regular `lobes`-gon (a nut-like grip);
 *  - round: a plain disc.
 *
 * Deliberate differences from boxes.py (docs/differences.md): one generator for both knob styles
 * plus polygon/round; boxes.py draws one layer with an optional D-flat and hex nut pocket, here a
 * stack of `layers` with a closed cap.
 */
import { bore, boreRadius, type BoreShape } from '../core/gear';
import { bounds, type Path, type Seg, type Vec2 } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { boreParams, MECHANICAL_CATEGORY, materialParams } from './gears';
import { disc, stack, type Layer } from './roundparts';
import { num } from './walls';

const schema: Schema = [
  { key: 'style', label: 'Style', help: 'Rim shape: wavy, concave scallops, polygon or round', group: 'Knob',
    kind: 'enum', options: ['wavy', 'concave', 'polygon', 'round'], default: 'wavy' },
  { key: 'diameter', label: 'Diameter', help: 'Outer diameter of the knob', unit: 'mm', group: 'Knob', kind: 'number', min: 12, max: 150, default: 40, step: 0.5 },
  { key: 'lobes', label: 'Lobes', help: 'Number of waves, scallops or polygon sides', unit: '', group: 'Knob', kind: 'int', min: 3, max: 40, default: 10 },
  { key: 'depth', label: 'Grip depth', help: 'Depth of the waves, or radius of the scallops, as a fraction of the radius', unit: '',
    group: 'Knob', kind: 'number', min: 0.03, max: 0.3, default: 0.1, step: 0.01 },
  { key: 'layers', label: 'Layers', help: 'Number of layers stacked into the knob', unit: '', group: 'Knob', kind: 'int', min: 1, max: 6, default: 2 },
  { key: 'cap', label: 'Closed cap', help: 'Top layer without the bore (the shaft ends inside the knob); needs 2 or more layers', group: 'Knob', kind: 'bool', default: true },
  { key: 'pointer', label: 'Pointer', help: 'Engrave a pointer line on the top layer', group: 'Knob', kind: 'bool', default: true },
  ...boreParams(6),
  ...materialParams,
];

/** Closed CCW rim outline. */
function rim(p: Params): Path {
  const R = num(p, 'diameter') / 2;
  const n = num(p, 'lobes');
  const d = num(p, 'depth') * R;
  const c = { x: 0, y: 0 };
  switch (p.style) {
    case 'round': return disc(R);
    case 'polygon': {
      const pts = Array.from({ length: n }, (_, k) => ({ x: R * Math.cos((2 * Math.PI * k) / n), y: R * Math.sin((2 * Math.PI * k) / n) }));
      return { start: pts[0]!, closed: true, segs: [...pts.slice(1), pts[0]!].map((to) => ({ t: 'L' as const, to })) };
    }
    case 'concave': {
      // Scallop k: circle of radius d centred on the rim at angle (k + 1/2) 2 pi / n.
      const half = Math.acos(1 - (d * d) / (2 * R * R)); // angle from the scallop centre to where it meets the rim
      if (!(2 * half < (2 * Math.PI) / n - 0.05)) throw new ParamError('depth too large: the scallops would meet; use fewer lobes or a smaller depth', 'depth');
      const segs: Seg[] = [];
      const at = (a: number): Vec2 => ({ x: R * Math.cos(a), y: R * Math.sin(a) });
      for (let k = 0; k < n; k++) {
        const m = ((k + 0.5) * 2 * Math.PI) / n;
        segs.push({ t: 'A', to: at(m - half), c, ccw: true });
        segs.push({ t: 'A', to: at(m + half), c: at(m), ccw: false });
      }
      segs.push({ t: 'A', to: at(0), c, ccw: true });
      return { start: at(0), closed: true, segs };
    }
    default: {
      const m = 24 * n;
      const pts = Array.from({ length: m }, (_, i) => {
        const a = (2 * Math.PI * i) / m;
        const r = R - (d * (1 - Math.cos(n * a))) / 2;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      });
      return { start: pts[0]!, closed: true, segs: [...pts.slice(1), pts[0]!].map((to) => ({ t: 'L' as const, to })) };
    }
  }
}

/** Inscribed radius of the rim (where the material is narrowest). */
function innerRadius(p: Params): number {
  const R = num(p, 'diameter') / 2;
  const n = num(p, 'lobes');
  if (p.style === 'polygon') return R * Math.cos(Math.PI / n);
  if (p.style === 'round') return R;
  return R - num(p, 'depth') * R;
}

function layers(p: Params): Layer[] {
  const shape = p.bore as BoreShape;
  const d = num(p, 'bore_d');
  const ri = innerRadius(p);
  if (shape !== 'none' && !(boreRadius(shape, d) + 2 <= ri))
    throw new ParamError(`bore_d too large: a ${d} mm bore leaves less than 2 mm of rim (inner radius ${ri.toFixed(1)} mm)`, 'bore_d');
  const n = num(p, 'layers');
  const outline = rim(p);
  const hole = bore(shape, d);
  return Array.from({ length: n }, (_, k) => {
    const top = k === n - 1;
    const closed = top && n > 1 && p.cap !== false;
    const l: Layer = { id: `layer${k + 1}`, name: closed ? 'Cap' : `Layer ${k + 1}`, outline, holes: hole && !closed ? [hole] : [] };
    if (top && p.pointer !== false) {
      // Pointer line along +x, clear of the bore.
      const x0 = Math.max(0.45 * ri, boreRadius(shape, d) + 1);
      l.engrave = [{ start: { x: x0, y: 0 }, segs: [{ t: 'L', to: { x: Math.max(x0 + 1, 0.85 * ri), y: 0 } }], closed: false }];
    }
    return l;
  });
}

function build(p: Params): Part[] {
  return stack(layers(p), num(p, 'thickness'), effectiveKerf(p));
}

export const knob: Generator = {
  id: 'knob',
  name: 'Knob',
  category: MECHANICAL_CATEGORY,
  description: 'Grip knob for a shaft: wavy, concave-scalloped, polygon or round rim, stacked layers, closed cap, pointer (WavyKnob, ConcaveKnob).',
  schema,
  presets: {
    'WavyKnob': { style: 'wavy', diameter: 40, lobes: 10, depth: 0.1, layers: 2, bore: 'd', bore_d: 6 },
    'ConcaveKnob': { style: 'concave', diameter: 50, lobes: 8, depth: 0.2, layers: 3, bore: 'round', bore_d: 6 },
    'Pot knob (6 mm D)': { style: 'polygon', diameter: 25, lobes: 12, layers: 3, bore: 'd', bore_d: 6, thickness: 3 },
  },
  build,
  assembly: 'loose',
  expectedSize: (p) => {
    const b = bounds(rim(p));
    return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: num(p, 'layers') * num(p, 'thickness') };
  },
};
