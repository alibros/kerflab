/**
 * "Lids & hinges" batch: one headline-dimension test per generator (the registry loop in
 * suite.ts covers invariants, presets, snapshots and fuzz), plus the batch extra: the lid clears
 * the body by its play, measured on the assembled model that passes assertAssembly.
 */
import { describe, expect, it } from 'vitest';
import { bounds, flatten } from '../../src/core/geometry';
import { toWorld, type Part } from '../../src/core/part';
import { defaults, validate, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { getGenerator } from '../../src/generators';
import { hingeDims } from '../../src/generators/integratedhinge';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';

type Box3 = { min: number[]; max: number[] };

/** World bounding box of a part's nominal prism (placements here are axis-aligned). */
function box(part: Part): Box3 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const b = bounds(part.nominal.outline);
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [0, part.thickness]) {
    const w = toWorld(part.placement, { x, y }, z);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
  }
  return { min, max };
}

function size(parts: Part[]): number[] {
  const bs = parts.map(box);
  return [0, 1, 2].map((i) => +(Math.max(...bs.map((b) => b.max[i]!)) - Math.min(...bs.map((b) => b.min[i]!))).toFixed(6));
}

/** Gap between two boxes along axis i (negative when they overlap along it). */
const gapAlong = (a: Box3, b: Box3, i: number): number => Math.max(b.min[i]! - a.max[i]!, a.min[i]! - b.max[i]!);

function setup(id: string): { build: (over: Params) => Part[]; byId: (parts: Part[], pid: string) => Part } {
  const g = getGenerator(id)!;
  return {
    build: (over) => {
      const p = { ...defaults(g.schema), ...over };
      const parts = g.build(p);
      assertValidParts(parts, p);
      assertAssembly(parts, assemblyOpts(p, g.expectedSize!(p)));
      return parts;
    },
    byId: (parts, pid) => parts.find((q) => q.id === pid)!,
  };
}

describe('lids & hinges: headline outer dimensions equal the params (inside = false)', () => {
  it('hingebox: x, y, h + lidheight (the eyes stand out behind by the eye radius)', () => {
    const parts = setup('hingebox').build({ x: 150, y: 100, h: 60, lidheight: 30, thickness: 4, eye: 1.5, inside: false });
    expect(size(parts)).toEqual([150, 106, 90]);
    expect(size(parts.filter((q) => !q.id.startsWith('eye')))).toEqual([150, 100, 90]);
  });

  it('integratedhinge: x, y, h + lidheight (the rings stand out behind by pin + strength)', () => {
    const parts = setup('integratedhinge').build({ x: 120, y: 80, h: 60, lidheight: 30, thickness: 3, pin: 2, strength: 1, inside: false });
    expect(size(parts)).toEqual([120, 89, 90]);
    expect(size(parts.filter((q) => ['front', 'back', 'bottom', 'lidtop'].includes(q.id)))).toEqual([120, 80, 90]);
  });

  it('slidinglid: x, y, h for both bottoms and every lid style', () => {
    for (const bottom of ['finger joints', 'finger holes'])
      for (const lid of ['hole', 'lip', 'none'])
        expect(size(setup('slidinglid').build({ x: 80, y: 200, h: 60, inside: false, bottom, lid }))).toEqual([80, 200, 60]);
  });

  it('twopiece: x, y, h', () => {
    for (const hi of [100, 50])
      expect(size(setup('twopiece').build({ x: 120, y: 90, h: 70, hi, inside: false, clearance: 0.2 }))).toEqual([120, 90, 70]);
  });
});

describe('lids & hinges: the lid clears the body by its play', () => {
  it('twopiece: lid walls stand `clearance` outside the body walls, the lid top hi% above them', () => {
    const s = setup('twopiece');
    for (const clearance of [0, 0.15, 0.4]) {
      const t = 3;
      const parts = s.build({ x: 100, y: 80, h: 60, hi: 75, inside: true, clearance, thickness: t });
      const b = (id: string) => box(s.byId(parts, id));
      expect(gapAlong(b('lidfront'), b('front'), 1)).toBeCloseTo(clearance * t, 9);
      expect(gapAlong(b('lidback'), b('back'), 1)).toBeCloseTo(clearance * t, 9);
      expect(gapAlong(b('lidleft'), b('left'), 0)).toBeCloseTo(clearance * t, 9);
      expect(gapAlong(b('lidright'), b('right'), 0)).toBeCloseTo(clearance * t, 9);
      expect(gapAlong(b('lidtop'), b('front'), 2)).toBeCloseTo(15, 9); // 60 - 75 % of 60
    }
  });

  it('slidinglid: the lid rests on the lower rails with margin_t below the top rails and margin_s at the sides', () => {
    const s = setup('slidinglid');
    for (const [mt, ms] of [[0, 0], [0.1, 0.05], [0.5, 0.3]] as const) {
      const t = 3;
      const parts = s.build({ x: 60, y: 150, h: 40, margin_t: mt, margin_s: ms, thickness: t, lid: 'none' });
      const b = (id: string) => box(s.byId(parts, id));
      expect(gapAlong(b('lid'), b('railleft'), 2)).toBeCloseTo(0, 9);
      expect(gapAlong(b('lid'), b('toprailleft'), 2)).toBeCloseTo(mt * t, 9);
      expect(gapAlong(b('lid'), b('left'), 0)).toBeCloseTo(ms * t, 9);
      expect(gapAlong(b('lid'), b('right'), 0)).toBeCloseTo(ms * t, 9);
    }
  });

  it('integratedhinge: the lid sides clear the hinge rings by the hinge play; the discs turn with play/2 all round', () => {
    const s = setup('integratedhinge');
    for (const hingeplay of [0.01, 0.1, 0.2]) {
      const p = { ...defaults(getGenerator('integratedhinge')!.schema), hingeplay };
      const parts = s.build(p);
      const { R, Rl, p: pr, q } = hingeDims(p);
      const t = 3;
      const right = s.byId(parts, 'right');
      const c = toWorld(right.placement, { x: -t, y: 100 }); // ring centre: back face, top of the box walls
      const radii = (part: Part, behind = false) => flatten(part.nominal.outline).map((v) => toWorld(part.placement, v))
        .filter((w) => !behind || w[1] > c[1] + 1e-9).map((w) => Math.hypot(w[1] - c[1], w[2] - c[2]));
      // the ring (the box side behind the back face) reaches R from the centre; the lid side never
      // comes closer than Rl = R + play
      expect(Math.max(...radii(right, true))).toBeCloseTo(R, 6);
      expect(Math.min(...radii(s.byId(parts, 'lidright')))).toBeCloseTo(Rl, 6);
      expect(Rl - R).toBeCloseTo(hingeplay * t, 9);
      expect(Math.max(...radii(s.byId(parts, 'discright')))).toBeCloseTo(pr - q / 2, 6);
    }
  });

  it('hingebox: neighbouring box and lid eyes are hingeplay apart along the axis', () => {
    const s = setup('hingebox');
    for (const hingeplay of [0, 0.05, 0.2]) {
      const t = 3;
      const parts = s.build({ hingeplay, thickness: t, eyes: '5', hinges: 2 });
      const eyes = parts.filter((q) => q.id.startsWith('eye')).map(box).sort((a, b) => a.min[0]! - b.min[0]!);
      expect(eyes).toHaveLength(10);
      for (let i = 0; i < eyes.length; i++) {
        expect(eyes[i]!.max[0]! - eyes[i]!.min[0]!).toBeCloseTo(t, 9);
        if (i % 5 !== 0) expect(gapAlong(eyes[i - 1]!, eyes[i]!, 0)).toBeCloseTo(hingeplay * t, 9);
      }
    }
  });
});

describe('lids & hinges: hinge play must be > 0', () => {
  it('integratedhinge and dicebox reject hingeplay 0 (a zero-clearance disc binds in its ring)', () => {
    for (const id of ['integratedhinge', 'dicebox']) {
      const g = getGenerator(id)!;
      const d = g.schema.find((x) => x.key === 'hingeplay')!;
      expect(d.kind === 'number' && d.min > 0, id).toBe(true);
      const v = validate(g.schema, { ...defaults(g.schema), hingeplay: 0 });
      expect(v.ok, id).toBe(false);
    }
  });
});

describe('lids & hinges: impossible inputs throw ParamError naming the param', () => {
  const cases: [string, Params, string][] = [
    ['hingebox', { x: 20 }, 'x'],
    ['hingebox', { h: 12 }, 'h'],
    ['hingebox', { lidheight: 12 }, 'lidheight'],
    ['hingebox', { bore: 8 }, 'bore'],
    ['integratedhinge', { h: 15 }, 'h'],
    ['integratedhinge', { lidheight: 15 }, 'lidheight'],
    ['integratedhinge', { y: 10 }, 'y'],
    ['slidinglid', { x: 20, rail: 3 }, 'rail'],
    ['slidinglid', { lid: 'hole', hole_length: 60 }, 'hole_length'],
    ['slidinglid', { lid: 'hole', y: 40, hole_width: 30 }, 'hole_width'],
    ['twopiece', { hi: 20, h: 30 }, 'hi'],
    ['twopiece', { h: 14, inside: false }, 'h'],
  ];
  for (const [id, over, key] of cases)
    it(`${id} ${JSON.stringify(over)} -> ${key}`, () => {
      const g = getGenerator(id)!;
      const p = { ...defaults(g.schema), ...over };
      let err: unknown;
      try { g.build(p); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ParamError);
      expect((err as ParamError).message).toMatch(new RegExp(`\\b${key}\\b`));
    });
});

describe('fit clearances', () => {
  it('lid, hinge and sliding clearances cannot be set to zero', () => {
    for (const [id, key] of [['hingebox', 'hingeplay'], ['slidinglid', 'margin_t'], ['slidinglid', 'margin_s'], ['compartmentbox', 'margin_t'], ['compartmentbox', 'margin_s'], ['twopiece', 'clearance'], ['trayinsert', 'clearance']] as const) {
      const d = getGenerator(id)!.schema.find((q) => q.key === key)!;
      expect(d.kind === 'number' && d.min >= 0.02, `${id}.${key}`).toBe(true);
    }
  });

  it('stackablebin: the recess between the feet is longer than the stacking tongue it sits on', () => {
    for (const [thickness, play] of [[3, 0], [4, 0.2]] as const) {
      const g = getGenerator('stackablebin')!;
      const parts = g.build({ ...defaults(g.schema), thickness, play });
      const left = parts.find((q) => q.id === 'left')!;
      const pts = flatten(left.nominal.outline);
      const ys = pts.map((q) => q.y);
      const longestAt = (y: number): number => {
        let best = 0;
        pts.forEach((a, i) => {
          const b = pts[(i + 1) % pts.length]!;
          if (Math.abs(a.y - y) < 1e-6 && Math.abs(b.y - y) < 1e-6) best = Math.max(best, Math.abs(b.x - a.x));
        });
        return best;
      };
      const recess = longestAt(Math.min(...ys) + 2 * thickness);
      const tongue = longestAt(Math.max(...ys));
      expect(tongue).toBeGreaterThan(0);
      expect(recess - tongue).toBeCloseTo(Math.max(play * thickness, 0.1 * thickness), 9);
    }
  });
});
