import { describe, expect, it } from 'vitest';
import type { Layout } from '../../src/app/export/layout';
import { toDXF } from '../../src/app/export/dxf';
import { nest } from '../../src/app/export/nest';
import { toSVG } from '../../src/app/export/svg';
import type { Path } from '../../src/core/geometry';
import { testPart } from './helpers';

type Ent = { type: string; layer: string; v: Record<number, number> };

/** Parse the ENTITIES section into entities keyed by group code (numeric codes only). */
function entities(dxf: string): Ent[] {
  const lines = dxf.split('\n');
  expect(lines.length % 2).toBe(1); // pairs + trailing '' after final newline? see EOF test
  const out: Ent[] = [];
  let inEnt = false;
  let cur: Ent | null = null;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]);
    const val = lines[i + 1]!.trim();
    if (code === 0 && val === 'EOF') break;
    if (code === 2 && val === 'ENTITIES') inEnt = true;
    if (!inEnt) continue;
    if (code === 0) {
      cur = null;
      if (val === 'ENDSEC') {
        inEnt = false;
        continue;
      }
      cur = { type: val, layer: '', v: {} };
      out.push(cur);
    } else if (cur) {
      if (code === 8) cur.layer = val;
      else cur.v[code] = Number(val);
    }
  }
  return out;
}

const quarter = (ccw: boolean): Path =>
  ccw
    ? {
        start: { x: 0, y: 0 },
        closed: true,
        segs: [
          { t: 'L', to: { x: 10, y: 0 } },
          { t: 'A', to: { x: 0, y: 10 }, c: { x: 0, y: 0 }, ccw: true },
          { t: 'L', to: { x: 0, y: 0 } },
        ],
      }
    : {
        start: { x: 0, y: 0 },
        closed: true,
        segs: [
          { t: 'L', to: { x: 0, y: 10 } },
          { t: 'A', to: { x: 10, y: 0 }, c: { x: 0, y: 0 }, ccw: false },
          { t: 'L', to: { x: 0, y: 0 } },
        ],
      };

const one = (part: ReturnType<typeof testPart>, rot: 0 | 90, x = 0, y = 0): Layout => ({
  placed: [{ part, x, y, rot, sheet: 0 }],
  unfit: [],
  sheet: { w: 100, h: 100 },
  sheets: 1,
});

describe('toDXF', () => {
  const parts = [
    testPart('a', 40, 30, { holes: [quarter(true)], engrave: [testPart('e', 5, 5).outline] }),
    testPart('b', 20, 20),
    testPart('c', 60, 10),
  ];
  const layout = nest(parts, null, 2);

  it('is R12 ASCII with header, both layers, and ends with EOF', () => {
    const dxf = toDXF(layout);
    expect(dxf.endsWith('0\nEOF\n')).toBe(true);
    expect(dxf).toContain('9\n$ACADVER\n1\nAC1009\n');
    expect(dxf).toContain('9\n$INSUNITS\n70\n4\n');
    expect(dxf).toMatch(/0\nLAYER\n2\nCUT\n70\n0\n62\n1\n/);
    expect(dxf).toMatch(/0\nLAYER\n2\nENGRAVE\n70\n0\n62\n5\n/);
    expect(dxf.indexOf('TABLES')).toBeLessThan(dxf.indexOf('ENTITIES'));
    expect(toDXF(layout, { units: 'in' })).toContain('9\n$INSUNITS\n70\n1\n');
  });

  it('emits one entity per segment, on the right layers', () => {
    const ents = entities(toDXF(layout));
    const segs = (c: Path): number => c.segs.length;
    const cut = parts.reduce((n, p) => n + [p.outline, ...p.holes].reduce((m, c) => m + segs(c), 0), 0);
    const eng = parts.reduce((n, p) => n + p.engrave.reduce((m, c) => m + segs(c), 0), 0);
    expect(ents.filter((e) => e.layer === 'CUT')).toHaveLength(cut);
    expect(ents.filter((e) => e.layer === 'ENGRAVE')).toHaveLength(eng);
    expect(ents.every((e) => e.type === 'LINE' || e.type === 'ARC')).toBe(true);
    expect(ents.filter((e) => e.type === 'ARC')).toHaveLength(1);
  });

  it('mirror (outer face up) turns a ccw arc cw, so angles are swapped: rot 0', () => {
    // Quarter pie centred at the origin, mirrored x: arc runs (-10,0) -> (0,10) clockwise,
    // i.e. ccw from 90 deg to 180 deg. Bounds x -10..0 so the placement shifts x by +10.
    const [arc] = entities(toDXF(one(testPart('q', 10, 10, { outline: quarter(true) }), 0))).filter((e) => e.type === 'ARC');
    expect(arc!.layer).toBe('CUT');
    expect([arc!.v[10], arc!.v[20], arc!.v[40]]).toEqual([10, 0, 10]);
    expect(arc!.v[50]).toBeCloseTo(90, 6);
    expect(arc!.v[51]).toBeCloseTo(180, 6);
  });

  it('mirror + rot 90 at an offset: hand-derived angles', () => {
    // (x,y) -> mirror (-x,y) -> rot90 (-y,-x) -> shift by (+10,+10) + placement (5,7) = (15,17).
    // centre (15,17); arc start (10,0)->(15,7) = 270 deg, end (0,10)->(5,17) = 180 deg; the
    // path is clockwise (mirror flips), so DXF (ccw) start=180, end=270.
    const dxf = toDXF(one(testPart('q', 10, 10, { outline: quarter(true) }), 90, 5, 7));
    const arc = entities(dxf).find((e) => e.type === 'ARC')!;
    expect([arc.v[10], arc.v[20], arc.v[40]]).toEqual([15, 17, 10]);
    expect(arc.v[50]).toBeCloseTo(180, 6);
    expect(arc.v[51]).toBeCloseTo(270, 6);
  });

  it('a cw source arc becomes ccw after the mirror: angles are not swapped', () => {
    // cw arc (0,10)->(10,0) about origin; mirror -> (0,10)->(-10,0), now ccw 90 -> 180.
    const arc = entities(toDXF(one(testPart('q', 10, 10, { outline: quarter(false) }), 0))).find((e) => e.type === 'ARC')!;
    expect(arc.v[50]).toBeCloseTo(90, 6);
    expect(arc.v[51]).toBeCloseTo(180, 6);
  });

  it('full circles are written as two half ARCs', () => {
    const circle: Path = { start: { x: 5, y: 0 }, closed: true, segs: [{ t: 'A', to: { x: 5, y: 0 }, c: { x: 0, y: 0 }, ccw: true }] };
    const arcs = entities(toDXF(one(testPart('c', 10, 10, { holes: [circle] }), 0))).filter((e) => e.type === 'ARC');
    expect(arcs).toHaveLength(2);
    const sweeps = arcs.map((a) => (((a.v[51]! - a.v[50]!) % 360) + 360) % 360);
    expect(sweeps[0]).toBeCloseTo(180, 6);
    expect(sweeps[1]).toBeCloseTo(180, 6);
  });

  it('round-trips: DXF extents equal the SVG layout extents (y flipped back)', () => {
    // Compare the CUT-geometry bounding box of the whole sheet. DXF is y up; the SVG is y down
    // with y = sheet.h - y_dxf, so SVG y extents are mapped back before comparing.
    const plain = nest([testPart('a', 40, 30), testPart('b', 20, 20), testPart('c', 60, 10)], null, 2);
    const dxf = entities(toDXF(plain)).filter((e) => e.layer === 'CUT');
    const xs: number[] = [];
    const ys: number[] = [];
    for (const e of dxf) {
      xs.push(e.v[10]!, ...(e.type === 'LINE' ? [e.v[11]!] : []));
      ys.push(e.v[20]!, ...(e.type === 'LINE' ? [e.v[21]!] : []));
    }
    const svg = toSVG(plain, { units: 'mm', stroke: 'cut' });
    const sx: number[] = [];
    const sy: number[] = [];
    for (const m of svg.matchAll(/ d="([^"]*)"/g)) {
      for (const pt of m[1]!.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
        sx.push(Number(pt[1]));
        sy.push(plain.sheet.h - Number(pt[2]));
      }
    }
    // Rectangles only (no arcs), so every number pair in the SVG path data is a point.
    expect(Math.min(...xs)).toBeCloseTo(Math.min(...sx), 3);
    expect(Math.max(...xs)).toBeCloseTo(Math.max(...sx), 3);
    expect(Math.min(...ys)).toBeCloseTo(Math.min(...sy), 3);
    expect(Math.max(...ys)).toBeCloseTo(Math.max(...sy), 3);
  });

  it('inch export scales every coordinate by exactly 1/25.4', () => {
    const a = entities(toDXF(layout, { units: 'mm' }));
    const b = entities(toDXF(layout, { units: 'in' }));
    expect(b).toHaveLength(a.length);
    a.forEach((e, i) => {
      for (const code of [10, 20, 11, 21, 40]) {
        if (e.v[code] !== undefined) expect(b[i]!.v[code]!).toBeCloseTo(e.v[code]! / 25.4, 6);
      }
      if (e.type === 'ARC') expect(b[i]!.v[50]).toBeCloseTo(e.v[50]!, 6);
    });
  });

  it('exports only the requested sheet', () => {
    const two: Layout = {
      placed: [
        { part: testPart('s0', 10, 10), x: 0, y: 0, rot: 0, sheet: 0 },
        { part: testPart('s1', 10, 10), x: 0, y: 0, rot: 0, sheet: 1 },
      ],
      unfit: [],
      sheet: { w: 20, h: 20 },
      sheets: 2,
    };
    expect(entities(toDXF(two, { sheetIndex: 1 }))).toHaveLength(4);
    expect(entities(toDXF(two))).toHaveLength(4);
  });

  it('throws on non-finite coordinates', () => {
    const bad = testPart('x', 10, 10, { outline: { start: { x: NaN, y: 0 }, closed: false, segs: [{ t: 'L', to: { x: 1, y: 1 } }] } });
    expect(() => toDXF(one(bad, 0))).toThrow(RangeError);
  });
});
