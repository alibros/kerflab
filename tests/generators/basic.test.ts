/**
 * "Basic boxes" batch: one headline-dimension test per generator (the registry loop in
 * suite.ts covers invariants, presets, snapshots and fuzz), plus a few structural checks of the
 * shared wall helpers that the registry loop cannot see directly.
 */
import { describe, expect, it } from 'vitest';
import { area, bounds } from '../../src/core/geometry';
import { toWorld, type Part } from '../../src/core/part';
import { defaults, edgeCtx, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { getGenerator } from '../../src/generators';
import { rectangularWall, trapezoidWall } from '../../src/generators/walls';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';

/** World bounding-box extents of the nominal parts (all placements in this batch are axis-aligned). */
function worldSize(parts: Part[]): { x: number; y: number; z: number } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const b = bounds(part.nominal.outline);
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [0, part.thickness]) {
      const w = toWorld(part.placement, { x, y }, z);
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
    }
  }
  return { x: max[0]! - min[0]!, y: max[1]! - min[1]!, z: max[2]! - min[2]! };
}

const round = (s: { x: number; y: number; z: number }): number[] => [s.x, s.y, s.z].map((v) => +v.toFixed(6));

function setup(id: string): { build: (over: Params) => Part[] } {
  const g = getGenerator(id)!;
  return {
    build: (over) => {
      const p = { ...defaults(g.schema), ...over };
      const parts = g.build(p);
      assertValidParts(parts, p);
      assertAssembly(parts, assemblyOpts(p, g.expectedSize!(p)));
      return parts;
    },
  };
}

describe('basic boxes: headline outer dimensions equal the params (inside = false)', () => {
  it('openbox: x, y, h', () => {
    expect(round(worldSize(setup('openbox').build({ x: 120, y: 80, h: 60, inside: false })))).toEqual([120, 80, 60]);
  });

  it('basedbox: walls are x by y, base adds a one-thickness brim, height h', () => {
    for (const top of ['closed', 'none']) {
      const parts = setup('basedbox').build({ x: 120, y: 80, h: 60, thickness: 4, inside: false, top });
      expect(round(worldSize(parts))).toEqual([128, 88, 60]);
      expect(round(worldSize(parts.filter((q) => q.id !== 'base' && q.id !== 'top'))).slice(0, 2)).toEqual([120, 80]);
    }
  });

  it('universalbox: x, y, h for every top/bottom/vertical combination', () => {
    for (const vertical of ['finger joints', 'finger holes'])
      for (const top of ['closed', 'open']) for (const bottom of ['closed', 'none'])
        expect(round(worldSize(setup('universalbox').build({ x: 120, y: 80, h: 60, inside: false, top, bottom, vertical }))))
          .toEqual([120, 80, 60]);
  });

  it('unevenheightbox: x, y and the tallest corner', () => {
    for (const bottom of ['closed', 'none'])
      expect(round(worldSize(setup('unevenheightbox').build(
        { x: 120, y: 80, height0: 40, height1: 70, height2: 90, height3: 55, inside: false, bottom })))).toEqual([120, 80, 90]);
  });

  it('halfbox: x, y (overall width), h for one or several sections', () => {
    for (const sections of [1, 3])
      expect(round(worldSize(setup('halfbox').build({ x: 90, y: 160, h: 140, sections, inside: false })))).toEqual([90, 160, 140]);
  });
});

describe('basic boxes: structure', () => {
  it('basedbox base is slotted and receives all four walls', () => {
    const parts = setup('basedbox').build({});
    const base = parts.find((q) => q.id === 'base')!;
    expect(base.nominal.holes.length).toBeGreaterThan(8);
    expect(base.edges.every((e) => e.type === 'fingerHole' && e.mate)).toBe(true);
  });

  it('unevenheightbox walls follow the corner heights', () => {
    const parts = setup('unevenheightbox').build({ height0: 40, height1: 70, height2: 90, height3: 55, inside: true, thickness: 3 });
    const top = (id: string): number => bounds(parts.find((q) => q.id === id)!.nominal.outline).max.y;
    expect(top('front')).toBeCloseTo(70, 9); // tallest corner of the front: front right
    expect(top('right')).toBeCloseTo(90, 9);
    expect(top('back')).toBeCloseTo(90, 9);
    expect(top('left')).toBeCloseTo(55, 9);
  });

  it('halfbox has a bottom, a back and sections + 1 supports, the middle ones in slot rows', () => {
    const one = setup('halfbox').build({ sections: 1 });
    expect(one.map((q) => q.id).sort()).toEqual(['back', 'bottom', 'support0', 'support1']);
    expect(one.every((q) => q.holes.length === 0)).toBe(true);
    const parts = setup('halfbox').build({ sections: 3, y: 40, play: 0.1 });
    expect(parts.map((q) => q.id).sort()).toEqual(['back', 'bottom', 'support0', 'support1', 'support2', 'support3']);
    for (const id of ['bottom', 'back']) {
      const plate = parts.find((q) => q.id === id)!;
      const interior = plate.edges.filter((e) => e.holes);
      expect(interior.map((e) => e.mate?.part)).toEqual(['support1', 'support2']);
      expect(interior.flatMap((e) => e.holes!)).toHaveLength(plate.holes.length);
    }
  });

  it('openbox and universalbox (open, no bottom) leave the open sides plain', () => {
    const open = setup('openbox').build({});
    expect(open.flatMap((q) => q.edges).filter((e) => e.type === 'flat')).toHaveLength(6);
    const sleeve = setup('universalbox').build({ top: 'open', bottom: 'none' });
    expect(sleeve).toHaveLength(4);
  });

  it('throws ParamError naming the param for too-small sizes', () => {
    const cases: [string, Params, string][] = [
      ['openbox', { y: 8 }, 'y'],
      ['basedbox', { h: 8 }, 'h'],
      ['universalbox', { x: 25, inside: false, vertical: 'finger holes', thickness: 4 }, 'x'],
      ['unevenheightbox', { height2: 8 }, 'height2'],
      ['halfbox', { x: 8 }, 'x'],
    ];
    for (const [id, over, key] of cases) {
      const g = getGenerator(id)!;
      const p = { ...defaults(g.schema), ...over };
      expect(() => g.build(p), id).toThrow(ParamError);
      try { g.build(p); } catch (e) { expect((e as ParamError).param, id).toBe(key); }
    }
  });
});

describe('walls helpers', () => {
  const ctx = edgeCtx(defaults(getGenerator('closedbox')!.schema));

  it('a level trapezoidWall matches rectangularWall', () => {
    const r = rectangularWall(80, 50, ['fingerHole', 'finger', 'flat', 'finger'], ctx);
    const tz = trapezoidWall(80, 50, 50, ['fingerHole', 'finger', 'flat', 'finger'], ctx);
    expect(area(tz.outline)).toBeCloseTo(area(r.outline), 6);
    expect(bounds(tz.outline)).toEqual(bounds(r.outline));
    expect(tz.lines).toEqual(r.lines);
  });

  it('fingerHoles sides set the outline out by 2t, report fingerHole joint lines at depth t, and cut one slot per finger', () => {
    const t = ctx.thickness;
    const w = rectangularWall(80, 50, ['fingerHoles', 'flat', 'flat', 'flat'], ctx);
    expect(bounds(w.outline).min.y).toBeCloseTo(-2 * t, 9);
    expect(w.lines[0]).toMatchObject({ type: 'fingerHole', from: { x: 0, y: -t }, to: { x: 80, y: -t } });
    expect(w.holes.length).toBeGreaterThan(0);
    for (const h of w.holes) {
      const b = bounds(h);
      expect(b.min.y).toBeCloseTo(-t - ctx.play / 2, 9);
      expect(b.max.y).toBeCloseTo(ctx.play / 2, 9);
      expect(b.max.x - b.min.x).toBeCloseTo(ctx.finger + ctx.play, 9);
    }
  });
});
