/**
 * Interactive 3D assembly view (three.js). Lazy-loaded by the stage the first time the 3D tab is
 * shown, so three never weighs on first paint.
 *
 * - Parts become world-space meshes (assemble.ts); only parts whose geometry changed are rebuilt,
 *   and every geometry / material / texture is disposed on rebuild and on destroy.
 * - Renders on demand: a frame is scheduled only when something changed or while an animation,
 *   camera tween or orbit damping is running — never a constant loop.
 * - Selection is shared with the Sheet view through `store.selectedPart` (both ways); the camera
 *   eases to frame a selected part (instant with reduced motion). `store.exploded` drives an eased
 *   explode.
 * - Scene colours (outlines, grid, shadow tint, PNG background) come from the CSS tokens and follow
 *   the active theme live.
 * - Section view: a clipping plane through the middle of the box, with stencil-capped cut faces.
 * - The generator's view hints (`GeneratorView`): the home camera, key light and section plane turn
 *   to face its working side; ghost parts (a gearbox's covers) are drawn as outlines only and let
 *   clicks through, until selected.
 */
import {
  ACESFilmicToneMapping,
  AlwaysStencilFunc,
  BackSide,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DecrementWrapStencilOp,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  HemisphereLight,
  IncrementWrapStencilOp,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  ReplaceStencilOp,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { bounds as pathBounds } from '../../core/geometry';
import { bendFrameAt, placementNormal, type GeneratorView, type Part } from '../../core/part';
import type { Store } from '../store';
import { onThemeChange } from '../ui/theme';
import { h } from '../ui/dom';
import { EXPLODE_TAU, reducedMotion } from '../ui/motion';
import { formatLength } from '../units';
import { explodeOffset, isGhost, partBounds, partEdgeLines, partToGeometry, turnToView } from './assemble';
import { LOOK_EVENT, MATERIAL3D_KEY as MATERIAL_KEY, material3dFor, type MaterialLook } from '../profiles';
import { createMaterialSet, isMaterialId, MATERIAL_CHOICES, type MaterialId, type MaterialSet, type Variant } from './materials3d';

export class WebGLUnavailableError extends Error {
  constructor(message = 'WebGL is not available') {
    super(message);
    this.name = 'WebGLUnavailableError';
  }
}

export interface ViewerOptions {
  /** Base name for the PNG download (no extension). */
  fileBase?: () => string;
}

export interface ViewerHandle {
  el: HTMLElement;
  /** Show these parts; `view` is the generator's presentation hints (home direction, ghosts). */
  setParts(parts: Part[] | null, view?: GeneratorView): void;
  /** Download a PNG of the current view. */
  screenshot(): Promise<void>;
  destroy(): void;
}

/** Test/debug hooks, attached to the host element as `__v3d`. */
export interface ViewerDebug {
  /** Page (client) coordinates of a part's centre, or null when off screen / unknown. */
  screenPoint(id: string): { x: number; y: number } | null;
  /** Part under a page coordinate. */
  partAt(x: number, y: number): string | null;
  frames(): number;
  /** Part geometries built so far (unchanged parts are reused, not rebuilt). */
  builds(): number;
  explode(): number;
  /** Render now and read the pixels back: distinct colours and the fraction of drawn pixels. */
  sample(): { distinct: number; coverage: number };
  isAnimating(): boolean;
}

// Home view (front-right, from above) and key light (front-left, high), before the generator's
// view turn (GeneratorView.turn) is applied.
const DIR0 = new Vector3(1.0, -1.75, 1.15).normalize();
const LIGHT_DIR0 = new Vector3(-0.85, -1.1, 2.3).normalize();
const FOCUS_MS = 220;
const CLICK_SLOP = 5; // px

const easeOut = (k: number): number => 1 - Math.pow(1 - k, 4);

const ICON = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true">${body}</svg>`;
const ICONS = {
  frame: ICON('<path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"/><path d="M8 5.2 10.6 6.6v2.8L8 10.8 5.4 9.4V6.6Z"/>'),
  section: ICON('<path d="M3 4.5 8 2l5 2.5v7L8 14l-5-2.5Z"/><path d="M1.5 9.5h13" stroke-dasharray="2 1.5"/>'),
  camera: ICON('<path d="M2 5h3l1.2-2h3.6L11 5h3v8H2Z"/><circle cx="8" cy="9" r="2.3"/>'),
};

type Entry = {
  part: Part;
  key: string;
  group: Group;
  mesh: Mesh;
  geom: BufferGeometry;
  lineGeom: LineSegmentsGeometry;
  lines: LineSegments2;
  xray: LineSegments2;
  stencil: [Mesh, Mesh];
  bounds: Box3;
  dir: Vector3; // explode offset at t = 1
  outward: Vector3;
  ghost: boolean; // drawn see-through (outline only) unless selected
};

type Auto = { kind: 'all' } | { kind: 'part'; id: string };

type Palette = { ink: Color; accent: Color; bg: Color; bgCss: string; gridMinor: Color; gridMajor: Color; shadow: Color; dark: boolean };

/** Local x-extent of a part's nominal outline. */
function partXRange(p: Part): [number, number] {
  const b = pathBounds(p.nominal.outline);
  return [b.min.x, b.max.x];
}

function partKey(p: Part): string {
  return JSON.stringify([p.nominal, p.placement, p.bend ?? null, p.thickness]);
}

/** Smallest "nice" step (1, 2, 5 × 10^k) not below v. */
function niceStep(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function gridMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      cMinor: { value: new Color() },
      cMajor: { value: new Color() },
      minor: { value: 10 },
      major: { value: 50 },
      fade: { value: 400 },
      centre: { value: new Vector2() },
      opacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 cMinor; uniform vec3 cMajor;
      uniform float minor; uniform float major; uniform float fade; uniform float opacity;
      uniform vec2 centre;
      varying vec3 vW;
      float grid(vec2 p, float s) {
        vec2 q = p / s;
        vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float d = length(vW.xy - centre);
        float f = 1.0 - smoothstep(fade * 0.25, fade, d);
        float a = grid(vW.xy, minor);
        float b = grid(vW.xy, major);
        vec3 c = mix(cMinor, cMajor, b);
        gl_FragColor = vec4(c, max(a * 0.55, b) * f * opacity);
        #include <colorspace_fragment>
      }`,
  });
}

/** Soft, round contact shadow (a blurred footprint), drawn once on a small canvas. */
function contactTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createViewer(el: HTMLElement, store: Store, opts: ViewerOptions = {}): ViewerHandle {
  // ── Renderer (throws when WebGL is unavailable) ────────────────────────
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
  } catch (e) {
    throw new WebGLUnavailableError(e instanceof Error ? e.message : String(e));
  }
  // Anything else failing must not leak the GL context, listeners or observers: undo what was
  // set up so far and rethrow, so the stage shows its fallback.
  const cleanup: (() => void)[] = [];
  try {
    return mountViewer(el, store, opts, renderer, cleanup);
  } catch (e) {
    for (const undo of cleanup.reverse()) {
      try {
        undo();
      } catch {
        /* best effort */
      }
    }
    renderer.dispose();
    renderer.forceContextLoss();
    delete (el as HTMLElement & { __v3d?: ViewerDebug }).__v3d;
    el.replaceChildren();
    el.classList.remove('v3d');
    throw e;
  }
}

function mountViewer(el: HTMLElement, store: Store, opts: ViewerOptions, renderer: WebGLRenderer, cleanup: (() => void)[]): ViewerHandle {
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.classList.add('v3d-canvas');
  canvas.setAttribute('role', 'img');

  // ── DOM ────────────────────────────────────────────────────────────────
  const probe = h('span', { class: 'v3d-probe', 'aria-hidden': 'true' });
  const chip = h('p', { class: 'v3d-chip bx-mono', 'aria-live': 'polite' });
  chip.hidden = true;
  const notice = h('p', { class: 'v3d-notice', role: 'status' });
  notice.hidden = true;
  const toolBtn = (label: string, icon: string, onClick: () => void, pressed?: boolean): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: 'bx-btn bx-btn--sm bx-btn--icon bx-btn--secondary v3d-tool', title: label, 'aria-label': label });
    b.innerHTML = icon;
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  };
  const btnFrame = toolBtn('Reset view', ICONS.frame, () => resetView());
  const btnSection = toolBtn('Section cut', ICONS.section, () => setSection(!sectionOn), false);
  const btnShot = toolBtn('Save PNG image', ICONS.camera, () => void handle.screenshot());
  const tools = h('div', { class: 'v3d-tools', role: 'group', 'aria-label': '3D view tools' }, btnFrame, btnSection, btnShot);
  const hint = h('p', { class: 'v3d-hint bx-mono' }, 'Drag to orbit · shift-drag to pan · scroll to zoom · click a part, double-click to focus');
  const view = h('div', { class: 'app-view v3d-view' }, canvas, chip, tools, hint, notice);

  // Bottom bar: explode, material, part.
  const explodeRange = h('input', { type: 'range', class: 'bx-range v3d-range', min: 0, max: 100, step: 1, id: `v3d-explode-${Math.random().toString(36).slice(2, 7)}` });
  const explodeOut = h('output', { class: 'v3d-out bx-mono', for: explodeRange.id });
  const explodeLbl = h('label', { class: 'bx-label v3d-lbl', for: explodeRange.id }, 'Explode');
  const swatches = h('div', { class: 'v3d-swatches', role: 'radiogroup', 'aria-label': 'Material' });
  const swatchBtns = MATERIAL_CHOICES.map((m) => {
    const b = h('button', { type: 'button', role: 'radio', class: 'v3d-swatch', 'data-material': m.id, title: m.label, 'aria-label': m.label });
    b.style.setProperty('--face', m.swatch);
    b.style.setProperty('--cut', m.edge);
    b.addEventListener('click', () => setMaterial(m.id));
    swatches.append(b);
    return b;
  });
  swatches.addEventListener('keydown', (e) => {
    const i = swatchBtns.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const nb = swatchBtns[(i + d + swatchBtns.length) % swatchBtns.length]!;
    nb.focus();
    nb.click();
  });
  const partSel = h('select', { class: 'v3d-select', 'aria-label': 'Selected part' });
  partSel.addEventListener('change', () => selectFromViewer(partSel.value || null, 'focus'));
  const bar = h(
    'div',
    { class: 'v3d-bar' },
    h('div', { class: 'v3d-field v3d-field--explode' }, explodeLbl, explodeRange, explodeOut),
    h('div', { class: 'v3d-field' }, h('span', { class: 'bx-label v3d-lbl', 'aria-hidden': 'true' }, 'Material'), swatches),
    h('div', { class: 'v3d-field' }, h('span', { class: 'bx-label v3d-lbl', 'aria-hidden': 'true' }, 'Part'), partSel),
  );
  el.classList.add('v3d');
  el.replaceChildren(view, bar, probe);

  explodeRange.addEventListener('input', () => store.set({ exploded: Number(explodeRange.value) / 100 }));

  // ── Scene ──────────────────────────────────────────────────────────────
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 1, 10000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.14;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.zoomToCursor = true;

  // The room scene is kept so the environment map can be rebuilt after a context restore.
  const room = new RoomEnvironment();
  let envRT: WebGLRenderTarget | null = null;
  function buildEnvironment(): void {
    envRT?.dispose();
    const pmrem = new PMREMGenerator(renderer);
    envRT = pmrem.fromScene(room, 0.04);
    pmrem.dispose();
    scene.environment = envRT.texture;
  }
  cleanup.push(() => {
    envRT?.dispose();
    room.dispose();
  });
  buildEnvironment();
  scene.environmentIntensity = 0.4;

  const hemi = new HemisphereLight(0xfff8ee, 0xd9cbb2, 0.55);
  const key = new DirectionalLight(0xffeedd, 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  const fill = new DirectionalLight(0xdfe8ff, 0.55);
  scene.add(hemi, key, key.target, fill);

  const root = new Group(); // carries the explode "lift"
  scene.add(root);

  // Floor: faded drafting grid, soft contact shadow, cast shadow catcher.
  const gridMat = gridMaterial();
  const floorGeo = new PlaneGeometry(1, 1);
  const grid = new Mesh(floorGeo, gridMat);
  grid.renderOrder = -3;
  const contactTex = contactTexture();
  const contactMat = new MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.2 });
  const contact = new Mesh(floorGeo, contactMat);
  contact.renderOrder = -2;
  const shadowMat = new ShadowMaterial({ opacity: 0.2, depthWrite: false, transparent: true });
  const shadowCatcher = new Mesh(floorGeo, shadowMat);
  shadowCatcher.receiveShadow = true;
  shadowCatcher.renderOrder = -1;
  scene.add(grid, contact, shadowCatcher);

  // Section cut: one plane (kept far away when off, so toggling never recompiles shaders).
  const OFF = 1e7;
  const clip = new Plane(new Vector3(0, 1, 0), OFF);
  const clipPlanes = [clip];
  const stencilBack = new MeshBasicMaterial({
    side: BackSide, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: clipPlanes,
    stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilFail: IncrementWrapStencilOp, stencilZFail: IncrementWrapStencilOp, stencilZPass: IncrementWrapStencilOp,
  });
  const stencilFront = new MeshBasicMaterial({
    side: FrontSide, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: clipPlanes,
    stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilFail: DecrementWrapStencilOp, stencilZFail: DecrementWrapStencilOp, stencilZPass: DecrementWrapStencilOp,
  });
  const capMat = new MeshStandardMaterial({
    color: 0xc9a97a, roughness: 0.95, metalness: 0, side: DoubleSide,
    stencilWrite: true, stencilRef: 0, stencilFunc: NotEqualStencilFunc, stencilFail: ReplaceStencilOp, stencilZFail: ReplaceStencilOp, stencilZPass: ReplaceStencilOp,
  });
  const capGeo = new PlaneGeometry(1, 1).rotateX(Math.PI / 2); // normal -y: faces the removed half
  const cap = new Mesh(capGeo, capMat);
  cap.renderOrder = 2;
  cap.visible = false;
  cap.onAfterRender = (r) => r.clearStencil();
  scene.add(cap);

  // Outlines.
  const inkLine = new LineMaterial({ linewidth: 1.25, transparent: true, opacity: 0.85, clippingPlanes: clipPlanes });
  const hoverLine = new LineMaterial({ linewidth: 1.6, transparent: true, opacity: 0.95, clippingPlanes: clipPlanes });
  const selLine = new LineMaterial({ linewidth: 2.4, transparent: true, opacity: 1, clippingPlanes: clipPlanes });
  const xrayLine = new LineMaterial({ linewidth: 1.2, transparent: true, opacity: 0.55, depthTest: false, dashed: true, dashSize: 3, gapSize: 2, clippingPlanes: clipPlanes });
  const ghostLine = new LineMaterial({ linewidth: 1, transparent: true, opacity: 0.5, depthWrite: false, clippingPlanes: clipPlanes });
  const lineMats = [inkLine, hoverLine, selLine, xrayLine, ghostLine];

  // ── State ──────────────────────────────────────────────────────────────
  const entries = new Map<string, Entry>();
  let parts: Part[] = [];
  let genView: GeneratorView | undefined;
  let homeDir = DIR0.clone();
  let lightDir = LIGHT_DIR0.clone();
  let clipN = new Vector3(0, 1, 0); // section plane normal: the kept half is away from the home view
  let materialId: MaterialId = readMaterial();
  let palette = readPalette();
  let mats: MaterialSet = createMaterialSet(materialId, { anisotropy: renderer.capabilities.getMaxAnisotropy(), clippingPlanes: clipPlanes, accent: palette.accent });
  let selected: string | null = store.state.selectedPart;
  let hovered: string | null = null;
  let explodeCur = store.state.exploded;
  let explodeTarget = store.state.exploded;
  let sectionOn = false;
  let assembled = new Box3(); // assembled bounds
  let radius = 100;
  let size = { w: 0, h: 0 };
  /**
   * Automatic framing the camera follows (the whole model, or the focused part) — kept through
   * geometry edits, explode and resizes until the user pans or zooms away from it. Orbiting alone
   * keeps it (target and distance stay put).
   */
  let auto: Auto | null = { kind: 'all' };
  let autoAt: { target: Vector3; dist: number } | null = null;
  let pendingFocus = false; // selection changed while hidden
  let tween: { p0: Vector3; t0: Vector3; dir: Vector3; start: number; dur: number } | null = null;
  let raf = 0;
  let lastFrame = 0;
  let frames = 0;
  let builds = 0;
  let destroyed = false;
  cleanup.push(() => {
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    controls.dispose();
    mats.dispose();
  });
  let lost = false;

  // ── Palette ────────────────────────────────────────────────────────────
  function token(name: string): string {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  }
  function readPalette(): Palette {
    const bgCss = token('--bg');
    const bg = new Color().setStyle(bgCss);
    const hsl = { h: 0, s: 0, l: 0 };
    bg.getHSL(hsl);
    const dark = hsl.l < 0.4;
    return {
      ink: new Color().setStyle(token('--ink')),
      accent: new Color().setStyle(token('--accent')),
      bg,
      bgCss,
      gridMinor: new Color().setStyle(token('--grid-major')),
      gridMajor: new Color().setStyle(token('--rule')),
      shadow: new Color().setStyle(dark ? '#000000' : '#3a2a17'),
      dark,
    };
  }
  function applyPalette(): void {
    palette = readPalette();
    // Ink outlines read as drawn lines on paper; on the blueprint they soften to chalk.
    inkLine.color.copy(palette.dark ? palette.bg.clone().lerp(new Color(0x000000), 0.35) : palette.ink);
    inkLine.opacity = (palette.dark ? 0.9 : 0.78) * mats.lineOpacity;
    // Ghost outlines float over the background as well as the wood: on the blueprint they use the
    // ink half way to the dark wood outline, which alone would vanish into the background.
    ghostLine.color.copy(palette.dark ? palette.ink.clone().lerp(inkLine.color, 0.45) : inkLine.color);
    ghostLine.opacity = (palette.dark ? 0.7 : 0.5) * mats.lineOpacity;
    hoverLine.color.copy(palette.accent);
    selLine.color.copy(palette.accent);
    xrayLine.color.copy(palette.accent);
    gridMat.uniforms.cMinor!.value.copy(palette.gridMinor);
    gridMat.uniforms.cMajor!.value.copy(palette.gridMajor);
    gridMat.uniforms.opacity!.value = palette.dark ? 0.9 : 1;
    shadowMat.color.copy(palette.shadow);
    shadowMat.opacity = palette.dark ? 0.38 : 0.2;
    contactMat.color.copy(palette.shadow);
    contactMat.opacity = palette.dark ? 0.5 : 0.24;
    hemi.groundColor.copy(palette.bg);
    mats.setAccent(palette.accent);
    invalidate();
  }
  const unTheme = onThemeChange(() => applyPalette());
  cleanup.push(unTheme);

  // ── Materials ──────────────────────────────────────────────────────────
  function readMaterial(): MaterialId {
    try {
      const v = localStorage.getItem(MATERIAL_KEY);
      return isMaterialId(v) ? v : 'birch';
    } catch {
      return 'birch';
    }
  }
  function setMaterial(id: MaterialId): void {
    if (id !== materialId) {
      materialId = id;
      try {
        localStorage.setItem(MATERIAL_KEY, id);
      } catch {
        /* not persisted */
      }
      const old = mats;
      mats = createMaterialSet(id, { anisotropy: renderer.capabilities.getMaxAnisotropy(), clippingPlanes: clipPlanes, accent: palette.accent });
      for (const e of entries.values()) {
        e.mesh.castShadow = !mats.transparent;
      }
      capMat.color.copy(mats.cap);
      old.dispose();
      applyPalette();
      applyVariants();
    }
    for (const b of swatchBtns) {
      const on = b.dataset.material === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
  function variantOf(id: string): Variant {
    return id === selected ? 'selected' : id === hovered ? 'hover' : 'normal';
  }
  function applyVariants(): void {
    for (const [id, e] of entries) {
      const v = variantOf(id);
      e.mesh.material = mats.slots[v];
      e.mesh.visible = !e.ghost || v === 'selected';
      e.lines.material = v === 'selected' ? selLine : v === 'hover' ? hoverLine : e.ghost ? ghostLine : inkLine;
      e.stencil.forEach((m) => (m.visible = sectionOn && e.mesh.visible));
      e.xray.visible = v === 'selected';
      e.lines.renderOrder = v === 'normal' ? 0 : 1;
    }
    invalidate();
  }

  // ── Parts ──────────────────────────────────────────────────────────────
  function disposeEntry(e: Entry): void {
    root.remove(e.group);
    e.geom.dispose();
    e.lineGeom.dispose();
  }

  function makeEntry(p: Part): Entry {
    builds++;
    const geom = partToGeometry(p);
    // Outline exactly where normals are not smoothed, from the part's loops (see partEdgeLines).
    const lineGeom = new LineSegmentsGeometry().setPositions(partEdgeLines(p));
    const mesh = new Mesh(geom, mats.slots.normal);
    mesh.castShadow = !mats.transparent;
    mesh.receiveShadow = true;
    mesh.userData.part = p.id;
    const lines = new LineSegments2(lineGeom, inkLine);
    const xray = new LineSegments2(lineGeom, xrayLine);
    xray.computeLineDistances();
    xray.renderOrder = 5;
    xray.visible = false;
    const sb = new Mesh(geom, stencilBack);
    const sf = new Mesh(geom, stencilFront);
    sb.renderOrder = sf.renderOrder = 1;
    sb.visible = sf.visible = sectionOn;
    const group = new Group();
    group.add(mesh, lines, xray, sb, sf);
    // Bent parts: the normal at the middle of the outline's x-extent.
    const n = p.bend ? bendFrameAt(p, (partXRange(p)[0] + partXRange(p)[1]) / 2).n : placementNormal(p.placement);
    return {
      part: p, key: partKey(p), group, mesh, geom, lineGeom, lines, xray, stencil: [sb, sf],
      bounds: partBounds(p), dir: new Vector3(), outward: new Vector3(-n[0], -n[1], -n[2]), ghost: false,
    };
  }

  function setParts(next: Part[] | null, nextView?: GeneratorView): void {
    parts = next ?? [];
    const turned = (nextView?.turn ?? 0) !== (genView?.turn ?? 0);
    genView = nextView;
    if (turned) {
      homeDir = turnToView(DIR0, genView);
      lightDir = turnToView(LIGHT_DIR0, genView);
      clipN = turnToView(new Vector3(0, 1, 0), genView);
      cap.rotation.z = ((genView?.turn ?? 0) * Math.PI) / 180;
    }
    const seen = new Set<string>();
    for (const p of parts) {
      seen.add(p.id);
      const old = entries.get(p.id);
      const k = partKey(p);
      if (old && old.key === k) {
        old.part = p;
        continue;
      }
      if (old) disposeEntry(old);
      const e = makeEntry(p);
      entries.set(p.id, e);
      root.add(e.group);
    }
    for (const [id, e] of entries) {
      if (!seen.has(id)) {
        disposeEntry(e);
        entries.delete(id);
      }
    }
    for (const [id, e] of entries) e.ghost = isGhost(genView, id);
    const dirs = explodeOffset(parts, 1);
    for (const [id, e] of entries) e.dir.copy(dirs.get(id) ?? new Vector3());
    assembled = new Box3();
    for (const e of entries.values()) assembled.union(e.bounds);
    layoutStage();
    applyVariants();
    syncPartSelect();
    applyExplode();
    if (auto?.kind === 'part' && !entries.has(auto.id)) auto = { kind: 'all' };
    if (turned) {
      // A generator with another home side: start over from its home view.
      auto = { kind: 'all' };
      applyAuto(false, homeDir.clone());
    } else if (auto) applyAuto(frames > 0 && visible());
    updateLabel();
    invalidate();
  }

  /** Floor, grid, lights, shadow frustum, clip plane and camera limits for the current model. */
  function layoutStage(): void {
    if (assembled.isEmpty()) return;
    const c = assembled.getCenter(new Vector3());
    const s = assembled.getSize(new Vector3());
    radius = Math.max(s.length() / 2, 1);
    // Exploded extents bound the shadow frustum, so it never needs updating mid-animation.
    const reach = new Box3().copy(assembled);
    for (const e of entries.values()) reach.union(e.bounds.clone().translate(e.dir));
    const rr = Math.max(reach.getSize(new Vector3()).length() / 2, radius);
    const floorZ = assembled.min.z;
    const span = rr * 7;
    grid.scale.set(span, span, 1);
    grid.position.set(c.x, c.y, floorZ - 0.02);
    shadowCatcher.scale.set(span, span, 1);
    shadowCatcher.position.set(c.x, c.y, floorZ - 0.01);
    contact.scale.set(s.x * 1.5 + radius * 0.25, s.y * 1.5 + radius * 0.25, 1);
    contact.position.set(c.x, c.y, floorZ - 0.015);
    const minor = niceStep(radius / 9);
    gridMat.uniforms.minor!.value = minor;
    gridMat.uniforms.major!.value = minor * 5;
    gridMat.uniforms.fade!.value = rr * 2.2;
    (gridMat.uniforms.centre!.value as Vector2).set(c.x, c.y);

    key.position.copy(c).addScaledVector(lightDir, rr * 4);
    key.target.position.copy(c);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -rr * 1.25;
    sc.right = sc.top = rr * 1.25;
    sc.near = rr * 0.5;
    sc.far = rr * 8;
    sc.updateProjectionMatrix();
    key.shadow.normalBias = (rr * 2.5) / 2048;
    fill.position.copy(c).add(new Vector3(rr * 3, rr * 2.5, rr * 1.5));

    camera.near = radius * 0.02;
    camera.far = radius * 60;
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.25;
    controls.maxDistance = radius * 14;
    xrayLine.dashSize = radius * 0.025;
    xrayLine.gapSize = radius * 0.018;

    clip.normal.copy(clipN);
    clip.constant = sectionOn ? -clipN.dot(c) : OFF;
    cap.position.set(c.x, c.y, c.z);
    cap.scale.set(rr * 6, 1, rr * 6);
  }

  // ── Explode ────────────────────────────────────────────────────────────
  function applyExplode(): void {
    let minZ = Infinity;
    for (const e of entries.values()) {
      e.group.position.copy(e.dir).multiplyScalar(explodeCur);
      minZ = Math.min(minZ, e.bounds.min.z + e.group.position.z);
    }
    // Lift so the lowest part rests on the floor instead of sinking through it.
    root.position.z = entries.size && Number.isFinite(minZ) ? Math.max(0, assembled.min.z - minZ) : 0;
    explodeRange.value = String(Math.round(explodeTarget * 100));
    explodeOut.value = `${Math.round(explodeTarget * 100)} %`;
    explodeRange.setAttribute('aria-valuetext', `${Math.round(explodeTarget * 100)} percent`);
  }
  /** Advance the explode ease; true when the parts moved this frame. */
  function stepExplode(dt: number): boolean {
    if (explodeCur === explodeTarget) return false;
    if (reducedMotion()) explodeCur = explodeTarget;
    else {
      explodeCur += (explodeTarget - explodeCur) * (1 - Math.exp(-dt / EXPLODE_TAU));
      if (Math.abs(explodeTarget - explodeCur) < 5e-4) explodeCur = explodeTarget;
    }
    applyExplode();
    return true;
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  function fitDistance(r: number): number {
    const vf = (camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * Math.max(camera.aspect, 0.1));
    return r / Math.sin(Math.min(vf, hf) / 2);
  }
  /** Camera position and target that frame `a` from direction `dir`, at current explode. */
  function goal(a: Auto, dir: Vector3): { pos: Vector3; target: Vector3 } | null {
    const b = new Box3();
    let margin = 1.08;
    if (a.kind === 'all') {
      for (const e of entries.values()) b.union(e.bounds.clone().translate(e.group.position).translate(root.position));
    } else {
      const e = entries.get(a.id);
      if (!e) return null;
      b.copy(e.bounds).translate(e.group.position).translate(root.position);
      margin = 1.35;
    }
    if (b.isEmpty()) return null;
    const target = b.getCenter(new Vector3());
    const r = Math.max(b.getSize(new Vector3()).length() / 2, a.kind === 'part' ? radius * 0.3 : 1);
    return { pos: target.clone().addScaledVector(dir, fitDistance(r) * margin), target };
  }
  /** Move the camera to the automatic framing (eased, unless `animate` is false or motion is reduced). */
  function applyAuto(animate: boolean, dir = currentDir()): void {
    if (!auto) return;
    if (animate && !reducedMotion()) {
      tween = { p0: camera.position.clone(), t0: controls.target.clone(), dir: dir.clone(), start: performance.now(), dur: FOCUS_MS };
      invalidate();
      return;
    }
    tween = null;
    const g = goal(auto, dir);
    if (!g) return;
    autoAt = { target: g.target.clone(), dist: g.pos.distanceTo(g.target) };
    camera.position.copy(g.pos);
    controls.target.copy(g.target);
    controls.update();
    invalidate();
  }
  function stepTween(now: number): boolean {
    if (!tween) return false;
    const g = auto ? goal(auto, tween.dir) : null;
    if (!g) {
      tween = null;
      return false;
    }
    const k = Math.min(1, (now - tween.start) / tween.dur);
    const e = easeOut(k);
    camera.position.lerpVectors(tween.p0, g.pos, e);
    controls.target.lerpVectors(tween.t0, g.target, e);
    if (k >= 1) {
      tween = null;
      autoAt = { target: g.target.clone(), dist: g.pos.distanceTo(g.target) };
    }
    return tween !== null;
  }
  function currentDir(): Vector3 {
    const d = camera.position.clone().sub(controls.target);
    return d.lengthSq() > 1e-9 ? d.normalize() : homeDir.clone();
  }
  /** Direction for focusing a part: lean towards its outer face so neighbours don't hide it. */
  function partDir(id: string): Vector3 {
    const e = entries.get(id);
    const d = currentDir();
    if (!e) return d;
    d.addScaledVector(e.outward, 0.7);
    d.z = Math.max(d.z, 0.35);
    return d.normalize();
  }
  function resetView(): void {
    auto = { kind: 'all' };
    applyAuto(visible(), homeDir.clone());
  }
  /** After a user camera change: keep following only while target and distance are untouched. */
  function checkAuto(): void {
    if (!auto || tween || !autoAt) return;
    const tol = radius * 1e-3;
    const dist = camera.position.distanceTo(controls.target);
    if (controls.target.distanceTo(autoAt.target) > tol || Math.abs(dist - autoAt.dist) > tol) auto = null;
  }

  // ── Section ────────────────────────────────────────────────────────────
  function setSection(on: boolean): void {
    sectionOn = on;
    btnSection.setAttribute('aria-pressed', String(on));
    cap.visible = on;
    capMat.color.copy(mats.cap);
    for (const e of entries.values()) e.stencil.forEach((m) => (m.visible = on && e.mesh.visible));
    const c = assembled.isEmpty() ? new Vector3() : assembled.getCenter(new Vector3());
    clip.normal.copy(clipN);
    clip.constant = on ? -clipN.dot(c) : OFF;
    updateLabel();
    invalidate();
  }

  // ── Selection ──────────────────────────────────────────────────────────
  function syncPartSelect(): void {
    const opts = [h('option', { value: '' }, 'None'), ...parts.map((p) => h('option', { value: p.id }, p.name))];
    partSel.replaceChildren(...opts);
    partSel.value = selected && entries.has(selected) ? selected : '';
  }
  function updateLabel(): void {
    const s = selected ? entries.get(selected) : undefined;
    const n = parts.length;
    canvas.setAttribute(
      'aria-label',
      `3D assembly, ${n} part${n === 1 ? '' : 's'}${s ? `, ${s.part.name} selected` : ''}${sectionOn ? ', section view' : ''}`,
    );
    if (s) {
      const b = pathBounds(s.part.nominal.outline);
      const u = store.state.units;
      chip.textContent = `${s.part.name} · ${formatLength(b.max.x - b.min.x, u)} × ${formatLength(b.max.y - b.min.y, u)} × ${formatLength(s.part.thickness, u)}`;
      chip.hidden = false;
    } else chip.hidden = true;
  }
  /**
   * Where the current selection change comes from. Selections made from outside the viewer (the
   * Sheet view) and explicit focus actions (the part list, double-click) frame the part; plain
   * clicks and Escape inside the viewer leave the camera where the user put it.
   */
  let selectOrigin: 'outside' | 'inside' | 'focus' = 'outside';
  function selectFromViewer(id: string | null, origin: 'inside' | 'focus'): void {
    selectOrigin = origin;
    try {
      store.set({ selectedPart: id });
    } finally {
      selectOrigin = 'outside';
    }
  }
  function focusPart(id: string): void {
    if (!entries.has(id)) return;
    auto = { kind: 'part', id };
    applyAuto(visible(), partDir(id));
  }
  function applySelection(origin: 'outside' | 'inside' | 'focus'): void {
    selected = store.state.selectedPart;
    partSel.value = selected && entries.has(selected) ? selected : '';
    applyVariants();
    updateLabel();
    if (origin === 'inside') {
      // Stop following a part that is no longer the selection; never move the camera here.
      if (auto?.kind === 'part' && auto.id !== selected) auto = null;
      return;
    }
    if (!visible()) {
      pendingFocus = true;
      return;
    }
    if (selected && entries.has(selected)) {
      auto = { kind: 'part', id: selected };
      applyAuto(true, partDir(selected));
    } else if (!selected) {
      auto = { kind: 'all' };
      applyAuto(true);
    }
  }

  // ── Picking ────────────────────────────────────────────────────────────
  const ray = new Raycaster();
  function pick(clientX: number, clientY: number): string | null {
    const r = canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // Ghosts are see-through: clicks go to the parts behind them (the part list selects them).
    const hits = ray.intersectObjects([...entries.values()].filter((e) => e.mesh.visible).map((e) => e.mesh), false);
    for (const hit of hits) if (clip.distanceToPoint(hit.point) >= 0) return (hit.object.userData.part as string) ?? null;
    return null;
  }
  let down: { x: number; y: number; id: number } | null = null;
  const onDown = (e: PointerEvent): void => {
    if (e.button === 0) down = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  let tap: { x: number; y: number } | null = null; // the press that ended as a click (no drag)
  const onUp = (e: PointerEvent): void => {
    const d = down;
    down = null;
    tap = d && d.id === e.pointerId && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= CLICK_SLOP ? d : null;
  };
  const onClick = (e: MouseEvent): void => {
    if (!tap) return;
    tap = null;
    const id = pick(e.clientX, e.clientY);
    if (e.detail >= 2) {
      // Double-click: an explicit focus action on the part under the pointer.
      if (!id) return;
      if (store.state.selectedPart === id) focusPart(id);
      else selectFromViewer(id, 'focus');
      return;
    }
    selectFromViewer(id && id !== store.state.selectedPart ? id : null, 'inside');
  };
  let hoverRaf = 0;
  let hoverAt = { x: 0, y: 0 };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    hoverAt = { x: e.clientX, y: e.clientY };
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      setHover(pick(hoverAt.x, hoverAt.y));
    });
  };
  const onLeave = (): void => setHover(null);
  function setHover(id: string | null): void {
    if (id === hovered) return;
    hovered = id;
    canvas.style.cursor = id ? 'pointer' : '';
    applyVariants();
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && store.state.selectedPart) selectFromViewer(null, 'inside');
  };
  view.addEventListener('keydown', onKey);
  controls.addEventListener('start', () => {
    if (tween) {
      tween = null;
      auto = null;
    }
  });
  controls.addEventListener('change', () => {
    checkAuto();
    invalidate();
  });

  // ── Rendering ──────────────────────────────────────────────────────────
  const visible = (): boolean => size.w > 0 && size.h > 0;
  function invalidate(): void {
    if (raf || destroyed || lost) return;
    raf = requestAnimationFrame(frame);
  }
  function frame(now: number): void {
    raf = 0;
    if (!visible()) return;
    const dt = lastFrame ? Math.min(now - lastFrame, 100) : 16;
    lastFrame = now;
    const moved = stepExplode(dt);
    if (moved && auto && !tween) applyAuto(false); // follow the explode
    let again = explodeCur !== explodeTarget;
    again = stepTween(now) || again;
    again = controls.update() || again;
    renderer.render(scene, camera);
    frames++;
    if (again) invalidate();
    else lastFrame = 0;
  }

  function resize(): void {
    const r = view.getBoundingClientRect();
    const w = Math.floor(r.width);
    const hh = Math.floor(r.height);
    const was = visible();
    size = { w, h: hh };
    if (!visible()) return;
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
    for (const m of lineMats) m.resolution.set(w, hh);
    if (!was) {
      if (pendingFocus) {
        pendingFocus = false;
        auto = selected && entries.has(selected) ? { kind: 'part', id: selected } : { kind: 'all' };
        applyAuto(false, auto.kind === 'part' ? partDir(auto.id) : currentDir());
      } else applyAuto(false);
    } else if (auto && !tween) applyAuto(false); // keep the framing through aspect changes
    // Render synchronously so a resize never shows a stretched frame.
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    frame(performance.now());
  }
  const ro = new ResizeObserver(resize);
  cleanup.push(() => ro.disconnect());
  ro.observe(view);

  const onLost = (e: Event): void => {
    e.preventDefault();
    lost = true;
    notice.textContent = 'The 3D view paused: the graphics context was lost. It will come back on its own.';
    notice.hidden = false;
  };
  const onRestored = (): void => {
    lost = false;
    notice.hidden = true;
    buildEnvironment(); // the PMREM target died with the old context
    invalidate();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const unStore = store.subscribe((s, prev) => {
    if (s.selectedPart !== prev.selectedPart) applySelection(selectOrigin);
    if (s.exploded !== prev.exploded) {
      explodeTarget = s.exploded;
      applyExplode();
      invalidate();
    }
    if (s.units !== prev.units) updateLabel();
  });
  cleanup.push(unStore);

  // ── Init ───────────────────────────────────────────────────────────────
  camera.position.copy(homeDir).multiplyScalar(400);
  controls.target.set(0, 0, 0);
  capMat.color.copy(mats.cap);
  if (selected) {
    // Selected elsewhere (the Sheet view) before the 3D view existed: open framed on it.
    auto = { kind: 'part', id: selected };
    pendingFocus = true;
  }
  setMaterial(materialId);
  // Picking a stock profile (e.g. cast acrylic) shows that stock, unless the current material
  // already reads as it (walnut is plywood too), so a deliberate swatch choice is not overridden.
  const onLook = (e: Event): void => {
    const look = (e as CustomEvent<MaterialLook>).detail;
    if (look === 'plywood' || look === 'mdf' || look === 'acrylic') setMaterial(material3dFor(look, materialId));
  };
  addEventListener(LOOK_EVENT, onLook);
  cleanup.push(() => removeEventListener(LOOK_EVENT, onLook));
  applyPalette();
  applyExplode();

  const debug: ViewerDebug = {
    screenPoint(id) {
      const e = entries.get(id);
      if (!e) return null;
      const c = e.bounds.getCenter(new Vector3()).add(e.group.position).add(root.position).project(camera);
      if (Math.abs(c.x) > 1 || Math.abs(c.y) > 1) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
    },
    partAt: (x, y) => pick(x, y),
    frames: () => frames,
    builds: () => builds,
    explode: () => explodeCur,
    sample() {
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const hh = gl.drawingBufferHeight;
      const px = new Uint8Array(w * hh * 4);
      gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const seen = new Set<number>();
      let drawn = 0;
      let n = 0;
      for (let i = 0; i < px.length; i += 4 * 7) {
        n++;
        if (px[i + 3]! > 8) drawn++;
        seen.add(((px[i]! >> 3) << 10) | ((px[i + 1]! >> 3) << 5) | (px[i + 2]! >> 3));
      }
      return { distinct: seen.size, coverage: drawn / Math.max(n, 1) };
    },
    isAnimating: () => raf !== 0 || tween !== null || explodeCur !== explodeTarget,
  };
  (el as HTMLElement & { __v3d?: ViewerDebug }).__v3d = debug;

  const handle: ViewerHandle = {
    el,
    setParts,
    async screenshot() {
      if (!visible()) return;
      const ratio = renderer.getPixelRatio();
      const out = document.createElement('canvas');
      try {
        renderer.setPixelRatio(Math.max(2, ratio));
        renderer.setSize(size.w, size.h, false);
        renderer.render(scene, camera);
        out.width = canvas.width;
        out.height = canvas.height;
        const ctx = out.getContext('2d')!;
        ctx.fillStyle = palette.bgCss;
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(canvas, 0, 0);
      } finally {
        renderer.setPixelRatio(ratio);
        renderer.setSize(size.w, size.h, false);
        invalidate();
      }
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `${opts.fileBase?.() ?? 'kerflab'}-3d.png` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      ro.disconnect();
      unStore();
      unTheme();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      view.removeEventListener('keydown', onKey);
      controls.dispose();
      for (const e of entries.values()) disposeEntry(e);
      entries.clear();
      mats.dispose();
      const owned: Material[] = [gridMat, contactMat, shadowMat, stencilBack, stencilFront, capMat, ...lineMats];
      for (const m of owned) m.dispose();
      floorGeo.dispose();
      capGeo.dispose();
      contactTex.dispose();
      envRT?.dispose();
      room.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      delete (el as HTMLElement & { __v3d?: ViewerDebug }).__v3d;
      el.replaceChildren();
      el.classList.remove('v3d');
    },
  };
  return handle;
}
