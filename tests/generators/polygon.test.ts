/**
 * "Round / polygon / special" batch: headline-dimension tests per generator (the registry
 * loop in suite.ts covers invariants, presets, snapshots and fuzz), the n-gon side count, the
 * angled corner geometry and ParamErrors.
 */
import { describe, expect, it } from 'vitest';
import { angledFingerWidths } from '../../src/core/edges';
import { flatten } from '../../src/core/geometry';
import { toWorld, type Part } from '../../src/core/part';
import { defaults, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { getGenerator } from '../../src/generators';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';

/** World bounding box of the nominal outlines at both faces (placements here are not all axis-aligned). */
function worldSize(parts: Part[]): { x: number; y: number; z: number } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) for (const q of flatten(part.nominal.outline)) for (const z of [0, part.thickness]) {
    const w = toWorld(part.placement, q, z);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
  }
  return { x: max[0]! - min[0]!, y: max[1]! - min[1]!, z: max[2]! - min[2]! };
}

const round = (s: { x: number; y: number; z: number }): number[] => [s.x, s.y, s.z].map((v) => +v.toFixed(6));

function build(id: string, over: Params): Part[] {
  const g = getGenerator(id)!;
  const p = { ...defaults(g.schema), ...over };
  const parts = g.build(p);
  assertValidParts(parts, p);
  assertAssembly(parts, assemblyOpts(p, g.expectedSize!(p)));
  return parts;
}

const rejects = (id: string, over: Params, key: string): void => {
  const g = getGenerator(id)!;
  let err: unknown;
  try { g.build({ ...defaults(g.schema), ...over }); } catch (e) { err = e; }
  expect(err, `${id} ${JSON.stringify(over)}`).toBeInstanceOf(ParamError);
  expect((err as ParamError).param).toBe(key);
};

const deg = (a: number): number => (a * Math.PI) / 180;

describe('regularbox', () => {
  /** Footprint of a regular n-gon of corner radius R with a side at the front (y min). */
  const footprint = (n: number, R: number): [number, number] => {
    const th = Array.from({ length: n }, (_, k) => deg(-90 - 180 / n + (360 * k) / n));
    const xs = th.map((a) => R * Math.cos(a));
    const ys = th.map((a) => R * Math.sin(a));
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };

  it('headline: the outer corner radius is `radius` and the height is h (inside = false)', () => {
    for (const n of [4, 5, 6, 8, 12]) for (const top of ['none', 'closed', 'hole']) {
      const parts = build('regularbox', { n, radius: 80, h: 70, thickness: 4, inside: false, top });
      const [fx, fy] = footprint(n, 80);
      expect(round(worldSize(parts)), `n=${n} top=${top}`).toEqual(round({ x: fx, y: fy, z: 70 }));
    }
    // A few closed forms as a cross-check of the footprint helper.
    expect(footprint(4, 80)[0]).toBeCloseTo(80 * Math.SQRT2, 9);
    expect(footprint(6, 80)).toEqual([expect.closeTo(160, 9), expect.closeTo(80 * Math.sqrt(3), 9)]);
  });

  it('headline: inner corner radius `radius` and inner height h (inside = true)', () => {
    const t = 3;
    const n = 7;
    const parts = build('regularbox', { n, radius: 60, h: 50, thickness: t, inside: true, top: 'closed' });
    const [fx, fy] = footprint(n, 60 + t / Math.cos(Math.PI / n));
    expect(round(worldSize(parts))).toEqual(round({ x: fx, y: fy, z: 50 + 2 * t }));
  });

  it('n-gon side count: n walls, n-sided plates, walls joined in a ring by angled finger joints', () => {
    for (let n = 4; n <= 12; n++) {
      const parts = build('regularbox', { n, radius: 70, h: 40, top: 'closed' });
      const walls = parts.filter((q) => q.id.startsWith('wall'));
      expect(walls).toHaveLength(n);
      for (const id of ['bottom', 'top']) {
        const plate = parts.find((q) => q.id === id)!;
        expect(plate.edges.filter((e) => e.type === 'fingerHole' && e.mate?.part.startsWith('wall'))).toHaveLength(n);
      }
      // Each wall's 'angledFinger' end mates the previous wall's 'angledFingerHole' end.
      walls.forEach((w, k) => {
        const g = w.edges.find((e) => e.type === 'angledFinger')!;
        const G = w.edges.find((e) => e.type === 'angledFingerHole')!;
        expect(g.mate!.part).toBe(`wall${(k + n - 1) % n}`);
        expect(G.mate!.part).toBe(`wall${(k + 1) % n}`);
      });
      // The vertical joint lines are the outer corners: tip(360 / n) past the inner wall width.
      const w0 = walls[0]!;
      const g = w0.edges.find((e) => e.type === 'angledFinger')!;
      const width = 2 * 70 * Math.sin(Math.PI / n);
      expect(g.from.x).toBeCloseTo(width + angledFingerWidths(360 / n, 3).tip, 9);
    }
  });

  it('ParamErrors name the parameter', () => {
    rejects('regularbox', { n: 12, radius: 10, thickness: 5 }, 'radius');
    rejects('regularbox', { h: 10, thickness: 5 }, 'h');
    rejects('regularbox', { radius: 10, thickness: 10, inside: false }, 'radius');
  });
});

describe('angledbox', () => {
  it('headline: outer x, y, h for odd and even wall counts, either orientation (inside = false)', () => {
    for (const n of [1, 2, 3, 4, 5]) for (const top of ['none', 'closed']) {
      expect(round(worldSize(build('angledbox', { x: 200, y: 90, h: 60, n, inside: false, top }))), `n=${n}`).toEqual([200, 90, 60]);
      expect(round(worldSize(build('angledbox', { x: 90, y: 200, h: 60, n, inside: false, top }))), `n=${n} along y`).toEqual([90, 200, 60]);
    }
  });

  it('headline: inner x, y, h (inside = true): a side at the x extremes for odd n, a corner for even n', () => {
    const t = 3;
    expect(round(worldSize(build('angledbox', { x: 150, y: 80, h: 40, n: 3, thickness: t, top: 'none' })))).toEqual([156, 86, 43]);
    const reach = t / Math.cos(Math.PI / 6);
    expect(round(worldSize(build('angledbox', { x: 150, y: 80, h: 40, n: 2, thickness: t, top: 'none' }))))
      .toEqual(round({ x: 150 + 2 * reach, y: 86, z: 43 }));
  });

  it('has 2n + 2 walls; n = 1 is a rectangle with square (90 degree) angled joints', () => {
    for (const n of [1, 3, 5]) expect(build('angledbox', { n }).filter((q) => q.id.startsWith('wall'))).toHaveLength(2 * n + 2);
    expect(angledFingerWidths(90, 3)).toEqual({ tip: 3, base: 0, depth: 3 });
  });

  it('ParamErrors name the parameter', () => {
    rejects('angledbox', { x: 60, y: 60, n: 2, thickness: 15 }, 'x');
    rejects('angledbox', { x: 60, y: 61, n: 2, thickness: 15 }, 'y');
    rejects('angledbox', { n: 8, y: 30, thickness: 5 }, 'n');
    rejects('angledbox', { h: 10, thickness: 5 }, 'h');
  });
});

describe('stackablebin', () => {
  it('headline: overall width, depth (feet to tongue height) with inside = false', () => {
    for (const sections of [1, 3])
      expect(round(worldSize(build('stackablebin', { x: 220, sections, d: 160, h: 90, front: 0.3, inside: false }))))
        .toEqual([220, 160, 90]);
  });

  it('headline: inner sizes (inside = true); depth adds the 45 degree retainer and the back brim', () => {
    const t = 3;
    const h = 60;
    const front = 0.4;
    const parts = build('stackablebin', { x: 70, sections: 2, d: 100, h, front, thickness: t, inside: true });
    expect(round(worldSize(parts))).toEqual(round({ x: 2 * 70 + t + 2 * t, y: h * front + t / Math.SQRT2 + 100 + 2 * t, z: h + 6 * t }));
    expect(parts.filter((q) => q.id.startsWith('divider'))).toHaveLength(1);
  });

  it('the retainer leans out at 45 degrees and meets the bottom with angled finger joints', () => {
    const parts = build('stackablebin', {});
    const r = parts.find((q) => q.id === 'retainer')!;
    expect(r.placement.y[1]).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(r.placement.y[2]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(r.edges.find((e) => e.side === 0)!.type).toBe('angledFinger');
    expect(parts.find((q) => q.id === 'bottom')!.edges.find((e) => e.side === 2)!.type).toBe('angledFingerHole');
  });

  it('ParamErrors name the parameter', () => {
    rejects('stackablebin', { d: 40, thickness: 4 }, 'd');
    rejects('stackablebin', { x: 200, h: 20, front: 0.1, thickness: 5 }, 'front');
    rejects('stackablebin', { x: 20, thickness: 8 }, 'x');
  });
});
