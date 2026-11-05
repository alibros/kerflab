import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/sandbox.html');
});

test('tabs: arrow keys move selection with roving tabindex', async ({ page }) => {
  const sheet = page.getByRole('tab', { name: /Sheet/ });
  await sheet.focus();
  await page.keyboard.press('ArrowRight');
  const view = page.getByRole('tab', { name: /3D view/ });
  await expect(view).toBeFocused();
  await expect(view).toHaveAttribute('aria-selected', 'true');
  await expect(sheet).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Cut list/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('6 parts');
});

test('panel: disclosure toggles aria-expanded and inert body', async ({ page }) => {
  const joints = page.getByRole('button', { name: /Joints/ });
  await expect(joints).toHaveAttribute('aria-expanded', 'false');
  await joints.focus();
  await page.keyboard.press('Enter');
  await expect(joints).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('region', { name: /Joints/ })).not.toHaveAttribute('inert', '');
});

test('field: validation, error state and per-field reset', async ({ page }) => {
  const width = page.getByRole('spinbutton', { name: 'Width' }).first();
  const reset = page.getByRole('button', { name: 'Reset Width to 120 mm' });
  await expect(reset).toBeVisible();
  await width.fill('5');
  await expect(width).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Minimum is 20 mm')).toBeVisible();
  await reset.click();
  await expect(width).toHaveValue('120');
  await expect(width).toHaveAttribute('aria-invalid', 'false');
  await expect(reset).toBeHidden();
});

test('slider: range and typed input stay in sync', async ({ page }) => {
  const range = page.getByRole('slider', { name: 'Depth' });
  const typed = page.getByRole('spinbutton', { name: 'Depth' });
  await range.focus();
  await page.keyboard.press('ArrowRight');
  await expect(typed).toHaveValue('61');
  await typed.fill('150');
  await expect(range).toHaveValue('150');
});

test('tooltip: focus shows, Escape hides', async ({ page }) => {
  const info = page.getByRole('button', { name: 'About finger width' });
  await info.focus();
  const tip = page.getByRole('tooltip').filter({ hasText: 'multiple of material thickness' });
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});

test('theme switch persists and flips color-scheme', async ({ page }) => {
  await page.getByRole('radio', { name: 'Blueprint' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(15, 20, 32)');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Blueprint' })).toHaveAttribute('aria-checked', 'true');
});

test('reduced motion zeroes the duration tokens', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dur = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dur-3').trim());
  expect(dur).toBe('0ms');
});

test('slider: aria-valuetext carries value + unit and set() clamps to bounds', async ({ page }) => {
  const range = page.getByRole('slider', { name: 'Depth' });
  await expect(range).toHaveAttribute('aria-valuetext', '60 mm');
  await range.focus();
  await page.keyboard.press('ArrowRight');
  await expect(range).toHaveAttribute('aria-valuetext', '61 mm');
  await page.getByRole('spinbutton', { name: 'Depth' }).fill('150');
  await expect(range).toHaveAttribute('aria-valuetext', '150 mm');

  const out = await page.evaluate(async () => {
    const p = '/src/app/ui/components/slider.ts';
    const { slider } = (await import(p)) as typeof import('../../src/app/ui/components/slider');
    const s = slider({ label: 'Probe', value: 5, min: 0, max: 10, unit: 'mm' });
    document.querySelector('main')!.append(s.el);
    s.set(99);
    const hi = [s.value, s.range.getAttribute('aria-valuetext')];
    s.set(-4);
    const lo = [s.value, s.input.value];
    s.set(Number.NaN);
    return { hi, lo, nan: s.value };
  });
  expect(out).toEqual({ hi: [10, '10 mm'], lo: [0, '0'], nan: 0 });
});

test('themeSwitch().destroy() unsubscribes; initTheme() is idempotent', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const p = '/src/app/ui/theme.ts';
    const theme = (await import(p)) as typeof import('../../src/app/ui/theme');
    const base = theme.themeListenerCount();
    const sw = theme.themeSwitch();
    const withSwitch = theme.themeListenerCount();
    sw.destroy();
    const after = theme.themeListenerCount();
    theme.setTheme('dark');
    localStorage.setItem('kerflab:theme', 'light'); // a re-run init would pick this up
    const again = theme.initTheme(); // already initialised: must not reset or re-subscribe
    return { grew: withSwitch - base, after: after - base, again, count: theme.themeListenerCount() - base };
  });
  expect(out).toEqual({ grew: 1, after: 0, again: 'dark', count: 0 });
});

test('tabs().destroy() stops indicator tracking', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const p = '/src/app/ui/components/tabs.ts';
    const { tabs } = (await import(p)) as typeof import('../../src/app/ui/components/tabs');
    const host = document.createElement('div');
    host.style.width = '600px';
    document.querySelector('main')!.append(host);
    const t = tabs({ label: 'Probe', tabs: [{ id: 'a', label: 'Alpha', content: 'A' }, { id: 'b', label: 'Beta', content: 'B' }], selected: 'b' });
    host.append(t.el);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const ind = t.el.querySelector<HTMLElement>('.bx-tabs__indicator')!;
    const live = ind.style.transform;
    t.destroy();
    (t.el.querySelector('[role="tab"]') as HTMLElement).style.paddingInline = '80px'; // would shift tab b
    host.style.width = '500px';
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return { live, afterDestroy: ind.style.transform };
  });
  expect(out.live).toMatch(/translateX\(\d+px\)/);
  expect(out.afterDestroy).toBe(out.live);
});
