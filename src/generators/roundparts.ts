/**
 * Shared helpers for the round mechanical parts (pulley, knob): stacks of identical-axis layers
 * cut from sheet and glued or bolted together. A stack is an `assembly: 'loose'` model: the layers
 * lie on top of each other along z (layer k in z in [k t, (k + 1) t]), centred on the z axis, each
 * with its show face down (z = 0 side), so they touch face to face without interpenetrating.
 */
import type { Path } from '../core/geometry';
import { finishWithKerf, type Part } from '../core/part';
import { at } from './walls';

export type Layer = { id: string; name: string; outline: Path; holes: Path[]; engrave?: Path[] };

/** Kerf-compensated parts for a stack of layers, bottom first. */
export function stack(layers: Layer[], t: number, kerf: number): Part[] {
  return layers.map((l, k) => finishWithKerf({
    id: l.id, name: l.name, outline: l.outline, holes: l.holes, engrave: l.engrave ?? [],
    placement: at([0, 0, k * t], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [],
  }, kerf));
}

/** Closed CCW circle about the origin as two half arcs. */
export function disc(r: number): Path {
  const c = { x: 0, y: 0 };
  return { start: { x: r, y: 0 }, closed: true, segs: [{ t: 'A', to: { x: -r, y: 0 }, c, ccw: true }, { t: 'A', to: { x: r, y: 0 }, c, ccw: true }] };
}
