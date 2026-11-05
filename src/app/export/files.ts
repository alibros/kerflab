/** The files one export writes: one per sheet, named and encoded for download. */
import { toDXF } from './dxf';
import type { Layout } from './layout';
import { toSVG } from './svg';
import type { Units } from '../units';

export type ExportFile = { name: string; body: string; type: string };

/**
 * One file per used sheet. SVG carries the display units in its width/height; DXF is always
 * written in millimetres ($INSUNITS 4), whatever the display units: laser and CAD software
 * import DXF as mm by default, and an inch DXF read as mm comes out 25.4 times too small.
 */
export function exportFiles(kind: 'svg' | 'dxf', layout: Layout, base: string, units: Units): ExportFile[] {
  return Array.from({ length: layout.sheets }, (_, i) => {
    const suffix = layout.sheets > 1 ? `-sheet${i + 1}` : '';
    return kind === 'svg'
      ? { name: `${base}${suffix}.svg`, body: toSVG(layout, { units, sheetIndex: i }), type: 'image/svg+xml' }
      : { name: `${base}${suffix}.dxf`, body: toDXF(layout, { units: 'mm', sheetIndex: i }), type: 'application/dxf' };
  });
}
