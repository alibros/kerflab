/**
 * Pure geometry for the 3D view: parts -> world-space triangle meshes, and explode offsets.
 *
 * Follows the placement convention in core/part.ts: part-local (x, y, z) maps to world
 * origin + x*u + y*v + z*n with n = u × v pointing INTO the box; the material occupies
 * 0 <= z <= thickness and z = 0 is the outer (show) face. Only `part.nominal` is used — the
 * kerf-compensated outline is for cutting, not for looking at.
 *
 * Bent parts (`Part.bend`, living hinges) are mapped through their bend: every loop gets a vertex
 * and every face triangle is split where it crosses one of the x positions that divide the arcs
 * into BEND_STEP_DEG facets, so they render curved; normals follow the bend.
 *
 * Geometry is baked in world space (the scene graph only adds explode offsets), with two groups:
 * 0 = the two sheet faces (UVs in local mm, for face grain) and 1 = the cut edges (u = distance
 * along the contour in mm, v = depth through the sheet 0..1, so a ply-stripe texture shows the
 * layers on every cut edge).
 */
import { Box3, BufferAttribute, BufferGeometry, ShapeUtils, Vector2, Vector3 } from 'three';
import { flatten, type Path, type Vec2 } from '../../core/geometry';
import { bendFrameAt, placementNormal, type GeneratorView, type Part } from '../../core/part';

/** Millimetres covered by one repeat of a face/edge texture. */
export const UV_MM = 160;
/**
 * Adjacent edge facets closer than this (degrees) share a smoothed normal (flattened arcs); the
 * 3D view's outlines (`partEdgeLines`) use the same threshold, so a crease is either shaded
 * smooth or outlined, never both or neither.
 */
export const SMOOTH_DEG = 25;

const COS_SMOOTH = Math.cos((SMOOTH_DEG * Math.PI) / 180);

/** Group indices of a part geometry. */
export const FACE_GROUP = 0;
export const EDGE_GROUP = 1;

/** Facet angle (degrees) used to render the arcs of a bent part (below SMOOTH_DEG: shaded smooth). */
export const BEND_STEP_DEG = 4;

/** Local x positions dividing a bent part's arcs into facets of at most BEND_STEP_DEG; sorted. */
function bendCuts(p: Part): number[] {
  const cuts: number[] = [];
  for (const a of p.bend?.arcs ?? []) {
    const n = Math.max(2, Math.ceil(Math.abs(a.angle) / BEND_STEP_DEG));
    for (let k = 0; k <= n; k++) cuts.push(a.at + (k / n) * a.length);
  }
  return cuts.sort((a, b) => a - b);
}

/** Closed loop with a vertex added wherever an edge crosses one of `cuts` (sorted x positions). */
function densify(l: Vec2[], cuts: number[]): Vec2[] {
  if (cuts.length === 0) return l;
  const out: Vec2[] = [];
  l.forEach((a, i) => {
    const b = l[(i + 1) % l.length]!;
    out.push(a);
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    const xs = cuts.filter((c) => c > lo + 1e-9 && c < hi - 1e-9);
    if (b.x < a.x) xs.reverse();
    for (const x of xs) out.push({ x, y: a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y) });
  });
  return out;
}

type Tri = [Vec2, Vec2, Vec2];

/** Splits triangles along the vertical lines x = c (c in cuts) so each piece lies between two cuts. */
function splitTris(tris: Tri[], cuts: number[]): Tri[] {
  let cur = tris;
  for (const c of cuts) {
    const next: Tri[] = [];
    for (const tri of cur) {
      const xs = tri.map((q) => q.x);
      if (!(Math.min(...xs) < c - 1e-9 && Math.max(...xs) > c + 1e-9)) { next.push(tri); continue; }
      // Clip the triangle into the polygons left and right of the cut, then fan them (keeps orientation).
      const left: Vec2[] = [];
      const right: Vec2[] = [];
      for (let i = 0; i < 3; i++) {
        const a = tri[i]!;
        const b = tri[(i + 1) % 3]!;
        if (a.x <= c) left.push(a);
        if (a.x >= c) right.push(a);
        if ((a.x < c && b.x > c) || (a.x > c && b.x < c)) {
          const q = { x: c, y: a.y + ((c - a.x) / (b.x - a.x)) * (b.y - a.y) };
          left.push(q);
          right.push(q);
        }
      }
      for (const poly of [left, right]) for (let i = 1; i + 1 < poly.length; i++) next.push([poly[0]!, poly[i]!, poly[i + 1]!]);
    }
    cur = next;
  }
  return cur;
}

function loop(path: Path): Vec2[] {
  const pts = flatten(path);
  const out: Vec2[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-9) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && out.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) <= 1e-9) out.pop();
  return out;
}

function signedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Cheap stable hash of a string to [0, 1), used to vary grain per part. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Triangulated outline minus holes, extruded through the thickness, placed in world space.
 * Arcs are flattened (within 0.01 mm, see core/geometry `flatten`).
 */
export function partToGeometry(p: Part): BufferGeometry {
  const { origin: o, x: u, y: v } = p.placement;
  const n = placementNormal(p.placement);
  const t = p.thickness;
  const cuts = bendCuts(p);

  let outer = densify(loop(p.nominal.outline), cuts);
  if (signedArea(outer) < 0) outer = outer.reverse();
  // Holes clockwise: then "right of travel" is out of the material on every loop.
  const holes = p.nominal.holes.map(loop).filter((h) => h.length >= 3).map((h) => densify(signedArea(h) > 0 ? h.reverse() : h, cuts));

  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const offU = hash01(p.id) * UV_MM;
  const offV = hash01(`${p.id}~`) * UV_MM;

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, a: number, b: number): number => {
    if (p.bend) {
      // Frame of the bend at x: point of (x, 0, 0), tangent, normal (v is constant).
      const f = bendFrameAt(p, x);
      pos.push(f.p[0] + y * v[0] + z * f.n[0], f.p[1] + y * v[1] + z * f.n[1], f.p[2] + y * v[2] + z * f.n[2]);
      nrm.push(nx * f.u[0] + ny * v[0] + nz * f.n[0], nx * f.u[1] + ny * v[1] + nz * f.n[1], nx * f.u[2] + ny * v[2] + nz * f.n[2]);
    } else {
      pos.push(o[0] + x * u[0] + y * v[0] + z * n[0], o[1] + x * u[1] + y * v[1] + z * n[1], o[2] + x * u[2] + y * v[2] + z * n[2]);
      // local normal (nx, ny, nz) to world
      nrm.push(nx * u[0] + ny * v[0] + nz * n[0], nx * u[1] + ny * v[1] + nz * n[1], nx * u[2] + ny * v[2] + nz * n[2]);
    }
    uvs.push(a, b);
    return pos.length / 3 - 1;
  };

  // ── Faces ──
  if (outer.length >= 3) {
    const contour = outer.map((q) => new Vector2(q.x, q.y));
    const holeV = holes.map((h) => h.map((q) => new Vector2(q.x, q.y)));
    const all = [contour, ...holeV].flat();
    const tris = ShapeUtils.triangulateShape(contour, holeV);
    if (p.bend) {
      // Non-indexed faces: the triangles split at the bend's facet lines.
      const flat = splitTris(tris.map((tri) => tri.map((k) => all[k]!) as unknown as Tri), cuts);
      for (const [zFace, nz] of [[0, -1], [t, 1]] as const)
        for (const [pa, pb0, pc0] of flat) {
          const ccw = (pb0.x - pa.x) * (pc0.y - pa.y) - (pb0.y - pa.y) * (pc0.x - pa.x) > 0;
          const [pb, pc] = ccw === nz > 0 ? [pb0, pc0] : [pc0, pb0];
          for (const q of [pa, pb, pc]) idx.push(push(q.x, q.y, zFace, 0, 0, nz, (q.x + offU) / UV_MM, (q.y + offV) / UV_MM));
        }
    } else for (const [zFace, nz] of [
      [0, -1],
      [t, 1],
    ] as const) {
      const base = pos.length / 3;
      for (const q of all) push(q.x, q.y, zFace, 0, 0, nz, (q.x + offU) / UV_MM, (q.y + offV) / UV_MM);
      for (const tri of tris) {
        const [a, b, c] = tri as [number, number, number];
        const pa = all[a]!;
        const pb = all[b]!;
        const pc = all[c]!;
        const ccw = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x) > 0;
        // Outward normal +n (top) wants CCW seen from +n; the z=0 face (outward -n) wants CW.
        if (ccw === nz > 0) idx.push(base + a, base + b, base + c);
        else idx.push(base + a, base + c, base + b);
      }
    }
  }
  const faceCount = idx.length;

  // ── Cut edges ──
  for (const l of outer.length >= 3 ? [outer, ...holes] : []) {
    const m = l.length;
    const en = l.map((a, i) => {
      const b = l[(i + 1) % m]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dy / len, y: -dx / len, len }; // right of travel = out of the material
    });
    const vertexNormal = (i: number, side: number): { x: number; y: number } => {
      // Normal at vertex i for edge `side` (i-1 or i): smoothed if the corner is shallow.
      const a = en[(i - 1 + m) % m]!;
      const b = en[i]!;
      if (a.x * b.x + a.y * b.y < COS_SMOOTH) return en[side]!;
      const sx = a.x + b.x;
      const sy = a.y + b.y;
      const l2 = Math.hypot(sx, sy) || 1;
      return { x: sx / l2, y: sy / l2 };
    };
    let s = 0;
    for (let i = 0; i < m; i++) {
      const a = l[i]!;
      const b = l[(i + 1) % m]!;
      const e = en[i]!;
      const na = vertexNormal(i, i);
      const nb = vertexNormal((i + 1) % m, i);
      const s0 = (s + offU) / UV_MM;
      const s1 = (s + e.len + offU) / UV_MM;
      const a0 = push(a.x, a.y, 0, na.x, na.y, 0, s0, 0);
      const b0 = push(b.x, b.y, 0, nb.x, nb.y, 0, s1, 0);
      const b1 = push(b.x, b.y, t, nb.x, nb.y, 0, s1, 1);
      const a1 = push(a.x, a.y, t, na.x, na.y, 0, s0, 1);
      idx.push(a0, b0, b1, a0, b1, a1);
      s += e.len;
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(new BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.addGroup(0, faceCount, FACE_GROUP);
  g.addGroup(faceCount, idx.length - faceCount, EDGE_GROUP);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Outline segments of a part in world space (pairs of xyz points, flat): every contour edge on both
 * sheet faces, plus a line through the thickness at every contour corner sharper than SMOOTH_DEG,
 * i.e. exactly the creases `partToGeometry` does not shade smooth.
 *
 * Built from the part's own loops, not from the triangulated faces (`EdgesGeometry`): the face
 * triangulation of a panel with rows of aligned slots contains zero-area triangles between
 * collinear hole vertices, whose undefined normals made EdgesGeometry draw stray lines across
 * the face (the coplanar triangles themselves never form a crease). Bent parts follow the bend;
 * the bend's facet lines are not creases and get no line.
 */
export function partEdgeLines(p: Part): Float32Array {
  const { origin: o, x: u, y: v } = p.placement;
  const n = placementNormal(p.placement);
  const t = p.thickness;
  const cuts = bendCuts(p);
  const out: number[] = [];
  const put = (x: number, y: number, z: number): void => {
    if (p.bend) {
      const f = bendFrameAt(p, x);
      out.push(f.p[0] + y * v[0] + z * f.n[0], f.p[1] + y * v[1] + z * f.n[1], f.p[2] + y * v[2] + z * f.n[2]);
    } else out.push(o[0] + x * u[0] + y * v[0] + z * n[0], o[1] + x * u[1] + y * v[1] + z * n[1], o[2] + x * u[2] + y * v[2] + z * n[2]);
  };
  const outer = loop(p.nominal.outline);
  if (outer.length < 3) return new Float32Array(0);
  const loops = [outer, ...p.nominal.holes.map(loop).filter((h) => h.length >= 3)].map((l) => densify(l, cuts));
  for (const l of loops) {
    const m = l.length;
    const dir = l.map((a, i) => {
      const b = l[(i + 1) % m]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    });
    for (let i = 0; i < m; i++) {
      const a = l[i]!;
      const b = l[(i + 1) % m]!;
      for (const z of [0, t]) {
        put(a.x, a.y, z);
        put(b.x, b.y, z);
      }
      const d0 = dir[(i - 1 + m) % m]!;
      const d1 = dir[i]!;
      if (d0.x * d1.x + d0.y * d1.y < COS_SMOOTH) {
        put(a.x, a.y, 0);
        put(a.x, a.y, t);
      }
    }
  }
  return new Float32Array(out);
}

/** World-space bounding box of a part (nominal outline through its thickness). */
export function partBounds(p: Part): Box3 {
  const b = new Box3();
  const { origin: o, x: u, y: v } = p.placement;
  const n = placementNormal(p.placement);
  const w = new Vector3();
  if (p.bend) {
    for (const q of densify(loop(p.nominal.outline), bendCuts(p)))
      for (const z of [0, p.thickness]) {
        const f = bendFrameAt(p, q.x);
        b.expandByPoint(w.set(f.p[0] + q.y * v[0] + z * f.n[0], f.p[1] + q.y * v[1] + z * f.n[1], f.p[2] + q.y * v[2] + z * f.n[2]));
      }
    return b;
  }
  for (const q of flatten(p.nominal.outline)) {
    for (const z of [0, p.thickness]) {
      w.set(
        o[0] + q.x * u[0] + q.y * v[0] + z * n[0],
        o[1] + q.x * u[1] + q.y * v[1] + z * n[1],
        o[2] + q.x * u[2] + q.y * v[2] + z * n[2],
      );
      b.expandByPoint(w);
    }
  }
  return b;
}

/** Bounding box of all parts, assembled. */
export function assemblyBounds(parts: Part[]): Box3 {
  const b = new Box3();
  for (const p of parts) b.union(partBounds(p));
  return b;
}

/** How far a fully exploded part travels, as a fraction of the assembly's diagonal. */
export const EXPLODE_REACH = 0.42;

/**
 * Per-part translation for an explode amount t in 0..1: each part moves away from the assembled
 * centroid, by t * EXPLODE_REACH * the assembly diagonal. A flat part that sits on the centroid
 * moves along its outward normal. A bent part on the centroid (a wall wrapped round the box) has
 * no outward direction, every way is outward, so it stays put and the rest move away from it.
 * Linear in t; all zeros at t = 0.
 */
export function explodeOffset(parts: Part[], t: number): Map<string, Vector3> {
  const out = new Map<string, Vector3>();
  if (parts.length === 0) return out;
  const centres = parts.map((p) => partBounds(p).getCenter(new Vector3()));
  const centroid = centres.reduce((acc, c) => acc.add(c), new Vector3()).divideScalar(parts.length);
  const diag = assemblyBounds(parts).getSize(new Vector3()).length();
  const reach = t * EXPLODE_REACH * diag;
  parts.forEach((p, i) => {
    const d = centres[i]!.clone().sub(centroid);
    if (d.length() < 1e-6 * Math.max(diag, 1)) {
      if (p.bend) {
        out.set(p.id, new Vector3());
        return;
      }
      const nn = placementNormal(p.placement);
      d.set(-nn[0], -nn[1], -nn[2]);
    }
    out.set(p.id, t === 0 ? new Vector3() : d.normalize().multiplyScalar(reach));
  });
  return out;
}

/** `v` turned by the view's `turn` (degrees, counter-clockwise seen from above) about the z axis. */
export function turnToView(v: Vector3, view: GeneratorView | undefined): Vector3 {
  const deg = view?.turn ?? 0;
  return deg ? v.clone().applyAxisAngle(new Vector3(0, 0, 1), (deg * Math.PI) / 180) : v.clone();
}

/** Whether the view draws this part see-through (outline only). */
export function isGhost(view: GeneratorView | undefined, id: string): boolean {
  return view?.ghost?.(id) ?? false;
}
