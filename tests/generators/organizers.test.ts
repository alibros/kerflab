/**
 * "Trays & organizers (part 2)" batch: headline dimensions per generator (the registry loop in
 * suite.ts covers invariants, presets, snapshots and fuzz), the drawer's and the lids' clearances
 * measured on assembled models that pass assertAssembly, and ParamErrors naming their param.
 */
import { describe, expect, it } from 'vitest';
import { bounds, flatten } from '../../src/core/geometry';
import { toWorld, type Part } from '../../src/core/part';
import { defaults, type Params } from '../../src/core/schema';
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

const union = (bs: Box3[]): Box3 => ({
  min: [0, 1, 2].map((i) => Math.min(...bs.map((b) => b.min[i]!))),
  max: [0, 1, 2].map((i) => Math.max(...bs.map((b) => b.max[i]!))),
});

function size(parts: Part[]): number[] {
  const u = union(parts.map(box));
  return [0, 1, 2].map((i) => +(u.max[i]! - u.min[i]!).toFixed(6));
}

/** Gap from box a to box b along axis i (b beyond a; negative when they overlap along it). */
const gapAlong = (a: Box3, b: Box3, i: number): number => Math.max(b.min[i]! - a.max[i]!, a.min[i]! - b.max[i]!);

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

describe('organizers: headline outer dimensions equal the params (inside = false)', () => {
  it('drawer: the frame is x, y, h for every wall height and grip', () => {
    for (const hi of [1, 0.6]) for (const grip of ['hole', 'none'])
      expect(size(build('drawer', { x: 160, y: 200, h: 70, inside: false, hi, grip }))).toEqual([160, 200, 70]);
  });

  it('drawer: the grip hole shrinks to fit a small front (boxes.py SlidingDrawer defaults 60 x 100 x 30)', () => {
    const t = 3;
    const front = part(build('drawer', { x: 60, y: 100, h: 30, inside: false, thickness: t, grip: 'hole', grip_width: 40, grip_height: 15 }), 'dfront');
    expect(front.nominal.holes).toHaveLength(1);
    const ob = bounds(front.nominal.outline);
    const hb = bounds(front.nominal.holes[0]!);
    // One thickness of material above and below the hole (the front's top edge is plain).
    expect(ob.max.y - hb.max.y).toBeCloseTo(t, 9);
    expect(hb.min.y - (ob.min.y + t)).toBeGreaterThanOrEqual(t - 1e-9);
    expect(hb.max.x - hb.min.x).toBeCloseTo(40, 9);
    // A roomy front keeps the asked size.
    const big = part(build('drawer', { x: 160, y: 200, h: 70, inside: false, grip: 'hole', grip_width: 50, grip_height: 18 }), 'dfront');
    const bb = bounds(big.nominal.holes[0]!);
    expect([bb.max.x - bb.min.x, bb.max.y - bb.min.y].map((v) => +v.toFixed(6))).toEqual([50, 18]);
  });

  it('drawer, inner dimensions: the drawer itself is x, y, h inside', () => {
    const t = 3;
    const parts = build('drawer', { x: 70, y: 95, h: 40, inside: true, thickness: t });
    const d = union(parts.filter((q) => q.id.startsWith('d')).map(box));
    expect([0, 1, 2].map((i) => +(d.max[i]! - d.min[i]!).toFixed(6))).toEqual([70 + 2 * t, 95 + 2 * t, 40 + t]);
  });

  it('penholder: x, y, h with and without a floor', () => {
    for (const bottom of [true, false])
      expect(size(build('penholder', { x: 100, y: 90, h: 120, inside: false, bottom }))).toEqual([100, 90, 120]);
  });

  it('keyholder: plate width from the hooks and paddings, height from the paddings; hooks reach t + ht + 0.7 hh', () => {
    const t = 3;
    const parts = build('keyholder', { num_hooks: 5, hook_distance: 25, hook_thickness: 6, hook_height: 30, padding_top: 12,
      padding_left_right: 8, padding_bot: 20, thickness: t });
    expect(size(parts)).toEqual([2 * 8 + 5 * t + 4 * 25, t + 6 + 21, 20 + 30 + 12]);
    expect(parts.filter((q) => q.id.startsWith('hook'))).toHaveLength(5);
  });

  it('cardbox: the compartment widths plus walls, y, h', () => {
    const t = 3;
    for (const sx of ['65,65,65,65', '90', '40,80,40']) {
      const n = sx.split(',').length;
      const w = sx.split(',').reduce((a, v) => a + Number(v), 0) + (n + 3) * t;
      expect(size(build('cardbox', { sx, y: 80, h: 110, inside: false, thickness: t }))).toEqual([w, 80, 110]);
    }
  });

  it('silverware: x, y, and h or the handle top, whichever is higher', () => {
    const t = 3;
    expect(size(build('silverware', { x: 250, y: 160, h: 120, inside: false, inner_drop: 10, handleheight: 150, thickness: t })))
      .toEqual([250, 160, 120 - 10 + 150]);
    expect(size(build('silverware', { x: 250, y: 160, h: 120, inside: false, inner_drop: 30, handleheight: 20, handlewidth: 60, thickness: t })))
      .toEqual([250, 160, 120]);
  });

  it('dicebox: x, y, (dice_height + dice_clearance * t) + lidheight, the hinge rings standing out behind', () => {
    const t = 3;
    const parts = build('dicebox', { x: 100, y: 100, dice_height: 22, dice_clearance: 0.2, lidheight: 25, inside: false, thickness: t, pin: 2, strength: 1 });
    // inner box height 22.6 above the bottom, lid 25 outer
    expect(size(parts)).toEqual([100, 109, 50.6]);
    expect(size(parts.filter((q) => ['front', 'back', 'bottom', 'lidtop'].includes(q.id)))).toEqual([100, 100, 50.6]);
  });
});

describe('organizers: the drawer clears its frame by its clearance', () => {
  it('c at each side, 2c above and behind; resting on the frame bottom, its front flush', () => {
    const t = 3;
    for (const clearance of [0.02, 0.15, 0.5]) {
      const c = clearance * t;
      const parts = build('drawer', { x: 120, y: 150, h: 60, inside: false, clearance, thickness: t });
      const d = union(parts.filter((q) => q.id.startsWith('d')).map(box));
      const f = (id: string): Box3 => box(part(parts, id));
      expect(gapAlong(f('left'), d, 0)).toBeCloseTo(c, 9);
      expect(gapAlong(d, f('right'), 0)).toBeCloseTo(c, 9);
      expect(gapAlong(d, f('top'), 2)).toBeCloseTo(2 * c, 9);
      expect(gapAlong(d, f('back'), 1)).toBeCloseTo(2 * c, 9);
      expect(gapAlong(f('bottom'), d, 2)).toBeCloseTo(0, 9);
      expect(d.min[1]).toBeCloseTo(0, 9);
      // ... and every drawer part clears every frame part except where it rests on the bottom
      for (const dp of parts.filter((q) => q.id.startsWith('d')))
        for (const fp of parts.filter((q) => !q.id.startsWith('d'))) {
          const g = Math.max(...[0, 1, 2].map((i) => gapAlong(box(dp), box(fp), i)));
          expect(g).toBeGreaterThanOrEqual(fp.id === 'bottom' ? -1e-9 : c - 1e-9);
        }
    }
  });
});

describe('organizers: lids clear the body', () => {
  it('cardbox: the lid clears each side wall by lid_clearance and the lips by margin_t; it rests on the inner sides', () => {
    const t = 3;
    for (const [lc, mt] of [[0.02, 0.02], [0.1, 0.05], [0.5, 0.5]] as const) {
      const parts = build('cardbox', { sx: '30,30', y: 70, h: 90, lid_clearance: lc, margin_t: mt, thickness: t });
      const b = (id: string): Box3 => box(part(parts, id));
      expect(gapAlong(b('left'), b('lid'), 0)).toBeCloseTo(lc * t, 9);
      expect(gapAlong(b('lid'), b('right'), 0)).toBeCloseTo(lc * t, 9);
      expect(gapAlong(b('lid'), b('lipleft'), 2)).toBeCloseTo(mt * t, 9);
      expect(gapAlong(b('lid'), b('lipright'), 2)).toBeCloseTo(mt * t, 9);
      expect(gapAlong(b('innerleft'), b('lid'), 2)).toBeCloseTo(0, 9);
      expect(gapAlong(b('divider1'), b('lid'), 2)).toBeCloseTo(0, 9);
      // the lips overhang the lid by about a thickness, so they hold it down
      expect(b('lipleft').max[0]! - b('lid').min[0]!).toBeCloseTo(t - lc * t, 9);
    }
  });

  it('dicebox: the lid sides clear the hinge rings by the hinge play; shut, the plates touch with the magnet holes aligned', () => {
    const t = 3;
    for (const hingeplay of [0.01, 0.1, 0.2]) {
      const g = getGenerator('dicebox')!;
      const p = { ...defaults(g.schema), hingeplay, thickness: t };
      const parts = build('dicebox', p);
      const { R, Rl } = hingeDims(p);
      const right = part(parts, 'right');
      const h = 22 + 0.15 * t; // inner box height: dice_height + dice_clearance * t (defaults)
      const c = toWorld(right.placement, { x: -t, y: h }); // ring centre: back face, top of the box front
      const radii = (q: Part, behind = false) => flatten(q.nominal.outline).map((v) => toWorld(q.placement, v))
        .filter((w) => !behind || w[1] > c[1] + 1e-9).map((w) => Math.hypot(w[1] - c[1], w[2] - c[2]));
      expect(Math.max(...radii(right, true))).toBeCloseTo(R, 6);
      expect(Math.min(...radii(part(parts, 'lidright')))).toBeCloseTo(Rl, 6);
      expect(Rl - R).toBeCloseTo(hingeplay * t, 9);
      const bp = part(parts, 'boxplate');
      const lp = part(parts, 'lidplate');
      // the plates meet in the hinge axis plane: box plate below, lid plate above
      expect(box(bp).max[2]).toBeCloseTo(c[2], 9);
      expect(box(lp).min[2]).toBeCloseTo(c[2], 9);
      expect(gapAlong(box(bp), box(lp), 2)).toBeCloseTo(0, 9);
      expect(bp.nominal.holes).toHaveLength(9);
      expect(lp.nominal.holes).toHaveLength(2);
    }
  });

  it('dicebox: shut, each magnet in the box plate faces one in the lid plate, 0 mm apart (<= 1 mm)', () => {
    const t = 3;
    for (const over of [{}, { magnet_diameter: 8, x: 140, y: 140, dice_height: 30, lidheight: 30 }, { thickness: 2, magnet_diameter: 5, x: 80, y: 80, dice_height: 18, lidheight: 16 }]) {
      const parts = build('dicebox', { thickness: t, ...over });
      const bp = part(parts, 'boxplate');
      const lp = part(parts, 'lidplate');
      // magnet holes: the circular ones (two arcs)
      const magnets = (q: Part, face: number) => q.nominal.holes.filter((hp) => hp.segs.length === 2 && hp.segs.every((sg) => sg.t === 'A')).map((hp) => {
        const bb = bounds(hp);
        return toWorld(q.placement, { x: (bb.min.x + bb.max.x) / 2, y: (bb.min.y + bb.max.y) / 2 }, face);
      });
      // the faces that meet: the box plate's z = 0 (top) face and the lid plate's z = 0 (bottom) face
      const mb = magnets(bp, 0);
      const ml = magnets(lp, 0);
      expect(mb).toHaveLength(2);
      expect(ml).toHaveLength(2);
      for (const a of mb) {
        const gap = Math.min(...ml.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])));
        expect(gap).toBeLessThanOrEqual(1);
        expect(gap).toBeCloseTo(0, 9);
        expect(a[1]).toBeLessThan(box(bp).min[1]! + (box(bp).max[1]! - box(bp).min[1]!) / 2); // at the front
      }
    }
  });

  it('dicebox: the tallest die stands on the bottom with its top dice_clearance * t below the lid plate, inside the box plate', () => {
    for (const [t, dice_height, dice_clearance] of [[3, 22, 0.15], [3, 30, 0.5], [2, 18, 0.02], [4, 40, 0.3]] as const) {
      const parts = build('dicebox', { thickness: t, dice_height, dice_clearance, lidheight: 40, inside: false });
      const floorTop = box(part(parts, 'bottom')).max[2]!;
      const lidPlateUnder = box(part(parts, 'lidplate')).min[2]!;
      const boxPlate = box(part(parts, 'boxplate'));
      const dieTop = floorTop + dice_height;
      expect(lidPlateUnder - dieTop).toBeCloseTo(dice_clearance * t, 9);
      expect(lidPlateUnder - dieTop).toBeGreaterThan(0);
      expect(dieTop).toBeGreaterThanOrEqual(boxPlate.min[2]! + t / 2 - 1e-9); // held by at least half the plate
    }
  });
});

describe('organizers: features', () => {
  it('penholder: each plate has nx * ny pen holes; the top plate is plate1_offset thicknesses down', () => {
    const t = 3;
    const parts = build('penholder', { x: 100, y: 80, h: 100, nx: 5, ny: 3, pen_diam: 12, cap_margin: 4, plate1_offset: 2, inside: true, thickness: t });
    for (const id of ['plate1', 'plate2']) {
      const pl = part(parts, id);
      expect(pl.nominal.holes).toHaveLength(15);
      expect(pl.engrave).toHaveLength(15);
    }
    expect(box(part(parts, 'plate1')).max[2]).toBeCloseTo(t + 100 - 2 * t, 9);
  });

  it('cardbox: n compartments need n - 1 dividers and two inner sides', () => {
    const parts = build('cardbox', { sx: '30,40,30' });
    expect(parts.filter((q) => q.id.startsWith('divider'))).toHaveLength(2);
    expect(parts.filter((q) => q.id.startsWith('inner'))).toHaveLength(2);
  });

  it('silverware: front_compartments - 1 and back_compartments - 1 dividers; a back divider facing a front one butts flat', () => {
    const count = (parts: Part[], pre: string) => parts.filter((q) => q.id.startsWith(pre)).length;
    const a = build('silverware', { front_compartments: 3, back_compartments: 2 });
    expect([count(a, 'frontdivider'), count(a, 'backdivider')]).toEqual([2, 1]);
    // centre wall: one slot row per divider (3) + floor and side slot rows are on the other parts
    expect(part(a, 'centre').edges.filter((e) => e.holes).length).toBe(3);
    const b = build('silverware', { front_compartments: 2, back_compartments: 2 });
    expect(part(b, 'centre').edges.filter((e) => e.holes).length).toBe(1);
    expect(part(b, 'backdivider1').edges.find((e) => e.side === 3)!.type).toBe('flat');
  });

  it('dicebox: seven hexagonal dice holes and two magnet holes in the box plate, magnet holes only in the lid plate (none with magnet_diameter 0)', () => {
    expect(part(build('dicebox', {}), 'boxplate').nominal.holes.length).toBe(9);
    expect(part(build('dicebox', {}), 'lidplate').nominal.holes.length).toBe(2);
    expect(part(build('dicebox', { magnet_diameter: 0 }), 'boxplate').nominal.holes.length).toBe(7);
    expect(part(build('dicebox', { magnet_diameter: 0 }), 'lidplate').nominal.holes.length).toBe(0);
  });
});

describe('organizers: impossible inputs throw ParamError naming the param', () => {
  const cases: [string, Params, string][] = [
    ['drawer', { x: 30, thickness: 6 }, 'x'],
    ['drawer', { h: 70, hi: 0.3, thickness: 6 }, 'hi'],
    ['penholder', { nx: 6, x: 60 }, 'nx'],
    ['penholder', { ny: 6, y: 60 }, 'ny'],
    ['penholder', { h: 30, plate1_offset: 5, thickness: 4 }, 'plate1_offset'],
    ['penholder', { h: 30, plate_gap: 0.2 }, 'plate_gap'],
    ['keyholder', { hook_thickness: 10, hook_height: 20 }, 'hook_thickness'],
    ['keyholder', { hook_height: 16, thickness: 6 }, 'hook_height'],
    ['keyholder', { mounting: true, padding_top: 4 }, 'padding_top'],
    ['cardbox', { sx: '' }, 'sx'],
    ['cardbox', { sx: '65,4' }, 'sx'],
    ['cardbox', { y: 30, thickness: 6 }, 'y'],
    ['cardbox', { fingerhole: 'custom', fingerhole_depth: 120 }, 'fingerhole_depth'],
    ['silverware', { front_compartments: 6, x: 100, thickness: 8 }, 'front_compartments'],
    ['silverware', { handlewidth: 200, x: 220 }, 'handlewidth'],
    ['silverware', { inner_drop: 50, h: 55 }, 'inner_drop'],
    ['dicebox', { magnet_diameter: 15, x: 60, y: 60 }, 'magnet_diameter'],
    ['dicebox', { dice_height: 12 }, 'dice_height'],
    ['dicebox', { lidheight: 15 }, 'lidheight'],
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
