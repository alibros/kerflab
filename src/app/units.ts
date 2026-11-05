/**
 * Display units. Geometry, params and the store are always millimetres; inches exist only at the
 * edges (form display, readouts, export). Conversions are exact inverses up to float rounding.
 */
export type Units = 'mm' | 'in';

export const MM_PER_IN = 25.4;

export function toDisplay(mm: number, units: Units): number {
  return units === 'in' ? mm / MM_PER_IN : mm;
}

export function fromDisplay(v: number, units: Units): number {
  return units === 'in' ? v * MM_PER_IN : v;
}

/** Input step for a millimetre step shown in `units`: a thou for whole-mm params, a tenth of a thou for finer ones (kerf). */
export function displayStep(stepMm: number, units: Units): number {
  if (units === 'mm') return stepMm;
  return stepMm >= 1 ? 0.001 : 0.0001;
}

/** Decimals to show for a length in `units`. */
export function displayDecimals(units: Units): number {
  return units === 'in' ? 3 : 1;
}

/** "120.5 mm" / "4.744 in", trimmed of trailing zeros. */
export function formatLength(mm: number, units: Units, decimals = displayDecimals(units)): string {
  const v = toDisplay(mm, units).toFixed(decimals);
  const t = v.includes('.') ? v.replace(/\.?0+$/, '') : v;
  return `${t} ${units}`;
}
