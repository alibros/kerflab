/**
 * KeyHolder: a wall-mounted back plate with a row of hooks for keys or similar small items,
 * ported from boxes.py (florianfesti/boxes, boxes/generators/keyholder.py, HangerEdge 'H').
 *
 * Parts:
 *    back plate   w * H   'e e e e'   a slot row per hook (interior joints); optional screw holes
 *                                     in the top padding
 *    hooks        ht * hh [e, H, e, f]  inner rectangle ht (the shank, out from the plate) by hh;
 *                                     fingers through the plate's slots, the J-shaped hanger profile
 *                                     (boxes.py HangerEdge) on the outer side
 * w = 2 * padding_left_right + n * t + (n - 1) * hook_distance, H = padding_bot + hh + padding_top.
 * The hanger reaches 0.7 hh beyond the shank: a 0.7 hh long foot ending in a tip 0.7 hh high, with a
 * hook_thickness wide gap behind the tip.
 *
 * World frame: x along the plate, y out from the wall (the plate's wall face at y = 0), z up.
 * Size w, t + ht + 0.7 hh, H.
 *
 * Deliberate differences from boxes.py (docs/differences.md): plain round screw holes instead of
 * keyhole mounting slots ('G' edge); the hook fingers use the common finger settings (boxes.py
 * defaults this generator to finger = space = 1, no surrounding spaces).
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { autoMate, slotInto, TRAY_CATEGORY } from './trays';
import { at, circle, finishPanels, num, panel, polyline, rectangularWall, requireJointLength, type CustomSide, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'num_hooks', label: 'Hooks', help: 'Number of hooks', unit: '', group: 'Hooks', kind: 'int', min: 1, max: 20, default: 7 },
  { key: 'hook_distance', label: 'Hook spacing', help: 'Gap between neighbouring hooks', unit: 'mm',
    group: 'Hooks', kind: 'number', min: 5, max: 100, default: 20, step: 1 },
  { key: 'hook_thickness', label: 'Hook thickness', help: 'Width of the hook shank and of its curl (less than 0.4 times the hook height)', unit: 'mm',
    group: 'Hooks', kind: 'number', min: 2, max: 15, default: 5, step: 0.5 },
  { key: 'hook_height', label: 'Hook height', help: 'Height of the hook where it joins the back plate; the hook reaches 0.7 times this out', unit: 'mm',
    group: 'Hooks', kind: 'number', min: 16, max: 80, default: 20, step: 1 },
  { key: 'padding_top', label: 'Top padding', help: 'Back plate above the hooks', unit: 'mm',
    group: 'Back plate', kind: 'number', min: 1, max: 100, default: 10, step: 1 },
  { key: 'padding_left_right', label: 'Side padding', help: 'Back plate left and right of the outer hooks', unit: 'mm',
    group: 'Back plate', kind: 'number', min: 1, max: 100, default: 5, step: 1 },
  { key: 'padding_bot', label: 'Bottom padding', help: 'Back plate below the hooks', unit: 'mm',
    group: 'Back plate', kind: 'number', min: 1, max: 200, default: 30, step: 1 },
  { key: 'mounting', label: 'Screw holes', help: 'Two screw holes in the top padding for hanging the plate', group: 'Back plate',
    kind: 'bool', default: false },
  { key: 'mount_diam', label: 'Screw hole diameter', help: 'Diameter of the screw holes', unit: 'mm',
    group: 'Back plate', kind: 'number', min: 2, max: 10, default: 4, step: 0.5 },
  ...commonParams,
];

function plateSize(p: Params): { w: number; H: number } {
  const t = num(p, 'thickness');
  const n = num(p, 'num_hooks');
  return {
    w: 2 * num(p, 'padding_left_right') + n * t + (n - 1) * num(p, 'hook_distance'),
    H: num(p, 'padding_bot') + num(p, 'hook_height') + num(p, 'padding_top'),
  };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const { w, H } = plateSize(p);
  return { x: w, y: num(p, 'thickness') + num(p, 'hook_thickness') + 0.7 * num(p, 'hook_height'), z: H };
}

/** boxes.py HangerEdge: the J-shaped hook profile drawn out from the shank, ending where it started plus `len`. */
function hanger(hh: number, ht: number): CustomSide {
  const ro = hh * 0.5; // outer radius of the hook bottom
  const ri = ro - ht; // inner radius
  const rb = 1.5; // burr radius of the inner corners
  const inner = hh * 0.7; // height of the tip
  const len = hh * 0.7; // length of the foot
  return {
    start: 0, end: 0,
    draw: (tt) => polyline(tt, [0, -90, len - ro, [90, ro], inner - ro - ht / 2, [180, ht / 2],
      inner - ht - ht / 2 - ri, [-90, ri], len - ht - 2 * rb - ri, [-90, rb], hh - ht - 2 * rb, [90, rb], 0, -90, 0]),
  };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const n = num(p, 'num_hooks');
  const hh = num(p, 'hook_height');
  const ht = num(p, 'hook_thickness');
  const dist = num(p, 'hook_distance');
  const lr = num(p, 'padding_left_right');
  const bot = num(p, 'padding_bot');
  const topPad = num(p, 'padding_top');
  requireJointLength('hook_height', hh, t, 'hook height');
  if (!(ht < 0.4 * hh))
    throw new ParamError(`hook_thickness too large: it must be less than 0.4 * hook_height = ${(0.4 * hh).toFixed(1)} mm`, 'hook_thickness');
  if (!(dist > ctx.play))
    throw new ParamError(`hook_distance too small: the slots of neighbouring hooks would meet (needs more than the play, ${ctx.play.toFixed(2)} mm)`, 'hook_distance');
  if (!(lr > ctx.play / 2 + 0.5))
    throw new ParamError(`padding_left_right too small: the outer slots need ${(ctx.play / 2 + 0.5).toFixed(2)} mm of plate beside them`, 'padding_left_right');
  const { w, H } = plateSize(p);

  const plate = rectangularWall(w, H, ['flat', 'flat', 'flat', 'flat'], ctx);
  if (p.mounting === true) {
    const d = num(p, 'mount_diam');
    if (!(topPad >= d + 2))
      throw new ParamError(`padding_top too small for screw holes: needs ${(d + 2).toFixed(1)} mm (hole diameter + 2 mm)`, 'padding_top');
    if (!(w / 4 >= d / 2 + 1))
      throw new ParamError(`mount_diam too large: the screw holes do not fit a ${w.toFixed(1)} mm wide plate`, 'mount_diam');
    const z = bot + hh + topPad / 2;
    plate.holes.push(circle(w / 4, z, d / 2), circle((3 * w) / 4, z, d / 2));
  }
  // Plate: u = -x (local x = w - world x), v = +z, normal +y; its z = 0 face is the wall face (y = 0).
  const back = panel('back', 'Back plate', plate, at([w, 0, 0], [-1, 0, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [back];
  for (let k = 0; k < n; k++) {
    const xm = lr + t / 2 + k * (dist + t); // world x of the hook's mid-plane
    // Hook: u = +y from the plate's front face, v = +z, normal +x; fingers back through the plate.
    const hook = panel(`hook${k + 1}`, 'Hook', rectangularWall(ht, hh, ['flat', hanger(hh, ht), 'flat', 'finger'], ctx),
      at([xm - t / 2, t, bot], [0, 1, 0], [0, 0, 1]), []);
    slotInto(back, hook, [3], ctx);
    specs.push(hook);
  }
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const keyHolder: Generator = {
  id: 'keyholder',
  name: 'Key holder',
  category: TRAY_CATEGORY,
  description: 'Wall-mounted back plate with a row of J-shaped hooks for keys, with optional screw holes.',
  schema,
  presets: {
    'Key rack': { num_hooks: 7, hook_distance: 20, hook_thickness: 5, hook_height: 20, mounting: true, padding_top: 10 },
    'Coat hooks': { num_hooks: 4, hook_distance: 60, hook_thickness: 10, hook_height: 40, padding_top: 20, padding_bot: 40, padding_left_right: 20, mounting: true, mount_diam: 5, thickness: 6 },
    'Small tool hooks': { num_hooks: 10, hook_distance: 12, hook_thickness: 4, hook_height: 16, padding_bot: 15, thickness: 3 },
  },
  build,
  expectedSize,
  // The hooks point +y, away from the default camera: look at the hook side.
  view: { turn: 180 },
};
