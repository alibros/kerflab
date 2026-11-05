/**
 * Beam & bracket: plates finger-jointed along their length at right angles: an L angle or a U
 * channel, optionally with triangular gussets at both ends and mounting holes (a NEMA stepper or
 * corner screws on the upright, screw holes in the base). Generic version of boxes.py
 * (florianfesti/boxes) LBeam, ZBeam (its U-beam form) and NemaMount (lbeam.py, zbeam.py,
 * nemamount.py); those are presets.
 *
 * Joints (edges listed bottom, right, top, left of each panel):
 *    base      length * (b - t [- t])  'f e [f] e'   fingers into the uprights
 *    front     length * (a - t)        'F e e e'     upright at y = 0; owns the corner
 *    back (U)  length * (c - t)        'F e e e'     upright at y = b
 *    gussets   right triangles         'f e f'       legs through slot rows in the base and front,
 *                                                    one thickness in from each end
 * World frame: length along x, the base in z in [0, t] spanning y in [0, b], the front upright in
 * y in [0, t] rising to z = a; a, b, c are outer leg widths.
 *
 * Deliberate differences from boxes.py (docs/differences.md): no Z profile (its middle plate would
 * need joints on both faces); NemaMount's gussets go through slot rows one thickness in from the
 * ends (boxes.py: at the ends) and the base has round screw holes (boxes.py: slots).
 */
import type { Vec2 } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { MECHANICAL_CATEGORY } from './gears';
import { MOUNTS } from './patterns';
import { autoMate, slotInto } from './trays';
import { at, circle, finishPanels, num, panel, polygonPlate, rectangularWall, requireJointLength, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'profile', label: 'Profile', help: 'L angle (base and one upright) or U channel (an upright on each side)', group: 'Beam',
    kind: 'enum', options: ['L', 'U'], default: 'L' },
  { key: 'length', label: 'Length', help: 'Length of the beam along the joints', unit: 'mm', group: 'Beam', kind: 'number', min: 20, max: 1000, default: 100, step: 1 },
  { key: 'a', label: 'Upright', help: 'Outer height of the front upright', unit: 'mm', group: 'Beam', kind: 'number', min: 15, max: 400, default: 40, step: 1 },
  { key: 'b', label: 'Base', help: 'Outer width of the base', unit: 'mm', group: 'Beam', kind: 'number', min: 15, max: 400, default: 40, step: 1 },
  { key: 'c', label: 'Back upright', help: 'U channel: outer height of the back upright', unit: 'mm', group: 'Beam', kind: 'number', min: 15, max: 400, default: 40, step: 1 },
  { key: 'gussets', label: 'Gussets', help: 'L angle: triangular braces one thickness in from each end', group: 'Bracket', kind: 'bool', default: false },
  { key: 'face_mount', label: 'Upright holes', help: 'Holes in the front upright: a NEMA 17/23 stepper (centre opening and 4 screws) or 4 corner screws',
    group: 'Bracket', kind: 'enum', options: ['none', 'corners', 'nema17', 'nema23'], default: 'none' },
  { key: 'base_holes', label: 'Base holes', help: 'Two screw holes in the base to fix the bracket down', group: 'Bracket', kind: 'bool', default: false },
  { key: 'screw', label: 'Screw hole', help: 'Diameter of the corner and base screw holes', unit: 'mm', group: 'Bracket', kind: 'number', min: 2, max: 8, default: 3.5, step: 0.1 },
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const L = num(p, 'length');
  const u = p.profile === 'U';
  const ha = num(p, 'a') - t;
  const wb = num(p, 'b') - (u ? 2 : 1) * t;
  requireJointLength('length', L, t);
  requireJointLength('a', ha, t, 'inner upright height');
  requireJointLength('b', wb, t, 'inner base width');
  const gus = !u && p.gussets === true;
  const s = num(p, 'screw');

  // Front upright: holes centred on its inner rectangle (between the gussets' slot rows).
  const front = rectangularWall(L, ha, ['fingerHole', 'flat', 'flat', 'flat'], ctx);
  const fm = String(p.face_mount);
  const x0 = gus ? 2 * t + 1 : 0; // usable span along the length (clear of the gusset slots)
  const span = L - 2 * x0;
  if (MOUNTS[fm]) {
    const m = MOUNTS[fm]!;
    const need = m.spacing + m.hole + 2;
    if (!(need <= span && need <= ha - 1))
      throw new ParamError(`face_mount ${fm} needs ${need.toFixed(1)} mm of upright (length${gus ? ' between the gussets' : ''} ${span.toFixed(1)} mm, inner height ${ha.toFixed(1)} mm)`, 'face_mount');
    const c = { x: L / 2, y: ha / 2 };
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) front.holes.push(circle(c.x + (sx * m.spacing) / 2, c.y + (sy * m.spacing) / 2, m.hole / 2));
    front.holes.push(circle(c.x, c.y, m.centre / 2));
  } else if (fm === 'corners') {
    const off = 2 * s;
    if (!(2 * off + s + 1 <= Math.min(span, ha))) throw new ParamError('screw too large for the upright: the corner holes would meet or hit the gussets', 'screw');
    for (const q of [{ x: x0 + off, y: off }, { x: L - x0 - off, y: off }, { x: L - x0 - off, y: ha - off }, { x: x0 + off, y: ha - off }]) front.holes.push(circle(q.x, q.y, s / 2));
  }
  const base = rectangularWall(L, wb, ['finger', 'flat', u ? 'finger' : 'flat', 'flat'], ctx);
  if (p.base_holes === true) {
    if (!(s + 2 <= wb && 2 * s + 2 <= span / 2)) throw new ParamError('screw too large for the base', 'screw');
    for (const fx of [0.25, 0.75]) base.holes.push(circle(x0 + fx * span, gus ? Math.min(wb / 2, wb - s) : wb / 2, s / 2));
  }
  const specs: PanelSpec[] = [
    panel('front', 'Upright', front, at([L, 0, t], [-1, 0, 0], [0, 0, 1]), []),
    panel('base', 'Base', base, at([0, t, 0], [1, 0, 0], [0, 1, 0]), []),
  ];
  if (u) {
    const hc = num(p, 'c') - t;
    requireJointLength('c', hc, t, 'inner back upright height');
    specs.push(panel('back', 'Back upright', rectangularWall(L, hc, ['fingerHole', 'flat', 'flat', 'flat'], ctx), at([0, wb + 2 * t, t], [1, 0, 0], [0, 0, 1]), []));
  }
  if (gus) {
    // Right triangles in the inner corner (y = t, z = t), legs along the base and the upright.
    const lb = wb - t;
    const la = ha - t;
    requireJointLength('b', lb, t, 'gusset leg along the base');
    requireJointLength('a', la, t, 'gusset leg up the upright');
    // gusset1 at x = t: u = +y, v = +z (normal +x); gusset2 at x = L - t: u = +z, v = +y (normal -x).
    // Side 0 runs along u and fingers towards -v, side 2 along v towards -u.
    const [frontSpec, baseSpec] = [specs[0]!, specs[1]!];
    const ends: [string, [number, number, number], [number, number, number], [number, number, number], Vec2[], PanelSpec, PanelSpec][] = [
      ['gusset1', [t, t, t], [0, 1, 0], [0, 0, 1], [{ x: 0, y: 0 }, { x: lb, y: 0 }, { x: 0, y: la }], baseSpec, frontSpec],
      ['gusset2', [L - t, t, t], [0, 0, 1], [0, 1, 0], [{ x: 0, y: 0 }, { x: la, y: 0 }, { x: 0, y: lb }], frontSpec, baseSpec],
    ];
    for (const [id, o, uu, vv, pts, side0, side2] of ends) {
      const w = polygonPlate(pts, ['finger', 'flat', 'finger'], ctx);
      w.lines = w.lines.filter((l) => l.type !== 'flat');
      const g = panel(id, 'Gusset', w, at(o, uu, vv), []);
      specs.push(g);
      slotInto(side0, g, [0], ctx);
      slotInto(side2, g, [2], ctx);
    }
  }
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const beam: Generator = {
  id: 'beam',
  name: 'Beam & bracket',
  category: MECHANICAL_CATEGORY,
  description: 'Finger-jointed L angle or U channel, optionally a bracket with gussets and NEMA stepper or screw holes (LBeam, ZBeam U-beam, NemaMount).',
  schema,
  presets: {
    'LBeam': { profile: 'L', length: 100, a: 40, b: 40 },
    'U channel (ZBeam U-beam)': { profile: 'U', length: 200, a: 30, b: 50, c: 30 },
    'NemaMount 17': { profile: 'L', length: 58, a: 58, b: 50, gussets: true, face_mount: 'nema17', base_holes: true, screw: 4 },
    'Shelf bracket': { profile: 'L', length: 60, a: 150, b: 120, gussets: true, face_mount: 'corners', thickness: 6 },
  },
  build,
  expectedSize: (p) => {
    const u = p.profile === 'U';
    return { x: num(p, 'length'), y: num(p, 'b'), z: u ? Math.max(num(p, 'a'), num(p, 'c')) : num(p, 'a') };
  },
};
