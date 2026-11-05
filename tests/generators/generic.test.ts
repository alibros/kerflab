/**
 * Generic generators batch (enclosure, slopedorganizer, capsuledispenser, calibration,
 * profilebox): headline dimensions and behaviour per generator, on assembled models that pass the
 * harness, plus ParamErrors naming their param. The registry loop in suite.ts covers invariants,
 * presets, snapshots and fuzz.
 */
import { describe, expect, it } from 'vitest';
import { flatten } from '../../src/core/geometry';
import { toWorld, type Part } from '../../src/core/part';
import { defaults, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { getGenerator } from '../../src/generators';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';

function build(id: string, over: Params): Part[] {
  const g = getGenerator(id)!;
  const p = { ...defaults(g.schema), ...over };
  const parts = g.build(p);
  assertValidParts(parts, p);
  assertAssembly(parts, assemblyOpts(p, g.expectedSize?.(p)));
  return parts;
}

/** World bounding-box size of rigid parts' nominal outlines at both faces. */
function size(parts: Part[]): number[] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const q of parts) for (const v of flatten(q.nominal.outline)) for (const z of [0, q.thickness]) {
    const w = toWorld(q.placement, v, z);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
  }
  return [0, 1, 2].map((i) => +(max[i]! - min[i]!).toFixed(6));
}

const rejects = (id: string, over: Params, key: string): void => {
  const g = getGenerator(id)!;
  const p = { ...defaults(g.schema), ...over };
  expect(() => g.build(p)).toThrow(ParamError);
  try { g.build(p); } catch (e) { expect((e as ParamError).param).toBe(key); }
};

describe('generic generators: headline dimensions', () => {
  it('enclosure: plain box is x+2t by y+2t by h+3t inside, flanges add 4 * holedist', () => {
    const t = 3;
    expect(size(build('enclosure', { front: 'plain', x: 100, y: 80, h: 50, inside: true, mounts: 'inside', thickness: t })))
      .toEqual([106, 86, 59]);
    expect(size(build('enclosure', { front: 'plain', x: 100, y: 80, h: 50, inside: false, mounts: 'flanges', holedist: 7, thickness: t })))
      .toEqual([128, 80, 50]);
    // lid + four triangles; vents add slots to the side walls
    const parts = build('enclosure', { front: 'plain', vents: true });
    expect(parts.filter((q) => q.id.startsWith('triangle'))).toHaveLength(4);
    expect(parts.find((q) => q.id === 'left')!.holes.length).toBeGreaterThan(parts.find((q) => q.id === 'front')!.holes.length);
  });

  it('enclosure: rack fronts are EIA panel sized with four ear slots', () => {
    for (const [front, w] of [['rack19', 482.6], ['rack10', 254]] as const)
      for (const u of [1, 3]) {
        const parts = build('enclosure', { front, rack_units: u, y: 150, mounts: 'none' });
        const s = size(parts);
        expect(s[0]).toBeCloseTo(w, 6);
        expect(s[2]).toBeCloseTo(u * 44.45 - 0.79, 6);
        const panel = parts.find((q) => q.id === 'front')!;
        // ear slots are 10 mm wide rounded slots (arcs) besides the straight slot rows
        expect(panel.nominal.holes.filter((h) => h.segs.some((sg) => sg.t === 'A'))).toHaveLength(4);
      }
  });

  it('slopedorganizer: outer size, dividers, curved profile and grip cut-outs', () => {
    const t = 3;
    const parts = build('slopedorganizer', { x: 40, cols: 3, y: 60, h: 80, front: 0.4, inside: true, thickness: t });
    expect(size(parts)).toEqual([3 * 40 + 4 * t, 60 + 2 * t, 80 + t]);
    expect(parts.filter((q) => q.id.startsWith('divider'))).toHaveLength(2);
    const curve = build('slopedorganizer', { cols: 1, x: 100, y: 200, h: 300, front: 0.5, profile: 'curve' });
    expect(curve.find((q) => q.id === 'left')!.nominal.outline.segs.some((sg) => sg.t === 'A')).toBe(true);
    const grip = build('slopedorganizer', { front: 1, grip: 0.4 });
    expect(grip.find((q) => q.id === 'front')!.nominal.outline.segs.some((sg) => sg.t === 'A')).toBe(true);
    rejects('slopedorganizer', { h: 20, front: 0.1, thickness: 3 }, 'front');
  });

  it('capsuledispenser: plate size from the grid; two plates without the back', () => {
    const t = 3;
    // width = cols (lid + 2 + 5) - 5 + 14, height = (rows + 0.6) lid + 14
    expect(size(build('capsuledispenser', { columns: 4, rows: 5, lid_size: 37, thickness: t }))).toEqual([4 * 44 - 5 + 14, 3 * t, +(5.6 * 37 + 14).toFixed(6)]);
    expect(build('capsuledispenser', { backplate: false })).toHaveLength(2);
    rejects('capsuledispenser', { lid_size: 30, body_size: 31 }, 'body_size');
  });

  it('calibration: one tab per section, each section looser by step', () => {
    const parts = build('calibration', { mode: 'fit', count: 4, clearance: 0.05, step: 0.1 });
    expect(parts).toHaveLength(5);
    expect(parts.slice(1).map((q) => q.name)).toEqual(['0.05', '0.15', '0.25', '0.35'].map((c, i) => `Tab ${i + 1}: clearance ${c} mm`));
    // the gauge's engraved ticks number the sections 1..4
    expect(parts[0]!.engrave).toHaveLength(1 + 2 + 3 + 4);
    rejects('calibration', { mode: 'fit', count: 10, step: 0.2, space: 1, thickness: 1 }, 'step');
  });

  it('calibration: flex strip is one bent part with a living hinge', () => {
    const [strip, ...rest] = build('calibration', { mode: 'flex', bend: 90 });
    expect(rest).toHaveLength(0);
    expect(strip!.bend?.arcs).toHaveLength(1);
    expect(strip!.holes.length).toBeGreaterThan(10);
    expect(build('calibration', { mode: 'flex', bend: 0 })[0]!.bend).toBeUndefined();
  });

  it('profilebox: console and house have five walls and two profile plates; roof pitch at most 45', () => {
    for (const shape of ['console', 'house']) {
      const parts = build('profilebox', { shape, angle: 30 });
      expect(parts).toHaveLength(7);
    }
    const t = 3;
    // house: depth y + 2t, width x + 2t
    const s = size(build('profilebox', { shape: 'house', x: 150, y: 120, h: 100, angle: 45, thickness: t }));
    expect(s[0]).toBeCloseTo(156, 6);
    expect(s[1]).toBeCloseTo(126, 6);
    const bird = build('profilebox', { shape: 'house', hole: 32, x: 150, y: 150, h: 150, angle: 45 });
    expect(bird.find((q) => q.id === 'bottom')!.holes).toHaveLength(1);
    rejects('profilebox', { shape: 'house', angle: 60 }, 'angle');
    rejects('profilebox', { shape: 'house', y: 60, hole: 70 }, 'hole');
  });
});
