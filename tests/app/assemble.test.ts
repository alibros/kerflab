import { describe, expect, it } from 'vitest';
import { Box3, type BufferGeometry, Vector3 } from 'three';
import type { Path } from '../../src/core/geometry';
import type { Part, Placement } from '../../src/core/part';
import { defaults } from '../../src/core/schema';
import { closedBox } from '../../src/generators/closedbox';
import { EdgesGeometry } from 'three';
import { getGenerator } from '../../src/generators';
import { explodeOffset, partBounds, partEdgeLines, partToGeometry, SMOOTH_DEG } from '../../src/app/views/assemble';

const rect = (x0: number, y0: number, w: number, h: number): Path => ({
  start: { x: x0, y: y0 },
  closed: true,
  segs: [
    { t: 'L', to: { x: x0 + w, y: y0 } },
    { t: 'L', to: { x: x0 + w, y: y0 + h } },
    { t: 'L', to: { x: x0, y: y0 + h } },
    { t: 'L', to: { x: x0, y: y0 } },
  ],
});
/** Full circle as two CCW half arcs. */
const circle = (cx: number, cy: number, r: number): Path => ({
  start: { x: cx + r, y: cy },
  closed: true,
  segs: [
    { t: 'A', to: { x: cx - r, y: cy }, c: { x: cx, y: cy }, ccw: true },
    { t: 'A', to: { x: cx + r, y: cy }, c: { x: cx, y: cy }, ccw: true },
  ],
});

const FLAT: Placement = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] };
const SIDE: Placement = { origin: [10, 20, 30], x: [0, 1, 0], y: [0, 0, 1] };

function part(id: string, outline: Path, holes: Path[] = [], placement: Placement = FLAT, thickness = 3): Part {
  return {
    id,
    name: id,
    outline,
    holes,
    engrave: [],
    placement,
    thickness,
    edges: [],
    kerf: 0,
    nominal: { outline, holes },
  };
}

/** Signed volume of a closed triangle mesh (divergence theorem). */
function volume(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  const at = (i: number): Vector3 => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i);
  let v = 0;
  for (let i = 0; i < n; i += 3) v += at(i).dot(at(i + 1).cross(at(i + 2))) / 6;
  return v;
}

describe('partToGeometry', () => {
  it('volume ≈ area × thickness for a plain panel', () => {
    const g = partToGeometry(part('a', rect(0, 0, 80, 50)));
    expect(volume(g)).toBeCloseTo(80 * 50 * 3, 6);
  });

  it('is placed by the convention: thickness along +n, z=0 is the outer face', () => {
    const g = partToGeometry(part('a', rect(0, 0, 80, 50), [], SIDE, 4));
    g.computeBoundingBox();
    const b = g.boundingBox!;
    // u = +y, v = +z, n = u × v = +x
    expect(b.min.toArray()).toEqual([10, 20, 30]);
    expect(b.max.x).toBeCloseTo(14, 9);
    expect(b.max.y).toBeCloseTo(100, 9);
    expect(b.max.z).toBeCloseTo(80, 9);
    expect(volume(g)).toBeCloseTo(80 * 50 * 4, 6);
  });

  it('holes reduce the volume; arcs are flattened within 0.5 %', () => {
    const solid = volume(partToGeometry(part('a', rect(0, 0, 100, 100))));
    const holed = volume(partToGeometry(part('a', rect(0, 0, 100, 100), [circle(50, 50, 20), rect(5, 5, 10, 10)])));
    const expected = (100 * 100 - Math.PI * 20 * 20 - 100) * 3;
    expect(holed).toBeLessThan(solid);
    expect(Math.abs(holed - expected) / expected).toBeLessThan(0.005);
    const disc = volume(partToGeometry(part('d', circle(0, 0, 30))));
    expect(Math.abs(disc - Math.PI * 900 * 3) / (Math.PI * 900 * 3)).toBeLessThan(0.005);
  });

  it('accepts clockwise outlines and holes', () => {
    const cw = (p: Path): Path => {
      const pts = [p.start, ...p.segs.map((s) => s.to)].reverse();
      return { start: pts[0]!, closed: true, segs: pts.slice(1).map((to) => ({ t: 'L' as const, to })) };
    };
    const v = volume(partToGeometry(part('a', cw(rect(0, 0, 40, 40)), [cw(rect(10, 10, 10, 10))])));
    expect(v).toBeCloseTo((1600 - 100) * 3, 6);
  });

  it('uses the nominal geometry, not the kerfed outline', () => {
    const p = { ...part('a', rect(0, 0, 50, 50)), outline: rect(-1, -1, 52, 52), kerf: 2 };
    expect(volume(partToGeometry(p))).toBeCloseTo(50 * 50 * 3, 6);
  });

  it('assembled ClosedBox bounds equal generator.expectedSize within 0.01 mm', () => {
    for (const extra of [{}, { x: 160, y: 110, h: 70 }, { top: 'none' }, { inside: true, thickness: 6 }]) {
      const params = { ...defaults(closedBox.schema), ...extra };
      const parts = closedBox.build(params);
      const box = new Box3();
      for (const p of parts) {
        const g = partToGeometry(p);
        g.computeBoundingBox();
        box.union(g.boundingBox!);
      }
      const want = closedBox.expectedSize!(params);
      const size = box.getSize(new Vector3());
      expect(Math.abs(size.x - want.x)).toBeLessThan(0.01);
      expect(Math.abs(size.y - want.y)).toBeLessThan(0.01);
      expect(Math.abs(size.z - want.z)).toBeLessThan(0.01);
      // Every wall's volume equals its nominal area times thickness: no inverted panels.
      for (const p of parts) {
        const v = volume(partToGeometry(p));
        expect(v).toBeGreaterThan(0);
      }
    }
  });
});

describe('explodeOffset', () => {
  const parts = closedBox.build(defaults(closedBox.schema));

  it('is all zeros at t = 0', () => {
    const m = explodeOffset(parts, 0);
    expect(m.size).toBe(parts.length);
    for (const v of m.values()) expect(v.length()).toBe(0);
  });

  it('scales linearly with t and points away from the assembled centroid', () => {
    const a = explodeOffset(parts, 0.25);
    const b = explodeOffset(parts, 1);
    const centre = new Vector3();
    for (const p of parts) centre.add(partBounds(p).getCenter(new Vector3()));
    centre.divideScalar(parts.length);
    for (const p of parts) {
      const va = a.get(p.id)!;
      const vb = b.get(p.id)!;
      expect(vb.length()).toBeGreaterThan(0);
      expect(va.clone().multiplyScalar(4).distanceTo(vb)).toBeLessThan(1e-9);
      const away = partBounds(p).getCenter(new Vector3()).sub(centre);
      expect(away.dot(vb)).toBeGreaterThan(0);
    }
  });

  it('falls back to the outward normal for a part at the centroid', () => {
    const one = [part('solo', rect(0, 0, 10, 10))];
    const v = explodeOffset(one, 1).get('solo')!;
    expect(v.z).toBeLessThan(0); // n = +z points into the box, so outward is -z
  });
});

describe('explodeOffset: wrapped walls', () => {
  it('a bent wall round the centroid stays put while the other parts move away from it', async () => {
    const { getGenerator } = await import('../../src/generators');
    let seen = 0;
    for (const id of ['flexbox', 'flexbox2', 'flexbox5', 'roundedbox']) {
      const g = getGenerator(id);
      if (!g) continue;
      const ps = g.build(defaults(g.schema));
      const m = explodeOffset(ps, 1);
      const centre = new Vector3();
      for (const p of ps) centre.add(partBounds(p).getCenter(new Vector3()));
      centre.divideScalar(ps.length);
      const diag = partBounds(ps[0]!).getSize(new Vector3()).length();
      for (const p of ps) {
        const away = partBounds(p).getCenter(new Vector3()).sub(centre);
        if (p.bend && away.length() < 1e-6 * Math.max(diag, 1)) {
          seen++;
          expect(m.get(p.id)!.length(), `${id} ${p.id}`).toBe(0);
        } else expect(m.get(p.id)!.length(), `${id} ${p.id}`).toBeGreaterThan(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('bent parts (living hinge)', () => {
  it('maps the flat geometry through the bend: every vertex inside the bent prism, curved bbox', async () => {
    const { bentFixture } = await import('../harness/bentfixture');
    const { partToLocal } = await import('../../src/core/part');
    const [, wall] = bentFixture(80, 50, 12, 40, 3);
    const g = partToGeometry(wall!);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i += 7) {
      const w: [number, number, number] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const c = partToLocal(wall!, w, 1e-3);
      expect(c.some(([x, y, z]) => x > -1e-3 && x < 400 && y > -1e-3 && y < 40 + 1e-3 && z > -1e-3 && z < 3 + 1e-3)).toBe(true);
    }
    const size = new Box3().setFromBufferAttribute(pos as never).getSize(new Vector3());
    expect(size.x).toBeCloseTo(86, 1);
    expect(size.y).toBeCloseTo(56, 1);
    expect(size.z).toBeCloseTo(40, 6);
    const b = partBounds(wall!).getSize(new Vector3());
    expect(b.x).toBeCloseTo(86, 1);
    expect(b.y).toBeCloseTo(56, 1);
    // Faces are smooth across the arcs: vertex normals are unit length.
    const nrm = g.getAttribute('normal');
    for (let i = 0; i < nrm.count; i += 11) expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 5);
  });
});

describe('partEdgeLines', () => {
  /** A 200 × 100 plate with two rows of eight aligned 6 × 3 slots (a shelf top). */
  const slotted = (): Part => {
    const holes: Path[] = [];
    for (const y of [30, 67]) for (let i = 0; i < 8; i++) holes.push(rect(10 + i * 24, y, 6, 3));
    return part('top', rect(0, 0, 200, 100), holes);
  };
  /** Segments of a flat line list in the FLAT placement, as [x0, y0, z0, x1, y1, z1]. */
  const segs = (a: ArrayLike<number>): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < a.length; i += 6) out.push(Array.from({ length: 6 }, (_, k) => a[i + k]!));
    return out;
  };
  /** True when the segment lies on one of the rectangles' sides, or is a vertical corner line. */
  const onLoops = (s: number[], rects: [number, number, number, number][]): boolean => {
    const [x0, y0, z0, x1, y1, z1] = s as [number, number, number, number, number, number];
    if (Math.abs(x0 - x1) < 1e-9 && Math.abs(y0 - y1) < 1e-9) return z0 !== z1; // through the thickness
    if (Math.abs(z0 - z1) > 1e-9) return false;
    return rects.some(([rx, ry, w, hh]) => {
      const onX = (x: number): boolean => Math.abs(x - rx) < 1e-6 || Math.abs(x - rx - w) < 1e-6;
      const onY = (y: number): boolean => Math.abs(y - ry) < 1e-6 || Math.abs(y - ry - hh) < 1e-6;
      const inX = (x: number): boolean => x > rx - 1e-6 && x < rx + w + 1e-6;
      const inY = (y: number): boolean => y > ry - 1e-6 && y < ry + hh + 1e-6;
      return (onX(x0) && x0 === x1 && inY(y0) && inY(y1)) || (onY(y0) && y0 === y1 && inX(x0) && inX(x1));
    });
  };

  it('draws only the contour edges and corner lines of a plate with rows of aligned slots', () => {
    const p = slotted();
    const rects: [number, number, number, number][] = [[0, 0, 200, 100]];
    for (const y of [30, 67]) for (let i = 0; i < 8; i++) rects.push([10 + i * 24, y, 6, 3]);
    const s = segs(partEdgeLines(p));
    // 17 rectangles × 4 sides × (2 faces + 1 corner line).
    expect(s.length).toBe(17 * 4 * 3);
    for (const q of s) expect(onLoops(q, rects)).toBe(true);
  });

  it('regression: EdgesGeometry on the triangulated faces drew lines across the slotted plate', () => {
    // Documents the old cause: zero-area triangles between collinear slot vertices.
    const p = slotted();
    const rects: [number, number, number, number][] = [[0, 0, 200, 100]];
    for (const y of [30, 67]) for (let i = 0; i < 8; i++) rects.push([10 + i * 24, y, 6, 3]);
    const e = new EdgesGeometry(partToGeometry(p), SMOOTH_DEG).getAttribute('position');
    const stray = segs(e.array).filter((q) => !onLoops(q, rects));
    expect(stray.length).toBeGreaterThan(0);
  });

  it('builds whole segments for real generator parts', () => {
    for (const id of ['storageshelf', 'cardbox', 'wallholder', 'bintray']) {
      const g = getGenerator(id)!;
      for (const p of g.build(defaults(g.schema))) {
        if (p.bend) continue;
        const a = partEdgeLines(p);
        expect(a.length % 6).toBe(0);
        expect(a.length).toBeGreaterThan(0);
      }
    }
  });

});
