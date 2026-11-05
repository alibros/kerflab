/**
 * DiceTower: a tower that tumbles dice over alternating ramps and drops them out of an opening at
 * the bottom of the front. Ported from boxes.py (florianfesti/boxes, boxes/generators/dicetower.py).
 *
 * Joints (edges listed bottom, right, top, left of each panel):
 *    back          w * h          'F F e F'   owns the back corners
 *    front         w * (h - gap)  'e F e F'   starts `gap` above the floor (the exit)
 *    sides         d * h          'F ? e f'   fingers into the back; into the front above the
 *                                             exit, plain (set out to the front face) below it;
 *                                             slot rows for the ramps
 *    bottom        w * d          'E f f f'   its front edge runs out to the front face
 *    ramps         w * l          'e f e f'   fingers through the side walls' slot rows
 * Ramps (top surface lines in the side view, y from the front, z from the floor): the lowest runs
 * from high at the back to low at the front, over the whole depth; each ramp above runs the other
 * way over 75 % of the depth, its low end one dice clearance above the high end of the ramp below.
 * The top of the tower is open, `headroom` above the top ramp's high end.
 *
 * World frame: x across, y from the front (y = 0) to the back, z up; outer size w + 2t, d + 2t,
 * h + t (h = the ramps' height plus the headroom).
 *
 * Deliberate differences from boxes.py (docs/differences.md): ramps clear the walls by one
 * thickness at their ends; the spacing is set by the dice clearance (boxes.py: by the ramp count and
 * height); no optional bottom.
 */
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { autoMate, slotInto } from './trays';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec, type WallEdges } from './walls';

const schema: Schema = [
  { key: 'width', label: 'Width', help: 'Inner width', unit: 'mm', group: 'Tower', kind: 'number', min: 40, max: 200, default: 70, step: 1 },
  { key: 'depth', label: 'Depth', help: 'Inner depth front to back', unit: 'mm', group: 'Tower', kind: 'number', min: 40, max: 200, default: 70, step: 1 },
  { key: 'headroom', label: 'Headroom', help: 'Free height above the top ramp to throw the dice in (the tower is as tall as the ramps need plus this)', unit: 'mm',
    group: 'Tower', kind: 'number', min: 20, max: 200, default: 50, step: 1 },
  { key: 'ramps', label: 'Ramps', help: 'Number of ramps inside', unit: '', group: 'Tower', kind: 'int', min: 2, max: 5, default: 3 },
  { key: 'angle', label: 'Ramp angle', help: 'Slope of the ramps', unit: 'deg', group: 'Tower', kind: 'number', min: 15, max: 45, default: 30, step: 1 },
  { key: 'dice', label: 'Dice clearance', help: 'Free height for the dice between ramps and at the exit (the largest die plus margin)', unit: 'mm',
    group: 'Tower', kind: 'number', min: 10, max: 40, default: 22, step: 1 },
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 6 } : d)),
];

type Ramp = { lo: [number, number]; hi: [number, number] }; // top-surface ends (y, z), inner coordinates

/** Ramp top lines, bottom ramp first, and the exit height. */
function layout(p: Params, t: number): { ramps: Ramp[]; gap: number; H: number } {
  const D = num(p, 'depth');
  const n = num(p, 'ramps');
  const a = (num(p, 'angle') * Math.PI) / 180;
  const g = num(p, 'dice');
  const tan = Math.tan(a);
  const c = t; // clearance from the walls at the ramp ends
  // Lowest ramp: low end at the front, its underside's lowest corner 1 mm above the floor.
  const lift = t / Math.cos(a) + 1;
  const ramps: Ramp[] = [];
  let span = D - 2 * c;
  ramps.push({ lo: [c, lift], hi: [c + span, lift + span * tan] });
  span = 0.75 * D - c;
  for (let k = 1; k < n; k++) {
    const below = ramps[k - 1]!;
    const fromBack = k % 2 === 0; // the ramp below rises to the back for even k-1
    // This ramp's low end sits over the high end of the one below.
    const z = below.hi[1] + g + t / Math.cos(a);
    ramps.push(fromBack ? { lo: [c, z], hi: [c + span, z + span * tan] } : { lo: [D - c, z], hi: [D - c - span, z + span * tan] });
  }
  // Inner height: the top ramp's high end plus the headroom.
  return { ramps, gap: lift + g, H: ramps[n - 1]!.hi[1] + num(p, 'headroom') };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const W = num(p, 'width');
  const D = num(p, 'depth');
  requireJointLength('width', W, t);
  const { ramps, gap, H } = layout(p, t);
  const hf = H - gap;
  requireJointLength('height', hf, t, 'front wall height above the exit');
  const X = W + 2 * t;
  const Y = D + 2 * t;
  const F = 'fingerHole' as const;
  const f = 'finger' as const;
  // Side 1 runs up, side 3 down: the plain piece below the front wall comes first on the right
  // wall's front side (1) and last on the left wall's (3).
  const sideEdges: WallEdges = [F, { pieces: [['outset', gap], ['finger', H - gap]] }, 'flat', f];
  const leftEdges: WallEdges = [F, f, 'flat', { pieces: [['finger', H - gap], ['outset', gap]] }];
  const specs: PanelSpec[] = [
    panel('back', 'Back', rectangularWall(W, H, [F, F, 'flat', F], ctx), at([t, Y, t], [1, 0, 0], [0, 0, 1]), []),
    panel('front', 'Front', rectangularWall(W, hf, ['flat', F, 'flat', F], ctx), at([t + W, 0, t + gap], [-1, 0, 0], [0, 0, 1]), []),
    // Right wall: local x from the back (y = t + D) to the front; left: from the front to the back.
    panel('right', 'Right side', rectangularWall(D, H, sideEdges, ctx), at([X, t + D, t], [0, -1, 0], [0, 0, 1]), []),
    panel('left', 'Left side', rectangularWall(D, H, leftEdges, ctx), at([0, t, t], [0, 1, 0], [0, 0, 1]), []),
    panel('bottom', 'Bottom', rectangularWall(W, D, ['outset', f, f, f], ctx), at([t, t, 0], [1, 0, 0], [0, 1, 0]), []),
  ];
  const [, , right, left] = specs as [PanelSpec, PanelSpec, PanelSpec, PanelSpec, PanelSpec];
  ramps.forEach((r, k) => {
    const dy = r.hi[0] - r.lo[0];
    const dz = r.hi[1] - r.lo[1];
    const L = Math.hypot(dy, dz);
    requireJointLength('angle', L, t, 'ramp length');
    const v: Vec3 = [0, dy / L, dz / L];
    // Show face up (z = 0 on the top surface), thickness downwards: u = -x when the ramp rises to
    // the back, +x when it rises to the front.
    const up = dy > 0;
    const o: Vec3 = [up ? t + W : t, t + r.lo[0], t + r.lo[1]];
    const ramp = panel(`ramp${k + 1}`, `Ramp ${k + 1}`, rectangularWall(W, L, ['flat', f, 'flat', f], ctx), at(o, [up ? -1 : 1, 0, 0], v), []);
    specs.push(ramp);
    slotInto(up ? left : right, ramp, [1], ctx);
    slotInto(up ? right : left, ramp, [3], ctx);
  });
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const diceTower: Generator = {
  id: 'dicetower',
  name: 'Dice tower',
  category: 'Boxes',
  description: 'Tower that tumbles dice over alternating ramps and out of an opening at the bottom of the front (DiceTower).',
  schema,
  presets: {
    'DiceTower': { width: 70, depth: 70, headroom: 50, ramps: 3, angle: 30, dice: 22 },
    'Tall, 4 ramps': { width: 80, depth: 80, headroom: 60, ramps: 4, angle: 30, dice: 24 },
    'Compact (small dice)': { width: 50, depth: 50, headroom: 35, ramps: 3, angle: 25, dice: 16, thickness: 3 },
  },
  build,
  expectedSize: (p) => {
    const t = num(p, 'thickness');
    return { x: num(p, 'width') + 2 * t, y: num(p, 'depth') + 2 * t, z: layout(p, t).H + t };
  },
};
