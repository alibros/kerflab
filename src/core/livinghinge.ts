/**
 * Living hinge ("X" flex), ported from boxes.py (florianfesti/boxes, boxes/edges.py FlexSettings
 * and FlexEdge): rows of staggered slits across a strip of the part so that it bends about an axis
 * parallel to the slits. Used with a bent part (`Part.bend`): the strip is an arc span.
 *
 * Layout over a strip `length` long (along the bend, local x) and `height` tall (along the slits,
 * local y), exactly as boxes.py: lines = floor(length / distance) slit lines at
 * i * distance + leftover / 2 (i = 1 .. lines - 1, leftover = length - lines * distance), so
 * consecutive lines are `distance` apart and the pattern repeats every 2 * distance; along each
 * line, sections = max(floor((height - connection) / width), 1) dashes of
 * (height - connection) / sections - connection, separated by `connection` bridges, odd and even
 * lines offset by half a section so the bridges alternate.
 *
 * Deliberate difference: boxes.py runs every other line's end dashes out to the strip's edges (open
 * slits). Here every slit is a closed hole strictly inside the part (the outline is never broken):
 * dashes are clipped to `edge` = connection / 2 from the strip's long edges (a thin band that
 * keeps the outline whole), and a dash left shorter than two slit widths is dropped.
 *
 * Slits are thin rectangular holes `flexSlitWidth(kerf)` wide (nominal): kerf + 0.1 mm, so after
 * kerf compensation (holes shrink by kerf / 2 per side) the cut path is a 0.1 mm wide loop and the
 * beam removes about kerf + 0.1 mm, i.e. practically a single cut line.
 */
import type { Path } from './geometry';
import type { Bend } from './part';
import { ParamError } from './validate';

/** boxes.py FlexSettings: distance, connection, width in multiples of thickness; stretch absolute. */
export type FlexSettings = { distance: number; connection: number; width: number; stretch: number };

export const FLEX_DEFAULTS: FlexSettings = { distance: 0.5, connection: 1, width: 5, stretch: 1.05 };

/** Extra nominal slit width over the kerf (mm). */
export const SLIT_EXTRA = 0.1;

/** Nominal width of a slit hole for a given (effective) kerf. */
export const flexSlitWidth = (kerf: number): number => kerf + SLIT_EXTRA;

export type Slit = { x: number; y0: number; y1: number };

export type LivingHinge = {
  /** Slit centre lines (part-local), for tests and drawing. */
  slits: Slit[];
  /** The slits as closed CCW holes. */
  holes: Path[];
  /** Line spacing (mm) = distance * thickness; the pattern period along the strip is twice this. */
  pitch: number;
};

/**
 * Slits of a living hinge over the strip [x0, x0 + length] x [y0, y0 + height] (part-local).
 * Throws ParamError (naming the flex setting) when the settings cannot produce a pattern: lines
 * closer than two slit widths, or a strip too short for two slit lines (floor(length / distance)
 * >= 3 line positions, the first and last of which are the strip's ends and carry no slit).
 */
export function livingHinge(x0: number, y0: number, length: number, height: number, s: FlexSettings, thickness: number, kerf: number): LivingHinge {
  const dist = s.distance * thickness;
  const c = s.connection * thickness;
  const w = s.width * thickness;
  const sw = flexSlitWidth(kerf);
  if (!(dist >= 2 * sw)) throw new ParamError(`flex_distance: line spacing ${dist.toFixed(2)} mm is less than two slit widths (${(2 * sw).toFixed(2)} mm)`, 'flex_distance');
  const lines = Math.floor(length / dist);
  if (lines < MIN_HINGE_POSITIONS)
    throw new ParamError(`flex_distance: strip ${length.toFixed(2)} mm is too short for two slit lines at spacing ${dist.toFixed(2)} mm (needs ${(MIN_HINGE_POSITIONS * dist).toFixed(2)} mm)`, 'flex_distance');
  if (!(height > 2 * c)) throw new ParamError(`flex_connection: strip ${height.toFixed(2)} mm is too narrow for the bridges ${c.toFixed(2)} mm`, 'flex_connection');
  const leftover = length - lines * dist;
  const h = height;
  const sections = Math.max(Math.floor((h - c) / w), 1);
  const sh = (h - c) / sections - c;
  const edge = c / 2;
  const slits: Slit[] = [];
  const dash = (pos: number, a: number, b: number): void => {
    const lo = Math.max(Math.min(a, b), edge);
    const hi = Math.min(Math.max(a, b), h - edge);
    if (hi - lo >= 2 * sw) slits.push({ x: x0 + pos, y0: y0 + lo, y1: y0 + hi });
  };
  for (let i = 1; i < lines; i++) {
    const pos = i * dist + leftover / 2;
    if (i % 2) {
      dash(pos, 0, c + sh);
      for (let j = 0; j < Math.floor((sections - 1) / 2); j++) dash(pos, (2 * j + 1) * sh + (2 * j + 2) * c, (2 * j + 3) * (sh + c));
      if (sections % 2 === 0) dash(pos, h - sh - c, h);
    } else if (sections % 2) {
      dash(pos, h, h - c - sh);
      for (let j = 0; j < Math.floor((sections - 1) / 2); j++) dash(pos, h - ((2 * j + 1) * sh + (2 * j + 2) * c), h - (2 * j + 3) * (sh + c));
    } else {
      for (let j = 0; j < sections / 2; j++) dash(pos, h - c - 2 * j * (sh + c), h - 2 * (j + 1) * (sh + c));
    }
  }
  const holes: Path[] = slits.map(({ x, y0: a, y1: b }) => ({
    start: { x: x - sw / 2, y: a }, closed: true,
    segs: [{ t: 'L', to: { x: x + sw / 2, y: a } }, { t: 'L', to: { x: x + sw / 2, y: b } }, { t: 'L', to: { x: x - sw / 2, y: b } }, { t: 'L', to: { x: x - sw / 2, y: a } }],
  }));
  return { slits, holes, pitch: dist };
}

/**
 * Line positions a strip needs: floor(length / distance) >= 3 gives slit lines at positions
 * 1 .. lines - 1, i.e. at least two slit lines (a single line does not make a hinge).
 */
export const MIN_HINGE_POSITIONS = 3;

/**
 * Flat (cut) length of a flex strip that bends to an arc of `arcLength` measured on the wall's
 * INNER face. Convention (boxes.py surroundingWall, kept on purpose): strip = inner arc / stretch,
 * so with stretch > 1 the cut strip is SHORTER than the inner arc; the slit pattern opens up by
 * `stretch` when bent. (The strip is not lengthened to the arc times stretch.)
 */
export const flexLength = (arcLength: number, s: FlexSettings): number => arcLength / s.stretch;

/**
 * Bounds on (strip length) / (inner-face arc length) for a living-hinge arc. With the
 * `flexLength` convention the ratio is 1 / stretch; the `flex_stretch` param is limited to
 * [1, 1.2], so [1 / 1.3, 1] accepts every legal stretch with margin while rejecting a strip built
 * from the wrong radius or angle (e.g. the outer face, a doubled or halved length). Rigid-body
 * checks cannot see this: the bent-part model maps any strip length uniformly onto the arc.
 */
export const STRIP_RATIO_MIN = 1 / 1.3;
export const STRIP_RATIO_MAX = 1;

/**
 * Checks every arc of a living-hinge bend against the strip-length convention: strip length /
 * (inner-face radius * angle) must lie in [STRIP_RATIO_MIN, STRIP_RATIO_MAX]. The inner face is
 * the concave one: radius - thickness for a positive bend (towards +n), radius for a negative
 * one. Throws an Error naming the arc otherwise.
 */
export function checkHingeStrips(b: Bend, thickness: number): void {
  b.arcs.forEach((a, i) => {
    const inner = a.angle > 0 ? a.radius - thickness : a.radius;
    const arc = (inner * Math.abs(a.angle) * Math.PI) / 180;
    const ratio = a.length / arc;
    if (!(ratio >= STRIP_RATIO_MIN - 1e-9 && ratio <= STRIP_RATIO_MAX + 1e-9))
      throw new Error(`bend arc ${i}: strip length ${a.length.toFixed(3)} mm is ${ratio.toFixed(3)} x the inner-face arc ${arc.toFixed(3)} mm (expected arc / stretch, ratio in [${STRIP_RATIO_MIN.toFixed(3)}, ${STRIP_RATIO_MAX}])`);
  });
}
