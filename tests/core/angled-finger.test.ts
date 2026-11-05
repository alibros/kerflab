/**
 * Angled finger joints (walls meeting at a vertical corner whose exterior turn is not 90 degrees):
 * edge shapes, the corner widths, and two-wall fixtures checked by the assembly harness at many
 * angles, with and without play, plus negative fixtures (misplaced wall, wrong angle).
 */
import { describe, expect, it } from 'vitest';
import { angledFingerWidths, edgeFor } from '../../src/core/edges';
import { fingerLayout } from '../../src/core/edges/finger';
import type { EdgeCtx } from '../../src/core/edges/types';
import type { Vec2 } from '../../src/core/geometry';
import type { Part, Vec3 } from '../../src/core/part';
import { Turtle } from '../../src/core/turtle';
import { at, finishPanels, panel, rectangularWall } from '../../src/generators/walls';
import { assertAssembly, assertValidParts } from '../harness/invariants';

const T = 3;
const ctxFor = (angle: number, play = 0): EdgeCtx =>
  ({ thickness: T, kerf: 0, finger: 2 * T, space: 2 * T, surroundingSpaces: 2, play, angle });

const pts = (type: 'angledFinger' | 'angledFingerHole' | 'finger' | 'fingerHole', length: number, ctx: EdgeCtx): Vec2[] => {
  const t = new Turtle();
  edgeFor(type)(t, length, ctx);
  const p = t.toPath(false);
  return [p.start, ...p.segs.map((s) => s.to)];
};

describe('angledFingerWidths', () => {
  it('tip = t tan(a/2), base = -t cos(a) tan(a/2), depth = t sin(a); 90 degrees is the plain finger joint', () => {
    for (const a of [10, 30, 45, 60, 72, 90]) {
      const r = (a * Math.PI) / 180;
      const w = angledFingerWidths(a, T);
      expect(w.tip).toBeCloseTo(T * Math.tan(r / 2), 12);
      expect(w.base).toBeCloseTo(-T * Math.cos(r) * Math.tan(r / 2), 12);
      expect(w.depth).toBeCloseTo(T * Math.sin(r), 12);
      expect(w.base).toBeLessThanOrEqual(0);
    }
    expect(angledFingerWidths(90, T)).toEqual({ tip: T, base: 0, depth: T });
  });

  it('rejects acute corners and nonsense angles', () => {
    for (const a of [0, -10, 91, 120, NaN]) expect(() => angledFingerWidths(a, T)).toThrow(/angled finger/);
  });

  it('at 90 degrees the edges draw exactly the plain finger / notch paths', () => {
    for (const play of [0, 0.3]) {
      const ctx = ctxFor(90, play);
      expect(pts('angledFinger', 47, ctx)).toEqual(pts('finger', 47, ctx));
      expect(pts('angledFingerHole', 47, ctx)).toEqual(pts('fingerHole', 47, ctx));
    }
  });

  it('fingers are depth deep; each notch is the finger widened by play/2 on both sides', () => {
    for (const a of [30, 60, 72]) for (const play of [0, 0.15 * T, 0.5 * T]) {
      const ctx = ctxFor(a, play);
      const { depth } = angledFingerWidths(a, T);
      const L = 61;
      const f = pts('angledFinger', L, ctx);
      const g = pts('angledFingerHole', L, ctx);
      expect(Math.min(...f.map((q) => q.y))).toBeCloseTo(-depth, 9); // protrudes right of travel
      expect(Math.max(...g.map((q) => q.y))).toBeCloseTo(depth, 9); // notches left of travel
      const lay = fingerLayout(L, ctx);
      const fx = [...new Set(f.filter((q) => Math.abs(q.y + depth) < 1e-9).map((q) => +q.x.toFixed(9)))].sort((x, y) => x - y);
      const gx = [...new Set(g.filter((q) => Math.abs(q.y - depth) < 1e-9).map((q) => +q.x.toFixed(9)))].sort((x, y) => x - y);
      expect(fx.length).toBe(2 * lay.fingers);
      expect(gx.length).toBe(2 * lay.fingers);
      fx.forEach((x, i) => expect(gx[i]!).toBeCloseTo(x + (i % 2 === 0 ? -play / 2 : play / 2), 9));
    }
  });
});

// ---------------------------------------------------------------- two-wall fixtures

/**
 * Two walls meeting at the inner corner line through the world origin (vertical): wall P arrives
 * along +x, wall Q leaves along (cos a, sin a); the interior is on the left. Each is a w x h panel
 * (plain except the corner side), placed with the generator convention (outer face z=0, normal
 * into the box). Q's corner side is 'angledFinger', P's is 'angledFingerHole'.
 */
function corner(a: number, play: number, opts: { shift?: Vec3; drawAngle?: number; types?: 'angled' | 'square'; h?: number } = {}): Part[] {
  const ctx = ctxFor(opts.drawAngle ?? a, play);
  const w = 40;
  const h = opts.h ?? 53;
  const r = (a * Math.PI) / 180;
  const d: Vec3 = [Math.cos(r), Math.sin(r), 0];
  const up: Vec3 = [0, 0, 1];
  const sh = opts.shift ?? [0, 0, 0];
  const P = rectangularWall(w, h, ['flat', 'flat', 'flat', 'angledFingerHole'], ctx);
  const Q = rectangularWall(w, h, ['flat', 'angledFinger', 'flat', 'flat'], ctx);
  if (opts.types === 'square') {
    P.lines = P.lines.map((l) => (l.type === 'angledFingerHole' ? { ...l, type: 'fingerHole' } : l));
    Q.lines = Q.lines.map((l) => (l.type === 'angledFinger' ? { ...l, type: 'finger' } : l));
  }
  const qo: Vec3 = [w * d[0] + T * Math.sin(r) + sh[0], w * d[1] - T * Math.cos(r) + sh[1], sh[2]];
  return finishPanels([
    panel('p', 'P', P, at([0, -T, 0], [-1, 0, 0], up), [undefined, undefined, undefined, ['q', 1]]),
    panel('q', 'Q', Q, at(qo, [-d[0], -d[1], 0], up), [undefined, ['p', 3], undefined, undefined]),
  ], T, 0);
}

const ANGLES = [15, 30, 45, 51.43, 60, 72, 90];

describe('angled finger corner assemblies', () => {
  it('valid parts that tile without overlap and touch, at every angle, with and without play', () => {
    for (const a of ANGLES) for (const play of [0, 0.1 * T, 0.3 * T, 0.5 * T]) {
      const parts = corner(a, play);
      const params = { thickness: T, play: play / T };
      expect(() => assertValidParts(parts, params, { kerf: 0 }), `a=${a} play=${play}`).not.toThrow();
      expect(() => assertAssembly(parts, { play }), `a=${a} play=${play}`).not.toThrow();
    }
  });

  it('the outer faces meet exactly at the declared joint line (outer corner, tip past the inner corner)', () => {
    for (const a of ANGLES) {
      const parts = corner(a, 0);
      const q = parts.find((x) => x.id === 'q')!;
      const e = q.edges.find((x) => x.side === 1)!;
      const tip = angledFingerWidths(a, T).tip;
      expect(e.from.x).toBeCloseTo(40 + tip, 9);
    }
  });

  it('a wall moved off the corner by 0.1 mm (in any direction) fails', () => {
    for (const a of [30, 60, 72]) for (const shift of [[0.1, 0, 0], [0, 0.1, 0], [-0.07, -0.07, 0], [0, 0, 0.1]] as Vec3[])
      expect(() => assertAssembly(corner(a, 0.3, { shift }), { play: 0.3 }), `a=${a} shift=${shift.join(',')}`).toThrow();
  });

  it('walls drawn for a different corner angle fail (overlap or no contact)', () => {
    expect(() => assertAssembly(corner(60, 0, { drawAngle: 45 }), { play: 0 })).toThrow();
    expect(() => assertAssembly(corner(45, 0, { drawAngle: 60 }), { play: 0 })).toThrow();
    expect(() => assertAssembly(corner(72, 0, { drawAngle: 90 }), { play: 0 })).toThrow();
  });

  it('play strips at an oblique corner are a real gap: found within play along the joint only for angled mates', () => {
    // At 60 degrees a play strip leaves the two walls 2 t cos(a) sin(a/2) = 0.5 t apart in that
    // cross-section. Find a wall height for which a contact sample (25/50/75 %) lands in a strip.
    const play = 0.3 * T;
    let checked = 0;
    for (let h = 30; h <= 90 && checked < 3; h += 0.25) {
      const square = corner(60, play, { types: 'square', h });
      let squareFails = false;
      try { assertAssembly(square, { play }); } catch (err) { squareFails = /no contact/.test(String(err)); }
      if (!squareFails) continue;
      checked++;
      expect(() => assertAssembly(corner(60, play, { h }), { play })).not.toThrow();
      // The strip is a gap of ~0.5 t, far more than play: without the along-line search it fails.
      expect(() => assertAssembly(corner(60, play, { h }), { play: 0 })).toThrow(/gap 1\.5/);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
