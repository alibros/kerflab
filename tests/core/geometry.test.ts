import { describe, expect, it } from 'vitest';
import {
  GeometryError, area, bounds, isSimple, mat3Multiply, mat3Rotate, mat3Translate, offsetPath, transform,
  type Mat3, type Path,
} from '../../src/core/geometry';
import { Turtle } from '../../src/core/turtle';

const square = (s: number): Path => {
  const t = new Turtle();
  for (let i = 0; i < 4; i++) { t.forward(s); t.turn(90); }
  return t.toPath(true);
};
const poly = (pts: [number, number][]): Path => ({
  start: { x: pts[0]![0], y: pts[0]![1] },
  segs: [...pts.slice(1), pts[0]!].map(([x, y]) => ({ t: 'L' as const, to: { x, y } })),
  closed: true,
});

describe('geometry', () => {
  it('bowtie is not simple', () => {
    expect(isSimple(poly([[0, 0], [10, 10], [10, 0], [0, 10]]))).toBe(false);
  });

  it('area includes arcs (half disc) and sign', () => {
    const t = new Turtle();
    t.arc(10, 180); // half circle, then close with chord
    const p = { ...t.toPath(), closed: true };
    expect(area(p)).toBeCloseTo((Math.PI * 100) / 2, 6);
    const cw = new Turtle();
    cw.arc(10, -180);
    expect(area({ ...cw.toPath(), closed: true })).toBeCloseTo(-(Math.PI * 100) / 2, 6);
  });

  it('bounds handles arc extremes analytically', () => {
    const t = new Turtle();
    t.arc(10, 180);
    const b = bounds(t.toPath());
    expect(b.min.x).toBeCloseTo(0, 9);
    expect(b.max.x).toBeCloseTo(10, 9);
    expect(b.max.y).toBeCloseTo(20, 9);
  });

  it('offset outward grows width by 2d, inward shrinks', () => {
    const b = bounds(offsetPath(square(10), 0.5));
    expect(b.max.x - b.min.x).toBeCloseTo(11, 9);
    const bi = bounds(offsetPath(square(10), -0.5));
    expect(bi.max.x - bi.min.x).toBeCloseTo(9, 9);
  });

  it('offset works for clockwise paths too', () => {
    const cw = poly([[0, 0], [0, 10], [10, 10], [10, 0]]);
    const b = bounds(offsetPath(cw, 1));
    expect(b.max.x - b.min.x).toBeCloseTo(12, 9);
  });

  it('offset of circle changes radius', () => {
    const t = new Turtle();
    t.arc(10, 360);
    const b = bounds(offsetPath(t.toPath(true), 1));
    expect(b.max.x - b.min.x).toBeCloseTo(22, 6);
  });

  it('inward offset beyond half-width throws', () => {
    expect(() => offsetPath(square(10), -6)).toThrow(GeometryError);
  });

  it('transform translates, rotates, and keeps area', () => {
    const m = mat3Multiply(mat3Translate(5, 5), mat3Rotate(90));
    const p = transform(square(10), m);
    expect(area(p)).toBeCloseTo(100, 9);
    expect(p.start.x).toBeCloseTo(5, 9);
    const b = bounds(p);
    expect(b.min.x).toBeCloseTo(-5, 9);
    expect(b.max.x).toBeCloseTo(5, 9);
  });

  it('offset ignores zero-length segments', () => {
    const sq = square(10);
    const withZero: Path = { ...sq, segs: [sq.segs[0]!, { t: 'L', to: sq.segs[0]!.to }, ...sq.segs.slice(1)] };
    const b = bounds(offsetPath(withZero, 0.5));
    expect(b.max.x - b.min.x).toBeCloseTo(11, 9);
    expect(b.min.x).toBeCloseTo(-0.5, 9);
  });

  it('offset throws when non-adjacent segments end up crossing (narrow slit)', () => {
    const slotted = poly([[0, 0], [10, 0], [10, 10], [5.5, 10], [5.5, 8], [8, 8], [8, 2], [2, 2], [2, 8], [4.5, 8], [4.5, 10], [0, 10]]);
    expect(isSimple(slotted)).toBe(true);
    expect(() => offsetPath(slotted, 0.6)).toThrow(GeometryError);
    expect(() => offsetPath(slotted, 0.3)).not.toThrow();
  });

  it('offset arc endpoints stay equidistant from the centre at non-tangent corners', () => {
    const c = { x: 12, y: 3 };
    const r = Math.hypot(2, 3);
    const p: Path = {
      start: { x: 0, y: 0 },
      closed: true,
      segs: [
        { t: 'L', to: { x: 10, y: 0 } },
        { t: 'A', to: { x: 12 + r, y: 3 }, c, ccw: true },
        { t: 'L', to: { x: 12 + r, y: 10 } },
        { t: 'L', to: { x: 0, y: 10 } },
        { t: 'L', to: { x: 0, y: 0 } },
      ],
    };
    const o = offsetPath(p, 0.5);
    const a = o.segs[1]!;
    if (a.t !== 'A') throw new Error('expected arc');
    const d0 = Math.hypot(o.segs[0]!.to.x - a.c.x, o.segs[0]!.to.y - a.c.y);
    const d1 = Math.hypot(a.to.x - a.c.x, a.to.y - a.c.y);
    expect(d0).toBeCloseTo(d1, 9);
    expect(d0).toBeCloseTo(r + 0.5, 9);
  });

  it('transform rejects non-similarity matrices when arcs are present', () => {
    const t = new Turtle();
    t.arc(10, 90);
    const scaleXY: Mat3 = [2, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(() => transform(t.toPath(), scaleXY)).toThrow(GeometryError);
    expect(() => transform(square(10), scaleXY)).not.toThrow();
    expect(() => transform(t.toPath(), [2, 0, 0, 0, 2, 0, 0, 0, 1])).not.toThrow();
  });
});

describe('isSimple on large outlines', () => {
  /** Comb: a 1-unit-pitch strip of `n` teeth (4 edges each) closed by a base; `cross` bends one tooth over its neighbour. */
  const comb = (n: number, cross = -1): Path => {
    const pts: [number, number][] = [[0, 0], [2 * n, 0]];
    for (let i = n - 1; i >= 0; i--) {
      const x = 2 * i;
      const tip = i === cross ? x - 2.5 : x + 1;
      pts.push([x + 1.5, 1], [x + 1.5, 3], [tip, 3], [x + 1, 1]);
    }
    pts.push([0, 1]);
    return poly(pts);
  };

  it('agrees on simple and self-intersecting combs and stays fast at 4000 edges', () => {
    const t0 = performance.now();
    expect(isSimple(comb(1000))).toBe(true);
    expect(isSimple(comb(1000, 500))).toBe(false);
    expect(isSimple(comb(1000, 999))).toBe(false);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
