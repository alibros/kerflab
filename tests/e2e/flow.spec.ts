import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
});

test('pick a generator, change a slider, URL updates, reload restores', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Closed box/ }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Closed box');

  const width = page.getByRole('slider', { name: 'Width', exact: true });
  await width.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('105');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('x=105');

  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('105');
  await expect(page.getByRole('slider', { name: 'Width', exact: true })).toHaveValue('105');
});

test('undo/redo via keyboard restores a whole slider drag', async ({ page }) => {
  await page.goto('/');
  const width = page.getByRole('slider', { name: 'Width', exact: true });
  await width.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('104');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('100');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('104');

  // A pointer drag across the rule is one undo step, however many values it passes through.
  const box = (await width.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 2; i <= 12; i++) await page.mouse.move(box.x + box.width * (i / 30), box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).not.toHaveValue('104');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('104');
});

test('a bad link loads defaults and explains why', async ({ page }) => {
  await page.goto('/#v0/closedbox/x=12');
  await expect(page.getByRole('status')).toContainText(/version/i);
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('100');
});

test('infeasible params show an inline error at the field, never a blank stage', async ({ page }) => {
  await page.goto('/#v1/closedbox/x=10;thickness=5');
  await expect(page.locator('.bx-field', { has: page.getByRole('spinbutton', { name: 'Width', exact: true }) })).toContainText(/too small/);
  await expect(page.getByTestId('stage-error')).toBeVisible();
});

test('unit toggle shows inches without changing the design', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'in', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('3.937');
  await page.getByRole('radio', { name: 'mm', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('100');
});

test('a link without units keeps the viewer\'s inch display', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'in', exact: true }).click();
  await page.evaluate(() => { location.hash = '#v1/closedbox/x=127'; });
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('5');
  await expect(page.getByRole('radio', { name: 'in', exact: true })).toBeChecked();
  await page.evaluate(() => { location.hash = '#v1/closedbox/x=120;_u=mm'; });
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('120');
});

test('inch sliders step onto round inch values', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'in', exact: true }).click();
  const width = page.getByRole('slider', { name: 'Width', exact: true });
  const min = Number(await width.getAttribute('min'));
  const step = Number(await width.getAttribute('step'));
  expect(Math.abs(min / step - Math.round(min / step))).toBeLessThan(1e-6);
  await width.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('3.939');
});

test('gallery search filters and shows an empty state', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: /Search generators/ });
  await search.fill('zzzz');
  await expect(page.getByText(/No generator matches/)).toBeVisible();
  await search.fill('box');
  await expect(page.getByRole('button', { name: /Closed box/ }).first()).toBeVisible();
});

test('category bar filters the picker, search spans all categories, and the choice is remembered', async ({ page }) => {
  await page.goto('/');
  const bar = page.getByRole('toolbar', { name: 'Categories' });
  const tiles = page.locator('#gallery-list .app-gen:visible');
  // Defaults to the selected generator's category.
  await expect(bar.getByRole('button', { name: /^Boxes/ })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: /^Flex/ }).click();
  await expect(bar.getByRole('button', { name: /^Flex/ })).toHaveAttribute('aria-pressed', 'true');
  const n = await tiles.count();
  expect(n).toBeGreaterThan(1);
  await expect(bar.getByRole('button', { name: /^Flex/ })).toContainText(String(n).padStart(2, '0'));
  await expect(page.getByRole('button', { name: /Closed box/ })).toBeHidden();

  // Arrow keys move along the bar (one tab stop).
  await bar.getByRole('button', { name: /^Flex/ }).focus();
  await page.keyboard.press('Home');
  await expect(bar.getByRole('button', { name: /^All/ })).toBeFocused();

  // Searching looks across every category, then returns to the chosen one.
  const search = page.getByRole('searchbox', { name: /Search generators/ });
  await search.fill('closed');
  await expect(bar.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Closed box/ })).toBeVisible();
  await search.fill('');
  await expect(bar.getByRole('button', { name: /^Flex/ })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.getByRole('button', { name: 'Change generator' }).click();
  await expect(page.getByRole('toolbar', { name: 'Categories' }).getByRole('button', { name: /^Flex/ })).toHaveAttribute('aria-pressed', 'true');
});

test('picking a generator collapses the picker to a current-generator card', async ({ page }) => {
  await page.goto('/');
  const change = page.getByRole('button', { name: /Change generator|Done choosing/ });
  await expect(change).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('toolbar', { name: 'Categories' }).getByRole('button', { name: /^All/ }).click();
  await page.locator('.app-gen', { hasText: 'Divider tray' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Divider tray');
  await expect(change).toHaveAttribute('aria-expanded', 'false');
  await expect(change).toBeFocused();
  await expect(page.locator('.app-current')).toContainText('Divider tray');
  await expect(page.getByRole('searchbox', { name: /Search generators/ })).toBeHidden();
  await change.click();
  await expect(page.getByRole('searchbox', { name: /Search generators/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(change).toHaveAttribute('aria-expanded', 'false');
});

test('a stock profile sets thickness and kerf in one undoable step', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bx-panel__trigger', { hasText: 'Material' }).click();
  const stock = page.getByRole('combobox', { name: 'Stock' });
  await expect(stock.locator('option:checked')).toHaveText(/Custom/);
  await stock.selectOption('mdf6');
  await expect(page.getByRole('spinbutton', { name: 'Thickness', exact: true })).toHaveValue('6');
  await expect(page.getByRole('spinbutton', { name: 'Kerf', exact: true })).toHaveValue('0.2');
  await expect(page.locator('.app-tb')).toContainText('MDF 6 mm');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kerflab:material3d'))).toBe('mdf');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('thickness=6');

  // Editing a value by hand reads as Custom again.
  const kerf = page.getByRole('spinbutton', { name: 'Kerf', exact: true });
  await kerf.fill('0.15');
  await kerf.press('Tab');
  await expect(stock.locator('option:checked')).toHaveText(/Custom/);

  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(stock).toHaveValue('mdf6');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('spinbutton', { name: 'Thickness', exact: true })).toHaveValue('3');
  await expect(page.getByRole('spinbutton', { name: 'Kerf', exact: true })).toHaveValue('0.1');
});

test('sheet picker offers laser beds, stock sheets and a custom size', async ({ page }) => {
  await page.goto('/');
  const sheet = page.getByRole('combobox', { name: 'Sheet size' });
  await expect(sheet.locator('optgroup[label="Laser beds"] option')).not.toHaveCount(0);
  await expect(sheet.locator('optgroup[label="Stock sheets"] option')).not.toHaveCount(0);
  await sheet.selectOption('k40');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('_sheet=300x200');
  await sheet.selectOption('custom');
  const w = page.getByRole('spinbutton', { name: 'Custom sheet width' });
  await expect(w).toBeFocused();
  await w.fill('450');
  await page.getByRole('spinbutton', { name: 'Custom sheet height' }).fill('320');
  await page.getByRole('spinbutton', { name: 'Custom sheet height' }).press('Enter');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('_sheet=450x320');
  await page.reload();
  await expect(sheet).toHaveValue('custom');
  await expect(w).toHaveValue('450');
  await expect(page.getByRole('spinbutton', { name: 'Custom sheet height' })).toHaveValue('320');
});

test('export downloads an SVG of the current layout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Export/ }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /SVG/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/closedbox.*\.svg$/);
});

for (const theme of ['light', 'dark'] as const) {
  test(`app shell has zero axe violations — ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('kerflab:theme', t), theme);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`collapsed picker, stock picker and custom sheet have zero axe violations — ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('kerflab:theme', t), theme);
    await page.goto('/#v1/closedbox/thickness=3;kerf=0.2;_sheet=450x320');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Change generator' })).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.bx-panel__trigger', { hasText: 'Material' }).click();
    await expect(page.getByRole('combobox', { name: 'Stock' })).toHaveValue('ply3');
    await expect(page.getByRole('spinbutton', { name: 'Custom sheet width' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

test('text field: error is linked to the input and clears on undo or reset', async ({ page }) => {
  await page.goto('/#v1/cardbox/');
  const sx = page.getByRole('textbox', { name: /Compartment widths/ });
  await sx.fill('65,,x');
  await expect(sx).toHaveAttribute('aria-invalid', 'true');
  const errId = (await sx.getAttribute('aria-describedby'))!;
  await expect(page.locator(`[id="${errId}"]`)).toContainText('Use the format');
  // A valid edit, then undo back to the stored value: the stale format error must go.
  await sx.fill('60,60');
  await sx.fill('60,6x');
  await expect(sx).toHaveAttribute('aria-invalid', 'true');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(sx).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator(`[id="${errId}"]`)).toHaveText('');
  // Reset clears it too.
  await sx.fill('50,50');
  await sx.fill('1,,');
  await expect(sx).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: /Reset Compartment widths/ }).click();
  await expect(sx).toHaveValue('65,65,65,65');
  await expect(sx).not.toHaveAttribute('aria-invalid', 'true');
});
