import { describe, expect, it } from 'vitest';
import type { Path } from '../../src/core/geometry';
import type { Part } from '../../src/core/part';
import { estimate } from '../../src/app/estimate';
import type { Layout } from '../../src/app/export/layout';

const square = (s: number): Path => ({
  start: { x: 0, y: 0 },
  segs: [
    { t: 'L', to: { x: s, y: 0 } },
    { t: 'L', to: { x: s, y: s } },
    { t: 'L', to: { x: 0, y: s } },
    { t: 'L', to: { x: 0, y: 0 } },
  ],
  closed: true,
});

const layoutOf = (outline: Path, holes: Path[] = [], engrave: Path[] = []): Layout => ({
  placed: [{ part: { outline, holes, engrave } as unknown as Part, x: 0, y: 0, rot: 0, sheet: 0 }],
  unfit: [],
  sheet: { w: 600, h: 400 },
  sheets: 1,
});

describe('estimate', () => {
  it('a 100x100 square is 400 mm of cut', () => {
    const e = estimate(layoutOf(square(100)), { speed: 20 });
    expect(e.cutLengthMm).toBeCloseTo(400, 9);
    expect(e.minutes).toBeCloseTo(400 / 20 / 60, 9);
  });

  it('counts holes, ignores engraving, and reports sheet area and cost', () => {
    const l = layoutOf(square(100), [square(10)], [square(50)]);
    const e = estimate(l, { speed: 10, cost: { perM2: 50 } });
    expect(e.cutLengthMm).toBeCloseTo(440, 9);
    expect(e.area).toBe(600 * 400);
    expect(e.cost).toBeCloseTo(0.24 * 50, 9);
  });

  it('measures arcs exactly and survives a zero speed', () => {
    const circle: Path = { start: { x: 10, y: 0 }, segs: [{ t: 'A', to: { x: 10, y: 0 }, c: { x: 0, y: 0 }, ccw: true }], closed: true };
    const e = estimate(layoutOf(circle), { speed: 0 });
    expect(e.cutLengthMm).toBeCloseTo(2 * Math.PI * 10, 6);
    expect(e.minutes).toBe(0);
  });
});
