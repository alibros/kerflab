/**
 * Finger joints, ported from boxes.py (florianfesti/boxes, boxes/edges.py: FingerJointSettings,
 * FingerJointBase.calcFingers, FingerJointEdge, FingerJointEdgeCounterPart, FingerHoles).
 * Only the "rectangular" style at 90 degrees is ported; bed bolts and extra_length are omitted.
 *
 * Layout along an edge of length L (finger f, space s, surroundingSpaces ss, play p):
 *   fingers  = floor((L - (ss - 1) * s) / (s + f)), forced to 1 when 0 but L > f + thickness
 *   leftover = L - fingers * (s + f) + s, split evenly between both ends.
 * Widths are NOT stretched to fill L: the integer finger count is chosen to fit and the remainder
 * goes to the two end margins (faithful to boxes.py).
 *
 * Mating: `fingerJoint` (boxes.py 'f') protrudes fingers of width f to the RIGHT of travel (out of
 * the part) by one thickness. `fingerHoleEdge` (boxes.py 'F') cuts notches of width f + p into the
 * LEFT (into the part) by one thickness, with spaces s - p and ends shrunk by p/2 each, so every
 * notch is centred on its finger with p/2 clearance on each side. Both layouts are symmetric, so
 * the mating part can be drawn with the same function in its own CCW outline.
 *
 * Kerf convention: everything here is nominal geometry and ignores ctx.kerf. Kerf is compensated
 * once per finished part by offsetting its outer contour outwards by kerf/2 and its holes inwards
 * by kerf/2 (as boxes.py does with `burn`). That widens fingers by kerf and narrows notches/slots
 * by kerf; the beam then removes kerf/2 per side, so both parts end up at nominal size and mate
 * with exactly `play` clearance.
 */
import type { Path } from '../geometry';
import { Turtle } from '../turtle';
import { ParamError } from '../validate';
import type { Edge, EdgeCtx } from './types';

function checkCtx(length: number, ctx: EdgeCtx): void {
  const finite = (v: number, n: string): void => {
    if (!Number.isFinite(v)) throw new ParamError(`${n} must be a finite number, got ${String(v)}`);
  };
  finite(length, 'length');
  for (const k of ['thickness', 'kerf', 'finger', 'space', 'surroundingSpaces', 'play'] as const) finite(ctx[k], k);
  if (ctx.thickness <= 0) throw new ParamError('thickness must be > 0', 'thickness');
  if (ctx.finger < ctx.thickness) throw new ParamError('finger width must be >= thickness', 'finger');
  if (ctx.play < 0) throw new ParamError('play must be >= 0', 'play');
  if (ctx.space <= ctx.play) throw new ParamError('space must be > play', 'space');
  if (ctx.kerf < 0) throw new ParamError('kerf must be >= 0', 'kerf');
  if (ctx.surroundingSpaces < 0) throw new ParamError('surroundingSpaces must be >= 0');
  if (length < 3 * ctx.thickness) throw new ParamError('too short for finger joint');
}

/** boxes.py FingerJointBase.calcFingers (without bed bolts). Private: see `layout` for what is drawn. */
function calcFingers(length: number, ctx: EdgeCtx): { fingers: number; leftover: number } {
  const { space: s, finger: f } = ctx;
  let fingers = Math.floor((length - (ctx.surroundingSpaces - 1) * s) / (s + f));
  // The surrounding-space margins left no room for a whole finger: if one finger plus a thickness
  // of margin still fits, draw a single finger anyway with whatever margin remains.
  if (fingers === 0 && length > f + ctx.thickness) fingers = 1;
  if (fingers <= 0) return { fingers: 0, leftover: length };
  return { fingers, leftover: length - fingers * (s + f) + s };
}

type Layout = { fingers: number; finger: number; space: number; leftover: number };

/**
 * The layout actually drawn: calcFingers plus boxes.py's "small rectangular finger" fallback
 * (when no normal finger fits, one finger of width leftover/2 is centred on the edge).
 * Single source of truth for fingerJoint, fingerHoleEdge, fingerHolesFor, fingerCount, fingerLayout.
 */
function layout(length: number, ctx: EdgeCtx): Layout {
  checkCtx(length, ctx);
  const { fingers, leftover } = calcFingers(length, ctx);
  if (fingers === 0 && leftover > 0.75 * ctx.thickness && leftover > 4 * ctx.play)
    return { fingers: 1, finger: leftover / 2, space: ctx.space, leftover: leftover / 2 };
  const l = { fingers, finger: ctx.finger, space: ctx.space, leftover };
  if (l.fingers > 0 && l.leftover < ctx.play) throw new ParamError('play too large for finger layout', 'play');
  return l;
}

/**
 * Drawn finger count and total end margin (leftover, split evenly between both ends) for the
 * protruding side. Equals fingerLayout(...).fingers, including the small-finger fallback.
 */
export function fingerCount(length: number, ctx: EdgeCtx): { fingers: number; leftover: number } {
  const l = layout(length, ctx);
  return { fingers: l.fingers, leftover: l.leftover };
}

/**
 * Drawn layout of the protruding side: `fingers` fingers of width `finger`, separated by `space`,
 * with `margin` at each end (2*margin + fingers*finger + (fingers-1)*space = length when fingers > 0;
 * with 0 fingers the edge is straight). `finger` differs from ctx.finger only in the fallback case.
 * The notched side uses finger+play, space-play and margin-play/2.
 */
export function fingerLayout(
  length: number, ctx: EdgeCtx,
): { fingers: number; finger: number; space: number; margin: number } {
  const l = layout(length, ctx);
  return { fingers: l.fingers, finger: l.finger, space: l.space, margin: l.leftover / 2 };
}

function drawFingers(t: Turtle, length: number, ctx: EdgeCtx, positive: boolean, h = ctx.thickness): void {
  const l = layout(length, ctx);
  if (l.fingers === 0) {
    t.forward(length);
    return;
  }
  const p = positive ? 0 : ctx.play;
  const f = l.finger + p;
  const s = l.space - p;
  const end = (l.leftover - p) / 2;
  const dir = positive ? -1 : 1; // positive: out of the part (right); negative: into it (left)
  t.forward(end);
  for (let i = 0; i < l.fingers; i++) {
    if (i !== 0) t.forward(s);
    t.turn(90 * dir); t.forward(h); t.turn(-90 * dir);
    t.forward(f);
    t.turn(-90 * dir); t.forward(h); t.turn(90 * dir);
  }
  t.forward(end);
}

/** Protruding finger side (boxes.py 'f'). */
export const fingerJoint: Edge = (t, length, ctx) => drawFingers(t, length, ctx, true);

/** Notched counterpart (boxes.py 'F'). */
export const fingerHoleEdge: Edge = (t, length, ctx) => drawFingers(t, length, ctx, false);

/**
 * Slots for a finger-jointed part meeting this one face-on (boxes.py FingerHoles). Local frame:
 * the mating edge runs along +x from (0,0) to (length,0); slots are centred on y=0, sized
 * (finger + play) x (thickness + play), returned as closed CCW rectangles at nominal size.
 * Kerf sign rule: holes are CCW like outer outlines, so offsetPath(+d) would GROW them. The part
 * builder must offset holes by -kerf/2 (shrink) and outer outlines by +kerf/2.
 */
export function fingerHolesFor(length: number, ctx: EdgeCtx): Path[] {
  const l = layout(length, ctx);
  const w = l.finger + ctx.play;
  const hh = ctx.thickness + ctx.play;
  const out: Path[] = [];
  for (let i = 0; i < l.fingers; i++) {
    const cx = l.leftover / 2 + i * (l.space + l.finger) + l.finger / 2;
    const t = new Turtle({ x: cx - w / 2, y: -hh / 2 });
    t.forward(w); t.turn(90); t.forward(hh); t.turn(90); t.forward(w); t.turn(90); t.forward(hh);
    out.push(t.toPath(true));
  }
  return out;
}

// ---------------------------------------------------------------- angled finger joints

/**
 * Corner geometry of an angled finger joint (boxes.py FingerJointBase.fingerLength with
 * FingerJointSettings.angle, edges 'g'/'G'): two walls of thickness t whose directions differ by
 * the exterior turn `angle` (degrees, 0 < angle <= 90; 90 is the ordinary box corner) meet at a
 * vertical corner. Lengths are measured along a wall, outwards past its INNER corner line (where
 * the two inner faces meet):
 *  - `tip`  = t * tan(angle / 2): the outer corner line (where the two outer faces meet). Fingers
 *    are square-cut there, so a wall's outer face runs exactly to the corner.
 *  - `base` = -t * cos(angle) * tan(angle / 2) (<= 0): where a wall is cut back between its
 *    fingers. The partner's finger tip reaches across the corner to this line, touching it at the
 *    wall's mid-plane (inner tip corner of one finger on the other wall's cut face).
 *  - `depth` = tip - base = t * sin(angle): finger length.
 * At 90 degrees this is the ordinary finger joint (tip t, base 0, depth t). Both walls use the same
 * finger layout over the same length: the 'angledFinger' side (boxes.py 'g') is drawn on its base
 * line with fingers protruding `depth`; the 'angledFingerHole' side (boxes.py 'G') is drawn on its
 * tip line with notches `depth` deep, finger + play wide (as fingerHoleEdge). Square-cut fingers
 * cannot fill an oblique corner, so the joint touches along lines and leaves small voids at the
 * corner, exactly as in boxes.py. Acute corners (angle > 90) are not supported: a square-cut
 * finger reaching the outer corner would stick out of the box there.
 */
export function angledFingerWidths(angle: number, thickness: number): { tip: number; base: number; depth: number } {
  if (!(Number.isFinite(angle) && angle > 0 && angle <= 90 + 1e-9))
    throw new ParamError(`angled finger joints need a corner turn in (0, 90] degrees, got ${String(angle)}`);
  const a = (Math.min(angle, 90) * Math.PI) / 180;
  const tip = Math.abs(90 - angle) < 1e-9 ? thickness : thickness * Math.tan(a / 2);
  const base = Math.abs(90 - angle) < 1e-9 ? 0 : -Math.cos(a) * tip;
  return { tip, base, depth: tip - base };
}

const angleOf = (ctx: EdgeCtx): number => ctx.angle ?? 90;

/** Protruding side of an angled finger joint (boxes.py 'g'), corner turn `ctx.angle`; see angledFingerWidths. */
export const angledFingerJoint: Edge = (t, length, ctx) =>
  drawFingers(t, length, ctx, true, angledFingerWidths(angleOf(ctx), ctx.thickness).depth);

/** Notched side of an angled finger joint (boxes.py 'G'), corner turn `ctx.angle`; see angledFingerWidths. */
export const angledFingerHoleEdge: Edge = (t, length, ctx) =>
  drawFingers(t, length, ctx, false, angledFingerWidths(angleOf(ctx), ctx.thickness).depth);
