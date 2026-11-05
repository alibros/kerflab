/**
 * Stock picker at the top of the Material group: one choice sets thickness and kerf together
 * (a single undo step). It reads "Custom" whenever the two values match no profile, so typing a
 * thickness never fights it.
 */
import type { Params } from '../../core/schema';
import { LASER_MATERIALS, matchMaterial, type MaterialProfile } from '../profiles';
import { formatLength, type Units } from '../units';
import { h, uid } from './dom';

export interface MaterialPickerHandle {
  el: HTMLElement;
  update(params: Params): void;
}

const CUSTOM = 'custom';

export function buildMaterialPicker(opts: { params: Params; units: Units; onPick(p: MaterialProfile): void }): MaterialPickerHandle {
  const id = uid('stock');
  const kerf = (mm: number): string => formatLength(mm, opts.units, opts.units === 'in' ? 4 : 2);
  const custom = h('option', { value: CUSTOM, disabled: true }, 'Custom');
  const select = h(
    'select',
    { id, class: 'app-select', name: 'stock' },
    ...LASER_MATERIALS.map((m) => h('option', { value: m.id }, `${m.label} · kerf ${kerf(m.kerf)}`)),
    custom,
  );
  const el = h(
    'div',
    { class: 'bx-field app-choice app-stock' },
    h('div', { class: 'bx-field__head' }, h('label', { class: 'bx-label', for: id }, 'Stock')),
    h('div', { class: 'bx-well app-select-well' }, select),
  );
  select.addEventListener('change', () => {
    const m = LASER_MATERIALS.find((x) => x.id === select.value);
    if (m) opts.onPick(m);
  });

  const update = (p: Params): void => {
    const m = matchMaterial(p.thickness, p.kerf);
    const t = typeof p.thickness === 'number' ? formatLength(p.thickness, opts.units, opts.units === 'in' ? 3 : 1) : '';
    custom.textContent = m ? 'Custom' : `Custom · ${t}, kerf ${typeof p.kerf === 'number' ? kerf(p.kerf) : '—'}`;
    // A disabled option can still be the selected one; it just cannot be chosen from the list.
    select.value = m ? m.id : CUSTOM;
  };
  update(opts.params);
  return { el, update };
}
