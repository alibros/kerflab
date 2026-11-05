/**
 * Motion policy in one place. CSS motion comes only from the --dur-* tokens, which tokens.css
 * zeroes under `prefers-reduced-motion`; JS-driven motion (the eased explode, camera framing)
 * asks `reducedMotion()` and jumps straight to the end state instead.
 */
export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Time constant (ms) of the slider-eased explode. */
export const EXPLODE_TAU = 70;

/** Duration of a motion token in ms (0 under reduced motion), e.g. `tokenMs('--dur-2')`. */
export function tokenMs(name: '--dur-1' | '--dur-2' | '--dur-3'): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  return raw.endsWith('ms') ? n : n * 1000;
}
