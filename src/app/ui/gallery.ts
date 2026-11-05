/**
 * Generator picker. Collapsed, it is a one-line "current generator" card with a Change button, so
 * the settings form gets the side panel. Open, it is a search field, a category bar (All + one
 * chip per category, with counts) and a dense two-column grid of tiles: a small 3D thumbnail of
 * the default assembly (the cut-sheet drawing until it renders) and the name, the description in
 * the tile's title. One category fits the panel without scrolling.
 *
 * Search looks across every category: typing switches the bar to All (a chip can still narrow
 * the results), and clearing the search returns to the chosen category. The chosen category is
 * remembered per viewer.
 */
import type { Generator } from '../../core/part';
import { defaults } from '../../core/schema';
import { nest } from '../export/nest';
import { toSVG } from '../export/svg';
import { h, svg } from './dom';
import { icons } from './icons';
import { cachedThumb, request3d, showImage } from './thumbs';

export interface GalleryOptions {
  generators: Generator[];
  selected: string;
  /** Start with the picker open (default) or collapsed to the current-generator card. */
  open?: boolean;
  onSelect(id: string): void;
}

export interface GalleryHandle {
  el: HTMLElement;
  setSelected(id: string): void;
  setOpen(open: boolean): void;
}

/** The "every category" filter. */
export const ALL = 'All';
const CAT_KEY = 'kerflab:gallery-category';

/** Known categories in reading order; any other category follows, in first-seen order. */
export const CATEGORY_ORDER = [
  'Boxes',
  'Trays & organizers',
  'Storage & display',
  'Lids & hinges',
  'Flex',
  'Polygon & special',
  'Electronics',
  'Wall mount',
  'Mechanical',
  'Panels & patterns',
  'Jigs & tools',
  'Test & calibration',
];

/** Categories present in `gens`, known ones in CATEGORY_ORDER, the rest appended. */
export function orderCategories(gens: readonly Pick<Generator, 'category'>[]): string[] {
  const seen: string[] = [];
  for (const g of gens) if (!seen.includes(g.category)) seen.push(g.category);
  const known = CATEGORY_ORDER.filter((c) => seen.includes(c));
  return [...known, ...seen.filter((c) => !CATEGORY_ORDER.includes(c))];
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

type Searchable = Pick<Generator, 'id' | 'name' | 'description' | 'category'>;

/** Does `g` match every word of the search `q`? (Name, description, category and id.) */
export function matchesQuery(g: Searchable, q: string): boolean {
  const words = norm(q.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(`${g.name} ${g.description} ${g.category} ${g.id}`);
  return words.every((w) => hay.includes(w));
}

/** The generators shown for a category filter and search. */
export function filterGenerators<G extends Searchable>(gens: readonly G[], category: string, q: string): G[] {
  return gens.filter((g) => (category === ALL || g.category === category) && matchesQuery(g, q));
}

const thumbCache = new Map<string, string>();

/** Cut-file SVG of the generator's default parts (cached), or null when they fail to build. */
function thumbMarkup(g: Generator): string | null {
  const hit = thumbCache.get(g.id);
  if (hit !== undefined) return hit || null;
  let out = '';
  try {
    out = toSVG(nest(g.build(defaults(g.schema)), null, 6), { units: 'mm', stroke: 'cut' });
  } catch {
    /* a broken generator still gets a card, just no drawing */
  }
  thumbCache.set(g.id, out);
  return out || null;
}

/** Put the cut-sheet drawing into a thumbnail that is still waiting for one. */
function fillDrawing(box: HTMLElement, g: Generator): void {
  if (box.dataset.thumb !== 'svg' || box.firstChild) return; // the 3D render got there first
  const m = thumbMarkup(g);
  if (!m) return;
  const el = svg(m);
  el.removeAttribute('width');
  el.removeAttribute('height');
  el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  box.append(el);
}

/**
 * Drawings are built lazily: building and nesting every generator up front is a long task and a
 * large DOM. A thumbnail gets its drawing once it comes near the screen, in idle time, a few at a
 * time (without IntersectionObserver, all of them in idle time).
 */
const drawQueue = new Map<HTMLElement, Generator>();
let drawObserver: IntersectionObserver | null | undefined;
let drawScheduled = false;
const idle = (cb: (d: { timeRemaining(): number }) => void): void => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(cb, { timeout: 200 });
  else setTimeout(() => cb({ timeRemaining: () => 8 }), 16);
};
function drainDrawings(d: { timeRemaining(): number }): void {
  drawScheduled = false;
  let first = true;
  while (drawQueue.size && (first || d.timeRemaining() > 4)) {
    first = false;
    const [box, g] = drawQueue.entries().next().value as [HTMLElement, Generator];
    drawQueue.delete(box);
    if (box.isConnected) fillDrawing(box, g);
  }
  scheduleDrawings();
}
function scheduleDrawings(): void {
  if (drawScheduled || !drawQueue.size) return;
  drawScheduled = true;
  idle(drainDrawings);
}
const waiting = new WeakMap<Element, Generator>();
function requestDrawing(box: HTMLElement, g: Generator): void {
  if (drawObserver === undefined)
    drawObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const wg = waiting.get(e.target);
        drawObserver?.unobserve(e.target);
        if (wg) drawQueue.set(e.target as HTMLElement, wg);
      }
      scheduleDrawings();
    }, { rootMargin: '128px' });
  if (!drawObserver) {
    drawQueue.set(box, g);
    scheduleDrawings();
    return;
  }
  waiting.set(box, g);
  drawObserver.observe(box);
}

/**
 * A generator's thumbnail: its 3D render when one is cached, otherwise the cut-sheet drawing
 * (built lazily once the thumbnail is near the screen), swapped for the 3D render once it has
 * been made (see thumbs.ts).
 */
export function thumbnail(g: Generator): HTMLElement {
  const box = h('span', { class: 'app-thumb', 'aria-hidden': 'true' });
  const ready = cachedThumb(g);
  if (ready) {
    showImage(box, ready);
    return box;
  }
  box.dataset.thumb = 'svg';
  requestDrawing(box, g);
  request3d(box, g);
  return box;
}

function readCategory(cats: string[]): string | null {
  try {
    const v = localStorage.getItem(CAT_KEY);
    return v !== null && (v === ALL || cats.includes(v)) ? v : null;
  } catch {
    return null;
  }
}
function saveCategory(c: string): void {
  try {
    localStorage.setItem(CAT_KEY, c);
  } catch {
    /* not persisted */
  }
}

const pad = (n: number): string => String(n).padStart(2, '0');
const plural = (n: number): string => `${n} generator${n === 1 ? '' : 's'}`;

export function buildGallery(opts: GalleryOptions): GalleryHandle {
  const gens = opts.generators;
  const cats = orderCategories(gens);
  const byId = new Map(gens.map((g) => [g.id, g]));
  let selected = opts.selected;
  let open = opts.open ?? true;
  /** The viewer's chosen category; defaults to the selected generator's. */
  let category = readCategory(cats) ?? byId.get(selected)?.category ?? ALL;
  /** A chip clicked while searching narrows the results until the search is cleared. */
  let searchCategory: string | null = null;

  // ── Current generator card ─────────────────────────────────────────────
  const curThumb = h('span', { class: 'app-current__thumb' });
  const curCat = h('span', { class: 'app-current__cat' });
  const curName = h('span', { class: 'app-current__name' });
  const toggleText = h('span', {});
  const toggle = h(
    'button',
    { type: 'button', class: 'bx-btn bx-btn--sm app-current__change', 'aria-controls': 'gallery-picker' },
    toggleText,
    svg(icons.chevron),
  );
  const current = h('div', { class: 'app-current' }, curThumb, h('span', { class: 'app-current__text' }, curCat, curName), toggle);

  // ── Picker ─────────────────────────────────────────────────────────────
  const input = h('input', {
    id: 'gallery-search',
    type: 'search',
    class: 'bx-well__input app-search__input',
    placeholder: 'Search boxes, trays, drawers…',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Search generators',
    'aria-controls': 'gallery-list',
  });
  const count = h('span', { class: 'app-search__count bx-mono', 'aria-hidden': 'true' });
  const search = h('div', { class: 'bx-well app-search' }, input, count);

  const chipBar = h('div', { class: 'app-cats', role: 'toolbar', 'aria-label': 'Categories', 'aria-controls': 'gallery-list' });
  const chips = new Map<string, { btn: HTMLButtonElement; n: HTMLElement }>();
  for (const c of [ALL, ...cats]) {
    const n = h('span', { class: 'app-cat__n bx-mono', 'aria-hidden': 'true' });
    const label = h('span', { class: 'app-cat__label' }, c);
    const btn = h('button', { type: 'button', class: 'app-cat', 'aria-pressed': 'false', 'data-category': c }, label, n);
    btn.addEventListener('click', () => pick(c));
    chips.set(c, { btn, n });
    chipBar.append(btn);
  }
  // Roving focus: the bar is one tab stop; arrows, Home and End move along it.
  chipBar.addEventListener('keydown', (e) => {
    const all = [...chips.values()].map((x) => x.btn);
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const to = fwd ? i + 1 : back ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = all[(to + all.length) % all.length]!;
    for (const b of all) b.tabIndex = b === next ? 0 : -1;
    next.focus();
  });

  const list = h('div', { id: 'gallery-list', class: 'app-gallery__list' });
  const empty = h('p', { class: 'app-gallery__empty', hidden: true });
  const live = h('p', { class: 'vh', role: 'status' });
  const picker = h('div', { id: 'gallery-picker', class: 'app-picker' }, search, chipBar, list, empty, live);

  const heading = h('h2', { class: 'bx-label app-side__label', id: 'gallery-head' }, 'Generator');
  const el = h('section', { class: 'app-gallery', 'aria-labelledby': 'gallery-head' }, heading, current, picker);

  const tiles = new Map<string, HTMLButtonElement>();
  const sections: { cat: string; el: HTMLElement; items: { g: Generator; li: HTMLElement }[] }[] = [];
  for (const cat of cats) {
    const ul = h('ul', { class: 'app-gallery__grid', role: 'list' });
    const items = gens
      .filter((g) => g.category === cat)
      .map((g) => {
        const tile = h(
          'button',
          { type: 'button', class: 'app-gen', 'aria-pressed': 'false', 'data-id': g.id, title: g.description },
          thumbnail(g),
          h('span', { class: 'app-gen__name' }, g.name),
        );
        tile.addEventListener('click', () => {
          opts.onSelect(g.id);
          handle.setOpen(false);
          toggle.focus();
        });
        tiles.set(g.id, tile);
        const li = h('li', {}, tile);
        ul.append(li);
        return { g, li };
      });
    const sec = h('section', { class: 'app-gallery__cat', 'aria-label': cat }, h('h3', { class: 'bx-label app-gallery__head' }, cat), ul);
    sections.push({ cat, el: sec, items });
    list.append(sec);
  }

  function pick(c: string): void {
    if (input.value.trim()) searchCategory = c;
    else {
      category = c;
      saveCategory(c);
    }
    render();
  }

  function render(): void {
    const q = input.value.trim();
    if (!q) searchCategory = null;
    const active = q ? (searchCategory ?? ALL) : category;
    let shown = 0;
    let total = 0;
    const perCat = new Map<string, number>();
    for (const s of sections) {
      let n = 0;
      for (const it of s.items) {
        const hit = matchesQuery(it.g, q);
        if (hit) n++;
        it.li.hidden = !hit;
      }
      perCat.set(s.cat, n);
      total += n;
      const visible = active === ALL || s.cat === active;
      s.el.hidden = !visible || n === 0;
      if (visible) shown += n;
    }
    // Category headings only help when several categories share the list.
    list.classList.toggle('is-single', active !== ALL);
    for (const [c, { btn, n }] of chips) {
      const k = c === ALL ? total : (perCat.get(c) ?? 0);
      btn.setAttribute('aria-pressed', String(c === active));
      btn.classList.toggle('is-empty', k === 0);
      btn.title = plural(k);
      n.textContent = pad(k);
    }
    // Keep the bar's single tab stop on the active chip unless focus is moving along it.
    if (!chipBar.contains(document.activeElement)) for (const [c, { btn }] of chips) btn.tabIndex = c === active ? 0 : -1;
    count.textContent = q ? `${total}/${gens.length}` : String(gens.length);
    empty.hidden = shown > 0;
    empty.textContent =
      total > 0 ? `Nothing in ${active} matches “${q}”; ${plural(total)} do in All.` : `No generator matches “${q}”. Try a broader word, like “box”.`;
    live.textContent = q ? `${plural(shown)} shown` : '';
  }

  input.addEventListener('input', render);
  picker.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (e.target === input && input.value) {
      input.value = '';
      render();
      return;
    }
    handle.setOpen(false);
    toggle.focus();
  });
  toggle.addEventListener('click', () => {
    handle.setOpen(!open);
    if (open) input.focus();
  });

  const paintCurrent = (): void => {
    const g = byId.get(selected);
    curThumb.replaceChildren(...(g ? [thumbnail(g)] : []));
    curCat.textContent = g?.category ?? '';
    curName.textContent = g?.name ?? '';
  };

  const handle: GalleryHandle = {
    el,
    setSelected(id) {
      if (id !== selected) {
        selected = id;
        paintCurrent();
      }
      for (const [k, c] of tiles) c.setAttribute('aria-pressed', String(k === id));
    },
    setOpen(next) {
      open = next;
      picker.hidden = !open;
      el.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggleText.textContent = open ? 'Done' : 'Change';
      toggle.setAttribute('aria-label', open ? 'Done choosing a generator' : 'Change generator');
    },
  };
  paintCurrent();
  handle.setSelected(selected);
  handle.setOpen(open);
  render();
  return handle;
}
