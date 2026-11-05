/**
 * Where to write a part's name on the cut sheet: the pole of inaccessibility of the part's
 * material (outline minus holes, slits and engraved marks), i.e. the centre of the largest circle
 * that fits in it, and the largest label of a given aspect ratio that fits there without touching
 * a cut or an engraving. A bounding-box centre lands on slots, in holes, or outside a slanted edge.
 *
 * The pole uses the cell-subdivision search of Mapbox's polylabel (ISC licence; algorithm only):
 * square cells with a priority queue ordered by the best distance a cell could still contain.
 */
import { flatten, type Path, type Vec2 } from '../../core/geometry';

export type LabelSpot = {
  /** Centre of the label (and of the largest inscribed circle), in the input coordinates. */
  x: number;
  y: number;
  /** Radius of the largest inscribed circle. */
  r: number;
  /**
   * Height of the largest box of the requested aspect (width / height) centred on (x, y) that fits
   * in the material; 0 when nothing fits.
   */
  h: number;
};

type Seg = [number, number, number, number];

/** Distance from (x, y) to the segment s. */
function segDist(x: number, y: number, s: Seg): number {
  const [ax, ay, bx, by] = s;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function segments(pts: Vec2[], closed: boolean): Seg[] {
  const out: Seg[] = [];
  const n = pts.length;
  for (let i = 0; i + 1 < n + (closed ? 1 : 0); i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    if (a.x !== b.x || a.y !== b.y) out.push([a.x, a.y, b.x, b.y]);
  }
  return out;
}

/** Material region: closed loops (even-odd fill: outline minus holes) plus open marks to keep clear of. */
class Region {
  readonly fill: Seg[];
  readonly all: Seg[];
  // Uniform grid over the segments' bounds (cells of `cs`), so a distance query looks at nearby
  // segments only, and horizontal bands of the fill segments for the crossing test.
  private readonly gx0: number;
  private readonly gy0: number;
  private readonly cs: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly cells: Seg[][];
  private readonly bands: Seg[][];
  constructor(loops: Vec2[][], marks: Vec2[][]) {
    this.fill = loops.flatMap((l) => segments(l, true));
    this.all = [...this.fill, ...marks.flatMap((m) => segments(m, false))];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [ax, ay, bx, by] of this.all) {
      x0 = Math.min(x0, ax, bx);
      y0 = Math.min(y0, ay, by);
      x1 = Math.max(x1, ax, bx);
      y1 = Math.max(y1, ay, by);
    }
    const w = Math.max(x1 - x0, 1e-9);
    const h = Math.max(y1 - y0, 1e-9);
    // About two segments per cell, at most 256 cells a side.
    const n = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(this.all.length / 2))));
    this.cs = Math.max(w, h) / n;
    this.gx0 = x0;
    this.gy0 = y0;
    this.nx = Math.max(1, Math.ceil(w / this.cs));
    this.ny = Math.max(1, Math.ceil(h / this.cs));
    this.cells = Array.from({ length: this.nx * this.ny }, () => []);
    this.bands = Array.from({ length: this.ny }, () => []);
    for (const sg of this.all) {
      const [i0, j0] = this.cellOf(Math.min(sg[0], sg[2]), Math.min(sg[1], sg[3]));
      const [i1, j1] = this.cellOf(Math.max(sg[0], sg[2]), Math.max(sg[1], sg[3]));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.nx + i]!.push(sg);
    }
    for (const sg of this.fill) {
      const j0 = this.cellOf(0, Math.min(sg[1], sg[3]))[1];
      const j1 = this.cellOf(0, Math.max(sg[1], sg[3]))[1];
      for (let j = j0; j <= j1; j++) this.bands[j]!.push(sg);
    }
  }
  private cellOf(x: number, y: number): [number, number] {
    const i = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.gx0) / this.cs)));
    const j = Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.gy0) / this.cs)));
    return [i, j];
  }
  inside(x: number, y: number): boolean {
    if (y < this.gy0 || y > this.gy0 + this.ny * this.cs) return false;
    let c = false;
    for (const [ax, ay, bx, by] of this.bands[this.cellOf(x, y)[1]]!) if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) c = !c;
    return c;
  }
  /** Distance to the nearest cut or mark (rings of grid cells outwards until none can be nearer). */
  private nearest(x: number, y: number): number {
    const [ci, cj] = this.cellOf(x, y);
    let d = Infinity;
    const maxK = Math.max(this.nx, this.ny);
    for (let k = 0; k <= maxK; k++) {
      let ringMin = Infinity;
      for (let j = cj - k; j <= cj + k; j++) {
        if (j < 0 || j >= this.ny) continue;
        const edge = j === cj - k || j === cj + k;
        for (let i = ci - k; i <= ci + k; i += edge ? 1 : 2 * k) {
          if (i < 0 || i >= this.nx) continue;
          // Distance from the point to this cell's rectangle.
          const rx = this.gx0 + i * this.cs;
          const ry = this.gy0 + j * this.cs;
          const ddx = Math.max(rx - x, 0, x - rx - this.cs);
          const ddy = Math.max(ry - y, 0, y - ry - this.cs);
          const cd = Math.hypot(ddx, ddy);
          ringMin = Math.min(ringMin, cd);
          if (cd >= d) continue;
          for (const sg of this.cells[j * this.nx + i]!) d = Math.min(d, segDist(x, y, sg));
          if (k === 0) break;
        }
      }
      if (ringMin >= d) break;
    }
    return d;
  }
  /** Signed distance to the nearest cut or mark: positive inside the material. */
  dist(x: number, y: number): number {
    const d = this.nearest(x, y);
    return this.inside(x, y) ? d : -d;
  }
  /** True when the axis-aligned box centred on (x, y), half-size (hw, hh), lies in the material. */
  boxFits(x: number, y: number, hw: number, hh: number): boolean {
    const x0 = x - hw;
    const x1 = x + hw;
    const y0 = y - hh;
    const y1 = y + hh;
    if (!this.inside(x0, y0) || !this.inside(x1, y0) || !this.inside(x1, y1) || !this.inside(x0, y1)) return false;
    // No cut or mark may enter the box (a hole wholly inside it has a vertex inside it).
    for (const [ax, ay, bx, by] of this.all) {
      if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
      if ((ax >= x0 && ax <= x1 && ay >= y0 && ay <= y1) || (bx >= x0 && bx <= x1 && by >= y0 && by <= y1)) return false;
      // Segment crosses the box: it crosses one of the box's sides (Liang-Barsky clip).
      let t0 = 0;
      let t1 = 1;
      const dx = bx - ax;
      const dy = by - ay;
      const clip = (p: number, q: number): boolean => {
        if (p === 0) return q >= 0;
        const r = q / p;
        if (p < 0) {
          if (r > t1) return false;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return false;
          if (r < t1) t1 = r;
        }
        return true;
      };
      if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay)) return false;
    }
    return true;
  }
}

type Cell = { x: number; y: number; h: number; d: number; max: number };
const cell = (x: number, y: number, h: number, r: Region): Cell => {
  const d = r.dist(x, y);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
};

/** Minimal binary max-heap on `max`. */
class Queue {
  private a: Cell[] = [];
  get size(): number {
    return this.a.length;
  }
  push(c: Cell): void {
    const a = this.a;
    a.push(c);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.max >= c.max) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = c;
  }
  pop(): Cell {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        const val = (k: number): number => (k === i ? last.max : a[k]!.max);
        if (l < a.length && a[l]!.max > val(m)) m = l;
        if (r < a.length && a[r]!.max > val(m)) m = r;
        if (m === i) break;
        a[i] = a[m]!;
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

/**
 * Pole of inaccessibility of the region bounded by `loops` (even-odd: an outline and its holes),
 * keeping clear of the open polylines `marks` too. `precision` is the absolute tolerance on the
 * radius; default 1 % of the smaller bounding-box side.
 */
export function poleOfInaccessibility(loops: Vec2[][], marks: Vec2[][] = [], precision?: number): { x: number; y: number; r: number } | null {
  const pts = loops[0] ?? [];
  if (pts.length < 3) return null;
  const region = new Region(loops, marks);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const w = x1 - x0;
  const hgt = y1 - y0;
  const size = Math.min(w, hgt);
  if (!(size > 0)) return null;
  const eps = precision ?? Math.max(size / 100, 1e-3);
  // Start from square cells covering the bounding box.
  const q = new Queue();
  const h = size / 2;
  for (let x = x0; x < x1; x += size) for (let y = y0; y < y1; y += size) q.push(cell(x + h, y + h, h, region));
  // Seeds: the bounding-box centre and the vertex centroid (good for convex parts).
  let best = cell(x0 + w / 2, y0 + hgt / 2, 0, region);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const c2 = cell(cx, cy, 0, region);
  if (c2.d > best.d) best = c2;
  let guard = 0;
  while (q.size && guard++ < 20000) {
    const c = q.pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= eps) continue;
    const k = c.h / 2;
    q.push(cell(c.x - k, c.y - k, k, region));
    q.push(cell(c.x + k, c.y - k, k, region));
    q.push(cell(c.x - k, c.y + k, k, region));
    q.push(cell(c.x + k, c.y + k, k, region));
  }
  return best.d > 0 ? { x: best.x, y: best.y, r: best.d } : null;
}

/**
 * Label spot for a part drawn as `outline` with `holes` (closed) and `marks` (engravings, any),
 * in one coordinate frame: the pole of inaccessibility of the material, and the height of the
 * largest box of width / height `aspect` centred there that touches no cut or mark. Null when the
 * part has no interior.
 */
export function labelSpot(outline: Path, holes: Path[], marks: Path[], aspect: number): LabelSpot | null {
  const loops = [outline, ...holes].map((p) => flatten(p));
  const open = marks.map((p) => {
    const pts = flatten(p);
    return p.closed ? [...pts, pts[0]!] : pts;
  });
  const pole = poleOfInaccessibility(loops, open);
  if (!pole) return null;
  const region = new Region(loops, open);
  // The box inscribed in the circle always fits. The box contains the disc of radius
  // min(width, height) / 2 about the pole, which may not reach past r: that bounds it above.
  let lo = (2 * pole.r) / Math.hypot(aspect, 1);
  let hi = (2 * pole.r) / Math.min(aspect, 1);
  if (region.boxFits(pole.x, pole.y, (aspect * hi) / 2, hi / 2)) lo = hi;
  else
    for (let i = 0; i < 18 && hi - lo > 1e-4 * hi; i++) {
      const mid = (lo + hi) / 2;
      if (region.boxFits(pole.x, pole.y, (aspect * mid) / 2, mid / 2)) lo = mid;
      else hi = mid;
    }
  return { ...pole, h: lo * 0.999 };
}
