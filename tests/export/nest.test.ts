import { describe, expect, it } from 'vitest';
import { nest } from '../../src/app/export/nest';
import { placedSize } from '../../src/app/export/layout';
import { testPart } from './helpers';
import { SHEET_EDGE } from '../../src/app/profiles';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertNoOverlap(layout: ReturnType<typeof nest>, gap: number): void {
  const boxes = layout.placed.map((p) => ({ p, s: placedSize(p) }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.p.sheet !== b.p.sheet) continue;
      const sepX = a.p.x + a.s.w + gap <= b.p.x + 1e-9 || b.p.x + b.s.w + gap <= a.p.x + 1e-9;
      const sepY = a.p.y + a.s.h + gap <= b.p.y + 1e-9 || b.p.y + b.s.h + gap <= a.p.y + 1e-9;
      expect(sepX || sepY, `${a.p.part.id} overlaps ${b.p.part.id}`).toBe(true);
    }
}

describe('nest', () => {
  it('never overlaps (randomized sizes, bounded and unbounded), respecting gap', () => {
    const r = rng(7);
    for (let trial = 0; trial < 60; trial++) {
      const parts = Array.from({ length: 1 + Math.floor(r() * 25) }, (_, i) =>
        testPart(`p${i}`, 5 + r() * 120, 5 + r() * 120));
      const gap = r() * 5;
      const sheet = trial % 2 ? { w: 300 + r() * 300, h: 200 + r() * 300 } : null;
      const layout = nest(parts, sheet, gap);
      assertNoOverlap(layout, gap);
      expect(layout.placed.length + layout.unfit.length).toBe(parts.length);
      for (const p of layout.placed) {
        const s = placedSize(p);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + s.w).toBeLessThanOrEqual(layout.sheet.w + 1e-9);
        expect(p.y + s.h).toBeLessThanOrEqual(layout.sheet.h + 1e-9);
        if (sheet) {
          expect(layout.sheet).toEqual(sheet);
          expect(p.sheet).toBeLessThan(layout.sheets);
        } else expect(p.sheet).toBe(0);
      }
    }
  });

  it('overflows onto a new sheet instead of marking parts unfit', () => {
    const parts = [testPart('a', 80, 80), testPart('b', 80, 80), testPart('c', 80, 80)];
    const layout = nest(parts, { w: 100, h: 100 }, 2);
    expect(layout.unfit).toEqual([]);
    expect(layout.sheets).toBe(3);
    expect(layout.placed.map((p) => p.sheet).sort()).toEqual([0, 1, 2]);
    const small = nest([testPart('a', 80, 80), testPart('b', 10, 10)], { w: 100, h: 100 }, 2);
    expect(small.sheets).toBe(1); // small part still fills the gap on sheet 0
  });

  it('reports sheet counts: 1 when everything fits, 0 when empty', () => {
    expect(nest([testPart('a', 10, 10)], { w: 100, h: 100 }, 1).sheets).toBe(1);
    expect(nest([], { w: 100, h: 100 }, 1).sheets).toBe(0);
  });

  it('puts parts larger than the sheet in unfit (by id), in either orientation', () => {
    const layout = nest([testPart('big', 500, 20), testPart('ok', 50, 50), testPart('huge', 400, 400)], { w: 300, h: 200 }, 2);
    expect(layout.unfit.sort()).toEqual(['big', 'huge']);
    expect(layout.placed.map((p) => p.part.id)).toEqual(['ok']);
  });

  it('rotates 90 degrees when that is the only way to fit', () => {
    const layout = nest([testPart('tall', 20, 250)], { w: 300, h: 100 }, 0);
    expect(layout.unfit).toEqual([]);
    expect(layout.placed[0]!.rot).toBe(90);
  });

  it('keeps SHEET_EDGE clear of every edge of a bounded sheet, and judges fit on the reduced area', () => {
    expect(SHEET_EDGE).toBeGreaterThan(0);
    const r = rng(3);
    const parts = Array.from({ length: 30 }, (_, i) => testPart(`p${i}`, 5 + r() * 90, 5 + r() * 90));
    const layout = nest(parts, { w: 200, h: 150 }, 2);
    expect(layout.sheet).toEqual({ w: 200, h: 150 });
    for (const p of layout.placed) {
      const s = placedSize(p);
      expect(p.x).toBeGreaterThanOrEqual(SHEET_EDGE - 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(SHEET_EDGE - 1e-9);
      expect(p.x + s.w).toBeLessThanOrEqual(200 - SHEET_EDGE + 1e-9);
      expect(p.y + s.h).toBeLessThanOrEqual(150 - SHEET_EDGE + 1e-9);
    }
    // Exactly the sheet size no longer fits; the sheet less both margins does.
    expect(nest([testPart('full', 100, 100)], { w: 100, h: 100 }, 2).unfit).toEqual(['full']);
    const tight = nest([testPart('tight', 100 - 2 * SHEET_EDGE, 100 - 2 * SHEET_EDGE)], { w: 100, h: 100 }, 2);
    expect(tight.unfit).toEqual([]);
    expect(tight.placed[0]).toMatchObject({ x: SHEET_EDGE, y: SHEET_EDGE });
  });

  it('sheet null is a single unbounded sheet and nothing is unfit', () => {
    const layout = nest([testPart('a', 1000, 1000), testPart('b', 10, 10)], null, 1);
    expect(layout.unfit).toEqual([]);
    expect(layout.placed).toHaveLength(2);
    expect(layout.sheet.w).toBeGreaterThanOrEqual(1000);
  });

  it('handles an empty part list', () => {
    const layout = nest([], null, 1);
    expect(layout.placed).toEqual([]);
    expect(layout.unfit).toEqual([]);
  });
});
