import type { Path } from '../../src/core/geometry';
import type { Part } from '../../src/core/part';

export function rectPath(w: number, h: number): Path {
  return {
    start: { x: 0, y: 0 },
    closed: true,
    segs: [
      { t: 'L', to: { x: w, y: 0 } },
      { t: 'L', to: { x: w, y: h } },
      { t: 'L', to: { x: 0, y: h } },
      { t: 'L', to: { x: 0, y: 0 } },
    ],
  };
}

export function testPart(id: string, w: number, h: number, extra: Partial<Part> = {}): Part {
  const outline = rectPath(w, h);
  return {
    id,
    name: id,
    outline,
    holes: [],
    engrave: [],
    placement: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] },
    thickness: 3,
    edges: [],
    kerf: 0,
    nominal: { outline, holes: [] },
    ...extra,
  };
}
