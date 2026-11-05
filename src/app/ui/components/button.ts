import { h, svg } from '../dom';
import { icons, type IconName } from '../icons';

export interface ButtonOptions {
  label: string;
  /** primary = laser fill, secondary = inked outline, quiet = text only. */
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'md' | 'sm';
  icon?: IconName;
  /** Render only the icon; `label` becomes the accessible name. */
  iconOnly?: boolean;
  /** Keyboard shortcut hint shown as a key cap, e.g. "⌘K". */
  kbd?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
}

export function button(opts: ButtonOptions): HTMLButtonElement {
  const variant = opts.variant ?? 'secondary';
  const el = h('button', {
    type: opts.type ?? 'button',
    class: [
      'bx-btn',
      `bx-btn--${variant}`,
      opts.size === 'sm' ? 'bx-btn--sm' : '',
      opts.iconOnly ? 'bx-btn--icon' : '',
    ]
      .filter(Boolean)
      .join(' '),
    'aria-label': opts.iconOnly ? opts.label : null,
    disabled: opts.disabled ?? false,
  });
  if (opts.icon) el.append(svg(icons[opts.icon]));
  if (!opts.iconOnly) el.append(h('span', { class: 'bx-btn__label' }, opts.label));
  if (opts.kbd) el.append(h('kbd', { class: 'bx-kbd', 'aria-hidden': 'true' }, opts.kbd));
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}
