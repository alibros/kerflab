/**
 * DiceBox: a box with a lid on an integrated chest hinge, holding seven dice in hexagonal holes
 * of a plate at the top of the box, capped by a plate at the bottom of the lid, with magnet holes
 * to keep it shut; ported from boxes.py (florianfesti/boxes, boxes/generators/dicebox.py).
 *
 * The box and lid are integratedhinge's (`chestHingePanels` with `plates`: rings, loose discs and
 * pins; see integratedhinge.ts). Added:
 *    box plate   x * y   'f e f e'   the box's top: its top face in the hinge axis plane (z1 = t + h),
 *                                    fingers into the notched top edges of the box front and back;
 *                                    seven hexagonal dice holes and two magnet holes
 *    lid plate   x * y   'f e f e'   the lid's bottom: its bottom face in the same plane, fingers into
 *                                    the notched bottom edges of the lid front and back; magnet holes
 *                                    only, so it caps the dice
 * Their sides are plain, between the side walls (the box sides end lower, under the hinge band).
 * When the lid is shut the plates touch (a flat resting mate on their left edges): the magnets,
 * flush in matching holes, meet. The dice stand on the box bottom; the inner box height is derived
 * from them, h = dice_height + dice_clearance * t, so their tops are dice_clearance * t below the lid plate
 * and still inside the box plate's holes (dice_clearance, in thicknesses, is at most 0.5).
 * Holes (boxes.py diceCB): seven hexagons, one in the centre and six around it, of apothem
 * a = (min(x, y) - 4t) / 6 with t between neighbours, corners rounded by hex_hole_corner_radius;
 * two magnet holes at the front corners.
 *
 * World frame and size as integratedhinge: the closed box is [0, X] x [0, Y] x [0, Z],
 * Z = 2t + h + lidheight (inner); the hinge rings stand pin + strength behind the back face.
 *
 * Deliberate differences from boxes.py (docs/differences.md): the box height comes from
 * dice_height (boxes.py has a free h, so dice can rattle); the lid plate has no dice holes (in
 * boxes.py the dice reach through it into the lid, held only by the lid top); the hinge
 * differences of integratedhinge apply; the corner radius is limited to 0.9 of the apothem.
 */
import type { Path } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { edgeCtx, effectiveKerf, type ParamDef, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { chestHingePanels, hingeDims, integratedHingeBox } from './integratedhinge';
import { TRAY_CATEGORY } from './trays';
import { at, circle, finishPanels, num, panel, rectangularWall, type PanelSpec } from './walls';
import { Turtle } from '../core/turtle';

const DEFAULTS: Record<string, number | boolean> = { x: 100, y: 100, lidheight: 25, inside: false };

const base = integratedHingeBox.schema.filter((d) => d.key !== 'h');
const schema: Schema = [
  ...base.filter((d) => d.key in DEFAULTS).map((d) => ({ ...d, default: DEFAULTS[d.key] }) as ParamDef),
  { key: 'dice_height', label: 'Dice height', help: 'Height of the tallest die standing in its hole; sets the inner box height', unit: 'mm',
    group: 'Dice', kind: 'number', min: 5, max: 200, default: 22, step: 0.5 },
  { key: 'dice_clearance', label: 'Dice clearance', help: 'Gap between the top of the tallest die and the lid plate when shut, in multiples of thickness (at most 0.5: the box plate still holds half its thickness of the die)',
    unit: '', group: 'Dice', kind: 'number', min: 0.02, max: 0.5, default: 0.15, step: 0.01 },
  { key: 'hex_hole_corner_radius', label: 'Hex corner radius', help: 'Corner radius of the hexagonal dice holes (limited to 0.9 of their apothem)', unit: 'mm',
    group: 'Dice', kind: 'number', min: 0, max: 20, default: 5, step: 0.5 },
  { key: 'magnet_diameter', label: 'Magnet diameter', help: 'Diameter of the two magnet holes that hold the lid shut; 0 for none', unit: 'mm',
    group: 'Dice', kind: 'number', min: 0, max: 15, default: 6, step: 0.5 },
  // Stock over 10 mm makes the hinge band (7 thicknesses at most) taller than any die.
  ...base.filter((d) => !(d.key in DEFAULTS)).map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

/** Closed CCW regular hexagon of apothem a about (cx, cy), flats facing +-x, corners rounded by cr. */
function hexagon(cx: number, cy: number, a: number, cr: number): Path {
  const s = (2 * a) / Math.sqrt(3); // side length (= circumradius)
  const e = cr / Math.sqrt(3); // tangent length of a corner arc
  const tt = new Turtle({ x: cx + a, y: cy }, 90);
  for (let k = 0; k < 6; k++) {
    tt.forward(s / 2 - e);
    if (cr > 1e-9) tt.arc(cr, 60);
    else tt.turn(60);
    tt.forward(s / 2 - e);
  }
  return tt.toPath(true);
}

/**
 * Dice and magnet holes of a plate (inner rectangle x * y), boxes.py diceCB; `front` is the local
 * y of the box front (0 or y), where the magnets go. `dice` false: magnet holes only.
 */
export function diceHoles(p: Params, x: number, y: number, t: number, front = 0, dice = true): { holes: Path[]; centres: [number, number][]; apothem: number } {
  const a = (Math.min(x, y) - 4 * t) / 6;
  if (!(a >= 2)) {
    const key = x <= y ? 'x' : 'y';
    throw new ParamError(`${key} too small for the dice holes: their apothem would be ${a.toFixed(2)} mm (needs 2 mm)`, key);
  }
  const cr = Math.min(num(p, 'hex_hole_corner_radius'), 0.9 * a);
  const centres: [number, number][] = [[x / 2, y / 2]];
  for (let k = 0; k < 6; k++) {
    const th = (k * Math.PI) / 3;
    centres.push([x / 2 + (2 * a + t) * Math.cos(th), y / 2 + (2 * a + t) * Math.sin(th)]);
  }
  const holes = dice ? centres.map(([cx, cy]) => hexagon(cx, cy, a, cr)) : [];
  const d = num(p, 'magnet_diameter');
  if (d > 0) {
    const mo = t + d / 2;
    const r = (2 * a) / Math.sqrt(3);
    const my = front === 0 ? mo : y - mo;
    const mags: [number, number][] = [[mo, my], [x - mo, my]];
    for (const [mx, my] of mags)
      if (centres.some(([cx, cy]) => Math.hypot(cx - mx, cy - my) < r + d / 2 + 0.5))
        throw new ParamError(`magnet_diameter too large: a ${d} mm magnet hole at the corner meets a dice hole`, 'magnet_diameter');
    if (!(x - 2 * mo >= d + 1)) throw new ParamError('magnet_diameter too large: the two magnet holes meet', 'magnet_diameter');
    holes.push(...mags.map(([mx, my]) => circle(mx, my, d / 2)));
  }
  return { holes, centres, apothem: a };
}

/** Inner size (mm): x, y and lid height from the params, the box height from the dice. */
export function diceInner(p: Params): { x: number; y: number; h: number; hl: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  const c = num(p, 'dice_clearance') * t;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'dice_height') + c, hl: num(p, 'lidheight') - (o ? t : 0) };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const inner = diceInner(p);
  const R = hingeDims(p).R;
  if (inner.h - R < 3 * t)
    throw new ParamError(`dice_height too small for the hinge: the box height (dice_height + dice_clearance * thickness = ${inner.h.toFixed(2)} mm) `
      + `minus pin and strength (${R.toFixed(2)} mm) must be at least 3 * thickness = ${(3 * t).toFixed(2)} mm`, 'dice_height');
  const { panels, dims } = chestHingePanels(p, ctx, inner, true);
  const { x, y, h } = dims;
  const z1 = t + h; // hinge axis plane: top of the box plate, bottom of the lid plate
  const f = 'finger';
  const e = 'flat';
  // Box plate: u = +x, v = -y, normal -z (into the box), its z = 0 face on top; local y = 0 at the back.
  const bw = rectangularWall(x, y, [f, e, f, e], ctx);
  bw.holes.push(...diceHoles(p, x, y, t, y).holes);
  bw.lines.push({ side: 4, type: 'flat', from: { x: 0, y: 0 }, to: { x: 0, y } });
  const boxPlate = panel('boxplate', 'Dice plate (box)', bw, at([t, t + y, z1], [1, 0, 0], [0, -1, 0]), []);
  // Lid plate: u = +x, v = +y, normal +z (into the lid), its z = 0 face below; local y = 0 at the front.
  const lw = rectangularWall(x, y, [f, e, f, e], ctx);
  lw.holes.push(...diceHoles(p, x, y, t, 0, false).holes);
  lw.lines.push({ side: 4, type: 'flat', from: { x: 0, y }, to: { x: 0, y: 0 } });
  const lidPlate = panel('lidplate', 'Lid plate', lw, at([t, t, z1], [1, 0, 0], [0, 1, 0]), []);
  // Explicit mates: the box and lid plates' front (and back) joint lines are the same world segment.
  const byId = (id: string): PanelSpec => panels.find((s) => s.id === id)!;
  const mate = (a: PanelSpec, as: number, b: PanelSpec, bs: number): void => {
    a.mates[as] = [b.id, bs];
    b.mates[bs] = [a.id, as];
  };
  mate(boxPlate, 4, lidPlate, 4);
  mate(byId('front'), 2, boxPlate, 2);
  mate(byId('back'), 2, boxPlate, 0);
  mate(byId('lidfront'), 0, lidPlate, 0);
  mate(byId('lidback'), 0, lidPlate, 2);
  const specs = [...panels, boxPlate, lidPlate];
  return finishPanels(specs, t, effectiveKerf(p));
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = diceInner(p);
  return { x: i.x + 2 * t, y: i.y + 2 * t + hingeDims(p).R, z: i.h + i.hl + 2 * t };
}

export const diceBox: Generator = {
  id: 'dicebox',
  name: 'Dice box',
  category: TRAY_CATEGORY,
  description: 'Hinged box holding seven dice in hexagonal holes of a plate at the top of the box, capped by a plate in the lid that the magnets hold shut.',
  schema,
  presets: {
    'Dice box': { x: 100, y: 100, dice_height: 22, lidheight: 25, inside: false },
    'Large dice box': { x: 140, y: 140, dice_height: 30, dice_clearance: 0.3, lidheight: 30, inside: false, hex_hole_corner_radius: 6, magnet_diameter: 8 },
    'Small, thin stock': { x: 80, y: 80, dice_height: 18, lidheight: 16, inside: false, thickness: 2, magnet_diameter: 5, hex_hole_corner_radius: 3 },
  },
  build,
  expectedSize,
};
