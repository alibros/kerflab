import { h, uid } from '../dom';

export interface TabSpec {
  id: string;
  label: string;
  content: HTMLElement | string;
}

export interface TabsOptions {
  /** Accessible name for the tab list. */
  label: string;
  tabs: TabSpec[];
  selected?: string;
  /** Show 01/02/… drawing-sheet indices before labels (default true). */
  numbered?: boolean;
  onChange?: (id: string) => void;
}

export interface TabsHandle {
  el: HTMLElement;
  readonly selected: string;
  select(id: string, opts?: { focus?: boolean; silent?: boolean }): void;
  /** Stop layout tracking (ResizeObserver, pending font callback). Call when removing the element. */
  destroy(): void;
}

/**
 * WAI-ARIA tabs with automatic activation: Left/Right/Home/End move and select,
 * roving tabindex keeps a single stop in the tab order. A vermilion indicator
 * slides between tabs (transform only, so it costs nothing and respects reduced motion).
 */
export function tabs(opts: TabsOptions): TabsHandle {
  const base = uid('tabs');
  const list = h('div', { class: 'bx-tabs__list', role: 'tablist', 'aria-label': opts.label });
  const indicator = h('span', { class: 'bx-tabs__indicator', 'aria-hidden': 'true' });
  const panels = h('div', { class: 'bx-tabs__panels' });
  const el = h('div', { class: 'bx-tabs' }, list, panels);
  list.append(indicator);

  const items = opts.tabs.map((t, i) => {
    const tabId = `${base}-tab-${t.id}`;
    const panelId = `${base}-panel-${t.id}`;
    const tab = h(
      'button',
      { type: 'button', role: 'tab', id: tabId, class: 'bx-tab', 'aria-controls': panelId, 'data-id': t.id },
      opts.numbered === false ? null : h('span', { class: 'bx-tab__num', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
      h('span', {}, t.label),
    );
    const panel = h('div', { role: 'tabpanel', id: panelId, class: 'bx-tabs__panel', 'aria-labelledby': tabId, tabindex: 0 });
    panel.append(typeof t.content === 'string' ? document.createTextNode(t.content) : t.content);
    list.append(tab);
    panels.append(panel);
    tab.addEventListener('click', () => handle.select(t.id));
    return { spec: t, tab, panel };
  });

  let selected = opts.selected ?? opts.tabs[0]?.id ?? '';
  let destroyed = false;

  const placeIndicator = (): void => {
    if (destroyed) return;
    const cur = items.find((it) => it.spec.id === selected);
    if (!cur || !cur.tab.offsetWidth) return;
    indicator.style.transform = `translateX(${cur.tab.offsetLeft}px)`;
    indicator.style.width = `${cur.tab.offsetWidth}px`;
  };

  list.addEventListener('keydown', (e) => {
    const i = items.findIndex((it) => it.tab === document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    handle.select(items[next]!.spec.id, { focus: true });
  });

  const handle: TabsHandle = {
    el,
    get selected() {
      return selected;
    },
    select(id, o) {
      const changed = id !== selected;
      selected = id;
      for (const it of items) {
        const on = it.spec.id === id;
        it.tab.setAttribute('aria-selected', String(on));
        it.tab.tabIndex = on ? 0 : -1;
        it.panel.hidden = !on;
        if (on && o?.focus) it.tab.focus();
      }
      placeIndicator();
      if (changed && !o?.silent) opts.onChange?.(id);
    },
    destroy() {
      destroyed = true;
      ro.disconnect();
    },
  };

  // Layout isn't known until the element is attached and fonts settle.
  const ro = new ResizeObserver(placeIndicator);
  handle.select(selected, { silent: true });
  ro.observe(list);
  void document.fonts?.ready.then(placeIndicator); // no-op once destroyed
  return handle;
}
