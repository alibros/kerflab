import { describe, expect, it } from 'vitest';
import { exportFiles } from '../../src/app/export/files';
import { toDXF } from '../../src/app/export/dxf';
import { toSVG } from '../../src/app/export/svg';
import { nest } from '../../src/app/export/nest';
import { testPart } from './helpers';

describe('exportFiles', () => {
  const layout = nest([testPart('a', 80, 80), testPart('b', 80, 80)], { w: 100, h: 100 }, 2);

  it('writes one file per sheet, suffixed when there are several', () => {
    expect(layout.sheets).toBe(2);
    expect(exportFiles('svg', layout, 'boxes-x', 'mm').map((f) => f.name)).toEqual(['boxes-x-sheet1.svg', 'boxes-x-sheet2.svg']);
    const one = nest([testPart('a', 10, 10)], { w: 100, h: 100 }, 2);
    expect(exportFiles('dxf', one, 'boxes-x', 'mm').map((f) => f.name)).toEqual(['boxes-x.dxf']);
  });

  it('DXF is always millimetres ($INSUNITS 4), even with inch display units; SVG follows the display units', () => {
    for (const units of ['mm', 'in'] as const) {
      const [dxf] = exportFiles('dxf', layout, 'b', units);
      expect(dxf!.body).toContain('9\n$INSUNITS\n70\n4\n');
      expect(dxf!.body).toBe(toDXF(layout, { units: 'mm', sheetIndex: 0 }));
      expect(exportFiles('svg', layout, 'b', units)[1]!.body).toBe(toSVG(layout, { units, sheetIndex: 1 }));
    }
  });

  it('toSVG / toDXF reject a sheetIndex outside the layout', () => {
    for (const i of [-1, 2, 0.5]) {
      expect(() => toSVG(layout, { units: 'mm', sheetIndex: i })).toThrow(RangeError);
      expect(() => toDXF(layout, { sheetIndex: i })).toThrow(RangeError);
    }
    expect(() => toSVG(nest([], null, 0), { units: 'mm' })).not.toThrow();
  });
});
