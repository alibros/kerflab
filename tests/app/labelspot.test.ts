import { describe, expect, it } from 'vitest';
import type { Path, Vec2 } from '../../src/core/geometry';
import { labelSpot, poleOfInaccessibility } from '../../src/app/views/labelspot';

const poly = (pts: [number, number][]): Path => ({
  start: { x: pts[0]![0], y: pts[0]![1] },
  closed: true,
  segs: [...pts.slice(1), pts[0]!].map(([x, y]) => ({ t: 'L' as const, to: { x, y } })),
});
const rect = (x: number, y: number, w: number, h: number): Path => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const pts = (p: Path): Vec2[] => [p.start, ...p.segs.map((s) => s.to)].slice(0, -1);

/** Distance from (x, y) to the segment a-b. */
const segDist = (x: number, y: number, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
};
/** True when the box centred on (x, y) with half sizes (hw, hh) overlaps the rectangle r. */
const overlaps = (x: number, y: number, hw: number, hh: number, [rx, ry, rw, rh]: number[]): boolean =>
  x + hw > rx! && x - hw < rx! + rw! && y + hh > ry! && y - hh < ry! + rh!;

describe('poleOfInaccessibility', () => {
  it('right triangle: the incentre, radius the inradius (not the bbox centre, which is on the hypotenuse)', () => {
    // Legs 120 and 50, hypotenuse 130: inradius (a + b - c) / 2 = 20, incentre (20, 20).
    const tri = poly([[0, 0], [120, 0], [0, 50]]);
    const p = poleOfInaccessibility([pts(tri)])!;
    expect(p.r).toBeCloseTo(20, 0);
    expect(Math.hypot(p.x - 20, p.y - 20)).toBeLessThan(1.5);
    // The bounding-box centre (60, 25) lies on the hypotenuse.
    expect(25 / 50 + 60 / 120).toBeCloseTo(1, 9);
  });

  it('plate with a central hole: the spot is in the material, not in the hole', () => {
    const plate = rect(0, 0, 100, 60);
    const hole = rect(30, 15, 40, 30);
    const p = poleOfInaccessibility([pts(plate), pts(hole)])!;
    expect(overlaps(p.x, p.y, 0, 0, [30, 15, 40, 30])).toBe(false);
    // Best is the middle of a side band: 15 mm to the hole and to the outline.
    expect(p.r).toBeCloseTo(15, 0);
  });

  it('keeps clear of open marks (engraving) too', () => {
    const plate = rect(0, 0, 100, 40);
    const mark: Vec2[] = [{ x: 50, y: 0 }, { x: 50, y: 40 }];
    const p = poleOfInaccessibility([pts(plate)], [mark])!;
    expect(Math.abs(p.x - 50)).toBeGreaterThan(15);
  });

  it('returns null for a degenerate outline', () => {
    expect(poleOfInaccessibility([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]])).toBeNull();
  });
});

describe('labelSpot', () => {
  it('slotted strip: the label box sits between the slots and touches none of them', () => {
    // A 300 × 40 divider with a row of 3 × 20 slots every 50 mm along its middle.
    const strip = rect(0, 0, 300, 40);
    const slots: number[][] = [];
    for (let x = 48.5; x < 300; x += 50) slots.push([x, 10, 3, 20]);
    const s = labelSpot(strip, slots.map(([x, y, w, h]) => rect(x!, y!, w!, h!)), [], 4)!;
    expect(s).not.toBeNull();
    const hw = (4 * s.h) / 2;
    const hh = s.h / 2;
    for (const r of slots) expect(overlaps(s.x, s.y, hw, hh, r)).toBe(false);
    expect(s.x - hw).toBeGreaterThanOrEqual(0);
    expect(s.x + hw).toBeLessThanOrEqual(300);
    expect(s.y - hh).toBeGreaterThanOrEqual(0);
    expect(s.y + hh).toBeLessThanOrEqual(40);
    expect(s.h).toBeGreaterThan(5);
  });

  it('triangle: the label box stays inside the slanted edge', () => {
    const tri = poly([[0, 0], [120, 0], [0, 50]]);
    const s = labelSpot(tri, [], [], 5)!;
    const hw = (5 * s.h) / 2;
    const hh = s.h / 2;
    const v = pts(tri);
    // Every corner inside: below the hypotenuse x / 120 + y / 50 <= 1.
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = s.x + dx! * hw;
      const y = s.y + dy! * hh;
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(x / 120 + y / 50).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(Math.min(...v.map((a, i) => segDist(s.x, s.y, a, v[(i + 1) % v.length]!)))).toBeCloseTo(s.r, 6);
  });

  it('a long strip gets a wider label than its inscribed circle alone allows', () => {
    const s = labelSpot(rect(0, 0, 400, 20), [], [], 8)!;
    expect(s.r).toBeCloseTo(10, 0);
    // The circle only fits a box of height 2r / hypot(8, 1) ≈ 2.5; the strip fits about 20.
    expect(s.h).toBeGreaterThan(15);
  });
});
