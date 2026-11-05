/**
 * Bottom bar, laid out like a drawing's title block: sheet size and the job's numbers
 * (parts, sheets, cut length, a rough cut-time estimate).
 */
import type { BuildResult } from '../build';
import { clampSpeed, estimate, formatDuration, SPEED_RANGE } from '../estimate';
import { LASER_MACHINES, matchMaterial, matchSheet, SHEET_RANGE, sheetById, STOCK_SHEETS, type MaterialLook, type SheetProfile } from '../profiles';
import type { Sheet } from '../store';
import { formatLength, fromDisplay, toDisplay, type Units } from '../units';
import { h } from './dom';

const CUSTOM = 'custom';
const PREF_KEY = 'kerflab:sheet-profile';
const LOOK_SHORT: Record<MaterialLook, string> = { plywood: 'Ply', mdf: 'MDF', acrylic: 'Acrylic' };

function readPreferred(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}
function savePreferred(id: string): void {
  try {
    localStorage.setItem(PREF_KEY, id);
  } catch {
    /* not persisted */
  }
}

export interface BottomBarHandle {
  el: HTMLElement;
  render(r: BuildResult, view: { units: Units; sheet: Sheet; thickness: number | undefined; kerf?: number | undefined; speed: number }): void;
}

export function buildBottomBar(opts: { onSheet(s: Sheet): void; onSpeed(mm_s: number): void }): BottomBarHandle {
  const select = h('select', { class: 'app-select', id: 'sheet-size', 'aria-label': 'Sheet size' });
  const beds = h('optgroup', { label: 'Laser beds' });
  const stock = h('optgroup', { label: 'Stock sheets' });
  const customOpt = h('option', { value: CUSTOM }, 'Custom…');
  select.append(beds, stock, customOpt);
  // Width × height for a custom sheet, in the display unit; shown only while Custom is chosen.
  const dimInput = (label: string): HTMLInputElement =>
    h('input', { class: 'bx-well__input app-dims__input', type: 'number', inputmode: 'decimal', autocomplete: 'off', 'aria-label': label });
  const dimW = dimInput('Custom sheet width');
  const dimH = dimInput('Custom sheet height');
  const dimUnit = h('span', { class: 'app-speed__unit bx-mono', 'aria-hidden': 'true' });
  const dims = h(
    'div',
    { class: 'bx-well app-dims', hidden: true },
    dimW,
    h('span', { class: 'app-dims__x', 'aria-hidden': 'true' }, '×'),
    dimH,
    dimUnit,
  );
  let units: Units = 'mm';
  let current: Sheet = { w: 0, h: 0 };
  /** The user chose Custom… and is typing a size, even one that happens to match a profile. */
  let customMode = false;
  /** The next sheet change is the user's own custom entry, so Custom stays selected. */
  let ownEdit = false;
  let preferred = readPreferred();

  select.addEventListener('change', () => {
    if (select.value === CUSTOM) {
      customMode = true;
      paintSheet();
      dimW.focus();
      dimW.select();
      return;
    }
    const p = sheetById(select.value);
    if (!p) return;
    customMode = false;
    preferred = p.id;
    savePreferred(p.id);
    opts.onSheet({ w: p.w, h: p.h });
  });
  const commitDims = (): void => {
    const read = (el: HTMLInputElement, fallback: number): number => {
      const n = fromDisplay(el.valueAsNumber, units);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(Math.max(Math.round(n * 10) / 10, SHEET_RANGE.min), SHEET_RANGE.max);
    };
    const next = { w: read(dimW, current.w), h: read(dimH, current.h) };
    paintDims(next);
    if (next.w === current.w && next.h === current.h) return;
    ownEdit = true;
    opts.onSheet(next);
  };
  dimW.addEventListener('change', commitDims);
  dimH.addEventListener('change', commitDims);

  const fmt = (mm: number): string => formatLength(mm, units, units === 'in' ? 1 : 0).replace(/ \w+$/, '');
  const optionFor = (p: SheetProfile): HTMLOptionElement => h('option', { value: p.id }, `${p.label} · ${fmt(p.w)} × ${fmt(p.h)}`);
  let paintedUnits: Units | null = null;
  function paintDims(s: Sheet): void {
    const dec = units === 'in' ? 2 : 1;
    for (const [el, mm] of [[dimW, s.w], [dimH, s.h]] as const) {
      if (document.activeElement === el) continue;
      el.value = String(Number(toDisplay(mm, units).toFixed(dec)));
    }
    dimW.step = dimH.step = units === 'in' ? '0.01' : '1';
    dimUnit.textContent = units;
  }
  function paintSheet(): void {
    if (paintedUnits !== units) {
      beds.replaceChildren(...LASER_MACHINES.map(optionFor));
      stock.replaceChildren(...STOCK_SHEETS.map(optionFor));
      paintedUnits = units;
    }
    const match = customMode ? null : matchSheet(current, preferred);
    select.value = match ? match.id : CUSTOM;
    dims.hidden = !!match;
    sheetCell.classList.toggle('is-custom', !match);
    paintDims(current);
  }

  const cell = (label: string, value: HTMLElement): HTMLElement =>
    h('div', { class: 'app-tb__cell' }, h('span', { class: 'app-tb__k' }, label), value);
  const v = (): HTMLElement => h('span', { class: 'app-tb__v bx-mono' });
  const parts = v();
  const sheets = v();
  const length = v();
  const time = v();
  const speed = h('input', {
    id: 'laser-speed',
    class: 'bx-well__input app-speed__input',
    type: 'number',
    inputmode: 'decimal',
    min: SPEED_RANGE.min,
    max: SPEED_RANGE.max,
    step: 1,
    autocomplete: 'off',
    'aria-label': 'Laser cutting speed, millimetres per second',
  });
  speed.addEventListener('change', () => {
    const n = clampSpeed(speed.valueAsNumber);
    speed.value = String(n);
    opts.onSpeed(n);
  });
  const speedWell = h('div', { class: 'bx-well app-speed' }, speed, h('span', { class: 'app-speed__unit bx-mono', 'aria-hidden': 'true' }, 'mm/s'));
  const material = v();
  const sheetCell = h(
    'div',
    { class: 'app-tb__cell app-tb__cell--sheet' },
    h('label', { class: 'app-tb__k', for: 'sheet-size' }, 'Sheet'),
    h('div', { class: 'app-sheet' }, h('div', { class: 'bx-well app-select-well' }, select), dims),
  );
  const el = h(
    'footer',
    { class: 'app-tb', 'aria-label': 'Job summary' },
    sheetCell,
    cell('Material', material),
    cell('Parts', parts),
    cell('Sheets', sheets),
    cell('Cut length', length),
    h('div', { class: 'app-tb__cell' }, h('span', { class: 'app-tb__k' }, 'Est. cut time'), h('div', { class: 'app-tb__time' }, time, speedWell)),
  );

  return {
    el,
    render(r, view) {
      const sheetChanged = view.sheet.w !== current.w || view.sheet.h !== current.h;
      if (sheetChanged || view.units !== units) {
        // A size that came from elsewhere (a link, a hash edit) shows as its profile if it has
        // one; a size typed into the custom fields keeps Custom selected.
        if (sheetChanged && !ownEdit) customMode = false;
        ownEdit = false;
        current = { ...view.sheet };
        units = view.units;
        paintSheet();
      }
      const prof = matchMaterial(view.thickness, view.kerf);
      const t = view.thickness === undefined ? '—' : formatLength(view.thickness, view.units, view.units === 'in' ? 3 : 1);
      material.textContent = prof && view.thickness !== undefined ? `${LOOK_SHORT[prof.look]} ${t}` : t;
      material.title = prof ? prof.label : '';
      if (document.activeElement !== speed) speed.value = String(view.speed);
      if (!r.ok) {
        for (const x of [parts, sheets, length, time]) x.textContent = '—';
        return;
      }
      const est = estimate(r.layout, { speed: view.speed });
      const mm = est.cutLengthMm;
      parts.textContent = String(r.parts.length);
      sheets.textContent = r.layout.unfit.length ? `${r.layout.sheets} + ${r.layout.unfit.length} too big` : String(r.layout.sheets);
      length.textContent = view.units === 'in' ? `${(mm / 25.4 / 12).toFixed(1)} ft` : `${(mm / 1000).toFixed(2)} m`;
      time.textContent = formatDuration(est.minutes);
    },
  };
}
