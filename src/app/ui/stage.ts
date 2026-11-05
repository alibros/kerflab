/**
 * Centre stage: "3D" and "Sheet" tabs. The Sheet tab is the pan/zoom cut layout (views/layout2d);
 * the 3D tab is the three.js assembly viewer (views/viewer3d), loaded with a dynamic import the
 * first time the tab is shown (and prefetched when the browser is idle) so three.js never delays
 * first paint. Without WebGL (or with `?nowebgl` in the URL, for testing) the 3D tab explains
 * itself and points to the Sheet tab; everything else keeps working. A failed build keeps the
 * last good drawing (dimmed) under an error banner — never a blank stage.
 */
import type { GeneratorView, Part } from '../../core/part';
import type { BuildResult } from '../build';
import type { Layout } from '../export/nest';
import type { Store } from '../store';
import type { Units } from '../units';
import type { ViewerHandle } from '../views/viewer3d';
import { tabs, type TabsHandle } from './components/tabs';
import { createLayout2D, type Layout2DHandle } from '../views/layout2d';
import { h, svg } from './dom';
import { icons } from './icons';

export type StageTab = '3d' | 'sheet';

export interface StageOptions {
  selected: StageTab;
  /** Shared app state: the 3D view reads/writes selection and explode directly. */
  store: Store;
  onSelectPart(id: string | null): void;
  onShowParam(param: string): void;
  onTab?(tab: StageTab): void;
  /** Base file name for exports (the 3D PNG). */
  fileBase?(): string;
}

export interface StageHandle {
  el: HTMLElement;
  /** `view.look`: the generator's 3D presentation hints (Generator.view). */
  render(r: BuildResult, view: { units: Units; selectedPart: string | null; title: string; look?: GeneratorView | undefined }): void;
  /** Switch the visible view (as if its tab were clicked). */
  select(tab: StageTab): void;
  destroy(): void;
}

/** True when the page asks to behave as if WebGL were missing (`?nowebgl`), for tests. */
function webglForcedOff(): boolean {
  try {
    return new URLSearchParams(location.search).has('nowebgl');
  } catch {
    return false;
  }
}

const loadViewer = (): Promise<typeof import('../views/viewer3d')> => import('../views/viewer3d');

export function buildStage(opts: StageOptions): StageHandle {
  const idle = h('p', { class: 'app-view__empty' }, 'Nothing to draw yet — fix the highlighted setting.');
  const idle3d = h('p', { class: 'app-view__empty' }, 'Nothing to draw yet — fix the highlighted setting.');
  const l2d: Layout2DHandle = createLayout2D({ onSelectPart: (id) => opts.onSelectPart(id) });
  const host3d = h('div', { class: 'v3d-host', 'data-testid': 'viewer3d' }, h('p', { class: 'v3d-loading bx-mono' }, 'Loading 3D view…'));
  const errorText = h('span', { class: 'app-stage-error__msg' });
  const errorBtn = h('button', { type: 'button', class: 'bx-btn bx-btn--sm bx-btn--secondary' }, 'Show setting');
  const errorBanner = h(
    'div',
    { class: 'app-stage-error', 'data-testid': 'stage-error', hidden: true },
    svg(icons.alert),
    h('div', {}, h('strong', {}, 'Can’t cut this yet. '), errorText),
    errorBtn,
  );

  let errorParam: string | undefined;
  errorBtn.addEventListener('click', () => errorParam && opts.onShowParam(errorParam));

  const t: TabsHandle = tabs({
    label: 'View',
    selected: opts.selected,
    tabs: [
      { id: '3d', label: '3D', content: h('div', { class: 'app-pane' }, idle3d, host3d) },
      { id: 'sheet', label: 'Sheet', content: h('div', { class: 'app-pane' }, idle, l2d.el) },
    ],
    onChange: (id) => {
      if (id === '3d') ensure3d();
      opts.onTab?.(id as StageTab);
    },
  });
  const el = h('main', { class: 'app-stage', id: 'stage', 'aria-label': 'Preview' }, errorBanner, t.el);

  let last: { parts: Part[]; layout: Layout; look?: GeneratorView | undefined } | null = null;
  let view: { units: Units; selectedPart: string | null; title: string } = { units: 'mm', selectedPart: null, title: '' };
  let viewer: ViewerHandle | null = null;
  let viewerParts: Part[] | null = null;
  let state3d: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  let destroyed = false;

  function fallback(detail: string): void {
    state3d = 'failed';
    viewer?.destroy();
    viewer = null;
    const toSheet = h('button', { type: 'button', class: 'bx-btn bx-btn--sm bx-btn--secondary' }, 'Open the Sheet view');
    toSheet.addEventListener('click', () => t.select('sheet', { focus: true }));
    host3d.replaceChildren(
      h(
        'div',
        { class: 'v3d-fallback', 'data-testid': 'webgl-fallback' },
        h('strong', {}, 'The 3D preview needs WebGL'),
        h('p', {}, `${detail} The Sheet view and SVG / DXF export work as usual.`),
        toSheet,
      ),
    );
  }

  function ensure3d(): void {
    if (state3d !== 'idle' || destroyed) return;
    if (webglForcedOff()) {
      fallback('WebGL is switched off for this page.');
      return;
    }
    state3d = 'loading';
    loadViewer().then(
      (mod) => {
        if (destroyed) return;
        try {
          viewer = mod.createViewer(host3d, opts.store, { fileBase: () => opts.fileBase?.() ?? 'kerflab' });
          state3d = 'ready';
          draw();
        } catch (e) {
          fallback(
            e instanceof mod.WebGLUnavailableError
              ? 'This browser or device has WebGL turned off or unavailable.'
              : `The 3D view couldn’t start (${e instanceof Error ? e.message : String(e)}).`,
          );
        }
      },
      () => fallback('The 3D module couldn’t be loaded — check your connection and reload.'),
    );
  }

  const draw = (): void => {
    idle.hidden = last !== null;
    l2d.el.hidden = last === null;
    idle3d.hidden = last !== null;
    host3d.hidden = last === null;
    if (!last) return;
    // The sheet view diffs itself (geometry, units, selection); the 3D view diffs per part.
    l2d.render(last, { units: view.units, selectedPart: view.selectedPart });
    if (viewer && viewerParts !== last.parts) {
      viewerParts = last.parts;
      viewer.setParts(last.parts, last.look);
    }
  };

  if (t.selected === '3d') ensure3d();
  else if (import.meta.env.PROD) {
    // (Production only: in dev, three is hundreds of unbundled modules — not worth warming.)
    // Warm the cache once the page is idle, so the first switch to 3D is instant.
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const warm = (): void => void (!destroyed && state3d === 'idle' && !webglForcedOff() && loadViewer().catch(() => undefined));
    if (ric) ric(warm, { timeout: 4000 });
    else setTimeout(warm, 2000);
  }

  return {
    el,
    render(r, v) {
      view = v;
      if (r.ok) {
        last = { parts: r.parts, layout: r.layout, look: v.look };
        errorBanner.hidden = true;
        el.classList.remove('is-stale');
      } else {
        errorParam = r.param;
        errorText.textContent = r.message;
        errorBtn.hidden = !r.param;
        errorBanner.hidden = false;
        el.classList.toggle('is-stale', last !== null);
      }
      draw();
    },
    select(tab) {
      t.select(tab);
    },
    destroy() {
      destroyed = true;
      t.destroy();
      l2d.destroy();
      viewer?.destroy();
      viewer = null;
    },
  };
}
