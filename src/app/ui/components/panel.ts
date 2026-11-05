import { h, svg, uid } from '../dom';
import { icons } from '../icons';

export interface PanelOptions {
  title: string;
  /** Drawing-style balloon number shown before the title. */
  index?: number | string;
  open?: boolean;
  /** Short value summary shown in the header (useful when collapsed), e.g. "120 × 80 × 60 mm". */
  summary?: string;
  /** Heading level for the header (default 3). */
  level?: 2 | 3 | 4;
  content?: (HTMLElement | string)[] | HTMLElement;
  onToggle?: (open: boolean) => void;
}

export interface PanelHandle {
  el: HTMLElement;
  /** Append settings here. */
  body: HTMLElement;
  readonly open: boolean;
  setOpen(open: boolean): void;
  setSummary(text: string): void;
}

/**
 * Collapsible settings group (disclosure pattern): a heading containing a button
 * with aria-expanded, controlling a labelled region. The reveal animates
 * grid-template-rows 0fr → 1fr, and the collapsed body is `inert` so nothing
 * hidden can take focus.
 */
export function panel(opts: PanelOptions): PanelHandle {
  const id = uid('pnl');
  const headId = `${id}-head`;
  const bodyId = `${id}-body`;
  let open = opts.open ?? true;

  const summary = h('span', { class: 'bx-panel__summary' }, opts.summary ?? '');
  const trigger = h(
    'button',
    { type: 'button', id: headId, class: 'bx-panel__trigger', 'aria-controls': bodyId },
    opts.index !== undefined ? h('span', { class: 'bx-balloon', 'aria-hidden': 'true' }, String(opts.index)) : null,
    h('span', { class: 'bx-panel__title' }, opts.title),
    summary,
    h('span', { class: 'bx-panel__chev' }, svg(icons.chevron)),
  );
  const heading = h(`h${opts.level ?? 3}` as 'h3', { class: 'bx-panel__head' }, trigger);
  const body = h('div', { class: 'bx-panel__content' });
  const region = h(
    'div',
    { id: bodyId, class: 'bx-panel__body', role: 'region', 'aria-labelledby': headId },
    h('div', { class: 'bx-panel__inner' }, body),
  );
  const el = h('section', { class: 'bx-panel' }, heading, region);

  const content = opts.content === undefined ? [] : Array.isArray(opts.content) ? opts.content : [opts.content];
  for (const c of content) body.append(c);

  const apply = (): void => {
    trigger.setAttribute('aria-expanded', String(open));
    el.classList.toggle('is-open', open);
    region.inert = !open;
  };

  const handle: PanelHandle = {
    el,
    body,
    get open() {
      return open;
    },
    setOpen(next) {
      if (next === open) return;
      open = next;
      apply();
      opts.onToggle?.(open);
    },
    setSummary(text) {
      summary.textContent = text;
    },
  };
  trigger.addEventListener('click', () => handle.setOpen(!open));
  apply();
  return handle;
}
