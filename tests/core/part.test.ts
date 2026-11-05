import { describe, expect, it } from 'vitest';
import { area, bounds, GeometryError, type Path } from '../../src/core/geometry';
import { ParamError } from '../../src/core/validate';
import { applyKerf, finishPart, finishWithKerf, placementNormal, toLocal, toWorld, type Placement } from '../../src/core/part';
import { materials, getMaterial } from '../../src/core/materials';
import { commonParams, defaults, validate } from '../../src/core/schema';

const rect = (x: number, y: number, w: number, h: number): Path => ({
  start: { x, y },
  segs: [
    { t: 'L', to: { x: x + w, y } }, { t: 'L', to: { x: x + w, y: y + h } },
    { t: 'L', to: { x, y: y + h } }, { t: 'L', to: { x, y } },
  ],
  closed: true,
});
const size = (p: Path): [number, number] => {
  const b = bounds(p);
  return [b.max.x - b.min.x, b.max.y - b.min.y];
};

describe('applyKerf', () => {
  it('grows the outline by kerf/2 per side and shrinks CCW holes by kerf/2 per side', () => {
    const r = applyKerf(rect(0, 0, 100, 50), [rect(10, 10, 20, 6)], 0.2);
    const [w, h] = size(r.outline);
    expect(w).toBeCloseTo(100.2, 9);
    expect(h).toBeCloseTo(50.2, 9);
    expect(r.holes).toHaveLength(1);
    const [hw, hh] = size(r.holes[0]!);
    expect(hw).toBeCloseTo(19.8, 9);
    expect(hh).toBeCloseTo(5.8, 9);
    expect(area(r.holes[0]!)).toBeGreaterThan(0); // still CCW
  });

  it('kerf 0 is the identity (deep copy)', () => {
    const o = rect(0, 0, 10, 10);
    const r = applyKerf(o, [], 0);
    expect(r.outline).toEqual(o);
    expect(r.outline).not.toBe(o);
  });

  it('rejects negative or non-finite kerf', () => {
    expect(() => applyKerf(rect(0, 0, 1, 1), [], -0.1)).toThrow();
    expect(() => applyKerf(rect(0, 0, 1, 1), [], NaN)).toThrow();
  });

  it('finishPart records nominal geometry and the kerf applied', () => {
    const pl: Placement = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] };
    const p = finishPart({
      id: 'a', name: 'A', outline: rect(0, 0, 10, 10), holes: [], engrave: [], placement: pl, thickness: 3, edges: [],
    }, 0.1);
    expect(p.kerf).toBe(0.1);
    expect(p.nominal.outline).toEqual(rect(0, 0, 10, 10));
    expect(size(p.outline)[0]).toBeCloseTo(10.1, 9);
  });
});

describe('placement', () => {
  it('maps local (x,y,z) to origin + x*u + y*v + z*(u x v) and back', () => {
    const pl: Placement = { origin: [1, 2, 3], x: [1, 0, 0], y: [0, 0, 1] };
    expect(placementNormal(pl)).toEqual([0, -1, 0]);
    expect(toWorld(pl, { x: 10, y: 5 })).toEqual([11, 2, 8]);
    expect(toWorld(pl, { x: 10, y: 5 }, 3)).toEqual([11, -1, 8]);
    const l = toLocal(pl, [11, -1, 8]);
    expect(l[0]).toBeCloseTo(10, 12);
    expect(l[1]).toBeCloseTo(5, 12);
    expect(l[2]).toBeCloseTo(3, 12);
  });
});

describe('materials', () => {
  it('every material thickness/kerf validates against commonParams', () => {
    expect(materials.length).toBeGreaterThanOrEqual(5);
    for (const m of materials) {
      const r = validate(commonParams, { ...defaults(commonParams), thickness: m.thickness, kerf: m.kerf });
      expect(r.ok, m.id).toBe(true);
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(getMaterial('birch3')?.thickness).toBe(3);
    expect(getMaterial('nope')).toBeUndefined();
  });
});

describe('finishWithKerf', () => {
  const pl: Placement = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] };
  const spec = (outline: Path) => ({ id: 'p', name: 'Panel', outline, holes: [], engrave: [], placement: pl, thickness: 3, edges: [] });
  const poly = (pts: [number, number][]): Path => ({
    start: { x: pts[0]![0], y: pts[0]![1] }, closed: true,
    segs: [...pts.slice(1), pts[0]!].map(([x, y]) => ({ t: 'L' as const, to: { x, y } })),
  });
  const bowtie = poly([[0, 0], [10, 10], [10, 0], [0, 10]]);
  // 20 x 10 plate with a 0.4 mm wide, 3 mm deep notch in the top edge
  const notched = poly([[0, 0], [20, 0], [20, 10], [10.2, 10], [10.2, 7], [9.8, 7], [9.8, 10], [0, 10]]);

  it('equals finishPart on valid geometry', () => {
    expect(finishWithKerf(spec(notched), 0.1)).toEqual(finishPart(spec(notched), 0.1));
  });

  it('a genuine geometry bug surfaces as GeometryError at kerf 0 and with kerf, never ParamError', () => {
    for (const kerf of [0, 0.1]) {
      expect(() => finishWithKerf(spec(bowtie), kerf)).toThrow(GeometryError);
      expect(() => finishWithKerf(spec(bowtie), kerf)).toThrow(/Panel/);
    }
    const cw = poly([[0, 0], [0, 10], [10, 10], [10, 0]]);
    expect(() => finishWithKerf(spec(cw), 0)).toThrow(GeometryError);
  });

  it('a feature closed by kerf becomes a ParamError naming kerf', () => {
    expect(() => finishWithKerf(spec(notched), 0.5)).toThrow(ParamError);
    expect(() => finishWithKerf(spec(notched), 0.5)).toThrow(/\bkerf\b.*Panel/);
  });
});
