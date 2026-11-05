/**
 * Registry-wide generator checks, split into shards so vitest runs them in parallel worker files.
 * Generator i belongs to shard i % SHARDS; each `registry.shardK.test.ts` is the one line
 * `registerShard(K)`. Adding a generator to `src/generators/index.ts` needs no test change; adding a
 * shard means one new one-line file plus bumping SHARDS (generators.test.ts checks they match).
 */
import { describe, expect, it } from 'vitest';
import type { Generator } from '../../src/core/part';
import { defaults, validate } from '../../src/core/schema';
import { rowLayout } from '../../src/app/export/layout';
import { toSVG } from '../../src/app/export/svg';
import { registry } from '../../src/generators';
import { fuzz } from '../harness/fuzz';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';

export const SHARDS = 6;
/** Fixed seed so fuzz failures are reproducible; change deliberately, never per run. */
export const FUZZ_SEED = 20261105;
export const FUZZ_CASES = 200;
/** Generous ceiling; a finger-jointed generator takes about 4-5 s (closedbox). */
const FUZZ_TIMEOUT_MS = 60_000;

export const shardOf = (index: number): number => index % SHARDS;

function generatorSuite(g: Generator): void {
  it('has metadata and a well-formed schema', () => {
    expect(g.name).not.toBe('');
    expect(g.category).not.toBe('');
    expect(g.description).not.toBe('');
    expect(() => defaults(g.schema)).not.toThrow();
  });

  it('defaults build valid parts that assemble to expectedSize', () => {
    const p = defaults(g.schema);
    const parts = g.build(p);
    assertValidParts(parts, p);
    const size = g.expectedSize?.(p);
    assertAssembly(parts, assemblyOpts(p, size, g.assembly === 'loose'));
  });

  it('every preset validates, builds valid parts and assembles to expectedSize', () => {
    for (const [name, preset] of Object.entries(g.presets)) {
      const v = validate(g.schema, { ...defaults(g.schema), ...preset });
      expect(v.ok, `preset ${name}: ${JSON.stringify(v.ok ? {} : v.errors)}`).toBe(true);
      if (!v.ok) continue;
      const parts = g.build(v.params);
      assertValidParts(parts, v.params);
      const size = g.expectedSize?.(v.params);
      assertAssembly(parts, assemblyOpts(v.params, size, g.assembly === 'loose'));
    }
  });

  it('exports a stable SVG of the defaults (snapshot)', async () => {
    const parts = g.build(defaults(g.schema));
    const svg = toSVG(rowLayout(parts, 2), { units: 'mm', stroke: 'both' });
    await expect(svg).toMatchFileSnapshot(`__snapshots__/${g.id}.svg`);
  });

  it(`survives fuzzing (${FUZZ_CASES} random cases, seed ${FUZZ_SEED})`, () => {
    const stats = fuzz(g, FUZZ_CASES, FUZZ_SEED);
    expect(stats.ok).toBeGreaterThan(0);
  }, FUZZ_TIMEOUT_MS);
}

/** Registers the suite for every generator in shard `k`, plus a partition check so no file is empty. */
export function registerShard(k: number): void {
  describe(`registry shard ${k}/${SHARDS}`, () => {
    it('is a valid shard index', () => {
      expect(Number.isInteger(k) && k >= 0 && k < SHARDS).toBe(true);
    });
    for (const [i, g] of registry.entries())
      if (shardOf(i) === k) describe(`generator ${g.id}`, () => generatorSuite(g));
  });
}
