/**
 * Drawer: an open-fronted frame with an open-top drawer sliding in it, ported from boxes.py
 * (florianfesti/boxes, boxes/generators/slidingdrawer.py).
 *
 * Frame (edges bottom, right, top, left of each panel; boxes.py SlidingDrawer "out box"):
 *    bottom, top   x * y    'e F F F'   plain front edge, notched elsewhere (own the back corners)
 *    left, right   y * h    'f f f e'   fingers into bottom, top and back; plain front edge
 *    back          x * h    'f F f F'   fingers into bottom and top, notched sides
 * Drawer ("in box"), boxes.py's layout made symmetric like closedbox:
 *    front         dx * dh  [F, F|E, e, E|F]   full height; outset above the lower walls
 *    back          dx * hi  'F F e F'
 *    sides         dy * hi  'F f e f'
 *    bottom        dx * dy  'f f f f'
 * The drawer is `clearance` (c, per side) smaller than the frame opening in width, depth and height:
 * outer W = ix - 2c, D = iy - 2c, H = ih - 2c for the frame's inner width ix, depth iy (front plane to
 * back wall) and height ih. dh = H - t is the drawer front's inner height, hi = `hi` * dh the side
 * and back walls' height.
 *
 * World frame: x across, y from the open front (y = 0) to the back, z up; the frame is
 * [0, ix + 2t] x [0, iy + t] x [0, ih + 2t]. Modelled closed: the drawer rests on the frame bottom
 * (z = t), centred across (c each side), its front face flush with the front plane (2c behind it,
 * 2c above it). It is joined to the frame by two flat (resting) mates where its front corner columns
 * stand on the frame bottom's inner face, at its front edge.
 *
 * Deliberate differences from boxes.py (docs/differences.md): `clearance` is a separate parameter
 * (boxes.py `play`, also 0.15 thicknesses); `inside` means the drawer's inner size (boxes.py
 * adds 4t + 2p to the frame's inner size, so its drawer comes out 2t larger than asked); the drawer
 * corners follow closedbox (front and back own the corner columns, the bottom is fingered on all
 * sides); a grip hole instead of the grooved front top edge ('z'), shrunk to fit a small front;
 * `hi` is a fraction.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { autoMate, rest, TRAY_CATEGORY } from './trays';
import {
  at, finishPanels, num, panel, rectangularWall, requireJointLength, roundedRect,
  type CompoundSide, type PanelSpec, type WallEdge, type WallEdges, type WallSide,
} from './walls';

/** Smallest grip hole worth cutting (width, height), mm: the params' minimums. */
const GRIP_MIN = { w: 10, h: 5 };

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width of the frame (outer), or of the inside of the drawer when "Inner dimensions" is on', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth of the frame from the front to the back (outer), or of the inside of the drawer', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 1000, default: 150, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the frame (outer), or of the inside of the drawer (bottom to the top of its front)', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 500, default: 60, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y, h are the inside of the drawer. Off: they are the outside of the frame',
    group: 'Size', kind: 'bool', default: false },
  { key: 'clearance', label: 'Drawer clearance', help: 'Gap between the drawer and the frame at each side, behind and above it, in multiples of thickness. Zero would bind',
    unit: '', group: 'Drawer', kind: 'number', min: 0.02, max: 0.5, default: 0.15, step: 0.01 },
  { key: 'hi', label: 'Drawer wall height', help: 'Height of the drawer sides and back as a fraction of its front (1: as high)',
    unit: '', group: 'Drawer', kind: 'number', min: 0.3, max: 1, default: 1, step: 0.05 },
  { key: 'grip', label: 'Grip', help: 'Rounded grip hole near the top of the drawer front, or none', group: 'Drawer',
    kind: 'enum', options: ['hole', 'none'], default: 'hole' },
  { key: 'grip_width', label: 'Grip hole width', help: 'Width of the grip hole (at most: narrower on a narrow drawer front, leaving one thickness each side)', unit: 'mm',
    group: 'Drawer', kind: 'number', min: 10, max: 200, default: 40, step: 1 },
  { key: 'grip_height', label: 'Grip hole height', help: 'Height of the grip hole, its ends are half circles (at most: lower on a low drawer front, leaving one thickness above and below)', unit: 'mm',
    group: 'Drawer', kind: 'number', min: 5, max: 60, default: 15, step: 1 },
  ...commonParams,
];

/** Frame inner width ix, depth iy (front plane to the back wall) and height ih; drawer clearance c. */
export function drawerFrame(p: Params): { ix: number; iy: number; ih: number; c: number } {
  const t = num(p, 'thickness');
  const c = num(p, 'clearance') * t;
  if (!(c > 0)) throw new ParamError('clearance must be > 0: a drawer without clearance binds', 'clearance');
  if (p.inside !== false) return { ix: num(p, 'x') + 2 * t + 2 * c, iy: num(p, 'y') + 2 * t + 2 * c, ih: num(p, 'h') + t + 2 * c, c };
  return { ix: num(p, 'x') - 2 * t, iy: num(p, 'y') - t, ih: num(p, 'h') - 2 * t, c };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const f = drawerFrame(p);
  return { x: f.ix + 2 * t, y: f.iy + t, z: f.ih + 2 * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { ix, iy, ih, c } = drawerFrame(p);
  requireJointLength('x', ix, t, 'inner frame width');
  requireJointLength('y', iy, t, 'inner frame depth');
  requireJointLength('h', ih, t, 'inner frame height');
  const W = ix - 2 * c;
  const D = iy - 2 * c;
  const H = ih - 2 * c;
  const dx = W - 2 * t;
  const dy = D - 2 * t;
  const dh = H - t;
  requireJointLength('x', dx, t, 'inner drawer width');
  requireJointLength('y', dy, t, 'inner drawer depth');
  requireJointLength('h', dh, t, 'inner drawer height');
  // Lower walls within half a millimetre of the front are made as high as it (no sliver of outset).
  const hiRaw = num(p, 'hi') * dh;
  const hi = dh - hiRaw < 0.5 ? dh : hiRaw;
  requireJointLength('hi', hi, t, 'drawer wall height');

  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const e: WallEdge = 'flat';
  const wall = (w: number, hh: number, types: WallEdges) => rectangularWall(w, hh, types, ctx);

  // ---- frame: front plane y = 0, back wall [iy, iy + t], bottom [0, t], top [t + ih, 2t + ih].
  const X = ix + 2 * t;
  const Y = iy + t;
  const Z = ih + 2 * t;
  const bottom = panel('bottom', 'Frame bottom', wall(ix, iy, [e, F, F, F]), at([t, 0, 0], [1, 0, 0], [0, 1, 0]), []);
  const top = panel('top', 'Frame top', wall(ix, iy, [F, F, e, F]), at([t, iy, Z], [1, 0, 0], [0, -1, 0]), []);
  const right = panel('right', 'Frame right', wall(iy, ih, [f, e, f, f]), at([X, iy, t], [0, -1, 0], [0, 0, 1]), []);
  const left = panel('left', 'Frame left', wall(iy, ih, [f, f, f, e]), at([0, 0, t], [0, 1, 0], [0, 0, 1]), []);
  const back = panel('back', 'Frame back', wall(ix, ih, [f, F, f, F]), at([t, Y, t], [1, 0, 0], [0, 0, 1]), []);

  // ---- drawer: outer box [ox, ox + W] x [0, D] x [oz, oz + H].
  const ox = t + c;
  const oz = t;
  const full = hi >= dh;
  const side1: WallSide = full ? F : ({ pieces: [[F, hi], ['outset', dh - hi]] } satisfies CompoundSide);
  const side3: WallSide = full ? F : ({ pieces: [['outset', dh - hi], [F, hi]] } satisfies CompoundSide);
  const frontWall = wall(dx, dh, [F, side1, e, side3]);
  if (p.grip === 'hole') {
    // The grip size is a maximum: on a front too low or narrow for it the hole shrinks to leave
    // one thickness all round (so boxes.py's small default drawer, 30 mm high, still gets a grip).
    const gw = Math.min(num(p, 'grip_width'), dx - 2 * t);
    const gh = Math.min(num(p, 'grip_height'), dh - 2 * t);
    if (!(gw >= GRIP_MIN.w && gh >= GRIP_MIN.h))
      throw new ParamError(`grip: the drawer front (${dx.toFixed(1)} x ${dh.toFixed(1)} mm inside) has no room for a grip hole of at least ${GRIP_MIN.w} x ${GRIP_MIN.h} mm; choose no grip`, 'grip');
    frontWall.holes.push(roundedRect(dx / 2, dh - t - gh / 2, gw, gh, Math.min(gw, gh) / 2));
  }
  const front = panel('dfront', 'Drawer front', frontWall, at([ox + t + dx, 0, oz + t], [-1, 0, 0], [0, 0, 1]), []);
  const dback = panel('dback', 'Drawer back', wall(dx, hi, [F, F, e, F]), at([ox + t, D, oz + t], [1, 0, 0], [0, 0, 1]), []);
  const dright = panel('dright', 'Drawer right', wall(dy, hi, [F, f, e, f]), at([ox + W, t + dy, oz + t], [0, -1, 0], [0, 0, 1]), []);
  const dleft = panel('dleft', 'Drawer left', wall(dy, hi, [F, f, e, f]), at([ox, t, oz + t], [0, 1, 0], [0, 0, 1]), []);
  const dbottom = panel('dbottom', 'Drawer bottom', wall(dx, dy, [f, f, f, f]), at([ox + t, t, oz], [1, 0, 0], [0, 1, 0]), []);

  // The drawer rests on the frame bottom: its front corner columns stand on the bottom's inner face.
  // Flat lines along the front edge of that contact (y = 0, z = t), one thickness long under each
  // column: on the drawer front's outer face and the frame bottom's inner face.
  ([[ox, ox + t], [ox + W - t, ox + W]] as const).forEach(([a, b], k) =>
    rest(front, bottom, [b, 0, t], [a, 0, t], 50 + k, t, [false, true]));

  const specs: PanelSpec[] = [bottom, top, right, left, back, front, dback, dright, dleft, dbottom];
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const drawer: Generator = {
  id: 'drawer',
  name: 'Drawer in frame',
  category: TRAY_CATEGORY,
  description: 'Open-fronted frame with a drawer that slides in it, with a set clearance and an optional grip hole.',
  schema,
  presets: {
    'Desk drawer': { x: 160, y: 200, h: 70, inside: false, grip: 'hole', grip_width: 50, grip_height: 18 },
    'Card drawer': { x: 70, y: 95, h: 40, inside: true, clearance: 0.1, grip: 'hole', grip_width: 30, grip_height: 12 },
    'Low parts drawer': { x: 250, y: 180, h: 60, inside: false, hi: 0.6, grip: 'none', thickness: 4 },
  },
  build,
  expectedSize,
};
