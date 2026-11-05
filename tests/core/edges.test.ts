import { describe, expect, it } from 'vitest';
import { Turtle } from '../../src/core/turtle';
import { isSimple } from '../../src/core/geometry';
import type { EdgeCtx } from '../../src/core/edges/types';
import { complement, edgeFor, flexPeriod, type EdgeType } from '../../src/core/edges';

const TYPES: EdgeType[] = ['flat', 'finger', 'fingerHole', 'mitre', 'rounded', 'hinge', 'slot', 'tslot', 'tslotHole', 'clickin', 'clickinHole', 'flex', 'angledFinger', 'angledFingerHole', 'crossSlot'];
const ctxFor = (th: number): EdgeCtx => ({ thickness: th, kerf: 0, finger: 2 * th, space: 2 * th, surroundingSpaces: 2, play: 0.05 * th });

describe('edge library', () => {
  for (const type of TYPES) {
    it(`${type}: net displacement, heading, simplicity over a length sweep`, () => {
      for (const th of [1, 3, 4.5]) {
        const ctx = ctxFor(th);
        for (const mult of [3, 3.2, 3.7, 4, 5, 6.5, 8, 11.3, 20, 37.1]) {
          const length = mult * th;
          for (const heading of [0, 90, 37]) {
            const t = new Turtle({ x: 1, y: 2 }, heading);
            edgeFor(type)(t, length, ctx);
            const r = (heading * Math.PI) / 180;
            expect(t.pos.x).toBeCloseTo(1 + length * Math.cos(r), 6);
            expect(t.pos.y).toBeCloseTo(2 + length * Math.sin(r), 6);
            expect(t.heading).toBeCloseTo(heading, 6);
            expect(isSimple(t.toPath(false))).toBe(true);
          }
        }
      }
    });
  }

  it('complement is an involution', () => {
    for (const type of TYPES) expect(complement(complement(type))).toBe(type);
  });

  it('flex period follows thickness and notches repeat at that period', () => {
    for (const th of [1, 3]) {
      const ctx = ctxFor(th);
      expect(flexPeriod(ctx)).toBe(2 * th);
      const t = new Turtle();
      edgeFor('flex')(t, 10 * th, ctx);
      // notch floors: segments at y = th/2 (left of travel); one per period
      const floors = t.toPath(false).segs.filter((s2) => Math.abs(s2.to.y - th / 2) < 1e-9);
      expect(floors.length).toBe(2 * Math.floor((10 * th) / flexPeriod(ctx))); // wall top + floor end per notch
      const xs = floors.filter((_, i) => i % 2 === 1).map((s2) => s2.to.x);
      for (let k = 1; k < xs.length; k++) expect(xs[k]! - xs[k - 1]!).toBeCloseTo(flexPeriod(ctx), 6);
    }
  });

  describe('shapes (heading 0: outward = -y right, inward = +y left; kerf not applied)', () => {
    const run = (type: EdgeType, length: number, th: number) => {
      const ctx = ctxFor(th);
      const t = new Turtle();
      edgeFor(type)(t, length, ctx);
      const path = t.toPath(false);
      const pts = [path.start, ...path.segs.map((sg) => sg.to)];
      const ys = pts.map((q) => q.y);
      return { ctx, pts, minY: Math.min(...ys), maxY: Math.max(...ys) };
    };
    const xsAt = (pts: { x: number; y: number }[], y: number) =>
      pts.filter((q) => Math.abs(q.y - y) < 1e-9).map((q) => q.x);
    const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    const L = 10;

    it('flat and mitre have no lateral excursion', () => {
      for (const type of ['flat', 'mitre'] as const) {
        const r = run(type, L * 2, 2);
        expect(Math.max(Math.abs(r.minY), Math.abs(r.maxY))).toBe(0);
      }
    });

    it('hinge: tab length-2*th wide, th proud on the right', () => {
      const th = 2, length = 5 * th;
      const r = run('hinge', length, th);
      expect(r.minY).toBeCloseTo(-th, 9);
      expect(r.maxY).toBeCloseTo(0, 9);
      expect(span(xsAt(r.pts, -th))).toBeLessThanOrEqual(length - 2 * th + 1e-9);
      const xs = r.pts.filter((q) => q.y < -1e-9).map((q) => q.x);
      expect(Math.min(...xs)).toBeCloseTo(th, 9);
      expect(Math.max(...xs)).toBeCloseTo(length - th, 9);
    });

    it('slot: length-2*th+play wide, th+play deep on the left', () => {
      const th = 2, length = 5 * th;
      const r = run('slot', length, th);
      const { play } = r.ctx;
      expect(r.minY).toBeCloseTo(0, 9);
      expect(r.maxY).toBeCloseTo(th + play, 9);
      expect(span(xsAt(r.pts, th + play))).toBeCloseTo(length - 2 * th + play, 9);
    });

    it('hinge tab fits slot with exactly play/2 clearance per side', () => {
      const th = 2, length = 5 * th;
      const tab = run('hinge', length, th);
      const slot = run('slot', length, th);
      const tx = tab.pts.filter((q) => q.y < -1e-9).map((q) => q.x);
      const sx = slot.pts.filter((q) => q.y > 1e-9).map((q) => q.x);
      const play = slot.ctx.play;
      expect(Math.min(...tx) - Math.min(...sx)).toBeCloseTo(play / 2, 9);
      expect(Math.max(...sx) - Math.max(...tx)).toBeCloseTo(play / 2, 9);
      expect(slot.maxY - th).toBeCloseTo(play, 9);
    });

    it('tslot / tslotHole: neck th wide, pocket 2*th wide, depth 2*th, on the left', () => {
      const th = 2, length = 6 * th;
      for (const [type, p] of [['tslot', 0], ['tslotHole', ctxFor(th).play]] as const) {
        const r = run(type, length, th);
        expect(r.minY).toBeCloseTo(0, 9);
        expect(r.maxY).toBeCloseTo(2 * th, 9);
        expect(span(xsAt(r.pts, th))).toBeCloseTo(2 * th + p, 9); // pocket spans its full width from y = th
        expect(span(xsAt(r.pts, 2 * th))).toBeCloseTo(2 * th + p, 9);
        const neck = r.pts.filter((q) => Math.abs(q.y) < 1e-9);
        expect(neck[2]!.x - neck[1]!.x).toBeCloseTo(th + p, 9);
      }
    });

    it('clickin protrudes at most th on the right; clickinHole is a left notch th+play deep', () => {
      const th = 2, length = 6 * th;
      const tab = run('clickin', length, th);
      expect(tab.maxY).toBeCloseTo(0, 9);
      expect(tab.minY).toBeGreaterThanOrEqual(-th - 1e-9);
      const hole = run('clickinHole', length, th);
      expect(hole.minY).toBeCloseTo(0, 9);
      expect(hole.maxY).toBeCloseTo(th + hole.ctx.play, 9);
    });

    it('clickin tab fits its opening with play clearance', () => {
      const th = 2, length = 6 * th;
      const tab = run('clickin', length, th);
      const hole = run('clickinHole', length, th);
      const play = hole.ctx.play;
      const tb = xsAt(tab.pts, 0).filter((x) => x > 0 && x < length);
      const hb = xsAt(hole.pts, 0).filter((x) => x > 0 && x < length);
      expect(span(hb) - span(tb)).toBeCloseTo(play, 9); // mouth wider than tab base by play
      expect(hole.maxY - tab.minY * -1).toBeCloseTo(play, 9); // depth th+play vs tab height th
      const tipW = span(xsAt(tab.pts, tab.minY));
      const floorW = span(xsAt(hole.pts, hole.maxY));
      expect(floorW - tipW).toBeCloseTo(play, 9);
    });

    it('flex: notch floor at th/2, notch width th, remainders consistent with the period', () => {
      const th = 2, length = 10.7 * th;
      const r = run('flex', length, th);
      expect(r.minY).toBeCloseTo(0, 9);
      expect(r.maxY).toBeCloseTo(th / 2, 9);
      const floor = r.pts.filter((q) => Math.abs(q.y - th / 2) < 1e-9).map((q) => q.x);
      expect(floor[1]! - floor[0]!).toBeCloseTo(th, 9);
      const n = Math.floor(length / (2 * th));
      const m = (length - n * 2 * th) / 2;
      expect(floor[0]).toBeCloseTo(m + th / 2, 9);
      expect(length - floor[floor.length - 1]!).toBeCloseTo(m + th / 2, 9);
    });
  });
});
