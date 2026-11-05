/**
 * Hand-built bent-part fixture for the harness tests: a rounded-rectangle plate (W x D, corner
 * radius r, outer face z = 0, thickness +z) wrapped by ONE bent wall (H tall along world z, outer
 * face t outside the plate's edge, four 90 degree living-hinge arcs). The wall's bottom band
 * (local y in [0, t]) covers the plate's edge; its straight spans mate the plate's straight sides
 * with flat "rests on" mates on the outer corner line (world z = 0, t outside the plate edge).
 */
import { FLEX_DEFAULTS, flexLength, livingHinge } from '../../src/core/livinghinge';
import type { Path } from '../../src/core/geometry';
import { finishPart, type Bend, type Part, type PartEdge, type Placement } from '../../src/core/part';
import { Turtle } from '../../src/core/turtle';

export type BentFixtureOpts = {
  /** Shift of the wall's placement origin (world mm). */
  shift?: [number, number, number];
  /** Added to the arcs' z=0 radius (r + t when correct). */
  radiusError?: number;
  /** Mate only the wall's first straight span (the rest are positioned by the bend alone). */
  firstMateOnly?: boolean;
  /** Scales every arc's flat strip length (1 when correct: inner arc / stretch). */
  stripScale?: number;
  /** Leave out the living-hinge slits. */
  noSlits?: boolean;
};

export function bentFixture(W = 80, D = 50, r = 12, H = 40, t = 3, o: BentFixtureOpts = {}): Part[] {
  const L = flexLength((Math.PI * r) / 2, FLEX_DEFAULTS) * (o.stripScale ?? 1); // flat length of each arc span
  const R = r + t + (o.radiusError ?? 0);
  // Wall spans along local x: half bottom, arc, right, arc, top, arc, left, arc, half bottom.
  const spans = [W / 2 - r, L, D - 2 * r, L, W - 2 * r, L, D - 2 * r, L, W / 2 - r];
  const total = spans.reduce((a, b) => a + b, 0);
  const arcs: Bend['arcs'] = [];
  let x = 0;
  const flats: [number, number][] = [];
  spans.forEach((l, i) => {
    if (i % 2) arcs.push({ at: x, length: l, angle: 90, radius: R });
    else flats.push([x, x + l]);
    x += l;
  });
  const holes: Path[] = o.noSlits ? [] : arcs.flatMap((a) => livingHinge(a.at, 0, a.length, H, FLEX_DEFAULTS, t, 0).holes);
  const s = o.shift ?? [0, 0, 0];
  // Starts under the middle of the plate's front side (world y = -t), running -x so n = +y (inwards).
  const wallPl: Placement = { origin: [W / 2 + s[0], -t + s[1], s[2]], x: [-1, 0, 0], y: [0, 0, 1] };
  // Plate sides (CCW from above): front split in two at W/2 (side 0: x in [W/2, W-r], side 4: [r, W/2]).
  const plateLines: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [
    { from: { x: W / 2, y: -t }, to: { x: W - r, y: -t } },
    { from: { x: W + t, y: r }, to: { x: W + t, y: D - r } },
    { from: { x: W - r, y: D + t }, to: { x: r, y: D + t } },
    { from: { x: -t, y: D - r }, to: { x: -t, y: r } },
    { from: { x: r, y: -t }, to: { x: W / 2, y: -t } },
  ];
  // Wall flat spans in travel order: front (to x = r), left, back, right, front (from W - r).
  const plateSideOf = [4, 3, 2, 1, 0];
  const mated = (k: number): boolean => !o.firstMateOnly || k === 0;
  const wallEdges: PartEdge[] = flats.map(([a, b], k) => ({
    side: k, type: 'flat', from: { x: a, y: 0 }, to: { x: b, y: 0 },
    ...(mated(k) ? { mate: { part: 'plate', side: plateSideOf[k]! } } : {}),
  }));
  const plateEdges: PartEdge[] = plateLines.map((l, side) => {
    const k = plateSideOf.indexOf(side);
    return { side, type: 'flat', ...l, ...(mated(k) ? { mate: { part: 'wall', side: k } } : {}) };
  });
  const tt = new Turtle({ x: r, y: 0 });
  for (const l of [W, D, W, D]) { tt.forward(l - 2 * r); tt.arc(r, 90); }
  const plate = finishPart({ id: 'plate', name: 'Plate', outline: tt.toPath(true), holes: [], engrave: [],
    placement: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] }, thickness: t, edges: plateEdges }, 0);
  const wallOutline: Path = { start: { x: 0, y: 0 }, closed: true, segs: [
    { t: 'L', to: { x: total, y: 0 } }, { t: 'L', to: { x: total, y: H } }, { t: 'L', to: { x: 0, y: H } }, { t: 'L', to: { x: 0, y: 0 } }] };
  const wall = finishPart({ id: 'wall', name: 'Wall', outline: wallOutline, holes, engrave: [], placement: wallPl,
    bend: { arcs }, thickness: t, edges: wallEdges }, 0);
  return [plate, wall];
}
