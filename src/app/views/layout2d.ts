/**
 * 2D cut-layout view: the nested sheet(s) as an SVG you can pan and zoom, with parts that are
 * real keyboard-reachable buttons, drafting-style dimension callouts for the selected part, and
 * an explicit warning for parts that cannot fit the sheet.
 *
 * Structure: a "world" group (stock rectangle + the cut geometry from `toSVG`, in sheet mm,
 * y down) carries the pan/zoom transform; everything that must stay a constant pixel size
 * (labels, dimension lines) lives in a screen-space overlay that is repositioned, never rebuilt
 * wholesale, so dragging costs a transform write and a handful of attribute updates.
 * Placement comes from the shared `Layout` (see export/layout.ts), not re-derived here.
 */
import type { Part } from '../../core/part';
import { mat3Multiply, transform, type Mat3 } from '../../core/geometry';
import { orientedSize, placeMatrix, type Layout, type PlacedPart } from '../export/layout';
import { toSVG } from '../export/svg';
import { SHEET_EDGE } from '../profiles';
import { formatLength, type Units } from '../units';
import { h, svg } from '../ui/dom';
import { icons } from '../ui/icons';
import { labelSpot, type LabelSpot } from './labelspot';

export interface Layout2DOptions {
  onSelectPart(id: string | null): void;
}
export interface Layout2DData {
  parts: Part[];
  layout: Layout;
}
export interface Layout2DView {
  units: Units;
  selectedPart: string | null;
}
export interface Layout2DHandle {
  el: HTMLElement;
  render(data: Layout2DData, view: Layout2DView): void;
  /** Test/debug hook: current zoom in screen px per mm. */
  zoom(): number;
  destroy(): void;
}

const NS = 'http://www.w3.org/2000/svg';
const s = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();

const FIT_PAD = 64; // px of breathing room (and dimension lines) around the sheet when fitted
const KEEP_VISIBLE = 80; // px of sheet that must stay on screen when panning
const MIN_ZOOM = 0.2; // relative to "fit"
const MAX_ZOOM = 60;
const STEP = 1.25;
const DRAG_SLOP = 4;
const FONT = 12; // px, dimension text
const LABEL_FONT = 11; // px, part labels (largest)
const LABEL_MIN = 7; // px: a label that would have to be smaller is left out
const LABEL_LINE = 1.3; // label box height, em
const LABEL_PAD = 0.8; // label box width beyond the text, em
const CHAR_W = 0.62; // mono advance, em

type Entry = {
  id: string;
  name: string;
  g: SVGGElement;
  label: SVGTextElement;
  /** Where the label goes (sheet mm, y down) and how tall its box may be (mm); null: no room. */
  spot: LabelSpot | null;
  /** World rectangle (sheet mm, y down). */
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  size: string;
};

type Vp = { k: number; tx: number; ty: number };

const dimsText = (w: number, hh: number, u: Units): string => `${formatLength(w, u)} × ${formatLength(hh, u)}`;

/** Label spots by part object and turn (parts are immutable; a rebuild makes new ones). */
const spots = new WeakMap<Part, Map<number, LabelSpot | null>>();

/**
 * Label spot of a placed part in sheet mm, y down: the pole of its material (cut outline minus
 * holes and engravings, as drawn) and the largest label box of the name's aspect that fits there.
 */
function spotOf(p: PlacedPart, sheetH: number): LabelSpot | null {
  let byRot = spots.get(p.part);
  if (!byRot) spots.set(p.part, (byRot = new Map()));
  const key = p.rot * 1e9 + p.x * 1e3 + p.y; // the spot is placed, so it depends on the position too
  if (byRot.has(key)) return byRot.get(key)!;
  const m: Mat3 = mat3Multiply([1, 0, 0, 0, -1, sheetH, 0, 0, 1], placeMatrix(p));
  const aspect = (p.part.name.length * CHAR_W + LABEL_PAD) / LABEL_LINE;
  let spot: LabelSpot | null;
  try {
    spot = labelSpot(transform(p.part.outline, m), p.part.holes.map((q) => transform(q, m)), p.part.engrave.map((q) => transform(q, m)), aspect);
  } catch {
    spot = null; // a degenerate part: no label rather than no sheet
  }
  byRot.set(key, spot);
  return spot;
}

/** A drafting dimension in screen space: ticks, the line, and a label on a paper knock-out. */
function dimension(x1: number, y1: number, x2: number, y2: number, label: string, vertical: boolean, cls: string): SVGGElement {
  const g = s('g', { class: `l2d-dim ${cls}` });
  const t = FONT * 0.5;
  const ticks = vertical
    ? `M${fmt(x1 - t)} ${fmt(y1)}H${fmt(x1 + t)}M${fmt(x2 - t)} ${fmt(y2)}H${fmt(x2 + t)}`
    : `M${fmt(x1)} ${fmt(y1 - t)}V${fmt(y1 + t)}M${fmt(x2)} ${fmt(y2 - t)}V${fmt(y2 + t)}`;
  g.append(s('path', { d: `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}${ticks}` }));
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rot = vertical ? { transform: `rotate(-90 ${fmt(cx)} ${fmt(cy)})` } : {};
  const kw = label.length * FONT * CHAR_W + FONT;
  g.append(
    s('rect', { class: 'l2d-dim__knock', x: fmt(cx - kw / 2), y: fmt(cy - FONT * 0.7), width: fmt(kw), height: fmt(FONT * 1.4), ...rot }),
  );
  const text = s('text', { x: fmt(cx), y: fmt(cy), 'font-size': FONT, 'text-anchor': 'middle', 'dominant-baseline': 'central', ...rot });
  text.textContent = label;
  g.append(text);
  return g;
}

export function createLayout2D(opts: Layout2DOptions): Layout2DHandle {
  // ── DOM ────────────────────────────────────────────────────────────────
  const picker = h('div', { class: 'app-sheetpick', role: 'group', 'aria-label': 'Sheet', hidden: true });
  const hint = h('p', { class: 'l2d-hint bx-mono', id: 'l2d-hint' }, 'Drag to pan · scroll or pinch to zoom · double-click to fit · Esc clears');
  const mk = (label: string, text: string, onClick: () => void, extra = ''): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: `bx-btn bx-btn--sm bx-btn--secondary l2d-tool ${extra}`.trim(), 'aria-label': label, title: label }, text);
    b.addEventListener('click', onClick);
    return b;
  };
  const tools = h(
    'div',
    { class: 'l2d-tools', role: 'group', 'aria-label': 'View' },
    mk('Zoom out', '−', () => zoomBy(1 / STEP)),
    mk('Zoom in', '+', () => zoomBy(STEP)),
    mk('Fit sheet to view', 'Fit', () => fit()),
  );
  const root = s('svg', { class: 'l2d-svg', role: 'group', 'aria-describedby': 'l2d-hint' });
  const world = s('g', { class: 'l2d-world' });
  const overlay = s('g', { class: 'l2d-overlay' });
  const labelsG = s('g', { class: 'l2d-labels' });
  const dynG = s('g', { class: 'l2d-dyn' });
  overlay.append(labelsG, dynG);
  root.append(world, overlay);
  const view = h('div', { class: 'app-view l2d-view' }, root, tools, hint);
  const unfitBox = h('section', { class: 'l2d-unfit', 'aria-label': 'Parts that do not fit', hidden: true });
  const empty = h('p', { class: 'app-view__empty l2d-empty', hidden: true }, 'No part fits on this sheet.');
  const el = h('div', { class: 'l2d' }, picker, view, empty, unfitBox);

  // ── State ──────────────────────────────────────────────────────────────
  let data: Layout2DData | null = null;
  let vw: Layout2DView = { units: 'mm', selectedPart: null };
  let sheetIndex = 0;
  let entries: Entry[] = [];
  let byId = new Map<string, Entry>();
  let vp: Vp = { k: 1, tx: 0, ty: 0 };
  let needsFit = false; // a refit was due while the view had no size (hidden tab)
  let fitted = true; // still at the automatic fit: follows resizes and sheet changes
  let box = { w: 0, h: 0 };
  let shown = ''; // key of the geometry currently in the DOM
  let internalSelect = false;
  let raf = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { x: number; y: number; tx: number; ty: number; moved: boolean; target: Element | null } | null = null;
  let pinch: { dist: number; cx: number; cy: number; k: number; tx: number; ty: number } | null = null;
  let multi = false; // a multi-touch gesture happened during this press
  let space = false;

  /** Show sheet `i`: rebuild, record what is in the DOM (so the next render() diffs against it), refit. */
  function showSheet(i: number): void {
    sheetIndex = i;
    shown = `${sheetSize().w}x${sheetSize().h}|${i}`;
    rebuild();
    fit();
  }

  const sheetSize = (): { w: number; h: number } => data?.layout.sheet ?? { w: 1, h: 1 };

  // ── View maths ─────────────────────────────────────────────────────────
  function fitK(): number {
    const { w, h: hh } = sheetSize();
    return Math.max(Math.min((box.w - 2 * FIT_PAD) / w, (box.h - 2 * FIT_PAD) / hh), 1e-3);
  }
  function clamp(v: Vp): Vp {
    const { w, h: hh } = sheetSize();
    const f = fitK();
    const k = Math.min(Math.max(v.k, f * MIN_ZOOM), f * MAX_ZOOM);
    const tx = Math.min(Math.max(v.tx, KEEP_VISIBLE - w * k), box.w - KEEP_VISIBLE);
    const ty = Math.min(Math.max(v.ty, KEEP_VISIBLE - hh * k), box.h - KEEP_VISIBLE);
    return { k, tx, ty };
  }
  function fit(): void {
    if (box.w <= 0 || box.h <= 0) {
      needsFit = true;
      return;
    }
    needsFit = false;
    const { w, h: hh } = sheetSize();
    const k = fitK();
    vp = { k, tx: (box.w - w * k) / 2, ty: (box.h - hh * k) / 2 };
    fitted = true;
    schedule();
  }
  function setVp(next: Vp): void {
    vp = clamp(next);
    fitted = false;
    schedule();
  }
  function zoomAt(factor: number, cx: number, cy: number): void {
    const k = Math.min(Math.max(vp.k * factor, fitK() * MIN_ZOOM), fitK() * MAX_ZOOM);
    const r = k / vp.k;
    setVp({ k, tx: cx - (cx - vp.tx) * r, ty: cy - (cy - vp.ty) * r });
  }
  function zoomBy(factor: number): void {
    zoomAt(factor, box.w / 2, box.h / 2);
  }
  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // ── Painting ───────────────────────────────────────────────────────────
  function schedule(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paintView();
    });
  }

  function paintView(): void {
    if (!data || box.w <= 0) return;
    world.setAttribute('transform', `translate(${fmt(vp.tx)} ${fmt(vp.ty)}) scale(${vp.k})`);
    const { w, h: hh } = sheetSize();
    const u = vw.units;
    const sx = vp.tx;
    const sy = vp.ty;
    const ex = vp.tx + w * vp.k;
    const ey = vp.ty + hh * vp.k;
    dynG.replaceChildren();
    // Registration marks at the stock corners, constant size.
    const c = 9;
    dynG.append(
      s('path', {
        class: 'l2d-reg',
        d: `M${fmt(sx - c)} ${fmt(sy)}H${fmt(sx)}V${fmt(sy - c)}M${fmt(ex + c)} ${fmt(sy)}H${fmt(ex)}V${fmt(sy - c)}M${fmt(sx - c)} ${fmt(ey)}H${fmt(sx)}V${fmt(ey + c)}M${fmt(ex + c)} ${fmt(ey)}H${fmt(ex)}V${fmt(ey + c)}`,
      }),
      dimension(sx, ey + 28, ex, ey + 28, formatLength(w, u), false, 'l2d-dim--sheet'),
      dimension(ex + 28, sy, ex + 28, ey, formatLength(hh, u), true, 'l2d-dim--sheet'),
    );
    for (const e of entries) {
      // At the pole of the part's material, as large as fits clear of every cut (up to LABEL_FONT).
      const font = e.spot ? Math.min(LABEL_FONT, (e.spot.h * vp.k) / LABEL_LINE) : 0;
      const fits = font >= LABEL_MIN;
      e.label.style.display = fits ? '' : 'none';
      if (fits && e.spot) {
        e.label.setAttribute('x', fmt(vp.tx + e.spot.x * vp.k));
        e.label.setAttribute('y', fmt(vp.ty + e.spot.y * vp.k));
        e.label.setAttribute('font-size', fmt(font));
      }
    }
    const sel = vw.selectedPart ? byId.get(vw.selectedPart) : undefined;
    if (sel) {
      const px = vp.tx + sel.x * vp.k;
      const py = vp.ty + sel.y * vp.k;
      const pw = sel.w * vp.k;
      const ph = sel.h * vp.k;
      // Below / right of the part by default; flip to the other side when a neighbour is in the way
      // or the viewport edge is near.
      const rects = entries.filter((o) => o !== sel).map((o) => ({ x: vp.tx + o.x * vp.k, y: vp.ty + o.y * vp.k, w: o.w * vp.k, h: o.h * vp.k }));
      const clearY = (y: number): boolean => y > 6 && y < box.h - 6 && !rects.some((r) => y > r.y - 8 && y < r.y + r.h + 8 && px < r.x + r.w && px + pw > r.x);
      const clearX = (x: number): boolean => x > 6 && x < box.w - 6 && !rects.some((r) => x > r.x - 8 && x < r.x + r.w + 8 && py < r.y + r.h && py + ph > r.y);
      const dy = [py + ph + 20, py - 20, py + ph + 20].find(clearY) ?? py + ph + 20;
      const dx = [px + pw + 20, px - 20, px + pw + 20].find(clearX) ?? px + pw + 20;
      dynG.append(
        dimension(px, dy, px + pw, dy, formatLength(sel.w, u), false, 'l2d-dim--part'),
        dimension(dx, py, dx, py + ph, formatLength(sel.h, u), true, 'l2d-dim--part'),
      );
    }
  }

  function applySelection(): void {
    for (const e of entries) {
      const on = e.id === vw.selectedPart;
      e.g.classList.toggle('is-selected', on);
      e.g.setAttribute('aria-pressed', String(on));
    }
    syncTabStop();
    unfitBox.querySelectorAll<HTMLButtonElement>('button[data-part]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.part === vw.selectedPart)));
  }

  /** Roving tabindex: the selected part is the tab stop, else the first. */
  function syncTabStop(focused?: Entry): void {
    const stop = focused ?? (vw.selectedPart ? byId.get(vw.selectedPart) : undefined) ?? entries[0];
    for (const e of entries) e.g.setAttribute('tabindex', e === stop ? '0' : '-1');
  }

  function rebuild(): void {
    if (!data) return;
    const { layout, parts } = data;
    const refocus = root.contains(document.activeElement) ? (document.activeElement as Element).getAttribute('data-part') : null;
    sheetIndex = Math.min(Math.max(sheetIndex, 0), Math.max(layout.sheets - 1, 0));
    const u = vw.units;

    // Sheet switcher.
    picker.hidden = layout.sheets < 2;
    picker.replaceChildren(
      ...Array.from({ length: layout.sheets }, (_, i) => {
        const b = h('button', { type: 'button', class: 'bx-btn bx-btn--sm bx-btn--quiet', 'aria-pressed': String(i === sheetIndex) }, `Sheet ${i + 1}`);
        b.setAttribute('aria-label', `Sheet ${i + 1} of ${layout.sheets}`);
        b.addEventListener('click', () => {
          showSheet(i);
        });
        return b;
      }),
    );

    // Unfit warning.
    const nameOf = new Map(parts.map((p) => [p.id, p]));
    unfitBox.hidden = layout.unfit.length === 0;
    if (layout.unfit.length) {
      // Nesting keeps SHEET_EDGE clear round the sheet, so the usable area is that much smaller.
      const w = layout.sheet.w - 2 * SHEET_EDGE;
      const hh = layout.sheet.h - 2 * SHEET_EDGE;
      unfitBox.replaceChildren(
        h(
          'p',
          { class: 'l2d-unfit__head' },
          svg(icons.alert),
          h('strong', {}, 'Does not fit on sheet'),
          ` — larger than the usable ${dimsText(w, hh, u)} (the sheet less its edge margin) in both orientations. Pick a bigger sheet below; these are left out of the export.`,
        ),
        h(
          'ul',
          { class: 'l2d-unfit__list' },
          ...layout.unfit.map((id) => {
            const part = nameOf.get(id);
            const sz = part ? orientedSize(part, 0) : null;
            const b = h('button', { type: 'button', class: 'l2d-unfit__item', 'data-part': id, 'aria-pressed': 'false' }, part?.name ?? id, h('span', { class: 'bx-mono' }, sz ? dimsText(sz.w, sz.h, u) : ''));
            b.addEventListener('click', () => select(id));
            return h('li', {}, b);
          }),
        ),
      );
    } else unfitBox.replaceChildren();

    empty.hidden = layout.sheets > 0;
    view.hidden = layout.sheets === 0;
    world.replaceChildren();
    labelsG.replaceChildren();
    entries = [];
    byId = new Map();
    if (layout.sheets === 0) {
      applySelection();
      return;
    }

    const { w, h: hh } = layout.sheet;
    root.setAttribute('aria-label', `Cut layout, sheet ${sheetIndex + 1} of ${layout.sheets}, ${dimsText(w, hh, u)}`);
    world.append(s('rect', { class: 'l2d-stock', x: 0, y: 0, width: w, height: hh }));
    // toSVG emits one <g> per placed part of the sheet, in `layout.placed` order (y down, mm).
    const placed: PlacedPart[] = layout.placed.filter((p) => p.sheet === sheetIndex);
    const gs = [...svg(toSVG(layout, { units: 'mm', sheetIndex })).querySelectorAll(':scope > g')] as SVGGElement[];
    placed.forEach((p, i) => {
      const g = gs[i];
      if (!g) return;
      const sz = orientedSize(p.part, p.rot);
      const size = dimsText(sz.w, sz.h, u);
      g.removeAttribute('id');
      g.removeAttribute('fill');
      g.setAttribute('class', 'l2d-part');
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '-1');
      g.setAttribute('data-part', p.part.id);
      g.setAttribute('aria-label', `${p.part.name}, ${size}`);
      g.setAttribute('aria-pressed', 'false');
      const label = s('text', { class: 'l2d-label', 'font-size': LABEL_FONT, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'aria-hidden': 'true' });
      label.textContent = p.part.name;
      labelsG.append(label);
      const entry: Entry = { id: p.part.id, name: p.part.name, g, label, spot: spotOf(p, hh), x: p.x, y: hh - p.y - sz.h, w: sz.w, h: sz.h, rot: p.rot, size };
      entries.push(entry);
      byId.set(entry.id, entry);
      world.append(g);
    });
    // Reading order (top row first, left to right) for arrow-key navigation.
    entries.sort((a, b) => a.y + a.h - (b.y + b.h) || a.x - b.x);
    applySelection();
    if (refocus) byId.get(refocus)?.g.focus({ preventScroll: true });
  }

  // ── Selection ──────────────────────────────────────────────────────────
  function select(id: string | null): void {
    internalSelect = true;
    try {
      opts.onSelectPart(id);
    } finally {
      internalSelect = false;
    }
  }

  function sheetOf(id: string): number {
    return data?.layout.placed.find((p) => p.part.id === id)?.sheet ?? -1;
  }

  function reveal(e: Entry): void {
    const px = vp.tx + e.x * vp.k;
    const py = vp.ty + e.y * vp.k;
    const inside = px >= 0 && py >= 0 && px + e.w * vp.k <= box.w && py + e.h * vp.k <= box.h;
    if (!inside) setVp({ k: vp.k, tx: box.w / 2 - (e.x + e.w / 2) * vp.k, ty: box.h / 2 - (e.y + e.h / 2) * vp.k });
  }

  // ── Input: pointer ─────────────────────────────────────────────────────
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, local(e));
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    if (pointers.size === 1) {
      const p = local(e);
      drag = { x: p.x, y: p.y, tx: vp.tx, ty: vp.ty, moved: false, target: e.target as Element };
      multi = false;
    } else if (pointers.size === 2) {
      multi = true;
      drag = null;
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, k: vp.k, tx: vp.tx, ty: vp.ty };
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const f = fitK();
      const k = Math.min(Math.max(pinch.k * (dist / pinch.dist), f * MIN_ZOOM), f * MAX_ZOOM);
      const r = k / pinch.k;
      // Zoom about the starting centroid, then follow the centroid's travel (two-finger pan).
      setVp({ k, tx: cx - (pinch.cx - pinch.tx) * r, ty: cy - (pinch.cy - pinch.ty) * r });
      return;
    }
    if (!drag) return;
    const p = local(e);
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!drag.moved) {
      drag.moved = true;
      view.classList.add('is-dragging');
    }
    setVp({ k: vp.k, tx: drag.tx + dx, ty: drag.ty + dy });
  });
  const endPointer = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    if (pointers.size > 0) {
      // One finger remains after a pinch: restart a pan from here so it doesn't jump.
      const [p] = [...pointers.values()] as [{ x: number; y: number }];
      drag = { x: p.x, y: p.y, tx: vp.tx, ty: vp.ty, moved: true, target: null };
      return;
    }
    view.classList.remove('is-dragging');
    const d = drag;
    drag = null;
    if (e.type === 'pointercancel' || !d || d.moved || multi || space) return;
    const part = d.target?.closest<SVGGElement>('.l2d-part');
    select(part?.dataset.part ?? null);
  };
  /** Drop all gesture state (focus left the window, capture was lost): nothing may stay half-pressed. */
  const clearGesture = (): void => {
    pointers.clear();
    drag = null;
    pinch = null;
    space = false;
    view.classList.remove('is-dragging', 'is-space');
  };
  root.addEventListener('lostpointercapture', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) clearGesture();
  });
  addEventListener('blur', clearGesture);
  root.addEventListener('pointerup', endPointer);
  root.addEventListener('pointercancel', endPointer);
  root.addEventListener('dblclick', (e) => {
    e.preventDefault();
    fit();
  });
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), p.x, p.y); // trackpad pinch
      else if (e.deltaX !== 0 && Math.abs(e.deltaX) >= Math.abs(e.deltaY)) setVp({ k: vp.k, tx: vp.tx - e.deltaX, ty: vp.ty - e.deltaY }); // horizontal scroll pans
      else zoomAt(Math.exp(-(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0015), p.x, p.y);
    },
    { passive: false },
  );

  // ── Input: keyboard ────────────────────────────────────────────────────
  // Hold space over the view and drag: pan only, never a selection on release.
  let hovering = false;
  view.addEventListener('pointerenter', () => (hovering = true));
  view.addEventListener('pointerleave', () => (hovering = false));
  const onSpaceDown = (e: KeyboardEvent): void => {
    if (e.key !== ' ' || !hovering || e.repeat) return;
    const t = e.target as Element | null;
    if (t && t.closest('button, input, select, textarea, [role="button"], [role="tab"]')) return;
    space = true;
    view.classList.add('is-space');
    e.preventDefault();
  };
  const onSpaceUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' && space) {
      space = false;
      view.classList.remove('is-space');
    }
  };
  addEventListener('keydown', onSpaceDown);
  addEventListener('keyup', onSpaceUp);
  view.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const part = (e.target as Element).closest<SVGGElement>('.l2d-part');
    const cur = part ? byId.get(part.dataset.part ?? '') : undefined;
    const move = (to: Entry | undefined): void => {
      if (!to) return;
      syncTabStop(to);
      to.g.focus();
      reveal(to);
    };
    const i = cur ? entries.indexOf(cur) : -1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        if (!cur) return;
        move(entries[Math.min(i + 1, entries.length - 1)]);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        if (!cur) return;
        move(entries[Math.max(i - 1, 0)]);
        break;
      case 'Home':
        if (!cur) return;
        move(entries[0]);
        break;
      case 'End':
        if (!cur) return;
        move(entries[entries.length - 1]);
        break;
      case 'Enter':
        if (!cur) return;
        select(cur.id);
        break;
      case ' ':
        if (cur) select(cur.id);
        else return;
        break;
      case 'Escape':
        if (vw.selectedPart) select(null);
        else return;
        break;
      case '+':
      case '=':
        zoomBy(STEP);
        break;
      case '-':
      case '_':
        zoomBy(1 / STEP);
        break;
      case '0':
        fit();
        break;
      default:
        return;
    }
    e.preventDefault();
  });
  root.addEventListener('focusin', (e) => {
    const part = (e.target as Element).closest<SVGGElement>('.l2d-part');
    const entry = part ? byId.get(part.dataset.part ?? '') : undefined;
    if (entry) syncTabStop(entry);
  });

  // ── Size ───────────────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    const w = view.clientWidth;
    const hh = view.clientHeight;
    if (w === box.w && hh === box.h) return;
    box = { w, h: hh };
    if (w <= 0 || hh <= 0) return;
    if (fitted || needsFit) fit();
    else {
      vp = clamp(vp);
      schedule();
    }
  });
  ro.observe(view);

  return {
    el,
    zoom: () => vp.k,
    render(next, v) {
      const prevData = data;
      const prevView = vw;
      data = next;
      vw = v;
      // An outside selection (the 3D view) on another sheet brings that sheet forward.
      const want = v.selectedPart ? sheetOf(v.selectedPart) : -1;
      const switched = want >= 0 && want !== sheetIndex && !internalSelect && v.selectedPart !== prevView.selectedPart;
      if (switched) sheetIndex = want;
      const sizeKey = `${next.layout.sheet.w}x${next.layout.sheet.h}`;
      const geomChanged = prevData?.layout !== next.layout || prevView.units !== v.units || switched;
      if (geomChanged || !shown) {
        const resized = shown.split('|')[0] !== sizeKey;
        shown = `${sizeKey}|${sheetIndex}`;
        rebuild();
        if (resized || switched) {
          box = { w: view.clientWidth, h: view.clientHeight };
          fit();
        }
      } else if (prevView.selectedPart !== v.selectedPart) applySelection();
      if (!internalSelect && v.selectedPart !== prevView.selectedPart && v.selectedPart) {
        const e = byId.get(v.selectedPart);
        if (e && box.w > 0) reveal(e);
      }
      schedule();
    },
    destroy() {
      ro.disconnect();
      removeEventListener('keydown', onSpaceDown);
      removeEventListener('keyup', onSpaceUp);
      removeEventListener('blur', clearGesture);
      cancelAnimationFrame(raf);
    },
  };
}
