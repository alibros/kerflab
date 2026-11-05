/**
 * Sheet materials for the 3D view, with procedural (canvas-generated) textures: no binary assets.
 *
 * Every part mesh uses two material slots (see assemble.ts groups): 0 = the sheet faces (grain in
 * local mm) and 1 = the laser-cut edges (u along the contour, v through the thickness), which is
 * where plywood shows its plies — and, being laser cut, a toasted edge.
 *
 * Each set has three variants (normal / hover / selected) that share textures; `dispose()` frees
 * every material and texture of the set.
 */
import {
  CanvasTexture,
  Color,
  type Material,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Plane,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

export type MaterialId = 'birch' | 'walnut' | 'acrylic' | 'mdf' | 'metal';

export const MATERIAL_CHOICES: { id: MaterialId; label: string; swatch: string; edge: string }[] = [
  { id: 'birch', label: 'Birch plywood', swatch: '#E2CDA4', edge: '#7A5636' },
  { id: 'walnut', label: 'Walnut ply', swatch: '#5E3F2A', edge: '#3A281B' },
  { id: 'mdf', label: 'MDF', swatch: '#B48D63', edge: '#4A3424' },
  { id: 'acrylic', label: 'Clear acrylic', swatch: '#CFE3E6', edge: '#8FBFC6' },
  { id: 'metal', label: 'Aluminium', swatch: '#B8BDC3', edge: '#8D939A' },
];

export const isMaterialId = (v: unknown): v is MaterialId => MATERIAL_CHOICES.some((m) => m.id === v);

export type Variant = 'normal' | 'hover' | 'selected';

export interface MaterialSet {
  id: MaterialId;
  /** [face, edge] per variant. */
  slots: Record<Variant, [Material, Material]>;
  /** Colour of the section-cut cap (the inside of the sheet). */
  cap: Color;
  /** Line colour weight: transparent materials want lighter outlines. */
  lineOpacity: number;
  transparent: boolean;
  setAccent(c: Color): void;
  dispose(): void;
}

// ── Procedural texture helpers ───────────────────────────────────────────

const TAU = Math.PI * 2;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise on a px*py lattice, sampled at (x, y) in lattice units. */
function periodicNoise(px: number, py: number, seed: number): (x: number, y: number) => number {
  const r = rng(seed);
  const lat = Float32Array.from({ length: px * py }, () => r());
  const at = (i: number, j: number): number => lat[(((j % py) + py) % py) * px + (((i % px) + px) % px)]!;
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

type RGB = [number, number, number];
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function paint(w: number, hgt: number, fn: (x: number, y: number) => RGB): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, hgt);
  const d = img.data;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const k = (y * w + x) * 4;
      d[k] = r;
      d[k + 1] = g;
      d[k + 2] = b;
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function texture(c: HTMLCanvasElement, anisotropy: number): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

type GrainSpec = { base: string; late: string; early: string; contrast: number; rings: number; wave: number; fleck: number; seed: number };

/** Flat-sawn veneer: growth rings running along x, warped by low-frequency noise; tileable. */
function grain(size: number, s: GrainSpec): HTMLCanvasElement {
  const warp = periodicNoise(4, 6, s.seed);
  const warp2 = periodicNoise(12, 24, s.seed + 4);
  const fine = periodicNoise(256, 16, s.seed + 1); // long fibres along x
  const tone = periodicNoise(3, 5, s.seed + 2);
  const r = rng(s.seed + 3);
  const base = hex(s.base);
  const late = hex(s.late);
  const early = hex(s.early);
  const phase = r() * TAU;
  return paint(size, size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const w = warp(u * 4, v * 6) * s.wave + warp2(u * 12, v * 24) * 0.35 + Math.sin(TAU * (u + v * 2) + phase) * 0.12 * s.wave;
    const ring = (((v * s.rings + w) % 1) + 1) % 1;
    // Asymmetric ring: a crisp late-wood edge fading back through the early wood.
    const line = Math.pow(ring, 3.5) * (0.55 + 0.45 * warp2(u * 12 + 5, v * 24 + 7));
    const fib = fine(u * 256, v * 16);
    let c = mix(base, early, clamp01(tone(u * 3, v * 5) * 0.8));
    c = mix(c, late, clamp01(line * s.contrast + (fib - 0.5) * s.fleck));
    return c;
  });
}

/** Laser-cut plywood edge: plies across v, with darker glue lines and a toasted, streaky char. */
function plyEdge(w: number, hgt: number, plies: { color: string; weight: number }[], glue: string, seed: number): HTMLCanvasElement {
  const streak = periodicNoise(128, 1, seed);
  const blot = periodicNoise(16, 4, seed + 1);
  const total = plies.reduce((a, p) => a + p.weight, 0);
  const bounds: number[] = [];
  let acc = 0;
  for (const p of plies) bounds.push((acc += p.weight / total));
  const g = hex(glue);
  return paint(w, hgt, (x, y) => {
    const v = (y + 0.5) / hgt;
    let i = bounds.findIndex((b) => v <= b);
    if (i < 0) i = plies.length - 1;
    const lo = i === 0 ? 0 : bounds[i - 1]!;
    const hi = bounds[i]!;
    const dEdge = Math.min(v - lo, hi - v) * hgt; // px to nearest ply boundary
    let c = hex(plies[i]!.color);
    const n = streak(x / w * 128, 0) - 0.5;
    c = mix(c, [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], clamp01(n * 0.9 + (blot(x / w * 16, v * 4) - 0.5) * 0.6));
    if (i > 0 || v > hi) c = mix(c, g, clamp01(1.4 - dEdge * 0.9));
    if (dEdge < 1.2 && (i > 0 && v - lo < hi - v)) c = mix(c, g, 0.6);
    return c;
  });
}

function speckle(size: number, base: string, dark: string, amount: number, seed: number): HTMLCanvasElement {
  const n1 = periodicNoise(size / 2, size / 2, seed);
  const n2 = periodicNoise(16, 16, seed + 1);
  const b = hex(base);
  const d = hex(dark);
  return paint(size, size, (x, y) => mix(b, d, clamp01((n1(x / 2, y / 2) - 0.5) * amount + (n2((x / size) * 16, (y / size) * 16) - 0.5) * amount * 0.5 + 0.2)));
}

function brushed(size: number, base: string, seed: number): HTMLCanvasElement {
  const n = periodicNoise(4, size, seed);
  const m = periodicNoise(32, 32, seed + 1);
  const b = hex(base);
  return paint(size, size, (x, y) => {
    const k = (n((x / size) * 4, y) - 0.5) * 0.16 + (m((x / size) * 32, (y / size) * 32) - 0.5) * 0.05;
    return [b[0] * (1 + k), b[1] * (1 + k), b[2] * (1 + k)];
  });
}

// ── Sets ─────────────────────────────────────────────────────────────────

type Built = { face: Material; edge: Material; textures: Texture[]; cap: string; lineOpacity: number; transparent: boolean };

function buildBase(id: MaterialId, anisotropy: number, clip: Plane[]): Built {
  const common = { clippingPlanes: clip, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  switch (id) {
    case 'birch':
    case 'walnut': {
      const birch = id === 'birch';
      const faceTex = texture(
        grain(
          1024,
          birch
            ? { base: '#E2CBA0', early: '#EAD8B6', late: '#C49F6C', contrast: 0.5, rings: 9, wave: 2.4, fleck: 0.3, seed: 11 }
            : { base: '#5E3F2A', early: '#74503A', late: '#2C1B10', contrast: 0.75, rings: 13, wave: 1.1, fleck: 0.75, seed: 23 },
        ),
        anisotropy,
      );
      const plies = birch
        ? [
            { color: '#8A6342', weight: 1 },
            { color: '#6E4C30', weight: 1 },
            { color: '#8F6845', weight: 1 },
            { color: '#6A492E', weight: 1 },
            { color: '#8A6342', weight: 1 },
          ]
        : [
            { color: '#2E1F15', weight: 0.45 },
            { color: '#7E5A3A', weight: 1 },
            { color: '#664629', weight: 1 },
            { color: '#7E5A3A', weight: 1 },
            { color: '#2E1F15', weight: 0.45 },
          ];
      const edgeTex = texture(plyEdge(512, 64, plies, '#3A2818', birch ? 5 : 7), anisotropy);
      return {
        face: new MeshStandardMaterial({ map: faceTex, roughness: birch ? 0.72 : 0.6, metalness: 0, bumpMap: faceTex, bumpScale: 0.25, ...common }),
        edge: new MeshStandardMaterial({ map: edgeTex, roughness: 0.92, metalness: 0, ...common }),
        textures: [faceTex, edgeTex],
        cap: birch ? '#C9A97A' : '#6B4A30',
        lineOpacity: 0.85,
        transparent: false,
      };
    }
    case 'mdf': {
      const faceTex = texture(speckle(512, '#B48E64', '#9C7650', 0.55, 31), anisotropy);
      const edgeTex = texture(plyEdge(512, 32, [{ color: '#4C3526', weight: 1 }], '#3A281C', 37), anisotropy);
      return {
        face: new MeshStandardMaterial({ map: faceTex, roughness: 0.86, metalness: 0, ...common }),
        edge: new MeshStandardMaterial({ map: edgeTex, roughness: 0.95, metalness: 0, ...common }),
        textures: [faceTex, edgeTex],
        cap: '#9E7A55',
        lineOpacity: 0.85,
        transparent: false,
      };
    }
    case 'acrylic': {
      const glass = { transparent: true, depthWrite: false, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, ...common };
      return {
        face: new MeshPhysicalMaterial({ color: '#D9ECEF', opacity: 0.28, ior: 1.49, specularIntensity: 1, ...glass }),
        // Cut acrylic edges catch and pipe light: brighter and denser than the faces.
        edge: new MeshPhysicalMaterial({ color: '#A9D3D9', opacity: 0.78, emissive: new Color('#6FA6AE'), emissiveIntensity: 0.18, ...glass }),
        textures: [],
        cap: '#BCDDE2',
        lineOpacity: 0.5,
        transparent: true,
      };
    }
    case 'metal': {
      const faceTex = texture(brushed(512, '#D2D6DB', 41), anisotropy);
      return {
        face: new MeshStandardMaterial({ map: faceTex, roughness: 0.3, metalness: 1, envMapIntensity: 2.6, ...common }),
        edge: new MeshStandardMaterial({ color: '#A4AAB1', roughness: 0.45, metalness: 1, envMapIntensity: 2.2, ...common }),
        textures: [faceTex],
        cap: '#A9AFB6',
        lineOpacity: 0.7,
        transparent: false,
      };
    }
  }
}

const tint = (m: Material, accent: Color, amount: number): void => {
  const s = m as MeshStandardMaterial;
  s.emissive.copy(accent);
  s.emissiveIntensity = amount;
};

/** Build a material set (textures are generated once per set; ~30 ms for wood). */
export function createMaterialSet(id: MaterialId, opts: { anisotropy: number; clippingPlanes: Plane[]; accent: Color }): MaterialSet {
  const b = buildBase(id, opts.anisotropy, opts.clippingPlanes);
  const hover: [Material, Material] = [b.face.clone(), b.edge.clone()];
  const selected: [Material, Material] = [b.face.clone(), b.edge.clone()];
  const all = [b.face, b.edge, ...hover, ...selected];
  // Material.clone() deep-copies clipping planes; every variant must share the live plane.
  for (const m of all) m.clippingPlanes = opts.clippingPlanes;
  const setAccent = (c: Color): void => {
    hover.forEach((m) => tint(m, c, 0.05));
    selected.forEach((m) => tint(m, c, 0.14));
  };
  setAccent(opts.accent);
  return {
    id,
    slots: { normal: [b.face, b.edge], hover, selected },
    cap: new Color(b.cap),
    lineOpacity: b.lineOpacity,
    transparent: b.transparent,
    setAccent,
    dispose() {
      for (const m of all) m.dispose();
      for (const t of b.textures) t.dispose();
    },
  };
}
