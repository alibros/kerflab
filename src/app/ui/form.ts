/**
 * Settings form built purely from a generator's schema: one collapsible panel per `group`, a
 * slider + typed input per number, a switch per bool, a segmented control (or select) per enum,
 * a text well per text param (e.g. a size list).
 * Every field has a help note (with a tiny diagram where one exists), live validation and a
 * per-field reset. Lengths are shown in the display unit; values handed back are always mm.
 */
import type { Generator } from '../../core/part';
import { defaults, type ParamDef, type ParamValue, type Params } from '../../core/schema';
import { displayStep, fromDisplay, toDisplay, type Units } from '../units';
import { decimalsOf, formatNumber, h, svg, uid } from './dom';
import { icons } from './icons';
import { panel, type PanelHandle } from './components/panel';
import { slider } from './components/slider';
import { tooltip, type TooltipHandle } from './components/tooltip';
import { diagramFor } from './diagrams';

export interface FormOptions {
  generator: Generator;
  params: Params;
  units: Units;
  /** A value changed. `gesture` identifies the control so a drag coalesces into one undo step. */
  onParam(key: string, value: ParamValue, gesture: string): void;
  /** The current gesture is over (slider released, field committed). */
  onGestureEnd(): void;
  /** Extra control placed first in a group's panel (e.g. the stock picker in Material). */
  groupExtra?(group: string): HTMLElement | null;
}

export interface FormHandle {
  el: HTMLElement;
  /** Reflect params changed elsewhere (undo, presets, URL) without firing onParam. */
  update(params: Params): void;
  /** Show a build/validation error at one field; null clears all forced errors. */
  setError(param: string | null, message?: string): void;
  /** Open the param's group and focus its control. */
  focus(param: string): void;
  destroy(): void;
}

interface Control {
  def: ParamDef;
  el: HTMLElement;
  focusable: HTMLElement;
  set(v: ParamValue): void;
  setError(msg: string | null): void;
}

/** Groups open state survives rebuilds (unit toggle, undo across generators). */
const openGroups = new Map<string, boolean>();

const isLength = (d: ParamDef): boolean => d.kind === 'number' && d.unit === 'mm';

function unitLabel(d: ParamDef, units: Units): string | undefined {
  if (isLength(d)) return units;
  if (d.unit === 'deg') return '°';
  if (d.unit === '' && /multiples? of thickness/i.test(d.help)) return '× t';
  return d.unit || undefined;
}

function describeDefault(d: ParamDef, units: Units): string {
  if (d.kind === 'bool') return `default ${d.default ? 'on' : 'off'}`;
  if (d.kind === 'enum') return `default ${d.default}`;
  if (d.kind === 'text') return d.default === '' ? 'default empty' : `default ${d.default}`;
  const u = unitLabel(d, units);
  const f = (v: number): string => formatNumber(isLength(d) ? toDisplay(v, units) : v, units === 'in' && isLength(d) ? 3 : 2);
  return `default ${f(d.default)}${u ? ` ${u}` : ''} · ${f(d.min)}–${f(d.max)}`;
}

function helpNote(d: ParamDef, units: Units): HTMLElement {
  const diagram = diagramFor(d.key);
  return h(
    'div',
    {},
    h('span', { class: 'bx-tooltip__title' }, d.label),
    d.help,
    diagram ? svg(diagram) : null,
    h('span', { class: 'bx-mono app-note__meta' }, describeDefault(d, units)),
  );
}

function resetButton(label: string, onReset: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'bx-reset', 'aria-label': `Reset ${label} to default`, title: 'Reset to default' }, svg(icons.reset));
  b.addEventListener('click', onReset);
  return b;
}

function errorLine(id: string): { el: HTMLElement; show(msg: string | null): void } {
  const el = h('p', { id, class: 'bx-field__error', 'aria-live': 'polite' });
  return { el, show: (msg) => el.replaceChildren(...(msg ? [svg(icons.alert), msg] : [])) };
}

export function buildForm(opts: FormOptions): FormHandle {
  const { generator: g, units } = opts;
  const def = defaults(g.schema);
  const tips: TooltipHandle[] = [];
  const controls = new Map<string, Control>();
  const panels = new Map<string, PanelHandle>();
  const refreshers: (() => void)[] = [];
  let params = { ...opts.params };

  const infoButton = (d: ParamDef): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: 'app-info', 'aria-label': `About ${d.label}` }, svg(icons.info));
    tips.push(tooltip(b, helpNote(d, units), { placement: 'top' }));
    return b;
  };

  const numberControl = (d: Extract<ParamDef, { kind: 'number' | 'int' }>): Control => {
    const len = isLength(d);
    const conv = (v: number): number => (len ? toDisplay(v, units) : v);
    const step = d.kind === 'int' ? 1 : len ? displayStep(d.step, units) : d.step;
    const unit = unitLabel(d, units);
    // A range input steps from its min, so a min like 0.3937 in would put every stop off the
    // round values (1.0007 in…). In inches, widen the travel to whole steps; onChange snaps the
    // overshoot (under one step) back onto the mm bounds.
    const aligned = len && units === 'in';
    const onGrid = (k: number): number => +(k * step).toFixed(decimalsOf(step));
    const lo = aligned ? onGrid(Math.floor(conv(d.min) / step + 1e-9)) : conv(d.min);
    const hi = aligned ? onGrid(Math.ceil(conv(d.max) / step - 1e-9)) : conv(d.max);
    const s = slider({
      label: d.label,
      name: d.key,
      value: conv(params[d.key] as number),
      defaultValue: conv(d.default),
      min: lo,
      max: hi,
      step,
      ...(unit ? { unit } : {}),
      divisions: 10,
      onChange: (v) => {
        let mm = len ? fromDisplay(v, units) : v;
        if (len && units === 'in') mm = Math.round(mm * 1e6) / 1e6; // drop float noise from the conversion
        // A typed bound or an aligned end stop in inches can land up to a step outside the mm range: snap to it.
        const tol = aligned ? fromDisplay(step, units) : len ? fromDisplay(step, units) / 2 : 0;
        if (mm < d.min && d.min - mm <= tol) mm = d.min;
        if (mm > d.max && mm - d.max <= tol) mm = d.max;
        if (d.kind === 'int') mm = Math.round(mm);
        if (mm < d.min || mm > d.max) return;
        params = { ...params, [d.key]: mm };
        opts.onParam(d.key, mm, `param:${d.key}`);
      },
    });
    const head = s.el.querySelector('.bx-field__head');
    head?.insertBefore(infoButton(d), head.querySelector('.bx-reset'));
    // A pointer drag is one gesture, ended on release. Keyboard steps (which fire `change` per
    // press) and typing coalesce through the history's time window instead.
    s.range.addEventListener('pointerup', opts.onGestureEnd);
    s.range.addEventListener('pointercancel', opts.onGestureEnd);
    s.input.addEventListener('blur', opts.onGestureEnd);
    return {
      def: d,
      el: s.el,
      focusable: s.input,
      set: (v) => s.set(conv(v as number), { silent: true }),
      setError: (m) => s.setError(m),
    };
  };

  /**
   * Shared shell for bool/enum/text: head with label, note and reset; body; error line. `target`
   * (default `body`) is the element that gets focus: it carries the label and error references.
   */
  const choiceShell = (d: ParamDef, body: HTMLElement, onReset: () => void, target: HTMLElement = body) => {
    const labelId = uid('lbl');
    const errId = `${labelId}-err`;
    const reset = resetButton(d.label, onReset);
    const err = errorLine(errId);
    const el = h(
      'div',
      { class: `bx-field app-choice app-choice--${d.kind}` },
      h('div', { class: 'bx-field__head' }, h('span', { class: 'bx-label', id: labelId }, d.label), infoButton(d), reset),
      body,
      err.el,
    );
    target.setAttribute('aria-labelledby', labelId);
    target.setAttribute('aria-describedby', errId);
    const sync = (v: ParamValue): void => {
      const changed = v !== d.default;
      reset.hidden = !changed;
      el.classList.toggle('is-changed', changed);
    };
    const setError = (m: string | null): void => {
      el.classList.toggle('is-invalid', m !== null);
      if (m !== null) target.setAttribute('aria-invalid', 'true');
      else target.removeAttribute('aria-invalid');
      err.show(m);
    };
    return { el, sync, setError };
  };

  const boolControl = (d: Extract<ParamDef, { kind: 'bool' }>): Control => {
    const sw = h(
      'button',
      { type: 'button', role: 'switch', class: 'app-switch', name: d.key },
      h('span', { class: 'app-switch__track', 'aria-hidden': 'true' }, h('span', { class: 'app-switch__knob' })),
      h('span', { class: 'app-switch__text', 'aria-hidden': 'true' }),
    );
    const text = sw.querySelector('.app-switch__text')!;
    const paint = (v: boolean): void => {
      sw.setAttribute('aria-checked', String(v));
      text.textContent = v ? 'On' : 'Off';
      shell.sync(v);
    };
    const commit = (v: boolean): void => {
      params = { ...params, [d.key]: v };
      paint(v);
      opts.onParam(d.key, v, `param:${d.key}`);
      opts.onGestureEnd();
    };
    const shell = choiceShell(d, sw, () => commit(d.default));
    sw.addEventListener('click', () => commit(!(params[d.key] as boolean)));
    paint(params[d.key] as boolean);
    return { def: d, el: shell.el, focusable: sw, set: (v) => paint(v as boolean), setError: shell.setError };
  };

  const enumControl = (d: Extract<ParamDef, { kind: 'enum' }>): Control => {
    const commit = (v: string): void => {
      params = { ...params, [d.key]: v };
      paint(v);
      opts.onParam(d.key, v, `param:${d.key}`);
      opts.onGestureEnd();
    };
    let paint: (v: string) => void;
    let body: HTMLElement;
    let focusable: HTMLElement;
    if (d.options.length <= 4) {
      const group = h('div', { class: 'bx-segment app-segment', role: 'radiogroup' });
      const btns = d.options.map((o) => {
        const b = h('button', { type: 'button', role: 'radio', class: 'bx-segment__opt', 'data-value': o }, h('span', {}, o));
        b.addEventListener('click', () => commit(o));
        group.append(b);
        return b;
      });
      group.addEventListener('keydown', (e) => {
        const i = btns.findIndex((b) => b === document.activeElement);
        const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (i < 0 || !delta) return;
        e.preventDefault();
        const next = btns[(i + delta + btns.length) % btns.length]!;
        next.focus();
        next.click();
      });
      paint = (v) => {
        for (const b of btns) {
          const on = b.dataset.value === v;
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
        }
        shell.sync(v);
      };
      body = group;
      focusable = btns[0]!;
    } else {
      const sel = h('select', { class: 'app-select', name: d.key, 'aria-label': d.label }, ...d.options.map((o) => h('option', { value: o }, o)));
      sel.addEventListener('change', () => commit(sel.value));
      paint = (v) => {
        sel.value = v;
        shell.sync(v);
      };
      body = h('div', { class: 'bx-well app-select-well' }, sel);
      focusable = sel;
    }
    // A radiogroup is labelled as a whole; a select is labelled itself (not its wrapper).
    const shell = choiceShell(d, body, () => commit(d.default), focusable instanceof HTMLSelectElement ? focusable : body);
    paint(params[d.key] as string);
    return { def: d, el: shell.el, focusable, set: (v) => paint(v as string), setError: shell.setError };
  };

  /** Free text (e.g. a size list): committed on every valid edit; invalid text shows an error. */
  const textControl = (d: Extract<ParamDef, { kind: 'text' }>): Control => {
    const input = h('input', {
      class: 'bx-well__input app-text', type: 'text', name: d.key, autocomplete: 'off', spellcheck: 'false',
      maxlength: d.maxLength, placeholder: d.examples[0], 'aria-label': d.label,
    });
    const body = h('div', { class: 'bx-well app-text-well' }, input);
    const shell = choiceShell(d, body, () => {
      input.value = d.default;
      shell.setError(null);
      commit(d.default);
    }, input);
    const valid = (v: string): boolean => v.length <= d.maxLength && (d.pattern === undefined || new RegExp(`^(?:${d.pattern})$`).test(v));
    const commit = (v: string): void => {
      params = { ...params, [d.key]: v };
      shell.sync(v);
      opts.onParam(d.key, v, `param:${d.key}`);
    };
    input.addEventListener('input', () => {
      if (!valid(input.value)) {
        shell.setError(`Use the format of e.g. “${d.examples[0]}”`);
        return;
      }
      shell.setError(null);
      commit(input.value);
    });
    input.addEventListener('blur', opts.onGestureEnd);
    const paint = (v: string): void => {
      // Set from outside (undo, preset, reset): the stored value is valid, so drop a stale format error.
      if (input.value !== v) {
        input.value = v;
        shell.setError(null);
      }
      shell.sync(v);
    };
    paint(params[d.key] as string);
    return { def: d, el: shell.el, focusable: input, set: (v) => paint(v as string), setError: shell.setError };
  };

  // Group in schema order; `units` lives in the top bar, not the form.
  const groups = new Map<string, ParamDef[]>();
  for (const d of g.schema) {
    if (d.key === 'units') continue;
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group)!.push(d);
  }

  const summaryOf = (defs: ParamDef[]): string => {
    const shown = defs.slice(0, 4);
    const allLengths = shown.every(isLength);
    const parts = shown.map((d) => {
      const v = params[d.key];
      if (typeof v === 'number') {
        const u = unitLabel(d, units);
        const n = formatNumber(isLength(d) ? toDisplay(v, units) : v, units === 'in' && isLength(d) ? 3 : 2);
        // "160 × 110 × 70 mm" for a run of lengths, otherwise each value carries its own unit.
        return allLengths || !u ? n : `${n} ${u}`;
      }
      if (typeof v === 'boolean') return `${d.label.toLowerCase()} ${v ? 'on' : 'off'}`;
      return String(v);
    });
    return allLengths ? `${parts.join(' × ')} ${units}` : parts.join(' · ');
  };

  const el = h('div', { class: 'app-form' });
  let index = 0;
  for (const [name, defs] of groups) {
    index += 1;
    const key = `${g.id}:${name}`;
    const p = panel({
      title: name,
      index,
      open: openGroups.get(key) ?? index <= 2,
      summary: summaryOf(defs),
      onToggle: (open) => openGroups.set(key, open),
    });
    const extra = opts.groupExtra?.(name);
    if (extra) p.body.append(extra);
    for (const d of defs) {
      const c = d.kind === 'bool' ? boolControl(d) : d.kind === 'enum' ? enumControl(d) : d.kind === 'text' ? textControl(d) : numberControl(d);
      controls.set(d.key, c);
      p.body.append(c.el);
    }
    // Reset the whole group in one undo step.
    const changed = (): boolean => defs.some((d) => params[d.key] !== def[d.key]);
    const resetGroup = h('button', { type: 'button', class: 'app-group-reset bx-btn bx-btn--quiet bx-btn--sm' }, svg(icons.reset), h('span', {}, `Reset ${name.toLowerCase()}`));
    resetGroup.addEventListener('click', () => {
      for (const d of defs) {
        if (params[d.key] === def[d.key]) continue;
        params = { ...params, [d.key]: def[d.key]! };
        controls.get(d.key)!.set(def[d.key]!);
        opts.onParam(d.key, def[d.key]!, `group:${name}`);
      }
      opts.onGestureEnd();
      refresh();
    });
    p.body.append(resetGroup);
    panels.set(name, p);
    const refresh = (): void => {
      p.setSummary(summaryOf(defs));
      resetGroup.hidden = !changed();
    };
    p.el.addEventListener('input', refresh);
    p.el.addEventListener('click', () => queueMicrotask(refresh));
    refreshers.push(refresh);
    refresh();
    el.append(p.el);
  }

  return {
    el,
    update(next) {
      params = { ...next };
      for (const [k, c] of controls) if (next[k] !== undefined) c.set(next[k]);
      for (const r of refreshers) r();
    },
    setError(param, message) {
      for (const [k, c] of controls) c.setError(k === param ? (message ?? null) : null);
      if (param) {
        const group = controls.get(param)?.def.group;
        if (group) panels.get(group)?.setOpen(true);
      }
    },
    focus(param) {
      const c = controls.get(param);
      if (!c) return;
      panels.get(c.def.group)?.setOpen(true);
      c.focusable.focus();
      c.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    destroy() {
      for (const t of tips) t.destroy();
    },
  };
}

