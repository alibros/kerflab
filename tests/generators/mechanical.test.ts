/**
 * Mechanical, panel and wall-mount batch (gears, pulley, knob, patternpanel, beam, wallholder):
 * headline dimensions and behaviour on models that pass the harness, plus ParamErrors naming their
 * param. The registry loop in suite.ts covers invariants, presets, snapshots and fuzz.
 */
import { describe, expect, it } from 'vitest';
import { bounds, flatten, type Path } from '../../src/core/geometry';
import { toWorld, type Part } from '../../src/core/part';
import { defaults, type Params } from '../../src/core/schema';
import { ParamError } from '../../src/core/validate';
import { getGenerator } from '../../src/generators';
import { assemblyOpts, assertAssembly, assertValidParts } from '../harness/invariants';

function build(id: string, over: Params): Part[] {
  const g = getGenerator(id)!;
  const p = { ...defaults(g.schema), ...over };
  const parts = g.build(p);
  assertValidParts(parts, p);
  assertAssembly(parts, assemblyOpts(p, g.expectedSize?.(p), g.assembly === 'loose'));
  return parts;
}

function size(parts: Part[]): number[] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const q of parts) for (const v of flatten(q.nominal.outline)) for (const z of [0, q.thickness]) {
    const w = toWorld(q.placement, v, z);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
  }
  return [0, 1, 2].map((i) => +(max[i]! - min[i]!).toFixed(6));
}

const centre = (h: Path): { x: number; y: number } => { const b = bounds(h); return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 }; };
const dims = (h: Path): [number, number] => { const b = bounds(h); return [+(b.max.x - b.min.x).toFixed(6), +(b.max.y - b.min.y).toFixed(6)]; };

const rejects = (id: string, over: Params, key: string): void => {
  const g = getGenerator(id)!;
  const p = { ...defaults(g.schema), ...over };
  let err: unknown;
  try { g.build(p); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(ParamError);
  expect((err as ParamError).param).toBe(key);
};

describe('mechanical, panels and wall mounts: headline dimensions', () => {
  it('gears: a pair sits at the standard centre distance, tips at r + m', () => {
    const parts = build('gears', { module: 2, teeth: 15, teeth2: 30, bore: 'round', bore_d: 5, bore2_d: 8 });
    expect(parts).toHaveLength(2);
    expect(centre(parts[1]!.nominal.holes[0]!).x).toBeCloseTo(45, 9);
    expect(Math.max(...flatten(parts[0]!.nominal.outline).map((q) => Math.hypot(q.x, q.y)))).toBeCloseTo(17, 6);
    expect(build('gears', { teeth2: 0 })).toHaveLength(1);
    rejects('gears', { module: 1, teeth: 8, bore_d: 10 }, 'bore_d');
  });

  it('pulley: GT2 outer radius z p / 2 pi - pld, one layer per thickness of belt plus flanges', () => {
    const t = 3;
    const parts = build('pulley', { profile: 'GT2_2mm', teeth: 20, width: 6, flanges: false, thickness: t, bore_d: 5 });
    expect(parts).toHaveLength(2);
    const R = (20 * 2) / (2 * Math.PI) - 0.254;
    expect(Math.max(...flatten(parts[0]!.nominal.outline).map((q) => Math.hypot(q.x, q.y)))).toBeCloseTo(R, 6);
    const flanged = build('pulley', { profile: 'GT2_2mm', teeth: 20, width: 7, flanges: true, flange: 3, thickness: t });
    expect(flanged).toHaveLength(5);
    expect(size(flanged)).toEqual([+(2 * (R + 3)).toFixed(6), +(2 * (R + 3)).toFixed(6), 15]);
    rejects('pulley', { profile: 'GT2_2mm', teeth: 10, bore_d: 5 }, 'bore_d');
  });

  it('knob: stacked layers, the cap closed, a pointer engraved on top', () => {
    const parts = build('knob', { style: 'concave', diameter: 50, lobes: 8, depth: 0.2, layers: 3, cap: true, pointer: true });
    expect(parts.map((q) => q.holes.length)).toEqual([1, 1, 0]);
    expect(parts[2]!.engrave).toHaveLength(1);
    expect(size(build('knob', { style: 'round', diameter: 40, layers: 2, thickness: 3 }))).toEqual([40, 40, 6]);
    rejects('knob', { style: 'concave', lobes: 30, depth: 0.3 }, 'depth');
  });

  it('patternpanel: fan, NEMA and Skadis layouts', () => {
    const fan = build('patternpanel', { x: 90, y: 90, pattern: 'hex', hole: 4, spacing: 5.5, mount: 'fan80' });
    const screws = fan[0]!.nominal.holes.slice(0, 4).map(centre);
    expect(screws.map((c) => [+(c.x - 45).toFixed(6), +(c.y - 45).toFixed(6)])).toEqual([[-35.75, -35.75], [-35.75, 35.75], [35.75, -35.75], [35.75, 35.75]]);
    expect(fan[0]!.nominal.holes.length).toBeGreaterThan(50);
    const nema = build('patternpanel', { x: 60, y: 60, pattern: 'none', mount: 'nema17' });
    expect(nema[0]!.nominal.holes).toHaveLength(5);
    expect(dims(nema[0]!.nominal.holes[4]!)).toEqual([22.5, 22.5]);
    const sk = build('patternpanel', { x: 200, y: 200, pattern: 'skadis', margin: 10, mount: 'none' });
    expect(sk[0]!.nominal.holes.every((h) => dims(h)[0] === 5 && dims(h)[1] === 15)).toBe(true);
    rejects('patternpanel', { x: 60, y: 60, mount: 'fan80' }, 'mount');
  });

  it('beam: L and U outer sizes; the NEMA mount has two gussets and the motor holes', () => {
    expect(size(build('beam', { profile: 'L', length: 100, a: 40, b: 30 }))).toEqual([100, 30, 40]);
    expect(size(build('beam', { profile: 'U', length: 100, a: 40, b: 50, c: 25 }))).toEqual([100, 50, 40]);
    const nm = build('beam', { profile: 'L', length: 58, a: 58, b: 50, gussets: true, face_mount: 'nema17', base_holes: true });
    expect(nm.filter((q) => q.id.startsWith('gusset'))).toHaveLength(2);
    const upright = nm.find((q) => q.id === 'front')!;
    expect(upright.nominal.holes.filter((h) => h.segs.some((s) => s.t === 'A')).length).toBe(5);
    rejects('beam', { profile: 'L', length: 40, a: 40, face_mount: 'nema23' }, 'face_mount');
  });

  it('wallholder: hooks stand out behind the wall plane; plain walls get screw holes', () => {
    const t = 3;
    const cleat = build('wallholder', { walltype: 'french_cleat', cleat_depth: 12, x: 120, cols: 1, y: 60, h: 100, thickness: t });
    expect(size(cleat)).toEqual([120 + 4 * t, 60 + 2 * t + 12, 100 + t]);
    const plain = build('wallholder', { walltype: 'plain', x: 120, cols: 1, y: 60, h: 100, thickness: t });
    expect(size(plain)[1]).toBe(60 + 2 * t);
    expect(plain.find((q) => q.id === 'back')!.nominal.holes.filter((h) => h.segs.some((s) => s.t === 'A'))).toHaveLength(2);
    // Skadis: hooks every 40 mm while they fit
    const sk = build('wallholder', { walltype: 'skadis', x: 76, y: 50, h: 130, thickness: t });
    const holes = sk.find((q) => q.id === 'back')!.nominal.holes.filter((h) => { const [w, l] = dims(h); return w === t && l === 4.5; });
    expect(holes.length).toBe(2 * 3);
    const tools = build('wallholder', { walltype: 'french_cleat', tools: 'holes', tool_d: 8, tool_spacing: 16 });
    expect(tools.find((q) => q.id === 'plate')!.nominal.holes.length).toBeGreaterThan(5);
    rejects('wallholder', { walltype: 'dinrail', h: 40 }, 'h');
  });
});

describe('jigs, small parts and racks: headline dimensions', () => {
  it('gears: a rack meshes under gear 1 at its pitch line', () => {
    const parts = build('gears', { module: 2, teeth: 12, teeth2: 0, rack_length: 150, rack_height: 10 });
    const rack = parts.find((q) => q.id === 'rack')!;
    const b = bounds(rack.nominal.outline);
    expect(b.max.y).toBeCloseTo(-12 + 2, 9); // tips at the pitch line + m (pitch radius 12)
    expect(b.min.y).toBeCloseTo(-12 - 2.5 - 10, 9); // roots 1.25 m below, body below that
    expect(b.max.x - b.min.x).toBeCloseTo(150, 9);
    rejects('gears', { module: 2, teeth: 12, teeth2: 0, rack_length: 10 }, 'rack_length');
  });

  it('enclosure: a hole field in the lid or front keeps clear of the screws', () => {
    const lid = build('enclosure', { front: 'plain', x: 120, y: 120, h: 60, triangle: 22, mounts: 'inside', panel_holes: 'lid', hole_size: 4, hole_spacing: 6 });
    expect(lid.find((q) => q.id === 'lid')!.nominal.holes.length).toBeGreaterThan(100);
    const front = build('enclosure', { front: 'plain', panel_holes: 'front', hole_pattern: 'slots', hole_size: 3, hole_spacing: 6 });
    expect(front.find((q) => q.id === 'front')!.nominal.holes.length).toBeGreaterThan(3);
    rejects('enclosure', { panel_holes: 'lid', hole_size: 5, hole_spacing: 5 }, 'hole_spacing');
  });

  it('spool: two flanges and one stave per slot pair', () => {
    const t = 3;
    const parts = build('spool', { diameter: 150, core: 0.4, width: 50, staves: 5, stave_width: 18, bore_d: 12, thickness: t });
    expect(parts.filter((q) => q.id.startsWith('stave'))).toHaveLength(5);
    const s = size(parts); // flattened arcs: within the chord sagitta
    [150, 150, 50 + 2 * t].forEach((v, i) => expect(s[i]).toBeCloseTo(v, 1));
    rejects('spool', { diameter: 100, core: 0.3, staves: 16, stave_width: 40 }, 'staves');
  });

  it('dicetower: one ramp per level, tower as tall as the ramps plus headroom', () => {
    const parts = build('dicetower', { width: 70, depth: 70, ramps: 3, angle: 30, dice: 22, headroom: 50 });
    expect(parts.filter((q) => q.id.startsWith('ramp'))).toHaveLength(3);
    const s = size(parts);
    expect(s[0]).toBeCloseTo(76, 6);
    expect(s[1]).toBeCloseTo(76, 6);
  });

  it('jointpanel: tiles cover the panel exactly; tails interlock', () => {
    const parts = build('jointpanel', { x: 600, y: 400, tile_x: 300, tile_y: 300 });
    expect(parts).toHaveLength(3 * 2);
    expect(size(parts)).toEqual([600, 400, 3]);
    for (const q of parts) {
      const b = bounds(q.nominal.outline);
      expect(b.max.x - b.min.x).toBeLessThanOrEqual(300);
      expect(b.max.y - b.min.y).toBeLessThanOrEqual(300);
    }
    rejects('jointpanel', { x: 3000, y: 3000, tile_x: 80, tile_y: 80 }, 'tile_x');
  });

  it('holdfast: count pieces, hook limited by the shaft', () => {
    expect(build('holdfast', { count: 3 })).toHaveLength(3);
    rejects('holdfast', { shaftwidth: 2, hookheight: 10 }, 'hookheight');
  });

  it('slotrack: rail length from the slots; round items must clear the ground', () => {
    const t = 3;
    const parts = build('slotrack', { count: 10, item_thickness: 6, clearance: 1, web: 8, depth: 120, rail_height: 40, thickness: t });
    expect(size(parts)).toEqual([10 * 7 + 11 * 8 + 2 * t, 120, 40]);
    const rail = parts.find((q) => q.id === 'rail1')!;
    expect(rail.nominal.outline.segs.length).toBeGreaterThan(40);
    rejects('slotrack', { depth: 160, item_d: 120, rail_height: 30, notch: 0.5 }, 'depth');
    rejects('slotrack', { depth: 380, item_d: 120 }, 'item_d');
  });

  it('cradle: hollows along the top, two stretchers', () => {
    const parts = build('cradle', { count: 3, diameter: 80, clearance: 1, web: 14, depth: 160, height: 50 });
    expect(parts.filter((q) => q.id.startsWith('stretcher'))).toHaveLength(2);
    expect(size(parts)).toEqual([+(3 * 0.85 * 80 + 4 * 14).toFixed(6), 160, 50]);
    expect(parts[0]!.nominal.outline.segs.filter((s) => s.t === 'A')).toHaveLength(3);
    rejects('cradle', { diameter: 200, height: 20 }, 'height');
  });
});

describe('hook', () => {
  it('J profile: width mouth + 2 strip, height back + bend + round end; screw holes in the back', () => {
    const parts = build('hook', { back: 60, mouth: 26, tip: 15, strip: 14, screw: 4, count: 1 });
    const b = bounds(parts[0]!.nominal.outline);
    expect(b.max.x - b.min.x).toBeCloseTo(26 + 28, 6);
    expect(b.max.y - b.min.y).toBeCloseTo(60 + 27 + 7, 6);
    expect(parts[0]!.nominal.holes).toHaveLength(2);
    expect(build('hook', { count: 3 })).toHaveLength(3);
    // short backs keep one screw hole
    expect(build('hook', { back: 12, screw: 4, count: 1 })[0]!.nominal.holes).toHaveLength(1);
  });
});

describe('gears with kerf', () => {
  it('gears, gear pairs with racks, planetary sets and gearboxes build at every module and kerf', () => {
    for (const module of [0.5, 1, 2, 3]) for (const kerf of [0, 0.1, 0.3]) {
      for (const teeth of [6, 10, 17, 48, 150]) {
        build('gears', { module, teeth, teeth2: teeth > 40 ? 0 : 48, bore: 'none', kerf });
        if (teeth < 40) build('gears', { module, teeth, rack_length: 40 * module, bore: 'none', kerf });
      }
      if (module >= 1) build('planetary', { module, sun: 12, planet: 18, bore: 'none', kerf });
      build('gearbox', { module: Math.max(0.8, module), pinion: 12, wheel: 48, stages: 2, shaft: 1, kerf });
    }
  });
});
