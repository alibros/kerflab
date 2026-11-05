import { describe, expect, it } from 'vitest';
import { defaults } from '../../src/core/schema';
import { registry } from '../../src/generators';
import { defaultState, type State } from '../../src/app/store';
import { decodeState, encodeState } from '../../src/app/url';

const stateFor = (id: string): State => {
  const g = registry.find((r) => r.id === id)!;
  return { ...defaultState(), generatorId: id, params: defaults(g.schema) };
};

describe('url state', () => {
  it('round-trips every generator’s defaults', () => {
    for (const g of registry) {
      const s = stateFor(g.id);
      const hash = encodeState(s);
      expect(hash.startsWith('v1/')).toBe(true);
      const d = decodeState(`#${hash}`);
      expect(d.notice).toBeUndefined();
      expect({ ...d, notice: undefined }).toEqual({ ...s, notice: undefined });
    }
  });

  it('round-trips edited params, units and sheet, and stays compact', () => {
    const base = stateFor(registry[0]!.id);
    const s: State = { ...base, units: 'in', sheet: { w: 300, h: 200 }, params: { ...base.params, x: 123.4, inside: false, top: 'none', units: 'in' } };
    const hash = encodeState(s);
    expect(hash.length).toBeLessThan(80);
    expect(hash).not.toContain('thickness'); // defaults are omitted
    const d = decodeState(hash);
    expect(d.notice).toBeUndefined();
    expect(d.params).toEqual(s.params);
    expect(d.units).toBe('in');
    expect(d.sheet).toEqual({ w: 300, h: 200 });
  });

  it('says whether the link named its units, so a link without _u keeps the viewer\'s units', () => {
    expect(decodeState('#v1/closedbox/x=120;_u=in').unitsInLink).toBe(true);
    expect(decodeState('#v1/closedbox/x=120;_u=mm').unitsInLink).toBe(true);
    expect(decodeState('#v1/closedbox/x=120').unitsInLink).toBeUndefined();
  });

  it('empty hash yields defaults without a notice', () => {
    for (const h of ['', '#', '#/']) {
      const d = decodeState(h);
      expect(d.notice).toBeUndefined();
      expect(d.generatorId).toBe(registry[0]!.id);
    }
  });

  it('garbled, foreign and old-version hashes yield defaults with a notice and never throw', () => {
    const def = defaultState();
    for (const h of ['#%%%', '#v0/closedbox/x=5', '#v9/closedbox', '#hello world', '#access_token=abc&state=1', '#v1', '#v1/nosuchbox/x=1', '#\u0000￿', '#v1/closedbox/%E0%A4%A']) {
      const d = decodeState(h);
      expect(d.notice, h).toBeTruthy();
      expect(d.params, h).toEqual(def.params);
    }
    expect(decodeState('#v0/closedbox').notice).toMatch(/version/i);
  });

  it('clamps out-of-range values to the nearest valid one and says so', () => {
    const d = decodeState('#v1/closedbox/x=5000;y=-3;h=abc;top=sideways;bogus=1;inside=maybe');
    const g = registry[0]!;
    const def = defaults(g.schema);
    expect(d.params.x).toBe(1000);
    expect(d.params.y).toBe(10);
    expect(d.params.h).toBe(def.h);
    expect(d.params.top).toBe(def.top);
    expect(d.params.inside).toBe(def.inside);
    expect(d.notice).toMatch(/x/);
    expect(d.notice).toMatch(/bogus/);
  });

  it('rejects silly sheet sizes', () => {
    const d = decodeState('#v1/closedbox/_sheet=0x-5');
    expect(d.sheet).toEqual(defaultState().sheet);
    expect(d.notice).toBeTruthy();
  });

  it('caps the unknown / adjusted lists in the notice', () => {
    const unknown = Array.from({ length: 12 }, (_, i) => `zz${i}=1`).join(';');
    const bad = decodeState(`#v1/closedbox/${unknown}`);
    expect(bad.notice).toContain('and 7 more');
    expect(bad.notice).toContain('zz4');
    expect(bad.notice).not.toContain('zz5');
    expect(bad.notice!.length).toBeLessThan(200);
    const few = decodeState('#v1/closedbox/zz0=1;zz1=1');
    expect(few.notice).not.toContain('more');
  });

  it('round-trips text params (comma lists are escaped) and resets invalid text with a notice', () => {
    const base = stateFor('traylayout');
    const s: State = { ...base, params: { ...base.params, sx: '2,1,1', sy: '1, 2' } };
    const hash = encodeState(s);
    expect(hash).not.toMatch(/sx=2,1/); // ',' and ';' never appear raw in a value
    const d = decodeState(`#${hash}`);
    expect(d.notice).toBeUndefined();
    expect(d.params.sx).toBe('2,1,1');
    expect(d.params.sy).toBe('1, 2');
    const bad = decodeState('#v1/traylayout/sx=2%2C%2C1');
    expect(bad.params.sx).toBe('');
    expect(bad.notice).toMatch(/sx/);
  });
});
