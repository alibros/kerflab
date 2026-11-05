import { test } from '@playwright/test';

// Visual-review captures (not assertions): artifacts/shots/sandbox-{light,dark}.png
for (const theme of ['light', 'dark'] as const) {
  test(`sandbox screenshot — ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.addInitScript((t) => localStorage.setItem('kerflab:theme', t), theme);
    await page.goto('/sandbox.html');
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: 'About finger width' }).focus();
    await page.waitForTimeout(400); // let the tooltip finish its 160 ms reveal
    await page.screenshot({ path: `artifacts/shots/sandbox-${theme}.png`, fullPage: true });
  });
}

test('sandbox screenshot — phone, light', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('kerflab:theme', 'light'));
  await page.goto('/sandbox.html');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'artifacts/shots/sandbox-phone-light.png', fullPage: true });
});

// App shell captures: artifacts/shots/app-{desktop,tablet}-{light,dark}.png and app-phone-light.png
const APP_SIZES = { desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 } } as const;
for (const [size, viewport] of Object.entries(APP_SIZES)) {
  for (const theme of ['light', 'dark'] as const) {
    test(`app screenshot — ${size}, ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((t) => localStorage.setItem('kerflab:theme', t), theme);
      await page.goto('/#v1/closedbox/x=160;y=110;h=70');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `artifacts/shots/app-${size}-${theme}.png` });
    });
  }
}

test('app screenshot — phone, light', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('kerflab:theme', 'light'));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/shots/app-phone-light.png', fullPage: true });
});

test('app screenshot — error state and help note, light', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('kerflab:theme', 'light'));
  await page.goto('/#v1/closedbox/x=10;thickness=5');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'About Depth' }).focus();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/shots/app-error-light.png' });
});

// The 3D tab captures (app-3d-*.png, 3d-*.png) live in viewer.spec.ts: they need WebGL (SwiftShader).
