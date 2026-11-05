import { describe, expect, it } from 'vitest';
import { bounds } from '../../src/core/geometry';
import type { Generator, Part } from '../../src/core/part';
import { defaults, validate, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { getGenerator } from '../../src/generators';
import { MAX_SLITS, requireFlexArc } from '../../src/generators/flexwall';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';

const gen = (id: string): Generator => getGenerator(id)!;
const params = (g: Generator, over: Params): Params => {
  const v = validate(g.schema, { ...defaults(g.schema), ...over });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return v.params;
};
/** Builds and checks the assembly against an expected OUTER size given directly from the params. */
function sized(id: string, over: Params, size: { x: number; y: number; z: number }): Part[] {
  const g = gen(id);
  const p = params(g, over);
  const parts = g.build(p);
  assertValidParts(parts, p);
  assertAssembly(parts, assemblyOpts(p, size));
  return parts;
}

describe('flex batch: headline outer dimensions equal the params', () => {
  it('flexbox: profile x * y, depth h (outer)', () => {
    for (const [x, y, h, radius] of [[100, 80, 60, 15], [70, 150, 70, 20], [200, 90, 120, 40]] as [number, number, number, number][])
      sized('flexbox', { x, y, h, radius, inside: false }, { x, y: h, z: y });
  });
  it('flexbox2: width x, depth y, height h (outer)', () => {
    for (const [x, y, h] of [[100, 100, 100], [80, 70, 160], [220, 120, 90]] as [number, number, number][])
      sized('flexbox2', { x, y, h, inside: false }, { x, y, z: h });
  });
  it('flexbox5: equal ends: length x, depth h, height = diameter (outer)', () => {
    sized('flexbox5', { x: 200, h: 60, top_diameter: 70, bottom_diameter: 70, inside: false }, { x: 200, y: 60, z: 70 });
    // Different diameters: length along the bottom tangent, height the larger diameter.
    const t = 3; const r1 = 45 - t; const r2 = 25 - t; const dc = 180 - 2 * t - r1 - r2;
    const l = Math.sqrt(dc * dc - (r1 - r2) ** 2);
    sized('flexbox5', { x: 180, h: 60, top_diameter: 90, bottom_diameter: 50, inside: false, thickness: t }, { x: r2 + l + r1 + 2 * t, y: 60, z: 90 });
  });
  it('roundedbox: x * y * h (outer), both tops', () => {
    for (const top of ['hole', 'closed'])
      sized('roundedbox', { x: 120, y: 80, h: 50, radius: 20, top, inside: false }, { x: 120, y: 80, z: 50 });
  });
  it('ubox: width x, depth h, height y (outer, open top)', () => {
    sized('ubox', { x: 100, y: 90, h: 70, radius: 30, inside: false }, { x: 100, y: 70, z: 90 });
  });
  it('roundedregularbox: square with inner size d is (d + 2t) wide; height h + 2t', () => {
    const t = 3;
    sized('roundedregularbox', { sides: 4, inner_size: 100, h: 50, radius: 15, thickness: t }, { x: 100 + 2 * t, y: 100 + 2 * t, z: 50 + 2 * t });
    for (const n of [3, 5, 6, 8]) sized('roundedregularbox', { sides: n, inner_size: 120, h: 50 }, gen('roundedregularbox').expectedSize!(params(gen('roundedregularbox'), { sides: n, inner_size: 120, h: 50 })));
  });
  it('flexbook: x + y/2 + 4t long, h + 4t high, y + 2t thick', () => {
    const t = 3;
    sized('flexbook', { x: 75, y: 35, h: 125, thickness: t }, { x: 75 + 35 / 2 + 4 * t, y: 125 + 4 * t, z: 35 + 2 * t });
  });
});

describe('flex batch: living hinges', () => {
  const ids = ['flexbox', 'flexbox2', 'flexbox5', 'roundedbox', 'ubox', 'roundedregularbox', 'flexbook'];
  const slitWidth = (p: Params): number => (p.kerf as number) * (p.burn === false ? 0 : 1) + 0.1;
  for (const id of ids) it(`${id}: every bend carries a hinge of >= 2 slit lines; no slit outside a bend`, () => {
    const g = gen(id);
    for (const preset of [{}, ...Object.values(g.presets)]) {
      const p = params(g, preset);
      const bent = g.build(p).filter((q) => q.bend);
      expect(bent.length).toBe(1);
      const part = bent[0]!;
      for (const a of part.bend!.arcs) {
        const slits = part.nominal.holes.map((h) => bounds(h)).filter((b) => b.min.x >= a.at && b.max.x <= a.at + a.length);
        expect(new Set(slits.map((b) => b.min.x.toFixed(6))).size).toBeGreaterThanOrEqual(2);
      }
      const inArc = (x0: number, x1: number): boolean => part.bend!.arcs.some((a) => x0 >= a.at && x1 <= a.at + a.length);
      for (const h of part.nominal.holes) {
        const b = bounds(h);
        if (Math.abs(b.max.x - b.min.x - slitWidth(p)) < 1e-9) expect(inArc(b.min.x, b.max.x)).toBe(true);
      }
    }
  });

  // Independent of the generator's own arithmetic: the expected hinges come straight from the params
  // (inner radius, angle, thickness, stretch; sizes chosen so no radius is clamped), and the slit
  // lines are read off the cut part. Strip = inner arc / stretch (boxes.py convention).
  const D = (r: number, angle: number, n: number): [number, number][] => Array.from({ length: n }, () => [r, angle]);
  const cases: [string, Params, [number, number][]][] = [
    ['flexbox', { x: 100, y: 80, h: 60, radius: 15, inside: false, thickness: 3, flex_stretch: 1.1 }, D(15, 90, 4)],
    ['flexbox2', { x: 100, y: 100, h: 100, radius: 15, inside: false, thickness: 3, flex_stretch: 1 }, D(15, 90, 2)],
    ['flexbox5', { x: 200, h: 60, top_diameter: 70, bottom_diameter: 70, inside: false, thickness: 3 }, D(32, 180, 2)],
    ['ubox', { x: 100, y: 90, h: 70, radius: 30, inside: false, thickness: 4, flex_stretch: 1.2 }, D(30, 90, 2)],
    ['roundedbox', { x: 120, y: 80, h: 50, radius: 20, inside: false, thickness: 3, flex_distance: 0.8 }, D(20, 90, 4)],
    ['roundedregularbox', { sides: 6, inner_size: 120, h: 50, radius: 15, thickness: 3 }, D(15, 60, 6)],
    ['flexbook', { y: 36, thickness: 3 }, D(18, 180, 1)],
  ];
  for (const [id, over, arcs] of cases) it(`${id} ${JSON.stringify(over)}: strip lengths and slit lines follow the params`, () => {
    const g = gen(id);
    const p = params(g, over);
    const t = p.thickness as number;
    const stretch = p.flex_stretch as number;
    const dist = (p.flex_distance as number) * t;
    const part = g.build(p).find((q) => q.bend)!;
    const bend = part.bend!.arcs;
    expect(bend.length).toBe(arcs.length);
    // Slit lines (x of each slit hole's centre), from the cut part, clustered into hinges.
    const xs = [...new Set(part.nominal.holes.map((h) => bounds(h)).filter((b) => Math.abs(b.max.x - b.min.x - slitWidth(p)) < 1e-9)
      .map((b) => ((b.min.x + b.max.x) / 2).toFixed(6)))].map(Number).sort((a, b) => a - b);
    const clusters: number[][] = [];
    for (const x of xs) {
      const last = clusters[clusters.length - 1];
      if (last && x - last[last.length - 1]! < 1.5 * dist) last.push(x);
      else clusters.push([x]);
    }
    expect(clusters.length).toBe(arcs.length);
    arcs.forEach(([r, angle], k) => {
      const inner = (r * angle * Math.PI) / 180;
      const strip = inner / stretch;
      // Strip length within the expected bound (and on the convention exactly).
      expect(strip / inner).toBeGreaterThanOrEqual(1 / 1.3);
      expect(strip / inner).toBeLessThanOrEqual(1);
      const a = bend[k]!;
      expect(a.length).toBeCloseTo(strip, 9);
      expect(Math.abs(a.angle)).toBeCloseTo(angle, 9);
      expect(a.radius).toBeCloseTo(r + t, 9);
      // Slit lines: floor(strip / dist) - 1 of them, `dist` apart, first and last line a margin of
      // [dist, 1.5 dist) in from the strip's ends.
      const c = clusters[k]!;
      const lines = Math.floor(strip / dist + 1e-9);
      expect(c.length).toBe(lines - 1);
      expect(c.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < c.length; i++) expect(c[i]! - c[i - 1]!).toBeCloseTo(dist, 5);
      expect(c[c.length - 1]! - c[0]!).toBeCloseTo((lines - 2) * dist, 5);
      for (const m of [c[0]! - a.at, a.at + strip - c[c.length - 1]!]) {
        expect(m).toBeGreaterThanOrEqual(dist - 1e-6);
        expect(m).toBeLessThan(1.5 * dist + 1e-6);
      }
    });
  });

  it('wall length = the perimeter it wraps (straights + inner-face arcs / stretch); boxes.py\'s at stretch 1', () => {
    const len = (id: string, over: Params): number => {
      const b = bounds(gen(id).build(params(gen(id), over)).find((q) => q.bend)!.nominal.outline);
      return b.max.x - b.min.x;
    };
    // RoundedRegularBox: n straights s = (inner_size - 2r) tan(180 / n), n arcs of 360 / n at radius r.
    for (const stretch of [1, 1.05, 1.2]) {
      const [n, d, r] = [5, 150, 15];
      const s = (d - 2 * r) * Math.tan(Math.PI / n);
      expect(len('roundedregularbox', { sides: n, inner_size: d, radius: r, flex_stretch: stretch })).toBeCloseTo(n * s + (2 * Math.PI * r) / stretch, 6);
    }
    // FlexBox at boxes.py's defaults (outside 100 x 100 x 100, radius 15): its surroundingWall is
    // 2x + 2y - 8r + 2 pi r on the inner size, without stretch.
    const [x, y, r] = [94, 94, 15];
    expect(len('flexbox', { x: 100, y: 100, h: 100, radius: r, inside: false, flex_stretch: 1 })).toBeCloseTo(2 * x + 2 * y - 8 * r + 2 * Math.PI * r, 6);
  });

  it('the arc angles add up to the profile turn', () => {
    const sum = (id: string, over: Params = {}): number => gen(id).build(params(gen(id), over)).find((q) => q.bend)!.bend!.arcs.reduce((s, a) => s + a.angle, 0);
    expect(sum('flexbox')).toBeCloseTo(360);
    expect(sum('roundedbox')).toBeCloseTo(360);
    expect(sum('roundedregularbox', { sides: 7 })).toBeCloseTo(360);
    expect(sum('flexbox5', { top_diameter: 90, bottom_diameter: 40 })).toBeCloseTo(360);
    expect(sum('flexbox2')).toBeCloseTo(180);
    expect(sum('ubox')).toBeCloseTo(180);
    expect(sum('flexbook')).toBeCloseTo(180);
  });
});

describe('flex batch: impossible inputs throw ParamError naming the param', () => {
  const cases: [string, Params, string][] = [
    ['flexbox', { radius: 3, thickness: 6, flex_distance: 3 }, 'radius'],
    ['flexbox', { y: 30, latchsize: 20, thickness: 2 }, 'y'],
    ['flexbox', { h: 10, thickness: 5 }, 'h'],
    ['flexbox2', { h: 30, latchsize: 10, thickness: 3 }, 'h'],
    ['flexbox5', { top_diameter: 10, flex_distance: 3, thickness: 4 }, 'top_diameter'],
    ['roundedbox', { x: 20, thickness: 4 }, 'x'],
    ['roundedregularbox', { sides: 12, inner_size: 30, thickness: 6 }, 'inner_size'],
    ['flexbook', { y: 15, flex_distance: 3, thickness: 6 }, 'y'],
  ];
  for (const [id, over, key] of cases) it(`${id} ${JSON.stringify(over)} -> ${key}`, () => {
    const g = gen(id);
    let err: unknown;
    try { g.build(params(g, over)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ParamError);
    expect((err as ParamError).param).toBe(key);
  });
});

describe('flex batch: slit cap and hinge minimum', () => {
  it('accepts a 300 x 300 x 300 roundedbox, radius 100, 3 mm (more than the old 3000-slit cap)', () => {
    const parts = sized('roundedbox', { x: 300, y: 300, h: 300, radius: 100, thickness: 3, inside: false }, { x: 300, y: 300, z: 300 });
    expect(parts.find((q) => q.bend)!.holes.length).toBeGreaterThan(3000);
    expect(parts.find((q) => q.bend)!.holes.length).toBeLessThanOrEqual(MAX_SLITS);
  });
  it('a 1000 mm roundedbox with radius 300 hits the slit cap (ParamError on flex_distance)', () => {
    const g = gen('roundedbox');
    let err: unknown;
    try { g.build(params(g, { x: 1000, y: 1000, h: 1000, radius: 300, thickness: 3 })); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ParamError);
    expect((err as ParamError).param).toBe('flex_distance');
    expect((err as Error).message).toMatch(new RegExp(`slits in one wall \\(max ${MAX_SLITS}\\)`));
  });
  it('requireFlexArc needs two slit lines: 3 line spacings of strip', () => {
    const fs = { distance: 0.5, connection: 1, width: 5, stretch: 1 };
    const t = 3;
    const rFor = (positions: number): number => (positions * fs.distance * t) / (Math.PI / 2); // 90 degree arc, stretch 1
    expect(() => requireFlexArc('radius', rFor(3.001), 90, fs, t)).not.toThrow();
    let err: unknown;
    try { requireFlexArc('radius', rFor(2.999), 90, fs, t); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ParamError);
    expect((err as ParamError).param).toBe('radius');
    expect((err as Error).message).toMatch(/for two slit lines/);
  });
});
