import { describe, expect, it } from 'vitest';
import { area, type Path } from '../../src/core/geometry';
import { FLEX_DEFAULTS, checkHingeStrips, flexLength, flexSlitWidth, livingHinge } from '../../src/core/livinghinge';
import { checkBend, partToLocal, partToWorld, type Bend, type Placement } from '../../src/core/part';
import { ParamError } from '../../src/core/validate';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';
import { bentFixture } from '../harness/bentfixture';

const pl: Placement = { origin: [10, 20, 30], x: [1, 0, 0], y: [0, 0, 1] }; // n = x × y = (0, -1, 0)
const near = (a: number[], b: number[], tol = 1e-9): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(tol)));

describe('bent part mapping', () => {
  const bend: Bend = { arcs: [{ at: 50, length: 20, angle: 90, radius: 13 }] };
  const part = { placement: pl, bend };

  it('is the rigid placement before the first arc', () => {
    near(partToWorld(part, { x: 30, y: 5 }, 2), [40, 18, 35]);
  });

  it('turns 90 degrees towards +n about an axis parallel to local y, z=0 face at the given radius', () => {
    // Arc starts at world (60, 20, 30); centre at +n * 13 = (60, 7, 30). End of the z=0 face: (73, 7, 30).
    near(partToWorld(part, { x: 70, y: 0 }, 0), [73, 7, 30]);
    // The face at depth z = 3 has radius 10.
    near(partToWorld(part, { x: 70, y: 0 }, 3), [70, 7, 30]);
    // Midway: 45 degrees.
    const m = partToWorld(part, { x: 60, y: 4 }, 0);
    near(m, [60 + 13 * Math.SQRT1_2, 7 + 13 * Math.SQRT1_2, 34]);
    // After the arc the part runs along -y (old n), with normal -x.
    near(partToWorld(part, { x: 80, y: 0 }, 1), [72, -3, 30]);
  });

  it('negative angles bend away from +n, the z=0 face inside', () => {
    const b2 = { placement: pl, bend: { arcs: [{ at: 0, length: 10, angle: -90, radius: 5 }] } };
    near(partToWorld(b2, { x: 10, y: 0 }, 0), [15, 25, 30]);
    near(partToWorld(b2, { x: 10, y: 0 }, 2), [17, 25, 30]); // radius 5 + 2
  });

  it('partToLocal inverts partToWorld on every piece', () => {
    for (const x of [-5, 10, 50, 55, 63.3, 70, 71, 140]) for (const z of [0, 1.5, 3]) {
      const w = partToWorld(part, { x, y: 7 }, z);
      const c = partToLocal(part, w);
      expect(c.some(([cx, cy, cz]) => Math.abs(cx - x) < 1e-9 && Math.abs(cy - 7) < 1e-9 && Math.abs(cz - z) < 1e-9)).toBe(true);
    }
  });

  it('checkBend rejects malformed bends', () => {
    expect(() => checkBend({ arcs: [{ at: 0, length: 10, angle: 90, radius: 3 }] }, 3)).toThrow(/radius/);
    expect(() => checkBend({ arcs: [{ at: 0, length: 10, angle: 0, radius: 9 }] }, 3)).toThrow(/angle/);
    expect(() => checkBend({ arcs: [{ at: 0, length: 10, angle: 90, radius: 9 }, { at: 5, length: 10, angle: 90, radius: 9 }] }, 3)).toThrow(/overlap/);
    expect(() => checkBend({ arcs: [{ at: 0, length: -1, angle: 90, radius: 9 }] }, 3)).toThrow(/length/);
    expect(() => checkBend({ arcs: [{ at: 0, length: 10, angle: -90, radius: 1 }] }, 3)).not.toThrow();
  });
});

describe('living hinge', () => {
  const t = 3;
  const strip = { x0: 20, y0: -3, L: 30, H: 60 };
  const lh = livingHinge(strip.x0, strip.y0, strip.L, strip.H, FLEX_DEFAULTS, t, 0.1);
  const box = (p: Path): { x0: number; x1: number; y0: number; y1: number } => {
    const pts = [p.start, ...p.segs.map((s) => s.to)];
    return { x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), y1: Math.max(...pts.map((q) => q.y)) };
  };

  it('stays strictly inside the strip, clear of its long edges (slits never touch the outline)', () => {
    expect(lh.holes.length).toBeGreaterThan(10);
    const edge = (FLEX_DEFAULTS.connection * t) / 2;
    for (const h of lh.holes) {
      const b = box(h);
      expect(b.x0).toBeGreaterThan(strip.x0);
      expect(b.x1).toBeLessThan(strip.x0 + strip.L);
      expect(b.y0).toBeGreaterThanOrEqual(strip.y0 + edge - 1e-9);
      expect(b.y1).toBeLessThanOrEqual(strip.y0 + strip.H - edge + 1e-9);
      expect(area(h)).toBeGreaterThan(0);
    }
  });

  it('pattern period and dashes follow the settings', () => {
    const xs = [...new Set(lh.slits.map((s) => s.x.toFixed(9)))].map(Number).sort((a, b) => a - b);
    const pitch = FLEX_DEFAULTS.distance * t;
    expect(lh.pitch).toBeCloseTo(pitch);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(pitch, 9);
    expect(xs.length).toBe(Math.floor(strip.L / pitch) - 1);
    // Bridges between dashes on one line are `connection` wide; odd and even lines alternate.
    const line = (x: number): number[][] => lh.slits.filter((s) => Math.abs(s.x - x) < 1e-9).map((s) => [s.y0, s.y1]).sort((a, b) => a[0]! - b[0]!);
    const l0 = line(xs[0]!);
    for (let i = 1; i < l0.length; i++) expect(l0[i]![0]! - l0[i - 1]![1]!).toBeCloseTo(FLEX_DEFAULTS.connection * t, 9);
    expect(line(xs[0]!)).toEqual(line(xs[2]!));
    expect(line(xs[0]!)).not.toEqual(line(xs[1]!));
    // Slit width.
    const b = box(lh.holes[0]!);
    expect(b.x1 - b.x0).toBeCloseTo(flexSlitWidth(0.1), 12);
  });

  it('flex length is the inner arc divided by stretch (boxes.py convention: shorter than the arc)', () => {
    const arc = (Math.PI * 15) / 2; // 23.5619...
    expect(flexLength(arc, { ...FLEX_DEFAULTS, stretch: 1.05 })).toBeCloseTo(22.4399, 4);
    expect(flexLength(arc, { ...FLEX_DEFAULTS, stretch: 1 })).toBeCloseTo(arc, 12);
  });

  it('rejects settings that cannot make a pattern', () => {
    expect(() => livingHinge(0, 0, 30, 60, { ...FLEX_DEFAULTS, distance: 0.02 }, t, 0.1)).toThrow(ParamError);
    expect(() => livingHinge(0, 0, 2, 60, FLEX_DEFAULTS, t, 0.1)).toThrow(ParamError);
  });

  it('needs at least two slit lines: 3 line spacings pass with exactly two, just under 3 fails', () => {
    const d = FLEX_DEFAULTS.distance * t;
    const two = livingHinge(0, 0, 3 * d, 60, FLEX_DEFAULTS, t, 0.1);
    expect(new Set(two.slits.map((s) => s.x.toFixed(9))).size).toBe(2);
    let err: unknown;
    try { livingHinge(0, 0, 3 * d - 1e-6, 60, FLEX_DEFAULTS, t, 0.1); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ParamError);
    expect((err as ParamError).param).toBe('flex_distance');
    expect((err as Error).message).toMatch(/two slit lines/);
  });
});

describe('harness on bent parts', () => {
  const W = 80; const D = 50; const H = 40; const t = 3;
  const opts = { ...assemblyOpts({}), expectedSize: { x: W + 2 * t, y: D + 2 * t, z: H } };

  it('a correct bent wall around a rounded-rect plate passes', () => {
    const parts = bentFixture(W, D, 12, H, t);
    assertValidParts(parts, {});
    assertAssembly(parts, opts);
    assertAssembly(bentFixture(W, D, 12, H, t, { firstMateOnly: true }), opts);
  });

  it('fails when the wall is offset by 0.5 mm', () => {
    for (const shift of [[0.5, 0, 0], [0, 0.5, 0], [0, -0.5, 0], [0, 0, 0.5]] as [number, number, number][])
      expect(() => assertAssembly(bentFixture(W, D, 12, H, t, { shift }), opts)).toThrow();
  });

  it('fails with a wrong bend radius (through the mates, or interpenetration / size alone)', () => {
    for (const e of [-1, -0.5, 0.5, 1])
      expect(() => assertAssembly(bentFixture(W, D, 12, H, t, { radiusError: e }), opts)).toThrow(/joint lines differ/);

    // With only the first span mated, a too-small radius drives the arc through the plate's corner.
    expect(() => assertAssembly(bentFixture(W, D, 12, H, t, { radiusError: -1, firstMateOnly: true }), { play: 0 })).toThrow(/interpenetrate/);
    expect(() => assertAssembly(bentFixture(W, D, 12, H, t, { radiusError: 1, firstMateOnly: true }), opts)).toThrow(/assembly size/);
  });

  it('bounds the strip length against the inner-face arc (independent of the mapping)', () => {
    // Correct (inner arc / stretch) passes; twice or half as long fails, though the mapping would
    // happily spread either over the same 90 degrees.
    assertValidParts(bentFixture(W, D, 12, H, t), {});
    expect(() => assertValidParts(bentFixture(W, D, 12, H, t, { stripScale: 2 }), {})).toThrow(/strip length .* inner-face arc/);
    expect(() => assertValidParts(bentFixture(W, D, 12, H, t, { stripScale: 0.5 }), {})).toThrow(/strip length .* inner-face arc/);
    // The bound itself: [1 / 1.3, 1] of the inner arc (positive bend: radius - t; negative: radius).
    const arc = (r: number): number => (r * Math.PI) / 2;
    expect(() => checkHingeStrips({ arcs: [{ at: 0, length: arc(10), angle: 90, radius: 13 }] }, 3)).not.toThrow();
    expect(() => checkHingeStrips({ arcs: [{ at: 0, length: arc(10) / 1.29, angle: 90, radius: 13 }] }, 3)).not.toThrow();
    expect(() => checkHingeStrips({ arcs: [{ at: 0, length: arc(10) * 1.01, angle: 90, radius: 13 }] }, 3)).toThrow(/strip length/);
    expect(() => checkHingeStrips({ arcs: [{ at: 0, length: arc(10) / 1.31, angle: 90, radius: 13 }] }, 3)).toThrow(/strip length/);
    expect(() => checkHingeStrips({ arcs: [{ at: 0, length: arc(13), angle: 90, radius: 13 }] }, 3)).toThrow(/strip length/); // outer face
    expect(() => checkHingeStrips({ arcs: [{ at: 0, length: arc(13) / 1.1, angle: -90, radius: 13 }] }, 3)).not.toThrow();
  });

  it('rejects a malformed bend in assertValidParts', () => {
    const parts = bentFixture(W, D, 12, H, t);
    parts[1]!.bend = { arcs: [{ at: 0, length: 10, angle: 90, radius: 2 }] };
    expect(() => assertValidParts(parts, {})).toThrow(/radius/);
  });
});
