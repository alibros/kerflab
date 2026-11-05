/**
 * FlexBook: a box styled after a book, ported (simplified) from boxes.py (florianfesti/boxes,
 * boxes/generators/flexbook.py, FlexBook). The cover is ONE living-hinge part: front cover, a
 * 180 degree hinge round the spine, back cover. Inside, a book block: two D-shaped side plates
 * (head and tail: a rectangle with a half-round spine end), a fore-edge wall and an inner wall
 * closing the spine.
 *
 * Sizes (boxes.py names): x = width of the compartment (fore edge to inner wall), y = thickness
 * (spine), h = height (head to tail). Side plate (inner): [0, x + t] x [0, y] plus a half circle of
 * radius y / 2 at the spine: fingers along the back face into slots in the back cover, plain front
 * face (the front cover rests on it), notched fore edge for the fore-edge wall's fingers, and a
 * slot row for the inner wall at x. Cover (inner height h between the side plates, brim t beyond
 * them): front panel x + 3t, hinge (inner radius y / 2), back panel x + 3t with slot rows for the
 * side plates and the fore-edge wall.
 *
 * World frame: the book lies on its back cover (Z = 0) with the spine towards +X. Outer size
 * (x + y / 2 + 4t) x (h + 4t) x (y + 2t).
 *
 * Deliberate differences from boxes.py: no latch (brackets, pin, cover holes) and no recess in the
 * inner wall; the cover's corners are square; its hinge is the stretched half circle (boxes.py
 * adds one thickness instead).
 */
import { fingerHolesFor } from '../core/edges/finger';
import { mat3Multiply, mat3Rotate, mat3Translate, transform, type Path } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { livingHinge } from '../core/livinghinge';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { arcFlatLength, flexParams, flexSettings, mirrorWall, requireFlexArc } from './flexwall';
import { at, finishPanels, num, rect, rectangularWall, requireJointLength, type PanelSpec, type Wall } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Inner width of the compartment, fore edge to inner wall', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 500, default: 75, step: 1 },
  { key: 'y', label: 'Thickness', help: 'Inner thickness of the book (the spine)', unit: 'mm',
    group: 'Size', kind: 'number', min: 15, max: 300, default: 35, step: 1 },
  { key: 'h', label: 'Height', help: 'Inner height of the book, head to tail', unit: 'mm',
    group: 'Size', kind: 'number', min: 20, max: 1000, default: 125, step: 1 },
  ...flexParams,
  ...commonParams,
];

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  return { x: num(p, 'x') + num(p, 'y') / 2 + 4 * t, y: num(p, 'h') + 4 * t, z: num(p, 'y') + 2 * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const fs = flexSettings(p);
  const X = num(p, 'x');
  const T = num(p, 'y');
  const Y = num(p, 'h');
  requireJointLength('x', X, t);
  requireJointLength('y', T, t);
  requireJointLength('h', Y, t);
  const r = T / 2;
  requireFlexArc('y', r, 180, fs, t);
  const S = X + t; // straight part of the side plates (compartment + inner wall)

  // Side plate (head; the tail is its mirror image): sides 0 back face, 2 front face, 3 fore edge, 10 inner wall slots.
  const slots = fingerHolesFor(T, ctx).map((s) => transform(s, mat3Multiply(mat3Translate(X + t / 2, 0), mat3Rotate(90))));
  const spine = { draw: (tt: Turtle) => { tt.turn(-90); tt.arc(r, 180); tt.turn(-90); }, start: 0, end: 0 };
  const sw = rectangularWall(S, T, ['finger', spine, 'flat', 'fingerHole'], ctx);
  const side: Wall = { outline: sw.outline, holes: slots,
    lines: [...sw.lines, { side: 10, type: 'fingerHole', from: { x: X + t, y: 0 }, to: { x: X + t, y: T }, holes: slots.map((_, i) => i) }] };

  // Cover: front panel [0, F], hinge [F, F + La], back panel [F + La, total]; inner height [0, Y].
  const F = S + 2 * t;
  const La = arcFlatLength(r, 180, fs);
  const x1 = F + La;
  const total = x1 + F;
  const holes: Path[] = [];
  const row = (paths: Path[]): number[] => { const k = holes.length; holes.push(...paths); return paths.map((_, i) => k + i); };
  // Back panel: local u (side-plate x) = S - (cover x - x1).
  const along = (y0: number): Path[] => fingerHolesFor(S, ctx).map((s) => transform(s, mat3Multiply(mat3Translate(x1 + S, y0), mat3Rotate(180))));
  const head = row(along(-t / 2));
  const tail = row(along(Y + t / 2));
  const fore = row(fingerHolesFor(Y, ctx).map((s) => transform(s, mat3Multiply(mat3Translate(x1 + S + t / 2, 0), mat3Rotate(90)))));
  holes.push(...livingHinge(F, -2 * t, La, Y + 4 * t, fs, t, ctx.kerf).holes);
  const cover: Wall = {
    outline: rect(0, -2 * t, total, Y + 2 * t), holes,
    lines: [
      { side: 1, type: 'fingerHole', from: { x: x1 + S, y: -t }, to: { x: x1, y: -t }, holes: head },
      { side: 2, type: 'fingerHole', from: { x: x1, y: Y + t }, to: { x: x1 + S, y: Y + t }, holes: tail },
      { side: 3, type: 'fingerHole', from: { x: x1 + S + t, y: 0 }, to: { x: x1 + S + t, y: Y }, holes: fore },
    ],
  };
  const foreWall = rectangularWall(Y, T, ['finger', 'finger', 'flat', 'finger'], ctx);
  const innerWall = rectangularWall(Y, T, ['flat', 'finger', 'flat', 'finger'], ctx);

  // World: X = u + 2t (u = side-plate x), Z = w + t, cover y = 0 at Y_world = h + 2t (v = -Y).
  const panels: PanelSpec[] = [
    { id: 'cover', name: 'Cover', ...cover, bend: { arcs: [{ at: F, length: La, angle: 180, radius: r + t }] },
      placement: at([0, Y + 2 * t, T + 2 * t], [1, 0, 0], [0, -1, 0]),
      mates: [undefined, ['head', 0], ['tail', 0], ['fore', 0]] },
    { id: 'head', name: 'Head', ...side, placement: at([2 * t, Y + 3 * t, t], [1, 0, 0], [0, 0, 1]),
      mates: Object.assign([], { 0: ['cover', 1], 3: ['fore', 1], 10: ['inner', 3] }) },
    { id: 'tail', name: 'Tail', ...mirrorWall(side, 0), placement: at([2 * t, t, t], [-1, 0, 0], [0, 0, 1]),
      mates: Object.assign([], { 0: ['cover', 2], 3: ['fore', 3], 10: ['inner', 1] }) },
    { id: 'fore', name: 'Fore-edge wall', ...foreWall, placement: at([t, 2 * t, t], [0, 1, 0], [0, 0, 1]),
      mates: [['cover', 3], ['head', 3], undefined, ['tail', 3]] },
    { id: 'inner', name: 'Inner wall', ...innerWall, placement: at([X + 3 * t, Y + 2 * t, t], [0, -1, 0], [0, 0, 1]),
      mates: [undefined, ['tail', 10], undefined, ['head', 10]] },
  ];
  return finishPanels(panels, t, effectiveKerf(p));
}

export const flexBook: Generator = {
  id: 'flexbook',
  name: 'Flex book',
  category: 'Flex',
  description: 'Box styled after a book: a living-hinge cover wraps the spine of a book-block box.',
  schema,
  presets: {
    Novel: { x: 75, y: 35, h: 125 },
    Paperback: { x: 105, y: 25, h: 175 },
    Tome: { x: 160, y: 60, h: 240 },
  },
  build,
  expectedSize,
};
