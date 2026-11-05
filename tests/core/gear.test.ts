import { describe, expect, it } from 'vitest';
import { bore, centreDistance, rackOutline, drawnHalfAngle, gearDims, gearOutline, halfToothAngle, involute, minFlankSegment, ringHole, rootRadius, type GearSpec } from '../../src/core/gear';
import { applyKerf } from '../../src/core/part';
import { area, bounds, flatten, isSimple, mat3Multiply, mat3Rotate, mat3Translate, transform, type Vec2 } from '../../src/core/geometry';

const rect = { start: { x: -1000, y: -1000 }, closed: true, segs: [{ t: 'L' as const, to: { x: 1000, y: -1000 } }, { t: 'L' as const, to: { x: 1000, y: 1000 } }, { t: 'L' as const, to: { x: -1000, y: 1000 } }, { t: 'L' as const, to: { x: -1000, y: -1000 } }] };
const spec = (teeth: number, module = 2, pressureAngle = 20, backlash = 0): GearSpec => ({ module, teeth, pressureAngle, backlash });

const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(a, b, c); const d2 = cross(a, b, d); const d3 = cross(c, d, a); const d4 = cross(c, d, b);
  return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}
function inside(p: Vec2, r: Vec2[]): boolean {
  let odd = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!; const b = r[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
  }
  return odd;
}
/** The two closed polygons overlap (edges cross or a vertex of one is inside the other). */
function overlap(A: Vec2[], B: Vec2[]): boolean {
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++)
    if (segsCross(A[i]!, A[(i + 1) % A.length]!, B[j]!, B[(j + 1) % B.length]!)) return true;
  return A.some((p) => inside(p, B)) || B.some((p) => inside(p, A));
}

/** Gear 2 placed as the generator does: at the centre distance, turned so a gap faces gear 1. */
function pair(z1: number, z2: number, m: number, a: number, b: number, turn = 0, kerf = 0): [Vec2[], Vec2[]] {
  const g1 = flatten(transform(gearOutline(spec(z1, m, a, b), 24, kerf), mat3Rotate(turn * (360 / z1))));
  const t = mat3Multiply(mat3Translate(centreDistance(m, z1, z2), 0), mat3Rotate(180 - 180 / z2 - (turn * (360 / z1) * z1) / z2));
  return [g1, flatten(transform(gearOutline(spec(z2, m, a, b), 24, kerf), t))];
}

describe('involute gears', () => {
  it('standard dimensions and centre distance', () => {
    const d = gearDims(spec(20, 2));
    expect(d.r).toBeCloseTo(20, 12);
    expect(d.ra).toBeCloseTo(22, 12);
    expect(d.rf).toBeCloseTo(17.5, 12);
    expect(d.rb).toBeCloseTo(20 * Math.cos(Math.PI / 9), 12);
    expect(centreDistance(2, 15, 30)).toBe(45);
    expect(involute(0)).toBe(0);
  });

  it('tooth thickness on the pitch circle is pi m / 2 less half the backlash', () => {
    for (const b of [0, 0.1, 0.3]) {
      const g = spec(24, 3, 20, b);
      const r = gearDims(g).r;
      expect(2 * halfToothAngle(g, r) * r).toBeCloseTo((Math.PI * 3) / 2 - b / 2, 9);
      // the drawn tooth matches the involute above the undercut
      expect(drawnHalfAngle(g, r)).toBeCloseTo(halfToothAngle(g, r), 9);
    }
  });

  it('outline: simple, CCW, z teeth, tip radius ra', () => {
    for (const z of [6, 8, 12, 17, 40, 101]) {
      const g = spec(z, 1.5);
      const o = gearOutline(g);
      expect(isSimple(o)).toBe(true);
      expect(area(o)).toBeGreaterThan(0);
      const tips = o.segs.filter((s, i) => s.t === 'A' && i % 2 === 1);
      expect(tips.length).toBeGreaterThanOrEqual(z);
      const rmax = Math.max(...flatten(o).map((q) => Math.hypot(q.x, q.y)));
      expect(rmax).toBeCloseTo(gearDims(g).ra, 6);
      expect(bounds(o).max.x).toBeCloseTo(gearDims(g).ra, 6); // tooth 0 on +x
    }
  });

  it('meshing pairs never overlap, through a tooth pitch of rotation, even small pinions', () => {
    for (const [z1, z2, a] of [[8, 20, 20], [6, 30, 25], [12, 12, 14.5], [17, 50, 20], [10, 108, 18.5]] as const)
      for (const b of [0, 0.1])
        for (const turn of [0, 0.25, 0.5, 0.75]) {
          const [A, B] = pair(z1, z2, 2, a, b, turn);
          expect(overlap(A, B), `z ${z1}/${z2} alpha ${a} backlash ${b} turn ${turn}`).toBe(false);
        }
  });

  it('kerf: outlines survive kerf compensation from module 0.5 to 3, 6 to 150 teeth, kerf 0 to 0.3', () => {
    let built = 0;
    for (const m of [0.5, 0.8, 1, 1.5, 2, 3])
      for (const z of [6, 7, 8, 10, 12, 17, 20, 30, 40, 42, 48, 60, 100, 150])
        for (const kerf of [0, 0.1, 0.2, 0.3]) {
          const g = spec(z, m, 20, 0.1);
          const o = gearOutline(g, 24, kerf);
          expect(() => applyKerf(o, [], kerf), `m ${m} z ${z} kerf ${kerf}`).not.toThrow();
          built++;
        }
    expect(built).toBe(6 * 14 * 4);
    // Ring gears (holes, offset inwards) too.
    for (const m of [0.5, 1, 2, 3]) for (const z of [30, 48, 100, 150]) for (const kerf of [0.1, 0.3])
      expect(() => applyKerf(rect, [ringHole(spec(z, m, 20, 0.1))], kerf), `ring m ${m} z ${z} kerf ${kerf}`).not.toThrow();
  });

  it('kerf: flank segments stay at least minFlankSegment long and the root is raised only for narrow gaps', () => {
    for (const [m, z] of [[1, 48], [2, 60], [0.5, 150]] as const) {
      const o = gearOutline(spec(z, m, 20, 0.1));
      // The flank segments at the sharp root corners: the first one up from the root and the last
      // one down to the closing root arc.
      const n = o.segs.length;
      const len = (i: number): number => { const a = i === 0 ? o.start : o.segs[i - 1]!.to; return Math.hypot(o.segs[i]!.to.x - a.x, o.segs[i]!.to.y - a.y); };
      expect(o.segs[0]!.t).toBe('L');
      expect(len(0)).toBeGreaterThanOrEqual(minFlankSegment(m) - 1e-9);
      expect(o.segs[n - 2]!.t).toBe('L');
      expect(len(n - 2)).toBeGreaterThanOrEqual(minFlankSegment(m) - 1e-9);
    }
    const g = spec(10, 0.5, 20, 0.1);
    expect(rootRadius(g, 0)).toBe(gearDims(g).rf);
    expect(rootRadius(g, 0.3)).toBeGreaterThan(gearDims(g).rf);
    expect(rootRadius(g, 0.3)).toBeLessThan(gearDims(g).rf + 0.25 * 0.5);
    expect(rootRadius(spec(40, 2), 0.3)).toBe(gearDims(spec(40, 2)).rf);
  });

  it('meshing pairs cut with kerf (raised roots) never overlap', () => {
    for (const [z1, z2] of [[6, 30], [10, 40], [17, 50]] as const)
      for (const turn of [0, 0.25, 0.5, 0.75]) {
        const [A, B] = pair(z1, z2, 0.5, 20, 0.1, turn, 0.3);
        expect(overlap(A, B), `z ${z1}/${z2} turn ${turn}`).toBe(false);
      }
  });

  it('a rack meshes with gears of the same module without overlap, shifted by a fraction of a pitch', () => {
    for (const [z, a] of [[8, 20], [12, 20], [30, 25], [15, 14.5]] as const)
      for (const b of [0, 0.1])
        for (const frac of [0, 0.3, 0.5]) {
          const m = 2;
          const r = (m * z) / 2;
          // Turn the gear by frac of a tooth; the rack moves r * angle along.
          const turn = (frac * 360) / z;
          const G = flatten(transform(gearOutline(spec(z, m, a, b)), mat3Rotate(turn)));
          const k = Math.round(-z / 4);
          const s = r * ((2 * Math.PI * k) / z + Math.PI / 2) + (r * turn * Math.PI) / 180;
          const R = flatten(rackOutline({ module: m, pressureAngle: a, backlash: b }, -60, 60, -r, s, 5));
          expect(overlap(G, R), `z ${z} alpha ${a} backlash ${b} frac ${frac}`).toBe(false);
        }
  });

  it('bores: round, D with a 0.1 d flat, hex across flats', () => {
    expect(bore('none', 5)).toBeUndefined();
    const r = bounds(bore('round', 6)!);
    expect(r.max.x - r.min.x).toBeCloseTo(6, 9);
    const d = bounds(bore('d', 5)!);
    expect(d.max.x).toBeCloseTo(2, 9); // flat at 0.8 r
    expect(d.min.x).toBeCloseTo(-2.5, 9);
    const h = bounds(bore('hex', 8)!);
    expect(h.max.y - h.min.y).toBeCloseTo(8, 9);
  });
});
