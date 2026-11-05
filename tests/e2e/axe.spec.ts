import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const THEMES = ['light', 'dark'] as const;

async function openSandbox(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem('kerflab:theme', t), theme);
  await page.goto('/sandbox.html');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
}

async function audit(page: Page): Promise<void> {
  // Audit settled states, not mid-transition frames.
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  expect(summary).toEqual([]);
}

for (const theme of THEMES) {
  test.describe(`sandbox a11y — ${theme}`, () => {
    test('component sheet has zero axe violations', async ({ page }) => {
      await openSandbox(page, theme);
      await audit(page);
    });

    test('expanded panels, other tabs and an open tooltip stay clean', async ({ page }) => {
      await openSandbox(page, theme);
      for (const trigger of await page.locator('.bx-panel__trigger').all()) {
        if ((await trigger.getAttribute('aria-expanded')) === 'false') await trigger.click();
      }
      await page.getByRole('tab', { name: /Cut list/ }).click();
      await page.getByRole('button', { name: 'About finger width' }).focus();
      await expect(page.getByRole('tooltip').filter({ hasText: 'Finger width' })).toBeVisible();
      await audit(page);
    });
  });
}

for (const theme of THEMES) {
  test(`About dialog credits boxes.py and the author, closes on Escape, zero axe violations — ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('kerflab:theme', t), theme);
    await page.goto('/#v1/closedbox');
    await expect(page).toHaveTitle(/KerfLab/);
    await page.getByRole('button', { name: 'About', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /about/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'boxes.py' }).first()).toHaveAttribute('href', 'https://github.com/florianfesti/boxes');
    await expect(dialog.getByRole('link', { name: 'Ali Bross' })).toHaveAttribute('href', 'https://forestofrods.com');
    await expect(dialog).toContainText('Claude Opus 5.5');
    await expect(dialog).toContainText('Contributions');
    await audit(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}
