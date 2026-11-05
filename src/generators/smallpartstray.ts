/**
 * SmallPartsTray: a tray whose compartments have ramps sloping up to the front (and back), so
 * screws or game tokens slide out easily, ported from boxes.py (florianfesti/boxes,
 * boxes/generators/smallpartstray.py).
 *
 * Cross-section (y, z inner; y from the inner front): floor from y = ry to y - ry (one-sided: to
 * y), ramps rising at `angle` from the floor to rh = rampheight * h at the front (and back), then
 * a vertical panel up to h. Every panel spans the width X and has fingers 'f' at both ends into
 * the side walls (slot rows along the ramps, notched end pieces for the vertical panels and the
 * floor); the ramps meet the floor and the panels with plain edges, as in boxes.py.
 *    side walls  y * h   bottom 'E F E' (one-sided 'E F'), ends 'F E' / 'E F' (one-sided: back 'F')
 *    floor       X * (y - 2 ry)        (one-sided: fingers into the back wall too)
 *    ramps       X * rl  rl = sqrt(ry^2 + rh^2), lower face on the floor's top corner line
 *    panels      X * (h - rh)          (one-sided back wall: X * h, notched bottom)
 *    dividers    the compartment profile, fingers into the floor, ramps and panels (slot rows)
 *
 * World frame: x across, y from the front (front panel's outer face at y = 0), z up (floor
 * underside at z = 0). Outer size X + 2t, y + 2t, h + t with X = cols * x + (cols - 1) t.
 *
 * Deliberate differences from boxes.py (docs/differences.md): equal compartments (x, cols)
 * instead of an sx list; always a front panel (front_panel off leaves boxes.py's ramp ends and
 * slots outside the side walls); no loose sliding dividers and no lid; angle limited to 30..80
 * degrees so the ramp slots stay inside the side walls.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { autoMate, equal, holesInside, requireMaxSize, slotInto, span, TRAY_CATEGORY, wallOffsets } from './trays';
import { at, finishPanels, num, panel, polygonPlate, rectangularWall, requireJointLength, type PanelSpec, type WallEdges } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Compartment width', help: 'Width of each compartment (inner), or the overall outer width when "Inner dimensions" is off', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 400, default: 50, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth front to back (inner, or the overall outer depth)', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 500, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height (inner, above the floor; or the overall height)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 300, default: 30, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x is one compartment, y and h the inside. Off: they are the overall outer size',
    group: 'Size', kind: 'bool', default: false },
  { key: 'cols', label: 'Compartments', help: 'Number of compartments side by side (dividers between them)', unit: '',
    group: 'Compartments', kind: 'int', min: 1, max: 8, default: 3 },
  { key: 'angle', label: 'Ramp angle', help: 'Slope of the ramps', unit: 'deg', group: 'Compartments', kind: 'number', min: 30, max: 80, default: 45, step: 1 },
  { key: 'rampheight', label: 'Ramp height', help: 'Height of the ramps as a fraction of the height (reduced when the ramps would not fit the depth)', unit: '',
    group: 'Compartments', kind: 'number', min: 0.1, max: 0.8, default: 0.5, step: 0.05 },
  { key: 'two_sided', label: 'Two-sided', help: 'Ramps at the front and the back (off: a vertical back wall)', group: 'Compartments', kind: 'bool', default: true },
  ...commonParams,
];

function inner(p: Params): { sx: number[]; y: number; h: number } {
  const t = num(p, 'thickness');
  const n = num(p, 'cols');
  if (p.inside !== false) return { sx: equal(n * num(p, 'x'), n), y: num(p, 'y'), h: num(p, 'h') };
  return { sx: equal(num(p, 'x') - (n + 1) * t, n), y: num(p, 'y') - 2 * t, h: num(p, 'h') - t };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = inner(p);
  return { x: span(i.sx, t) + 2 * t, y: i.y + 2 * t, z: i.h + t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { sx, y, h } = inner(p);
  for (const v of sx) requireJointLength('x', v, t, 'compartment width');
  requireJointLength('y', y, t);
  requireJointLength('h', h, t);
  const X = span(sx, t);
  requireMaxSize('x', X + 2 * t);
  const two = p.two_sided !== false;
  const a = (num(p, 'angle') * Math.PI) / 180;
  let rh = num(p, 'rampheight') * h;
  let ry = rh / Math.tan(a);
  const maxRy = two ? (y - 3 * t) / 2 : y - 3 * t; // leave the floor room for a finger joint
  if (ry > maxRy) {
    ry = maxRy;
    rh = ry * Math.tan(a);
  }
  if (!(ry > 0)) throw new ParamError(`y too small: no room for the ramps (depth ${y.toFixed(1)} mm)`, 'y');
  const rl = Math.hypot(ry, rh);
  requireJointLength('rampheight', rl, t, 'ramp length');
  requireJointLength('rampheight', h - rh, t, 'panel height above the ramp');
  const S = Math.sin(a);
  const C = Math.cos(a);
  const Lf = two ? y - 2 * ry : y - ry;
  const yw = (yi: number): number => t + yi; // world y of an inner y
  const zw = (zi: number): number => t + zi;

  const F = 'fingerHole' as const;
  const E = 'outset' as const;
  const sideEdges = (front: boolean): WallEdges => { // u along +y from the front (left wall) or back (right wall)
    const bottom = two ? { pieces: [[E, ry], [F, Lf], [E, ry]] as [typeof E | typeof F, number][] }
      : { pieces: (front ? [[E, ry], [F, Lf]] : [[F, Lf], [E, ry]]) as [typeof E | typeof F, number][] };
    const up = { pieces: [[E, rh], [F, h - rh]] as [typeof E | typeof F, number][] }; // side 1, bottom -> top
    const down = { pieces: [[F, h - rh], [E, rh]] as [typeof E | typeof F, number][] }; // side 3, top -> bottom
    // Left wall (front = true): side 1 is the back end, side 3 the front end; right wall: mirrored.
    if (two) return [bottom, up, 'flat', down];
    return front ? [bottom, F, 'flat', down] : [bottom, up, 'flat', F];
  };
  const left = panel('left', 'Left side', rectangularWall(y, h, sideEdges(true), ctx), at([0, t, t], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right side', rectangularWall(y, h, sideEdges(false), ctx), at([X + 2 * t, t + y, t], [0, -1, 0], [0, 0, 1]), []);

  const specs: PanelSpec[] = [left, right];
  // Floor: normal +z, local y from the floor's front edge (inner y = ry).
  const floor = panel('floor', 'Floor', rectangularWall(X, Lf, ['flat', 'finger', two ? 'flat' : 'finger', 'finger'], ctx),
    at([t, yw(ry), 0], [1, 0, 0], [0, 1, 0]), []);
  // Front ramp: u = -x, v up the slope, normal (0, sin a, cos a) into the compartments.
  const frontRamp = panel('rampfront', 'Ramp (front)', rectangularWall(X, rl, ['flat', 'finger', 'flat', 'finger'], ctx),
    at([t + X, yw(ry) - t * S, zw(0) - t * C], [-1, 0, 0], [0, -C, S]), []);
  const frontPanel = panel('front', 'Front', rectangularWall(X, h - rh, ['flat', 'finger', 'flat', 'finger'], ctx),
    at([t + X, 0, zw(rh)], [-1, 0, 0], [0, 0, 1]), []);
  specs.push(floor, frontRamp, frontPanel);
  let backRamp: PanelSpec | undefined;
  let back: PanelSpec;
  if (two) {
    backRamp = panel('rampback', 'Ramp (back)', rectangularWall(X, rl, ['flat', 'finger', 'flat', 'finger'], ctx),
      at([t, yw(y - ry) + t * S, zw(0) - t * C], [1, 0, 0], [0, C, S]), []);
    back = panel('back', 'Back', rectangularWall(X, h - rh, ['flat', 'finger', 'flat', 'finger'], ctx), at([t, y + 2 * t, zw(rh)], [1, 0, 0], [0, 0, 1]), []);
    specs.push(backRamp, back);
  } else {
    back = panel('back', 'Back', rectangularWall(X, h, ['fingerHole', 'finger', 'flat', 'finger'], ctx), at([t, y + 2 * t, t], [1, 0, 0], [0, 0, 1]), []);
    specs.push(back);
  }
  slotInto(left, frontRamp, [1], ctx);
  slotInto(right, frontRamp, [3], ctx);
  if (backRamp) {
    slotInto(right, backRamp, [1], ctx);
    slotInto(left, backRamp, [3], ctx);
  }
  // At steep angles with thick material the slots at the ramp ends reach past the side walls.
  for (const s of [left, right])
    if (!holesInside(s.outline, s.holes, 1e-3))
      throw new ParamError('angle too steep for this thickness: the ramp slots would break out of the side walls (lower the angle or the ramp height)', 'angle');

  // Dividers: the compartment profile in (inner y, inner z), u = +y, v = +z, normal +x.
  const profile = two
    ? [{ x: ry, y: 0 }, { x: y - ry, y: 0 }, { x: y, y: rh }, { x: y, y: h }, { x: 0, y: h }, { x: 0, y: rh }]
    : [{ x: ry, y: 0 }, { x: y, y: 0 }, { x: y, y: h }, { x: 0, y: h }, { x: 0, y: rh }];
  const types = two ? ['finger', 'finger', 'finger', 'flat', 'finger', 'finger'] as const : ['finger', 'finger', 'flat', 'finger', 'finger'] as const;
  const targets = two ? [floor, backRamp!, back, undefined, frontPanel, frontRamp] : [floor, back, undefined, frontPanel, frontRamp];
  for (const [j, x0] of wallOffsets(sx, t).map((o) => t + o).entries()) {
    const d = panel(`divider${j + 1}`, 'Divider', polygonPlate(profile, [...types], ctx), at([x0, t, t], [0, 1, 0], [0, 0, 1]), []);
    targets.forEach((tg, k) => { if (tg) slotInto(tg, d, [k], ctx); });
    specs.push(d);
  }
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const smallPartsTray: Generator = {
  id: 'smallpartstray',
  name: 'Small-parts tray',
  category: TRAY_CATEGORY,
  description: 'Tray with ramps up to the front (and back) so screws, beads or game tokens slide out easily.',
  schema,
  presets: {
    'Screw tray': { x: 150, y: 100, h: 30, cols: 3, angle: 45, rampheight: 0.5, two_sided: true, inside: false },
    'Token tray, one-sided': { x: 40, y: 80, h: 25, cols: 5, angle: 40, rampheight: 0.6, two_sided: false, inside: true },
    'Bead scoop tray': { x: 60, y: 60, h: 35, cols: 2, angle: 60, rampheight: 0.4, two_sided: true, inside: true },
  },
  build,
  expectedSize,
};

