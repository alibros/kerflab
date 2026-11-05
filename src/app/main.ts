/**
 * App shell: wires the store to the URL, the top bar, the gallery + settings form, the stage and
 * the title-block footer. All rendering reacts to store changes; builds are throttled off the
 * input path so typing and dragging never wait on geometry.
 */
import './ui/app.css';
import type { Generator } from '../core/part';
import { getGenerator, registry } from '../generators';
import { runBuild, type BuildResult } from './build';
import { exportFiles as filesFor } from './export/files';
import { defaults, validate } from '../core/schema';
import { loadSpeed, saveSpeed } from './estimate';
import { applyPreset } from './presets';
import { staggered, trailing } from './scheduler';
import { createStore, type State, type Store } from './store';
import { decodeState, encodeState } from './url';
import { buildBottomBar } from './ui/bottombar';
import { h } from './ui/dom';
import { buildForm, type FormHandle } from './ui/form';
import { buildGallery } from './ui/gallery';
import { buildMaterialPicker, type MaterialPickerHandle } from './ui/materialpicker';
import { requestLook } from './profiles';
import { buildPresetBar } from './ui/presetbar';
import { createPalette, type Command } from './ui/palette';
import { createAbout } from './ui/aboutdialog';
import { buildStage, type StageTab } from './ui/stage';
import { getTheme, onThemeChange, resolvedTheme, setTheme } from './ui/theme';
import { createToaster } from './ui/toast';
import { buildTopbar, MOD, type ExportKind } from './ui/topbar';

/** Throttle for rebuilding geometry while the user drags or types. */
const BUILD_DELAY = 70;
const URL_DELAY = 150;
/** Gap between the files of a multi-sheet export; browsers drop downloads fired in the same tick. */
const DOWNLOAD_GAP = 150;
const TAB_KEY = 'kerflab:tab';

function readTab(): StageTab {
  try {
    return localStorage.getItem(TAB_KEY) === '3d' ? '3d' : 'sheet';
  } catch {
    return 'sheet';
  }
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountApp(root: HTMLElement): Store {
  const decoded = decodeState(location.hash);
  const { notice, ...initial } = decoded;
  delete initial.unitsInLink; // not part of the app state
  const store = createStore({ ...initial, theme: getTheme() });
  const gen = (): Generator => getGenerator(store.state.generatorId) ?? registry[0]!;

  const toaster = createToaster();
  const say = (msg: string, tone?: 'info' | 'warn'): void => toaster.show(msg, tone ? { tone } : {});

  // ── Build (throttled) ──────────────────────────────────────────────────
  let result: BuildResult = runBuild(gen(), store.state.params, store.state.sheet);
  // The trailing edge reads the latest state; exports flush it so they never see stale geometry.
  const build = trailing(() => {
    result = runBuild(gen(), store.state.params, store.state.sheet);
    paintResult();
  }, BUILD_DELAY);
  const scheduleBuild = (): void => build.schedule();
  let speed = loadSpeed();

  function copyLink(): void {
    writeUrl();
    const href = location.href;
    const done = (): void => say('Link copied — it opens this exact design.');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(href).then(done, () => say('Couldn’t reach the clipboard; copy the address bar instead.', 'warn'));
    else say('Copy the address bar — it holds this exact design.');
  }

  const about = createAbout();

  // ── Top bar ────────────────────────────────────────────────────────────
  const top = buildTopbar({
    onUnits: (u) => store.set({ units: u }),
    onUndo: () => store.undo(),
    onRedo: () => store.redo(),
    onPalette: () => palette.toggle(),
    onAbout: () => about.open(),
    onCopyLink: () => copyLink(),
    onExport: (kind) => exportFiles(kind),
  });

  // ── Left: gallery, presets, settings ───────────────────────────────────
  // A fresh visit opens the picker; a link to a design opens straight onto its settings.
  const gallery = buildGallery({ generators: registry, selected: store.state.generatorId, open: !location.hash, onSelect: (id) => store.selectGenerator(id) });
  const presetSlot = h('div', { class: 'app-side__presets' });
  const formSlot = h('div', { class: 'app-side__form' });
  const side = h(
    'aside',
    { class: 'app-side', 'aria-label': 'Generator and settings' },
    gallery.el,
    presetSlot,
    h('h2', { class: 'bx-label app-side__label' }, 'Settings'),
    formSlot,
  );

  let form: FormHandle | null = null;
  let stock: MaterialPickerHandle | null = null;
  const mountForm = (): void => {
    form?.destroy();
    const g = gen();
    const tDef = g.schema.find((d) => d.key === 'thickness');
    const hasStock = !!tDef && g.schema.some((d) => d.key === 'kerf');
    stock = hasStock
      ? buildMaterialPicker({
          params: store.state.params,
          units: store.state.units,
          onPick: (m) => {
            const next = { ...store.state.params, thickness: m.thickness, kerf: m.kerf };
            const v = validate(g.schema, next);
            if (!v.ok) {
              const bad = Object.keys(v.errors)[0] ?? 'thickness';
              say(`${m.label} doesn’t suit ${g.name}: ${bad} ${v.errors[bad] ?? 'is out of range'}.`, 'warn');
              stock?.update(store.state.params);
              return;
            }
            store.endGesture();
            store.set({ params: next }); // thickness + kerf: one undo step
            store.endGesture();
            requestLook(m.look);
          },
        })
      : null;
    form = buildForm({
      groupExtra: (group) => (stock && tDef && group === tDef.group ? stock.el : null),
      generator: g,
      params: store.state.params,
      units: store.state.units,
      onParam: (key, value, gesture) => store.setParam(key, value, { gesture }),
      onGestureEnd: () => store.endGesture(),
    });
    formSlot.replaceChildren(form.el);
    presetSlot.replaceChildren(
      buildPresetBar({
        generator: g,
        getParams: () => store.state.params,
        onApply: (p, name) => {
          store.endGesture();
          store.set({ params: applyPreset(g.schema, store.state.params, p) });
          say(`Applied preset “${name}”. ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Z to undo.`);
        },
        onNotice: say,
      }),
    );
  };

  // ── Stage & footer ─────────────────────────────────────────────────────
  const stage = buildStage({
    selected: readTab(),
    store,
    fileBase: () => `boxes-${gen().id}`,
    onSelectPart: (id) => store.set({ selectedPart: id }),
    onShowParam: (p) => form?.focus(p),
    onTab: (t) => {
      try {
        localStorage.setItem(TAB_KEY, t);
      } catch {
        /* not persisted */
      }
    },
  });
  const footer = buildBottomBar({
    onSheet: (s) => store.set({ sheet: s }),
    onSpeed: (v) => {
      speed = v;
      saveSpeed(v);
      paintResult();
    },
  });

  root.classList.add('app');
  root.replaceChildren(
    h('a', { class: 'app-skip', href: '#stage' }, 'Skip to preview'),
    top.el,
    h('div', { class: 'app-body' }, side, stage.el),
    footer.el,
    toaster.el,
  );

  function paintResult(): void {
    const s = store.state;
    stage.render(result, { units: s.units, selectedPart: s.selectedPart, title: gen().name, look: gen().view });
    const t = s.params.thickness;
    const k = s.params.kerf;
    footer.render(result, { units: s.units, sheet: s.sheet, thickness: typeof t === 'number' ? t : undefined, kerf: typeof k === 'number' ? k : undefined, speed });
    form?.setError(result.ok ? null : (result.param ?? null), result.ok ? undefined : result.message);
    top.setExportable(result.ok && result.layout.sheets > 0);
  }

  function paintChrome(): void {
    const s = store.state;
    const g = gen();
    top.setTitle(g.name, g.category);
    top.setUnits(s.units);
    top.setHistory(store.canUndo, store.canRedo);
    gallery.setSelected(g.id);
  }

  // ── URL sync ───────────────────────────────────────────────────────────
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  let lastHash = '';
  function writeUrl(): void {
    clearTimeout(urlTimer);
    const hash = `#${encodeState(store.state)}`;
    if (hash !== location.hash) history.replaceState(null, '', hash);
    lastHash = hash;
  }
  addEventListener('hashchange', () => {
    if (location.hash === lastHash) return;
    const d = decodeState(location.hash);
    store.endGesture();
    // A link without `_u` doesn't say which units to show: keep the viewer's.
    const units = d.unitsInLink ? d.units : store.state.units;
    store.set({ generatorId: d.generatorId, params: d.params, units, sheet: d.sheet, selectedPart: null });
    if (d.notice) say(d.notice, 'warn');
  });

  // ── React to state ─────────────────────────────────────────────────────
  store.subscribe((s: State, prev: State) => {
    if (s.generatorId !== prev.generatorId || s.units !== prev.units) mountForm();
    else if (s.params !== prev.params) {
      form?.update(s.params);
      stock?.update(s.params);
    }
    paintChrome();
    if (s.params !== prev.params || s.generatorId !== prev.generatorId || s.sheet !== prev.sheet) scheduleBuild();
    else paintResult(); // units / selection: redraw without rebuilding
    if (s.params !== prev.params || s.generatorId !== prev.generatorId || s.units !== prev.units || s.sheet !== prev.sheet) {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(writeUrl, URL_DELAY);
    }
  });
  onThemeChange((choice) => store.set({ theme: choice }));

  // ── Command palette ────────────────────────────────────────────────────
  const palette = createPalette({
    commands(): Command[] {
      build.flush(); // a pending rebuild decides whether the Export actions are offered
      const cmds: Command[] = registry.map((g) => ({
        id: `gen:${g.id}`,
        title: g.name,
        group: 'Generator',
        hint: g.category,
        keywords: `${g.description} ${g.id}`,
        run: () => store.selectGenerator(g.id),
      }));
      const act = (id: string, title: string, group: string, run: () => void, extra: Partial<Command> = {}): void => void cmds.push({ id, title, group, run, ...extra });
      const exportable = result.ok && result.layout.sheets > 0;
      if (exportable) {
        act('export-svg', 'Export SVG', 'Export', () => exportFiles('svg'), { keywords: 'download cut file laser' });
        act('export-dxf', 'Export DXF', 'Export', () => exportFiles('dxf'), { keywords: 'download cut file cad' });
      }
      act('about', 'About KerfLab', 'Help', () => about.open(), { keywords: 'credits boxes.py licence open source contribute' });
      act('copy-link', 'Copy link to this design', 'Share', copyLink, { keywords: 'share url' });
      act('toggle-theme', `Switch to ${resolvedTheme() === 'dark' ? 'Paper (light)' : 'Blueprint (dark)'} theme`, 'View', () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark'), { keywords: 'toggle dark light' });
      act('toggle-units', `Show ${store.state.units === 'mm' ? 'inches' : 'millimetres'}`, 'View', () => store.set({ units: store.state.units === 'mm' ? 'in' : 'mm' }), { keywords: 'toggle units mm in' });
      act('view-3d', 'Show 3D view', 'View', () => stage.select('3d'), { keywords: 'switch tab' });
      act('view-sheet', 'Show Sheet view', 'View', () => stage.select('sheet'), { keywords: 'switch tab cut layout 2d' });
      act('reset', 'Reset settings to defaults', 'Edit', () => {
        store.endGesture();
        store.set({ params: defaults(gen().schema) });
        say(`Settings reset. ${MOD}Z to undo.`);
      });
      if (store.canUndo) act('undo', 'Undo', 'Edit', () => store.undo(), { hint: `${MOD}Z` });
      if (store.canRedo) act('redo', 'Redo', 'Edit', () => store.redo(), { hint: `${MOD}⇧Z` });
      return cmds;
    },
  });

  // ── Keyboard ───────────────────────────────────────────────────────────
  addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'k' && !e.shiftKey) {
      e.preventDefault(); // works from any field, and beats the browser's own search shortcuts
      if (e.repeat) return; // holding the shortcut must not flicker the palette open and shut
      palette.toggle();
      return;
    }
    const target = e.target as HTMLElement | null;
    const textEntry = target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'search');
    if (textEntry) return; // let native text undo work in names and search
    if (k === 'z' || k === 'y') {
      e.preventDefault();
      store.endGesture();
      if (k === 'y' || e.shiftKey) store.redo();
      else store.undo();
    }
  });

  function exportFiles(kind: ExportKind): void {
    build.flush(); // an edit made a moment ago may still be waiting on its debounced rebuild
    if (!result.ok) {
      say('Fix the highlighted setting before exporting.', 'warn');
      return;
    }
    const { layout } = result;
    staggered(filesFor(kind, layout, `boxes-${gen().id}`, store.state.units), DOWNLOAD_GAP, (f) => download(f.name, f.body, f.type));
    const extra = layout.unfit.length ? ` ${layout.unfit.length} part(s) don’t fit the sheet and were left out.` : '';
    say(`Exported ${layout.sheets} ${kind.toUpperCase()} file${layout.sheets > 1 ? 's' : ''}.${extra}`, extra ? 'warn' : 'info');
  }

  mountForm();
  paintChrome();
  paintResult();
  writeUrl();
  if (notice) say(notice, 'warn');
  return store;
}
