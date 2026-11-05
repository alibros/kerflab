/**
 * "Trays & organizers (part 1)" batch: headline outer dimensions per generator (the registry
 * loop in suite.ts covers invariants, presets, snapshots and fuzz), the compartment count
 * (rows * cols, counted geometrically as the empty regions of a cross-section), the size lists of
 * traylayout and ParamErrors.
 */
import { describe, expect, it } from 'vitest';
import { flatten, type Vec2 } from '../../src/core/geometry';
import { toLocal, toWorld, type Part, type Vec3 } from '../../src/core/part';
import { defaults, validate, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { getGenerator } from '../../src/generators';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';

function worldSize(parts: Part[]): { x: number; y: number; z: number } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) for (const q of flatten(part.nominal.outline)) for (const z of [0, part.thickness]) {
    const w = toWorld(part.placement, q, z);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
  }
  return { x: max[0]! - min[0]!, y: max[1]! - min[1]!, z: max[2]! - min[2]! };
}

const round = (s: { x: number; y: number; z: number }): number[] => [s.x, s.y, s.z].map((v) => +v.toFixed(6));

function build(id: string, over: Params): Part[] {
  const g = getGenerator(id)!;
  const v = validate(g.schema, { ...defaults(g.schema), ...over });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  const parts = g.build(v.params);
  assertValidParts(parts, v.params);
  assertAssembly(parts, assemblyOpts(v.params, g.expectedSize!(v.params)));
  return parts;
}

const rejects = (id: string, over: Params, key: string): void => {
  const g = getGenerator(id)!;
  let err: unknown;
  try { g.build({ ...defaults(g.schema), ...over }); } catch (e) { err = e; }
  expect(err, `${id} ${JSON.stringify(over)}`).toBeInstanceOf(ParamError);
  expect((err as ParamError).param).toBe(key);
};

const ringOf = (pts: Vec2[]): Vec2[] => {
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-9 ? pts.slice(0, -1) : pts;
};
const inRing = (p: Vec2, r: Vec2[]): boolean => {
  let odd = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!;
    const b = r[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
  }
  return odd;
};

/**
 * Number of separate empty regions (compartments) in the plane section through `o` spanned by
 * unit vectors u, v over [0, U] x [0, V], sampled every `step` mm: a sample is solid when it lies
 * inside any part's prism; empty samples are flood-filled (4-connected). Regions smaller than
 * `minArea` mm^2 (slivers at joints) are ignored.
 */
function compartments(parts: Part[], o: Vec3, u: Vec3, v: Vec3, U: number, V: number, step: number, minArea: number): number {
  const solids = parts.map((p) => ({ p, outline: ringOf(flatten(p.nominal.outline)), holes: p.nominal.holes.map((h) => ringOf(flatten(h))) }));
  const nu = Math.floor(U / step);
  const nv = Math.floor(V / step);
  const empty = new Uint8Array(nu * nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const w: Vec3 = [0, 1, 2].map((k) => o[k]! + (i + 0.5) * step * u[k]! + (j + 0.5) * step * v[k]!) as Vec3;
    const solid = solids.some(({ p, outline, holes }) => {
      const [x, y, z] = toLocal(p.placement, w);
      if (z < 0 || z > p.thickness) return false;
      const q = { x, y };
      return inRing(q, outline) && !holes.some((h) => inRing(q, h));
    });
    empty[i * nv + j] = solid ? 0 : 1;
  }
  const seen = new Uint8Array(nu * nv);
  let count = 0;
  for (let s = 0; s < nu * nv; s++) {
    if (!empty[s] || seen[s]) continue;
    let size = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const i = Math.floor(c / nv);
      const j = c % nv;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= nu || b >= nv) continue;
        const k = a * nv + b;
        if (empty[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    if (size * step * step >= minArea) count++;
  }
  return count;
}

/** Compartments of a tray seen in the horizontal section at height z, over the inner [t, X+t] x [t, Y+t]. */
const horizontal = (parts: Part[], t: number, z: number): number => {
  const s = worldSize(parts);
  return compartments(parts, [t, t, z], [1, 0, 0], [0, 1, 0], s.x - 2 * t, s.y - 2 * t, t / 3, 4 * t * t);
};

describe('typetray', () => {
  it('outer size equals x, y, h (inside off), with and without a floor, for any grid', () => {
    for (const [cols, rows, bottom] of [[1, 1, true], [3, 2, true], [4, 3, false], [8, 8, true]] as const) {
      const parts = build('typetray', { x: 240, y: 180, h: 50, cols, rows, bottom, inside: false });
      expect(round(worldSize(parts))).toEqual([240, 180, 50]);
    }
  });
  it('inside on: x, y are one compartment and h the inner height', () => {
    const parts = build('typetray', { x: 40, y: 30, h: 35, cols: 4, rows: 3, inside: true, thickness: 3 });
    expect(round(worldSize(parts))).toEqual([4 * 40 + 5 * 3, 3 * 30 + 4 * 3, 35 + 3]);
  });
  it('compartment count = rows * cols', () => {
    for (const [cols, rows] of [[1, 1], [3, 2], [5, 4]] as const) {
      const parts = build('typetray', { x: 30, y: 30, h: 30, cols, rows, inside: true, thickness: 3 });
      expect(horizontal(parts, 3, 3 + 7)).toBe(rows * cols);
      expect(parts.filter((p) => p.id.startsWith('innerx')).length).toBe(rows - 1);
      expect(parts.filter((p) => p.id.startsWith('innery')).length).toBe(cols - 1);
    }
  });
  it('inner walls cross in crossSlot mates, one per crossing', () => {
    const parts = build('typetray', { cols: 4, rows: 3 });
    const crossings = parts.flatMap((p) => p.edges.filter((e) => e.type === 'crossSlot' && p.id.startsWith('innerx')));
    expect(crossings.length).toBe(3 * 2);
  });
  it('ParamErrors name the parameter', () => {
    rejects('typetray', { x: 20, thickness: 10 }, 'x');
    rejects('typetray', { y: 20, thickness: 10 }, 'y');
    rejects('typetray', { hi: 0.2, h: 30, thickness: 3 }, 'hi');
    rejects('typetray', { gripwidth: 0.5, gripheight: 0.3, h: 40, fingerholes: 'front', fingerhole_depth: 0.6 }, 'gripheight');
  });
});

describe('traylayout', () => {
  it('outer size equals x, y, h whatever the lists', () => {
    for (const [sx, sy] of [['', ''], ['2,1,1', '1,2'], ['1,1,2,1,1', '3,1,1,1'], ['1', '1']]) {
      const parts = build('traylayout', { x: 300, y: 200, h: 40, sx: sx!, sy: sy!, inside: false });
      expect(round(worldSize(parts))).toEqual([300, 200, 40]);
    }
  });
  it('lists override the counts: compartment count = entries(sx) * entries(sy)', () => {
    const parts = build('traylayout', { x: 300, y: 200, h: 40, cols: 7, rows: 7, sx: '2,1,1', sy: '1,2', inside: false, thickness: 3 });
    expect(horizontal(parts, 3, 3 + 10)).toBe(6);
    const eq = build('traylayout', { x: 300, y: 200, h: 40, cols: 4, rows: 2, sx: '', sy: '', inside: false, thickness: 3 });
    expect(horizontal(eq, 3, 3 + 10)).toBe(8);
  });
  it('columns follow the ratios', () => {
    const t = 3;
    const parts = build('traylayout', { x: 300, y: 200, h: 40, sx: '2,1,1', sy: '', rows: 1, inside: false, thickness: t });
    const free = 300 - 2 * t - 2 * t;
    const walls = parts.filter((p) => p.id.startsWith('innery')).map((p) => p.placement.origin[0] - t).sort((a, b) => a - b);
    expect(walls.map((v) => +v.toFixed(6))).toEqual([free / 2, free / 2 + t + free / 4].map((v) => +v.toFixed(6)));
  });
  it('bad lists are rejected naming the list', () => {
    const g = getGenerator('traylayout')!;
    expect(validate(g.schema, { ...defaults(g.schema), sx: '1,,2' }).ok).toBe(false);
    rejects('traylayout', { sx: '0,1' }, 'sx');
    rejects('traylayout', { sy: '1,1,1,1,1,1,1,1,1,1,1,1,1' }, 'sy');
    rejects('traylayout', { x: 60, sx: '1,10', thickness: 5 }, 'sx');
  });
});

describe('trayinsert', () => {
  it('fills x * y less the clearance (so it drops into a box x * y inside), compartment count = rows * cols', () => {
    for (const [cols, rows] of [[2, 2], [4, 3], [3, 6]] as const) {
      const parts = build('trayinsert', { x: 200, y: 150, h: 40, cols, rows, thickness: 3, clearance: 1 });
      expect(round(worldSize(parts))).toEqual([199, 149, 40]);
      expect(parts.length).toBe(cols - 1 + rows - 1);
      expect(compartments(parts, [0, 0, 10], [1, 0, 0], [0, 1, 0], 199, 149, 1, 36)).toBe(rows * cols);
    }
  });
  it('defaults to a positive clearance: the insert is smaller than the box inside', () => {
    const g = getGenerator('trayinsert')!;
    const d = g.schema.find((q) => q.key === 'clearance')!;
    expect(d.kind === 'number' && d.min > 0 && d.default > 0).toBe(true);
    expect(g.schema[g.schema.length - 1]!.key).toBe('clearance');
    const size = worldSize(build('trayinsert', { x: 200, y: 150 }));
    expect(size.x).toBeLessThan(200);
    expect(size.y).toBeLessThan(150);
  });
  it('ParamErrors name the parameter', () => {
    rejects('trayinsert', { x: 30, cols: 10, thickness: 3 }, 'x');
    rejects('trayinsert', { h: 10, thickness: 5 }, 'h');
  });
});

describe('dividertray', () => {
  it('outer size equals x, y, h (inside off), with and without a bottom', () => {
    for (const bottom of [false, true]) {
      const parts = build('dividertray', { x: 150, y: 200, h: 60, cols: 2, rows: 4, bottom, inside: false });
      expect(round(worldSize(parts))).toEqual([150, 200, 60]);
    }
  });
  it('compartment count = rows * cols (dividers split every column)', () => {
    for (const [cols, rows] of [[1, 3], [2, 4], [3, 2]] as const) {
      const parts = build('dividertray', { x: 50, y: 30, h: 50, cols, rows, inside: true, thickness: 3 });
      expect(parts.filter((p) => p.id.startsWith('divider')).length).toBe(rows - 1);
      expect(horizontal(parts, 3, 5)).toBe(rows * cols);
    }
  });
  it('dividers rest in the slots: each crosses every side wall, tab bottoms on the slot bottoms', () => {
    const parts = build('dividertray', { cols: 3, rows: 3, h: 60, slot_depth: 0.25 });
    for (const d of parts.filter((p) => p.id.startsWith('divider')))
      expect(d.edges.filter((e) => e.type === 'crossSlot').map((e) => e.mate!.part).sort()).toEqual(['left', 'right', 'wall1', 'wall2']);
  });
  it('ParamErrors name the parameter', () => {
    rejects('dividertray', { x: 20, thickness: 10 }, 'x');
    rejects('dividertray', { y: 10, thickness: 6 }, 'y');
    rejects('dividertray', { h: 40, thickness: 6, slot_depth: 0.5, notch_depth: 0.4 }, 'notch_depth');
  });
});

describe('compartmentbox', () => {
  it('outer size equals x, y, h (inside off) for every handle', () => {
    for (const handle of ['lip', 'hole', 'none']) {
      const parts = build('compartmentbox', { x: 200, y: 120, h: 50, cols: 3, rows: 2, handle, inside: false });
      expect(round(worldSize(parts))).toEqual([200, 120, 50]);
    }
  });
  it('compartment count = rows * cols; the lid rests on the front wall', () => {
    const parts = build('compartmentbox', { x: 40, y: 40, h: 30, cols: 3, rows: 2, inside: true, thickness: 3 });
    expect(horizontal(parts, 3, 3 + 10)).toBe(6);
    const lid = parts.find((p) => p.id === 'lid')!;
    expect(lid.edges.some((e) => e.type === 'flat' && e.mate?.part === 'front')).toBe(true);
  });
  it('ParamErrors name the parameter', () => {
    rejects('compartmentbox', { handle: 'hole', y: 20, rows: 1, radius: 15 }, 'radius');
    rejects('compartmentbox', { x: 20, thickness: 10 }, 'x');
  });
});

describe('smallpartstray', () => {
  it('outer size equals x, y, h (inside off), one- and two-sided', () => {
    for (const two_sided of [true, false]) {
      const parts = build('smallpartstray', { x: 150, y: 100, h: 30, cols: 3, two_sided, inside: false });
      expect(round(worldSize(parts))).toEqual([150, 100, 30]);
    }
  });
  it('compartment count = cols (a single row)', () => {
    for (const cols of [1, 3, 5]) {
      const parts = build('smallpartstray', { x: 40, y: 80, h: 30, cols, inside: true, thickness: 3 });
      expect(horizontal(parts, 3, 3 + 25)).toBe(cols);
    }
  });
  it('ramps rise at the requested angle to rampheight * h', () => {
    const parts = build('smallpartstray', { x: 40, y: 120, h: 40, cols: 2, angle: 40, rampheight: 0.5, inside: true });
    const ramp = parts.find((p) => p.id === 'rampfront')!;
    const v = ramp.placement.y;
    expect(+((Math.atan2(v[2], -v[1]) * 180) / Math.PI).toFixed(9)).toBe(40);
  });
  it('ParamErrors name the parameter', () => {
    rejects('smallpartstray', { x: 20, thickness: 10 }, 'x');
    rejects('smallpartstray', { rampheight: 0.8, h: 20, thickness: 2 }, 'rampheight');
  });
});

describe('bintray', () => {
  it('outer size equals x, y, h (inside off)', () => {
    for (const [cols, rows] of [[1, 1], [3, 3], [2, 5]] as const) {
      const parts = build('bintray', { x: 200, y: 160, h: 300, cols, rows, inside: false });
      expect(round(worldSize(parts))).toEqual([200, 160, 300]);
    }
  });
  it('bin count = rows * cols (vertical section through the bins)', () => {
    for (const [cols, rows] of [[1, 1], [3, 2], [2, 4]] as const) {
      const parts = build('bintray', { x: 50, h: 40, y: 80, cols, rows, front: 0.4, inside: true, thickness: 3 });
      const s = worldSize(parts);
      // Plane y = back - 20 mm (behind the retainers), x across and z up, inside the side walls, top and bottom.
      const n = compartments(parts, [3, s.y - 3 - 20, 3], [1, 0, 0], [0, 0, 1], s.x - 6, s.z - 6, 1, 36);
      expect(n).toBe(rows * cols);
    }
  });
  it('ParamErrors name the parameter', () => {
    rejects('bintray', { x: 20, thickness: 10 }, 'x');
    rejects('bintray', { front: 0.9, h: 20, thickness: 3 }, 'front');
  });
});

/** Widths of the slot bottoms of a part: horizontal outline runs well inside its bounding box. */
function slotWidths(part: Part, t: number): number[] {
  const pts = ringOf(flatten(part.nominal.outline));
  const inside = (v: number[], q: number): boolean => q > Math.min(...v) + 1.5 * t && q < Math.max(...v) - 1.5 * t;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const out: number[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    if (Math.abs(a.y - b.y) < 1e-9 && inside(ys, a.y) && inside(xs, a.x) && inside(xs, b.x)) out.push(Math.abs(b.x - a.x));
  });
  return out;
}

describe('crossing slots', () => {
  it('are t + play wide (centred), so the crossing panel slides in with the joint play', () => {
    const t = 3;
    const cases: [string, string[], Params][] = [
      ['trayinsert', ['dividerx', 'dividery'], {}],
      ['typetray', ['innerx', 'innery'], { cols: 3, rows: 3 }],
      ['bintray', ['shelf'], {}],
      ['dividertray', ['left', 'right'], {}],
      ['laptopstand', ['plate'], {}],
    ];
    for (const play of [0, 0.1]) for (const [id, prefixes, over] of cases) {
      const parts = build(id, { ...over, thickness: t, play }).filter((q) => prefixes.some((pre) => q.id.startsWith(pre)));
      expect(parts.length, id).toBeGreaterThan(0);
      for (const part of parts) {
        const w = slotWidths(part, t);
        expect(w.length, `${id} ${part.id}`).toBeGreaterThan(0);
        for (const v of w) expect(v, `${id} ${part.id} play ${play}`).toBeCloseTo(t + play * t, 9);
      }
    }
  });
  it('bintray: the divider half of each shelf crossing is t + play wide too, centred on the shelf', () => {
    const t = 3;
    for (const play of [0, 0.1, 0.5]) {
      const y = 100;
      const parts = build('bintray', { y, rows: 3, thickness: t, play });
      for (const d of parts.filter((q) => q.id.startsWith('divider'))) {
        // Slot bottoms: vertical outline runs at local x = y / 2 (half the depth in from the front).
        const pts = ringOf(flatten(d.nominal.outline));
        const runs: [number, number][] = [];
        pts.forEach((a, i) => {
          const b = pts[(i + 1) % pts.length]!;
          if (Math.abs(a.x - y / 2) < 1e-9 && Math.abs(b.x - y / 2) < 1e-9) runs.push([Math.min(a.y, b.y), Math.max(a.y, b.y)]);
        });
        expect(runs.length, d.id).toBe(2);
        for (const [lo, hi] of runs) expect(hi - lo).toBeCloseTo(t + play * t, 9);
      }
    }
  });
});
