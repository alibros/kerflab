/**
 * Command palette (Cmd/Ctrl-K): one search field over every generator and app action.
 *
 * Accessibility: a modal dialog holding an ARIA 1.2 combobox (focus stays in the input;
 * `aria-activedescendant` points at the active option in the listbox). Up/Down/Home/End move,
 * Enter runs, Esc closes. Focus is trapped (everything else is `inert` while open) and returns to
 * whatever had it before the palette opened.
 */
import { h, uid } from './dom';

export interface Command {
  id: string;
  title: string;
  /** Section label, also searched ("Generator", "Export", "View"…). */
  group: string;
  /** Right-aligned note: a shortcut or the generator's category. */
  hint?: string;
  /** Extra words that should find this command. */
  keywords?: string;
  run(): void;
}

export interface PaletteHandle {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const BOUNDARY = /[\s\-_/·]/;

/**
 * Fuzzy score of `query` against `text`: every whitespace-separated token must appear as an
 * in-order subsequence. Substrings, contiguous runs and word starts score higher; null means no
 * match. Higher is better.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const t = norm(text);
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  let total = 0;
  for (const tok of tokens) {
    const at = t.indexOf(tok);
    if (at >= 0) {
      const wordStart = at === 0 || BOUNDARY.test(t[at - 1]!);
      total += 100 + tok.length * 4 + (wordStart ? 30 : 0) - Math.min(at, 40) * 0.2;
      continue;
    }
    let pos = 0;
    let score = 0;
    let prev = -2;
    for (const ch of tok) {
      const i = t.indexOf(ch, pos);
      if (i < 0) return null;
      score += i === prev + 1 ? 6 : 1;
      if (i === 0 || BOUNDARY.test(t[i - 1]!)) score += 4;
      prev = i;
      pos = i + 1;
    }
    total += score - Math.min(prev, 40) * 0.1;
  }
  return total;
}

/** Commands matching `query`, best first (input order when the query is empty). */
export function rankCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;
  const scored: { c: Command; s: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const title = fuzzyScore(query, c.title);
    const other = fuzzyScore(query, `${c.group} ${c.keywords ?? ''}`);
    const best = title === null ? (other === null ? null : other * 0.6) : Math.max(title, (other ?? 0) * 0.6);
    if (best !== null) scored.push({ c, s: best, i });
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}

const MAX_SHOWN = 80;

export function createPalette(opts: { commands(): Command[] }): PaletteHandle {
  const base = uid('pal');
  const listId = `${base}-list`;
  const input = h('input', {
    class: 'app-pal__input',
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': 'Search generators and commands',
    placeholder: 'Type a generator or a command…',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const list = h('ul', { id: listId, class: 'app-pal__list', role: 'listbox', 'aria-label': 'Commands' });
  const status = h('p', { class: 'vh', role: 'status' });
  const empty = h('p', { class: 'app-pal__empty', hidden: true });
  const foot = h('p', { class: 'app-pal__foot bx-mono', 'aria-hidden': 'true' }, h('span', {}, '↑↓ move'), h('span', {}, '↵ run'), h('span', {}, 'esc close'));
  const box = h(
    'div',
    { class: 'app-pal__box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
    h('div', { class: 'app-pal__search' }, h('span', { class: 'app-pal__prompt bx-mono', 'aria-hidden': 'true' }, '›'), input),
    list,
    empty,
    status,
    foot,
  );
  const overlay = h('div', { class: 'app-pal', hidden: true }, box);

  let isOpen = false;
  let all: Command[] = [];
  let shown: Command[] = [];
  let active = 0;
  let returnTo: HTMLElement | null = null;
  let inerted: HTMLElement[] = [];
  const optId = (i: number): string => `${base}-opt-${i}`;
  const options = (): Element[] => [...list.querySelectorAll('[role="option"]')];

  function highlight(): void {
    options().forEach((o, k) => o.setAttribute('aria-selected', String(k === active)));
    if (shown.length) input.setAttribute('aria-activedescendant', optId(active));
    else input.removeAttribute('aria-activedescendant');
    options()[active]?.scrollIntoView({ block: 'nearest' });
  }

  function paint(): void {
    const q = input.value.trim();
    const ranked = rankCommands(all, q);
    shown = ranked.slice(0, MAX_SHOWN);
    active = Math.min(active, Math.max(shown.length - 1, 0));
    let lastGroup = '';
    const rows: HTMLElement[] = [];
    shown.forEach((c, i) => {
      // Group headings only while browsing; a ranked search is one flat list.
      if (!q && c.group !== lastGroup) {
        lastGroup = c.group;
        rows.push(h('li', { class: 'app-pal__group', role: 'presentation' }, c.group));
      }
      const li = h(
        'li',
        { id: optId(i), class: 'app-pal__opt', role: 'option', 'aria-selected': 'false' },
        h('span', { class: 'app-pal__title' }, c.title),
        q ? h('span', { class: 'app-pal__tag' }, c.group) : null,
        c.hint ? h('span', { class: 'app-pal__hint bx-mono' }, c.hint) : null,
      );
      li.addEventListener('pointermove', () => {
        if (active !== i) {
          active = i;
          highlight();
        }
      });
      li.addEventListener('click', () => choose(i));
      rows.push(li);
    });
    list.replaceChildren(...rows);
    empty.hidden = shown.length > 0;
    empty.textContent = `Nothing matches “${q}”.`;
    status.textContent = shown.length ? `${ranked.length} result${ranked.length === 1 ? '' : 's'}` : 'No results';
    input.setAttribute('aria-expanded', String(shown.length > 0)); // the listbox is empty otherwise
    highlight();
  }

  function choose(i: number): void {
    const cmd = shown[i];
    if (!cmd) return;
    handle.close();
    cmd.run();
  }

  function move(to: number): void {
    if (!shown.length) return;
    active = (to + shown.length) % shown.length;
    highlight();
  }

  function onKey(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        handle.close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        move(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(active - 1);
        break;
      case 'Enter':
        // An IME is confirming its candidate, not running a command (Safari reports keyCode 229 instead).
        if (e.isComposing || e.keyCode === 229) break;
        e.preventDefault();
        choose(active);
        break;
      case 'Tab':
        e.preventDefault(); // the input is the only stop; Tab must not leave the dialog
        break;
    }
  }

  const handle: PaletteHandle = {
    get isOpen() {
      return isOpen;
    },
    open() {
      if (isOpen) return;
      isOpen = true;
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      all = opts.commands();
      input.value = '';
      active = 0;
      document.body.append(overlay);
      inerted = [...document.body.children].filter((n): n is HTMLElement => n instanceof HTMLElement && n !== overlay && !n.inert);
      for (const n of inerted) n.inert = true;
      overlay.hidden = false;
      paint();
      input.focus();
      document.addEventListener('keydown', onKey, true);
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      document.removeEventListener('keydown', onKey, true);
      overlay.hidden = true;
      overlay.remove();
      for (const n of inerted) n.inert = false;
      inerted = [];
      const back = returnTo;
      returnTo = null;
      if (back?.isConnected) back.focus();
    },
    toggle() {
      if (isOpen) handle.close();
      else handle.open();
    },
    destroy() {
      handle.close();
    },
  };
  input.addEventListener('input', () => {
    active = 0;
    paint();
  });
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) handle.close();
  });
  return handle;
}
