import { describe, expect, it } from 'vitest';
import { Turtle } from '../../src/core/turtle';
import { GeometryError, area, isSimple } from '../../src/core/geometry';

describe('Turtle', () => {
  it('builds a unit square with area 100 that is simple', () => {
    const t = new Turtle();
    for (let i = 0; i < 4; i++) {
      t.forward(10);
      t.turn(90);
    }
    const p = t.toPath(true);
    expect(area(p)).toBeCloseTo(100, 9);
    expect(isSimple(p)).toBe(true);
  });

  it('quarter arc ends at (10,10) heading 90', () => {
    const t = new Turtle();
    t.arc(10, 90);
    expect(t.pos.x).toBeCloseTo(10, 9);
    expect(t.pos.y).toBeCloseTo(10, 9);
    expect(t.heading).toBeCloseTo(90, 9);
  });

  it('negative arc turns right', () => {
    const t = new Turtle();
    t.arc(10, -90);
    expect(t.pos.x).toBeCloseTo(10, 9);
    expect(t.pos.y).toBeCloseTo(-10, 9);
    expect(t.heading).toBeCloseTo(-90, 9);
  });

  it('forward(0) adds no segment', () => {
    const t = new Turtle();
    t.forward(0);
    t.forward(5);
    expect(t.toPath().segs).toHaveLength(1);
  });

  it('toPath(true) throws when the end is not at the start', () => {
    const t = new Turtle();
    t.forward(5);
    expect(() => t.toPath(true)).toThrow(GeometryError);
  });
});
