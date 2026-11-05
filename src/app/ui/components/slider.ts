import { decimalsOf, formatNumber, h, svg, uid } from '../dom';
import { icons } from '../icons';
import { checkNumber, describeRange, numberWell } from './field';

export interface SliderOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  unit?: string;
  help?: string;
  name?: string;
  /** Number of ruler divisions drawn under the track (default 10). */
  divisions?: number;
  onChange?: (v: number) => void;
}

export interface SliderHandle {
  el: HTMLElement;
  range: HTMLInputElement;
  input: HTMLInputElement;
  readonly value: number;
  set(v: number, opts?: { silent?: boolean }): void;
  reset(): void;
  /** Force an error message (e.g. a build error blamed on this param); null clears it. */
  setError(msg: string | null): void;
}

/**
 * A ruler-style range slider paired with a typed number input. Both stay in sync;
 * typing may go beyond the slider's travel only if min/max allow it (they don't here:
 * the typed value is validated against the same bounds).
 */
export function slider(opts: SliderOptions): SliderHandle {
  const id = uid('sld');
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const step = opts.step ?? 1;
  const decimals = decimalsOf(step);
  const def = opts.defaultValue ?? opts.value;
  let value = opts.value;
  let forcedError: string | null = null;

  const range = h('input', {
    type: 'range',
    class: 'bx-range',
    min: opts.min,
    max: opts.max,
    step,
    'aria-labelledby': labelId,
    // Same text as the label: keeps a name when the label is scrolled out of an overflow container.
    'aria-label': opts.label,
    'aria-describedby': helpId,
  });
  range.value = String(value);
  range.style.setProperty('--divisions', String(opts.divisions ?? 10));

  const { well, input } = numberWell({ id, value, unit: opts.unit, min: opts.min, max: opts.max, step, name: opts.name });
  input.setAttribute('aria-describedby', `${helpId} ${errId}`);

  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'bx-reset',
      'aria-label': `Reset ${opts.label} to ${formatNumber(def, decimals)}${opts.unit ? ` ${opts.unit}` : ''}`,
      title: `Reset to ${formatNumber(def, decimals)}`,
    },
    svg(icons.reset),
  );
  const rangeText = describeRange(opts.min, opts.max, opts.unit);
  const err = h('p', { id: errId, class: 'bx-field__error', 'aria-live': 'polite' });
  const el = h(
    'div',
    { class: 'bx-field bx-slider' },
    h(
      'div',
      { class: 'bx-field__head' },
      h('label', { class: 'bx-label', id: labelId, for: id }, opts.label),
      resetBtn,
    ),
    h(
      'div',
      { class: 'bx-slider__row' },
      h(
        'div',
        { class: 'bx-slider__track' },
        range,
        h(
          'div',
          { class: 'bx-slider__scale', 'aria-hidden': 'true' },
          h('span', {}, formatNumber(opts.min, decimals)),
          h('span', {}, formatNumber(opts.max, decimals)),
        ),
      ),
      well,
    ),
    h('p', { id: helpId, class: 'bx-field__help' }, opts.help ?? '', rangeText ? h('span', { class: 'bx-field__range' }, rangeText) : null),
    err,
  );

  const clamp = (v: number): number => Math.min(Math.max(v, opts.min), opts.max);
  const paint = (): void => {
    range.setAttribute('aria-valuetext', `${formatNumber(value, decimals)}${opts.unit ? ` ${opts.unit}` : ''}`);
    const t = (Math.min(Math.max(value, opts.min), opts.max) - opts.min) / (opts.max - opts.min || 1);
    el.style.setProperty('--fill', `${(t * 100).toFixed(3)}%`);
    const changed = Math.abs(value - def) > 1e-9;
    resetBtn.hidden = !changed;
    el.classList.toggle('is-changed', changed);
  };
  const showError = (msg: string | null): void => {
    el.classList.toggle('is-invalid', msg !== null);
    input.setAttribute('aria-invalid', String(msg !== null));
    err.replaceChildren(...(msg ? [svg(icons.alert), msg] : []));
  };

  range.addEventListener('input', () => {
    value = Number(range.value);
    input.value = formatNumber(value, decimals);
    showError(forcedError);
    paint();
    opts.onChange?.(value);
  });
  input.addEventListener('input', () => {
    const r = checkNumber(input.value, opts);
    showError(r.error ?? forcedError);
    if (r.error === null) {
      value = r.value;
      range.value = String(value);
      paint();
      opts.onChange?.(value);
    }
  });
  input.addEventListener('blur', () => {
    if (checkNumber(input.value, opts).error === null) input.value = formatNumber(value, decimals);
  });

  const handle: SliderHandle = {
    el,
    range,
    input,
    get value() {
      return value;
    },
    set(v, o) {
      // Programmatic values are clamped into [min, max]; non-finite values are ignored.
      if (!Number.isFinite(v)) return;
      value = clamp(v);
      range.value = String(value);
      input.value = formatNumber(value, decimals);
      showError(forcedError);
      paint();
      if (!o?.silent) opts.onChange?.(value);
    },
    reset() {
      handle.set(def);
      input.focus();
    },
    setError(msg) {
      forcedError = msg;
      showError(msg);
    },
  };
  resetBtn.addEventListener('click', () => handle.reset());
  paint();
  return handle;
}
