import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.x contrast check computed straight from src/app/ui/tokens.css.
 * Every colour token is declared once as `--name: light-dark(<paper>, <blueprint>);`
 * so parsing that file gives us both themes without a second source of truth.
 */

type Theme = 'light' | 'dark';
type Rgb = readonly [number, number, number];

const css = readFileSync(
  fileURLToPath(new URL('../../src/app/ui/tokens.css', import.meta.url)),
  'utf8',
);

function parseTokens(source: string): Map<string, Record<Theme, string>> {
  const out = new Map<string, Record<Theme, string>>();
  const re = /(--[\w-]+)\s*:\s*light-dark\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*\)/g;
  for (const m of source.matchAll(re)) {
    out.set(m[1]!, { light: m[2]!, dark: m[3]! });
  }
  return out;
}

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = parseTokens(css);

function tok(name: string, theme: Theme): string {
  const t = tokens.get(name);
  if (!t) throw new Error(`token ${name} missing from tokens.css (expected light-dark(#hex, #hex))`);
  return t[theme];
}

const SURFACES = ['--bg', '--surface', '--well'];

/** Text that must reach 4.5:1 (WCAG 1.4.3, normal-size text). */
const TEXT_PAIRS: [fg: string, bg: string][] = [
  ...['--ink', '--ink-muted', '--accent-ink', '--brass-ink', '--danger-ink'].flatMap((fg) =>
    SURFACES.map((bg): [string, string] => [fg, bg]),
  ),
  ['--on-accent', '--accent-fill'],
  ['--on-accent', '--accent-fill-hover'],
  ['--on-ink', '--ink'], // tooltip / inverted chips
  // State washes that base.css puts text on (hover, press, selection, invalid well).
  ...['--ink', '--ink-muted'].flatMap((fg) => ['--hover', '--press'].map((bg): [string, string] => [fg, bg])),
  ['--accent-ink', '--hover'], // reset button / info icon / selected tab index on hover
  ['--brass-ink', '--hover'], // tab index numerals on hover
  ['--ink', '--accent-wash'], // ::selection
  ['--danger-ink', '--danger-wash'], // invalid-well hatching under error text
];

/**
 * Non-text UI that must reach 3:1 (WCAG 1.4.11): focus ring, control edges, accent marks.
 * Raw `--brass` (#B08A3E, 2.8:1 on paper) is deliberately absent: it is ornament only
 * (drafting ticks, rules). Anything brass that carries meaning uses `--brass-ink`.
 */
const UI_PAIRS: [fg: string, bg: string][] = [
  ...['--accent', '--focus', '--edge', '--brass-ink', '--danger-ink'].flatMap((fg) =>
    SURFACES.map((bg): [string, string] => [fg, bg]),
  ),
  ['--accent-fill', '--bg'], // primary button boundary against the page
  ['--accent-fill', '--surface'],
];

describe('contrast tests helper', () => {
  it('matches known WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('design tokens', () => {
  it('keeps the plan-mandated brand values', () => {
    expect(tok('--bg', 'light').toUpperCase()).toBe('#F3EFE6');
    expect(tok('--ink', 'light').toUpperCase()).toBe('#1B1F2A');
    expect(tok('--accent', 'light').toUpperCase()).toBe('#E8452C');
    expect(tok('--accent', 'dark').toUpperCase()).toBe('#E8452C');
    expect(tok('--brass', 'light').toUpperCase()).toBe('#B08A3E');
    expect(tok('--bg', 'dark').toUpperCase()).toBe('#0F1420');
  });

  it('defines motion tokens 120/160/200 ms and one easing', () => {
    expect(css).toMatch(/--dur-1:\s*120ms/);
    expect(css).toMatch(/--dur-2:\s*160ms/);
    expect(css).toMatch(/--dur-3:\s*200ms/);
    expect(css.match(/--ease[\w-]*\s*:/g)).toHaveLength(1);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*--dur-1:\s*0ms/);
  });
});

for (const theme of ['light', 'dark'] as const) {
  describe(`contrast — ${theme === 'light' ? 'Paper' : 'Blueprint'} theme`, () => {
    it.each(TEXT_PAIRS)('text %s on %s ≥ 4.5', (fg, bg) => {
      expect(contrast(tok(fg, theme), tok(bg, theme))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(UI_PAIRS)('ui %s on %s ≥ 3', (fg, bg) => {
      expect(contrast(tok(fg, theme), tok(bg, theme))).toBeGreaterThanOrEqual(3);
    });
  });
}
