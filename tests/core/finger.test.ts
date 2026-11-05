import { describe, expect, it } from 'vitest';
import { Turtle } from '../../src/core/turtle';
import {
  area, bounds, isSimple, mat3Multiply, mat3Rotate, mat3Translate, offsetPath, transform, type Path, type Vec2,
} from '../../src/core/geometry';
import { ParamError } from '../../src/core/validate';
import type { Edge, EdgeCtx } from '../../src/core/edges/types';
import { fingerCount, fingerHoleEdge, fingerHolesFor, fingerJoint, fingerLayout } from '../../src/core/edges/finger';

/** mulberry32: small seeded PRNG so property tests are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ctxFor = (thickness: number, over: Partial<EdgeCtx> = {}): EdgeCtx => ({
  thickness, kerf: 0, finger: 2 * thickness, space: 2 * thickness, surroundingSpaces: 2, play: 0, ...over,
});

type Case = { length: number; ctx: EdgeCtx };
function cases(seed: number, n: number): Case[] {
  const r = prng(seed);
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const thickness = 2 + r() * 8;
    const length = 20 + r() * 480;
    if (length < 3 * thickness) continue;
    out.push({
      length,
      ctx: ctxFor(thickness, {
        finger: thickness * (1 + r() * 2),
        space: thickness * (1 + r() * 2),
        surroundingSpaces: 0.5 + r() * 2.5,
        play: r() < 0.3 ? 0 : r() * 0.3,
        kerf: r() * 0.3,
      }),
    });
  }
  return out;
}

/** Part outline: the edge along +x from (0,0), then a box of height h on the left (+y) side. */
function partOutline(edge: Edge, length: number, ctx: EdgeCtx, h: number): Path {
  const t = new Turtle();
  edge(t, length, ctx);
  t.turn(90); t.forward(h); t.turn(90); t.forward(length); t.turn(90); t.forward(h); t.turn(90);
  return t.toPath(true);
}

/** Inside intervals of a closed polyline along the horizontal line y. */
function scan(p: Path, y: number): [number, number][] {
  const pts: Vec2[] = [p.start, ...p.segs.map((s) => s.to)];
  const xs: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((u, v) => u - v);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!]);
  return out;
}

const EPS = 1e-6;

describe('fingerCount', () => {
  it('matches boxes.py calcFingers on known values', () => {
    // t=3, finger=space=6, surroundingspaces=2: floor((100-6)/12)=7, leftover=100-7*12+6=22
    expect(fingerCount(100, ctxFor(3))).toEqual({ fingers: 7, leftover: 22 });
    // t=4, finger=space=8: floor((13-8)/16)=0 but 13 > finger+t -> 1 finger; leftover = 13-16+8 = 5
    expect(fingerCount(13, ctxFor(4))).toEqual({ fingers: 1, leftover: 5 });
    // exactly 3t with finger=2t: calcFingers gives 0, so boxes.py draws one small finger of
    // width leftover/2 = 6 and margins of 3: the DRAWN count is reported.
    expect(fingerCount(12, ctxFor(4))).toEqual({ fingers: 1, leftover: 6 });
    expect(fingerLayout(12, ctxFor(4))).toEqual({ fingers: 1, finger: 6, space: 8, margin: 3 });
    expect(fingerLayout(100, ctxFor(3))).toEqual({ fingers: 7, finger: 6, space: 6, margin: 11 });
  });

  it('is deterministic and integer', () => {
    for (const { length, ctx } of cases(1, 200)) {
      const a = fingerCount(length, ctx);
      const b = fingerCount(length, { ...ctx });
      expect(a).toEqual(b);
      expect(Number.isInteger(a.fingers)).toBe(true);
      expect(a.fingers).toBeGreaterThanOrEqual(0);
      const l = fingerLayout(length, ctx);
      expect(a.fingers).toBe(l.fingers);
      expect(a.leftover).toBeCloseTo(2 * l.margin, 12);
      if (l.fingers > 0)
        expect(2 * l.margin + l.fingers * l.finger + (l.fingers - 1) * l.space).toBeCloseTo(length, 9);
    }
  });

  it('throws ParamError below 3*thickness', () => {
    const r = prng(7);
    for (let i = 0; i < 50; i++) {
      const thickness = 2 + r() * 8;
      const length = r() * 3 * thickness * 0.999;
      const ctx = ctxFor(thickness);
      expect(() => fingerCount(length, ctx)).toThrow(ParamError);
      expect(() => fingerCount(length, ctx)).toThrow('too short for finger joint');
      expect(() => fingerJoint(new Turtle(), length, ctx)).toThrow(ParamError);
      expect(() => fingerHoleEdge(new Turtle(), length, ctx)).toThrow(ParamError);
      expect(() => fingerHolesFor(length, ctx)).toThrow(ParamError);
    }
  });

  it('rejects invalid settings with ParamError', () => {
    expect(() => fingerCount(100, ctxFor(3, { finger: 2 }))).toThrow(ParamError);
    expect(() => fingerCount(100, ctxFor(3, { play: -0.1 }))).toThrow(ParamError);
    expect(() => fingerCount(100, ctxFor(3, { play: 6 }))).toThrow(ParamError);
    expect(() => fingerCount(100, ctxFor(3, { kerf: -1 }))).toThrow(ParamError);
    expect(() => fingerCount(100, ctxFor(0))).toThrow(ParamError);
    expect(() => fingerCount(Number.NaN, ctxFor(3))).toThrow(ParamError);
    // non-default ctx values
    const odd = { finger: 7.5, space: 4.5, surroundingSpaces: 1.5, play: 0.2, kerf: 0.1 };
    expect(() => fingerLayout(100, ctxFor(3, odd))).not.toThrow();
    expect(() => fingerCount(100, ctxFor(3, { ...odd, surroundingSpaces: -0.5 }))).toThrow(ParamError);
    expect(() => fingerLayout(100, ctxFor(3, { ...odd, surroundingSpaces: -0.01 }))).toThrow(ParamError);
    expect(() => fingerCount(100, ctxFor(3, { ...odd, play: 4.5 }))).toThrow(ParamError); // space == play
    expect(() => fingerLayout(100, ctxFor(3, { ...odd, space: 0.15 }))).toThrow(ParamError); // space < play
  });
});

describe('finger joint edges', () => {
  it('end at the same point and heading as a plain edge', () => {
    const r = prng(2);
    for (const { length, ctx } of cases(2, 300)) {
      for (const edge of [fingerJoint, fingerHoleEdge]) {
        const start = { x: r() * 100 - 50, y: r() * 100 - 50 };
        const heading = r() * 360;
        const t = new Turtle(start, heading);
        edge(t, length, ctx);
        const h = (heading * Math.PI) / 180;
        expect(Math.abs(t.pos.x - (start.x + length * Math.cos(h)))).toBeLessThan(EPS);
        expect(Math.abs(t.pos.y - (start.y + length * Math.sin(h)))).toBeLessThan(EPS);
        expect(Math.abs(t.heading - heading)).toBeLessThan(EPS);
      }
    }
  });

  it('tile with their complement: no overlap, gap = play per finger, fingers >= thickness', () => {
    for (const { length, ctx } of cases(3, 300)) {
      const t = ctx.thickness;
      const H = 2 * t + 5;
      const a = partOutline(fingerJoint, length, ctx, H);
      // The mating part faces the other way: rotate its local outline 180 deg about the joint midline.
      const b = transform(partOutline(fingerHoleEdge, length, ctx, H), mat3Multiply(mat3Translate(length, 0), mat3Rotate(180)));
      expect(isSimple(a)).toBe(true);
      expect(isSimple(b)).toBe(true);
      expect(area(a)).toBeGreaterThan(0);

      const { fingers } = fingerCount(length, ctx);
      if (fingers > 0) {
        expect(bounds(a).min.y).toBeCloseTo(-t, 9); // fingers protrude exactly one thickness
        expect(bounds(b).max.y).toBeCloseTo(0, 9);
      }

      for (const frac of [0.05, 0.5, 0.95]) {
        const y = -t * frac;
        const ia = scan(a, y).map((iv) => ({ iv, who: 'A' }));
        const ib = scan(b, y).map((iv) => ({ iv, who: 'B' }));
        const all = [...ia, ...ib].sort((u, v) => u.iv[0] - v.iv[0]);
        // whole joint strip [0, length] is spanned, starting and ending with the notched part
        expect(all[0]!.iv[0]).toBeCloseTo(0, 9);
        expect(all[all.length - 1]!.iv[1]).toBeCloseTo(length, 9);
        expect(all[0]!.who).toBe('B');
        expect(all[all.length - 1]!.who).toBe('B');
        let totalGap = 0;
        for (let i = 0; i + 1 < all.length; i++) {
          const cur = all[i]!;
          const nxt = all[i + 1]!;
          expect(cur.who).not.toBe(nxt.who); // alternate finger / tooth
          const gap = nxt.iv[0] - cur.iv[1];
          expect(gap).toBeGreaterThan(-EPS); // no overlap
          expect(Math.abs(gap - ctx.play / 2)).toBeLessThan(EPS); // play split evenly to both sides
          totalGap += gap;
        }
        for (const { iv } of ia) expect(iv[1] - iv[0]).toBeGreaterThanOrEqual(t - EPS);
        if (ia.length > 0) expect(Math.abs(totalGap - ia.length * ctx.play)).toBeLessThan(EPS * all.length);
      }
    }
  });

  it('number of drawn fingers equals fingerCount and fingerLayout exactly', () => {
    const r = prng(8);
    const fallback: Case[] = [];
    for (let i = 0; i < 100; i++) {
      // lengths in [3t, finger+t]: calcFingers gives 0, boxes.py draws one small fallback finger
      const t = 2 + r() * 8;
      fallback.push({ length: 3 * t + r() * t, ctx: ctxFor(t, { finger: 3 * t, play: r() * 0.3 }) });
    }
    let fallbackSeen = 0;
    for (const { length, ctx } of [...cases(4, 200), ...fallback]) {
      const { fingers } = fingerCount(length, ctx);
      expect(fingers).toBe(fingerLayout(length, ctx).fingers);
      const a = partOutline(fingerJoint, length, ctx, 3 * ctx.thickness);
      expect(scan(a, -ctx.thickness / 2).length).toBe(fingers);
      expect(fingerHolesFor(length, ctx).length).toBe(fingers);
      if (fingerLayout(length, ctx).finger !== ctx.finger) fallbackSeen++;
    }
    expect(fallbackSeen).toBeGreaterThan(50);
  });

  it('outlines survive a kerf/2 outward offset (part-level kerf compensation)', () => {
    for (const { length, ctx } of cases(5, 25)) {
      const a = partOutline(fingerJoint, length, ctx, 2 * ctx.thickness);
      const b = partOutline(fingerHoleEdge, length, ctx, 2 * ctx.thickness);
      const k = Math.max(ctx.kerf, 0.05) / 2;
      const ao = offsetPath(a, k);
      const bo = offsetPath(b, k);
      // fingers widen by kerf, notches narrow by kerf: cutting removes kerf/2 per side, restoring nominal.
      const wa = scan(a, -ctx.thickness / 2).map(([u, v]) => v - u);
      const wao = scan(ao, -ctx.thickness / 2).map(([u, v]) => v - u);
      expect(wao.length).toBe(wa.length);
      wa.forEach((w, i) => expect(wao[i]! - w).toBeCloseTo(2 * k, 9));
      expect(bounds(bo).min.y).toBeCloseTo(-k, 9);
    }
  });
});

describe('fingerHolesFor', () => {
  it('produces one slot per finger, aligned with the fingers, sized finger+play by thickness+play', () => {
    for (const { length, ctx } of cases(6, 200)) {
      const holes = fingerHolesFor(length, ctx);
      const a = partOutline(fingerJoint, length, ctx, 3 * ctx.thickness);
      const fingersAt = scan(a, -ctx.thickness / 2);
      expect(holes.length).toBe(fingersAt.length);
      holes.forEach((h, i) => {
        expect(h.closed).toBe(true);
        expect(isSimple(h)).toBe(true);
        expect(area(h)).toBeGreaterThan(0);
        const bb = bounds(h);
        const [x0, x1] = fingersAt[i]!;
        expect(bb.min.x).toBeCloseTo(x0 - ctx.play / 2, 9);
        expect(bb.max.x).toBeCloseTo(x1 + ctx.play / 2, 9);
        expect(bb.min.y).toBeCloseTo(-(ctx.thickness + ctx.play) / 2, 9);
        expect(bb.max.y).toBeCloseTo((ctx.thickness + ctx.play) / 2, 9);
      });
    }
  });
});
