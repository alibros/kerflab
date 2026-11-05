/** Tiny DOM helpers shared by the component factories. No framework, no magic. */

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

let seq = 0;
/** Document-unique id for ARIA wiring. */
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq.toString(36)}`;
}

/** Parse a trusted, static SVG string (from icons.ts) into an element. */
export function svg(markup: string): SVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  const el = tpl.content.firstElementChild;
  if (!(el instanceof SVGElement)) throw new Error('svg(): markup is not an <svg>');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  return el;
}

/** Format a number for display in a field: trims float noise, keeps up to `decimals`. */
export function formatNumber(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '';
  const fixed = v.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

export function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
