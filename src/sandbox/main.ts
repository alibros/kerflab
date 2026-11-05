/**
 * Component sheet: every design-system component, in whichever theme is active.
 * Used for visual review (artifacts/shots) and the axe e2e test.
 */
import '../app/ui/base.css';
import './sandbox.css';
import { h, svg } from '../app/ui/dom';
import { icons } from '../app/ui/icons';
import { initTheme, onThemeChange, themeSwitch } from '../app/ui/theme';
import { button } from '../app/ui/components/button';
import { field } from '../app/ui/components/field';
import { slider } from '../app/ui/components/slider';
import { tabs } from '../app/ui/components/tabs';
import { tooltip } from '../app/ui/components/tooltip';
import { panel } from '../app/ui/components/panel';

initTheme();

const root = document.querySelector<HTMLDivElement>('#sandbox');
if (!root) throw new Error('#sandbox missing');

function section(n: number, title: string, note: string, ...body: HTMLElement[]): HTMLElement {
  return h(
    'section',
    { class: 'sb-section', 'aria-labelledby': `sb-s${n}` },
    h(
      'header',
      { class: 'sb-section__head' },
      h('span', { class: 'bx-balloon', 'aria-hidden': 'true' }, String(n).padStart(2, '0')),
      h('h2', { class: 'sb-section__title', id: `sb-s${n}` }, title),
      h('p', { class: 'sb-section__note' }, note),
    ),
    ...body,
  );
}

/* ── 01 Palette ─────────────────────────────────────────────────────────── */
const SWATCHES: [token: string, name: string][] = [
  ['--bg', 'Sheet'],
  ['--surface', 'Surface'],
  ['--well', 'Well'],
  ['--ink', 'Ink'],
  ['--ink-muted', 'Ink muted'],
  ['--accent', 'Laser'],
  ['--accent-ink', 'Laser text'],
  ['--brass', 'Brass'],
  ['--brass-ink', 'Brass text'],
  ['--edge', 'Edge'],
  ['--danger-ink', 'Redline'],
  ['--birch', 'Birch'],
  ['--walnut', 'Walnut'],
];

function toHex(rgb: string): string {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m) return rgb;
  return `#${m
    .slice(0, 3)
    .map((x) => Math.round(Number(x)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

const swatchEls = SWATCHES.map(([token, name]) => {
  const chip = h('span', { class: 'sb-swatch__chip', style: `background: var(${token})` });
  const hex = h('span', { class: 'sb-swatch__hex bx-mono' });
  const el = h(
    'li',
    { class: 'sb-swatch' },
    chip,
    h('span', { class: 'sb-swatch__name' }, name),
    h('code', { class: 'sb-swatch__token bx-mono' }, token),
    hex,
  );
  return { chip, hex, el };
});
const refreshHex = (): void => {
  for (const s of swatchEls) s.hex.textContent = toHex(getComputedStyle(s.chip).backgroundColor);
};

function themeCard(scheme: 'light' | 'dark', name: string, sub: string): HTMLElement {
  return h(
    'div',
    { class: 'sb-themecard', style: `color-scheme: ${scheme}` },
    h('span', { class: 'sb-themecard__name' }, name),
    h('span', { class: 'sb-themecard__sub bx-mono' }, sub),
    h('span', { class: 'sb-themecard__laser', 'aria-hidden': 'true' }),
    h('div', { class: 'bx-dim sb-themecard__dim' }, '297.0', h('span', { class: 'bx-dim__unit' }, 'mm')),
  );
}

const palette = section(
  1,
  'Palette',
  'Paper & Blueprint. One laser accent; brass is ornament, its -ink twin carries meaning.',
  h('div', { class: 'sb-themes' }, themeCard('light', 'Paper', '#F3EFE6 · ink #1B1F2A'), themeCard('dark', 'Blueprint', '#0F1420 · chalk #E8E3D7')),
  h('ul', { class: 'sb-swatches', role: 'list' }, ...swatchEls.map((s) => s.el)),
);

/* ── 02 Type ────────────────────────────────────────────────────────────── */
const type = section(
  2,
  'Type',
  'Bricolage Grotesque, narrowed for headings. IBM Plex Mono with tabular, slashed-zero numerals.',
  h(
    'div',
    { class: 'sb-type' },
    h('p', { class: 'bx-display' }, 'Drawn to measure.', h('br'), h('span', { class: 'sb-type__accent' }, 'Cut to fit.')),
    h(
      'p',
      { class: 'sb-type__body' },
      'Parametric boxes for the laser cutter. Every edge is a joint, every joint is a number you can change — and every number shows its unit.',
    ),
    h('p', { class: 'sb-type__mono bx-mono' }, '120.0 × 80.0 × 60.0 mm', h('span', { class: 'bx-muted' }, '  ·  t 3.0  ·  kerf 0.10')),
    h('p', { class: 'bx-label' }, 'Label · settings group'),
  ),
);

/* ── 03 Buttons ─────────────────────────────────────────────────────────── */
const addBtn = button({ label: 'Add divider', icon: 'plus', iconOnly: true });
tooltip(addBtn, 'Add divider');
const buttons = section(
  3,
  'Buttons',
  'Primary is the laser — one per view. Secondary is inked outline; quiet is text only.',
  h(
    'div',
    { class: 'sb-row' },
    button({ label: 'Export SVG', variant: 'primary', icon: 'download', kbd: '⌘E' }),
    button({ label: 'Copy link', icon: 'link' }),
    button({ label: 'Reset all', variant: 'quiet', icon: 'reset' }),
    addBtn,
  ),
  h(
    'div',
    { class: 'sb-row' },
    button({ label: 'Cut', variant: 'primary', size: 'sm' }),
    button({ label: 'Nest parts', size: 'sm' }),
    button({ label: 'Undo', variant: 'quiet', size: 'sm', kbd: '⌘Z' }),
    button({ label: 'Disabled', disabled: true }),
  ),
);

/* ── 04 Fields ──────────────────────────────────────────────────────────── */
const widthField = field({ label: 'Width', value: 140, defaultValue: 120, unit: 'mm', min: 20, max: 1000, step: 0.1, help: 'Outer size, X axis' });
const thick = field({ label: 'Thickness', value: 3, unit: 'mm', min: 1, max: 12, step: 0.1, help: 'Measure your stock' });
const kerf = field({ label: 'Kerf', value: 0.1, unit: 'mm', min: 0, max: 0.5, step: 0.01 });
kerf.input.value = '0.8';
kerf.input.dispatchEvent(new Event('input'));
const fingers = field({ label: 'Finger count', value: 5, min: 1, max: 40, step: 1 });
const fields = section(
  4,
  'Fields',
  'Typed numbers with unit suffix. Changed values get a diamond and a reset; errors are redlined.',
  h('div', { class: 'sb-grid2' }, widthField.el, thick.el, kerf.el, fingers.el),
);

/* ── 05 Sliders ─────────────────────────────────────────────────────────── */
const depth = slider({ label: 'Depth', value: 60, min: 20, max: 300, step: 1, unit: 'mm', divisions: 14 });
const explode = slider({ label: 'Explode', value: 35, defaultValue: 0, min: 0, max: 100, step: 1, unit: '%', help: 'Pull parts apart in 3D' });
const sliders = section(5, 'Sliders', 'A steel rule with a laser cursor, always paired with a typed value.', depth.el, explode.el);

/* ── 06 Tabs ────────────────────────────────────────────────────────────── */
function partDrawing(): HTMLElement {
  const fig = h('figure', { class: 'sb-part' });
  fig.append(
    svg(`<svg viewBox="0 0 320 150" width="320" height="150">
  <path class="sb-part__cut" d="M20 30 h30 v-8 h30 v8 h30 v-8 h30 v8 h30 v-8 h30 v8 h30 V120 H20 Z"/>
  <circle class="sb-part__hole" cx="140" cy="76" r="9"/>
  <g class="sb-part__dim"><path d="M20 136 H230 M20 131 v10 M230 131 v10"/><path d="M246 30 V120 M241 30 h10 M241 120 h10"/></g>
  <text class="sb-part__txt" x="125" y="133" text-anchor="middle">210.0</text>
  <text class="sb-part__txt" x="262" y="79">90.0</text>
</svg>`),
    h('figcaption', { class: 'bx-muted' }, 'Front · birch 3 mm · 5 fingers'),
  );
  return fig;
}
const tabSet = tabs({
  label: 'Preview',
  tabs: [
    { id: '2d', label: 'Sheet', content: partDrawing() },
    { id: '3d', label: '3D view', content: h('p', { class: 'bx-muted' }, 'The assembled box renders here.') },
    { id: 'cut', label: 'Cut list', content: h('p', { class: 'bx-mono' }, '6 parts · 1 sheet · 2.84 m of cut') },
  ],
});
const tabsSection = section(6, 'Tabs', 'Arrow keys move and select. The laser line slides to the active tab.', tabSet.el);

/* ── 07 Tooltip ─────────────────────────────────────────────────────────── */
const tipTarget = h('button', { type: 'button', class: 'sb-info', 'aria-label': 'About finger width' }, svg(icons.info));
const tipBody = h(
  'div',
  {},
  h('span', { class: 'bx-tooltip__title' }, 'Finger width'),
  'Width of each finger, as a multiple of material thickness.',
  svg(`<svg viewBox="0 0 160 44" width="160" height="44">
  <path d="M4 30 h24 v-12 h24 v12 h24 v-12 h24 v12 h24 v-12 h24 v12" fill="none" stroke="currentColor" stroke-width="1.25"/>
  <path d="M52 8 H76 M52 4 v8 M76 4 v8" style="stroke: var(--accent)" stroke-width="1.25"/>
</svg>`),
  h('span', { class: 'bx-mono' }, 'default 2.0 × t'),
);
tooltip(tipTarget, tipBody, { placement: 'top' });
const tipDemo = h(
  'div',
  { class: 'sb-row' },
  h('span', { class: 'bx-label' }, 'Finger width'),
  tipTarget,
  h('span', { class: 'bx-muted sb-hint' }, 'Hover or focus the ⓘ — tooltips are drafting notes on a leader line.'),
);
const tooltipSection = section(7, 'Tooltip', 'Shows on hover or focus, stays while hovered, Esc dismisses.', tipDemo);

/* ── 08 Panels ──────────────────────────────────────────────────────────── */
const dimsSummary = (): string =>
  `${widthField.value} × ${depth.value} × 60 mm`;
const p1 = panel({
  title: 'Dimensions',
  index: 1,
  summary: dimsSummary(),
  content: [
    field({ label: 'Width', value: 120, unit: 'mm', min: 20, max: 1000, step: 0.1 }).el,
    field({ label: 'Height', value: 60, unit: 'mm', min: 20, max: 1000, step: 0.1 }).el,
  ],
});
const p2 = panel({
  title: 'Joints',
  index: 2,
  open: false,
  summary: 'fingers · 2.0 × t',
  content: [slider({ label: 'Finger width', value: 2, min: 1, max: 5, step: 0.1, unit: '× t', divisions: 8 }).el],
});
const p3 = panel({
  title: 'Material',
  index: 3,
  open: false,
  summary: 'birch · 3.0 mm',
  content: [field({ label: 'Thickness', value: 3, unit: 'mm', min: 1, max: 12, step: 0.1 }).el],
});
const panels = section(8, 'Panels', 'Collapsible settings groups; the collapsed header keeps a summary.', h('div', {}, p1.el, p2.el, p3.el));

/* ── 09 Dimension callouts ─────────────────────────────────────────────── */
const dims = section(
  9,
  'Dimension callouts',
  'How numbers are annotated across the app.',
  h(
    'div',
    { class: 'sb-dims' },
    h('div', { class: 'bx-dim', style: 'inline-size: 100%' }, '297.0', h('span', { class: 'bx-dim__unit' }, 'mm')),
    h('div', { class: 'bx-dim', style: 'inline-size: 62%' }, '184.5', h('span', { class: 'bx-dim__unit' }, 'mm')),
    h('div', { class: 'bx-dim bx-dim--accent', style: 'inline-size: 36%' }, '3.00', h('span', { class: 'bx-dim__unit' }, 'mm')),
  ),
);

/* ── Sheet ──────────────────────────────────────────────────────────────── */
const titleBlock = h(
  'dl',
  { class: 'sb-titleblock bx-mono', 'aria-label': 'Title block' },
  ...(
    [
      ['Drawing', 'Component sheet'],
      ['No.', 'UI-01'],
      ['Scale', '1 : 1'],
      ['Rev', 'A'],
      ['Date', '2026-11-05'],
    ] as const
  ).flatMap(([k, v]) => [h('div', {}, h('dt', {}, k), h('dd', {}, v))]),
);

const top = h(
  'header',
  { class: 'sb-top' },
  h(
    'div',
    { class: 'sb-brand' },
    h('span', { class: 'sb-wordmark' }, 'kerf', h('span', { class: 'sb-wordmark__kerf', 'aria-hidden': 'true' }), 'lab'),
    h('span', { class: 'sb-brand__sub' }, 'Design system'),
  ),
  themeSwitch().el,
);

root.append(
  top,
  h(
    'main',
    { class: 'sb-sheet' },
    h(
      'div',
      { class: 'sb-intro' },
      h('h1', { class: 'bx-display' }, 'Component sheet'),
      h('p', { class: 'sb-intro__lede' }, 'A maker’s drafting table: paper, ink, brass — and one laser.'),
    ),
    h(
      'div',
      { class: 'sb-cols' },
      h('div', { class: 'sb-col' }, palette, type, buttons, tooltipSection, dims),
      h('div', { class: 'sb-col' }, fields, sliders, tabsSection, panels),
    ),
    titleBlock,
  ),
);

refreshHex();
onThemeChange(() => requestAnimationFrame(refreshHex));
