import { describe, expect, it } from 'vitest';
import { mat3Translate, transform, type Path, type Vec2 } from '../../src/core/geometry';
import { fingerHolesFor, fingerJoint } from '../../src/core/edges/finger';
import type { EdgeCtx } from '../../src/core/edges/types';
import { Turtle } from '../../src/core/turtle';
import type { EdgeType } from '../../src/core/edges';
import { finishPart, type Generator, type Part, type Placement } from '../../src/core/part';
import { commonParams, defaults, effectiveKerf, type Params, type Schema } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { assemblyOpts, assertAssembly, assertValidParts, RegionIndex } from './invariants';
import { fuzz, prng } from './fuzz';

const rect = (w: number, h: number, x = 0, y = 0): Path => ({
  start: { x, y },
  segs: [
    { t: 'L', to: { x: x + w, y } }, { t: 'L', to: { x: x + w, y: y + h } },
    { t: 'L', to: { x, y: y + h } }, { t: 'L', to: { x, y } },
  ],
  closed: true,
});

type FixtureOpts = {
  /** Extra gap between the bottom and the wall's inner face (negative = overlap). */
  gap?: number;
  /** Moves the wall along +y (shifting its joint line). */
  wallShift?: number;
  /** Wall normal points OUT of the box (violates the convention: thickness away from the joint). */
  wallOutward?: boolean;
  /** Bottom runs under the wall instead of butting against its inner face. */
  noInset?: boolean;
  /** Wall outline width (default w). */
  wallWidth?: number;
  types?: [EdgeType, EdgeType];
  mated?: boolean;
};

/**
 * Hand-built two-part fixture following the generator convention (z=0 = outer face, n into the
 * box). A w x h front wall stands in the XZ plane with its outer face at y=0 and thickness along
 * +y; a bottom plate (outer face z=0, thickness +z) butts against the wall's inner face y=t and
 * spans to y=d. Both side 0 joint lines are the outer corner line (0,0,0)-(w,0,0); for the bottom
 * that line lies one thickness outside its outline. World bbox: w x d x h.
 */
function twoParts(w: number, d: number, h: number, t: number, kerf: number, o: FixtureOpts = {}): Part[] {
  const s = o.wallShift ?? 0;
  const inset = o.noInset ? 0 : t + (o.gap ?? 0);
  const bh = d - inset;
  const [ta, tb] = o.types ?? ['flat', 'flat'];
  const mated = o.mated ?? true;
  const bottomPl: Placement = { origin: [0, inset, 0], x: [1, 0, 0], y: [0, 1, 0] }; // n = +z
  const wallPl: Placement = o.wallOutward
    ? { origin: [0, s, 0], x: [1, 0, 0], y: [0, 0, 1] } // n = -y: out of the box
    : { origin: [w, s, 0], x: [-1, 0, 0], y: [0, 0, 1] }; // n = +y: into the box
  const bottom = finishPart({
    id: 'bottom', name: 'Bottom', outline: rect(w, bh), holes: [rect(w / 4, bh / 4, w / 4, bh / 4)], engrave: [],
    placement: bottomPl, thickness: t,
    edges: [{ side: 0, type: ta, from: { x: 0, y: -inset }, to: { x: w, y: -inset }, ...(mated ? { mate: { part: 'wall', side: 0 } } : {}) }],
  }, kerf);
  const wall = finishPart({
    id: 'wall', name: 'Wall', outline: rect(o.wallWidth ?? w, h), holes: [], engrave: [],
    placement: wallPl, thickness: t,
    edges: [{ side: 0, type: tb, from: { x: 0, y: 0 }, to: { x: w, y: 0 }, ...(mated ? { mate: { part: 'bottom', side: 0 } } : {}) }],
  }, kerf);
  return [bottom, wall];
}

const P = defaults(commonParams); // thickness 3, kerf 0.1, burn true
const valid = (): Part[] => twoParts(100, 50, 30, 3, effectiveKerf(P));

describe('assertValidParts', () => {
  it('passes the hand-built fixture', () => {
    expect(() => assertValidParts(valid(), P)).not.toThrow();
  });

  it('rejects NaN coordinates', () => {
    const parts = valid();
    parts[0]!.outline.segs[1] = { t: 'L', to: { x: NaN, y: 50 } };
    expect(() => assertValidParts(parts, P)).toThrow(/finite/);
  });

  it('rejects open and self-intersecting outlines', () => {
    const open = valid();
    open[0]!.outline = { ...open[0]!.outline, closed: false };
    expect(() => assertValidParts(open, P)).toThrow(/closed/);
    const bow = valid();
    bow[1]!.outline = { start: { x: 0, y: 0 }, segs: [{ t: 'L', to: { x: 10, y: 10 } }, { t: 'L', to: { x: 10, y: 0 } }, { t: 'L', to: { x: 0, y: 10 } }, { t: 'L', to: { x: 0, y: 0 } }], closed: true };
    expect(() => assertValidParts(bow, P)).toThrow(/simple/);
  });

  it('rejects clockwise outlines and holes outside the outline', () => {
    const cw = twoParts(100, 50, 30, 3, 0);
    const o = cw[1]!.outline;
    cw[1]!.outline = { start: o.start, closed: true, segs: [{ t: 'L', to: { x: 0, y: 30 } }, { t: 'L', to: { x: 100, y: 30 } }, { t: 'L', to: { x: 100, y: 0 } }, { t: 'L', to: { x: 0, y: 0 } }] };
    cw[1]!.nominal = { outline: cw[1]!.outline, holes: [] };
    expect(() => assertValidParts(cw, { ...P, kerf: 0 })).toThrow(/counter-clockwise/);
    const out = twoParts(100, 50, 30, 3, 0);
    out[1]!.holes = [rect(10, 10, 95, 5)];
    out[1]!.nominal = { outline: out[1]!.outline, holes: out[1]!.holes };
    expect(() => assertValidParts(out, { ...P, kerf: 0 })).toThrow(/hole/);
  });

  it('verifies kerf was applied (from params.kerf/burn, or opts.kerf)', () => {
    const raw = twoParts(100, 50, 30, 3, 0);
    expect(() => assertValidParts(raw, P)).toThrow(/kerf/);
    expect(() => assertValidParts(raw, { ...P, burn: false })).not.toThrow();
    expect(() => assertValidParts(raw, P, { kerf: 0 })).not.toThrow();
    // claims kerf but the outline was not actually offset
    const liar = twoParts(100, 50, 30, 3, 0).map((p) => ({ ...p, kerf: 0.1 }));
    expect(() => assertValidParts(liar, P)).toThrow(/kerf/);
  });

  it('rejects thickness mismatch, duplicate ids and dangling mates', () => {
    expect(() => assertValidParts(valid(), { ...P, thickness: 4 })).toThrow(/thickness/);
    const dup = valid();
    dup[1]!.id = 'bottom';
    expect(() => assertValidParts(dup, P)).toThrow(/duplicate/);
    const dangling = valid();
    dangling[0]!.edges[0]!.mate = { part: 'ghost', side: 0 };
    expect(() => assertValidParts(dangling, P)).toThrow(/mate/);
  });

  it('rejects non-orthonormal placements', () => {
    const parts = valid();
    parts[0]!.placement = { origin: [0, 0, 0], x: [2, 0, 0], y: [0, 1, 0] };
    expect(() => assertValidParts(parts, P)).toThrow(/placement/);
  });
});

describe('assertAssembly', () => {
  it('passes the hand-built fixture', () => {
    expect(() => assertAssembly(valid())).not.toThrow();
  });

  it('fails when a mate is offset by 0.5 mm', () => {
    expect(() => assertAssembly(twoParts(100, 50, 30, 3, 0.1, { wallShift: 0.5 }))).toThrow(/mate/);
  });

  it('tolerates mate error under 0.01 mm', () => {
    expect(() => assertAssembly(twoParts(100, 50, 30, 3, 0.1, { wallShift: 0.005 }))).not.toThrow();
  });

  it('requires connected parts unless the assembly is loose (still checking interpenetration)', () => {
    const apart = twoParts(100, 50, 30, 3, 0.1, { mated: false });
    expect(() => assertAssembly(apart)).toThrow(/not connected/);
    expect(() => assertAssembly(apart, { loose: true })).not.toThrow();
    expect(assemblyOpts({ thickness: 3, play: 0 }, undefined, true).loose).toBe(true);
    expect(() => assertAssembly(twoParts(100, 50, 30, 3, 0.1, { mated: false, noInset: true }), { loose: true })).toThrow(/interpenetrat/);
  });

  it('fails on interpenetration even when mates coincide', () => {
    expect(() => assertAssembly(twoParts(100, 50, 30, 3, 0.1, { noInset: true }))).toThrow(/interpenetrat/);
  });

  it('fails on non-complementary or one-sided mates', () => {
    const parts = valid();
    parts[1]!.edges[0]!.type = 'finger';
    expect(() => assertAssembly(parts)).toThrow(/complement/);
    const one = valid();
    delete one[1]!.edges[0]!.mate;
    expect(() => assertAssembly(one)).toThrow(/mate/);
  });
});

// ---------------- fuzz harness on tiny fixture generators ----------------

const trayParams: Schema = [
  { key: 'w', label: 'Width', help: '', unit: 'mm', group: 'Size', kind: 'number', min: 20, max: 300, default: 100, step: 1 },
  { key: 'd', label: 'Depth', help: '', unit: 'mm', group: 'Size', kind: 'number', min: 20, max: 300, default: 50, step: 1 },
  { key: 'h', label: 'Height', help: '', unit: 'mm', group: 'Size', kind: 'number', min: 10, max: 200, default: 30, step: 1 },
  ...commonParams,
];

const gen = (build: (p: Params) => Part[], extra: Partial<Generator> = {}): Generator => ({
  id: 'fixture', name: 'Fixture', category: 'test', description: 'two plates', schema: trayParams, presets: {}, build,
  expectedSize: (p) => ({ x: p.w as number, y: p.d as number, z: p.h as number }),
  ...extra,
});

const goodBuild = (p: Params): Part[] => {
  const t = p.thickness as number;
  if ((p.w as number) < 10 * t) throw new ParamError('w must be >= 10 * thickness');
  if ((p.d as number) < 3 * t) throw new ParamError('d must be >= 3 * thickness');
  if ((p.h as number) < 2 * t) throw new ParamError('h must be >= 2 * thickness');
  return twoParts(p.w as number, p.d as number, p.h as number, t, effectiveKerf(p));
};

describe('fuzz', () => {
  it('passes a correct generator, counting ParamError rejections; deterministic per seed', () => {
    const a = fuzz(gen(goodBuild), 60, 1234);
    expect(a.ok).toBeGreaterThan(0);
    expect(a.rejected).toBeGreaterThan(0); // max thickness corner: w=100 < 200
    expect(a.ok + a.rejected).toBe(a.cases);
    expect(fuzz(gen(goodBuild), 60, 1234)).toEqual(a);
  });

  it('fails when the generator yields NaN for some params', () => {
    const bad = gen((p) => {
      const parts = goodBuild(p);
      if ((p.h as number) > 150) parts[1]!.outline.segs[0] = { t: 'L', to: { x: NaN, y: 0 } };
      return parts;
    });
    expect(() => fuzz(bad, 60, 7)).toThrow(/seed 7/);
  });

  it('fails on any non-ParamError exception', () => {
    const bad = gen((p) => {
      if ((p.d as number) > 250) throw new RangeError('boom');
      return goodBuild(p);
    });
    expect(() => fuzz(bad, 60, 3)).toThrow(/boom/);
  });

  it('fails when parts interpenetrate for some params', () => {
    const bad = gen((p) => {
      const parts = goodBuild(p);
      return (p.h as number) < 30 ? twoParts(p.w as number, p.d as number, p.h as number, p.thickness as number, effectiveKerf(p), { noInset: true }) : parts;
    });
    expect(() => fuzz(bad, 60, 11)).toThrow(/interpenetrat/);
  });

  it('fails when the defaults are rejected', () => {
    expect(() => fuzz(gen(() => { throw new ParamError('never'); }), 5, 1)).toThrow(/defaults/);
  });
});

// ---------------------------------------------------------------- fix round 1 coverage

describe('joint line vs outline (C1)', () => {
  it('fails when the outline is shifted away from its declared joint line', () => {
    // bottom pulled 1 mm back from the wall: its joint line is now t+1 from the outline
    expect(() => assertValidParts(twoParts(100, 50, 30, 3, 0.1, { gap: 1 }), P)).toThrow(/joint line/);
  });

  it('fails when the outline is too short for its joint line', () => {
    expect(() => assertValidParts(twoParts(100, 50, 30, 3, 0.1, { wallWidth: 95 }), P)).toThrow(/joint line/);
  });

  it('allows thickness + play of slack', () => {
    const p = { ...P, play: 0.1 }; // 0.3 mm
    expect(() => assertValidParts(twoParts(100, 50, 30, 3, 0.1, { gap: 0.2 }), p)).not.toThrow();
  });
});

describe('contact at mates (C2)', () => {
  it('fails when a part\'s thickness points away from the joint (outward normal)', () => {
    const parts = twoParts(100, 50, 30, 3, 0.1, { wallOutward: true });
    expect(() => assertValidParts(parts, P)).not.toThrow();
    expect(() => assertAssembly(parts)).toThrow(/contact/);
  });

  it('fails on a gapped mate whose lines still coincide', () => {
    const parts = twoParts(100, 50, 30, 3, 0.1, { gap: 0.2 });
    expect(() => assertValidParts(parts, { ...P, play: 0.1 })).not.toThrow();
    expect(() => assertAssembly(parts)).toThrow(/contact.*gap 0\.2/);
  });
});

describe('mates required and connectivity (I2)', () => {
  it('joint edges need a mate unless open', () => {
    const loose = twoParts(100, 50, 30, 3, 0.1, { types: ['finger', 'fingerHole'], mated: false });
    expect(() => assertValidParts(loose, P)).toThrow(/needs a mate/);
    const open = loose.map((p) => ({ ...p, edges: p.edges.map((e) => ({ ...e, open: true })) }));
    expect(() => assertValidParts(open, P)).not.toThrow();
    const both = valid().map((p) => ({ ...p, edges: p.edges.map((e) => ({ ...e, open: true })) }));
    expect(() => assertValidParts(both, P)).toThrow(/open edge/);
  });

  it('plain edges may stay unmated', () => {
    expect(() => assertValidParts(twoParts(100, 50, 30, 3, 0.1, { mated: false }), P)).not.toThrow();
  });

  it('fails when a part is not connected through mates', () => {
    const stray = finishPart({
      id: 'stray', name: 'Stray', outline: rect(10, 10), holes: [], engrave: [],
      placement: { origin: [500, 0, 0], x: [1, 0, 0], y: [0, 1, 0] }, thickness: 3, edges: [],
    }, 0.1);
    const parts = [...valid(), stray];
    expect(() => assertValidParts(parts, P)).not.toThrow();
    expect(() => assertAssembly(parts)).toThrow(/not connected.*stray/);
  });
});

describe('dimensions gate (I3)', () => {
  it('checks world bbox extents against expectedSize', () => {
    expect(() => assertAssembly(valid(), { expectedSize: { x: 100, y: 50, z: 30 } })).not.toThrow();
    expect(() => assertAssembly(valid(), { expectedSize: { x: 100, y: 50.02, z: 30 } })).toThrow(/size y/);
  });

  it('fuzz enforces Generator.expectedSize', () => {
    const wrong = gen(goodBuild, { expectedSize: (p) => ({ x: (p.w as number) + 1, y: p.d as number, z: p.h as number }) });
    expect(() => fuzz(wrong, 10, 5)).toThrow(/size x/);
  });
});

describe('fuzz acceptance (I4) and presets (I5)', () => {
  const onlyDefaults = (p: Params): Part[] => {
    if (p.w !== 100 || p.thickness !== 3) throw new ParamError('w must be 100 and thickness 3');
    return goodBuild(p);
  };

  it('fails when nearly everything except the defaults is rejected', () => {
    expect(() => fuzz(gen(onlyDefaults), 40, 9)).toThrow(/accepted/);
  });

  it('allowManyRejections opts out of the acceptance ratio', () => {
    const r = fuzz(gen(onlyDefaults), 40, 9, { allowManyRejections: true });
    expect(r.rejected).toBeGreaterThan(r.ok);
  });

  it('ParamError messages must be non-empty and name a parameter key', () => {
    const empty = gen((p) => { if ((p.h as number) > 190) throw new ParamError(''); return goodBuild(p); });
    expect(() => fuzz(empty, 20, 2)).toThrow(/empty message/);
    const vague = gen((p) => { if ((p.h as number) > 190) throw new ParamError('too big'); return goodBuild(p); });
    expect(() => fuzz(vague, 20, 2)).toThrow(/names no parameter key/);
  });

  it('runs every preset: valid presets pass, invalid or rejected presets fail', () => {
    const ok = fuzz(gen(goodBuild, { presets: { big: { w: 250, d: 200, h: 120 } } }), 10, 4);
    expect(ok.ok).toBeGreaterThan(0);
    expect(() => fuzz(gen(goodBuild, { presets: { bad: { w: 1000 } } }), 10, 4)).toThrow(/preset bad.*validation/);
    expect(() => fuzz(gen(goodBuild, { presets: { thin: { w: 20, thickness: 5 } } }), 10, 4)).toThrow(/rejected a preset/);
    const broken = gen((p) => (p.w === 222 ? twoParts(222, 50, 30, 3, 0.1, { noInset: true }) : goodBuild(p)),
      { presets: { odd: { w: 222 } } });
    expect(() => fuzz(broken, 10, 4)).toThrow(/preset odd.*interpenetrat/s);
  });
});

describe('interpenetration resolution (I6)', () => {
  it('detects a 0.03 mm overlap', () => {
    const t0 = performance.now();
    expect(() => assertAssembly(twoParts(100, 50, 30, 3, 0.1, { gap: -0.03 }))).toThrow(/interpenetrat/);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
  });

  it('a 0.004 mm overlap is within margin (contact)', () => {
    expect(() => assertAssembly(twoParts(100, 50, 30, 3, 0.1, { gap: -0.004 }))).not.toThrow();
  });

  /**
   * Two coplanar plates side by side (parallel parts, whose depth samples share their in-plane
   * point, so the 2D test runs once per sample), butting along x = 100 + dx; the joint line stays at
   * x = 100.
   */
  const coplanar = (dx: number): Part[] => {
    const plate = (id: string, x0: number, lx: number, mate: string): Part => finishPart({
      id, name: id, outline: rect(100, 50), holes: [rect(20, 10, 40, 20)], engrave: [],
      placement: { origin: [x0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] }, thickness: 3,
      edges: [{ side: 0, type: 'flat', from: { x: lx, y: 0 }, to: { x: lx, y: 50 }, mate: { part: mate, side: 0 } }],
    }, 0);
    return [plate('a', 0, 100, 'b'), plate('b', 100 + dx, -dx, 'a')];
  };

  it('coplanar parts: butting passes, a 0.03 mm overlap fails', () => {
    expect(() => assertAssembly(coplanar(0))).not.toThrow();
    expect(() => assertAssembly(coplanar(0.004 - 0.008))).not.toThrow();
    expect(() => assertAssembly(coplanar(-0.03))).toThrow(/interpenetrat/);
    expect(() => assertAssembly(coplanar(-30))).toThrow(/interpenetrat/);
  });
});

describe('contact on finger outlines (non-convex sections)', () => {
  /**
   * One finger (x in [2, 8]) of a bottom plate in the matching notch of a front wall, joint line
   * 10 mm long. The 25 % sample (x = 2.5) lies 0.5 mm from the finger side: a 3D-distance search
   * sees a 0.5 mm plateau inside the notch and misses the face contact at the notch top.
   */
  it('finds contact next to a finger side', () => {
    const t = 3;
    const poly = (pts: [number, number][]): Path => ({
      start: { x: pts[0]![0], y: pts[0]![1] }, closed: true,
      segs: [...pts.slice(1), pts[0]!].map(([x, y]) => ({ t: 'L' as const, to: { x, y } })),
    });
    const bottom = finishPart({
      id: 'bottom', name: 'Bottom', holes: [], engrave: [], thickness: t,
      outline: poly([[0, 0], [2, 0], [2, -t], [8, -t], [8, 0], [10, 0], [10, 20], [0, 20]]),
      placement: { origin: [0, t, 0], x: [1, 0, 0], y: [0, 1, 0] },
      edges: [{ side: 0, type: 'finger', from: { x: 0, y: -t }, to: { x: 10, y: -t }, mate: { part: 'wall', side: 0 } }],
    }, 0);
    const wall = finishPart({
      id: 'wall', name: 'Wall', holes: [], engrave: [], thickness: t,
      outline: poly([[0, 0], [2, 0], [2, t], [8, t], [8, 0], [10, 0], [10, 30], [0, 30]]),
      placement: { origin: [10, 0, 0], x: [-1, 0, 0], y: [0, 0, 1] },
      edges: [{ side: 0, type: 'fingerHole', from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, mate: { part: 'bottom', side: 0 } }],
    }, 0);
    expect(() => assertValidParts([bottom, wall], { ...P, kerf: 0 })).not.toThrow();
    expect(() => assertAssembly([bottom, wall])).not.toThrow();
  });
});

describe('non-finite and degenerate mates fail loudly', () => {
  it('NaN in a placement fails the mate check instead of passing silently', () => {
    const parts = valid();
    parts[1]!.placement = { ...parts[1]!.placement, origin: [NaN, 0, 0] };
    expect(() => assertAssembly(parts)).toThrow(/mate.*NaN/);
  });

  it('a joint line not lying in the mating part\'s plane is reported', () => {
    // 5 um lines: endpoints coincide within tol, but the line runs along the wall's normal
    const parts = twoParts(100, 50, 30, 3, 0);
    parts[0]!.edges[0] = { ...parts[0]!.edges[0]!, from: { x: 0, y: -3 }, to: { x: 0, y: -3.005 } };
    parts[1]!.edges[0] = { ...parts[1]!.edges[0]!, from: { x: 100, y: 0 }, to: { x: 100, y: 0.004 } };
    expect(() => assertAssembly(parts)).toThrow(/not in the plane/);
  });
});

describe('RegionIndex', () => {
  it('matches brute-force even-odd and boundary distance on a finger outline with a hole', () => {
    // 120 x 40 plate, 30 fingers on the bottom (protruding) and 30 notches on the top, one square hole
    const pts: Vec2[] = [{ x: 0, y: 0 }];
    for (let i = 0; i < 30; i++) pts.push({ x: 4 * i + 1, y: 0 }, { x: 4 * i + 1, y: -3 }, { x: 4 * i + 3, y: -3 }, { x: 4 * i + 3, y: 0 });
    pts.push({ x: 120, y: 0 }, { x: 120, y: 40 });
    for (let i = 29; i >= 0; i--) pts.push({ x: 4 * i + 3, y: 40 }, { x: 4 * i + 3, y: 37 }, { x: 4 * i + 1, y: 37 }, { x: 4 * i + 1, y: 40 });
    pts.push({ x: 0, y: 40 });
    const hole: Vec2[] = [{ x: 50, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 20 }, { x: 50, y: 20 }];
    const rings = [pts, hole];
    const evenOdd = (p: Vec2, r: Vec2[]): boolean => {
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i]!; const b = r[j]!;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    const dist = (p: Vec2): number => Math.min(...rings.flatMap((r) => r.map((a, i) => {
      const b = r[(i + 1) % r.length]!;
      const dx = b.x - a.x; const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    })));
    const idx = new RegionIndex(rings);
    const r = prng(42);
    const grid = [-5, -3, 0, 1, 3, 10, 20, 37, 40, 45].flatMap((y) => [-5, 0, 1, 2, 3, 50, 55, 60, 119, 120, 125].map((x) => ({ x, y })));
    for (const p of [...grid, ...Array.from({ length: 3000 }, () => ({ x: -10 + 140 * r(), y: -10 + 60 * r() }))]) {
      expect(idx.inside(p), `inside ${JSON.stringify(p)}`).toBe(evenOdd(p, pts) && !evenOdd(p, hole));
      for (const m of [1e-9, 0.005, 0.7, 4]) expect(idx.near(p, m), `near ${m} ${JSON.stringify(p)}`).toBe(dist(p) <= m);
    }
  });
});

describe('joint play tolerance at mates', () => {
  it('a mate gap of exactly play passes; play + 0.05 fails; interpenetration is unaffected', () => {
    const play = 0.2;
    const p = { ...P, play: play / 3 };
    const exact = twoParts(100, 50, 30, 3, 0.1, { gap: play });
    expect(() => assertValidParts(exact, p)).not.toThrow();
    expect(() => assertAssembly(exact, { play })).not.toThrow();
    expect(() => assertAssembly(exact)).toThrow(/contact/);
    const wide = twoParts(100, 50, 30, 3, 0.1, { gap: play + 0.05 });
    expect(() => assertAssembly(wide, { play })).toThrow(/contact.*gap 0\.25/);
    expect(() => assertAssembly(twoParts(100, 50, 30, 3, 0.1, { gap: -0.03 }), { play })).toThrow(/interpenetrate/);
  });

  it('assemblyOpts derives play in mm from params', () => {
    expect(assemblyOpts({ ...P, play: 0.1, thickness: 4 })).toEqual({ play: 0.4 * 1 });
    expect(assemblyOpts(P, { x: 1, y: 2, z: 3 })).toEqual({ play: 0, expectedSize: { x: 1, y: 2, z: 3 } });
  });
});

/**
 * Interior-joint fixture: a 100 x 60 plate (outer face z=0, n=+z) with a row of finger slots in its
 * middle, and a divider standing on it (outer face y=c, n=+y) whose bottom fingers pass through the
 * slots. The joint line is the divider's outer face at the plate's bottom: (x0, c, 0)-(x0+L, c, 0).
 */
function divider(o: { play?: number; shiftY?: number; lineShift?: number; holeIdx?: number[] } = {}): Part[] {
  const t = 3;
  const ctx: EdgeCtx = { thickness: t, kerf: 0, finger: 6, space: 6, surroundingSpaces: 2, play: o.play ?? 0 };
  const x0 = 20;
  const L = 60;
  const c = 30;
  const slots = fingerHolesFor(L, ctx).map((s) => transform(s, mat3Translate(x0, c + t / 2)));
  const ls = o.lineShift ?? 0;
  const plate = finishPart({
    id: 'plate', name: 'Plate', outline: rect(100, 60), holes: slots, engrave: [],
    placement: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] }, thickness: t,
    edges: [{ side: 4, type: 'fingerHole', from: { x: x0, y: c + ls }, to: { x: x0 + L, y: c + ls },
      holes: o.holeIdx ?? slots.map((_, i) => i), mate: { part: 'divider', side: 0 } }],
  }, 0);
  const tu = new Turtle();
  fingerJoint(tu, L, ctx);
  tu.turn(90); tu.forward(40); tu.turn(90); tu.forward(L); tu.turn(90); tu.forward(40);
  const div = finishPart({
    id: 'divider', name: 'Divider', outline: tu.toPath(true), holes: [], engrave: [],
    placement: { origin: [x0 + L, c + (o.shiftY ?? 0), t], x: [-1, 0, 0], y: [0, 0, 1] }, thickness: t,
    edges: [{ side: 0, type: 'finger', from: { x: 0, y: -t }, to: { x: L, y: -t }, mate: { part: 'plate', side: 4 } }],
  }, 0);
  return [plate, div];
}

describe('interior joints (slot rows in the middle of a plate)', () => {
  const p0 = { ...P, kerf: 0 };
  it('a divider in its slot row passes (with and without play)', () => {
    const parts = divider();
    expect(parts[0]!.holes.length).toBeGreaterThan(2);
    expect(() => assertValidParts(parts, p0)).not.toThrow();
    expect(() => assertAssembly(parts)).not.toThrow();
    const loose = divider({ play: 0.3 });
    const pl = { ...p0, play: 0.1 };
    expect(() => assertValidParts(loose, pl)).not.toThrow();
    expect(() => assertAssembly(loose, assemblyOpts(pl))).not.toThrow();
  });

  it('a divider offset from its slot row fails', () => {
    for (const shiftY of [1, -1.5]) {
      const parts = divider({ shiftY });
      expect(() => assertAssembly(parts)).toThrow(/joint lines differ|interpenetrate/);
    }
  });

  it('a plate joint line declared away from its slots fails, as do bad hole references', () => {
    expect(() => assertValidParts(divider({ lineShift: 5 }), p0)).toThrow(/hole 0 lies/);
    expect(() => assertValidParts(divider({ holeIdx: [99] }), p0)).toThrow(/missing hole 99/);
    expect(() => assertValidParts(divider({ holeIdx: [] }), p0)).toThrow(/at least one hole/);
  });
});

/**
 * Egg-crate fixture: plate A (60 x 30, along x, z = 0 face at y = 30, thickness towards -y) with a
 * slot from the top at x in [30, 33]; plate B (60 x 30, along y, z = 0 face at x = 30, thickness
 * +x) with a slot from the bottom at y in [27, 30]. The slots meet at half height; the crossSlot
 * joint line is the plates' common line x = 30, y = 30 around z = 15.
 */
function eggCrate(o: { slotA?: number; slotB?: number; shiftB?: number; lineZ?: number; mated?: boolean; declared?: boolean } = {}): Part[] {
  const t = 3;
  const sA = o.slotA ?? 15;
  const sB = o.slotB ?? 15;
  const z = o.lineZ ?? 15;
  const mated = o.mated ?? true;
  const declared = o.declared ?? true;
  const poly = (pts: [number, number][]): Path => ({
    start: { x: pts[0]![0], y: pts[0]![1] }, closed: true,
    segs: [...pts.slice(1), pts[0]!].map(([x, y]) => ({ t: 'L' as const, to: { x, y } })),
  });
  const a = finishPart({
    id: 'a', name: 'A', outline: poly([[0, 0], [60, 0], [60, 30], [33, 30], [33, 30 - sA], [30, 30 - sA], [30, 30], [0, 30]]),
    holes: [], engrave: [], placement: { origin: [0, 30, 0], x: [1, 0, 0], y: [0, 0, 1] }, thickness: t,
    edges: declared ? [{ side: 9, type: 'crossSlot', from: { x: 30, y: z - t }, to: { x: 30, y: z + t }, ...(mated ? { mate: { part: 'b', side: 9 } } : {}) }] : [],
  }, 0);
  const b = finishPart({
    id: 'b', name: 'B', outline: poly([[0, 0], [27, 0], [27, sB], [30, sB], [30, 0], [60, 0], [60, 30], [0, 30]]),
    holes: [], engrave: [], placement: { origin: [30 + (o.shiftB ?? 0), 0, 0], x: [0, 1, 0], y: [0, 0, 1] }, thickness: t,
    edges: declared ? [{ side: 9, type: 'crossSlot', from: { x: 30, y: z - t }, to: { x: 30, y: z + t }, ...(mated ? { mate: { part: 'a', side: 9 } } : {}) }] : [],
  }, 0);
  return [a, b];
}

describe('crossing-slot joints (egg-crate)', () => {
  const p0 = { ...P, kerf: 0 };
  it('two plates crossing in matching half-height slots pass', () => {
    const parts = eggCrate();
    expect(() => assertValidParts(parts, p0)).not.toThrow();
    expect(() => assertAssembly(parts, { expectedSize: { x: 60, y: 60, z: 30 } })).not.toThrow();
  });

  it('slots that do not reach each other interpenetrate', () => {
    expect(() => assertAssembly(eggCrate({ slotA: 12 }))).toThrow(/interpenetrate/);
    expect(() => assertAssembly(eggCrate({ slotB: 12 }))).toThrow(/interpenetrate/);
  });

  it('a plate shifted off its slot fails', () => {
    for (const shiftB of [1, -1]) expect(() => assertAssembly(eggCrate({ shiftB }))).toThrow(/joint lines differ|interpenetrate/);
  });

  it('a crossing line declared away from the slots fails the joint-line check', () => {
    expect(() => assertValidParts(eggCrate({ lineZ: 5 }), p0)).toThrow(/joint line is .* from the nominal outline/);
  });

  it('a crossSlot edge must be mated, and crossings are what connects the plates', () => {
    expect(() => assertValidParts(eggCrate({ mated: false }), p0)).toThrow(/crossSlot needs a mate/);
    expect(() => assertAssembly(eggCrate({ declared: false }))).toThrow(/not connected/);
  });
});

describe('resting mates on the inner face (PartEdge.face)', () => {
  /** A wall (outer face y = 0, n = +y) standing on a plate's inner face z = t, flat mate along y = 0. */
  function standing(face: 'inner' | undefined, type: EdgeType = 'flat'): Part[] {
    const t = 3;
    const plate = finishPart({
      id: 'plate', name: 'Plate', outline: rect(100, 50), holes: [], engrave: [],
      placement: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] }, thickness: t,
      edges: [{ side: 0, type, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, ...(face ? { face } : {}), mate: { part: 'wall', side: 0 } }],
    }, 0);
    const wall = finishPart({
      id: 'wall', name: 'Wall', outline: rect(100, 30), holes: [], engrave: [],
      placement: { origin: [100, 0, t], x: [-1, 0, 0], y: [0, 0, 1] }, thickness: t,
      edges: [{ side: 0, type: complementOf(type), from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, mate: { part: 'plate', side: 0 } }],
    }, 0);
    return [plate, wall];
  }
  const complementOf = (e: EdgeType): EdgeType => (e === 'finger' ? 'fingerHole' : e);
  const p0 = { ...P, kerf: 0 };

  it('accepts a line on the touching (inner) face', () => {
    const parts = standing('inner');
    expect(() => assertValidParts(parts, p0)).not.toThrow();
    expect(() => assertAssembly(parts)).not.toThrow();
  });

  it('rejects the same mate declared on the z = 0 face (one thickness off the contact)', () => {
    expect(() => assertAssembly(standing(undefined))).toThrow(/joint lines differ/);
  });

  it('allows the inner face only for flat outline lines', () => {
    expect(() => assertValidParts(standing('inner', 'finger'), p0)).toThrow(/inner face/);
    const bad = standing('inner');
    (bad[0]!.edges[0] as { face: string }).face = 'outer';
    expect(() => assertValidParts(bad, p0)).toThrow(/face must be/);
  });
});
