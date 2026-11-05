/**
 * HingeBox: a box with a lid on cabinet hinges, ported from boxes.py (florianfesti/boxes,
 * boxes/generators/hingebox.py and CabinetHingeEdge 'u' / 'U' in boxes/edges.py, style "inside").
 *
 * Each hinge is a row of `eyes` small plates ("eyes") with a bore for a metal axle (a piece of
 * nail). Eyes alternate between the box and the lid: the even ones stand in slots cut into the
 * top of the box back wall, the odd ones in slots in the bottom of the lid back wall. Each eye is
 * keyed into its wall: a notch hooks over the bridge under the slot and a tab sits in a square hole
 * below it. The bores line up on the hinge axis, which lies in the back face at the top of the box;
 * the eyes' round ends stand out `eye` behind the box.
 *
 * Parts (bottom, right, top, left of each panel; boxes.py HingeBox):
 *    box front     x * h      'FFeF'        box back   x * h   'FFuF'   eye slots + square holes
 *    box sides     y * h      'Ffef'        bottom     x * y   'ffff'
 *    lid front     x * hl     'eFFF'        lid back   x * hl  'UFFF'
 *    lid sides     y * hl     'efFf'        lid top    x * y   'ffff'
 *    eyes          hinges * eyes plates, 2t + eye wide
 *
 * World frame: the closed box is [0, X] x [0, Y] x [0, Z] with X = x + 2t, Y = y + 2t,
 * Z = 2t + h + hl (inner h, hl), plus the eyes' round ends behind the back (y up to Y + eye).
 * The hinge axis runs along x at y = Y, z = t + h.
 *
 * Joints: the lid front rests on the box front (a flat, resting mate). Each eye is an interior
 * 'hinge' joint against the square hole in its wall ('slot'); the line runs down the slot's side.
 *
 * Deliberate differences from boxes.py: only the "inside" hinge style (no "outside", no angled
 * 'v'/'V'); no split lid (`splitlid`); the eye radius is limited to at most two thicknesses (the
 * first of boxes.py's two eye shapes); eyes per hinge is odd (3, 5 or 7) so box and lid get mirror
 * images of the same layout.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { Turtle } from '../core/turtle';
import {
  at, circle, finishPanels, num, panel, polyline, rect, rectangularWall, requireJointLength,
  type CustomSide, type PanelSpec, type PolyItem, type Wall, type WallEdge, type WallEdges,
} from './walls';

const schema: Schema = [
  { key: 'x', label: 'Width', help: 'Width along x, along the hinges (inner or outer, see "Inner dimensions")', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'y', label: 'Depth', help: 'Depth along y (inner or outer; the hinge eyes stand out behind)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'h', label: 'Height', help: 'Height of the box without the lid (inner: above the bottom; outer: including it)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'lidheight', label: 'Lid height', help: 'Height of the lid (inner: below the lid top; outer: including it)', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 500, default: 30, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: sizes are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'hinges', label: 'Hinges', help: 'Number of hinges along the back (fewer if they do not fit)', group: 'Hinge',
    kind: 'int', min: 1, max: 5, default: 2 },
  { key: 'eyes', label: 'Eyes per hinge', help: 'Plates per hinge, alternating box and lid', group: 'Hinge',
    kind: 'enum', options: ['3', '5', '7'], default: '5' },
  { key: 'eye', label: 'Eye radius', help: 'Radius of the round end of each eye, in multiples of thickness', unit: '',
    group: 'Hinge', kind: 'number', min: 1, max: 2, default: 1.5, step: 0.1 },
  { key: 'bore', label: 'Axle diameter', help: 'Diameter of the hole for the axle (e.g. a nail)', unit: 'mm',
    group: 'Hinge', kind: 'number', min: 1, max: 10, default: 3.2, step: 0.1 },
  { key: 'hingeplay', label: 'Hinge play', help: 'Space between neighbouring eyes, in multiples of thickness', unit: '',
    group: 'Hinge', kind: 'number', min: 0.02, max: 0.2, default: 0.05, step: 0.01 },
  { key: 'spacing', label: 'Hinge margin', help: 'Space at each end of a hinge, in multiples of thickness', unit: '',
    group: 'Hinge', kind: 'number', min: 1, max: 4, default: 2, step: 0.1 },
  ...commonParams,
];

function innerSize(p: Params): { x: number; y: number; h: number; hl: number } {
  const t = num(p, 'thickness');
  const o = p.inside === false;
  return { x: num(p, 'x') - (o ? 2 * t : 0), y: num(p, 'y') - (o ? 2 * t : 0), h: num(p, 'h') - (o ? t : 0), hl: num(p, 'lidheight') - (o ? t : 0) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const i = innerSize(p);
  return { x: i.x + 2 * t, y: i.y + 2 * t + num(p, 'eye') * t, z: i.h + i.hl + 2 * t };
}

/** Hinge layout (mm) along an edge of length l: start of each hinge, eyes per hinge, sizes. */
export function hingeLayout(p: Params, l: number): { starts: number[]; n: number; e: number; q: number; sp: number; width: number } {
  const t = num(p, 'thickness');
  const n = Number(p.eyes);
  const e = num(p, 'eye') * t;
  const q = num(p, 'hingeplay') * t;
  const sp = num(p, 'spacing') * t;
  const width = (t + q) * n + q + 2 * sp;
  const hn = Math.min(num(p, 'hinges'), Math.floor(l / width));
  const starts = hn === 1 ? [(l - width) / 2] : Array.from({ length: hn }, (_, j) => j * (width + (l - hn * width) / (hn - 1)));
  return { starts, n, e, q, sp, width };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const { x, y, h, hl } = innerSize(p);
  requireJointLength('y', y, t);
  const { starts, n, e, q, sp, width } = hingeLayout(p, x);
  if (starts.length === 0)
    throw new ParamError(`x too small: inner width ${x.toFixed(2)} mm, one hinge needs ${width.toFixed(2)} mm`, 'x');
  requireJointLength('h', h - e - t, t, 'the box height below the hinge holes (h minus eye radius and a thickness)');
  requireJointLength('lidheight', hl - e - t, t, 'the lid height above the hinge holes (lid height minus eye radius and a thickness)');
  const bore = num(p, 'bore');
  if (bore / 2 > 0.8 * e)
    throw new ParamError(`bore too large: a ${bore} mm axle hole needs an eye radius of at least ${(bore / 1.6).toFixed(2)} mm (eye is ${e.toFixed(2)} mm)`, 'bore');

  const X = x + 2 * t;
  const Y = y + 2 * t;
  const zA = t + h; // hinge axis height
  const Z = 2 * t + h + hl;
  const F: WallEdge = 'fingerHole';
  const f: WallEdge = 'finger';
  const ee: WallEdge = 'flat';
  const wall = (w: number, hh: number, types: WallEdges) => rectangularWall(w, hh, types, ctx);

  /** boxes.py CabinetHingeEdge.__poly for one hinge, box ('u', top = false) or lid ('U', top = true). */
  const hingePoly = (top: boolean): PolyItem[] => {
    const poly: PolyItem[] = top ? [sp, 90, e + q] : [sp + q, 90, e + q, 0];
    for (let i = 0; i < n; i++) {
      if ((i % 2 === 1) !== top) poly.push(i === 0 ? -90 : 90, t + 2 * q, 90);
      else poly.push(t - q, -90, t, -90, t - q);
    }
    if ((n % 2 === 1) !== top) poly.push(0, e + q, 90, q + sp);
    else { poly.pop(); poly.push(-90, e + q, 90, sp); }
    return poly;
  };
  const hingeEdge = (top: boolean): CustomSide => ({
    start: 0,
    end: 0,
    draw: (tt, len) => {
      let s = 0;
      for (const a of starts) {
        tt.forward(a - s);
        polyline(tt, hingePoly(top));
        s = a + width;
      }
      tt.forward(len - s);
    },
  });
  /** Edge-local start of eye i of the hinge starting at a (its slot is [s, s + t]). */
  const eyeAt = (a: number, i: number): number => a + sp + q + i * (t + q);

  // Walls with the hinge edges. Box back: side 2 runs from local x = x to 0, inwards = -y.
  const back = wall(x, h, [F, F, hingeEdge(false), F]);
  const lidBack = wall(x, hl, [hingeEdge(true), F, F, F]);
  const eyes: { id: string; wall: 'back' | 'lidback'; side: number; place: [number, number, number]; box: boolean }[] = [];
  starts.forEach((a, j) => {
    for (let i = 0; i < n; i++) {
      const s = eyeAt(a, i);
      const box = i % 2 === 0;
      const id = `eye${j}-${i}`;
      if (box) {
        // Square hole t x t, centred e + 2.5t below the edge; line down the slot's side at local x = x - s.
        back.holes.push(rect(x - s - t, h - e - 3 * t, x - s, h - e - 2 * t));
        const side = 4 + eyes.length;
        back.lines.push({ side, type: 'slot', from: { x: x - s, y: h - e }, to: { x: x - s, y: h - e - 3 * t }, holes: [back.holes.length - 1] });
        eyes.push({ id, wall: 'back', side, place: [t + x - s, Y, zA + e], box });
      } else {
        lidBack.holes.push(rect(s, e + 2 * t, s + t, e + 3 * t));
        const side = 4 + eyes.length;
        lidBack.lines.push({ side, type: 'slot', from: { x: s, y: e }, to: { x: s, y: e + 3 * t }, holes: [lidBack.holes.length - 1] });
        eyes.push({ id, wall: 'lidback', side, place: [t + s, Y, zA - e], box });
      }
    }
  });

  /** boxes.py CabinetHingeEdge.parts, style inside, eye <= 2t: bore at (0, e), wall face at x = 0. */
  const eyeWall = (): Wall => {
    const tt = new Turtle({ x: 0, y: 0 });
    polyline(tt, [0, [180, e], 0, -90, t, 90, t, -90, t, -90, t, 90, t, 90, t, [90, t], 2 * e, [90, 2 * t]]);
    return {
      outline: tt.toPath(true),
      holes: [circle(0, e, bore / 2)],
      lines: [{ side: 0, type: 'hinge', from: { x: 0, y: 2 * e }, to: { x: 0, y: 2 * e + 3 * t } }],
    };
  };

  const backMates: ([string, number] | undefined)[] = [['bottom', 2], ['right', 3], undefined, ['left', 1]];
  const lidBackMates: ([string, number] | undefined)[] = [undefined, ['lidright', 3], ['lidtop', 0], ['lidleft', 1]];
  for (const ey of eyes) (ey.wall === 'back' ? backMates : lidBackMates)[ey.side] = [ey.id, 0];

  const panels: PanelSpec[] = [
    panel('front', 'Front wall', wall(x, h, [F, F, ee, F]), at([t + x, 0, t], [-1, 0, 0], [0, 0, 1]),
      [['bottom', 0], ['left', 3], ['lidfront', 0], ['right', 1]]),
    panel('right', 'Right wall', wall(y, h, [F, f, ee, f]), at([X, t + y, t], [0, -1, 0], [0, 0, 1]),
      [['bottom', 1], ['front', 3], undefined, ['back', 1]]),
    panel('back', 'Back wall', back, at([t, Y, t], [1, 0, 0], [0, 0, 1]), backMates),
    panel('left', 'Left wall', wall(y, h, [F, f, ee, f]), at([0, t, t], [0, 1, 0], [0, 0, 1]),
      [['bottom', 3], ['back', 3], undefined, ['front', 1]]),
    panel('bottom', 'Bottom', wall(x, y, [f, f, f, f]), at([t, t, 0], [1, 0, 0], [0, 1, 0]),
      [['front', 0], ['right', 0], ['back', 0], ['left', 0]]),
    panel('lidfront', 'Lid front', wall(x, hl, [ee, F, F, F]), at([t + x, 0, zA], [-1, 0, 0], [0, 0, 1]),
      [['front', 2], ['lidleft', 3], ['lidtop', 2], ['lidright', 1]]),
    panel('lidright', 'Lid right', wall(y, hl, [ee, f, F, f]), at([X, t + y, zA], [0, -1, 0], [0, 0, 1]),
      [undefined, ['lidfront', 3], ['lidtop', 1], ['lidback', 1]]),
    panel('lidback', 'Lid back', lidBack, at([t, Y, zA], [1, 0, 0], [0, 0, 1]), lidBackMates),
    panel('lidleft', 'Lid left', wall(y, hl, [ee, f, F, f]), at([0, t, zA], [0, 1, 0], [0, 0, 1]),
      [undefined, ['lidback', 3], ['lidtop', 3], ['lidfront', 1]]),
    panel('lidtop', 'Lid top', wall(x, y, [f, f, f, f]), at([t, t + y, Z], [1, 0, 0], [0, -1, 0]),
      [['lidback', 2], ['lidright', 2], ['lidfront', 2], ['lidleft', 2]]),
  ];
  // Eyes: local x across the back wall (0 = outer face, -t = inner face), local y = depth + e.
  // Box eyes hang down from the axis (normal -x), lid eyes stand up from it (normal +x).
  for (const ey of eyes)
    panels.push(panel(ey.id, ey.box ? 'Hinge eye (box)' : 'Hinge eye (lid)', eyeWall(),
      ey.box ? at(ey.place, [0, 1, 0], [0, 0, -1]) : at(ey.place, [0, 1, 0], [0, 0, 1]), [[ey.wall, ey.side]]));
  return finishPanels(panels, t, effectiveKerf(p));
}

export const hingeBox: Generator = {
  id: 'hingebox',
  name: 'Hinge box',
  category: 'Lids & hinges',
  description: 'Box with a lid on laser-cut cabinet hinges; the axles are pieces of nail or wire.',
  schema,
  presets: {
    'Keepsake box': { x: 150, y: 100, h: 60, lidheight: 30, inside: true, hinges: 2 },
    'Recipe box': { x: 140, y: 100, h: 90, lidheight: 40, inside: false, hinges: 2, eyes: '3', thickness: 4, bore: 4 },
    'Long box': { x: 400, y: 120, h: 80, lidheight: 30, inside: false, hinges: 3, eyes: '7', thickness: 3 },
  },
  build,
  expectedSize,
};
