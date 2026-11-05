/**
 * Part model: a flat 2D outline (with holes and engravings) plus its 3D placement and joint
 * metadata. 3D views and cut files derive from the same parts.
 */
import type { EdgeType } from './edges';
import { area, GeometryError, isSimple, offsetPath, type Path, type Vec2 } from './geometry';
import type { Params, Schema } from './schema';
import { assertFinite, ParamError } from './validate';

export type Vec3 = [number, number, number];

/**
 * Rigid placement of a part in the assembled model.
 *
 * GENERATOR CONVENTION (enforced by the harness fixtures; every generator must follow it):
 *  - The part-local point (x, y, z) maps to world `origin + x*u + y*v + z*n`, with u = `x`,
 *    v = `y` orthonormal and the normal n = u x v.
 *  - The local z=0 plane is the OUTER / show face and holds the drawn outline.
 *  - n points INTO the box (towards the assembly interior); the material occupies
 *    0 <= z <= thickness, i.e. thickness extends along +n.
 *  - `engrave` paths are drawn on the z=0 (outer) face.
 *  - 3D viewers and assembly checks use `Part.nominal` outlines, never the kerf-compensated
 *    `outline`/`holes` (those are for cutting only).
 */
export type Placement = { origin: Vec3; x: Vec3; y: Vec3 };

/**
 * One bend of a bent part: the flat strip `at <= x <= at + length` (part-local x) is curved into a
 * circular arc about an axis parallel to the part's local y. `angle` (degrees, signed, 0 < |angle|
 * < 360) is the turn of the part's direction over the strip: positive bends towards +n (into the
 * box, so the z=0 show face is on the outside of the bend), negative away from it. `radius` is the
 * radius of the z=0 face; the face at depth z has radius `radius - z` for a positive bend (so the
 * radius must exceed the thickness) and `radius + z` for a negative one. The flat length maps to
 * the angle uniformly: a living hinge's stretch is (arc length at the face of interest) / length.
 */
export type BendArc = { at: number; length: number; angle: number; radius: number };

/**
 * Bent part (living hinge, e.g. a wall wrapped around a rounded plate): ONE flat cut part placed
 * in 3D as flat spans joined by arcs. Arcs are listed in increasing `at` and do not overlap;
 * part-local x outside every arc is flat. The span before the first arc is placed by
 * `Part.placement` exactly like a rigid part; each later flat span continues tangentially from the
 * end of the previous arc (`partToWorld`). Cut files ignore the bend: the part is cut flat.
 */
export type Bend = { arcs: BendArc[] };

/** Joint metadata for one logical side of a part. */
export type PartEdge = {
  /** Logical side index (e.g. 0..3 for a rectangular panel, CCW from the bottom side). */
  side: number;
  type: EdgeType;
  /**
   * Nominal (pre-kerf) endpoints of the side's joint reference line, in part-local 2D. For a mate,
   * both parts' lines must map to the same world segment (either direction) — typically the shared
   * outer corner line of the two panels. Not necessarily on the outline (e.g. finger tips).
   *
   * Direction: each part runs from -> to along its own CCW outline, so two mated lines normally
   * run in OPPOSITE world directions (the harness accepts either). Symmetric edges (finger
   * layouts, flat) do not care. An asymmetric edge (e.g. a hinge or a layout that is not
   * mirror-symmetric about the midpoint) must draw its partner reversed so features line up.
   */
  from: Vec2;
  to: Vec2;
  mate?: { part: string; side: number };
  /**
   * Explicitly unmated joint edge (e.g. a finger edge left for the user to glue to something
   * outside the model). Joint types other than flat/mitre/rounded must have a mate or `open: true`.
   */
  open?: boolean;
  /**
   * Interior joint: indices into the part's (nominal) holes, e.g. a row of slots in the middle of a
   * plate that a divider's fingers pass through. The joint line is then checked against these
   * holes instead of the outline; mates, contact and connectivity work as for outline joints.
   */
  holes?: number[];
  /**
   * Face the joint line lies on: the z=0 (outer) face by default, or `'inner'` for the part's inner
   * face (local z = thickness). Only for flat (resting) mates on rigid parts: a part resting on
   * another's inner face (a drawer on its frame bottom, a lid on a wall top) touches it there,
   * and both parts' lines must coincide on that contact.
   */
  face?: 'inner';
};

export type Part = {
  id: string;
  name: string;
  /** Kerf-compensated outer contour, closed, CCW. */
  outline: Path;
  /** Kerf-compensated cut-outs, closed, CCW (same orientation as outlines). */
  holes: Path[];
  engrave: Path[];
  placement: Placement;
  /** Optional bend (living hinge) along local x; absent for rigid parts. See `Bend`. */
  bend?: Bend;
  thickness: number;
  edges: PartEdge[];
  /** Kerf (full cut width, mm) applied to `nominal` to obtain `outline`/`holes`; 0 when uncompensated. */
  kerf: number;
  /** Geometry at nominal size, before kerf compensation; used for assembly checks and 3D. */
  nominal: { outline: Path; holes: Path[] };
};

export interface Generator {
  id: string;
  name: string;
  category: string;
  description: string;
  schema: Schema;
  presets: Record<string, Params>;
  build(p: Params): Part[];
  /**
   * Expected world bounding-box extents (mm) of the assembled nominal parts, OUTER dimensions
   * unless the generator documents otherwise. When present the harness enforces it within 0.01 mm.
   */
  expectedSize?(p: Params): { x: number; y: number; z: number };
  /**
   * How the parts relate in the assembled model. 'joined' (default): one object, every part
   * connected to the others through mates. 'loose': separate pieces shown together (a meshing gear
   * pair, a stack of plates, a set of test pieces) that need not be connected through mates; every
   * other check (valid parts, kerf, mates that are declared, no interpenetration, expectedSize)
   * still applies.
   */
  assembly?: 'joined' | 'loose';
  /** Presentation hints for the 3D view and its thumbnail; never affects the parts. */
  view?: GeneratorView;
}

/**
 * How the 3D view presents a generator by default. The home camera looks at the -y side of the
 * assembly (front-right, from above); objects whose working side faces another way say so here.
 */
export type GeneratorView = {
  /**
   * Degrees to turn the home camera (and its key light and section plane) about the vertical axis,
   * counter-clockwise seen from above: 180 looks at the +y side (e.g. a wall-mounted holder whose
   * hooks point +y). Default 0.
   */
  turn?: number;
  /**
   * Parts drawn see-through (outline only, not pickable) unless selected, so a cover does not hide
   * the mechanism inside it (e.g. a gearbox's top plate). Unknown ids are ignored.
   */
  ghost?: (partId: string) => boolean;
};

const clone = (p: Path): Path => ({
  start: { ...p.start },
  closed: p.closed,
  segs: p.segs.map((s) => (s.t === 'L' ? { t: 'L', to: { ...s.to } } : { t: 'A', to: { ...s.to }, c: { ...s.c }, ccw: s.ccw })),
});

/**
 * Kerf compensation: outer contour offset outwards by kerf/2, holes inwards by kerf/2 (holes are
 * CCW like outlines, so that is offsetPath(-kerf/2)). Call once per finished part. May throw
 * GeometryError when kerf collapses a feature.
 */
export function applyKerf(outline: Path, holes: Path[], kerf: number): { outline: Path; holes: Path[] } {
  assertFinite(kerf, 'kerf');
  if (kerf < 0) throw new RangeError(`kerf must be >= 0, got ${kerf}`);
  if (kerf === 0) return { outline: clone(outline), holes: holes.map(clone) };
  return { outline: offsetPath(outline, kerf / 2), holes: holes.map((h) => offsetPath(h, -kerf / 2)) };
}

/** Builds a Part from nominal geometry, applying kerf and recording both. */
export function finishPart(spec: Omit<Part, 'kerf' | 'nominal'>, kerf: number): Part {
  const k = applyKerf(spec.outline, spec.holes, kerf);
  return {
    ...spec,
    outline: k.outline,
    holes: k.holes,
    kerf,
    nominal: { outline: clone(spec.outline), holes: spec.holes.map(clone) },
  };
}

/** Kerf used to tell "kerf closes a feature" apart from "the geometry cannot be offset at all". */
const PROBE_KERF = 1e-3;

function assertNominal(spec: Omit<Part, 'kerf' | 'nominal'>): void {
  const check = (p: Path, what: string): void => {
    if (!p.closed) throw new GeometryError(`${spec.name} ${what}: path is not closed`);
    if (!isSimple(p)) throw new GeometryError(`${spec.name} ${what}: path self-intersects`);
    if (!(area(p) > 0)) throw new GeometryError(`${spec.name} ${what}: path is not counter-clockwise`);
  };
  check(spec.outline, 'outline');
  spec.holes.forEach((h, i) => check(h, `hole ${i}`));
  if (spec.bend) checkBend(spec.bend, spec.thickness);
}

/**
 * `finishPart` for generators. Checks the nominal outline and holes (closed, simple, CCW) and
 * throws GeometryError naming the part when they are broken, whatever the kerf: that is a
 * generator bug. A GeometryError from kerf compensation becomes a ParamError naming `kerf` only
 * when kerf > 0 and the same geometry survives a tiny probe kerf (so it is the kerf size that
 * closes a feature); otherwise the original error is rethrown. Generators use this, not finishPart.
 */
export function finishWithKerf(spec: Omit<Part, 'kerf' | 'nominal'>, kerf: number): Part {
  assertNominal(spec);
  try {
    return finishPart(spec, kerf);
  } catch (e) {
    if (!(e instanceof GeometryError) || !(kerf > PROBE_KERF)) throw e;
    try {
      applyKerf(spec.outline, spec.holes, PROBE_KERF);
    } catch {
      throw e;
    }
    throw new ParamError(`kerf ${kerf} mm is too large for ${spec.name}: it closes a gap or feature (${e.message})`, 'kerf');
  }
}

const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function placementNormal(pl: Placement): Vec3 {
  return cross3(pl.x, pl.y);
}

/** Part-local (p.x, p.y, z) to world. */
export function toWorld(pl: Placement, p: Vec2, z = 0): Vec3 {
  const n = placementNormal(pl);
  const o = pl.origin;
  const u = pl.x;
  const v = pl.y;
  return [o[0] + p.x * u[0] + p.y * v[0] + z * n[0], o[1] + p.x * u[1] + p.y * v[1] + z * n[1], o[2] + p.x * u[2] + p.y * v[2] + z * n[2]];
}

/** World to part-local [x, y, z] (assumes an orthonormal placement). */
export function toLocal(pl: Placement, w: Vec3): Vec3 {
  const d: Vec3 = [w[0] - pl.origin[0], w[1] - pl.origin[1], w[2] - pl.origin[2]];
  return [dot3(d, pl.x), dot3(d, pl.y), dot3(d, placementNormal(pl))];
}

// ---------------------------------------------------------------- bent parts

/** Local frame of a bent part at part-local x: world point of (x, 0, 0), tangent u, normal n (v is the placement's y). */
export type BendFrame = { p: Vec3; u: Vec3; n: Vec3 };

/**
 * One piece of a bent part along local x, valid for x0 <= x <= x1 (the first and last pieces are
 * unbounded outwards): flat, or an arc of z=0 radius `r`, sign `s` (+1 bends towards +n), turn
 * `th` (radians) about the axis through `c` (parallel to the placement's y). `f` is the frame at
 * local x = `xr` (x0, or 0 for the unbounded first piece).
 */
export type BendPiece = { x0: number; x1: number; xr: number; f: BendFrame; arc?: { r: number; s: 1 | -1; th: number; c: Vec3 } };

const add3 = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const lin3 = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]];

/** Throws Error when a bend is malformed (unsorted / overlapping arcs, non-finite values, radius too small for `thickness`). */
export function checkBend(b: Bend, thickness: number): void {
  if (!b || !Array.isArray(b.arcs)) throw new Error('bend: arcs must be an array');
  let end = -Infinity;
  b.arcs.forEach((a, i) => {
    const w = `bend arc ${i}`;
    if (![a.at, a.length, a.angle, a.radius].every(Number.isFinite)) throw new Error(`${w}: values must be finite`);
    if (!(a.length > 0)) throw new Error(`${w}: length must be > 0`);
    if (!(Math.abs(a.angle) > 1e-9 && Math.abs(a.angle) < 360)) throw new Error(`${w}: angle must satisfy 0 < |angle| < 360`);
    if (!(a.radius > 0) || (a.angle > 0 && !(a.radius > thickness)))
      throw new Error(`${w}: radius ${a.radius} too small (the inner face needs a positive radius)`);
    if (a.at < end - 1e-9) throw new Error(`${w}: arcs must be sorted by x and must not overlap`);
    end = a.at + a.length;
  });
}

const pieceCache = new WeakMap<Bend, { pl: Placement; pieces: BendPiece[] }>();

/** Frame of piece `pc` at local x (not clamped to the piece's range). */
export function pieceFrame(pc: BendPiece, x: number): BendFrame {
  if (!pc.arc) return { p: add3(pc.f.p, pc.f.u, x - pc.xr), u: pc.f.u, n: pc.f.n };
  const { r, s, th, c } = pc.arc;
  const phi = ((x - pc.x0) / (pc.x1 - pc.x0)) * th;
  const cs = Math.cos(phi);
  const sn = Math.sin(phi);
  const { u, n } = pc.f;
  return { p: add3(c, lin3(u, sn * r, n, -s * cs * r)), u: lin3(u, cs, n, s * sn), n: lin3(n, cs, u, -s * sn) };
}

/** The flat and arc pieces of a bent part, in increasing x (cached per bend object and placement). */
export function bendPieces(pl: Placement, b: Bend): BendPiece[] {
  const hit = pieceCache.get(b);
  if (hit && hit.pl === pl) return hit.pieces;
  const pieces: BendPiece[] = [];
  let flat: BendPiece = { x0: -Infinity, x1: Infinity, xr: 0, f: { p: pl.origin, u: pl.x, n: placementNormal(pl) } };
  for (const a of b.arcs) {
    flat.x1 = a.at;
    pieces.push(flat);
    const start = pieceFrame(flat, a.at);
    const s: 1 | -1 = a.angle > 0 ? 1 : -1;
    const arc: BendPiece = { x0: a.at, x1: a.at + a.length, xr: a.at, f: start,
      arc: { r: a.radius, s, th: (Math.abs(a.angle) * Math.PI) / 180, c: add3(start.p, start.n, s * a.radius) } };
    pieces.push(arc);
    flat = { x0: arc.x1, x1: Infinity, xr: arc.x1, f: pieceFrame(arc, arc.x1) };
  }
  pieces.push(flat);
  pieceCache.set(b, { pl, pieces });
  return pieces;
}

/** Index of the piece containing local x (boundaries go to the earlier piece). */
export function pieceAt(pieces: BendPiece[], x: number): number {
  for (let i = 0; i < pieces.length; i++) if (x <= pieces[i]!.x1) return i;
  return pieces.length - 1;
}

/** Frame at local x: world point of (x, 0, 0), tangent u and normal n (rigid parts: the placement). */
export function bendFrameAt(part: Pick<Part, 'placement' | 'bend'>, x: number): BendFrame {
  const pl = part.placement;
  if (!part.bend) return { p: add3(pl.origin, pl.x, x), u: pl.x, n: placementNormal(pl) };
  const pieces = bendPieces(pl, part.bend);
  return pieceFrame(pieces[pieceAt(pieces, x)]!, x);
}

/**
 * Part-local (p.x, p.y, z) to world for any part: `toWorld(placement, ...)` for rigid parts; for a
 * bent part frame.p + p.y * v + z * frame.n with the frame at p.x (v = placement.y). Inside an arc
 * the face at depth z lies on the circle of radius `radius - s z` about the arc's axis.
 */
export function partToWorld(part: Pick<Part, 'placement' | 'bend'>, p: Vec2, z = 0): Vec3 {
  if (!part.bend) return toWorld(part.placement, p, z);
  const f = bendFrameAt(part, p.x);
  const v = part.placement.y;
  return [f.p[0] + p.y * v[0] + z * f.n[0], f.p[1] + p.y * v[1] + z * f.n[1], f.p[2] + p.y * v[2] + z * f.n[2]];
}

/**
 * World to part-local candidates [x, y, z, piece index] for any part. Rigid parts: the single
 * `toLocal` result. Bent parts: one per piece whose x-range (+-eps) contains the point's position
 * along that piece; a world point can correspond to several pieces (e.g. both arms of a U), so
 * callers choose by z.
 */
export function partToLocal(part: Pick<Part, 'placement' | 'bend'>, w: Vec3, eps = 1e-9): [number, number, number, number][] {
  const pl = part.placement;
  if (!part.bend) return [[...toLocal(pl, w), 0]];
  const pieces = bendPieces(pl, part.bend);
  const y = dot3([w[0] - pl.origin[0], w[1] - pl.origin[1], w[2] - pl.origin[2]], pl.y);
  const out: [number, number, number, number][] = [];
  pieces.forEach((pc, i) => {
    if (!pc.arc) {
      const d: Vec3 = [w[0] - pc.f.p[0], w[1] - pc.f.p[1], w[2] - pc.f.p[2]];
      const x = pc.xr + dot3(d, pc.f.u);
      if (x >= pc.x0 - eps && x <= pc.x1 + eps) out.push([x, y, dot3(d, pc.f.n), i]);
      return;
    }
    const { r, s, th, c } = pc.arc;
    const d: Vec3 = [w[0] - c[0], w[1] - c[1], w[2] - c[2]];
    const a = dot3(d, pc.f.u);
    const b = dot3(d, pc.f.n);
    let phi = Math.atan2(a, -s * b);
    if (phi < -1e-12) phi += 2 * Math.PI;
    const x = pc.x0 + (phi / th) * (pc.x1 - pc.x0);
    if (x >= pc.x0 - eps && x <= pc.x1 + eps) out.push([x, y, s * (r - Math.hypot(a, b)), i]);
  });
  return out;
}
