import { describe, expect, it } from 'vitest';
import {
  commonParams, defaults, edgeCtx, effectiveKerf, validate, type Params, type Schema,
} from '../../src/core/schema';

const schema: Schema = [
  { key: 'w', label: 'Width', help: 'Outer width', unit: 'mm', group: 'Size', kind: 'number', min: 10, max: 500, default: 100, step: 1 },
  { key: 'n', label: 'Count', help: 'Dividers', unit: '', group: 'Layout', kind: 'int', min: 0, max: 10, default: 2 },
  { key: 'lid', label: 'Lid', help: 'Add a lid', group: 'Layout', kind: 'bool', default: true },
  { key: 'top', label: 'Top', help: 'Top style', group: 'Layout', kind: 'enum', options: ['closed', 'none'], default: 'closed' },
];

const errorsOf = (s: Schema, p: unknown): Record<string, string> => {
  const r = validate(s, p);
  if (r.ok) throw new Error('expected validation to fail');
  return r.errors;
};

describe('schema', () => {
  it('defaults() returns every key with its default and always validates', () => {
    expect(defaults(schema)).toEqual({ w: 100, n: 2, lid: true, top: 'closed' });
    for (const s of [schema, commonParams, [...commonParams, ...schema]]) {
      const r = validate(s, defaults(s));
      expect(r.ok).toBe(true);
    }
  });

  it('accepts valid params and returns a copy restricted to schema keys', () => {
    const p: Params = { w: 10, n: 10, lid: false, top: 'none' };
    const r = validate(schema, p);
    expect(r).toEqual({ ok: true, params: p });
    if (r.ok) expect(r.params).not.toBe(p);
  });

  it('rejects out-of-range values with per-key messages', () => {
    const e = errorsOf(schema, { w: 9.99, n: 11, lid: true, top: 'closed' });
    expect(Object.keys(e).sort()).toEqual(['n', 'w']);
    expect(e.w).toMatch(/between 10 and 500/);
    expect(e.n).toMatch(/between 0 and 10/);
    expect(errorsOf(schema, { ...defaults(schema), w: 501 }).w).toMatch(/between/);
  });

  it('rejects NaN and infinities', () => {
    expect(errorsOf(schema, { ...defaults(schema), w: NaN }).w).toMatch(/finite/);
    expect(errorsOf(schema, { ...defaults(schema), w: Infinity }).w).toMatch(/finite/);
    expect(errorsOf(schema, { ...defaults(schema), n: NaN }).n).toMatch(/finite/);
  });

  it('rejects wrong types per key', () => {
    const e = errorsOf(schema, { w: '100', n: 2.5, lid: 'yes', top: 3 });
    expect(e.w).toMatch(/must be a number/);
    expect(e.n).toMatch(/integer/);
    expect(e.lid).toMatch(/true or false/);
    expect(e.top).toMatch(/one of: closed, none/);
    expect(errorsOf(schema, { ...defaults(schema), top: 'open' }).top).toMatch(/one of/);
  });

  it('rejects missing and unknown keys, and non-objects', () => {
    const { n: _n, ...rest } = defaults(schema);
    void _n;
    expect(errorsOf(schema, rest).n).toMatch(/required/);
    expect(errorsOf(schema, { ...defaults(schema), bogus: 1 }).bogus).toMatch(/unknown/);
    for (const bad of [null, 3, 'x', [], undefined]) expect(errorsOf(schema, bad)['*']).toMatch(/object/);
  });

  it('commonParams has the shared keys with sane ranges', () => {
    expect(commonParams.map((d) => d.key)).toEqual(['thickness', 'kerf', 'burn', 'finger', 'space', 'play', 'units']);
    const d = defaults(commonParams);
    expect(d).toMatchObject({ thickness: 3, kerf: 0.1, burn: true, finger: 2, space: 2, play: 0, units: 'mm' });
    const th = commonParams.find((x) => x.key === 'thickness')!;
    expect(th.kind === 'number' && th.min > 0).toBe(true);
    expect(errorsOf(commonParams, { ...d, thickness: 0 }).thickness).toBeDefined();
    expect(errorsOf(commonParams, { ...d, kerf: -0.01 }).kerf).toBeDefined();
    expect(errorsOf(commonParams, { ...d, units: 'cm' }).units).toBeDefined();
  });

  it('edgeCtx scales finger/space/play by thickness; burn=false disables kerf', () => {
    const p = { ...defaults(commonParams), thickness: 4, finger: 2.5, space: 1.5, play: 0.1, kerf: 0.2 };
    expect(edgeCtx(p)).toEqual({ thickness: 4, kerf: 0.2, finger: 10, space: 6, play: 0.4, surroundingSpaces: 2 });
    expect(effectiveKerf(p)).toBe(0.2);
    expect(effectiveKerf({ ...p, burn: false })).toBe(0);
    expect(edgeCtx({ ...p, burn: false }).kerf).toBe(0);
  });

  it('rejects malformed schemas (duplicate keys, bad default)', () => {
    expect(() => defaults([...schema, schema[0]!])).toThrow(/duplicate/);
    const bad: Schema = [{ ...schema[0]!, kind: 'number', min: 10, max: 5, default: 7, step: 1 } as Schema[number]];
    expect(() => defaults(bad)).toThrow(/w/);
  });

  it('text params: type, length and pattern are validated; examples must be valid', () => {
    const list: Schema = [{ key: 'sx', label: 'Sizes', help: 'List', group: 'Layout', kind: 'text', default: '', maxLength: 12,
      pattern: String.raw`\d+(,\d+)*|`, examples: ['1,2'] }];
    expect(validate(list, { sx: '3,1,2' }).ok).toBe(true);
    expect(validate(list, { sx: '' }).ok).toBe(true);
    expect(errorsOf(list, { sx: '1,,2' }).sx).toMatch(/invalid format/);
    expect(errorsOf(list, { sx: '1,2,3,4,5,6,7' }).sx).toMatch(/at most 12/);
    expect(errorsOf(list, { sx: 12 }).sx).toMatch(/text/);
    expect(() => defaults([{ ...list[0]!, examples: ['x'] } as Schema[number]])).toThrow(/example/);
    expect(() => defaults([{ ...list[0]!, examples: [] } as Schema[number]])).toThrow(/example/);
  });
});
