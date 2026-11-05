import { h, svg } from './dom';
import { icons } from './icons';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'kerflab:theme';
const listeners = new Set<(choice: ThemeChoice, resolved: ResolvedTheme) => void>();

function root(): HTMLElement {
  return document.documentElement;
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getTheme(): ThemeChoice {
  const t = root().dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function resolvedTheme(): ResolvedTheme {
  const t = getTheme();
  if (t !== 'system') return t;
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * Switch theme. Colours are `light-dark()` tokens, so this only flips
 * `color-scheme` (via the data-theme attribute in base.css) — no style recalculation
 * beyond what the browser does for the scheme change.
 */
export function setTheme(choice: ThemeChoice): void {
  root().dataset.theme = choice;
  root().dataset.resolvedTheme = resolvedTheme();
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* private mode / storage disabled: theme just won't persist */
  }
  for (const fn of listeners) fn(choice, resolvedTheme());
}

export function onThemeChange(fn: (choice: ThemeChoice, resolved: ResolvedTheme) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Number of live theme listeners (exposed for leak tests). */
export function themeListenerCount(): number {
  return listeners.size;
}

let initialised = false;

/**
 * Restore the persisted choice (default: follow the OS) and track OS changes.
 * Idempotent: later calls just return the current choice.
 *
 * No-flash contract for app shells: module scripts are deferred, so they can run
 * after first paint. Every HTML entry therefore carries this blocking classic
 * script in <head> (keep it in sync with STORAGE_KEY), which pins the stored
 * scheme before anything paints:
 *
 *   <script>try{var t=localStorage.getItem('kerflab:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
 *
 * and the entry module calls `initTheme()` as its first statement to wire up
 * persistence, OS tracking and listeners. Without the inline script the page
 * still follows the OS (`color-scheme: light dark`), so only users whose stored
 * choice differs from their OS could see a one-frame flash.
 */
export function initTheme(): ThemeChoice {
  if (initialised) return getTheme();
  initialised = true;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: follow the OS */
  }
  const choice: ThemeChoice = stored === 'light' || stored === 'dark' ? stored : 'system';
  setTheme(choice);
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getTheme() === 'system') setTheme('system');
    });
  }
  return choice;
}

export interface ThemeSwitchHandle {
  el: HTMLElement;
  /** Unsubscribe from theme changes. Call when removing the element. */
  destroy(): void;
}

/** Segmented Paper / Blueprint / System switch (radiogroup semantics, arrow keys). */
export function themeSwitch(): ThemeSwitchHandle {
  const options: { value: ThemeChoice; label: string; icon: string }[] = [
    { value: 'light', label: 'Paper', icon: icons.sun },
    { value: 'dark', label: 'Blueprint', icon: icons.moon },
    { value: 'system', label: 'System', icon: icons.system },
  ];
  const group = h('div', { class: 'bx-segment', role: 'radiogroup', 'aria-label': 'Theme' });
  const buttons = options.map((o) => {
    const b = h(
      'button',
      { type: 'button', role: 'radio', class: 'bx-segment__opt', 'data-value': o.value },
      svg(o.icon),
      h('span', {}, o.label),
    );
    b.addEventListener('click', () => setTheme(o.value));
    group.append(b);
    return b;
  });
  const sync = (): void => {
    const current = getTheme();
    for (const b of buttons) {
      const on = b.dataset.value === current;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  group.addEventListener('keydown', (e) => {
    const i = buttons.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = buttons[(i + delta + buttons.length) % buttons.length]!;
    next.focus();
    next.click();
  });
  const unsubscribe = onThemeChange(sync);
  sync();
  return { el: group, destroy: unsubscribe };
}
