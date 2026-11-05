/**
 * Picker thumbnails: a small 3D render of each generator's default assembly, falling back to the
 * cut-sheet drawing while three.js loads, when WebGL is unavailable or software-only, or when a
 * build fails.
 *
 * Renders are lazy and cheap on the main thread: only thumbnails on screen (IntersectionObserver)
 * are queued, and the queue is drained in idle time, one render per idle slice at minimum. Results
 * are cached in memory and in localStorage, keyed by generator id plus a hash of its default
 * params, its build code and RENDER_VERSION, so a reload paints them at once. At most MAX_THUMBS
 * images are stored (the oldest written go first), and clearThumbCache frees them all when
 * something more important (a user preset) needs the space. Storage is optional: every access
 * is guarded and a blocked or full storage just means re-rendering.
 *
 * This module never imports three.js; views/thumbs3d.ts is loaded on first need.
 */
import type { Generator } from '../../core/part';
import { defaults } from '../../core/schema';

/** Bump when the look of the renders changes, to retire every cached image. */
export const RENDER_VERSION = 4;
/** Render size in device pixels (2× the largest CSS size, 52 × 39). */
export const THUMB_W = 120;
export const THUMB_H = 90;
const PREFIX = 'kerflab:thumb3d:';
/** Ids of the stored images, oldest written first (JSON array). */
const INDEX = 'kerflab:thumb3d-index';
/** Stored images at most: enough for any category, small enough (~0.5 MB) to leave room for presets. */
export const MAX_THUMBS = 32;
/** Release the GL context after this long with nothing to draw. */
const IDLE_DISPOSE_MS = 4000;
/** A single render slower than this switches 3D thumbnails off for the session. */
const TOO_SLOW_MS = 400;

type Keyed = Pick<Generator, 'id' | 'schema' | 'build'> & Pick<Partial<Generator>, 'view'>;

/** FNV-1a, 32-bit, as 8 hex digits. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Cache key: what the picture depends on (default params, build code) and the render version. */
export function thumbKey(g: Keyed): string {
  let params = '';
  try {
    params = JSON.stringify(defaults(g.schema));
  } catch {
    /* a schema without defaults still gets a (less specific) key */
  }
  const look = g.view ? `${g.view.turn ?? 0}\n${g.view.ghost?.toString() ?? ''}` : '';
  return `v${RENDER_VERSION}-${hashString(`${params}\n${g.build.toString()}${look ? `\n${look}` : ''}`)}`;
}

export type ThumbStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): ThumbStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** A cached image for `id` made under `key`, or null (missing, stale, unreadable or malformed). */
export function readCached(id: string, key: string, storage: ThumbStorage | null = defaultStorage()): string | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(PREFIX + id);
    if (!v) return null;
    const i = v.indexOf('\n');
    if (i < 0 || v.slice(0, i) !== key) return null;
    const url = v.slice(i + 1);
    return url.startsWith('data:image/') ? url : null;
  } catch {
    return null;
  }
}

function readIndex(storage: ThumbStorage): string[] {
  try {
    const v: unknown = JSON.parse(storage.getItem(INDEX) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Store an image, dropping the oldest stored ones beyond MAX_THUMBS; failures (blocked storage,
 * quota) are ignored. Returns whether it stuck.
 */
export function writeCached(id: string, key: string, url: string, storage: ThumbStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const index = [...readIndex(storage).filter((x) => x !== id), id];
    while (index.length > MAX_THUMBS) storage.removeItem(PREFIX + index.shift()!);
    storage.setItem(INDEX, JSON.stringify(index));
    storage.setItem(PREFIX + id, `${key}\n${url}`);
    return true;
  } catch {
    try {
      storage.removeItem(PREFIX + id); // never leave a half-written or stale entry behind
    } catch {
      /* nothing more to do */
    }
    return false;
  }
}

/**
 * Remove every stored image (they are only a cache) to free storage, e.g. when saving a preset
 * hits the quota. Also sweeps entries an older version left outside the index. Returns how many
 * were removed.
 */
export function clearThumbCache(storage: (ThumbStorage & Partial<Pick<Storage, 'key' | 'length'>>) | null = defaultStorage()): number {
  if (!storage) return 0;
  let n = 0;
  try {
    const ids = new Set(readIndex(storage).map((id) => PREFIX + id));
    if (typeof storage.key === 'function' && typeof storage.length === 'number')
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(PREFIX)) ids.add(k);
      }
    for (const k of ids) {
      if (storage.getItem(k) !== null) n++;
      storage.removeItem(k);
    }
    storage.removeItem(INDEX);
  } catch {
    /* blocked: nothing to free */
  }
  return n;
}

// ── Runtime: memory cache, observer, idle queue, lazy renderer ───────────

const memory = new Map<string, { key: string; url: string }>();

/** A ready 3D image for `g` from memory or storage, else null. */
export function cachedThumb(g: Keyed): string | null {
  const key = thumbKey(g);
  const hit = memory.get(g.id);
  if (hit && hit.key === key) return hit.url;
  const url = readCached(g.id, key);
  if (url) memory.set(g.id, { key, url });
  return url;
}

type Renderer = { render(parts: ReturnType<Generator['build']>, view?: Generator['view']): string; warm(): Promise<void>; dispose(): void };
let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let renderer: Renderer | null = null;
let disposeTimer: ReturnType<typeof setTimeout> | undefined;
/** On-screen thumbnails waiting for a render, in arrival order. */
const queue = new Map<HTMLElement, Generator>();
/** Every thumbnail still waiting for a render (observed), on screen or not. */
const pending = new Map<HTMLElement, Generator>();
let observer: IntersectionObserver | null = null;
let scheduled = false;

const query = (): URLSearchParams | null => {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return null;
  }
};
const webglForcedOff = (): boolean => !!query()?.has('nowebgl');
/** `?thumbs3d=any` renders on a software GPU too (tests run on SwiftShader). */
const allowSoftware = (): boolean => query()?.get('thumbs3d') === 'any';

/** Swap a thumbnail's content to the raster image. */
export function showImage(el: HTMLElement, url: string): void {
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.width = THUMB_W / 2;
  img.height = THUMB_H / 2;
  img.src = url;
  el.replaceChildren(img);
  el.dataset.thumb = '3d';
}

function getObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const g = pending.get(el);
        if (!g) continue;
        if (e.isIntersecting) queue.set(el, g);
        else queue.delete(el);
      }
      if (queue.size) start();
    },
    { rootMargin: '64px' },
  );
  return observer;
}

/** Ask for a 3D render of `g` into `el` once it is on screen. */
export function request3d(el: HTMLElement, g: Generator): void {
  if (state === 'failed') return;
  const io = getObserver();
  if (!io) return;
  pending.set(el, g);
  io.observe(el);
}

function forget(el: HTMLElement): void {
  pending.delete(el);
  queue.delete(el);
  observer?.unobserve(el);
}

/** Remembered for the tab's session: this GPU can't do thumbnails, so don't probe it again. */
const OFF_KEY = 'kerflab:thumb3d-off';
function offThisSession(): boolean {
  try {
    return sessionStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}

function fail(remember = false): void {
  state = 'failed';
  if (remember) {
    try {
      sessionStorage.setItem(OFF_KEY, '1');
    } catch {
      /* probe again next time */
    }
  }
  for (const el of [...pending.keys()]) forget(el);
}

function start(): void {
  if (state === 'failed') return;
  if (state === 'idle') {
    if (webglForcedOff() || (offThisSession() && !allowSoftware())) return fail();
    state = 'loading';
    const t0 = performance.now();
    import('../views/thumbs3d').then(
      (mod) => {
        try {
          const t1 = performance.now();
          const r = mod.createThumbRenderer(THUMB_W, THUMB_H, { allowSoftware: allowSoftware() });
          // Visible in the browser's performance panel (and read by tests).
          performance.measure('thumbs3d:load', { start: t0, end: t1 });
          performance.measure('thumbs3d:init', { start: t1, end: performance.now() });
          const t2 = performance.now();
          const ready = (): void => {
            performance.measure('thumbs3d:compile', { start: t2, end: performance.now() });
            renderer = r;
            state = 'ready';
            schedule();
          };
          r.warm().then(ready, ready); // a failed warm-up only means compiling on first render
        } catch {
          fail(true); // no (hardware) WebGL: the cut-sheet drawings stay
        }
      },
      () => fail(),
    );
    return;
  }
  if (state === 'ready') schedule();
}

type Idle = (cb: (d: { timeRemaining(): number; didTimeout: boolean }) => void, o?: { timeout: number }) => number;
const onIdle: Idle =
  typeof requestIdleCallback === 'function'
    ? (cb, o) => requestIdleCallback(cb, o)
    : (cb) => window.setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: true }), 16);

/**
 * The user is dragging, typing or scrolling: thumbnails wait until they stop, so a render (which
 * can take a while on a software GPU) never lands in the middle of a gesture.
 */
let lastInput = -Infinity;
let listening = false;
const QUIET_MS = 500;
function listen(): void {
  if (listening || typeof addEventListener !== 'function') return;
  listening = true;
  const mark = (): void => void (lastInput = performance.now());
  for (const t of ['pointerdown', 'keydown', 'wheel', 'input']) addEventListener(t, mark, { capture: true, passive: true });
  addEventListener('pointermove', (e) => void (e.buttons && mark()), { capture: true, passive: true });
}
/** The last render's cost; slow renders (software GL) leave the main thread longer gaps. */
let lastCost = 0;

function schedule(): void {
  if (scheduled || !queue.size) return;
  scheduled = true;
  listen();
  clearTimeout(disposeTimer);
  const wait = Math.max(QUIET_MS - (performance.now() - lastInput), Math.min(lastCost * 2, 1500), 0);
  const go = (): void => void onIdle(drain, { timeout: 400 });
  if (wait > 0) setTimeout(go, wait);
  else go();
}

function drain(deadline: { timeRemaining(): number }): void {
  scheduled = false;
  const r = renderer;
  if (!r) return start();
  if (performance.now() - lastInput < QUIET_MS) return schedule();
  let first = true;
  // At least one render per slice; more while the browser says it has idle time to spare and
  // renders are quick.
  while (queue.size && (first || (lastCost < 25 && deadline.timeRemaining() > 12))) {
    first = false;
    const [el, g] = queue.entries().next().value as [HTMLElement, Generator];
    forget(el);
    if (!el.isConnected) continue;
    const ready = cachedThumb(g);
    if (ready) {
      showImage(el, ready);
      continue;
    }
    try {
      const parts = g.build(defaults(g.schema));
      const t0 = performance.now();
      const url = r.render(parts, g.view);
      lastCost = performance.now() - t0;
      // A GPU this slow makes thumbnails cost more than they give: keep the drawings from now on.
      if (lastCost > TOO_SLOW_MS && !allowSoftware()) {
        r.dispose();
        renderer = null;
        fail(true);
      }
      performance.measure(`thumbs3d:render:${g.id}`, { start: t0, end: t0 + lastCost });
      const key = thumbKey(g);
      memory.set(g.id, { key, url });
      writeCached(g.id, key, url);
      showImage(el, url);
    } catch {
      /* this generator keeps its drawing */
    }
  }
  if (queue.size) schedule();
  else {
    clearTimeout(disposeTimer);
    disposeTimer = setTimeout(() => {
      if (queue.size || !renderer) return;
      renderer.dispose();
      renderer = null;
      if (state === 'ready') state = 'idle'; // a later request loads a fresh context
    }, IDLE_DISPOSE_MS);
  }
}
