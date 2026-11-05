/**
 * Invariants every generator's output must satisfy. Used by the per-generator registry loop and
 * the fuzz harness. Throws an Error with a descriptive message on the first violation.
 */
import { complement, type EdgeType } from '../../src/core/edges';
import { area, bounds, flatten, isSimple, type Path, type Vec2 } from '../../src/core/geometry';
import { checkHingeStrips } from '../../src/core/livinghinge';
import {
  applyKerf, bendPieces, checkBend, partToLocal, partToWorld, pieceAt, pieceFrame, placementNormal, toLocal, toWorld,
  type Part, type Placement, type Vec3,
} from '../../src/core/part';
import { effectiveKerf, type Params } from '../../src/core/schema';

/** Largest plausible part dimension (mm); anything bigger is treated as a blow-up. */
const MAX_DIM = 10_000;

function fail(msg: string): never {
  throw new Error(msg);
}

// ---------------------------------------------------------------- polygon helpers

/** Flattened closed polyline without the duplicated closing vertex. */
function ring(p: Path): Vec2[] {
  const pts = flatten(p);
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  return pts.length > 1 && Math.hypot(a.x - b.x, a.y - b.y) < 1e-9 ? pts.slice(0, -1) : pts;
}

function insideRing(pt: Vec2, r: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!;
    const b = r[j]!;
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function ringDist(p: Vec2, r: Vec2[]): number {
  let d = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist(p, r[j]!, r[i]!));
  return d;
}

const orient = (a: Vec2, b: Vec2, c: Vec2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Closed segments ab and cd intersect or touch. */
function segsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const e = 1e-9;
  const d1 = orient(a, b, c);
  const d2 = orient(a, b, d);
  const d3 = orient(c, d, a);
  const d4 = orient(c, d, b);
  if (((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) return true;
  const on = (p: Vec2, q: Vec2, r: Vec2, o: number): boolean => Math.abs(o) <= e
    && Math.min(p.x, q.x) - e <= r.x && r.x <= Math.max(p.x, q.x) + e
    && Math.min(p.y, q.y) - e <= r.y && r.y <= Math.max(p.y, q.y) + e;
  return on(a, b, c, d1) || on(a, b, d, d2) || on(c, d, a, d3) || on(c, d, b, d4);
}

function ringsTouch(r1: Vec2[], r2: Vec2[]): boolean {
  for (let i = 0, j = r1.length - 1; i < r1.length; j = i++)
    for (let k = 0, l = r2.length - 1; k < r2.length; l = k++)
      if (segsTouch(r1[j]!, r1[i]!, r2[l]!, r2[k]!)) return true;
  return false;
}

/**
 * Uniform grid over a region's boundary segments, with roughly square cells (the grid follows the
 * region's aspect ratio, so long thin parts such as dividers get many columns and few rows).
 * `inside` gives exactly the even-odd answer of `insideRing` per ring: a point within 1e-9 of a
 * boundary casts insideRing's ray along +x; any other point casts it along whichever of +x, -x,
 * +y, -y meets the fewest segment entries on its way out of the grid (away from the boundary the
 * parity of a ray's crossings does not depend on its direction), and only segments whose bounding
 * box meets those cells can cross it. `near(p, r)` is exactly "some boundary segment within
 * distance r" (only segments whose bounding box meets the query square can be that close). Turns
 * the per-sample O(n) scans of the assembly checks into near-constant work on finger outlines with
 * thousands of vertices.
 */
export class RegionIndex {
  private readonly segs: { a: Vec2; b: Vec2; ring: number }[] = [];
  private readonly rings: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly cw: number;
  private readonly ch: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly cells: number[][];
  private readonly stamp: Uint32Array;
  private readonly ringStamp: Uint32Array;
  private readonly ringOdd: Uint8Array;
  /** rowCum[r (nx + 1) + c]: entries in cells 0..c-1 of row r; colCum likewise per column. */
  private readonly rowCum: Int32Array;
  private readonly colCum: Int32Array;
  private gen = 0;

  constructor(rings: Vec2[][]) {
    this.rings = rings.length;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    rings.forEach((r, k) => {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        this.segs.push({ a: r[j]!, b: r[i]!, ring: k });
        x0 = Math.min(x0, r[i]!.x); x1 = Math.max(x1, r[i]!.x); y0 = Math.min(y0, r[i]!.y); y1 = Math.max(y1, r[i]!.y);
      }
    });
    const n = Math.max(1, this.segs.length);
    const w = Math.max(x1 - x0, 1e-9);
    const h = Math.max(y1 - y0, 1e-9);
    this.nx = Math.min(256, Math.max(1, Math.round(Math.sqrt((n * w) / h))));
    this.ny = Math.min(256, Math.max(1, Math.round(Math.sqrt((n * h) / w))));
    this.x0 = x0;
    this.y0 = y0;
    this.cw = (x1 - x0) / this.nx || 1;
    this.ch = (y1 - y0) / this.ny || 1;
    this.cells = Array.from({ length: this.nx * this.ny }, () => []);
    this.stamp = new Uint32Array(this.segs.length);
    this.ringStamp = new Uint32Array(this.rings);
    this.ringOdd = new Uint8Array(this.rings);
    this.segs.forEach((sg, id) => {
      const [c0, c1] = [this.col(Math.min(sg.a.x, sg.b.x)), this.col(Math.max(sg.a.x, sg.b.x))];
      const [r0, r1] = [this.row(Math.min(sg.a.y, sg.b.y)), this.row(Math.max(sg.a.y, sg.b.y))];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.nx + c]!.push(id);
    });
    this.rowCum = new Int32Array(this.ny * (this.nx + 1));
    this.colCum = new Int32Array(this.nx * (this.ny + 1));
    for (let r = 0; r < this.ny; r++) for (let c = 0; c < this.nx; c++) {
      const k = this.cells[r * this.nx + c]!.length;
      this.rowCum[r * (this.nx + 1) + c + 1] = this.rowCum[r * (this.nx + 1) + c]! + k;
      this.colCum[c * (this.ny + 1) + r + 1] = this.colCum[c * (this.ny + 1) + r]! + k;
    }
  }

  private col(x: number): number { return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / this.cw))); }
  private row(y: number): number { return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.y0) / this.ch))); }

  /** Inside the first ring (outline) and outside every other ring (holes), even-odd per ring. */
  inside(pt: Vec2): boolean {
    return this.insideFrom(pt, this.near(pt, 1e-9));
  }

  /** `inside` for a point known to be farther than `r` >= 1e-9 from every boundary (`near(pt, r)` false). */
  insideFar(pt: Vec2): boolean {
    return this.insideFrom(pt, false);
  }

  private insideFrom(pt: Vec2, onBoundary: boolean): boolean {
    const c = this.col(pt.x);
    const r = this.row(pt.y);
    // Segment entries in the cells to the grid edge along each ray: +x, -x, +y, -y (prefix sums per
    // row and column). A point (almost) on a boundary takes the +x ray, exactly as insideRing;
    // elsewhere every ray gives the same parity.
    const rc = this.rowCum;
    const cc = this.colCum;
    const nx1 = this.nx + 1;
    const ny1 = this.ny + 1;
    const cost = [rc[r * nx1 + this.nx]! - rc[r * nx1 + c]!, rc[r * nx1 + c + 1]!, cc[c * ny1 + this.ny]! - cc[c * ny1 + r]!, cc[c * ny1 + r + 1]!];
    const dir = onBoundary ? 0 : cost.indexOf(Math.min(...cost));
    if (++this.gen === 0xffffffff) { this.stamp.fill(0); this.ringStamp.fill(0); this.gen = 1; }
    const gen = this.gen;
    let outline = false;
    let oddHoles = 0; // holes the ray crossed an odd number of times
    const toggle = (k: number): void => {
      if (k === 0) { outline = !outline; return; }
      if (this.ringStamp[k] !== gen) { this.ringStamp[k] = gen; this.ringOdd[k] = 0; }
      this.ringOdd[k] = this.ringOdd[k]! ^ 1;
      oddHoles += this.ringOdd[k] ? 1 : -1;
    };
    const visit = (cell: number): void => {
      for (const id of this.cells[cell]!) {
        if (this.stamp[id] === gen) continue;
        this.stamp[id] = gen;
        const { a, b, ring: k } = this.segs[id]!;
        if (dir < 2) {
          if (a.y > pt.y === b.y > pt.y) continue;
          const x = ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
          if (dir === 0 ? pt.x < x : pt.x > x) toggle(k);
        } else {
          if (a.x > pt.x === b.x > pt.x) continue;
          const y = ((b.y - a.y) * (pt.x - a.x)) / (b.x - a.x) + a.y;
          if (dir === 2 ? pt.y < y : pt.y > y) toggle(k);
        }
      }
    };
    if (dir === 0) for (let i = c; i < this.nx; i++) visit(r * this.nx + i);
    else if (dir === 1) for (let i = c; i >= 0; i--) visit(r * this.nx + i);
    else if (dir === 2) for (let j = r; j < this.ny; j++) visit(j * this.nx + c);
    else for (let j = r; j >= 0; j--) visit(j * this.nx + c);
    return outline && oddHoles === 0;
  }

  /** Some boundary segment touches or crosses the closed segment ab (exactly `segsTouch` against every segment). */
  touchesSegment(a: Vec2, b: Vec2): boolean {
    const e = 1e-9;
    const c0 = this.col(Math.min(a.x, b.x) - e); const c1 = this.col(Math.max(a.x, b.x) + e);
    const r0 = this.row(Math.min(a.y, b.y) - e); const r1 = this.row(Math.max(a.y, b.y) + e);
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++)
      for (const id of this.cells[y * this.nx + x]!) {
        const sg = this.segs[id]!;
        if (segsTouch(a, b, sg.a, sg.b)) return true;
      }
    return false;
  }

  /** Some boundary segment lies within distance `r` of `p`. */
  near(p: Vec2, r: number): boolean {
    const c0 = this.col(p.x - r); const c1 = this.col(p.x + r);
    const r0 = this.row(p.y - r); const r1 = this.row(p.y + r);
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++)
      for (const id of this.cells[y * this.nx + x]!) {
        const { a, b } = this.segs[id]!;
        // Farther than r from the segment's bounding box means farther than r from the segment.
        if (p.x < Math.min(a.x, b.x) - r || p.x > Math.max(a.x, b.x) + r || p.y < Math.min(a.y, b.y) - r || p.y > Math.max(a.y, b.y) + r) continue;
        if (segDist(p, a, b) <= r) return true;
      }
    return false;
  }
}

type Region = { outline: Vec2[]; holes: Vec2[][]; index: RegionIndex };
const regionOf = (outline: Path, holes: Path[]): Region => {
  const o = ring(outline);
  const h = holes.map(ring);
  return { outline: o, holes: h, index: new RegionIndex([o, ...h]) };
};
/** Even-odd inside test (points on the boundary may go either way; combine with `near`). */
const inRegion = (p: Vec2, r: Region): boolean => r.index.inside(p);
/** In the region and farther than `m` from its boundary. */
const deepIn = (p: Vec2, r: Region, m: number): boolean => m >= 1e-9 ? !r.index.near(p, m) && r.index.insideFar(p) : r.index.inside(p) && !r.index.near(p, m);

// ---------------------------------------------------------------- assertValidParts

function pathFinite(p: Path): boolean {
  const ok = (v: Vec2): boolean => Number.isFinite(v.x) && Number.isFinite(v.y);
  return ok(p.start) && p.segs.every((s) => ok(s.to) && (s.t === 'L' || ok(s.c)));
}

function checkClosedPath(p: Path, what: string): void {
  if (!pathFinite(p)) fail(`${what}: coordinates must be finite (NaN/Infinity found)`);
  if (!p.closed) fail(`${what}: must be closed`);
  if (p.segs.length < 2) fail(`${what}: needs at least 2 segments`);
  if (!isSimple(p)) fail(`${what}: must be simple (self-intersection)`);
  if (!(area(p) > 0)) fail(`${what}: must be counter-clockwise with positive area`);
  const b = bounds(p);
  const w = b.max.x - b.min.x;
  const h = b.max.y - b.min.y;
  if (!(w > 0 && h > 0)) fail(`${what}: degenerate size ${w} x ${h}`);
  if (w > MAX_DIM || h > MAX_DIM) fail(`${what}: implausible size ${w} x ${h} mm`);
}

/** Outline + holes are each valid, holes strictly inside the outline and disjoint. */
function checkProfile(outline: Path, holes: Path[], what: string): void {
  checkClosedPath(outline, `${what} outline`);
  holes.forEach((h, i) => checkClosedPath(h, `${what} hole ${i}`));
  const r = regionOf(outline, holes);
  if (r.holes.length === 0) return;
  // Exactly the brute-force checks (every hole vertex inside the outline, no hole edge touching it,
  // no two holes touching or nested), with the outline in a grid index and hole pairs pruned by
  // bounding box (rings whose boxes are more than the touch tolerance apart can neither touch nor
  // contain each other): plates with thousands of slots stay fast.
  const out = new RegionIndex([r.outline]);
  const e = 1e-9;
  const box = r.holes.map((h) => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const v of h) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    return { x0, y0, x1, y1 };
  });
  r.holes.forEach((h, i) => {
    if (!h.every((v) => out.inside(v)) || h.some((v, k) => out.touchesSegment(h[(k + h.length - 1) % h.length]!, v)))
      fail(`${what} hole ${i}: must lie strictly inside the outline`);
  });
  const order = r.holes.map((_, i) => i).sort((a, b) => box[a]!.x0 - box[b]!.x0);
  for (let a = 0; a < order.length; a++) {
    const i = order[a]!;
    const bi = box[i]!;
    for (let c = a + 1; c < order.length; c++) {
      const j = order[c]!;
      const bj = box[j]!;
      if (bj.x0 > bi.x1 + e) break;
      if (bj.y0 > bi.y1 + e || bi.y0 > bj.y1 + e) continue;
      const h = r.holes[i]!;
      const o = r.holes[j]!;
      if (ringsTouch(h, o) || insideRing(h[0]!, o) || insideRing(o[0]!, h))
        fail(`${what} holes ${Math.min(i, j)} and ${Math.max(i, j)}: overlap`);
    }
  }
}

function checkPlacement(pl: Placement, what: string): void {
  const all = [...pl.origin, ...pl.x, ...pl.y];
  if (all.length !== 9 || !all.every(Number.isFinite)) fail(`${what} placement: must be 3 finite 3-vectors`);
  const d = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const tol = 1e-6;
  if (Math.abs(d(pl.x, pl.x) - 1) > tol || Math.abs(d(pl.y, pl.y) - 1) > tol || Math.abs(d(pl.x, pl.y)) > tol)
    fail(`${what} placement: x and y must be orthonormal`);
}

function samePath(a: Path, b: Path, tol: number): boolean {
  if (a.segs.length !== b.segs.length || a.closed !== b.closed) return false;
  const near = (p: Vec2, q: Vec2): boolean => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
  return near(a.start, b.start) && a.segs.every((s, i) => {
    const t = b.segs[i]!;
    return s.t === t.t && near(s.to, t.to) && (s.t === 'L' || (t.t === 'A' && near(s.c, t.c) && s.ccw === t.ccw));
  });
}

export type ValidOpts = {
  /**
   * Expected kerf applied to every part. Default: `effectiveKerf(params)` (kerf when burn is on, else
   * 0) when params has a numeric `kerf`; otherwise only internal consistency is checked.
   */
  kerf?: number;
  /**
   * Joint clearance (mm) allowed between a side's joint line and the nominal outline, on top of the
   * part thickness. Default: `params.play * params.thickness` when both are numbers, else 0.
   */
  play?: number;
};

/**
 * Angled finger joints (walls meeting at a corner other than 90 degrees). Square-cut fingers
 * cannot fill an oblique corner: where a play strip (the play/2 of a notch beside its finger)
 * crosses the corner, both walls are cut back and stand apart by up to ~0.5 * thickness in that
 * cross-section, although the finger's side face is only play/2 away along the joint. For these
 * mates (and play > 0) contact at a sample point may be found in the cross-sections up to `play`
 * along the joint line from it; with play 0 the check is exactly the one for other mates.
 */
const ANGLED_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>(['angledFinger', 'angledFingerHole']);

/** Edge types that do not form an interlocking joint and so may stay unmated. */
const PLAIN_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>(['flat', 'mitre', 'rounded']);

/**
 * The declared joint line must hug the nominal outline: every point of from->to within `slack` of
 * the outline boundary, and the line inside the outline's extent along its own direction (+slack).
 * Catches outlines that are shifted, too short or too narrow relative to their joint metadata.
 */
function checkJointLine(from: Vec2, to: Vec2, outline: Vec2[], slack: number, what: string, index = new RegionIndex([outline])): void {
  const L = Math.hypot(to.x - from.x, to.y - from.y);
  const d = { x: (to.x - from.x) / L, y: (to.y - from.y) / L };
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const q = { x: from.x + (to.x - from.x) * (i / N), y: from.y + (to.y - from.y) * (i / N) };
    if (index.near(q, slack)) continue; // exactly ringDist(q, outline) <= slack
    const dist = ringDist(q, outline);
    if (dist > slack) fail(`${what}: joint line is ${dist.toFixed(3)} mm from the nominal outline (max ${slack.toFixed(3)})`);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of outline) {
    const t = (v.x - from.x) * d.x + (v.y - from.y) * d.y;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  if (lo > slack || hi < L - slack)
    fail(`${what}: joint line [0, ${L.toFixed(3)}] extends beyond the nominal outline extent [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
}

/**
 * Interior joint (a slot row in the middle of a plate): the joint line is declared against the
 * part's holes `idx` instead of its outline. Every referenced hole must lie within `slack` of the
 * line (perpendicular distance) and inside its span (+slack) along it, so the slots hug the line
 * and do not run past its ends. The line's own length is pinned by the mate: it must coincide in
 * world space with the partner's line, which is checked against the partner's outline; contact
 * at 25/50/75 % then requires this part's material (beside or between the slots) at the joint.
 */
function checkHoleJointLine(from: Vec2, to: Vec2, idx: number[], holes: Path[], slack: number, what: string): void {
  if (!Array.isArray(idx) || idx.length === 0) fail(`${what}: interior joint must reference at least one hole`);
  const L = Math.hypot(to.x - from.x, to.y - from.y);
  const d = { x: (to.x - from.x) / L, y: (to.y - from.y) / L };
  for (const i of idx) {
    if (!(Number.isInteger(i) && i >= 0 && i < holes.length)) fail(`${what}: references missing hole ${String(i)}`);
    for (const v of ring(holes[i]!)) {
      const dist = segDist(v, from, to);
      const t = (v.x - from.x) * d.x + (v.y - from.y) * d.y;
      if (dist > slack || t < -slack || t > L + slack)
        fail(`${what}: hole ${i} lies ${dist.toFixed(3)} mm from the joint line (max ${slack.toFixed(3)}) or beyond its ends`);
    }
  }
}

/**
 * Per-part invariants: unique ids; finite, closed, simple, CCW outlines and holes of plausible size;
 * holes strictly inside and mutually disjoint; thickness equals params.thickness (when present);
 * orthonormal placement; kerf equals the expected kerf AND outline/holes equal applyKerf(nominal);
 * edge entries well formed with mates pointing at existing part sides; joint edges (not
 * flat/mitre/rounded) mated or explicitly `open`; every side's joint line within
 * thickness + play (+0.01) of the nominal outline and inside the outline's extent along the line,
 * or, for an interior joint (`holes` set), its referenced holes hugging the line.
 */
export function assertValidParts(parts: Part[], p: Params, opts: ValidOpts = {}): void {
  if (!Array.isArray(parts) || parts.length === 0) fail('generator returned no parts');
  const expectedKerf = opts.kerf ?? (typeof p.kerf === 'number' ? effectiveKerf(p) : undefined);
  const play = opts.play ?? (typeof p.play === 'number' && typeof p.thickness === 'number' ? p.play * p.thickness : 0);
  const ids = new Set<string>();
  for (const part of parts) {
    if (typeof part.id !== 'string' || part.id === '') fail('part id must be a non-empty string');
    if (ids.has(part.id)) fail(`duplicate part id "${part.id}"`);
    ids.add(part.id);
  }
  const byId = new Map(parts.map((x) => [x.id, x]));
  for (const part of parts) {
    const w = `part ${part.id}`;
    if (typeof part.name !== 'string' || part.name === '') fail(`${w}: name must be non-empty`);
    if (!(Number.isFinite(part.thickness) && part.thickness > 0)) fail(`${w}: thickness must be > 0, got ${part.thickness}`);
    if (typeof p.thickness === 'number' && Math.abs(part.thickness - p.thickness) > 1e-9)
      fail(`${w}: thickness ${part.thickness} differs from params.thickness ${p.thickness}`);
    checkPlacement(part.placement, w);
    if (part.bend !== undefined) {
      try { checkBend(part.bend, part.thickness); } catch (e) { fail(`${w}: ${(e as Error).message}`); }
      // Every bend is a living hinge: its strip must be (inner-face arc) / stretch. Independent of
      // the assembly checks, which map any strip length uniformly onto the arc and so cannot see it.
      try { checkHingeStrips(part.bend, part.thickness); } catch (e) { fail(`${w}: ${(e as Error).message}`); }
    }
    checkProfile(part.outline, part.holes, w);
    checkProfile(part.nominal.outline, part.nominal.holes, `${w} nominal`);
    part.engrave.forEach((e, i) => { if (!pathFinite(e)) fail(`${w} engrave ${i}: coordinates must be finite`); });

    if (!(Number.isFinite(part.kerf) && part.kerf >= 0)) fail(`${w}: kerf must be >= 0, got ${part.kerf}`);
    if (expectedKerf !== undefined && Math.abs(part.kerf - expectedKerf) > 1e-9)
      fail(`${w}: kerf ${part.kerf} applied, expected ${expectedKerf}`);
    const k = applyKerf(part.nominal.outline, part.nominal.holes, part.kerf);
    if (!samePath(k.outline, part.outline, 1e-6) || k.holes.length !== part.holes.length
      || !k.holes.every((h, i) => samePath(h, part.holes[i]!, 1e-6)))
      fail(`${w}: kerf: outline/holes are not the nominal geometry offset by kerf/2 (kerf ${part.kerf})`);

    let ringCache: Vec2[] | undefined;
    let indexCache: RegionIndex | undefined;
    const outlineRing = (): Vec2[] => (ringCache ??= ring(part.nominal.outline));
    const outlineIndex = (): RegionIndex => (indexCache ??= new RegionIndex([outlineRing()]));
    const sides = new Set<number>();
    for (const e of part.edges) {
      const we = `${w} side ${e.side}`;
      if (!(Number.isInteger(e.side) && e.side >= 0)) fail(`${we}: side must be a non-negative integer`);
      if (sides.has(e.side)) fail(`${we}: duplicate side`);
      sides.add(e.side);
      if (complement(e.type as EdgeType) === undefined) fail(`${we}: unknown edge type ${String(e.type)}`);
      if (![e.from.x, e.from.y, e.to.x, e.to.y].every(Number.isFinite)) fail(`${we}: from/to must be finite`);
      if (Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y) < 1e-9) fail(`${we}: from and to coincide`);
      if (e.holes !== undefined) checkHoleJointLine(e.from, e.to, e.holes, part.nominal.holes, part.thickness + play + 0.01, we);
      else checkJointLine(e.from, e.to, outlineRing(), part.thickness + play + 0.01, we, outlineIndex());
      if (e.face !== undefined) {
        if (e.face !== 'inner') fail(`${we}: face must be 'inner' when set, got ${String(e.face)}`);
        if (e.type !== 'flat' || e.holes !== undefined) fail(`${we}: only a flat outline line may lie on the inner face`);
        if (part.bend) fail(`${we}: a bent part's joint lines lie on its z=0 face`);
      }
      if (e.open && e.mate) fail(`${we}: an open edge must not have a mate`);
      if (!e.mate && !e.open && !PLAIN_EDGES.has(e.type))
        fail(`${we}: joint edge ${e.type} needs a mate (or open: true)`);
      if (e.mate) {
        const o = byId.get(e.mate.part);
        if (!o) fail(`${we}: mate references unknown part "${e.mate.part}"`);
        if (!o.edges.some((x) => x.side === e.mate!.side)) fail(`${we}: mate references missing side ${e.mate.side} of ${o.id}`);
      }
    }
  }
}

// ---------------------------------------------------------------- assertAssembly

export type AssemblyOpts = {
  /** Max distance between mating endpoints, and max contact gap at a mate, in world space (mm). Default 0.01. */
  tol?: number;
  /** Clearance treated as contact rather than overlap when sampling (mm). Default 0.005. */
  margin?: number;
  /** Expected world bbox extents of the nominal assembly (mm), checked within `tol`. */
  expectedSize?: { x: number; y: number; z: number };
  /**
   * Joint clearance (mm) the user asked for (`params.play * params.thickness`): a mate may show a
   * contact gap of up to `tol + play` (e.g. a finger in a slot that is `play` wider than the
   * material). Default 0. Interpenetration is unaffected.
   */
  play?: number;
  /**
   * Parts need not be connected through mates (a generator with `assembly: 'loose'`, e.g. a
   * meshing gear pair or a stack of plates). Every other check still applies.
   */
  loose?: boolean;
};

/** Assembly options for validated generator params: play from params, plus an optional expected size. */
export function assemblyOpts(p: Params, expectedSize?: { x: number; y: number; z: number }, loose = false): AssemblyOpts {
  const play = typeof p.play === 'number' && typeof p.thickness === 'number' ? p.play * p.thickness : 0;
  return { play, ...(expectedSize ? { expectedSize } : {}), ...(loose ? { loose } : {}) };
}

type Solid = { part: Part; region: Region; min: Vec3; max: Vec3; b2: { min: Vec2; max: Vec2 } };

/** Max sagitta (mm) of the chords `bentRing` uses for arcs. */
const BEND_SAGITTA = 1e-4;

/**
 * A bent part's outline ring with extra vertices wherever an edge crosses one of the x positions
 * that subdivide its arcs into chords of sagitta <= BEND_SAGITTA (at every radius through the
 * thickness), so the ring mapped through the bend follows the curved faces to within that.
 */
function bentRing(part: Part, r: Vec2[]): Vec2[] {
  const cuts: number[] = [];
  for (const a of part.bend!.arcs) {
    const th = (Math.abs(a.angle) * Math.PI) / 180;
    const rMax = a.radius + (a.angle < 0 ? part.thickness : 0);
    const n = Math.max(4, Math.ceil(th / Math.sqrt((8 * BEND_SAGITTA) / rMax)));
    for (let k = 0; k <= n; k++) cuts.push(a.at + (k / n) * a.length);
  }
  cuts.sort((p, q) => p - q);
  const out: Vec2[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    out.push(a);
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    if (hi - lo < 1e-12) continue;
    let k0 = 0;
    let k1 = cuts.length;
    while (k0 < k1) { const mid = (k0 + k1) >> 1; if (cuts[mid]! <= lo) k0 = mid + 1; else k1 = mid; }
    const inner: number[] = [];
    for (let k = k0; k < cuts.length && cuts[k]! < hi; k++) inner.push(cuts[k]!);
    if (b.x < a.x) inner.reverse();
    for (const x of inner) out.push({ x, y: a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y) });
  }
  return out;
}

function solidOf(part: Part): Solid {
  const region = regionOf(part.nominal.outline, part.nominal.holes);
  const b2 = bounds(part.nominal.outline);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (w: Vec3, pad = 0): void => {
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]! - pad); max[i] = Math.max(max[i]!, w[i]! + pad); }
  };
  if (part.bend) {
    // The region's world image lies within the mapped (subdivided) outline at z = 0 and thickness,
    // up to the chords' sagitta: for fixed x the mapping is affine in (y, z).
    for (const p of bentRing(part, region.outline)) for (const z of [0, part.thickness]) grow(partToWorld(part, p, z), BEND_SAGITTA + 1e-9);
    return { part, region, min, max, b2 };
  }
  for (const x of [b2.min.x, b2.max.x]) for (const y of [b2.min.y, b2.max.y]) for (const z of [0, part.thickness]) grow(toWorld(part.placement, { x, y }, z));
  return { part, region, min, max, b2 };
}

/** Interior sample points (local 2D) at least `m` from the boundary: a grid plus an inner band along every edge. */
function samples2D(s: Solid, m: number): Vec2[] {
  const { min, max } = s.b2;
  const step = Math.max(Math.max(max.x - min.x, max.y - min.y) / 40, 1e-3);
  const out: Vec2[] = [];
  const keep = (p: Vec2): void => { if (deepIn(p, s.region, m)) out.push(p); };
  for (let x = min.x + step / 2; x < max.x; x += step) for (let y = min.y + step / 2; y < max.y; y += step) keep({ x, y });
  const depths = [...new Set([2 * m, s.part.thickness / 2, step / 2])];
  const band = (r: Vec2[], solidOnLeft: boolean): void => {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j]!;
      const b = r[i]!;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l < 1e-9) continue;
      const sg = solidOnLeft ? 1 : -1;
      const n = { x: (-(b.y - a.y) / l) * sg, y: ((b.x - a.x) / l) * sg };
      const cnt = Math.max(1, Math.ceil(l / step));
      for (let k = 0; k < cnt; k++) {
        const t = (k + 0.5) / cnt;
        for (const d of depths) keep({ x: a.x + t * (b.x - a.x) + d * n.x, y: a.y + t * (b.y - a.y) + d * n.y });
      }
    }
  };
  const ccw = (r: Vec2[]): boolean => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]!.x * r[i]!.y - r[i]!.x * r[j]!.y;
    return a > 0;
  };
  band(s.region.outline, ccw(s.region.outline));
  for (const h of s.region.holes) band(h, !ccw(h));
  return out;
}

/**
 * `memo` (with slot `k`) caches the in-plane test for points that share their position in s's plane:
 * the depth samples of one 2D sample of a part parallel to s (see assertAssembly).
 */
function strictlyInside(w: Vec3, s: Solid, m: number, memo?: Int8Array, k = 0): boolean {
  for (let i = 0; i < 3; i++) if (w[i]! <= s.min[i]! + m || w[i]! >= s.max[i]! - m) return false;
  if (s.part.bend) {
    // Inside some piece of the bent prism: the point's local position along that piece.
    for (const [x, y, z] of partToLocal(s.part, w)) {
      if (!(z > m && z < s.part.thickness - m)) continue;
      if (x <= s.b2.min.x || x >= s.b2.max.x || y <= s.b2.min.y || y >= s.b2.max.y) continue;
      if (deepIn({ x, y }, s.region, m)) return true;
    }
    return false;
  }
  const [x, y, z] = toLocal(s.part.placement, w);
  if (!(z > m && z < s.part.thickness - m)) return false;
  // Outside the outline's 2D bounding box a point cannot be in the region.
  if (x <= s.b2.min.x || x >= s.b2.max.x || y <= s.b2.min.y || y >= s.b2.max.y) return false;
  if (memo) {
    if (memo[k] === 0) memo[k] = deepIn({ x, y }, s.region, m) ? 1 : 2;
    return memo[k] === 1;
  }
  return deepIn({ x, y }, s.region, m);
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Exact cross-section of a part's nominal prism by the plane through `s` perpendicular to `dir`,
 * restricted to within R of `s`, as convex quads in plane coordinates (e1, e2) relative to `s`.
 * `dir` lies in the part's plane (a joint line is drawn in part-local 2D at z=0), so the section is
 * the part's 2D region cut by the line through s's projection perpendicular to dir (a set of
 * intervals, boundary included), extruded over 0 <= z <= thickness.
 */
function section(sol: Solid, s: Vec3, dir: Vec3, e1: Vec3, e2: Vec3, R: number): Vec2[][] {
  const pl = sol.part.placement;
  // Local frame at s: rigid parts the placement; bent parts the piece through s (see sectionFrame).
  const { sx, sy, sz, U, n, lo: rlo, hi: rhi, inArc } = sectionFrame(sol, s);
  const V = pl.y;
  const dl = Math.hypot(dot3(dir, U), dot3(dir, V));
  if (!(dl > 0.99)) fail(`joint line direction is not in the plane of part ${sol.part.id} (in-plane component ${dl})`);
  const d = { x: dot3(dir, U) / dl, y: dot3(dir, V) / dl };
  if (inArc && Math.abs(d.y) > 1e-6)
    fail(`joint line crosses a bend of part ${sol.part.id} off the bending direction (only lines along local x may run through a bend)`);
  const q = { x: -d.y, y: d.x }; // in-plane direction across the joint line
  // A bent part's section stays in the piece through s (one plane); beyond it is not counted.
  let lo = -R;
  let hi = R;
  if (Math.abs(q.x) > 1e-12) {
    const r0 = (rlo - sx) / q.x;
    const r1 = (rhi - sx) / q.x;
    lo = Math.max(lo, Math.min(r0, r1));
    hi = Math.min(hi, Math.max(r0, r1));
  }
  if (!(hi > lo)) return [];
  const along = (v: Vec2): number => (v.x - sx) * d.x + (v.y - sy) * d.y;
  const across = (v: Vec2): number => (v.x - sx) * q.x + (v.y - sy) * q.y;
  const rs = [lo, hi];
  for (const r of [sol.region.outline, ...sol.region.holes])
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j]!;
      const b = r[i]!;
      const da = along(a);
      const db = along(b);
      if (da === 0 && db === 0) rs.push(across(a), across(b));
      else if (Math.min(da, db) <= 0 && Math.max(da, db) >= 0) rs.push(across(a) + (da / (da - db)) * (across(b) - across(a)));
    }
  const cuts = [...new Set(rs.filter((r) => r >= lo && r <= hi))].sort((x, y) => x - y);
  const intervals: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const lo = cuts[i]!;
    const hi = cuts[i + 1]!;
    const m = (lo + hi) / 2;
    const p = { x: sx + m * q.x, y: sy + m * q.y };
    if (!(inRegion(p, sol.region) || sol.region.index.near(p, 1e-9))) continue;
    const last = intervals[intervals.length - 1];
    if (last && last[1] === lo) last[1] = hi;
    else intervals.push([lo, hi]);
  }
  const qW: Vec3 = [0, 1, 2].map((i) => q.x * U[i]! + q.y * V[i]!) as Vec3;
  const corner = (r: number, z: number): Vec2 => {
    const off: Vec3 = [0, 1, 2].map((i) => r * qW[i]! + (z - sz) * n[i]!) as Vec3;
    return { x: dot3(off, e1), y: dot3(off, e2) };
  };
  const t = sol.part.thickness;
  return intervals.map(([lo, hi]) => [corner(lo, 0), corner(hi, 0), corner(hi, t), corner(lo, t)]);
}

/**
 * Local frame for `section`: s in part-local coordinates, the in-plane x direction U and normal n
 * there, and the local x-range [lo, hi] of the plane piece through s. Rigid parts: the placement,
 * unbounded. Bent parts: the piece (flat span or arc) whose z=0 face is closest to s; a flat piece
 * is one plane over its x-range, an arc only along a line x = const (`inArc`).
 */
function sectionFrame(sol: Solid, s: Vec3): { sx: number; sy: number; sz: number; U: Vec3; n: Vec3; lo: number; hi: number; inArc: boolean } {
  const pl = sol.part.placement;
  if (!sol.part.bend) {
    const [sx, sy, sz] = toLocal(pl, s);
    return { sx, sy, sz, U: pl.x, n: cross3(pl.x, pl.y), lo: -Infinity, hi: Infinity, inArc: false };
  }
  // Pieces are unbounded outwards at both ends, so a closed loop (a wall wrapped all the way
  // round) maps a point on both end pieces: keep the candidates within the outline's x-extent.
  const all = partToLocal(sol.part, s, 1e-6);
  const within = all.filter((c) => c[0] >= sol.b2.min.x - 1e-6 && c[0] <= sol.b2.max.x + 1e-6);
  const cands = within.length ? within : all;
  if (cands.length === 0) fail(`joint point is outside every piece of bent part ${sol.part.id}`);
  const [sx, sy, sz, k] = cands.reduce((a, b) => (Math.abs(b[2]) < Math.abs(a[2]) ? b : a));
  const pc = bendPieces(pl, sol.part.bend)[k]!;
  const f = pieceFrame(pc, sx);
  return { sx, sy, sz, U: f.u, n: f.n, lo: pc.x0, hi: pc.x1, inArc: pc.arc !== undefined };
}

/** Distance between two convex polygons (0 when they touch or overlap). */
function convexGap(P: Vec2[], Q: Vec2[]): number {
  const separated = (A: Vec2[], B: Vec2[]): boolean => A.some((a, i) => {
    const b = A[(i + 1) % A.length]!;
    const ax = { x: -(b.y - a.y), y: b.x - a.x };
    const pa = A.map((v) => v.x * ax.x + v.y * ax.y);
    const pb = B.map((v) => v.x * ax.x + v.y * ax.y);
    return Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa);
  });
  if (!separated(P, Q) && !separated(Q, P)) return 0;
  let g = Infinity;
  for (const [A, B] of [[P, Q], [Q, P]] as const)
    for (const v of A) for (let i = 0; i < B.length; i++) g = Math.min(g, segDist(v, B[i]!, B[(i + 1) % B.length]!));
  return g;
}

/**
 * Smallest gap between solids A and B in the plane through `s` perpendicular to `dir`, within
 * radius R of `s`: computed exactly from both parts' cross-sections in that plane (unions of
 * rectangles). Distances are measured in the plane only, so material just beside the plane (e.g. a
 * finger side 0.5 mm along the joint) neither counts as contact nor hides contact in the plane.
 */
function localGap(a: Solid, b: Solid, s: Vec3, dir: Vec3, R: number): number {
  const helper: Vec3 = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = norm3(cross3(dir, helper));
  const e2 = cross3(dir, e1);
  const sa = section(a, s, dir, e1, e2, R);
  const sb = section(b, s, dir, e1, e2, R);
  let best = Infinity;
  for (const P of sa) for (const Q of sb) best = Math.min(best, convexGap(P, Q));
  return best;
}

/**
 * World polyline of the part-local joint line from -> to: its two ends for a rigid part; on a bent
 * part also a vertex wherever it crosses a piece boundary or an arc subdivision (chord sagitta
 * <= BEND_SAGITTA), so it follows the bend.
 */
function jointCurve(part: Part, from: Vec2, to: Vec2): Vec3[] {
  if (!part.bend) return [toWorld(part.placement, from), toWorld(part.placement, to)];
  const ring = bentRing(part, [from, to]); // from, crossings, to, crossings back
  const k = ring.findIndex((q, i) => i > 0 && q.x === to.x && q.y === to.y);
  return ring.slice(0, k < 0 ? ring.length : k + 1).map((q) => partToWorld(part, q));
}

/** Distance from p to the polyline c. */
function polyDist(p: Vec3, c: Vec3[]): number {
  if (c.length === 1) return Math.hypot(p[0] - c[0]![0], p[1] - c[0]![1], p[2] - c[0]![2]);
  let best = Infinity;
  for (let i = 0; i + 1 < c.length; i++) {
    const a = c[i]!;
    const ab = sub3(c[i + 1]!, a);
    const ap = sub3(p, a);
    const l2 = dot3(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot3(ap, ab) / l2)) : 0;
    best = Math.min(best, Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]));
  }
  return best;
}

/** World point and unit tangent of a bent part's joint line from -> to at fraction `frac` (local 2D). */
function jointPoint(part: Part, from: Vec2, to: Vec2, frac: number): [Vec3, Vec3] {
  const q = { x: from.x + frac * (to.x - from.x), y: from.y + frac * (to.y - from.y) };
  const pieces = bendPieces(part.placement, part.bend!);
  const pc = pieces[pieceAt(pieces, q.x)]!;
  const f = pieceFrame(pc, q.x);
  // d(world)/d(local x) at z = 0 is u scaled by the arc's (z=0 length) / (flat length).
  const sx = pc.arc ? (pc.arc.r * pc.arc.th) / (pc.x1 - pc.x0) : 1;
  const v = part.placement.y;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const t: Vec3 = [0, 1, 2].map((i) => dx * sx * f.u[i]! + dy * v[i]!) as Vec3;
  return [partToWorld(part, q), norm3(t)];
}

/** World bbox extents of the nominal assembly (exact for axis-aligned placements). */
function assemblySize(solids: Solid[]): { x: number; y: number; z: number } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) {
    if (s.part.bend) {
      // Exact up to the chords' sagitta (BEND_SAGITTA): for fixed x the mapping is affine in (y, z).
      for (const p of bentRing(s.part, s.region.outline)) for (const z of [0, s.part.thickness]) {
        const w = partToWorld(s.part, p, z);
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
      }
      continue;
    }
    const axisAligned = [s.part.placement.x, s.part.placement.y].every((v) => v.some((c) => Math.abs(Math.abs(c) - 1) < 1e-12));
    const pts2: Vec2[] = axisAligned
      ? [s.b2.min, s.b2.max, { x: s.b2.min.x, y: s.b2.max.y }, { x: s.b2.max.x, y: s.b2.min.y }]
      : s.region.outline;
    for (const p of pts2) for (const z of [0, s.part.thickness]) {
      const w = toWorld(s.part.placement, p, z);
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, w[i]!); max[i] = Math.max(max[i]!, w[i]!); }
    }
  }
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
}

/**
 * Assembly invariants on nominal (pre-kerf) geometry:
 *  - mates are mutual, complementary (`complement(a) === b`), and their from/to lines coincide in
 *    world space within `tol` (either direction; a line with `face: 'inner'` on the inner face);
 *  - contact: at 25/50/75 % along every mate line the two parts' prisms touch (local gap <= tol,
 *    plus the requested joint `play`) in the cross-section plane, so a part whose thickness points away from the joint fails
 *    (angled finger mates with play: in a cross-section within `play` along the line, see ANGLED_EDGES);
 *  - all parts are connected through mates (unless `loose`);
 *  - no part's interior (sampled on a grid and in a band along every edge, at several depths)
 *    lies strictly inside another part's extruded prism by more than `margin`;
 *  - optional `expectedSize`: world bbox extents within `tol`.
 */
export function assertAssembly(parts: Part[], opts: AssemblyOpts = {}): void {
  const tol = opts.tol ?? 0.01;
  const m = opts.margin ?? 0.005;
  const play = opts.play ?? 0;
  if (!(Number.isFinite(play) && play >= 0)) fail(`assembly play must be a finite number >= 0, got ${play}`);
  const byId = new Map(parts.map((x) => [x.id, x]));
  const solids = parts.map(solidOf);
  const solidById = new Map(solids.map((x) => [x.part.id, x]));
  const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const adj = new Map<string, Set<string>>(parts.map((x) => [x.id, new Set<string>()]));
  for (const part of parts) {
    for (const e of part.edges) {
      if (!e.mate) continue;
      const w = `mate ${part.id}:${e.side} -> ${e.mate.part}:${e.mate.side}`;
      const o = byId.get(e.mate.part);
      const oe = o?.edges.find((x) => x.side === e.mate!.side);
      if (!o || !oe) fail(`${w}: target side does not exist`);
      if (oe.mate?.part !== part.id || oe.mate.side !== e.side) fail(`${w}: mate is not mutual`);
      if (complement(e.type) !== oe.type) fail(`${w}: ${e.type} is not the complement of ${oe.type}`);
      // Lines on the inner face (PartEdge.face) lie one thickness along the normal.
      const za = e.face === 'inner' ? part.thickness : 0;
      const zb = oe.face === 'inner' ? o.thickness : 0;
      const a0 = partToWorld(part, e.from, za);
      const a1 = partToWorld(part, e.to, za);
      const b0 = partToWorld(o, oe.from, zb);
      const b1 = partToWorld(o, oe.to, zb);
      const err = Math.min(Math.max(dist(a0, b0), dist(a1, b1)), Math.max(dist(a0, b1), dist(a1, b0)));
      if (!(err <= tol)) fail(`${w}: joint lines differ by ${err.toFixed(4)} mm in world space (tol ${tol})`);
      // On a bent part a joint line may map to a curve (through an arc): the two world curves must
      // coincide, not just their ends.
      if (part.bend || o.bend) {
        const ca = jointCurve(part, e.from, e.to);
        const cb = jointCurve(o, oe.from, oe.to);
        const h = Math.max(...ca.map((q) => polyDist(q, cb)), ...cb.map((q) => polyDist(q, ca)));
        if (!(h <= tol)) fail(`${w}: joint lines differ by ${h.toFixed(4)} mm in world space along the bend (tol ${tol})`);
      }
      adj.get(part.id)!.add(o.id);
      if (part.id < o.id) {
        const sa = solidById.get(part.id)!;
        const sb = solidById.get(o.id)!;
        const R = part.thickness + o.thickness + 1;
        const offsets = play > 0 && ANGLED_EDGES.has(e.type) ? [0, -play, play] : [0];
        for (const frac of [0.25, 0.5, 0.75]) {
          // Point and tangent of the joint line at `frac` (on a bent part, through its bend).
          const [s, dir] = part.bend ? jointPoint(part, e.from, e.to, frac)
            : [[0, 1, 2].map((i) => a0[i]! + frac * (a1[i]! - a0[i]!)) as Vec3, norm3(sub3(a1, a0))];
          const gap = Math.min(...offsets.map((d) => localGap(sa, sb, [0, 1, 2].map((i) => s[i]! + d * dir[i]!) as Vec3, dir, R)));
          if (!(gap <= tol + play)) fail(`${w}: no contact at ${frac * 100}% of the joint line (gap ${gap.toFixed(4)} mm, allowed ${(tol + play).toFixed(4)})`);
        }
      }
    }
  }

  if (parts.length > 1 && !opts.loose) {
    const seen = new Set<string>([parts[0]!.id]);
    const queue = [parts[0]!.id];
    while (queue.length) for (const n of adj.get(queue.shift()!)!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    const lone = parts.filter((x) => !seen.has(x.id)).map((x) => x.id);
    if (lone.length) fail(`assembly is not connected through mates: ${lone.join(', ')} unreachable from ${parts[0]!.id}`);
  }

  for (const a of solids) {
    const t = a.part.thickness;
    const zs = [...new Set([2 * m, t / 4, t / 2, (3 * t) / 4, t - 2 * m])].filter((z) => z > m && z < t - m);
    const others = solids.filter((b) => b !== a
      && [0, 1, 2].every((i) => a.min[i]! < b.max[i]! - m && b.min[i]! < a.max[i]! - m));
    if (others.length === 0) continue;
    // World points of the samples at every depth, on flat coordinate arrays (sample-major):
    // strictlyInside rejects any point outside b's open bbox (shrunk by m), so pre-filter on those
    // before the full test.
    const pts2 = samples2D(a, m);
    const nz = zs.length;
    const W = pts2.length * nz;
    const cx = new Float64Array(W); const cy = new Float64Array(W); const cz = new Float64Array(W);
    pts2.forEach((p, i) => zs.forEach((z, j) => {
      const w = partToWorld(a.part, p, z);
      cx[i * nz + j] = w[0]; cy[i * nz + j] = w[1]; cz[i * nz + j] = w[2];
    }));
    // A part parallel to `a` (e.g. a disc turning in a ring of the wall it lies in) sees every depth
    // sample of one 2D sample at the same in-plane point (up to rounding), so its 2D test runs once
    // per 2D sample instead of once per depth.
    const na = placementNormal(a.part.placement);
    for (const b of others) {
      const memo = !a.part.bend && !b.part.bend && Math.abs(dot3(na, placementNormal(b.part.placement))) > 1 - 1e-12 ? new Int8Array(pts2.length) : undefined;
      const x0 = b.min[0]! + m; const x1 = b.max[0]! - m;
      const y0 = b.min[1]! + m; const y1 = b.max[1]! - m;
      const z0 = b.min[2]! + m; const z1 = b.max[2]! - m;
      for (let k = 0; k < W; k++) {
        const x = cx[k]!; const y = cy[k]!; const z = cz[k]!;
        if (x <= x0 || x >= x1 || y <= y0 || y >= y1 || z <= z0 || z >= z1) continue;
        const w: Vec3 = [x, y, z];
        if (strictlyInside(w, b, m, memo, Math.floor(k / nz)))
          fail(`parts ${a.part.id} and ${b.part.id} interpenetrate near world (${w.map((v) => v.toFixed(2)).join(', ')})`);
      }
    }
  }

  if (opts.expectedSize) {
    const got = assemblySize(solids);
    for (const k of ['x', 'y', 'z'] as const)
      if (!(Math.abs(got[k] - opts.expectedSize[k]) <= tol))
        fail(`assembly size ${k} is ${got[k].toFixed(4)} mm, expected ${opts.expectedSize[k]} (tol ${tol})`);
  }
}
