/**
 * Shared helpers for the flex batch: the living-hinge settings as params, and `flexWall`, a port of
 * the walls boxes.py's FlexBox generators draw by hand (`surroundingWall`): ONE wall that runs
 * around a profile, flat spans joined by living-hinge arcs, cut flat and placed as a bent part.
 *
 * Wall coordinates: local x runs along the wall (the bend direction), local y across it. The
 * INNER height is [0, H] (between the two profile plates' inner faces); both long edges are
 * drawn one thickness out (y = -t and y = H + t), so the wall covers the plates' edges:
 *  - 'fingerHole' flat spans are notched there for the plates' fingers (boxes.py 'F');
 *  - 'outset' flat spans and the arcs are plain at the full height (boxes.py `edge` / 'X');
 *  - a 'latch' span (last only) is the door end of boxes.py `latch(..., False)`: a notch
 *    (latch / 2 + 0.2 t long, 1.1 t deep) next to the previous arc for the plate's latch bump,
 *    then plain (the grip is left out).
 * The ends (x = 0 and x = length) are plain, or 'finger' (fingers over [0, H], one thickness of
 * plain edge each side; boxes.py `edge(t); f(H); edge(t)`).
 *
 * Joint lines: flat span k reports side k on the y = -t edge (running +x) and side 100 + k on the
 * y = H + t edge (running -x), both on the corner line one thickness out (the plates' finger
 * tips); 'outset' spans report 'flat'. Finger ends report side 200 (x = 0) and 201 (x = length)
 * on the finger-tip line. Arcs: `Bend` arcs with the z=0 (outer) radius r + t for an inner-face
 * radius r, flat length r * angle / stretch (boxes.py convention: inner arc / stretch, see
 * `flexLength`; the harness bounds it with `checkHingeStrips`), and a living hinge over the full
 * height.
 */
import { edgeFor, type EdgeType } from '../core/edges';
import type { EdgeCtx } from '../core/edges/types';
import { transform, type Path, type Seg, type Vec2 } from '../core/geometry';
import { FLEX_DEFAULTS, MIN_HINGE_POSITIONS, flexLength, livingHinge, type FlexSettings } from '../core/livinghinge';
import type { Bend } from '../core/part';
import type { Params, Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { num, type Wall, type WallLine } from './walls';

/** Living-hinge params (boxes.py FlexSettings), group "Flex". */
export const flexParams: Schema = [
  { key: 'flex_distance', label: 'Slit spacing', help: 'Distance between the living-hinge slit lines, in multiples of thickness',
    unit: '', group: 'Flex', kind: 'number', min: 0.2, max: 3, default: FLEX_DEFAULTS.distance, step: 0.05 },
  { key: 'flex_connection', label: 'Bridge', help: 'Length of the uncut bridges between slits, in multiples of thickness',
    unit: '', group: 'Flex', kind: 'number', min: 0.5, max: 5, default: FLEX_DEFAULTS.connection, step: 0.1 },
  { key: 'flex_width', label: 'Slit length', help: 'Length of one slit section (slit plus bridge), in multiples of thickness',
    unit: '', group: 'Flex', kind: 'number', min: 2, max: 30, default: FLEX_DEFAULTS.width, step: 0.5 },
  { key: 'flex_stretch', label: 'Stretch', help: 'How much the living hinge stretches when bent: its flat length is the arc length divided by this',
    unit: '', group: 'Flex', kind: 'number', min: 1, max: 1.2, default: FLEX_DEFAULTS.stretch, step: 0.01 },
];

export function flexSettings(p: Params): FlexSettings {
  return { distance: num(p, 'flex_distance'), connection: num(p, 'flex_connection'), width: num(p, 'flex_width'), stretch: num(p, 'flex_stretch') };
}

/** Most slits allowed in one wall (keeps cut files and the 3D view manageable). */
export const MAX_SLITS = 6000;

export type FlexSpan =
  | { kind: 'flat'; length: number; edge: 'fingerHole' | 'outset' }
  /** `r` is the radius of the wall's inner face (the profile plate's corner radius); `angle` in degrees, > 0. */
  | { kind: 'arc'; angle: number; r: number }
  | { kind: 'latch'; length: number };

export type FlexWall = Wall & { bend: Bend; length: number; /** Start x of every span. */ spanX: number[]; /** Flat length of every span. */ spanL: number[] };

/** Flat length of an arc span of inner radius r and angle (degrees). */
export const arcFlatLength = (r: number, angle: number, fs: FlexSettings): number => flexLength((r * angle * Math.PI) / 180, fs);

/**
 * Checks an arc can carry a living hinge (at least two slit lines, i.e. a strip of at least
 * MIN_HINGE_POSITIONS line spacings, as `livingHinge` requires); throws ParamError naming `key`
 * (the generator's radius-like param) otherwise.
 */
export function requireFlexArc(key: string, r: number, angle: number, fs: FlexSettings, t: number): void {
  const l = arcFlatLength(r, angle, fs);
  const need = MIN_HINGE_POSITIONS * fs.distance * t;
  if (!(r > 0) || l < need)
    throw new ParamError(`${key} too small: the living hinge over ${angle.toFixed(0)} degrees is ${l.toFixed(2)} mm long, needs ${need.toFixed(2)} mm for two slit lines`, key);
}

export function flexWall(spans: FlexSpan[], H: number, ends: ['flat' | 'finger', 'flat' | 'finger'], ctx: EdgeCtx, fs: FlexSettings): FlexWall {
  const t = ctx.thickness;
  const spanX: number[] = [];
  const spanL: number[] = [];
  let x = 0;
  for (const s of spans) {
    spanX.push(x);
    const l = s.kind === 'arc' ? arcFlatLength(s.r, s.angle, fs) : s.length;
    spanL.push(l);
    x += l;
  }
  const total = x;
  spans.forEach((s, i) => { if (s.kind === 'latch' && i !== spans.length - 1) throw new Error('flexWall: the latch must be the last span'); });

  const tt = new Turtle({ x: 0, y: -t });
  const drawSpan = (s: FlexSpan, l: number, reverse: boolean): void => {
    if (s.kind === 'flat' && s.edge === 'fingerHole') edgeFor('fingerHole')(tt, l, ctx);
    else if (s.kind !== 'latch') tt.forward(l);
    else {
      const notch = (): void => { tt.turn(90); tt.forward(1.1 * t); tt.turn(-90); tt.forward(l / 2 + 0.2 * t); tt.turn(-90); tt.forward(1.1 * t); tt.turn(90); };
      if (!reverse) { notch(); tt.forward(l / 2 - 0.2 * t); } else { tt.forward(l / 2 - 0.2 * t); notch(); }
    }
  };
  const drawEnd = (e: 'flat' | 'finger'): void => {
    if (e === 'flat') tt.forward(H + 2 * t);
    else { tt.forward(t); edgeFor('finger')(tt, H, ctx); tt.forward(t); }
  };
  spans.forEach((s, i) => drawSpan(s, spanL[i]!, false));
  tt.turn(90);
  drawEnd(ends[1]);
  tt.turn(90);
  for (let i = spans.length - 1; i >= 0; i--) drawSpan(spans[i]!, spanL[i]!, true);
  tt.turn(90);
  drawEnd(ends[0]);
  tt.turn(90);

  const holes: Path[] = [];
  const arcs: Bend['arcs'] = [];
  const lines: WallLine[] = [];
  spans.forEach((s, k) => {
    const a = spanX[k]!;
    const l = spanL[k]!;
    if (s.kind === 'arc') {
      arcs.push({ at: a, length: l, angle: s.angle, radius: s.r + t });
      holes.push(...livingHinge(a, -t, l, H + 2 * t, fs, t, ctx.kerf).holes);
    } else if (s.kind === 'flat') {
      const type: EdgeType = s.edge === 'fingerHole' ? 'fingerHole' : 'flat';
      lines.push({ side: k, type, from: { x: a, y: -t }, to: { x: a + l, y: -t } });
      lines.push({ side: 100 + k, type, from: { x: a + l, y: H + t }, to: { x: a, y: H + t } });
    }
  });
  if (ends[0] === 'finger') lines.push({ side: 200, type: 'finger', from: { x: -t, y: H }, to: { x: -t, y: 0 } });
  if (ends[1] === 'finger') lines.push({ side: 201, type: 'finger', from: { x: total + t, y: 0 }, to: { x: total + t, y: H } });
  if (holes.length > MAX_SLITS)
    throw new ParamError(`flex_distance: ${holes.length} living-hinge slits in one wall (max ${MAX_SLITS}); use a wider slit spacing or slit length, or thicker material`, 'flex_distance');
  return { outline: tt.toPath(true), holes, lines, bend: { arcs }, length: total, spanX, spanL };
}

/** boxes.py `latch(length)` (box side): a bump one thickness out (right of travel) for length / 2, then length / 2 plain. */
export function latchBump(tt: Turtle, length: number, t: number): void {
  tt.turn(-90); tt.forward(t); tt.turn(90); tt.forward(length / 2); tt.turn(90); tt.forward(t); tt.turn(-90); tt.forward(length / 2);
}

/** The same closed path traversed the other way round (arcs keep their centres). */
function reversePath(p: Path): Path {
  const pts: Vec2[] = [p.start, ...p.segs.map((s) => s.to)];
  const segs: Seg[] = [];
  for (let i = p.segs.length - 1; i >= 0; i--) {
    const s = p.segs[i]!;
    const to = pts[i]!;
    segs.push(s.t === 'L' ? { t: 'L', to: { ...to } } : { t: 'A', to: { ...to }, c: { ...s.c }, ccw: !s.ccw });
  }
  return { start: { ...pts[pts.length - 1]! }, segs, closed: p.closed };
}

/**
 * Mirror image of a plate about x = w / 2 (x -> w - x), still CCW: the second plate of a profile
 * pair, seen from its own outer face. Joint lines are mirrored and reversed (they keep running CCW).
 */
export function mirrorWall(wall: Wall, w: number): Wall {
  const m = (p: Path): Path => reversePath(transform(p, [-1, 0, w, 0, 1, 0, 0, 0, 1]));
  const mv = (v: Vec2): Vec2 => ({ x: w - v.x, y: v.y });
  return {
    outline: m(wall.outline),
    holes: wall.holes.map(m),
    lines: wall.lines.map((l) => ({ ...l, from: mv(l.to), to: mv(l.from) })),
  };
}
