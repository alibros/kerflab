/**
 * "Storage & display" batch: headline-dimension tests per generator (the registry loop in
 * suite.ts covers invariants, presets, snapshots and fuzz), measured on assembled models that pass
 * assertAssembly, plus ParamErrors naming their param.
 */
import { describe, expect, it } from 'vitest';
import { bounds, flatten, type Vec2 } from '../../src/core/geometry';
import { placementNormal, toWorld, type Part } from '../../src/core/part';
import { defaults, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { getGenerator } from '../../src/generators';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';

type Box3 = { min: number[]; max: number[] };

/** World bounding box of parts' nominal outlines at both faces. */
function box(parts: Part[]): Box3 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) for (const q of flatten(part.nominal.outline)) for (const z of [0, part.thickness]) {
    const w = toWorld(part.placement, q, z);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
  }
  return { min, max };
}
const size = (parts: Part[]): number[] => { const b = box(parts); return [0, 1, 2].map((i) => +(b.max[i]! - b.min[i]!).toFixed(6)); };

function build(id: string, over: Params): Part[] {
  const g = getGenerator(id)!;
  const p = { ...defaults(g.schema), ...over };
  const parts = g.build(p);
  assertValidParts(parts, p);
  assertAssembly(parts, assemblyOpts(p, g.expectedSize!(p)));
  return parts;
}

const part = (parts: Part[], id: string): Part => {
  const q = parts.find((x) => x.id === id);
  if (!q) throw new Error(`no part ${id}`);
  return q;
};

const rad = (d: number): number => (d * Math.PI) / 180;
/** World vertices of a part's outline (z = 0 face). */
const verts = (q: Part): number[][] => flatten(q.nominal.outline).map((v: Vec2) => toWorld(q.placement, v));

describe('storage & display: headline dimensions', () => {
  it('storageshelf: x, y (depth), h equal the params; rows - 1 shelves and cols - 1 dividers', () => {
    const t = 3;
    for (const [cols, rows] of [[1, 1], [3, 2], [2, 4]] as const) {
      const parts = build('storageshelf', { x: 400, h: 300, y: 200, cols, rows, sx: '', sh: '', inside: false, thickness: t });
      expect(size(parts)).toEqual([400, 200, 300]);
      expect(parts.filter((q) => q.id.startsWith('shelf'))).toHaveLength(rows - 1);
      expect(parts.filter((q) => q.id.startsWith('divider'))).toHaveLength(cols - 1);
      // open front: nothing at y < 0, the back panel's outer face at y = depth
      expect(box([part(parts, 'back')]).max[1]).toBeCloseTo(200, 9);
    }
    // inner dimensions: x, h and y are the space inside
    expect(size(build('storageshelf', { x: 300, h: 250, y: 150, cols: 2, rows: 2, sx: '', sh: '', inside: true, thickness: t }))).toEqual([306, 153, 256]);
  });

  it('laptopstand: the plates\' top edges tilt the laptop by `angle`, its front ground_offset up, l_depth cos(angle) deep', () => {
    for (const [angle, l_depth, ground_offset] of [[15, 250, 10], [25, 300, 15], [35, 180, 20]] as const) {
      const parts = build('laptopstand', { angle, l_depth, ground_offset, l_thickness: 10, nub_size: 10 });
      for (const q of parts) {
        const v = verts(q);
        const rear = v.reduce((a, b) => (b[2]! > a[2]! ? b : a)); // highest vertex: the rear end of the top edge
        const front = v.find((w) => Math.abs(w[2]! - ground_offset) < 1e-9)!; // the laptop's front point
        expect(rear[2]! - front[2]!).toBeCloseTo(l_depth * Math.sin(rad(angle)), 6);
        expect(rear[1]! - front[1]!).toBeCloseTo(l_depth * Math.cos(rad(angle)), 6);
      }
      // both plates' top edges lie in one plane: the same rise per y
      expect(size(parts)[2]).toBeCloseTo(ground_offset + l_depth * Math.sin(rad(angle)), 6);
    }
  });

  it('displayshelf: x, y, h equal the params; num shelves sloping down to the front by `angle`, each with a lip', () => {
    for (const [angle, include_back, num] of [[30, false, 3], [15, true, 2], [0, true, 4]] as const) {
      const parts = build('displayshelf', { x: 400, y: 120, h: 400, num, angle, front_wall_height: 20, include_back, inside: false, thickness: 3 });
      expect(size(parts)).toEqual([400, 120, 400]);
      const shelves = parts.filter((q) => q.id.startsWith('shelf'));
      expect(shelves).toHaveLength(num);
      expect(parts.filter((q) => q.id.startsWith('lip'))).toHaveLength(num);
      for (const s of shelves) {
        const v = s.placement.y; // up the slope, towards the back
        expect((Math.atan2(v[2], v[1]) * 180) / Math.PI).toBeCloseTo(angle, 9);
      }
    }
  });

  it('spicesrack: numx (d + space) wide, numy shelves of numx can holes, brackets between the cans', () => {
    const t = 3;
    const [d, s, hc, nx, ny] = [55, 10, 60, 5, 6];
    const parts = build('spicesrack', { diameter: d, can_space: s, height: hc, numx: nx, numy: ny, thickness: t });
    const lean = Math.atan(((d / 2) * Math.cos(rad(10))) / hc);
    const P = (s + d) / Math.cos(lean);
    const [x, , z] = size(parts);
    expect(x).toBeCloseTo(nx * (d + s), 6);
    expect(z).toBeCloseTo(ny * P - P / 2 + 6 * t, 6);
    const shelves = parts.filter((q) => q.id.startsWith('shelf'));
    expect(shelves).toHaveLength(ny);
    for (const q of shelves) expect(q.nominal.holes).toHaveLength(nx);
    expect(parts.filter((q) => q.id.startsWith('bracket'))).toHaveLength((nx - 1) * ny);
    // shelves one pitch apart
    const zs = shelves.map((q) => q.placement.origin[2]).sort((a, b) => a - b);
    for (let i = 1; i < zs.length; i++) expect(zs[i]! - zs[i - 1]!).toBeCloseTo(P, 9);
  });

  it('winerack: x, h + 3t, y; one bottle hole of `radius` per cell in the front plate and the cover', () => {
    const t = 3;
    for (const walls of ['all', 'no_verticals', 'minimal']) {
      const parts = build('winerack', { x: 400, y: 300, h: 210, radius: 46, walls, thickness: t });
      expect(size(parts)).toEqual([400, 210 + 3 * t, 300]);
      const holes = part(parts, 'front').nominal.holes.filter((hp) => hp.segs.every((sg) => sg.t === 'A'));
      expect(holes.length).toBeGreaterThan(0);
      expect(part(parts, 'cover').nominal.holes).toHaveLength(holes.length);
      for (const hp of holes) {
        const b = bounds(hp);
        expect((b.max.x - b.min.x) / 2).toBeCloseTo(46, 9);
        expect((b.max.y - b.min.y) / 2).toBeCloseTo(46, 9);
      }
    }
    // the default rack: 4 + 3 + 4 cells (2 dx = 98 mm pitch); all walls: 11 * 6 = 66 cell edges,
    // less 3 + 2 + 3 shared within rows and 6 + 6 between them
    const parts = build('winerack', {});
    expect(part(parts, 'cover').nominal.holes).toHaveLength(11);
    expect(parts.filter((q) => q.id.startsWith('wall'))).toHaveLength(66 - 8 - 12);
  });

  it('bookholder: book_width wide; the back plate is book_height long at `angle` to the floor, the bottom plate square to it', () => {
    for (const [angle, H, D] of [[75, 210, 40], [60, 150, 30]] as const) {
      const parts = build('bookholder', { book_width: 297, book_height: H, book_depth: D, angle, ledge_height: 10 });
      expect(size(parts)[0]).toBeCloseTo(297, 9);
      const bp = part(parts, 'backplate');
      const v = bp.placement.y; // up the back plate
      expect((Math.atan2(v[2], -v[1]) * 180) / Math.PI).toBeCloseTo(180 - angle, 9); // leans back: up and towards +y
      const b = box([bp]);
      expect(Math.hypot(b.max[1]! - b.min[1]!, b.max[2]! - b.min[2]!)).toBeGreaterThan(H);
      const o = part(parts, 'bottomplate');
      const dot = [0, 1, 2].reduce((a, i) => a + v[i]! * o.placement.y[i]!, 0);
      expect(dot).toBeCloseTo(0, 9);
    }
  });

  it('phoneholder: phone_width + 2t wide, the front plate leans `angle` from vertical, the tabs stand phone_depth in front of it', () => {
    const t = 3;
    for (const [angle, ph, pw, pd, bm] of [[25, 142, 73, 11, 30], [15, 165, 78, 10, 25]] as const) {
      const parts = build('phoneholder', { phone_height: ph, phone_width: pw, phone_depth: pd, angle, bottom_margin: bm, thickness: t });
      expect(size(parts)[0]).toBeCloseTo(pw + 2 * t, 9);
      const fp = part(parts, 'front');
      const v = fp.placement.y;
      expect((Math.atan2(v[1], v[2]) * 180) / Math.PI).toBeCloseTo(angle, 9);
      // the back plate is h cos(angle) high, h = phone_height + bottom_margin
      const bk = box([part(parts, 'back')]);
      expect(bk.max[2]! - bk.min[2]!).toBeCloseTo((ph + bm) * Math.cos(rad(angle)), 6);
      // tab: the triangle reaches t + phone_depth beyond the front plate's back face (its outward normal is -n)
      const n = placementNormal(fp.placement);
      const backFace = fp.placement.origin.map((c, i) => c + t * n[i]!);
      const out = (w: number[]): number => -[0, 1, 2].reduce((a, i) => a + (w[i]! - backFace[i]!) * n[i]!, 0);
      expect(Math.max(...verts(part(parts, 'left')).map(out))).toBeCloseTo(t + pd, 6);
    }
  });
});

describe('storage & display: impossible inputs throw ParamError naming the param', () => {
  const cases: [string, Params, string][] = [
    ['storageshelf', { x: 40, cols: 8, thickness: 6 }, 'x'],
    ['storageshelf', { y: 20, thickness: 10 }, 'y'],
    ['laptopstand', { l_depth: 120, nub_size: 40, angle: 40, ground_offset: 50, thickness: 10 }, 'l_depth'],
    ['laptopstand', { angle: 5, ground_offset: 5, l_depth: 120, thickness: 10 }, 'ground_offset'],
    ['displayshelf', { h: 100, num: 4 }, 'num'],
    ['displayshelf', { y: 30, angle: 45, front_wall_height: 60 }, 'y'],
    ['spicesrack', { diameter: 20, can_space: 2, height: 200, thickness: 6 }, 'diameter'],
    ['winerack', { x: 100, radius: 80 }, 'x'],
    ['winerack', { x: 600, y: 600, radius: 30, thickness: 1 }, 'radius'],
    ['bookholder', { bottom_support: 0, radius: 0 }, 'bottom_support'],
    ['bookholder', { back_support: 150 }, 'back_support'],
    ['bookholder', { book_height: 30, angle: 85 }, 'book_height'],
    ['phoneholder', { tab_size: 150, phone_height: 100 }, 'tab_size'],
    ['phoneholder', { bottom_support_spacing: 5, thickness: 3 }, 'bottom_support_spacing'],
    ['spicesrack', { can_space: 3, thickness: 3 }, 'can_space'],
    ['phoneholder', { bottom_support_spacing: 60, phone_width: 60 }, 'bottom_support_spacing'],
  ];
  for (const [id, over, key] of cases)
    it(`${id} ${JSON.stringify(over)} -> ${key}`, () => {
      const g = getGenerator(id)!;
      let err: unknown;
      try { g.build({ ...defaults(g.schema), ...over }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ParamError);
      expect((err as ParamError).param).toBe(key);
    });
});

describe('storage & display: category', () => {
  it('all seven generators are in "Storage & display"', () => {
    for (const id of ['storageshelf', 'displayshelf', 'laptopstand', 'spicesrack', 'winerack', 'bookholder', 'phoneholder'])
      expect(getGenerator(id)!.category).toBe('Storage & display');
  });
});
