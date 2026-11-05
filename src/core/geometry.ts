export type Vec2 = { x: number; y: number };
export type Seg = { t: 'L'; to: Vec2 } | { t: 'A'; to: Vec2; c: Vec2; ccw: boolean };
export type Path = { start: Vec2; segs: Seg[]; closed: boolean };
/** 3x3 affine matrix, row-major: [a,b,c, d,e,f, g,h,i]; point maps as x'=ax+by+c, y'=dx+ey+f. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryError';
  }
}

const TAU = Math.PI * 2;
const FLATTEN_TOL = 0.01;
const EPS = 1e-9;

export const mat3Identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mat3Translate = (x: number, y: number): Mat3 => [1, 0, x, 0, 1, y, 0, 0, 1];
export function mat3Rotate(deg: number): Mat3 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
/** Returns a*b (apply b first, then a). */
export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) o[r * 3 + c]! += a[r * 3 + k]! * b[k * 3 + c]!;
  return o as Mat3;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const len = (a: Vec2): number => Math.hypot(a.x, a.y);

/** Sweep angle magnitude (0, 2pi] of an arc. */
function sweep(from: Vec2, s: Extract<Seg, { t: 'A' }>): number {
  const a0 = Math.atan2(from.y - s.c.y, from.x - s.c.x);
  const a1 = Math.atan2(s.to.y - s.c.y, s.to.x - s.c.x);
  let d = s.ccw ? a1 - a0 : a0 - a1;
  d = ((d % TAU) + TAU) % TAU;
  return d < 1e-9 ? TAU : d;
}

function starts(p: Path): Vec2[] {
  const out: Vec2[] = [];
  let cur = p.start;
  for (const s of p.segs) {
    out.push(cur);
    cur = s.to;
  }
  return out;
}

export function bounds(p: Path): { min: Vec2; max: Vec2 } {
  const min = { x: p.start.x, y: p.start.y };
  const max = { x: p.start.x, y: p.start.y };
  const add = (v: Vec2): void => {
    min.x = Math.min(min.x, v.x); min.y = Math.min(min.y, v.y);
    max.x = Math.max(max.x, v.x); max.y = Math.max(max.y, v.y);
  };
  const from = starts(p);
  p.segs.forEach((s, i) => {
    add(s.to);
    if (s.t === 'A') {
      const f = from[i]!;
      const r = len(sub(f, s.c));
      const sw = sweep(f, s);
      const a0 = Math.atan2(f.y - s.c.y, f.x - s.c.x);
      for (let k = 0; k < 4; k++) {
        const target = (k * Math.PI) / 2;
        let d = s.ccw ? target - a0 : a0 - target;
        d = ((d % TAU) + TAU) % TAU;
        if (d <= sw) add({ x: s.c.x + r * Math.cos(target), y: s.c.y + r * Math.sin(target) });
      }
    }
  });
  return { min, max };
}

/** Signed area (CCW positive). Open paths are implicitly closed by a chord. */
export function area(p: Path): number {
  let a = 0;
  let cur = p.start;
  const add = (s: Seg): void => {
    a += 0.5 * cross(cur, s.to);
    if (s.t === 'A') {
      const r = len(sub(cur, s.c));
      const th = sweep(cur, s);
      a += (s.ccw ? 1 : -1) * 0.5 * r * r * (th - Math.sin(th));
    }
    cur = s.to;
  };
  p.segs.forEach(add);
  a += 0.5 * cross(cur, p.start);
  return a;
}

/** Polyline approximation (arcs to within 0.01 mm); includes start and every segment end. */
export function flatten(p: Path): Vec2[] {
  const pts: Vec2[] = [p.start];
  let cur = p.start;
  for (const s of p.segs) {
    if (s.t === 'A') {
      const r = len(sub(cur, s.c));
      const th = sweep(cur, s);
      const step = r > FLATTEN_TOL ? 2 * Math.acos(1 - FLATTEN_TOL / r) : Math.PI / 2;
      const n = Math.max(1, Math.ceil(th / step));
      const a0 = Math.atan2(cur.y - s.c.y, cur.x - s.c.x);
      for (let i = 1; i < n; i++) {
        const a = a0 + (s.ccw ? 1 : -1) * (th * i) / n;
        pts.push({ x: s.c.x + r * Math.cos(a), y: s.c.y + r * Math.sin(a) });
      }
    }
    pts.push(s.to);
    cur = s.to;
  }
  return pts;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS)))
    return true;
  const on = (p: Vec2, q: Vec2, r: Vec2, cr: number): boolean =>
    Math.abs(cr) <= EPS &&
    Math.min(p.x, q.x) - EPS <= r.x && r.x <= Math.max(p.x, q.x) + EPS &&
    Math.min(p.y, q.y) - EPS <= r.y && r.y <= Math.max(p.y, q.y) + EPS;
  return on(a, b, c, d1) || on(a, b, d, d2) || on(c, d, a, d3) || on(c, d, b, d4);
}

/** True when the (flattened) path has no self-intersections. Closed paths include the closing edge. */
export function isSimple(p: Path): boolean {
  let pts = flatten(p);
  if (p.closed) {
    const l = pts[pts.length - 1]!;
    if (len(sub(l, p.start)) < EPS) pts = pts.slice(0, -1);
  }
  const n = pts.length - 1 + (p.closed ? 1 : 0); // edge count
  const edge = (i: number): [Vec2, Vec2] => [pts[i]!, pts[(i + 1) % pts.length]!];
  // Sweep along the path's longer extent over edge bounding boxes (grown by EPS, matching
  // segmentsIntersect's tolerance): only pairs whose boxes overlap are tested exactly.
  let mx = Infinity; let Mx = -Infinity; let my = Infinity; let My = -Infinity;
  for (const q of pts) { mx = Math.min(mx, q.x); Mx = Math.max(Mx, q.x); my = Math.min(my, q.y); My = Math.max(My, q.y); }
  const [ka, kb]: ['x' | 'y', 'x' | 'y'] = My - my > Mx - mx ? ['y', 'x'] : ['x', 'y'];
  const lo = (i: number, k: 'x' | 'y'): number => Math.min(edge(i)[0][k], edge(i)[1][k]) - EPS;
  const hi = (i: number, k: 'x' | 'y'): number => Math.max(edge(i)[0][k], edge(i)[1][k]) + EPS;
  const box = Array.from({ length: n }, (_, i) => ({ i, x0: lo(i, ka), x1: hi(i, ka), y0: lo(i, kb), y1: hi(i, kb) }));
  box.sort((u, v) => u.x0 - v.x0);
  for (let k = 0; k < n; k++) {
    const e = box[k]!;
    for (let m = k + 1; m < n && box[m]!.x0 <= e.x1; m++) {
      const o = box[m]!;
      if (o.y0 > e.y1 || o.y1 < e.y0) continue;
      const i = Math.min(e.i, o.i);
      const j = Math.max(e.i, o.i);
      if (j === i + 1 || (p.closed && i === 0 && j === n - 1)) continue; // adjacent
      const [a, b] = edge(i);
      const [c, d] = edge(j);
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

function apply(m: Mat3, v: Vec2): Vec2 {
  return { x: m[0] * v.x + m[1] * v.y + m[2], y: m[3] * v.x + m[4] * v.y + m[5] };
}

/** Affine transform. Arcs assume a similarity (uniform scale/rotation/mirror); a mirror flips arc direction. */
export function transform(p: Path, m: Mat3): Path {
  const flip = m[0] * m[4] - m[1] * m[3] < 0;
  if (p.segs.some((s) => s.t === 'A')) {
    const c1 = Math.hypot(m[0], m[3]);
    const c2 = Math.hypot(m[1], m[4]);
    const ortho = Math.abs(m[0] * m[1] + m[3] * m[4]);
    const tol = 1e-9 * Math.max(1, c1, c2);
    if (Math.abs(c1 - c2) > tol || ortho > tol * Math.max(1, c1))
      throw new GeometryError('transform of a path with arcs requires a similarity matrix');
  }
  return {
    start: apply(m, p.start),
    closed: p.closed,
    segs: p.segs.map((s): Seg =>
      s.t === 'L'
        ? { t: 'L', to: apply(m, s.to) }
        : { t: 'A', to: apply(m, s.to), c: apply(m, s.c), ccw: flip ? !s.ccw : s.ccw }),
  };
}

/**
 * Offset by d (+ outwards, - inwards) with mitred joins. Exact for lines and tangent-continuous
 * arcs; at non-tangent line/arc corners the vertex is mitred and the arc keeps its centre.
 * Throws GeometryError when an inward offset collapses a segment or arc.
 */
export function offsetPath(p: Path, d: number): Path {
  if (!Number.isFinite(d)) throw new GeometryError('offset must be finite');
  // Drop zero-length line segments: they have no normal and would corrupt the mitres.
  const segsIn = p.segs.filter((sg, k) => {
    const f = k === 0 ? p.start : p.segs[k - 1]!.to;
    return sg.t === 'A' || len(sub(sg.to, f)) >= 1e-9;
  });
  if (segsIn.length === 0) return p;
  p = { ...p, segs: segsIn };
  const outRight = !(p.closed && area(p) < 0); // outward side: right of travel for CCW/open
  const from = starts(p);
  const nrm = (s: Seg, at: Vec2, f: Vec2): Vec2 => {
    let n: Vec2;
    if (s.t === 'L') {
      const t = sub(s.to, f);
      const l = len(t);
      n = { x: t.y / l, y: -t.x / l }; // right of travel
    } else {
      const r = sub(at, s.c);
      const l = len(r) || 1;
      const rad = { x: r.x / l, y: r.y / l }; // away from centre
      n = s.ccw ? rad : { x: -rad.x, y: -rad.y }; // ccw: centre on left
    }
    return outRight ? n : { x: -n.x, y: -n.y };
  };
  const nIn = p.segs.map((s, i) => nrm(s, from[i]!, from[i]!));
  const nOut = p.segs.map((s, i) => nrm(s, s.to, from[i]!));
  const miter = (pt: Vec2, a: Vec2 | undefined, b: Vec2 | undefined): Vec2 => {
    const nn = a && b ? { x: a.x + b.x, y: a.y + b.y } : (a ?? b)!;
    const k = a && b ? 1 + dot(a, b) : 1;
    if (k < 1e-6) throw new GeometryError('offset: degenerate corner');
    return { x: pt.x + (d * nn.x) / k, y: pt.y + (d * nn.y) / k };
  };
  const last = p.segs.length - 1;
  const V: Vec2[] = [miter(p.start, p.closed ? nOut[last] : undefined, nIn[0])];
  p.segs.forEach((_s, i) => {
    const isLast = i === last;
    V.push(isLast && p.closed ? V[0]! : miter(p.segs[i]!.to, nOut[i], isLast ? undefined : nIn[i + 1]));
  });
  // Arcs: new radius, endpoints projected onto the same circle.
  const radii: (number | undefined)[] = p.segs.map((s, i) => {
    if (s.t === 'L') return undefined;
    const r = len(sub(from[i]!, s.c));
    const r2 = r + (outRight === s.ccw ? d : -d);
    if (r2 <= EPS) throw new GeometryError('offset collapses arc');
    return r2;
  });
  const onCircle = (v: Vec2, c: Vec2, r: number): Vec2 => {
    const u = sub(v, c);
    const l = len(u) || 1;
    return { x: c.x + (r * u.x) / l, y: c.y + (r * u.y) / l };
  };
  p.segs.forEach((s, i) => {
    const r2 = radii[i];
    if (s.t === 'A' && r2 !== undefined) {
      V[i] = onCircle(V[i]!, s.c, r2);
      V[i + 1] = onCircle(V[i + 1]!, s.c, r2);
    }
  });
  if (p.closed) V[last + 1] = V[0]!;
  const segs: Seg[] = p.segs.map((s, i): Seg => {
    const to = V[i + 1]!;
    if (s.t === 'L') {
      if (dot(sub(s.to, from[i]!), sub(to, V[i]!)) <= 0) throw new GeometryError('offset collapses segment');
      return { t: 'L', to };
    }
    return { t: 'A', to, c: s.c, ccw: s.ccw };
  });
  const out: Path = { start: V[0]!, segs, closed: p.closed };
  if (!isSimple(out)) throw new GeometryError('offset produces a self-intersecting path');
  return out;
}
