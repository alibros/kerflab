import { decimalsOf, formatNumber, h, svg, uid } from '../dom';
import { icons } from '../icons';

export interface FieldOptions {
  label: string;
  value: number;
  /** Value the per-field reset returns to. Defaults to the initial `value`. */
  defaultValue?: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  name?: string;
  /** Extra validation on top of number/min/max. Return a message to flag an error. */
  validate?: (v: number) => string | null;
  /** Fires with every valid value (typing, arrow keys, reset). */
  onChange?: (v: number) => void;
}

export interface FieldHandle {
  el: HTMLElement;
  input: HTMLInputElement;
  /** Last valid value. */
  readonly value: number;
  set(v: number, opts?: { silent?: boolean }): void;
  reset(): void;
  /** Force an error message (e.g. cross-field validation); null clears it. */
  setError(msg: string | null): void;
}

/** Internal: the mono number well with a unit suffix. Shared with slider(). */
export function numberWell(opts: {
  id: string;
  value: number;
  unit?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  name?: string | undefined;
}): { well: HTMLElement; input: HTMLInputElement } {
  const input = h('input', {
    id: opts.id,
    class: 'bx-well__input',
    type: 'number',
    inputmode: 'decimal',
    autocomplete: 'off',
    spellcheck: 'false',
    name: opts.name,
    min: opts.min,
    max: opts.max,
    step: opts.step ?? 'any',
  });
  input.value = formatNumber(opts.value, opts.step ? Math.max(decimalsOf(opts.step), 0) : 3);
  const well = h('div', { class: 'bx-well' }, input);
  if (opts.unit) well.append(h('span', { class: 'bx-well__unit', 'aria-hidden': 'true' }, opts.unit));
  return { well, input };
}

export function describeRange(min?: number, max?: number, unit?: string): string | null {
  const u = unit ? ` ${unit}` : '';
  if (min !== undefined && max !== undefined) return `${formatNumber(min)}–${formatNumber(max)}${u}`;
  if (min !== undefined) return `≥ ${formatNumber(min)}${u}`;
  if (max !== undefined) return `≤ ${formatNumber(max)}${u}`;
  return null;
}

export function checkNumber(
  raw: string,
  o: Pick<FieldOptions, 'min' | 'max' | 'unit' | 'validate'>,
): { value: number; error: string | null } {
  const u = o.unit ? ` ${o.unit}` : '';
  if (raw.trim() === '') return { value: NaN, error: 'Enter a number' };
  const v = Number(raw);
  if (!Number.isFinite(v)) return { value: NaN, error: 'Enter a number' };
  if (o.min !== undefined && v < o.min) return { value: v, error: `Minimum is ${formatNumber(o.min)}${u}` };
  if (o.max !== undefined && v > o.max) return { value: v, error: `Maximum is ${formatNumber(o.max)}${u}` };
  return { value: v, error: o.validate ? o.validate(v) : null };
}

/**
 * Labelled number input with unit suffix, help line, live validation
 * and a reset-to-default control that only appears once the value is changed.
 */
export function field(opts: FieldOptions): FieldHandle {
  const id = uid('fld');
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const def = opts.defaultValue ?? opts.value;
  const decimals = opts.step ? decimalsOf(opts.step) : 3;
  let value = opts.value;
  let forcedError: string | null = null;

  const { well, input } = numberWell({ ...opts, id });
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
  const range = describeRange(opts.min, opts.max, opts.unit);
  const help = h(
    'p',
    { id: helpId, class: 'bx-field__help' },
    opts.help ?? '',
    range ? h('span', { class: 'bx-field__range' }, range) : null,
  );
  const err = h('p', { id: errId, class: 'bx-field__error', 'aria-live': 'polite' });
  const el = h(
    'div',
    { class: 'bx-field' },
    h('div', { class: 'bx-field__head' }, h('label', { class: 'bx-label', for: id }, opts.label), resetBtn),
    well,
    help,
    err,
  );
  input.setAttribute('aria-describedby', `${helpId} ${errId}`);

  const showError = (msg: string | null): void => {
    el.classList.toggle('is-invalid', msg !== null);
    input.setAttribute('aria-invalid', String(msg !== null));
    err.replaceChildren(...(msg ? [svg(icons.alert), msg] : []));
  };
  const syncReset = (): void => {
    const changed = Math.abs(value - def) > 1e-9;
    resetBtn.hidden = !changed;
    el.classList.toggle('is-changed', changed);
  };

  input.addEventListener('input', () => {
    const r = checkNumber(input.value, opts);
    showError(r.error ?? forcedError);
    if (r.error === null) {
      value = r.value;
      syncReset();
      opts.onChange?.(value);
    }
  });
  input.addEventListener('blur', () => {
    // Snap the display back to the last valid value once the user leaves the field.
    if (checkNumber(input.value, opts).error === null) input.value = formatNumber(value, decimals);
  });

  const handle: FieldHandle = {
    el,
    input,
    get value() {
      return value;
    },
    set(v, o) {
      value = v;
      input.value = formatNumber(v, decimals);
      showError(forcedError);
      syncReset();
      if (!o?.silent) opts.onChange?.(v);
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
  syncReset();
  return handle;
}
