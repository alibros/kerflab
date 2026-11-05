/**
 * Non-blocking notices (bad link, copied, export warnings). One polite live region; the latest
 * note replaces the previous one and fades after a while, or on its dismiss button.
 */
import { h, svg } from './dom';
import { icons } from './icons';

export interface Toaster {
  el: HTMLElement;
  show(message: string, opts?: { tone?: 'info' | 'warn'; timeout?: number }): void;
  hide(): void;
}

export function createToaster(): Toaster {
  const msg = h('p', { class: 'app-toast__msg' });
  const close = h('button', { type: 'button', class: 'bx-btn bx-btn--quiet bx-btn--icon bx-btn--sm app-toast__close', 'aria-label': 'Dismiss' }, svg(icons.plus));
  const card = h('div', { class: 'app-toast__card', hidden: true }, h('span', { class: 'app-toast__mark', 'aria-hidden': 'true' }), msg, close);
  const el = h('div', { class: 'app-toast', role: 'status', 'aria-live': 'polite' }, card);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = (): void => {
    clearTimeout(timer);
    card.classList.remove('is-open');
    card.hidden = true;
  };
  close.addEventListener('click', hide);

  return {
    el,
    show(message, o) {
      clearTimeout(timer);
      msg.textContent = message;
      card.dataset.tone = o?.tone ?? 'info';
      card.hidden = false;
      requestAnimationFrame(() => card.classList.add('is-open'));
      const ms = o?.timeout ?? (o?.tone === 'warn' ? 9000 : 3500);
      if (ms > 0) timer = setTimeout(hide, ms);
    },
    hide,
  };
}
