/**
 * PenHolder: an open box with two plates of pen holes across it, one near the top and one lower
 * down, so pens stand upright; ported from boxes.py (florianfesti/boxes,
 * boxes/generators/penholderbox.py).
 *
 * Panels (edges bottom, right, top, left; b = 'F' notched with a floor, else plain):
 *    front, back  x * h   'b F e F'   own the corner columns; two slot rows for the plates
 *    left, right  y * h   'b f e f'   two slot rows for the plates
 *    floor        x * y   'f f f f'   optional
 *    plates (2)   x * y   'f f f f'   fingers into the slot rows of all four walls (interior joints);
 *                                     a grid of nx * ny pen holes on a pitch of cap diameter
 *                                     (pen_diam + cap_margin), each with the cap's circle engraved
 * Plate 1's top face is `plate1_offset` thicknesses below the top of the walls. Plate 2's top face
 * is `plate_gap` (a fraction of the room below plate 1, keeping a thickness of wall below plate 2)
 * further down.
 *
 * World frame: x across, y from the front (y = 0) to the back, z up (floor underside at z = 0).
 * Outer size x + 2t, y + 2t, h (+ t with a floor).
 *
 * Deliberate differences from boxes.py (docs/differences.md): `plate1_offset` is in thicknesses and
 * `plate_gap` a fraction (boxes.py: millimetres); the cap diameter is given as a margin over
 * the pen hole (`cap_margin`), so the holes can never merge; the grid must fit (boxes.py only checks it and
 * draws regardless); `bottom` is a switch instead of a choice of bottom edge.
 */
import type { Path } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { autoMate, slotInto, TRAY_CATEGORY } from './trays';
import { at, circle, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec, type WallEdge, type WallEdges } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 400, default: 80, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y (inner or outer)', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 400, default: 80, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the walls (inner: above the floor; outer: including it)', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 400, default: 100, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'bottom', label: 'Floor', help: 'Finger-jointed floor; off for a bottomless holder', group: 'Size', kind: 'bool', default: true },
  { key: 'plate1_offset', label: 'Top plate depth', help: 'Distance from the top of the walls down to the top plate, in multiples of thickness',
    unit: '', group: 'Plates', kind: 'number', min: 0.5, max: 5, default: 1, step: 0.5 },
  { key: 'plate_gap', label: 'Plate spacing', help: 'Distance between the two plates as a fraction of the room below the top plate (1: the lower plate one thickness above the floor)',
    unit: '', group: 'Plates', kind: 'number', min: 0.2, max: 1, default: 0.8, step: 0.05 },
  { key: 'nx', label: 'Holes across', help: 'Number of pen holes along x', unit: '', group: 'Holes', kind: 'int', min: 1, max: 6, default: 4 },
  { key: 'ny', label: 'Holes deep', help: 'Number of pen holes along y', unit: '', group: 'Holes', kind: 'int', min: 1, max: 6, default: 4 },
  { key: 'pen_diam', label: 'Pen hole diameter', help: 'Diameter of each pen hole', unit: 'mm',
    group: 'Holes', kind: 'number', min: 3, max: 20, default: 12, step: 0.5 },
  { key: 'cap_margin', label: 'Cap margin', help: 'Room for a pen cap around each hole: the cap diameter (engraved, and the hole pitch) is the hole diameter plus this', unit: 'mm',
    group: 'Holes', kind: 'number', min: 1, max: 12, default: 4, step: 0.5 },
  ...commonParams,
];

function innerSize(p: Params): { x: number; y: number; h: number; floor: boolean } {
  const t = num(p, 'thickness');
  const floor = p.bottom !== false;
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o && floor ? t : 0), floor };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 2 * t, y: i.y + 2 * t, z: i.h + (i.floor ? t : 0) };
}

/** World z of the two plates' top faces (above the floor's underside). */
export function plateTops(p: Params): [number, number] {
  const t = num(p, 'thickness');
  const { h, floor } = innerSize(p);
  const z0 = floor ? t : 0;
  const d1 = num(p, 'plate1_offset') * t;
  const room = h - d1 - 2 * t; // plate 1's top face down to one thickness above the floor, less plate 2
  if (!(room >= 2 * t))
    throw new ParamError(`plate1_offset too large: the top plate leaves ${room.toFixed(1)} mm below it, two plates need ${(2 * t).toFixed(1)} mm`, 'plate1_offset');
  const g = num(p, 'plate_gap') * room;
  if (!(g >= 2 * t))
    throw new ParamError(`plate_gap too small: the plates would be ${g.toFixed(1)} mm apart, at least ${(2 * t).toFixed(1)} mm (two thicknesses)`, 'plate_gap');
  return [z0 + h - d1, z0 + h - d1 - g];
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h, floor } = innerSize(p);
  requireJointLength('x', x, t);
  requireJointLength('y', y, t);
  requireJointLength('h', h, t, 'wall height');
  const tops = plateTops(p);
  const nx = num(p, 'nx');
  const ny = num(p, 'ny');
  const pd = num(p, 'pen_diam');
  const cd = pd + num(p, 'cap_margin');
  if (!(nx * cd <= x)) throw new ParamError(`nx too large: ${nx} caps of ${cd.toFixed(1)} mm need ${(nx * cd).toFixed(1)} mm, the plate is ${x.toFixed(1)} mm wide inside`, 'nx');
  if (!(ny * cd <= y)) throw new ParamError(`ny too large: ${ny} caps of ${cd.toFixed(1)} mm need ${(ny * cd).toFixed(1)} mm, the plate is ${y.toFixed(1)} mm deep inside`, 'ny');

  const X = x + 2 * t;
  const Y = y + 2 * t;
  const z0 = floor ? t : 0;
  const b: WallEdge = floor ? 'fingerHole' : 'flat';
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const wall = (w: number, hh: number, types: WallEdges) => rectangularWall(w, hh, types, ctx);
  const front = panel('front', 'Front', wall(x, h, [b, F, e, F]), at([t + x, 0, z0], [-1, 0, 0], [0, 0, 1]), []);
  const right = panel('right', 'Right side', wall(y, h, [b, f, e, f]), at([X, t + y, z0], [0, -1, 0], [0, 0, 1]), []);
  const back = panel('back', 'Back', wall(x, h, [b, F, e, F]), at([t, Y, z0], [1, 0, 0], [0, 0, 1]), []);
  const left = panel('left', 'Left side', wall(y, h, [b, f, e, f]), at([0, t, z0], [0, 1, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [front, right, back, left];
  if (floor) specs.push(panel('floor', 'Floor', wall(x, y, [f, f, f, f]), at([t, t, 0], [1, 0, 0], [0, 1, 0]), []));

  // Pen holes centred on the plate, pitch cd; the caps' circles engraved around them.
  const holes: Path[] = [];
  const caps: Path[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const cx = x / 2 + (i - (nx - 1) / 2) * cd;
    const cy = y / 2 + (j - (ny - 1) / 2) * cd;
    holes.push(circle(cx, cy, pd / 2));
    caps.push(circle(cx, cy, cd / 2));
  }
  const plates = tops.map((zt, k) => {
    const w = wall(x, y, [f, f, f, f]);
    w.holes.push(...holes);
    return panel(`plate${k + 1}`, k === 0 ? 'Top plate' : 'Lower plate', w, at([t, t, zt - t], [1, 0, 0], [0, 1, 0]), []);
  });
  for (const pl of plates) {
    slotInto(front, pl, [0], ctx);
    slotInto(right, pl, [1], ctx);
    slotInto(back, pl, [2], ctx);
    slotInto(left, pl, [3], ctx);
  }
  specs.push(...plates);
  autoMate(specs);
  const parts = finishPanels(specs, t, effectiveKerf(p));
  for (const part of parts) if (part.id.startsWith('plate')) part.engrave = caps;
  return parts;
}

export const penHolder: Generator = {
  id: 'penholder',
  name: 'Pen holder',
  category: TRAY_CATEGORY,
  description: 'Open box with two plates of pen holes that hold pens upright in a grid.',
  schema,
  presets: {
    'Desk pen holder': { x: 80, y: 80, h: 100, nx: 4, ny: 4, pen_diam: 12, cap_margin: 4, inside: true },
    'Marker rack': { x: 130, y: 45, h: 90, nx: 6, ny: 2, pen_diam: 16, cap_margin: 4, plate_gap: 0.7, inside: true },
    'Brush stand, no floor': { x: 120, y: 120, h: 150, nx: 5, ny: 5, pen_diam: 10, cap_margin: 10, bottom: false, plate1_offset: 2, inside: false },
  },
  build,
  expectedSize,
};
