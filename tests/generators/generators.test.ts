/**
 * Registry-level tests and the closedbox-specific tests. The per-generator invariant, assembly,
 * preset and fuzz checks live in `suite.ts` and run in parallel shards
 * (`registry.shardK.test.ts`); later tasks only add generators (plus their own headline-dimension
 * tests in `tests/generators/<batch>.test.ts`).
 */
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bounds } from '../../src/core/geometry';
import { toWorld, type Part } from '../../src/core/part';
import { defaults, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { getGenerator, registry } from '../../src/generators';
import { assertAssembly } from '../harness/invariants';
import { SHARDS } from './suite';

describe('registry', () => {
  it('is non-empty with unique ids, all resolvable by getGenerator', () => {
    expect(registry.length).toBeGreaterThan(0);
    const ids = registry.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of registry) expect(getGenerator(g.id)).toBe(g);
    expect(getGenerator('no-such-generator')).toBeUndefined();
  });

  it('has exactly one shard test file per shard', () => {
    const files = readdirSync(dirname(fileURLToPath(import.meta.url))).filter((f) => /^registry\.shard\d+\.test\.ts$/.test(f));
    expect(files.sort()).toEqual(Array.from({ length: SHARDS }, (_, k) => `registry.shard${k}.test.ts`).sort());
  });
});

// ---------------------------------------------------------------- closedbox

/** World bounding-box extents of the assembled nominal parts (all placements are axis-aligned here). */
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

describe('closedbox', () => {
  const g = getGenerator('closedbox')!;
  const base = (over: Params = {}): Params => ({ ...defaults(g.schema), ...over });

  it('is registered in the Boxes category', () => {
    expect(g).toBeDefined();
    expect(g.category).toBe('Boxes');
  });

  it('builds 6 parts with a closed top and 5 without', () => {
    expect(g.build(base({ top: 'closed' }))).toHaveLength(6);
    expect(g.build(base({ top: 'none' }))).toHaveLength(5);
  });

  it('outer dimensions equal x, y, h when inside=false', () => {
    for (const top of ['closed', 'none']) {
      const p = base({ x: 120, y: 80, h: 60, inside: false, top });
      const parts = g.build(p);
      const s = worldSize(parts);
      expect(s.x).toBeCloseTo(120, 6);
      expect(s.y).toBeCloseTo(80, 6);
      expect(s.z).toBeCloseTo(60, 6);
      assertAssembly(parts, { expectedSize: { x: 120, y: 80, z: 60 } });
    }
  });

  it('inner dimensions equal x, y, h when inside=true', () => {
    const t = 4;
    const closed = worldSize(g.build(base({ x: 120, y: 80, h: 60, inside: true, thickness: t, top: 'closed' })));
    expect([closed.x, closed.y, closed.z].map((v) => +v.toFixed(6))).toEqual([128, 88, 68]);
    const open = worldSize(g.build(base({ x: 120, y: 80, h: 60, inside: true, thickness: t, top: 'none' })));
    expect([open.x, open.y, open.z].map((v) => +v.toFixed(6))).toEqual([128, 88, 64]);
  });

  it('every finger edge is mated to a notched edge (no open joints)', () => {
    for (const top of ['closed', 'none']) {
      const parts = g.build(base({ top }));
      const joints = parts.flatMap((part) => part.edges.filter((e) => e.type !== 'flat'));
      expect(joints.every((e) => e.mate && !e.open)).toBe(true);
      // 12 box edges, 2 sides each; without a top the 4 top edges are plain
      expect(joints).toHaveLength(top === 'closed' ? 24 : 16);
    }
  });

  it('throws ParamError naming x when x < 3 * thickness', () => {
    for (const inside of [true, false]) {
      const p = base({ x: 8, thickness: 3, inside });
      expect(() => g.build(p)).toThrow(ParamError);
      expect(() => g.build(p)).toThrow(/\bx\b/);
    }
  });

  it('throws ParamError naming kerf (not GeometryError) when kerf closes the finger gaps', () => {
    // 0.5 mm spaces and notches are fully eaten by a 0.5 mm kerf
    const p = base({ thickness: 0.5, finger: 1, space: 1, kerf: 0.5 });
    expect(() => g.build(p)).toThrow(ParamError);
    expect(() => g.build(p)).toThrow(/\bkerf\b/);
    expect(() => g.build({ ...p, burn: false })).not.toThrow();
  });

  it('throws ParamError naming h when the inner height is too small for outer dims', () => {
    // outer 20 mm with 5 mm walls leaves 10 mm inside: below 3 * thickness
    expect(() => g.build(base({ h: 20, thickness: 5, inside: false }))).toThrow(/\bh\b/);
  });
});
