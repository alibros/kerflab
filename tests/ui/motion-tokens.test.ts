import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Motion must come from the --dur-* tokens (so prefers-reduced-motion can zero it).
 * Guard: no literal times in transition/animation declarations in stylesheets, and no
 * inline transition/animation styles or Web Animations calls in component code.
 */
const root = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p: string): string => readFileSync(root(p), 'utf8');

const CSS_FILES = ['src/app/ui/base.css', 'src/app/ui/app.css', 'src/sandbox/sandbox.css'];
const TS_FILES = [
  ...readdirSync(root('src/app/ui/components')).map((f) => `src/app/ui/components/${f}`),
  'src/app/ui/theme.ts',
  'src/app/ui/dom.ts',
  'src/app/views/layout2d.ts',
  'src/sandbox/main.ts',
].filter((f) => f.endsWith('.ts'));

const LITERAL_TIME = /(?<![\w-])\d*\.?\d+m?s\b/;

export function literalMotionInCss(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = stripped.match(/(?:transition|animation)(?:-[\w-]+)?\s*:[^;{}]*/g) ?? [];
  return decls.filter((d) => LITERAL_TIME.test(d.replace(/var\([^)]*\)/g, '')));
}

export function literalMotionInTs(ts: string): string[] {
  const hits: string[] = [];
  for (const line of ts.split('\n')) {
    if (/\.animate\(/.test(line)) hits.push(line.trim());
    if (/(transition|animation)[\w-]*['"]?\s*[,:=]/i.test(line) && LITERAL_TIME.test(line)) hits.push(line.trim());
  }
  return hits;
}

describe('motion uses duration tokens only', () => {
  it('detector catches literals and allows tokens', () => {
    expect(literalMotionInCss('.a { transition: opacity 150ms ease; }')).toHaveLength(1);
    expect(literalMotionInCss('.a { animation-duration: .3s }')).toHaveLength(1);
    expect(literalMotionInCss('.a { transition: opacity var(--dur-2) var(--ease); }')).toEqual([]);
    expect(literalMotionInTs("el.style.transition = 'transform 200ms';")).toHaveLength(1);
    expect(literalMotionInTs('el.animate([], 300);')).toHaveLength(1);
  });

  it.each(CSS_FILES)('%s has no literal transition/animation times', (f) => {
    expect(literalMotionInCss(read(f))).toEqual([]);
  });

  it.each(TS_FILES)('%s sets no literal-time transitions/animations', (f) => {
    expect(literalMotionInTs(read(f))).toEqual([]);
  });
});
