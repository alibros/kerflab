/** SVG export of a nested layout: kerfed cut geometry in red, engraving in blue, OUTER face up. */
import { mat3Multiply as mul, transform, type Mat3, type Path, type Vec2 } from '../../core/geometry';
import { placeMatrix, type Layout } from './layout';

export type SvgOptions = {
  units: 'mm' | 'in';
  /** Layer to write: cut lines, engraving, or (default) both. */
  stroke?: 'cut' | 'engrave' | 'both';
  /**
   * Which sheet to export (0-based, default 0). One SVG per sheet: call once per index in
   * `0 .. layout.sheets - 1`. Sheets are not laid side by side.
   */
  sheetIndex?: number;
};

const CUT = '#ff0000';
const ENGRAVE = '#0000ff';
/**
 * Hairline stroke. Epilog and Trotec print-driver workflows only vector-cut strokes this thin
 * (thicker ones raster-engrave), and LightBurn and the like ignore the width. The in-app 2D view
 * sets its own screen-pixel strokes in CSS, so this only affects the exported file.
 */
const HAIRLINE_MM = 0.01;
const TAU = Math.PI * 2;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function num(v: number, digits: number): string {
  if (!Number.isFinite(v)) throw new RangeError(`SVG export: non-finite coordinate ${v}`);
  const s = v.toFixed(digits);
  const t = s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  return t === '-0' || t === '' ? '0' : t;
}

/** Path data for a path already in final SVG coordinates. Arcs stay arcs. */
function pathData(p: Path, f: (v: number) => string): string {
  const pt = (v: Vec2): string => `${f(v.x)} ${f(v.y)}`;
  let d = `M${pt(p.start)}`;
  let cur = p.start;
  for (const s of p.segs) {
    if (s.t === 'L') d += `L${pt(s.to)}`;
    else {
      const r = Math.hypot(cur.x - s.c.x, cur.y - s.c.y);
      const a0 = Math.atan2(cur.y - s.c.y, cur.x - s.c.x);
      const a1 = Math.atan2(s.to.y - s.c.y, s.to.x - s.c.x);
      let sw = s.ccw ? a1 - a0 : a0 - a1;
      sw = ((sw % TAU) + TAU) % TAU;
      if (sw < 1e-9) sw = TAU;
      // Same numeric coordinates, y down: an increasing angle is SVG sweep-flag 1.
      const sweep = s.ccw ? 1 : 0;
      const arc = (to: Vec2, large: boolean): string => `A${f(r)} ${f(r)} 0 ${large ? 1 : 0} ${sweep} ${pt(to)}`;
      if (sw > TAU - 1e-9) {
        // A full circle has coincident endpoints, which SVG cannot express: split it in two.
        d += arc({ x: 2 * s.c.x - cur.x, y: 2 * s.c.y - cur.y }, false) + arc(s.to, false);
      } else d += arc(s.to, sw > Math.PI);
    }
    cur = s.to;
  }
  return p.closed ? `${d}Z` : d;
}

export function toSVG(layout: Layout, opts: SvgOptions): string {
  const inch = opts.units === 'in';
  const k = inch ? 1 / 25.4 : 1;
  const digits = inch ? 6 : 4;
  const f = (v: number): string => num(v, digits);
  const layer = opts.stroke ?? 'both';
  const { w, h } = layout.sheet;
  const stroke = f(HAIRLINE_MM * k);
  const sheetIndex = opts.sheetIndex ?? 0;
  if (!(Number.isInteger(sheetIndex) && sheetIndex >= 0 && sheetIndex < Math.max(layout.sheets, 1)))
    throw new RangeError(`SVG export: sheetIndex ${sheetIndex} out of range (layout has ${layout.sheets} sheet(s))`);
  // Pad by half the stroke width so hairlines on the sheet edge are not clipped.
  const pad = (HAIRLINE_MM / 2) * k;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w * k + 2 * pad)}${opts.units}" height="${f(h * k + 2 * pad)}${opts.units}" viewBox="${f(-pad)} ${f(-pad)} ${f(w * k + 2 * pad)} ${f(h * k + 2 * pad)}">`,
  ];
  // sheet (y up, mm) -> SVG (y down, units)
  const toSvg: Mat3 = [k, 0, 0, 0, -k, k * h, 0, 0, 1];
  for (const p of layout.placed.filter((q) => q.sheet === sheetIndex)) {
    const m = mul(toSvg, placeMatrix(p));
    out.push(`<g id="part-${esc(p.part.id)}" fill="none" stroke-width="${stroke}">`);
    if (layer !== 'engrave') {
      const d = [p.part.outline, ...p.part.holes].map((c) => pathData(transform(c, m), f)).join('');
      out.push(`<path stroke="${CUT}" d="${d}"/>`);
    }
    if (layer !== 'cut' && p.part.engrave.length) {
      const d = p.part.engrave.map((c) => pathData(transform(c, m), f)).join('');
      out.push(`<path stroke="${ENGRAVE}" d="${d}"/>`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}
