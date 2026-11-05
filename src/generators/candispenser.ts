/**
 * Can dispenser: a closed box in which cans roll down zig-zag ramps to an opening at the bottom of
 * the front, after boxes.py CanStorage (florianfesti/boxes, boxes/generators/canstorage.py). Cans
 * lie across the box (their length along x) and are dropped in through a slot in the top; first in,
 * first out.
 *
 * Ramps (top-surface lines in the side view; y from the front inner face, z from the floor's top):
 * ramp 1 (the lowest) falls to the front over the whole depth; each ramp above falls the other way
 * and stops one can (diameter + clearance) short of the wall at its low end, so cans drop onto the
 * ramp below. Its low end is a can's height (diameter / cos(angle) + clearance) above the ramp
 * below's surface there plus a ramp thickness, which is where the two are closest. Ramp ends clear
 * the front and back walls by one thickness. The front has the dispensing opening `stop` above the
 * lowest ramp's front end (the wall below it stops the cans); the top has the filling slot above
 * the top ramp's high end.
 *
 * Joints (edges listed bottom, right, top, left of each panel; as closedbox):
 *    front, back   x * H    'FFFF'    the front with the dispensing opening
 *    sides         D * H    'FfFf'    slot rows for the ramps
 *    bottom, top   x * D    'ffff'    the top with the filling slot
 *    ramps         x * L    'efef'    fingers through the side walls' slot rows
 *
 * World frame: x across (along the cans), y from the front (y = 0) to the back, z up; outer size
 * x + 2t, D + 2t, H + 2t with x = can length + clearance.
 *
 * Deliberate differences from boxes.py: ramps are plain plates in slot rows (boxes.py: chutes with
 * their own walls); the number of ramps is a parameter; cans are filled through the top.
 */
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { STORAGE_CATEGORY } from './storage';
import { autoMate, slotInto } from './trays';
import { at, finishPanels, num, panel, rect, rectangularWall, requireJointLength, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'can_d', label: 'Can diameter', help: 'Diameter of the cans', unit: 'mm', group: 'Cans',
    kind: 'number', min: 20, max: 150, default: 66, step: 1 },
  { key: 'can_length', label: 'Can length', help: 'Length (height) of the cans; the box is this plus the clearance wide inside', unit: 'mm',
    group: 'Cans', kind: 'number', min: 30, max: 300, default: 115, step: 1 },
  { key: 'depth', label: 'Depth', help: 'Inner depth front to back (each ramp holds about depth / diameter cans)', unit: 'mm',
    group: 'Dispenser', kind: 'number', min: 120, max: 800, default: 350, step: 1 },
  { key: 'ramps', label: 'Ramps', help: 'Number of zig-zag ramps (levels of cans)', group: 'Dispenser',
    kind: 'int', min: 1, max: 4, default: 2 },
  { key: 'angle', label: 'Ramp angle', help: 'Slope of the ramps', unit: 'deg', group: 'Dispenser',
    kind: 'number', min: 3, max: 20, default: 8, step: 0.5 },
  { key: 'stop', label: 'Stop height', help: 'Height of the front wall below the dispensing opening, above the lowest ramp (keeps the front can in)', unit: 'mm',
    group: 'Dispenser', kind: 'number', min: 3, max: 50, default: 15, step: 1 },
  { key: 'clearance', label: 'Clearance', help: 'Free space around the cans (width, drop gaps, height between ramps)', unit: 'mm',
    group: 'Dispenser', kind: 'number', min: 1, max: 15, default: 4, step: 0.5 },
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 8 } : d)),
];

type Ramp = { lo: [number, number]; hi: [number, number] }; // top-surface ends (y, z), inner coordinates

/** Ramps bottom first, the opening's bottom and top, the inner height and the filling slot's y range. */
function layout(p: Params): { ramps: Ramp[]; open: [number, number]; H: number; fill: [number, number] } {
  const t = num(p, 'thickness');
  const D = num(p, 'depth');
  const d = num(p, 'can_d');
  const c0 = num(p, 'clearance');
  const n = num(p, 'ramps');
  const a = (num(p, 'angle') * Math.PI) / 180;
  const tan = Math.tan(a);
  const tc = t / Math.cos(a); // vertical thickness of a ramp
  const V = d / Math.cos(a) + c0; // free height for a can above a ramp
  const g = d + c0; // drop gap at a ramp's low end
  const c = t; // clearance from the walls at the ramp ends
  const z0 = tc + 1;
  const ramps: Ramp[] = [{ lo: [c, z0], hi: [D - c, z0 + (D - 2 * c) * tan] }];
  const open: [number, number] = [z0 + num(p, 'stop'), z0 + num(p, 'stop') + d + c0];
  const span = D - c - g;
  const surface = (r: Ramp, y: number): number => r.lo[1] + ((y - r.lo[0]) / (r.hi[0] - r.lo[0])) * (r.hi[1] - r.lo[1]);
  for (let k = 1; k < n; k++) {
    const toBack = k % 2 === 1;
    const ylo = toBack ? D - g : g;
    const yhi = toBack ? c : D - c;
    let zlo = surface(ramps[k - 1]!, ylo) + tc + V;
    // Ramp 2 passes over the opening: its front end's underside stays above the opening's top.
    if (k === 1) zlo = Math.max(zlo, open[1] + t + tc - span * tan);
    ramps.push({ lo: [ylo, zlo], hi: [yhi, zlo + span * tan] });
  }
  const top = ramps[n - 1]!;
  const H = Math.max(top.hi[1] + V, open[1] + 2 * t);
  const fill: [number, number] = top.hi[0] < D / 2 ? [t, t + g] : [D - t - g, D - t];
  return { ramps, open, H, fill };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const W = num(p, 'can_length') + num(p, 'clearance');
  const D = num(p, 'depth');
  const d = num(p, 'can_d');
  requireJointLength('can_length', W, t);
  const g = d + num(p, 'clearance');
  if (num(p, 'ramps') > 1 && D - t - g < 2 * d)
    throw new ParamError(`depth too small: ${D} mm leaves the upper ramps less than two cans (${(2 * d).toFixed(0)} mm) long; at least ${(t + g + 2 * d).toFixed(0)} mm`, 'depth');
  if (D < 2 * d + 2 * t)
    throw new ParamError(`depth too small: ${D} mm holds less than two ${d} mm cans`, 'depth');
  if (W < 4 * t)
    throw new ParamError(`can_length too small: the box is ${W.toFixed(1)} mm wide, the openings need at least ${(4 * t).toFixed(1)} mm`, 'can_length');
  const { ramps, open, H, fill } = layout(p);
  const X = W + 2 * t;
  const Y = D + 2 * t;
  const F = 'fingerHole' as const;
  const f = 'finger' as const;

  const front = rectangularWall(W, H, [F, F, F, F], ctx);
  front.holes.push(rect(t, open[0], W - t, open[1]));
  const top = rectangularWall(W, D, [f, f, f, f], ctx);
  // Top: local y = D - (inner y), so the slot over inner y in [a, b] is local [D - b, D - a].
  top.holes.push(rect(t, D - fill[1], W - t, D - fill[0]));
  const specs: PanelSpec[] = [
    panel('front', 'Front', front, at([t + W, 0, t], [-1, 0, 0], [0, 0, 1]), []),
    panel('back', 'Back', rectangularWall(W, H, [F, F, F, F], ctx), at([t, Y, t], [1, 0, 0], [0, 0, 1]), []),
    panel('right', 'Right side', rectangularWall(D, H, [F, f, F, f], ctx), at([X, t + D, t], [0, -1, 0], [0, 0, 1]), []),
    panel('left', 'Left side', rectangularWall(D, H, [F, f, F, f], ctx), at([0, t, t], [0, 1, 0], [0, 0, 1]), []),
    panel('bottom', 'Bottom', rectangularWall(W, D, [f, f, f, f], ctx), at([t, t, 0], [1, 0, 0], [0, 1, 0]), []),
    panel('top', 'Top', top, at([t, t + D, H + 2 * t], [1, 0, 0], [0, -1, 0]), []),
  ];
  const [, , right, left] = specs as [PanelSpec, PanelSpec, PanelSpec, PanelSpec];
  ramps.forEach((r, k) => {
    const dy = r.hi[0] - r.lo[0];
    const dz = r.hi[1] - r.lo[1];
    const L = Math.hypot(dy, dz);
    requireJointLength('depth', L, t, 'ramp length');
    const v: Vec3 = [0, dy / L, dz / L];
    const up = dy > 0; // rises to the back
    const o: Vec3 = [up ? t + W : t, t + r.lo[0], t + r.lo[1]];
    const ramp = panel(`ramp${k + 1}`, `Ramp ${k + 1}`, rectangularWall(W, L, ['flat', f, 'flat', f], ctx), at(o, [up ? -1 : 1, 0, 0], v), []);
    specs.push(ramp);
    slotInto(up ? left : right, ramp, [1], ctx);
    slotInto(up ? right : left, ramp, [3], ctx);
  });
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const canDispenser: Generator = {
  id: 'candispenser',
  name: 'Can dispenser',
  category: STORAGE_CATEGORY,
  description: 'Closed box in which cans roll down zig-zag ramps to an opening at the front, filled through a slot in the top (CanStorage, can organizer, gravity feed).',
  schema,
  presets: {
    'CanStorage (330 ml cans, 2 ramps)': { can_d: 66, can_length: 115, depth: 350, ramps: 2, angle: 8 },
    'Food tins (400 g, 3 ramps)': { can_d: 74, can_length: 110, depth: 380, ramps: 3, angle: 7, thickness: 4 },
    'Single ramp feeder': { can_d: 53, can_length: 100, depth: 300, ramps: 1, angle: 10, stop: 12 },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    return { x: num(p, 'can_length') + num(p, 'clearance') + 2 * t, y: num(p, 'depth') + 2 * t, z: layout(p).H + 2 * t };
  },
};
