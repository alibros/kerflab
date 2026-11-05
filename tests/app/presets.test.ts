import { describe, expect, it } from 'vitest';
import { loadUserPresets } from '../../src/app/presets';
import { commonParams, type Schema } from '../../src/core/schema';

const store = (value: unknown): Storage => ({ getItem: () => JSON.stringify(value) }) as unknown as Storage;

describe('loadUserPresets', () => {
  it('drops corrupt entries so applying a chip can never throw', () => {
    const s = store({ box: { good: { x: 1 }, nul: null, num: 5, str: 'x', arr: [1], bool: true } });
    expect(loadUserPresets('box', s)).toEqual({ good: { x: 1 } });
  });
  it('tolerates a corrupt container', () => {
    expect(loadUserPresets('box', store({ box: [1, 2] }))).toEqual({});
    expect(loadUserPresets('box', store(7))).toEqual({});
    expect(loadUserPresets('box', { getItem: () => '{nope' } as unknown as Storage)).toEqual({});
  });
  it('with a schema, keeps only stored values that validate there and drops emptied presets', () => {
    const schema: Schema = [
      { key: 'x', label: 'X', help: 'x', unit: 'mm', group: 'Size', kind: 'number', min: 10, max: 100, default: 50, step: 1 },
      { key: 'top', label: 'Top', help: 't', group: 'Box', kind: 'enum', options: ['closed', 'none'], default: 'closed' },
      ...commonParams,
    ];
    const s = store({ box: {
      mixed: { x: 70, top: 'sideways', thickness: 4, bogus: 1 },
      bad: { x: 5000, top: 3, kerf: 'wide' },
      nan: { x: null },
    } });
    expect(loadUserPresets('box', s, schema)).toEqual({ mixed: { x: 70, thickness: 4 } });
  });
});
