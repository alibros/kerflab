/**
 * Chest: a box with a barrel (polygon) lid on chest hinges, after boxes.py PirateChest
 * (florianfesti/boxes, boxes/generators/piratechest.py). The box and the hinge are the
 * integrated-hinge box's (integratedhinge.ts, `chestHingePanels`): rings at the back of the side
 * walls, loose discs, and pins on the lid back. The flat lid top is replaced by an arch of `staves`
 * equal staves joined to each other and to the lid's straight front and back walls by angled finger
 * joints, between two lid end plates.
 *
 * Lid cross-section (world y-z plane): the inner faces of the lid front (y = t) and lid back
 * (y = t + y) rise to A = (t, zA) and B = (t + y, zA), zA = t + h + lidheight. The staves' inner
 * faces are the chords Q0 = A, Q1, ..., Qn = B of a circular arc whose tangent turns by `arch`
 * degrees from A to B (180: a half barrel whose tangents at A and B are vertical; less: a flatter
 * arch). Corner turns: arch / staves between staves, 90 - arch / 2 + arch / (2 staves) at A and B.
 *
 * Parts (bottom, right, top, left of each panel):
 *    box (front, sides, back, bottom, discs)  as integratedhinge
 *    lid front   x * lidheight   [rest, e|f, g, f|e]   plain over the hinge band, fingers above
 *    lid back    x * (lidheight - Rl)  [pins, f, G, f]
 *    staves      x * s            [G, f, g, f]          s = chord length
 *    lid ends    hand-drawn: arc around the hinge ring at the back, notched ('F') along the lid
 *                front, the staves and the lid back, reaching their outer faces (the end plates
 *                own the lid's corners, as polygonPlate in a prism box)
 * (g / G: protruding / notched side of an angled finger joint.)
 *
 * World frame: as integratedhinge: the box is [0, X] x [0, Y] x [0, Z] plus the hinge rings behind
 * (y up to Y + R); the arch rises above zA.
 *
 * Deliberate differences from boxes.py: the lid's straight walls sit on the integrated chest hinge
 * of integratedhinge (boxes.py PirateChest uses the same ChestHinge edges, with the lid ends cut
 * as half polygons directly on the hinge); `arch` makes the barrel flatter than a half polygon.
 */
import { angledFingerWidths, edgeFor } from '../core/edges';
import { mat3Translate, transform, type Mat3, type Path, type Vec2 } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { chestHingePanels, hingeDims } from './integratedhinge';
import { autoMate } from './trays';
import {
  at, finishPanels, num, panel, pieceSide, polyline, rectangularWall, requireJointLength,
  type CustomSide, type PanelSpec, type PolyItem, type WallLine,
} from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x, along the hinge (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 1000, default: 200, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y, front to hinge (inner or outer; the hinge rings stand out behind)', unit: 'mm',
    group: 'Size', kind: 'number', min: 40, max: 600, default: 120, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the box without the lid (inner: above the bottom; outer: including it)', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 600, default: 100, step: 1 },
  { key: 'lidheight', label: 'Lid wall height', help: 'Height of the lid\'s straight front and back walls above the hinge plane, below the arch (inside)',
    unit: 'mm', group: 'Size', kind: 'number', min: 15, max: 300, default: 30, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: width, depth and height are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'staves', label: 'Lid staves', help: 'Number of flat staves forming the arched lid (1 = a flat lid)', group: 'Lid',
    kind: 'int', min: 1, max: 12, default: 5 },
  { key: 'arch', label: 'Arch', help: 'Total turn of the lid from front to back: 180 is a half barrel, less is flatter', unit: 'deg',
    group: 'Lid', kind: 'number', min: 60, max: 180, default: 180, step: 1 },
  { key: 'pin', label: 'Pin radius', help: 'Radius of the disc turning in the hinge ring, in multiples of thickness',
    unit: '', group: 'Hinge', kind: 'number', min: 1.2, max: 4, default: 2, step: 0.1 },
  { key: 'strength', label: 'Hinge strength', help: 'Width of the ring holding the disc, in multiples of thickness',
    unit: '', group: 'Hinge', kind: 'number', min: 0.5, max: 3, default: 1, step: 0.1 },
  { key: 'hingeplay', label: 'Hinge play', help: 'Clearance between the lid and the hinge ring, and around the disc, in multiples of thickness',
    unit: '', group: 'Hinge', kind: 'number', min: 0.01, max: 0.2, default: 0.1, step: 0.01 },
  ...commonParams,
];

function innerSize(p: Params): { x: number; y: number; h: number; hl: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o ? t : 0), hl: num(p, 'lidheight') };
}

type Line2 = { p: Vec2; d: Vec2 };
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
function intersect(a: Line2, b: Line2): Vec2 {
  const den = cross(a.d, b.d);
  const s = cross({ x: b.p.x - a.p.x, y: b.p.y - a.p.y }, b.d) / den;
  return { x: a.p.x + s * a.d.x, y: a.p.y + s * a.d.y };
}

/**
 * Lid arch in world (y, z): chord vertices Q (Q0 = A .. Qn = B), chord length s, unit chord
 * directions d, corner turns (degrees) at Q0..Qn, and the outer corners C0..Cn of the outer
 * polygon (front outer face y = 0, staves' outer faces, back outer face y = Y).
 */
export function archGeometry(p: Params): { Q: Vec2[]; s: number; d: Vec2[]; turns: number[]; C: Vec2[]; zA: number } {
  const t = num(p, 'thickness');
  const { y, h, hl } = innerSize(p);
  const n = num(p, 'staves');
  const th = num(p, 'arch');
  const zA = t + h + hl;
  const heads = Array.from({ length: n }, (_, k) => ((th / 2 - th / (2 * n) - (k * th) / n) * Math.PI) / 180);
  const s = y / heads.reduce((a, b) => a + Math.cos(b), 0);
  const d = heads.map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));
  const Q: Vec2[] = [{ x: t, y: zA }];
  d.forEach((dk, k) => Q.push({ x: Q[k]!.x + s * dk.x, y: Q[k]!.y + s * dk.y }));
  Q[n] = { x: t + y, y: zA }; // exact by symmetry
  const a0 = 90 - th / 2 + th / (2 * n);
  const turns = Q.map((_, k) => (k === 0 || k === n ? a0 : th / n));
  // Outer lines: front y = 0 (up), each chord pushed out (left of travel) by t, back y = Y (down).
  const lines: Line2[] = [{ p: { x: 0, y: 0 }, d: { x: 0, y: 1 } }];
  d.forEach((dk, k) => lines.push({ p: { x: Q[k]!.x - t * dk.y, y: Q[k]!.y + t * dk.x }, d: dk }));
  lines.push({ p: { x: y + 2 * t, y: 0 }, d: { x: 0, y: -1 } });
  const C = Q.map((_, k) => intersect(lines[k]!, lines[k + 1]!));
  return { Q, s, d, turns, C, zA };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  const { C } = archGeometry(p);
  return { x: i.x + 2 * t, y: i.y + 2 * t + hingeDims(p).R, z: Math.max(...C.map((c) => c.y)) };
}

const turnTo = (tu: Turtle, deg: number): void => {
  let a = deg - tu.heading;
  a = ((((a + 180) % 360) + 360) % 360) - 180;
  tu.turn(a);
};

/** Reverses a closed path's direction (arcs keep their centres and swap their sense). */
function reversed(p: Path): Path {
  const pts = [p.start, ...p.segs.map((s) => s.to)];
  const segs = p.segs.map((s, i) => {
    const to = pts[i]!;
    return s.t === 'L' ? { t: 'L' as const, to: { ...to } } : { t: 'A' as const, to: { ...to }, c: { ...s.c }, ccw: !s.ccw };
  }).reverse();
  return { start: { ...pts[pts.length - 1]! }, closed: p.closed, segs };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const inner = innerSize(p);
  const { x, y, h, hl } = inner;
  const { panels: all, dims } = chestHingePanels(p, ctx, inner);
  const { Rl, H2 } = dims;
  const { pinh } = hingeDims(p);
  const n = num(p, 'staves');
  const { Q, s, d, turns, C, zA } = archGeometry(p);
  requireJointLength('staves', s, t, `stave width (${n} staves over the ${y.toFixed(0)} mm depth)`);
  const X = x + 2 * t;
  const Y = y + 2 * t;
  const z1 = t + h;
  const f = 'finger' as const;
  const e = 'flat' as const;
  const g = 'angledFinger' as const;
  const G = 'angledFingerHole' as const;

  const panels: PanelSpec[] = all.filter((q) => !q.id.startsWith('lid'));

  // Lid front: rests on the box front, plain over the hinge band (the end plates cover its ends there).
  const lidFront = rectangularWall(x, hl, [e, { pieces: [[e, Rl], [f, H2]] }, g, { pieces: [[f, H2], [e, Rl]] }], ctx,
    { angles: [undefined, undefined, turns[0]!] });
  // The top is cut back by -base at the 'g' corner: stop the finger pieces' joint lines there too.
  const b0 = angledFingerWidths(turns[0]!, t).base;
  lidFront.lines = lidFront.lines.map((l) => (l.side === pieceSide(1, 1) ? { ...l, to: { ...l.to, y: hl + b0 } }
    : l.side === pieceSide(3, 0) ? { ...l, from: { ...l.from, y: hl + b0 } } : l));
  const front = panel('lidfront', 'Lid front', lidFront, at([t + x, 0, z1], [-1, 0, 0], [0, 0, 1]), []);
  front.mates[0] = ['front', 2];

  // Lid back with the hinge pins at its bottom corners (integratedhinge ChestHingePin).
  const pinPoly: PolyItem[] = [0, -90, Rl - pinh, -90, t, 90, pinh, 90];
  const pins: CustomSide = {
    start: 0, end: 0,
    draw: (tt, len) => {
      polyline(tt, pinPoly);
      tt.forward(len + 2 * t);
      polyline(tt, [0, ...[...pinPoly].reverse()]);
    },
  };
  const lidBack = rectangularWall(x, H2, [pins, f, G, f], ctx, { angles: [undefined, undefined, turns[n]!] });
  lidBack.lines.push(
    { side: 4, type: 'hinge', from: { x: -t, y: -(Rl - pinh) }, to: { x: -t, y: -Rl } },
    { side: 5, type: 'hinge', from: { x: x + t, y: -Rl }, to: { x: x + t, y: -(Rl - pinh) } },
  );
  const back = panel('lidback', 'Lid back', lidBack, at([t, Y, z1 + Rl], [1, 0, 0], [0, 0, 1]), []);
  back.mates[4] = ['discleft', 0];
  back.mates[5] = ['discright', 0];
  panels.push(front, back);

  // Staves: local x along -x (from x = t + x), local y along the chord, normal into the lid.
  for (let k = 0; k < n; k++) {
    const q = Q[k]!;
    const dk = d[k]!;
    const w = rectangularWall(x, s, [G, f, g, f], ctx, { angles: [turns[k]!, undefined, turns[k + 1]!] });
    panels.push(panel(`stave${k + 1}`, `Lid stave ${k + 1}`, w,
      at([t + x, q.x - t * dk.y, q.y + t * dk.x], [-1, 0, 0], [0, dk.x, dk.y]), []));
  }

  // End plates, drawn in world (y, z), CCW: along the bottom at z1, round the hinge ring at the
  // back, up the lid back's outer face, back over the staves' outer faces and down the front.
  const tu = new Turtle({ x: 0, y: z1 }, 0);
  const notch = (l: number): void => edgeFor('fingerHole')(tu, l, ctx);
  tu.forward(Y - Rl);
  turnTo(tu, 90);
  const beta = (Math.atan2(Math.sqrt(Rl * Rl - t * t), -t) * 180) / Math.PI;
  tu.arc(Rl, -(180 - beta));
  turnTo(tu, 90);
  tu.forward(z1 + Rl - tu.pos.y);
  turnTo(tu, 0);
  tu.forward(t);
  turnTo(tu, 90);
  notch(H2);
  tu.forward(C[n]!.y - zA);
  const lines: { from: Vec2; to: Vec2 }[] = [
    { from: { x: Y, y: z1 + Rl }, to: { x: Y, y: zA } },
    { from: { x: 0, y: zA + b0 }, to: { x: 0, y: z1 + Rl } },
  ];
  for (let k = n - 1; k >= 0; k--) {
    const dk = d[k]!;
    const P = { x: Q[k]!.x - t * dk.y, y: Q[k]!.y + t * dk.x }; // chord start pushed out
    const Pe = { x: P.x + s * dk.x, y: P.y + s * dk.y };
    turnTo(tu, (Math.atan2(-dk.y, -dk.x) * 180) / Math.PI);
    tu.forward(dot({ x: C[k + 1]!.x - Pe.x, y: C[k + 1]!.y - Pe.y }, dk));
    notch(s);
    tu.forward(dot({ x: P.x - C[k]!.x, y: P.y - C[k]!.y }, dk));
    // Joint line: the stave's finger side is cut back by -base at its 'g' end (Q[k + 1]).
    const trim = -angledFingerWidths(turns[k + 1]!, t).base;
    lines.push({ from: P, to: { x: P.x + (s - trim) * dk.x, y: P.y + (s - trim) * dk.y } });
  }
  turnTo(tu, -90);
  tu.forward(C[0]!.y - zA);
  notch(H2);
  tu.forward(Rl);
  const profile = tu.toPath(true);

  // Right plate: local x = t + y - world y (mirror), left plate: local x = world y - t; local y = z - (z1 + Rl).
  const plate = (right: boolean): { outline: Path; lines: WallLine[] } => {
    const m: Mat3 = right ? [-1, 0, t + y, 0, 1, -(z1 + Rl), 0, 0, 1] : mat3Translate(-t, -(z1 + Rl));
    const map = (v: Vec2): Vec2 => ({ x: m[0] * v.x + m[2], y: v.y + m[5] });
    const o = transform(profile, m);
    return {
      outline: right ? reversed(o) : o,
      lines: lines.map((l, i) => ({ side: i, type: 'fingerHole' as const, from: map(l.from), to: map(l.to) })),
    };
  };
  const pr = plate(true);
  const pl = plate(false);
  panels.push(
    { id: 'lidright', name: 'Lid end right', outline: pr.outline, holes: [], lines: pr.lines,
      placement: at([X, t + y, z1 + Rl], [0, -1, 0], [0, 0, 1]), mates: [] },
    { id: 'lidleft', name: 'Lid end left', outline: pl.outline, holes: [], lines: pl.lines,
      placement: at([0, t, z1 + Rl], [0, 1, 0], [0, 0, 1]), mates: [] },
  );
  autoMate(panels);
  return finishPanels(panels, t, effectiveKerf(p));
}

export const chest: Generator = {
  id: 'chest',
  name: 'Chest',
  category: 'Lids & hinges',
  description: 'Chest with an arched (barrel / polygon) lid of staves on integrated chest hinges, no hardware (PirateChest, treasure chest).',
  schema,
  presets: {
    'PirateChest (5 staves)': { x: 200, y: 120, h: 100, lidheight: 30, staves: 5, arch: 180 },
    'Treasure chest (flat arch)': { x: 260, y: 160, h: 120, lidheight: 40, staves: 4, arch: 100, inside: false, thickness: 4 },
    'Keepsake chest (small)': { x: 120, y: 80, h: 60, lidheight: 20, staves: 3, arch: 150 },
  },
  build,
  expectedSize,
};
