/**
 * Top bar: wordmark, the current drawing's title, undo/redo, units, theme, share and export.
 */
import { button } from './components/button';
import { tooltip, type TooltipHandle } from './components/tooltip';
import { h, svg } from './dom';
import { icons } from './icons';
import { themeSwitch, type ThemeSwitchHandle } from './theme';
import type { Units } from '../units';

export type ExportKind = 'svg' | 'dxf';

export interface TopbarOptions {
  onUnits(u: Units): void;
  onUndo(): void;
  onRedo(): void;
  onCopyLink(): void;
  onPalette(): void;
  onAbout(): void;
  onExport(kind: ExportKind): void;
}

export interface TopbarHandle {
  el: HTMLElement;
  setTitle(name: string, category: string): void;
  setUnits(u: Units): void;
  setHistory(canUndo: boolean, canRedo: boolean): void;
  setExportable(ok: boolean): void;
  destroy(): void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl+';

const undoIcon = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M5.5 3 2.5 6l3 3"/><path d="M2.5 6H10a3.5 3.5 0 0 1 0 7H7"/></svg>';
const redoIcon = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M10.5 3l3 3-3 3"/><path d="M13.5 6H6a3.5 3.5 0 0 0 0 7h3"/></svg>';

function iconButton(label: string, markup: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'bx-btn bx-btn--quiet bx-btn--icon', 'aria-label': label }, svg(markup));
  b.addEventListener('click', onClick);
  return b;
}

export function buildTopbar(opts: TopbarOptions): TopbarHandle {
  const tips: TooltipHandle[] = [];
  const title = h('h1', { class: 'app-title' });
  const category = h('span', { class: 'app-title__cat bx-mono' });

  const undo = iconButton('Undo', undoIcon, opts.onUndo);
  const redo = iconButton('Redo', redoIcon, opts.onRedo);
  tips.push(tooltip(undo, `Undo · ${MOD}Z`, { placement: 'bottom' }), tooltip(redo, `Redo · ${MOD}${isMac ? '⇧Z' : 'Shift+Z'}`, { placement: 'bottom' }));

  // Units: a two-way segmented switch (radio semantics).
  const unitGroup = h('div', { class: 'bx-segment app-units', role: 'radiogroup', 'aria-label': 'Display units' });
  const unitBtns = (['mm', 'in'] as const).map((u) => {
    const b = h('button', { type: 'button', role: 'radio', class: 'bx-segment__opt', 'data-value': u }, h('span', {}, u));
    b.addEventListener('click', () => opts.onUnits(u));
    unitGroup.append(b);
    return b;
  });
  unitGroup.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const cur = unitBtns.findIndex((b) => b === document.activeElement);
    const next = unitBtns[(cur + 1) % 2]!;
    next.focus();
    next.click();
  });

  const theme: ThemeSwitchHandle = themeSwitch();
  theme.el.classList.add('app-theme');

  const palette = h('button', { type: 'button', class: 'bx-btn bx-btn--sm bx-btn--quiet app-palette-btn', 'aria-haspopup': 'dialog' }, h('span', { class: 'app-palette-btn__label' }, 'Commands'), h('kbd', { class: 'app-palette-btn__key bx-mono' }, `${MOD}K`));
  palette.addEventListener('click', () => opts.onPalette());
  tips.push(tooltip(palette, 'Search generators and commands', { placement: 'bottom' }));

  const about = h('button', { type: 'button', class: 'bx-btn bx-btn--sm bx-btn--quiet app-about-btn', 'aria-haspopup': 'dialog' }, 'About');
  about.addEventListener('click', () => opts.onAbout());

  const share = button({ label: 'Copy link', icon: 'link', size: 'sm', onClick: () => opts.onCopyLink() });
  share.classList.add('app-share');

  // Export: a small menu-button (menu of two cut-file formats).
  const exportBtn = button({ label: 'Export', variant: 'primary', icon: 'download', size: 'sm' });
  exportBtn.append(svg(icons.chevron));
  exportBtn.setAttribute('aria-haspopup', 'menu');
  exportBtn.setAttribute('aria-expanded', 'false');
  exportBtn.setAttribute('aria-controls', 'export-menu');
  const item = (kind: ExportKind, name: string, note: string): HTMLButtonElement => {
    const b = h('button', { type: 'button', role: 'menuitem', class: 'app-menu__item', tabindex: -1 }, h('span', { class: 'app-menu__name' }, name), h('span', { class: 'app-menu__note' }, note));
    b.addEventListener('click', () => {
      close();
      opts.onExport(kind);
    });
    return b;
  };
  const items = [item('svg', 'SVG', 'Cut lines red, engraving blue'), item('dxf', 'DXF', 'R12 · CUT / ENGRAVE layers')];
  const menu = h('div', { id: 'export-menu', class: 'app-menu', role: 'menu', 'aria-label': 'Export format', hidden: true }, ...items);
  const exportWrap = h('div', { class: 'app-export' }, exportBtn, menu);
  const open = (): void => {
    menu.hidden = false;
    exportBtn.setAttribute('aria-expanded', 'true');
    items[0]!.focus();
    document.addEventListener('pointerdown', onOutside, true);
  };
  function close(focus = false): void {
    if (menu.hidden) return;
    menu.hidden = true;
    exportBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    if (focus) exportBtn.focus();
  }
  function onOutside(e: Event): void {
    if (!exportWrap.contains(e.target as Node)) close();
  }
  exportBtn.addEventListener('click', () => (menu.hidden ? open() : close()));
  menu.addEventListener('keydown', (e) => {
    const i = items.findIndex((b) => b === document.activeElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      close(e.key === 'Escape');
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]!.focus();
    }
  });

  const el = h(
    'header',
    { class: 'app-top' },
    h(
      'div',
      { class: 'app-brand' },
      h('a', { class: 'app-wordmark', href: './', 'aria-label': 'KerfLab home' }, 'kerf', h('span', { class: 'app-wordmark__kerf', 'aria-hidden': 'true' }), 'lab'),
      h('div', { class: 'app-titleblock' }, category, title),
    ),
    h(
      'div',
      { class: 'app-tools' },
      h('div', { class: 'app-tools__group' }, undo, redo),
      about,
      palette,
      unitGroup,
      theme.el,
      share,
      exportWrap,
    ),
  );

  return {
    el,
    setTitle(name, cat) {
      title.textContent = name;
      category.textContent = cat;
      document.title = `${name} · KerfLab`;
    },
    setUnits(u) {
      for (const b of unitBtns) {
        const on = b.dataset.value === u;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    },
    setHistory(canUndo, canRedo) {
      undo.disabled = !canUndo;
      redo.disabled = !canRedo;
    },
    setExportable(ok) {
      exportBtn.disabled = !ok;
      if (!ok) close();
    },
    destroy() {
      theme.destroy();
      for (const t of tips) t.destroy();
    },
  };
}
