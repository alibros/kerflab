import { describe, expect, it } from 'vitest';
import { LASER_MACHINES, LASER_MATERIALS, material3dFor, matchMaterial, matchSheet, sheetById, STOCK_SHEETS } from '../../src/app/profiles';
import { DEFAULT_SHEET, defaultState } from '../../src/app/store';
import { decodeState, encodeState } from '../../src/app/url';

describe('sheet profiles', () => {
  it('have unique ids and sizes within the accepted range', () => {
    const all = [...LASER_MACHINES, ...STOCK_SHEETS];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(s.w).toBeGreaterThanOrEqual(10);
      expect(s.h).toBeLessThanOrEqual(10000);
    }
  });

  it('reads the default sheet as a stock sheet, and unknown sizes as custom', () => {
    expect(matchSheet(DEFAULT_SHEET)?.id).toBe('sheet-600x400');
    expect(matchSheet({ w: 900, h: 600 })).toBeNull();
    expect(matchSheet({ w: 300, h: 200 })?.id).toBe('k40');
  });

  it('prefers the viewer’s machine when several share a size', () => {
    expect(matchSheet({ w: 914, h: 610 })?.id).toBe('epilog-fusion-pro-36');
    expect(matchSheet({ w: 914, h: 610 }, 'epilog-fusion-edge-36')?.id).toBe('epilog-fusion-edge-36');
    // A remembered machine of another size does not hijack the match.
    expect(matchSheet({ w: 914, h: 610 }, 'k40')?.id).toBe('epilog-fusion-pro-36');
    expect(matchSheet({ w: 914, h: 610 }, 'nonsense')?.id).toBe('epilog-fusion-pro-36');
  });

  it('every profile round-trips through the URL', () => {
    for (const s of [...LASER_MACHINES, ...STOCK_SHEETS]) {
      const st = { ...defaultState(), sheet: { w: s.w, h: s.h } };
      const d = decodeState(`#${encodeState(st)}`);
      expect(d.notice).toBeUndefined();
      expect(d.sheet).toEqual({ w: s.w, h: s.h });
      expect(matchSheet(d.sheet, s.id)).toBe(sheetById(s.id));
    }
  });

  it('old links (sizes that are no longer listed) still load', () => {
    const d = decodeState('#v1/closedbox/_sheet=900x600');
    expect(d.notice).toBeUndefined();
    expect(d.sheet).toEqual({ w: 900, h: 600 });
    expect(decodeState('#v1/closedbox/_sheet=5x5').notice).toMatch(/sheet size/);
  });
});

describe('material profiles', () => {
  it('match exact thickness + kerf only', () => {
    expect(matchMaterial(3, 0.2)?.id).toBe('ply3');
    expect(matchMaterial(3, 0.18)?.id).toBe('acrylic3');
    expect(matchMaterial(3, 0.1)).toBeNull(); // the app default reads as Custom
    expect(matchMaterial(3.0000000001, 0.16)?.id).toBe('mdf3');
    expect(matchMaterial(undefined, 0.2)).toBeNull();
    expect(matchMaterial('3', 0.2)).toBeNull();
  });

  it('are unambiguous', () => {
    const keys = LASER_MATERIALS.map((m) => `${m.thickness}/${m.kerf}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('round-trip through the URL as plain thickness/kerf params', () => {
    for (const m of LASER_MATERIALS) {
      const base = defaultState();
      const st = { ...base, params: { ...base.params, thickness: m.thickness, kerf: m.kerf } };
      const d = decodeState(`#${encodeState(st)}`);
      expect(matchMaterial(d.params.thickness, d.params.kerf)?.id).toBe(m.id);
    }
  });

  it('switch the 3D look only when the current material does not already read as it', () => {
    expect(material3dFor('acrylic', 'birch')).toBe('acrylic');
    expect(material3dFor('plywood', 'walnut')).toBe('walnut');
    expect(material3dFor('plywood', 'acrylic')).toBe('birch');
    expect(material3dFor('mdf', null)).toBe('mdf');
    expect(material3dFor('plywood', 'metal')).toBe('birch');
  });
});
