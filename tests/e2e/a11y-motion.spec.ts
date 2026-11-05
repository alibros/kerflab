import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
});

/** Tab forward until the focused element satisfies `match` (keyboard-only navigation). */
async function tabTo(page: Page, match: string, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((m) => {
      const el = document.activeElement;
      return !!el && el.matches(m);
    }, match);
    if (hit) return;
  }
  throw new Error(`never focused ${match}`);
}

test('reduced motion zeroes every transition and animation duration', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const d = await page.evaluate(() => {
    const cs = (sel: string): CSSStyleDeclaration => getComputedStyle(document.querySelector(sel)!);
    const flat = (v: string): string => [...new Set(v.split(',').map((x) => x.trim()))].join(',');
    return {
      panel: flat(cs('.bx-panel__body').transitionDuration),
      chev: flat(cs('.bx-panel__chev').transitionDuration),
      tabs: flat(cs('.bx-tabs__indicator').transitionDuration),
      tabPanel: flat(cs('.bx-tabs__panel:not([hidden])').animationDuration),
      token: getComputedStyle(document.documentElement).getPropertyValue('--dur-3').trim(),
    };
  });
  expect(d).toEqual({ panel: '0s', chev: '0s', tabs: '0s', tabPanel: '0s', token: '0ms' });
});

test('with motion allowed the panel reveal uses a 120-200 ms token', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const ms = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.bx-panel__body')!).transitionDuration) * 1000);
  expect(ms).toBeGreaterThanOrEqual(120);
  expect(ms).toBeLessThanOrEqual(200);
});

test('palette: opens on the shortcut, filters, Enter selects a generator, focus returns', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: /Search generators/ });
  await search.focus();
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  const combo = page.getByRole('combobox', { name: /Search generators and commands/ });
  await expect(combo).toBeFocused();
  await expect(combo).toHaveAttribute('aria-expanded', 'true');

  await combo.fill('clsd bx');
  const options = dialog.getByRole('option');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  const first = (await options.first().locator('.app-pal__title').textContent())!;
  expect(first).toBe('Closed box');
  const activeId = await combo.getAttribute('aria-activedescendant');
  expect(await options.first().getAttribute('id')).toBe(activeId);

  // Focus is trapped: Tab never leaves the dialog.
  await page.keyboard.press('Tab');
  await expect(combo).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(first);
  await expect(search).toBeFocused();
});

test('palette: arrows move, Escape closes and returns focus, actions run', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'mm', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+k');
  const combo = page.getByRole('combobox', { name: /Search generators and commands/ });
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await combo.fill('units'); // fuzzy: generators such as Universal box may also match, ranked lower
  await expect(dialog.getByRole('option').first().locator('.app-pal__title')).toHaveText('Show inches');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('radio', { name: 'mm', exact: true })).toBeFocused();

  await page.keyboard.press('ControlOrMeta+k');
  await combo.fill('inches');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: 'in', exact: true })).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(dialog.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await combo.fill('zzzzqq');
  await expect(dialog.getByText(/Nothing matches/)).toBeVisible();
  await expect(combo).toHaveAttribute('aria-expanded', 'false');
  await combo.fill('box');
  await expect(combo).toHaveAttribute('aria-expanded', 'true');
});

test('palette: a held (repeating) shortcut does not toggle; IME Enter does not run', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const fire = (repeat: boolean): Promise<void> => page.evaluate((r) => {
    dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, repeat: r, bubbles: true, cancelable: true }));
  }, repeat);
  await fire(false);
  await expect(dialog).toBeVisible();
  await fire(true);
  await expect(dialog).toBeVisible();
  const combo = page.getByRole('combobox', { name: /Search generators and commands/ });
  await combo.fill('inches');
  await page.evaluate(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    // Safari ends a composition with keyCode 229 and isComposing false.
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
  });
  await expect(dialog).toBeVisible();
  // The theme pre-paint script keeps its variable to itself.
  expect(await page.evaluate(() => 't' in window)).toBe(false);
  await expect(page.getByRole('radio', { name: 'mm', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('palette: export action downloads', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: /Search generators and commands/ }).fill('export svg');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(dl.suggestedFilename()).toMatch(/\.svg$/);
});

test('keyboard only: gallery -> settings form -> export', async ({ page }) => {
  await page.goto('/');
  await tabTo(page, '.app-search__input');
  await page.keyboard.type('closed');
  await tabTo(page, '.app-gen');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Closed box');

  await tabTo(page, 'input[type="range"][aria-label="Width"], input[type="range"][id*="x"]');
  const before = Number(await page.evaluate(() => (document.activeElement as HTMLInputElement).value));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain(`x=${before + 2}`);

  await tabTo(page, '.app-export > .bx-btn');
  await page.keyboard.press('Enter');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(dl.suggestedFilename()).toMatch(/closedbox.*\.svg$/);
});

test('laser speed setting changes the estimate and persists', async ({ page }) => {
  await page.goto('/');
  const time = page.locator('.app-tb__time .app-tb__v');
  const speed = page.getByRole('spinbutton', { name: /Laser cutting speed/ });
  await speed.fill('1');
  await speed.press('Tab');
  await expect(time).toContainText(/h|min/);
  const slow = await time.textContent();
  await speed.fill('500');
  await speed.press('Tab');
  await expect(time).not.toHaveText(slow!);
  await page.reload();
  await expect(speed).toHaveValue('500');
});

for (const theme of ['light', 'dark'] as const) {
  test(`open palette has zero axe violations — ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('kerflab:theme', t), theme);
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    await page.screenshot({ path: `test-results/palette-${theme}.png` });
  });
}
