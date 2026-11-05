/**
 * Offscreen 3D thumbnails for the generator picker: one shared WebGL renderer draws a generator's
 * assembly (assemble.ts, the viewer's meshes) in birch, with the viewer's lights and home angle, and hands back a PNG
 * data URL. Lazy-loaded (it pulls in three.js); every geometry made for a shot is disposed after
 * it, and the renderer itself is released by `dispose()`.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  EdgesGeometry,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GeneratorView, Part } from '../../core/part';
import { isGhost, partBounds, partEdgeLines, partToGeometry, turnToView } from './assemble';

/** Same home view as the 3D viewer: front-right, from above. */
const DIR = new Vector3(1.0, -1.75, 1.15).normalize();
/** Flat work (a gear, a panel) is seen from higher up, so its outline reads instead of its edge. */
const TOP_DIR = new Vector3(0.45, -0.8, 2.6).normalize();
const LIGHT_DIR = new Vector3(-0.85, -1.1, 2.3).normalize();
const FOV = 30;
/** Birch plywood (materials3d.ts): face grain base and the average of the edge plies. */
const BIRCH = { face: '#E2CBA0', edge: '#7C5839' };

export interface ThumbRenderer {
  /**
   * Render parts to a PNG data URL with a transparent background (w × h device pixels), seen from
   * the generator's home side, with its ghost parts as outlines only (GeneratorView).
   */
  render(parts: Part[], view?: GeneratorView): string;
  /** Compile the shaders off the main thread where the browser can (KHR_parallel_shader_compile). */
  warm(): Promise<void>;
  dispose(): void;
}

/** SwiftShader, llvmpipe and friends: WebGL emulated on the CPU. */
function isSoftware(r: WebGLRenderer): boolean {
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

/**
 * Throws when WebGL is unavailable, or only available as a software rasteriser (unless
 * `allowSoftware`): there a single shader compile can stall the page for seconds, too high a price
 * for decoration, so the picker keeps its cut-sheet drawings.
 */
export function createThumbRenderer(w: number, h: number, opts: { allowSoftware?: boolean } = {}): ThumbRenderer {
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: !opts.allowSoftware,
  });
  try {
    if (!opts.allowSoftware && isSoftware(renderer)) throw new Error('software WebGL');
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    const scene = new Scene();
    const room = new RoomEnvironment();
    const pmrem = new PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(room, 0.04);
    pmrem.dispose();
    room.dispose();
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.4;

    const hemi = new HemisphereLight(0xfff8ee, 0xd9cbb2, 0.55);
    const key = new DirectionalLight(0xffeedd, 1.9);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.radius = 3;
    key.shadow.bias = -0.0004;
    const fill = new DirectionalLight(0xdfe8ff, 0.55);
    // A shadow-only floor grounds the model on any background (Paper or Blueprint).
    const floorGeom = new PlaneGeometry(1, 1);
    const floorMat = new ShadowMaterial({ opacity: 0.22, depthWrite: false, transparent: true });
    const floor = new Mesh(floorGeom, floorMat);
    floor.receiveShadow = true;
    scene.add(hemi, key, key.target, fill, floor);

    // The viewer's birch, as flat colour: its procedural grain textures cost ~350 ms to paint
    // and do not read at 44 px anyway. Face and edge colours are the grain base and ply average.
    const face = new MeshStandardMaterial({ color: BIRCH.face, roughness: 0.72, metalness: 0 });
    const edge = new MeshStandardMaterial({ color: BIRCH.edge, roughness: 0.92, metalness: 0 });
    const slots = [face, edge]; // material groups: FACE_GROUP, EDGE_GROUP
    const ink = new LineBasicMaterial({ color: 0x3a2a1c, transparent: true, opacity: 0.55 });
    const ghostInk = new LineBasicMaterial({ color: 0x3a2a1c, transparent: true, opacity: 0.35, depthWrite: false });
    const camera = new PerspectiveCamera(FOV, w / h, 1, 10000);
    camera.up.set(0, 0, 1);

    return {
      async warm() {
        const probe = new Mesh(new BoxGeometry(10, 10, 3), slots);
        probe.castShadow = probe.receiveShadow = true;
        probe.geometry.clearGroups();
        probe.geometry.addGroup(0, 18, 0);
        probe.geometry.addGroup(18, Infinity, 1);
        const line = new LineSegments(new EdgesGeometry(probe.geometry), ink);
        scene.add(probe, line);
        camera.position.set(40, -60, 40);
        camera.lookAt(0, 0, 0);
        try {
          await renderer.compileAsync(scene, camera);
        } finally {
          scene.remove(probe, line);
          probe.geometry.dispose();
          line.geometry.dispose();
        }
      },
      render(parts, view) {
        const made: Object3D[] = [];
        const geoms: BufferGeometry[] = [];
        try {
          const box = new Box3();
          for (const p of parts) {
            const geom = partToGeometry(p);
            const edges = new BufferGeometry();
            edges.setAttribute('position', new BufferAttribute(partEdgeLines(p), 3));
            geoms.push(geom, edges);
            const ghost = isGhost(view, p.id);
            const mesh = new Mesh(geom, slots);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            if (!ghost) made.push(mesh);
            made.push(new LineSegments(edges, ghost ? ghostInk : ink));
            box.union(partBounds(p));
          }
          if (box.isEmpty()) throw new Error('nothing to draw');
          scene.add(...made);
          const c = box.getCenter(new Vector3());
          const size = box.getSize(new Vector3());
          const r = Math.max(size.length() / 2, 1);
          // Height against footprint: 0.35+ is a box (home view), 0.1 or less is flat (from above).
          const flat = Math.min(Math.max((0.35 - size.z / Math.max(size.x, size.y, 1e-6)) / 0.25, 0), 1);
          const dir = turnToView(DIR.clone().lerp(TOP_DIR, flat).normalize(), view);
          floor.scale.set(r * 8, r * 8, 1);
          floor.position.set(c.x, c.y, box.min.z - 0.01);
          key.position.copy(c).addScaledVector(turnToView(LIGHT_DIR, view), r * 4);
          key.target.position.copy(c);
          const sc = key.shadow.camera;
          sc.left = sc.bottom = -r * 1.3;
          sc.right = sc.top = r * 1.3;
          sc.near = r * 0.5;
          sc.far = r * 8;
          sc.updateProjectionMatrix();
          key.shadow.normalBias = (r * 2.5) / 512;
          fill.position.copy(c).add(new Vector3(r * 3, r * 2.5, r * 1.5));
          // Fit the bounding sphere into the narrower field of view, with a little air.
          const vHalf = (FOV * Math.PI) / 360;
          const half = Math.min(vHalf, Math.atan(Math.tan(vHalf) * camera.aspect));
          const dist = (r / Math.sin(half)) * 0.86;
          camera.position.copy(c).addScaledVector(dir, dist);
          camera.near = dist / 50;
          camera.far = dist * 4;
          camera.lookAt(c);
          camera.updateProjectionMatrix();
          renderer.shadowMap.needsUpdate = true;
          renderer.render(scene, camera);
          return canvas.toDataURL('image/png');
        } finally {
          for (const o of made) scene.remove(o);
          for (const g of geoms) g.dispose();
        }
      },
      dispose() {
        face.dispose();
        edge.dispose();
        ink.dispose();
        ghostInk.dispose();
        floorGeom.dispose();
        floorMat.dispose();
        envRT.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      },
    };
  } catch (e) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw e;
  }
}
