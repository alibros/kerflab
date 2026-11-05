/**
 * DXF export of a nested layout (AutoCAD R12 ASCII, AC1009): LINE and ARC entities only.
 * Layers: CUT (ACI colour 1, red) and ENGRAVE (ACI colour 5, blue). Same placement as the SVG
 * (outer face up) but DXF is y up like the sheet, so there is no y flip.
 */
import { transform, type Mat3, type Path } from '../../core/geometry';
import { placeMatrix, type Layout } from './layout';

export type DxfOptions = {
  /** Which sheet to export (0-based, default 0); one DXF per sheet. */
  sheetIndex?: number;
  /** Drawing units, default mm. */
  units?: 'mm' | 'in';
};

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const EPS = 1e-9;

function num(v: number, digits: number): string {
  if (!Number.isFinite(v)) throw new RangeError(`DXF export: non-finite coordinate ${v}`);
  const s = v.toFixed(digits);
  const t = s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  return t === '-0' || t === '' ? '0' : t;
}

const deg = (a: number): number => (((a * DEG) % 360) + 360) % 360;

export function toDXF(layout: Layout, opts: DxfOptions = {}): string {
  const inch = opts.units === 'in';
  const k = inch ? 1 / 25.4 : 1;
  const f = (v: number): string => num(v, inch ? 7 : 5);
  const sheetIndex = opts.sheetIndex ?? 0;
  if (!(Number.isInteger(sheetIndex) && sheetIndex >= 0 && sheetIndex < Math.max(layout.sheets, 1)))
    throw new RangeError(`DXF export: sheetIndex ${sheetIndex} out of range (layout has ${layout.sheets} sheet(s))`);
  const out: string[] = [];
  const g = (code: number, value: string | number): void => void out.push(String(code), String(value));

  const scale: Mat3 = [k, 0, 0, 0, k, 0, 0, 0, 1];
  const mul = (a: Mat3, b: Mat3): Mat3 => {
    const o = new Array<number>(9).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let i = 0; i < 3; i++) o[r * 3 + c]! += a[r * 3 + i]! * b[i * 3 + c]!;
    return o as Mat3;
  };

  const line = (layer: string, ax: number, ay: number, bx: number, by: number): void => {
    g(0, 'LINE');
    g(8, layer);
    g(10, f(ax));
    g(20, f(ay));
    g(30, 0);
    g(11, f(bx));
    g(21, f(by));
    g(31, 0);
  };
  /** DXF ARC is always ccw from start to end angle (degrees). */
  const arc = (layer: string, cx: number, cy: number, r: number, a0: number, a1: number): void => {
    g(0, 'ARC');
    g(8, layer);
    g(10, f(cx));
    g(20, f(cy));
    g(30, 0);
    g(40, f(r));
    g(50, f(deg(a0)));
    g(51, f(deg(a1)));
  };

  /** Path already in final (y up, output unit) coordinates. */
  const emit = (layer: string, p: Path): void => {
    let cur = p.start;
    for (const s of p.segs) {
      if (s.t === 'L') line(layer, cur.x, cur.y, s.to.x, s.to.y);
      else {
        const r = Math.hypot(cur.x - s.c.x, cur.y - s.c.y);
        const a0 = Math.atan2(cur.y - s.c.y, cur.x - s.c.x);
        const a1 = Math.atan2(s.to.y - s.c.y, s.to.x - s.c.x);
        // A clockwise path arc is the same curve as the ccw arc from its end to its start.
        const [from, to] = s.ccw ? [a0, a1] : [a1, a0];
        const sw = (((to - from) % TAU) + TAU) % TAU;
        if (sw < EPS) {
          // Coincident endpoints: a full circle. Written as two half ARCs (no CIRCLE entity,
          // so the file stays LINE/ARC only and entity count tracks segment count + 1).
          arc(layer, s.c.x, s.c.y, r, from, from + Math.PI);
          arc(layer, s.c.x, s.c.y, r, from + Math.PI, from + TAU);
        } else arc(layer, s.c.x, s.c.y, r, from, to);
      }
      cur = s.to;
    }
    // A closed path whose last segment stops short of the start gets a closing line.
    if (p.closed && Math.hypot(cur.x - p.start.x, cur.y - p.start.y) > EPS) line(layer, cur.x, cur.y, p.start.x, p.start.y);
  };

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, inch ? 1 : 4);
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 1);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  g(70, 0);
  g(3, 'Solid line');
  g(72, 65);
  g(73, 0);
  g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, 2);
  for (const [name, color] of [['CUT', 1], ['ENGRAVE', 5]] as const) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, color);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const p of layout.placed.filter((q) => q.sheet === sheetIndex)) {
    const m = mul(scale, placeMatrix(p));
    for (const c of [p.part.outline, ...p.part.holes]) emit('CUT', transform(c, m));
    for (const c of p.part.engrave) emit('ENGRAVE', transform(c, m));
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}
