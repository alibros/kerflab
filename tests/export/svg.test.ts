import { describe, expect, it } from 'vitest';
import type { Layout } from '../../src/app/export/layout';
import { nest } from '../../src/app/export/nest';
import { toSVG } from '../../src/app/export/svg';
import type { Path } from '../../src/core/geometry';
import { testPart } from './helpers';

/** Minimal well-formedness check (no DOM in the node test env): balanced tags, quoted attributes. */
function parseXml(s: string): { tags: { name: string; attrs: Record<string, string> }[] } {
  const stack: string[] = [];
  const tags: { name: string; attrs: Record<string, string> }[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    expect(s.slice(pos, m.index).replace(/<\?xml[^>]*\?>/, '').trim()).toBe(''); // no stray markup/text
    pos = re.lastIndex;
    const [, close, name, attrStr, self] = m as unknown as [string, string, string, string, string];
    if (close) {
      expect(stack.pop()).toBe(name);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrStr.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    tags.push({ name, attrs });
    if (!self) stack.push(name);
  }
  expect(s.slice(pos).trim()).toBe('');
  expect(stack).toEqual([]);
  return { tags };
}

const nums = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);

describe('toSVG', () => {
  const parts = [testPart('a', 40, 30), testPart('b', 20, 20), testPart('c', 60, 10)];
  const layout = nest(parts, null, 2);

  it('is well-formed with one group per part and mm size matching the viewBox', () => {
    const svg = toSVG(layout, { units: 'mm', stroke: 'cut' });
    const { tags } = parseXml(svg);
    const root = tags.find((t) => t.name === 'svg')!;
    const vb = root.attrs.viewBox!.split(' ').map(Number);
    // padded by half the 0.01 mm hairline on every side so edge hairlines are not clipped
    expect(vb.slice(0, 2)).toEqual([-0.005, -0.005]);
    expect(vb[2]).toBeCloseTo(layout.sheet.w + 0.01, 4);
    expect(vb[3]).toBeCloseTo(layout.sheet.h + 0.01, 4);
    expect(root.attrs.width).toBe(`${vb[2]}mm`);
    expect(root.attrs.height).toBe(`${vb[3]}mm`);
    const groups = tags.filter((t) => t.name === 'g').map((t) => t.attrs.id);
    expect(groups.sort()).toEqual(['part-a', 'part-b', 'part-c']);
    expect(svg).toContain('stroke="#ff0000"');
    // Epilog/Trotec print drivers only vector-cut hairlines (0.01 mm or thinner)
    expect(svg).toContain('stroke-width="0.01"');
    expect(toSVG(layout, { units: 'in', stroke: 'cut' })).toContain(`stroke-width="${(0.01 / 25.4).toFixed(6)}"`);
  });

  it('inch export scales exactly 1/25.4', () => {
    const mm = parseXml(toSVG(layout, { units: 'mm', stroke: 'cut' })).tags.find((t) => t.name === 'svg')!;
    const inch = parseXml(toSVG(layout, { units: 'in', stroke: 'cut' })).tags.find((t) => t.name === 'svg')!;
    const a = mm.attrs.viewBox!.split(' ').map(Number);
    const b = inch.attrs.viewBox!.split(' ').map(Number);
    expect(b[2]! * 25.4).toBeCloseTo(a[2]!, 4);
    expect(b[3]! * 25.4).toBeCloseTo(a[3]!, 4);
    expect(inch.attrs.width).toBe(`${b[2]}in`);
    expect(inch.attrs.height).toBe(`${b[3]}in`);
    const dMm = nums(/ d="([^"]*)"/.exec(toSVG(layout, { units: 'mm', stroke: 'cut' }))![1]!);
    const dIn = nums(/ d="([^"]*)"/.exec(toSVG(layout, { units: 'in', stroke: 'cut' }))![1]!);
    dMm.forEach((v, i) => expect(dIn[i]! * 25.4).toBeCloseTo(v, 3));
  });

  it('cut geometry includes kerfed holes as extra subpaths', () => {
    const hole: Path = { start: { x: 5, y: 5 }, closed: true, segs: [
      { t: 'L', to: { x: 10, y: 5 } }, { t: 'L', to: { x: 10, y: 10 } }, { t: 'L', to: { x: 5, y: 5 } }] };
    const l = nest([testPart('h', 40, 30, { holes: [hole] })], null, 0);
    const svg = toSVG(l, { units: 'mm', stroke: 'cut' });
    expect((svg.match(/M/g) ?? []).length).toBe(2);
    expect((svg.match(/Z/g) ?? []).length).toBe(2);
  });

  it('keeps arcs as A commands with the sweep flag correct after mirroring', () => {
    // quarter arc (10,0)->(0,10) about (0,0), CCW in part-local (inside) view
    const quarter: Path = { start: { x: 10, y: 0 }, closed: false, segs: [{ t: 'A', to: { x: 0, y: 10 }, c: { x: 0, y: 0 }, ccw: true }] };
    const mk = (ccw: boolean) => nest([testPart('q', 10, 10, { engrave: [{ ...quarter, segs: [{ t: 'A', to: { x: 0, y: 10 }, c: { x: 0, y: 0 }, ccw }] }] })], null, 0);
    const arc = (ccw: boolean): number[] => {
      const svg = toSVG(mk(ccw), { units: 'mm', stroke: 'engrave' });
      expect(svg).not.toMatch(/ L/);
      const m = /A\s*([^"Z]*)/.exec(svg.slice(svg.indexOf('#0000ff')));
      return nums(m![1]!);
    };
    // A rx ry rot large sweep x y; part-local ccw -> mirror(x) -> y-down export is net a 180-degree turn: ccw stays ccw (sweep 1)
    const a = arc(true);
    expect(a.slice(0, 2)).toEqual([10, 10]);
    expect(a[3]).toBe(0); // quarter turn: not large
    expect(a[4]).toBe(1);
    expect(arc(false)[4]).toBe(0);
  });

  it('prints a full-circle arc as two half arcs', () => {
    const circle: Path = { start: { x: 5, y: 0 }, closed: true, segs: [{ t: 'A', to: { x: 5, y: 0 }, c: { x: 0, y: 0 }, ccw: true }] };
    const l = nest([testPart('c', 10, 10, { engrave: [circle] })], null, 0);
    const svg = toSVG(l, { units: 'mm', stroke: 'engrave' });
    expect((svg.match(/A/g) ?? []).length).toBe(2);
  });

  it('exports the outer face: an asymmetric engraved glyph reads un-mirrored', () => {
    // Part-local 2D is the INSIDE view. A glyph that reads as "F" from outside is drawn as a backwards F
    // here: stem at x=0, bars reaching toward -x. Top bar longer than the middle bar.
    const part = testPart('f', 20, 20, { engrave: [{ start: { x: 10, y: 2 }, closed: false, segs: [
      { t: 'L', to: { x: 10, y: 12 } }, { t: 'L', to: { x: 4, y: 12 } }] }] });
    const l = nest([part], null, 0);
    const svg = toSVG(l, { units: 'mm', stroke: 'engrave' });
    const d = nums(/stroke="#0000ff"[^>]* d="([^"]*)"|d="([^"]*)"[^>]*stroke="#0000ff"/.exec(svg)!.slice(1).find(Boolean)!);
    // foot, top of stem, end of top bar
    const [sx, sy, tx, ty, ex, ey] = d as [number, number, number, number, number, number];
    // Stem is vertical, top bar goes to the RIGHT of the stem in exported coords (reads as F)
    expect(tx).toBeCloseTo(sx, 6);
    expect(ex).toBeGreaterThan(tx);
    // SVG y grows downward: the stem top (second point) is above the stem foot (smaller y)
    expect(ty).toBeLessThan(sy);
    expect(ey).toBeCloseTo(ty, 6);
  });

  it('cut layer is red hairline, engraving blue, and stroke option selects layers', () => {
    const part = testPart('e', 20, 20, { engrave: [{ start: { x: 1, y: 1 }, closed: false, segs: [{ t: 'L', to: { x: 5, y: 5 } }] }] });
    const l = nest([part], null, 0);
    const both = toSVG(l, { units: 'mm', stroke: 'both' });
    expect(both).toContain('#ff0000');
    expect(both).toContain('#0000ff');
    expect(toSVG(l, { units: 'mm', stroke: 'cut' })).not.toContain('#0000ff');
    expect(toSVG(l, { units: 'mm', stroke: 'engrave' })).not.toContain('#ff0000');
  });

  it('escapes ids', () => {
    const l = nest([testPart('a"<b', 10, 10)], null, 0);
    parseXml(toSVG(l, { units: 'mm', stroke: 'cut' }));
  });

  it('rejects non-finite coordinates instead of printing NaN', () => {
    const bad: Path = { start: { x: 0, y: 0 }, closed: false, segs: [{ t: 'L', to: { x: NaN, y: 1 } }] };
    const l = nest([testPart('n', 10, 10, { engrave: [bad] })], null, 0);
    expect(() => toSVG(l, { units: 'mm', stroke: 'both' })).toThrow(RangeError);
  });

  it('exports only the requested sheet', () => {
    const l = nest([testPart('a', 80, 80), testPart('b', 80, 80)], { w: 100, h: 100 }, 1);
    expect(l.sheets).toBe(2);
    const s0 = toSVG(l, { units: 'mm' });
    const s1 = toSVG(l, { units: 'mm', sheetIndex: 1 });
    expect(s0.match(/<g id/g)).toHaveLength(1);
    expect(s1.match(/<g id/g)).toHaveLength(1);
    expect(s0.match(/part-(\w)/)![1]).not.toBe(s1.match(/part-(\w)/)![1]);
  });

  describe('rot 90 placement (hand-built layout)', () => {
    // Local 20x10 part. Maps (x,y) -> exported (X,Y) = (10 - y, x): mirror x, turn 90, flip y for SVG.
    const quarter: Path = { start: { x: 9, y: 5 }, closed: false, segs: [{ t: 'A', to: { x: 5, y: 9 }, c: { x: 5, y: 5 }, ccw: true }] };
    // backwards F as seen from inside: foot, top of stem, end of top bar (bar toward -x)
    const glyph: Path = { start: { x: 10, y: 2 }, closed: false, segs: [{ t: 'L', to: { x: 10, y: 8 } }, { t: 'L', to: { x: 4, y: 8 } }] };
    const part = testPart('r', 20, 10, { engrave: [quarter, glyph] });
    const layout: Layout = { placed: [{ part, x: 0, y: 0, rot: 90, sheet: 0 }], unfit: [], sheet: { w: 10, h: 20 }, sheets: 1 };
    const svg = toSVG(layout, { units: 'mm', stroke: 'engrave' });
    const d = / d="([^"]*)"/.exec(svg)![1]!;
    const [arcPart, glyphPart] = d.split(/(?=M)/) as [string, string];

    it('arc: endpoints, radius, centre-consistent sweep and not large', () => {
      const a = nums(arcPart); // M sx sy A rx ry rot large sweep ex ey
      expect(a).toEqual([5, 9, 4, 4, 0, 0, 1, 1, 5]);
      // centre (5,5) is at distance 4 from both endpoints and the arc runs start(90deg) -> end(180deg): increasing angle = sweep 1
      const [sx, sy, , , , , , ex, ey] = a as [number, number, number, number, number, number, number, number, number];
      expect(Math.hypot(sx - 5, sy - 5)).toBeCloseTo(4, 6);
      expect(Math.hypot(ex - 5, ey - 5)).toBeCloseTo(4, 6);
      expect(Math.atan2(ey - 5, ex - 5)).toBeGreaterThan(Math.atan2(sy - 5, sx - 5));
    });

    it('glyph: same chirality as the unrotated outer-face F, turned a quarter turn', () => {
      const [fx, fy, tx, ty, bx, by] = nums(glyphPart) as [number, number, number, number, number, number];
      expect([fx, fy, tx, ty, bx, by]).toEqual([8, 10, 2, 10, 2, 4]);
      // stem direction u (foot->top) and bar direction v: an F read from outside has cross(u, v) > 0 in SVG
      // coordinates (unrotated: up x right = +60). Rotation must preserve that; a mirror bug would flip it.
      const cross = (tx - fx) * (by - ty) - (ty - fy) * (bx - tx);
      expect(cross).toBeGreaterThan(0);
      // up -> left and right -> up: exactly 90 degrees counter-clockwise on screen
      expect([tx - fx, ty - fy]).toEqual([-6, 0]);
      expect([bx - tx, by - ty]).toEqual([0, -6]);
    });
  });
});
