/**
 * Preset chips: the generator's built-ins, then the user's own (localStorage) with a delete
 * affordance, then an inline "save current as…" form.
 */
import type { Generator } from '../../core/part';
import type { Params } from '../../core/schema';
import { deleteUserPreset, loadUserPresets, saveUserPreset, uniquePresetName } from '../presets';
import { h, svg } from './dom';
import { icons } from './icons';

export interface PresetBarOptions {
  generator: Generator;
  getParams(): Params;
  onApply(preset: Params, name: string): void;
  onNotice(msg: string, tone?: 'info' | 'warn'): void;
}

export function buildPresetBar(opts: PresetBarOptions): HTMLElement {
  const g = opts.generator;
  const list = h('ul', { class: 'app-presets__list', role: 'list' });
  const nameInput = h('input', { class: 'bx-well__input', type: 'text', maxlength: 40, placeholder: 'Preset name', 'aria-label': 'Preset name', autocomplete: 'off' });
  const saveForm = h(
    'form',
    { class: 'app-presets__save', hidden: true },
    h('div', { class: 'bx-well' }, nameInput),
    h('button', { type: 'submit', class: 'bx-btn bx-btn--sm bx-btn--secondary' }, 'Save'),
    h('button', { type: 'button', class: 'bx-btn bx-btn--sm bx-btn--quiet', 'data-cancel': '' }, 'Cancel'),
  );
  const addBtn = h('button', { type: 'button', class: 'app-chip app-chip--add' }, svg(icons.plus), h('span', {}, 'Save current'));
  const el = h('div', { class: 'app-presets' }, h('h2', { class: 'bx-label app-side__label' }, 'Presets'), list, saveForm);

  const chip = (name: string, params: Params, user: boolean): HTMLElement => {
    const b = h('button', { type: 'button', class: `app-chip${user ? ' app-chip--user' : ''}` }, name);
    b.addEventListener('click', () => opts.onApply(params, name));
    const li = h('li', { class: 'app-chip-wrap' }, b);
    if (user) {
      const del = h('button', { type: 'button', class: 'app-chip__del', 'aria-label': `Delete preset ${name}` }, svg(icons.plus));
      del.addEventListener('click', () => {
        deleteUserPreset(g.id, name);
        render();
        opts.onNotice(`Deleted preset “${name}”.`);
      });
      li.append(del);
    }
    return li;
  };

  function render(): void {
    list.replaceChildren(
      ...Object.entries(g.presets).map(([n, p]) => chip(n, p, false)),
      ...Object.entries(loadUserPresets(g.id, undefined, g.schema)).map(([n, p]) => chip(n, p, true)),
      h('li', {}, addBtn),
    );
  }

  addBtn.addEventListener('click', () => {
    saveForm.hidden = false;
    addBtn.hidden = true;
    nameInput.value = '';
    nameInput.focus();
  });
  const closeForm = (): void => {
    saveForm.hidden = true;
    addBtn.hidden = false;
    addBtn.focus();
  };
  saveForm.querySelector('[data-cancel]')!.addEventListener('click', closeForm);
  saveForm.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeForm();
  });
  saveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = nameInput.value.trim();
    if (!typed) {
      nameInput.focus();
      return;
    }
    // Never overwrite an existing preset silently: save a copy as "name (2)".
    const name = uniquePresetName(g.id, typed);
    if (saveUserPreset(g.id, name, opts.getParams())) {
      opts.onNotice(`Saved preset “${name}” in this browser.`);
      render();
    } else opts.onNotice('Couldn’t save: this browser is blocking local storage.', 'warn');
    closeForm();
  });
  render();
  return el;
}
