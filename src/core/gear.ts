/**
 * Involute spur gears and shared round-part geometry (shaft bores), for the mechanical
 * generators. Standard full-depth teeth (ISO 53 basic rack without profile shift):
 *   pitch radius   r  = m z / 2
 *   base radius    rb = r cos(alpha)
 *   tip radius     ra = r + m            (addendum m)
 *   root radius    rf = r - 1.25 m       (dedendum 1.25 m, i.e. 0.25 m tip clearance)
 * The tooth thickness on the pitch circle is pi m / 2 less half the circular `backlash` (each
 * gear of a pair gives up half), so a meshing pair at the standard centre distance m (z1 + z2) / 2
 * has `backlash` of play measured along the pitch circle.
 *
 * Flanks are involutes of the base circle, sampled as polylines (chords lie inside the convex
 * involute, so the drawn tooth is never fatter than the true one). Near the root the flank is cut
 * back to the trochoid the basic-rack cutter's tip corner sweeps (the undercut of pinions with
 * fewer than 2 / sin^2(alpha) teeth, 17 at 20 degrees), so meshing gears never interfere. The
 * root between teeth is an arc of the root circle and the tip an arc of the tip circle.
 */
import type { Path, Seg, Vec2 } from './geometry';
import { Turtle } from './turtle';
import { ParamError } from './validate';

export type GearSpec = {
  /** Module (mm): pitch diameter / teeth. */
  module: number;
  teeth: number;
  /** Pressure angle (degrees). */
  pressureAngle: number;
  /** Circular backlash of a pair (mm); this gear's teeth are thinned by half of it. */
  backlash: number;
};

export type GearDims = { r: number; rb: number; ra: number; rf: number; pitch: number };

const rad = (d: number): number => (d * Math.PI) / 180;
/** Involute function inv(a) = tan(a) - a. */
export const involute = (a: number): number => Math.tan(a) - a;

export function gearDims(g: GearSpec): GearDims {
  const r = (g.module * g.teeth) / 2;
  return { r, rb: r * Math.cos(rad(g.pressureAngle)), ra: r + g.module, rf: r - 1.25 * g.module, pitch: Math.PI * g.module };
}

/** Standard centre distance of two meshing gears of the same module. */
export const centreDistance = (module: number, z1: number, z2: number): number => (module * (z1 + z2)) / 2;

/**
 * Half the angular tooth thickness at radius R (radians), for R >= base radius: the flank's angle
 * from the tooth's centre line. psi = half thickness at the pitch circle; the involute moves the
 * flank by inv(alpha) - inv(alpha_R).
 */
export function halfToothAngle(g: GearSpec, R: number): number {
  const { r, rb } = gearDims(g);
  const s = Math.PI * g.module / 2 - g.backlash / 2;
  const psi = s / (2 * r);
  const aR = Math.acos(Math.min(1, rb / R));
  return psi + involute(rad(g.pressureAngle)) - involute(aR);
}

/** Throws ParamError naming the param when the gear cannot be drawn. */
export function checkGear(g: GearSpec, keys: { teeth: string; backlash: string; module: string }): void {
  const { ra, rf } = gearDims(g);
  if (!(Number.isInteger(g.teeth) && g.teeth >= 4)) throw new ParamError(`${keys.teeth} must be at least 4`, keys.teeth);
  if (!(rf > 0)) throw new ParamError(`${keys.teeth} too small: the root circle would be ${rf.toFixed(2)} mm`, keys.teeth);
  if (!(g.backlash >= 0 && g.backlash < (Math.PI * g.module) / 4))
    throw new ParamError(`${keys.backlash} must be at least 0 and below a quarter of the circular pitch (${((Math.PI * g.module) / 4).toFixed(2)} mm)`, keys.backlash);
  if (!((2 * Math.PI) / g.teeth - 2 * drawnHalfAngle(g, rf) > 1e-3))
    throw new ParamError(`${keys.teeth}: the tooth gaps close at the root at this pressure angle; use more teeth`, keys.teeth);
  if (!(halfToothAngle(g, ra) > 1e-3))
    throw new ParamError(`${keys.teeth}: the teeth come to a point below the tip circle at this pressure angle; use more teeth or a larger pressure angle`, keys.teeth);
}

/** Point at radius R and polar angle a. */
const polar = (R: number, a: number): Vec2 => ({ x: R * Math.cos(a), y: R * Math.sin(a) });

/**
 * Shortest flank segment kept (mm): kerf compensation offsets the outline by up to kerf / 2 with
 * mitred corners, which shortens the segments next to the sharp root corner by about that much, so
 * shorter ones would collapse.
 */
export const minFlankSegment = (module: number): number => Math.max(0.4, 0.3 * module);

/**
 * Indices of the flank samples `pts` (in travel order) to keep so that every segment is at least
 * `lmin` long where possible. A sample may only be dropped when the chord that replaces it does not
 * add material where a mating gear can reach: the dropped point lies on side `free` of the chord
 * (+1 left, -1 right of travel: the side away from the material), or it lies in the tip-clearance
 * band (`band(i)`) that a mating tooth never reaches. The first and last samples are always kept.
 */
function keepFlank(pts: Vec2[], lmin: number, free: 1 | -1, band: (i: number) => boolean): number[] {
  const n = pts.length - 1;
  const keep = [0];
  let a = 0;
  while (a < n) {
    let b = a + 1;
    while (b < n && Math.hypot(pts[b]!.x - pts[a]!.x, pts[b]!.y - pts[a]!.y) < lmin) b++;
    const ok = (bb: number): boolean => {
      const A = pts[a]!;
      const B = pts[bb]!;
      for (let k = a + 1; k < bb; k++) {
        if (band(k)) continue;
        const q = pts[k]!;
        const side = (B.x - A.x) * (q.y - A.y) - (B.y - A.y) * (q.x - A.x);
        if (side * free < -1e-12) return false;
      }
      return true;
    };
    while (b > a + 1 && !ok(b)) b--;
    keep.push(b);
    a = b;
  }
  return keep;
}

/**
 * Undercut limit: the trochoid swept by the tip corner of the basic-rack cutter (depth 1.25 m,
 * flank angle alpha, tooth as wide as the gear's gap) rolling on the pitch circle. Returns the
 * corner's polar points (radius, angle from the tooth's centre line) for radii up to the pitch
 * radius. Generating the tooth with this rack removes everything a mating gear's tip (only m
 * deep) could reach, so a meshing pair never interferes, whatever the tooth count.
 */
function cutterTrochoid(g: GearSpec): { R: number; a: number }[] {
  const { r } = gearDims(g);
  const m = g.module;
  const c = 1.25 * m;
  const half = (Math.PI * m / 2 + g.backlash / 2) / 2 - c * Math.tan(rad(g.pressureAngle)); // cutter half width at its tip
  const xc = r - c;
  const yc = (Math.PI * m) / 2 - half;
  const th0 = -yc / r;
  const out: { R: number; a: number }[] = [];
  for (let i = -400; i <= 400; i++) {
    const th = th0 + (i / 400) * 1.5;
    const y = yc + r * th;
    // Rack point (xc, y) seen from the gear turned by th: rotate by -th.
    const px = xc * Math.cos(th) + y * Math.sin(th);
    const py = -xc * Math.sin(th) + y * Math.cos(th);
    const R = Math.hypot(px, py);
    if (R <= r) out.push({ R, a: Math.atan2(py, px) });
  }
  return out;
}

/** Smallest angle of the trochoid at radius R (Infinity when it does not reach R). */
function trochoidLimit(tro: { R: number; a: number }[], R: number): number {
  let best = Infinity;
  for (let i = 1; i < tro.length; i++) {
    const p = tro[i - 1]!;
    const q = tro[i]!;
    if ((p.R - R) * (q.R - R) > 0 || p.R === q.R) continue;
    const f = (R - p.R) / (q.R - p.R);
    best = Math.min(best, p.a + f * (q.a - p.a));
  }
  return best;
}

/** Safety margin (mm) taken off the generated root flank against the chords of its sampling. */
const ROOT_MARGIN = 0.003;

/**
 * Half the angular tooth thickness at radius R of the drawn tooth: the involute (above the base
 * circle) cut back by the rack's undercut trochoid near the root.
 */
export function drawnHalfAngle(g: GearSpec, R: number, tro = cutterTrochoid(g)): number {
  const { rb } = gearDims(g);
  const inv = R >= rb ? halfToothAngle(g, R) : Infinity;
  const lim = trochoidLimit(tro, R);
  const h = Math.min(inv, Number.isFinite(lim) ? lim - ROOT_MARGIN / R : Infinity);
  return Number.isFinite(h) ? h : halfToothAngle(g, rb);
}

/**
 * Root radius drawn for a cut with `kerf`: the root circle, or, where the tooth gap at the root is
 * too narrow for the beam (kerf compensation would close it: small modules, undercut pinions), the
 * smallest radius at which the gap is 1.2 kerf + 0.02 mm wide. The root is then filled up to there,
 * which is what the beam leaves anyway; mating tips reach only to the root circle + 0.25 m, so a
 * raise within that band changes nothing for meshing. Throws ParamError naming `kerf` beyond it.
 */
export function rootRadius(g: GearSpec, kerf: number, tro = cutterTrochoid(g)): number {
  const { rf } = gearDims(g);
  if (!(kerf > 0)) return rf;
  const need = 1.2 * kerf + 0.02;
  const gap = (R: number): number => 2 * R * Math.sin(Math.PI / g.teeth - drawnHalfAngle(g, R, tro));
  if (gap(rf) >= need) return rf;
  const top = rf + 0.25 * g.module;
  if (!(gap(top) >= need))
    throw new ParamError(`kerf ${kerf} mm is too large for the tooth gaps of a ${g.teeth}-tooth module ${g.module} gear (the beam cannot cut its roots)`, 'kerf');
  let lo = rf;
  let hi = top;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) >= need) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * Closed CCW outline of the gear centred on (0, 0), tooth 0 centred on the +x axis. Each flank is
 * sampled at `samples` radii from the root to the tip circle (denser near the root), then thinned
 * so flank segments are at least `minFlankSegment` long (kerf compensation's mitres would collapse
 * shorter ones at the sharp root corner). `kerf`: the cut's kerf, see `rootRadius`.
 */
export function gearOutline(g: GearSpec, samples = 24, kerf = 0): Path {
  const { ra, rf } = gearDims(g);
  const z = g.teeth;
  const tro = cutterTrochoid(g);
  const rr = rootRadius(g, kerf, tro);
  const all = Array.from({ length: samples + 1 }, (_, i) => rr + (ra - rr) * (i / samples) ** 1.5);
  const allHalves = all.map((R) => drawnHalfAngle(g, R, tro));
  // Right flank of tooth 0, root to tip: material on the left, so samples may be dropped to the right.
  const idx = keepFlank(all.map((R, i) => polar(R, -allHalves[i]!)), minFlankSegment(g.module), -1, (i) => all[i]! <= rf + 0.25 * g.module);
  const radii = idx.map((i) => all[i]!);
  const halves = idx.map((i) => allHalves[i]!);
  const segs: Seg[] = [];
  const c = { x: 0, y: 0 };
  let start: Vec2 | undefined;
  for (let k = 0; k < z; k++) {
    const phi = (2 * Math.PI * k) / z;
    const right = radii.map((R, i) => polar(R, phi - halves[i]!));
    const left = radii.map((R, i) => polar(R, phi + halves[i]!)).reverse();
    if (!start) start = right[0]!;
    else segs.push({ t: 'A', to: right[0]!, c, ccw: true }); // root arc from the previous tooth
    for (const q of right.slice(1)) segs.push({ t: 'L', to: q });
    segs.push({ t: 'A', to: left[0]!, c, ccw: true }); // tip arc
    for (const q of left.slice(1)) segs.push({ t: 'L', to: q });
  }
  segs.push({ t: 'A', to: start!, c, ccw: true });
  return { start: start!, segs, closed: true };
}

// ---------------------------------------------------------------- internal (ring) gears

/**
 * Internal gear dimensions: the teeth point inwards, so the tip circle is r - m and the root
 * circle r + 1.25 m (0.25 m clearance to a mating pinion's tips).
 */
export function ringDims(g: GearSpec): { r: number; rb: number; ri: number; ro: number } {
  const { r, rb } = gearDims(g);
  return { r, rb, ri: r - g.module, ro: r + 1.25 * g.module };
}

/**
 * Half the angular width of a ring gear's tooth SPACE at radius R (radians). The space of an
 * internal gear is bounded by the same involutes as an external tooth: pi m / 2 plus half the
 * backlash wide on the pitch circle, narrowing outwards. Below the base circle the flank is radial.
 */
export function ringSpaceHalfAngle(g: GearSpec, R: number): number {
  const { r, rb } = gearDims(g);
  const psi = (Math.PI * g.module / 2 + g.backlash / 2) / (2 * r);
  const aR = Math.acos(Math.min(1, rb / Math.max(R, rb)));
  return psi + involute(rad(g.pressureAngle)) - involute(aR);
}

/**
 * Smallest tooth difference ring - pinion accepted for an internal pair without profile shift:
 * fewer teeth difference makes the ring's tips foul the pinion's (tip interference) at 20 degrees.
 */
export const MIN_RING_DIFFERENCE = 12;

/** Throws ParamError naming the param when the ring cannot be drawn or would foul a `pinion`-tooth gear. */
export function checkRing(g: GearSpec, pinion: number, keys: { teeth: string; pinion: string }): void {
  const { ri, ro } = ringDims(g);
  if (!(g.teeth - pinion >= MIN_RING_DIFFERENCE))
    throw new ParamError(`${keys.pinion}: the ring needs at least ${MIN_RING_DIFFERENCE} more teeth than the gear inside it (tip interference), got ${g.teeth} and ${pinion}`, keys.pinion);
  if (!(ringSpaceHalfAngle(g, ro) > 1e-3)) throw new ParamError(`${keys.teeth}: the ring's tooth spaces close before the root circle; use more teeth`, keys.teeth);
  if (!((2 * Math.PI) / g.teeth - 2 * ringSpaceHalfAngle(g, ri) > 1e-3))
    throw new ParamError(`${keys.teeth}: the ring's teeth come to a point at the tip circle; use more teeth`, keys.teeth);
}

/**
 * Closed CCW contour of a ring gear's toothed hole centred on (0, 0), tooth space 0 centred on the
 * +x axis (so a pinion with a tooth on its +x axis, centred on the +x axis, meshes with it). Used
 * as a hole: the ring's material is outside it.
 */
export function ringHole(g: GearSpec, samples = 24): Path {
  const { ri, ro } = ringDims(g);
  const z = g.teeth;
  const all = Array.from({ length: samples + 1 }, (_, i) => ri + (ro - ri) * (i / samples));
  const allHalves = all.map((R) => ringSpaceHalfAngle(g, R));
  // Right flank of space 0, tip to root: the ring's material is on the right, samples may be dropped to the left.
  const idx = keepFlank(all.map((R, i) => polar(R, -allHalves[i]!)), minFlankSegment(g.module), 1, (i) => all[i]! >= ro - 0.25 * g.module);
  const radii = idx.map((i) => all[i]!);
  const halves = idx.map((i) => allHalves[i]!);
  const segs: Seg[] = [];
  const c = { x: 0, y: 0 };
  let start: Vec2 | undefined;
  for (let k = 0; k < z; k++) {
    const phi = (2 * Math.PI * k) / z;
    const right = radii.map((R, i) => polar(R, phi - halves[i]!));
    const left = radii.map((R, i) => polar(R, phi + halves[i]!)).reverse();
    if (!start) start = right[0]!;
    else segs.push({ t: 'A', to: right[0]!, c, ccw: true }); // tip arc of the ring tooth before
    for (const q of right.slice(1)) segs.push({ t: 'L', to: q });
    segs.push({ t: 'A', to: left[0]!, c, ccw: true }); // root arc of the space
    for (const q of left.slice(1)) segs.push({ t: 'L', to: q });
  }
  segs.push({ t: 'A', to: start!, c, ccw: true });
  return { start: start!, segs, closed: true };
}

// ---------------------------------------------------------------- shaft bores

export type BoreShape = 'none' | 'round' | 'd' | 'hex';
export const BORE_SHAPES: BoreShape[] = ['none', 'round', 'd', 'hex'];

/**
 * Closed CCW shaft bore centred on (cx, cy): a circle of diameter d; a D-shaft (circle with one
 * flat 0.1 d deep, the common D profile, e.g. 5 mm motor shafts have a 4.5 mm flat); or a hexagon
 * d across the flats. Undefined for 'none' or d <= 0.
 */
export function bore(shape: BoreShape, d: number, cx = 0, cy = 0): Path | undefined {
  if (shape === 'none' || !(d > 0)) return undefined;
  const r = d / 2;
  const c = { x: cx, y: cy };
  if (shape === 'round')
    return { start: { x: cx + r, y: cy }, closed: true,
      segs: [{ t: 'A', to: { x: cx - r, y: cy }, c, ccw: true }, { t: 'A', to: { x: cx + r, y: cy }, c, ccw: true }] };
  if (shape === 'hex') {
    const R = r / Math.cos(Math.PI / 6);
    const tu = new Turtle({ x: cx + R, y: cy }, 120);
    for (let i = 0; i < 6; i++) { tu.forward(R); tu.turn(60); }
    return tu.toPath(true);
  }
  // D: flat at x = cx + 0.8 r (0.1 d deep), across the circle.
  const fx = 0.8 * r;
  const fy = Math.sqrt(r * r - fx * fx);
  return { start: { x: cx + fx, y: cy - fy }, closed: true,
    segs: [{ t: 'L', to: { x: cx + fx, y: cy + fy } }, { t: 'A', to: { x: cx - r, y: cy }, c, ccw: true }, { t: 'A', to: { x: cx + fx, y: cy - fy }, c, ccw: true }] };
}

/** Radius of the smallest circle containing a bore (for clearance checks). */
export const boreRadius = (shape: BoreShape, d: number): number => (shape === 'hex' ? d / 2 / Math.cos(Math.PI / 6) : shape === 'none' ? 0 : d / 2);

// ---------------------------------------------------------------- racks

/**
 * Closed CCW outline of a straight rack meshing with gears of the same module, pressure angle
 * and backlash share: the basic rack (addendum m, dedendum 1.25 m, flanks at the pressure angle,
 * tooth `pi m / 2 - backlash / 2` thick on the pitch line). The pitch line is y = `yPitch`, the
 * teeth point up (+y), a tooth GAP is centred at x = `gapX` (and every pitch from it); the rack
 * runs from x0 to x1 and its body reaches `body` below the tooth roots.
 */
export function rackOutline(g: Pick<GearSpec, 'module' | 'pressureAngle' | 'backlash'>, x0: number, x1: number, yPitch: number, gapX: number, body: number): Path {
  const m = g.module;
  const p = Math.PI * m;
  const tan = Math.tan(rad(g.pressureAngle));
  const w = (p / 2 - g.backlash / 2) / 2; // half tooth thickness on the pitch line
  const yTip = yPitch + m;
  const yRoot = yPitch - 1.25 * m;
  // Profile vertices (x, y) left to right over one period per tooth, centred on tooth centres.
  const pts: Vec2[] = [];
  const k0 = Math.floor((x0 - gapX) / p) - 1;
  const k1 = Math.ceil((x1 - gapX) / p) + 1;
  for (let k = k0; k <= k1; k++) {
    const c = gapX + (k + 0.5) * p; // tooth centre
    pts.push({ x: c - w - 1.25 * m * tan, y: yRoot }, { x: c - w + m * tan, y: yTip }, { x: c + w - m * tan, y: yTip }, { x: c + w + 1.25 * m * tan, y: yRoot });
  }
  const yAt = (x: number): number => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (x >= a.x && x <= b.x) return b.x === a.x ? Math.max(a.y, b.y) : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    }
    return yRoot;
  };
  const inner = pts.filter((q) => q.x > x0 + 1e-9 && q.x < x1 - 1e-9).reverse();
  const yb = yRoot - body;
  const ring: Vec2[] = [{ x: x0, y: yb }, { x: x1, y: yb }, { x: x1, y: yAt(x1) }, ...inner, { x: x0, y: yAt(x0) }];
  return { start: ring[0]!, closed: true, segs: [...ring.slice(1), ring[0]!].map((to) => ({ t: 'L' as const, to })) };
}
