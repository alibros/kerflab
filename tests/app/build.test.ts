import { describe, expect, it } from 'vitest';
import { defaults } from '../../src/core/schema';
import { getGenerator } from '../../src/generators';
import { cutLength, runBuild } from '../../src/app/build';

const g = getGenerator('closedbox')!;

describe('runBuild', () => {
  it('returns parts and a nested layout for valid params', () => {
    const r = runBuild(g, defaults(g.schema), { w: 600, h: 400 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts.length).toBe(6);
    expect(r.layout.placed.length).toBe(6);
    expect(r.layout.sheets).toBe(1);
  });

  it('maps a ParamError to the offending field, never throws', () => {
    const r = runBuild(g, { ...defaults(g.schema), x: 10, thickness: 5 }, { w: 600, h: 400 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.param).toBe('x');
    expect(r.message).toMatch(/^Width too small: inner width is 10\.00 mm/);
  });

  it('reports schema validation errors per field', () => {
    const r = runBuild(g, { ...defaults(g.schema), x: -1 }, { w: 600, h: 400 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.param).toBe('x');
  });

  it('measures cut length of lines and arcs', () => {
    const square = { start: { x: 0, y: 0 }, closed: true, segs: [
      { t: 'L' as const, to: { x: 10, y: 0 } }, { t: 'L' as const, to: { x: 10, y: 10 } },
      { t: 'L' as const, to: { x: 0, y: 10 } }, { t: 'L' as const, to: { x: 0, y: 0 } },
    ] };
    expect(cutLength([square])).toBeCloseTo(40, 9);
    const circle = { start: { x: 1, y: 0 }, closed: true, segs: [{ t: 'A' as const, to: { x: 1, y: 0 }, c: { x: 0, y: 0 }, ccw: true }] };
    expect(cutLength([circle])).toBeCloseTo(2 * Math.PI, 9);
  });
});
