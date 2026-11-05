import { expect, test, type Page } from '@playwright/test';
import { registry } from '../../src/generators';

/**
 * Registry-wide screenshot sweep: every generator, at its defaults, in the Sheet and 3D
 * views, light and dark, saved to artifacts/shots/<id>-<view>-<theme>.png for visual review.
 *
 * Assertions are deliberately few: the page must raise no console error or page error, the build
 * must succeed (no "Can't cut this yet" banner), the sheet must draw at least one part and the 3D
 * view must render real pixels. Runs in the "shots" project (SwiftShader, see playwright.config.ts):
 *
 *   npx playwright test --project=shots --no-deps --workers=4
 *
 * About 5 minutes on a 10-core laptop. More workers than about half the cores starves SwiftShader;
 * the project retries a test twice for that reason (a console error fails every attempt anyway).
 */

type Hook = { frames(): number; isAnimating(): boolean; sample(): { distinct: number; coverage: number } };

const THEMES = ['light', 'dark'] as const;

test.describe.configure({ mode: 'parallel' });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Name a renderer crash instead of letting it surface as "element is not attached" or a timeout.
  page.on('crash', () => errors.push('renderer crashed'));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function settled3d(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const v = (document.querySelector('[data-testid=viewer3d]') as unknown as { __v3d?: Hook })?.__v3d;
      return !!v && v.frames() > 0 && !v.isAnimating();
    },
    null,
    { timeout: 60_000 },
  );
}

for (const g of registry) {
  for (const theme of THEMES) {
    test(`${g.id} — sheet and 3D, ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1360, height: 900 });
      await page.addInitScript((t) => {
        for (const k of Object.keys(localStorage)) if (k.startsWith('kerflab:')) localStorage.removeItem(k);
        localStorage.setItem('kerflab:theme', t);
        localStorage.setItem('kerflab:tab', 'sheet');
      }, theme);
      await page.goto(`/#v1/${g.id}`);
      await page.evaluate(() => document.fonts.ready);

      // Sheet view.
      await expect(page.locator('.l2d-part').first()).toBeVisible();
      await expect(page.getByTestId('stage-error')).toBeHidden();
      await page.mouse.move(0, 0);
      await page.locator('#stage').screenshot({ path: `artifacts/shots/${g.id}-sheet-${theme}.png` });

      // 3D view.
      await page.getByRole('tab', { name: /3D/ }).click();
      await settled3d(page);
      await page.mouse.move(0, 0);
      await settled3d(page);
      const s = (await page.evaluate(
        `document.querySelector('[data-testid=viewer3d]').__v3d.sample()`,
      )) as { distinct: number; coverage: number };
      await page.locator('#stage').screenshot({ path: `artifacts/shots/${g.id}-3d-${theme}.png` });
      expect(s.coverage, '3D view covers some of the canvas').toBeGreaterThan(0.01);

      expect(errors).toEqual([]);
    });
  }
}
