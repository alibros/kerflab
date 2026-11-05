/**
 * Coverage worklist batch (DrillStand step on typetray, gridfinity, hook pole clamp, jigs, ring
 * gears): headline dimensions and behaviour on models that pass the harness, plus ParamErrors
 * naming their param. The registry loop in suite.ts covers invariants, presets, snapshots and fuzz.
 */
import { describe, expect, it } from 'vitest';
import { checkRing, ringHole } from '../../src/core/gear';
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

export const dims = (h: Path): [number, number] => { const b = bounds(h); return [+(b.max.x - b.min.x).toFixed(6), +(b.max.y - b.min.y).toFixed(6)]; };

const rejects = (id: string, over: Params, key: string): void => {
  const g = getGenerator(id)!;
  const p = { ...defaults(g.schema), ...over };
  let err: unknown;
  try { g.build(p); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(ParamError);
  expect((err as ParamError).param).toBe(key);
};

describe('worklist batch: headline dimensions', () => {
  it('typetray step: rows rise towards the back (DrillStand)', () => {
    const t = 3;
    const parts = build('typetray', { x: 30, y: 30, h: 40, cols: 2, rows: 3, step: 15, thickness: t, inside: true });
    const s = size(parts);
    expect(s).toEqual([2 * 30 + 3 * t, 3 * 30 + 4 * t, 40 + 30 + t]);
    const left = parts.find((q) => q.id === 'left')!;
    const b = bounds(left.nominal.outline);
    expect(+(b.max.y - b.min.y).toFixed(6)).toBe(70 + t);
    // level tray unchanged by step with a single row
    expect(size(build('typetray', { rows: 1, step: 30 }))[2]).toBe(43);
  });
});


describe('gridfinity', () => {
  it('baseplate: one opening per cell on a 42 mm pitch, stacked over a bottom plate', () => {
    const parts = build('gridfinity', { mode: 'baseplate', nx: 3, ny: 2, layers: 1, magnets: 6.5, thickness: 3 });
    expect(parts.map((q) => q.id)).toEqual(['bottom1', 'grid']);
    expect(parts[1]!.nominal.holes).toHaveLength(6);
    expect(dims(parts[1]!.nominal.holes[0]!)).toEqual([38, 38]);
    expect(parts[0]!.nominal.holes).toHaveLength(24);
    expect(size(parts)).toEqual([126, 84, 6]);
  });

  it('baseplate fit: fills a drawer with whole cells and an even border', () => {
    const parts = build('gridfinity', { mode: 'baseplate', fit_x: 300, fit_y: 100, layers: 0 });
    expect(parts[0]!.nominal.holes).toHaveLength(7 * 2);
    expect(size(parts)).toEqual([300, 100, 3]);
    rejects('gridfinity', { mode: 'baseplate', fit_x: 20 }, 'fit_x');
  });

  it('bin: outer size is the grid less 0.5 mm, one foot per cell', () => {
    const t = 3;
    const parts = build('gridfinity', { mode: 'bin', nx: 2, ny: 1, height: 42, cols: 2, rows: 1, thickness: t });
    expect(parts.filter((q) => q.id.startsWith('foot'))).toHaveLength(2);
    expect(size(parts)).toEqual([83.5, 41.5, 42 + t]);
    rejects('gridfinity', { mode: 'bin', nx: 1, cols: 6, thickness: 6 }, 'cols');
    rejects('gridfinity', { mode: 'bin', magnets: 10, pitch: 30, web: 12 }, 'magnets');
  });
});

describe('hook pole mount (PoleHook)', () => {
  it('a ring the pole diameter wide sits on top of the back strip', () => {
    const parts = build('hook', { mount: 'pole', pole_d: 25, strip: 12, back: 30, mouth: 30, tip: 12, count: 1 });
    expect(parts[0]!.nominal.holes).toHaveLength(1);
    expect(dims(parts[0]!.nominal.holes[0]!)[0]).toBeCloseTo(25, 6);
    rejects('hook', { mount: 'pole', pole_d: 40, mouth: 10, back: 10, tip: 40 }, 'tip');
  });
});

describe('jigs', () => {
  it('angledcutjig: the top plate slopes at the angle over the ribs', () => {
    const t = 3;
    const parts = build('angledcutjig', { angle: 45, x: 120, length: 100, ribs: 3, stop: 0, thickness: t });
    expect(parts.filter((q) => q.id.startsWith('rib'))).toHaveLength(3);
    const top = parts.find((q) => q.id === 'top')!;
    expect(top.placement.y[2]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(dims(top.nominal.outline)[1]).toBeCloseTo(100 * Math.SQRT2, 6);
    expect(size(parts)[2]).toBeCloseTo(t + t * Math.SQRT1_2 + 100, 6);
    rejects('angledcutjig', { x: 40, ribs: 8 }, 'ribs');
  });

  it('strapclamp: a bar on a heel as tall as the plates stacked under it', () => {
    const parts = build('strapclamp', { length: 100, width: 25, heel: 3, count: 1, thickness: 3 });
    expect(parts).toHaveLength(4);
    expect(size(parts)).toEqual([100, 25, 12]);
    rejects('strapclamp', { width: 15, bolt: 12 }, 'bolt');
    rejects('strapclamp', { length: 60, heel_length: 10, slot: 100 }, 'slot');
  });
});

describe('planetary', () => {
  it('ring of sun + 2 planet teeth, planets at m (sun + planet) / 2, carrier on top', () => {
    const m = 1.5;
    const parts = build('planetary', { module: m, sun: 12, planet: 18, planets: 3, rim: 6, carrier: true, thickness: 3 });
    expect(parts.map((q) => q.id)).toEqual(['sun', 'planet1', 'planet2', 'planet3', 'ring', 'carrier']);
    const ring = parts.find((q) => q.id === 'ring')!;
    const rr = (m * 48) / 2;
    const radii = flatten(ring.nominal.holes[0]!).map((q) => Math.hypot(q.x, q.y));
    expect(Math.min(...radii)).toBeCloseTo(rr - m, 6);
    expect(Math.max(...radii)).toBeCloseTo(rr + 1.25 * m, 6);
    const c = bounds(parts[1]!.nominal.holes[0]!);
    expect((c.min.x + c.max.x) / 2).toBeCloseTo((m * 30) / 2, 9);
    expect(size(parts)).toEqual([2 * (rr + 1.25 * m + 6), 2 * (rr + 1.25 * m + 6), 6]);
    rejects('planetary', { sun: 8, planet: 36, planets: 4 }, 'planets');
  });

  it('core: ring holes have one space per tooth; too small a difference is tip interference', () => {
    const g = { module: 2, teeth: 40, pressureAngle: 20, backlash: 0.1 };
    expect(ringHole(g).segs.filter((q) => q.t === 'A')).toHaveLength(2 * 40);
    let err: unknown;
    try { checkRing(g, 30, { teeth: 'ring', pinion: 'planet' }); } catch (e) { err = e; }
    expect((err as ParamError).param).toBe('planet');
    expect(() => checkRing(g, 28, { teeth: 'ring', pinion: 'planet' })).not.toThrow();
  });
});

describe('frame', () => {
  it('a stack of back, depth layers, holding layers and front at picture + 2 border', () => {
    const parts = build('frame', { x: 100, y: 150, border: 20, lip: 5, clearance: 1, rabbet: 2, spacers: 3, hang: true, thickness: 3 });
    expect(parts.map((q) => q.id)).toEqual(['back', 'spacer1', 'spacer2', 'spacer3', 'holder1', 'holder2', 'front']);
    expect(size(parts)).toEqual([140, 190, 21]);
    expect(dims(parts.at(-1)!.nominal.holes[0]!)).toEqual([90, 140]);
    expect(dims(parts[4]!.nominal.holes[0]!)).toEqual([101, 151]);
    rejects('frame', { x: 30, lip: 15 }, 'lip');
  });
});

describe('chest (PirateChest)', () => {
  it('an arch of equal staves on the chest hinge; the middle stave tops the arch', () => {
    const t = 3;
    const parts = build('chest', { x: 200, y: 120, h: 100, lidheight: 30, staves: 5, arch: 180, thickness: t, inside: true });
    expect(parts.filter((q) => q.id.startsWith('stave'))).toHaveLength(5);
    expect(parts.some((q) => q.id === 'lidtop')).toBe(false);
    // Semicircle chords at 72, 36, 0, -36, -72 degrees span the 120 mm depth.
    const c = (d: number): number => Math.cos((d * Math.PI) / 180);
    const s = 120 / (2 * c(72) + 2 * c(36) + 1);
    const rise = s * (Math.sin((72 * Math.PI) / 180) + Math.sin((36 * Math.PI) / 180));
    const sz = size(parts);
    expect(sz[0]).toBeCloseTo(206, 6);
    expect(sz[2]).toBeCloseTo(t + 100 + 30 + rise + t, 6);
    const stave = parts.find((q) => q.id === 'stave3')!;
    expect(stave.placement.y[2]).toBeCloseTo(0, 9); // the middle stave is level
    rejects('chest', { y: 40, staves: 12, lidheight: 60, thickness: 6 }, 'staves');
  });
});

describe('candispenser (CanStorage)', () => {
  it('zig-zag ramps, a dispensing opening a can high and a filling slot', () => {
    const t = 3;
    const parts = build('candispenser', { can_d: 66, can_length: 115, depth: 350, ramps: 3, clearance: 4, thickness: t });
    expect(parts.filter((q) => q.id.startsWith('ramp'))).toHaveLength(3);
    const front = parts.find((q) => q.id === 'front')!;
    expect(dims(front.nominal.holes[0]!)).toEqual([119 - 2 * t, 70]);
    expect(dims(parts.find((q) => q.id === 'top')!.nominal.holes[0]!)[1]).toBe(70);
    const s = size(parts);
    expect(s.slice(0, 2)).toEqual([125, 356]);
    // Ramps alternate: the lowest rises to the back, the next to the front.
    const r = parts.filter((q) => q.id.startsWith('ramp')).map((q) => q.placement.y[1]);
    expect(r[0]! > 0 && r[1]! < 0 && r[2]! > 0).toBe(true);
    rejects('candispenser', { can_d: 100, depth: 150, ramps: 2 }, 'depth');
  });
});

describe('wallholder styles', () => {
  it('hopper: a sloped floor and an opening at the bottom of the front (WallHopper)', () => {
    const parts = build('wallholder', { style: 'hopper', x: 100, y: 80, h: 160, front: 0.5, slope: 30, opening: 30 });
    const floor = parts.find((q) => q.id === 'floor')!;
    expect(floor.placement.y[2]).toBeCloseTo(0.5, 9);
    expect(dims(parts.find((q) => q.id === 'front')!.nominal.holes[0]!)[1]).toBe(30);
    rejects('wallholder', { style: 'hopper', h: 100, front: 0.3, opening: 60 }, 'opening');
  });

  it('steps: tool platforms rising towards the back (WallStairs)', () => {
    const t = 3;
    const parts = build('wallholder', { tools: 'holes', steps: 3, x: 150, y: 90, h: 140, front: 0.4, tool_d: 10, tool_spacing: 20, thickness: t });
    const z = parts.filter((q) => q.id.startsWith('plate')).map((q) => q.placement.origin[2]);
    expect(z).toEqual([56 - t, 56 - t + 28, 56 - t + 56]);
    rejects('wallholder', { tools: 'holes', steps: 6, front: 0.9 }, 'steps');
  });

  it('rod: a back plate and two brackets with the rod holes (WallRollHolder)', () => {
    const parts = build('wallholder', { style: 'rod', x: 290, y: 90, h: 120, front: 0.6, tool_d: 25 });
    expect(parts.map((q) => q.id)).toEqual(['back', 'left', 'right']);
    expect(dims(parts[1]!.nominal.holes[0]!)[0]).toBeCloseTo(25, 6);
    expect(size(parts)[2]).toBeCloseTo(120, 6);
  });
});

describe('gearbox (GearBox)', () => {
  it('stages of pinion and wheel alternating between two shafts, between frames and plates', () => {
    const m = 1.5;
    const t = 3;
    const parts = build('gearbox', { module: m, pinion: 10, wheel: 30, stages: 3, clearance: 2, border: 10, thickness: t });
    expect(parts).toHaveLength(2 + 3 * 3);
    const a = (m * 40) / 2;
    const centre = (id: string): number => { const b = bounds(parts.find((q) => q.id === id)!.nominal.holes[0]!); return (b.min.x + b.max.x) / 2; };
    expect(centre('pinion1')).toBeCloseTo(0, 9);
    expect(centre('wheel1')).toBeCloseTo(a, 9);
    expect(centre('pinion2')).toBeCloseTo(a, 9);
    expect(centre('wheel2')).toBeCloseTo(0, 9);
    const rc = m * 15 + m + 2;
    expect(size(parts)).toEqual([+(a + 2 * rc + 20).toFixed(6), 2 * (rc + 10), 5 * t]);
    rejects('gearbox', { bolt: 9, border: 8 }, 'bolt');
  });
});

describe('lightbox (Lamp, NightLightBox)', () => {
  it('perforated walls and top, a cable hole in the back', () => {
    const t = 3;
    const parts = build('lightbox', { x: 100, y: 100, h: 150, top: 'pattern', pattern: 'squares', hole: 8, spacing: 16, border: 10, cable: 8, thickness: t });
    expect(size(parts)).toEqual([106, 106, 156]);
    const front = parts.find((q) => q.id === 'front')!;
    // 80 x 130 field of 8 mm squares on a 16 mm grid centred on the panel: 5 x 7.
    expect(front.nominal.holes).toHaveLength(5 * 7);
    expect(dims(parts.find((q) => q.id === 'back')!.nominal.holes[0]!)[0]).toBeCloseTo(8, 6);
    expect(size(build('lightbox', { top: 'none' }))[2]).toBe(153);
    rejects('lightbox', { x: 30, border: 15, hole: 8 }, 'border');
  });
});
