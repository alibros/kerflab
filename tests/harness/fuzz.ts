/**
 * Seeded parameter fuzzing for generators. Cases: the defaults, every preset (merged over the
 * defaults), the all-min and all-max corners, each key at its own extremes (others default; text
 * keys: each of their examples, and the first / last example in the all-min / all-max corners), then
 * `n` uniformly random parameter sets.
 * Each case must either be rejected with a ParamError (counted) or build parts that pass
 * assertValidParts + assertAssembly (+ `g.expectedSize` when defined). Any other exception
 * (including GeometryError) fails, as does a ParamError on the defaults or a preset, a ParamError
 * whose message is empty or names no schema key, or (unless `allowManyRejections`) fewer than 50 %
 * accepted among the random cases or among the corner cases.
 */
import type { Generator, Part } from '../../src/core/part';
import { defaults, validate, type ParamDef, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { assemblyOpts, assertAssembly, assertValidParts } from './invariants';

export type FuzzStats = { cases: number; ok: number; rejected: number };
export type FuzzOpts = {
  /** Skip the >= 50 % acceptance requirement (for generators with mostly-infeasible corners). */
  allowManyRejections?: boolean;
};

type Kind = 'defaults' | 'preset' | 'corner' | 'random';
type Case = { label: string; kind: Kind; params: Params };
const MIN_ACCEPTED = 0.5;

/** mulberry32: small, fast, deterministic PRNG in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function extreme(d: ParamDef, hi: boolean): Params[string] {
  switch (d.kind) {
    case 'number': case 'int': return hi ? d.max : d.min;
    case 'bool': return hi;
    case 'enum': return hi ? d.options[d.options.length - 1]! : d.options[0]!;
    case 'text': return hi ? d.examples[d.examples.length - 1]! : d.examples[0]!;
  }
}

function random(d: ParamDef, r: () => number): Params[string] {
  switch (d.kind) {
    case 'number': return d.min + r() * (d.max - d.min);
    case 'int': return Math.min(d.max, d.min + Math.floor(r() * (d.max - d.min + 1)));
    case 'bool': return r() < 0.5;
    case 'enum': return d.options[Math.min(d.options.length - 1, Math.floor(r() * d.options.length))]!;
    case 'text': { // the default or one of the examples
      const all = [d.default, ...d.examples];
      return all[Math.min(all.length - 1, Math.floor(r() * all.length))]!;
    }
  }
}

function cases(g: Generator, n: number, seed: number): Case[] {
  const s = g.schema;
  const base = defaults(s);
  const out: Case[] = [{ label: 'defaults', kind: 'defaults', params: base }];
  for (const [name, preset] of Object.entries(g.presets))
    out.push({ label: `preset ${name}`, kind: 'preset', params: { ...base, ...preset } });
  const all = (hi: boolean): Params => Object.fromEntries(s.map((d) => [d.key, extreme(d, hi)]));
  out.push({ label: 'all-min', kind: 'corner', params: all(false) }, { label: 'all-max', kind: 'corner', params: all(true) });
  for (const d of s) {
    if (d.kind === 'enum')
      for (const o of d.options) out.push({ label: `${d.key}=${o}`, kind: 'corner', params: { ...base, [d.key]: o } });
    else if (d.kind === 'text')
      for (const o of d.examples) out.push({ label: `${d.key}="${o}"`, kind: 'corner', params: { ...base, [d.key]: o } });
    else for (const hi of [false, true])
      out.push({ label: `${d.key}=${hi ? 'max' : 'min'}`, kind: 'corner', params: { ...base, [d.key]: extreme(d, hi) } });
  }
  const r = prng(seed);
  for (let i = 0; i < n; i++)
    out.push({ label: `random ${i}`, kind: 'random', params: Object.fromEntries(s.map((d) => [d.key, random(d, r)])) });
  return out;
}

const escapeRe = (k: string): string => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runs the fuzz cases; throws with the seed, case label and params on the first failure. */
export function fuzz(g: Generator, n: number, seed: number, opts: FuzzOpts = {}): FuzzStats {
  const stats: FuzzStats = { cases: 0, ok: 0, rejected: 0 };
  const tally: Record<'corner' | 'random', { ok: number; total: number }> = {
    corner: { ok: 0, total: 0 }, random: { ok: 0, total: 0 },
  };
  const keyRes = g.schema.map((d) => new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(d.key)}([^A-Za-z0-9_]|$)`));
  for (const c of cases(g, n, seed)) {
    const where = (msg: string): Error =>
      new Error(`fuzz ${g.id} seed ${seed}, case ${c.label}: ${msg}\nparams: ${JSON.stringify(c.params)}`);
    const v = validate(g.schema, c.params);
    if (!v.ok) throw where(`generated params fail validation: ${JSON.stringify(v.errors)}`);
    stats.cases++;
    let parts: Part[];
    try {
      parts = g.build(v.params);
    } catch (e) {
      if (e instanceof ParamError) {
        if (c.kind === 'defaults') throw where(`build rejected the defaults: ${e.message}`);
        if (c.kind === 'preset') throw where(`build rejected a preset: ${e.message}`);
        if (!e.message.trim()) throw where('ParamError with an empty message');
        if (!keyRes.some((re) => re.test(e.message)))
          throw where(`ParamError message names no parameter key: "${e.message}"`);
        stats.rejected++;
        if (c.kind === 'corner' || c.kind === 'random') tally[c.kind].total++;
        continue;
      }
      throw where(`build threw ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    }
    try {
      assertValidParts(parts, v.params);
      const size = g.expectedSize?.(v.params);
      assertAssembly(parts, assemblyOpts(v.params, size, g.assembly === 'loose'));
    } catch (e) {
      throw where(e instanceof Error ? e.message : String(e));
    }
    stats.ok++;
    if (c.kind === 'corner' || c.kind === 'random') { tally[c.kind].ok++; tally[c.kind].total++; }
  }
  if (!opts.allowManyRejections)
    for (const k of ['corner', 'random'] as const) {
      const t = tally[k];
      if (t.total > 0 && t.ok / t.total < MIN_ACCEPTED)
        throw new Error(`fuzz ${g.id} seed ${seed}: only ${t.ok}/${t.total} ${k} cases accepted (< ${MIN_ACCEPTED * 100} %); `
          + 'widen the schema ranges or pass allowManyRejections');
    }
  return stats;
}
