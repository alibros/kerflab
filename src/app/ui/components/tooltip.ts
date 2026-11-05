import { h, uid } from '../dom';

export interface TooltipOptions {
  /** Preferred side; flips automatically if there's no room. */
  placement?: 'top' | 'bottom';
  /** Hover delay before showing (focus shows immediately). Default 280 ms. */
  delay?: number;
}

export interface TooltipHandle {
  el: HTMLElement;
  show(): void;
  hide(): void;
  destroy(): void;
}

const GAP = 10;

/**
 * Drafting-note tooltip: an inked card joined to its target by a leader line.
 * Shows on hover (after a delay) and on keyboard focus, hides on leave/blur/Escape,
 * and stays open while hovered (WCAG 1.4.13). Content may be rich (e.g. a tiny diagram).
 */
export function tooltip(target: HTMLElement, content: string | HTMLElement, opts: TooltipOptions = {}): TooltipHandle {
  const id = uid('tip');
  const el = h('div', { id, role: 'tooltip', class: 'bx-tooltip', 'data-placement': opts.placement ?? 'top' });
  el.append(typeof content === 'string' ? document.createTextNode(content) : content);
  el.hidden = true;
  // Top layer when available: escapes any overflow/stacking context around the target.
  const usePopover = typeof el.showPopover === 'function';
  if (usePopover) el.popover = 'manual';
  // Mounted lazily, inside the target's landmark so the note is part of that region.
  const mount = (): void => {
    if (el.isConnected) return;
    (target.closest('main, header, footer, nav, aside, [role="dialog"]') ?? document.body).append(el);
  };

  const describedBy = target.getAttribute('aria-describedby');
  target.setAttribute('aria-describedby', describedBy ? `${describedBy} ${id}` : id);

  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const position = (): void => {
    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let side = opts.placement ?? 'top';
    if (side === 'top' && r.top - th - GAP < 4) side = 'bottom';
    else if (side === 'bottom' && r.bottom + th + GAP > innerHeight - 4) side = 'top';
    const left = Math.min(Math.max(r.left + r.width / 2 - tw / 2, 8), innerWidth - tw - 8);
    const top = side === 'top' ? r.top - th - GAP : r.bottom + GAP;
    el.dataset.placement = side;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // Leader line stays pointed at the target's centre even when the card is clamped.
    el.style.setProperty('--leader-x', `${Math.round(r.left + r.width / 2 - left)}px`);
  };

  const show = (): void => {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (!el.hidden) return;
    mount();
    el.hidden = false;
    if (usePopover) el.showPopover();
    position();
    requestAnimationFrame(() => el.classList.add('is-open'));
  };
  const hide = (): void => {
    clearTimeout(showTimer);
    el.classList.remove('is-open');
    if (usePopover && el.matches(':popover-open')) el.hidePopover();
    el.hidden = true;
  };
  const scheduleShow = (): void => {
    clearTimeout(hideTimer);
    showTimer = setTimeout(show, opts.delay ?? 280);
  };
  const scheduleHide = (): void => {
    clearTimeout(showTimer);
    hideTimer = setTimeout(hide, 120);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !el.hidden) hide();
  };

  target.addEventListener('pointerenter', scheduleShow);
  target.addEventListener('pointerleave', scheduleHide);
  target.addEventListener('focus', show);
  target.addEventListener('blur', hide);
  el.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  el.addEventListener('pointerleave', scheduleHide);
  document.addEventListener('keydown', onKey);
  // Fixed-position note: follow the target while anything scrolls.
  let raf = 0;
  const onScroll = (): void => {
    if (el.hidden || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      position();
    });
  };
  addEventListener('scroll', onScroll, { passive: true, capture: true });

  return {
    el,
    show,
    hide,
    destroy() {
      hide();
      target.removeEventListener('pointerenter', scheduleShow);
      target.removeEventListener('pointerleave', scheduleHide);
      target.removeEventListener('focus', show);
      target.removeEventListener('blur', hide);
      document.removeEventListener('keydown', onKey);
      removeEventListener('scroll', onScroll, { capture: true });
      const ids = (target.getAttribute('aria-describedby') ?? '').split(' ').filter((x) => x && x !== id);
      if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
      else target.removeAttribute('aria-describedby');
      el.remove();
    },
  };
}
