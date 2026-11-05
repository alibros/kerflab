/**
 * DividerTray: a tray of columns separated by side walls whose top edges carry slots; loose
 * dividers drop into the slots to split each column into rows. Ported from boxes.py
 * (florianfesti/boxes, boxes/generators/dividertray.py), with the "one divider spanning all
 * columns" divider style.
 *
 * Panels (edges bottom, right, top, left; b = 'F' notched with a bottom, else flat):
 *    front, back   X * h   'b F N F'   N: a finger notch per column (notches_in_wall); slot rows
 *                                     for the inner side walls
 *    side walls    Y * h   bottom: 'b' (outer) / 'f' into the bottom (inner), 'f' into front and
 *                          back, top: a slot (t + play wide, slot_depth deep) per divider row
 *    bottom        X * Y   'f f f f' (optional), slot rows for the inner side walls
 *    dividers      (X + 2t) * h, one per slot row, spanning all columns: tabs slot_depth high
 *                          rest in the side walls' slots (flush with the outer faces); below them
 *                          the divider clears every wall by play / 2 (slots cut up from its
 *                          bottom edge at the inner walls); a finger notch per column on top
 * X = cols * x + (cols - 1) t, Y = rows * y + (rows - 1) t. Dividers and side walls cross in their
 * slots (crossSlot mates).
 *
 * World frame: x across (columns), y from the front (y = 0) to the back, z up (z = 0 at the
 * underside). Outer size X + 2t, Y + 2t, h (+ t with a bottom).
 *
 * Deliberate differences from boxes.py (docs/differences.md): equal columns and rows instead of
 * sx/sy lists; slot and notch depths are fractions of the height (boxes.py: 20 and 15 mm); vertical
 * slots only (no slot angle), no rounded slot entrance; slot slack is the
 * common `play` (default 0.05 here) instead of extra_slack; both outer side walls always present;
 * only the spanning divider style is modelled (boxes.py also draws per-column dividers with full,
 * half or asymmetric tabs for you to choose from); no handle, no lid.
 */
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { autoMate, crossing, equal, notchEdge, requireMaxSize, runsFor, slotInto, slotRanges, slottedSide, span, TRAY_CATEGORY, wallOffsets } from './trays';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type PanelSpec, type WallSide } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Column width', help: 'Width of each column (inner), or the overall outer width when "Inner dimensions" is off', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 400, default: 60, step: 1 },
  { key: 'y', label: 'Row depth', help: 'Depth of each row between dividers (inner), or the overall outer depth', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 400, default: 40, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the walls (inner, above the bottom; or the overall height)', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 300, default: 60, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: x, y are one column / row and h the inner height. Off: they are the overall outer size',
    group: 'Size', kind: 'bool', default: true },
  { key: 'cols', label: 'Columns', help: 'Number of columns (side walls between them)', unit: '', group: 'Compartments', kind: 'int', min: 1, max: 8, default: 2 },
  { key: 'rows', label: 'Rows', help: 'Number of rows per column; a divider sits in the slots between rows', unit: '',
    group: 'Compartments', kind: 'int', min: 1, max: 12, default: 4 },
  { key: 'bottom', label: 'Bottom', help: 'Finger-jointed bottom panel', group: 'Compartments', kind: 'bool', default: false },
  { key: 'slot_depth', label: 'Slot depth', help: 'Depth of the divider slots in the side walls (and height of the divider tabs), as a fraction of the height', unit: '',
    group: 'Compartments', kind: 'number', min: 0.1, max: 0.5, default: 0.33, step: 0.01 },
  { key: 'notch_depth', label: 'Notch depth', help: 'Depth of the finger notch in each divider column, as a fraction of the height; 0 for none', unit: '',
    group: 'Compartments', kind: 'number', min: 0, max: 0.4, default: 0.25, step: 0.01 },
  { key: 'notches_in_wall', label: 'Notches in walls', help: 'Cut the same finger notches into the front and back walls',
    group: 'Compartments', kind: 'bool', default: true },
  // The divider slots use the common play as their slack, so default to a little.
  ...commonParams.map((d) => (d.key === 'play' && d.kind === 'number' ? { ...d, default: 0.05 } : d)),
];

function sizes(p: Params): { sx: number[]; sy: number[]; h: number; floor: boolean } {
  const t = num(p, 'thickness');
  const nx = num(p, 'cols');
  const ny = num(p, 'rows');
  const floor = p.bottom === true;
  if (p.inside !== false) return { sx: equal(nx * num(p, 'x'), nx), sy: equal(ny * num(p, 'y'), ny), h: num(p, 'h'), floor };
  return { sx: equal(num(p, 'x') - (nx + 1) * t, nx), sy: equal(num(p, 'y') - (ny + 1) * t, ny), h: num(p, 'h') - (floor ? t : 0), floor };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const s = sizes(p);
  return { x: span(s.sx, t) + 2 * t, y: span(s.sy, t) + 2 * t, z: s.h + (s.floor ? t : 0) };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const play = ctx.play;
  const { sx, sy, h, floor } = sizes(p);
  for (const v of sx) requireJointLength('x', v, t, 'column width');
  for (const v of sy) if (!(v >= 2 * t + play)) throw new ParamError(`y too small: rows are ${v.toFixed(1)} mm deep, need at least 2 * thickness + play`, 'y');
  requireJointLength('y', span(sy, t), t, 'inner depth');
  requireJointLength('h', h, t, 'wall height');
  const X = span(sx, t);
  const Y = span(sy, t);
  requireMaxSize('x', X + 2 * t);
  requireMaxSize('y', Y + 2 * t);
  const D = num(p, 'slot_depth') * h; // <= h / 2, so at least 1.5 t of wall stays below the slots
  if (!(D > 0 && D <= h / 2)) throw new ParamError('slot_depth must be a fraction in (0, 0.5]', 'slot_depth');
  const nd = num(p, 'notch_depth') * h;
  if (nd > 0 && !(nd <= h - D - t))
    throw new ParamError(`notch_depth too large: at most ${(h - D - t).toFixed(1)} mm (the height less the slot depth and one thickness)`, 'notch_depth');
  const zf = floor ? t : 0;
  const xw = wallOffsets(sx, t).map((o) => t + o); // world x of each inner side wall's low face
  const yd = wallOffsets(sy, t).map((o) => t + o); // world y of each divider's low face
  const bot: WallSide = floor ? 'fingerHole' : 'flat';

  // Front / back: top with a notch per column when notches_in_wall.
  const facingTop = (u: (x: number) => number): WallSide => (p.notches_in_wall !== false && nd > 0
    ? slottedSide(runsFor(2, X, h, xw.map((x) => [u(x), u(x + t)])), 'notch', 0, ctx, { depth: nd }) : 'flat');
  const front = panel('front', 'Front', rectangularWall(X, h, [bot, 'fingerHole', facingTop((x) => t + X - x), 'fingerHole'], ctx),
    at([t + X, 0, zf], [-1, 0, 0], [0, 0, 1]), []);
  const back = panel('back', 'Back', rectangularWall(X, h, [bot, 'fingerHole', facingTop((x) => x - t), 'fingerHole'], ctx),
    at([t, Y + 2 * t, zf], [1, 0, 0], [0, 0, 1]), []);

  // Side walls: local u = y - t (left, inner) or t + Y - y (right). Slots t + play wide, centred on the dividers.
  const sideTop = (u: (y: number) => number): WallSide =>
    (yd.length ? slottedSide(runsFor(2, Y, h, slotRanges(yd.map((y) => [u(y), u(y + t)]), play)), 'flat', D, ctx) : 'flat');
  const sides: PanelSpec[] = [
    panel('left', 'Left side', rectangularWall(Y, h, [bot, 'finger', sideTop((y) => y - t), 'finger'], ctx), at([0, t, zf], [0, 1, 0], [0, 0, 1]), []),
    ...xw.map((x0, j) => panel(`wall${j + 1}`, 'Side wall', rectangularWall(Y, h, [floor ? 'finger' : 'flat', 'finger', sideTop((y) => y - t), 'finger'], ctx),
      at([x0, t, zf], [0, 1, 0], [0, 0, 1]), [])),
    panel('right', 'Right side', rectangularWall(Y, h, [bot, 'finger', sideTop((y) => t + Y - y), 'finger'], ctx),
      at([X + 2 * t, t + Y, zf], [0, -1, 0], [0, 0, 1]), []),
  ];
  const inner = sides.slice(1, -1);
  const specs: PanelSpec[] = [front, back, ...sides];
  for (const s of inner) {
    slotInto(back, s, [1], ctx);
    slotInto(front, s, [3], ctx);
  }
  if (floor) {
    const bottom = panel('bottom', 'Bottom', rectangularWall(X, Y, ['finger', 'finger', 'finger', 'finger'], ctx), at([t, t, 0], [1, 0, 0], [0, 1, 0]), []);
    for (const s of inner) slotInto(bottom, s, [0], ctx);
    specs.push(bottom);
  }

  // Dividers: local u = x (0 at the left outer face), v = z - zf; z = 0 face at y = yd + t (normal -y).
  const dc = play / 2; // clearance to each wall below the tabs
  const W = X + 2 * t;
  const outline = (() => {
    const tu = new Turtle({ x: t + dc, y: 0 });
    for (const x0 of xw) {
      tu.forward(x0 - dc - tu.pos.x);
      tu.turn(90); tu.forward(h - D); tu.turn(-90);
      tu.forward(t + 2 * dc);
      tu.turn(-90); tu.forward(h - D); tu.turn(90);
    }
    tu.forward(X + t - dc - tu.pos.x);
    tu.turn(90); tu.forward(h - D);
    tu.turn(-90); tu.forward(t + dc);
    tu.turn(90); tu.forward(D);
    tu.turn(90); // along the top, towards -u
    tu.forward(t);
    for (let j = sx.length - 1; j >= 0; j--) {
      notchEdge(tu, sx[j]!, nd);
      tu.forward(t);
    }
    tu.turn(90); tu.forward(D);
    tu.turn(90); tu.forward(t + dc);
    tu.turn(-90); tu.forward(h - D);
    tu.turn(90);
    return tu.toPath(true);
  })();
  const dividers = yd.map((y0, k) => panel(`divider${k + 1}`, 'Divider', { outline, holes: [], lines: [] },
    at([0, y0 + t, zf], [1, 0, 0], [0, 0, 1]), []));
  const zm = zf + h - D; // where the slots meet
  const c = Math.min(t, D / 2, (h - D) / 2);
  const wallX = [0, ...xw, W];
  dividers.forEach((d, k) => sides.forEach((s, j) => {
    const q = (z: number): Vec3 => [wallX[j]!, yd[k]! + t, z];
    crossing(d, s, q(zm - c), q(zm + c));
  }));
  specs.push(...dividers);
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const dividerTray: Generator = {
  id: 'dividertray',
  name: 'Divider tray',
  category: TRAY_CATEGORY,
  description: 'Columns with slotted side walls and loose dividers that drop into the slots, e.g. for cards or tiles.',
  schema,
  presets: {
    'Card tray': { x: 68, y: 30, h: 60, cols: 2, rows: 4, slot_depth: 0.33, notch_depth: 0.25 },
    'Tile sorter, bottom': { x: 50, y: 25, h: 45, cols: 4, rows: 6, bottom: true, slot_depth: 0.3, notch_depth: 0.25 },
    'Envelope file': { x: 180, y: 40, h: 120, cols: 1, rows: 5, slot_depth: 0.25, notch_depth: 0.2, notches_in_wall: false },
  },
  build,
  expectedSize,
};
