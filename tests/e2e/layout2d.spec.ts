import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { defaults } from '../../src/core/schema';
import { getGenerator } from '../../src/generators';
import { runBuild } from '../../src/app/build';
import { orientedSize } from '../../src/app/export/layout';
import { formatLength } from '../../src/app/units';

const HASH = '#v1/closedbox/x=160;y=110;h=70';

async function open(page: Page, hash = HASH, theme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.addInitScript((t) => {
    localStorage.setItem('kerflab:theme', t);
    localStorage.setItem('kerflab:tab', 'sheet');
  }, theme);
  await page.goto(`/${hash}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.l2d-part').first()).toBeVisible();
}

/** Ground truth from the build pipeline (not the DOM). */
function expected(params: Record<string, number>): { name: string; id: string; w: number; h: number }[] {
  const g = getGenerator('closedbox')!;
  const r = runBuild(g, { ...defaults(g.schema), ...params }, { w: 600, h: 400 });
  if (!r.ok) throw new Error(r.message);
  return r.layout.placed.map((p) => ({ name: p.part.name, id: p.part.id, ...orientedSize(p.part, p.rot) }));
}

test('one labelled shape per part, named with its size', async ({ page }) => {
  await open(page);
  const exp = expected({ x: 160, y: 110, h: 70 });
  await expect(page.locator('.l2d-part')).toHaveCount(exp.length);
  for (const e of exp) {
    const label = `${e.name}, ${formatLength(e.w, 'mm')} × ${formatLength(e.h, 'mm')}`;
    await expect(page.getByRole('button', { name: label })).toHaveCount(1);
  }
  await expect(page.locator('.l2d-label').first()).toBeVisible();
});

test('selecting a part shows callouts equal to its bounds and syncs the store', async ({ page }) => {
  await open(page);
  const exp = expected({ x: 160, y: 110, h: 70 })[0]!;
  const el = page.locator('.l2d-part').first();
  const name = await el.getAttribute('aria-label');
  expect(name).toContain(exp.name);
  await el.click();
  await expect(el).toHaveAttribute('aria-pressed', 'true');
  const dims = page.locator('.l2d-dim--part text');
  await expect(dims).toHaveText([formatLength(exp.w, 'mm'), formatLength(exp.h, 'mm')]);
  // Units follow the toggle.
  await page.getByRole('radio', { name: 'in', exact: true }).click();
  await expect(dims).toHaveText([formatLength(exp.w, 'in'), formatLength(exp.h, 'in')]);
  // (Selection sync with the 3D view, both ways, is covered in viewer.spec.ts.)
  // Background click clears.
  await page.locator('.l2d-svg').click({ position: { x: 6, y: 6 } });
  await expect(page.locator('.l2d-part.is-selected')).toHaveCount(0);
  await expect(page.locator('.l2d-dim--part')).toHaveCount(0);
});

test('keyboard: tab into parts, arrows move, Enter selects, Escape clears', async ({ page }) => {
  await open(page);
  const parts = page.locator('.l2d-part');
  // Exactly one tab stop among the parts.
  await expect(page.locator('.l2d-part[tabindex="0"]')).toHaveCount(1);
  await page.locator('.l2d-part[tabindex="0"]').focus();
  const first = await page.evaluate(() => document.activeElement?.getAttribute('data-part'));
  await page.keyboard.press('ArrowRight');
  const second = await page.evaluate(() => document.activeElement?.getAttribute('data-part'));
  expect(second).not.toBe(first);
  await page.keyboard.press('Enter');
  await expect(parts.and(page.locator('[data-part="' + second + '"]'))).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.l2d-dim--part')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.l2d-part.is-selected')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-part'))).toBe(first);
});

test('zoom, pan, fit and clamp', async ({ page }) => {
  await open(page);
  const world = page.locator('.l2d-world');
  const tf = () => world.getAttribute('transform');
  const k = async () => Number(/scale\(([\d.e-]+)\)/.exec((await tf())!)![1]);
  const k0 = await k();
  const svg = page.locator('.l2d-svg');
  const box = (await svg.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -300);
  await expect.poll(k).toBeGreaterThan(k0 * 1.2);
  // Drag pans without selecting.
  const before = await tf();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 70, { steps: 5 });
  await page.mouse.up();
  await expect.poll(tf).not.toBe(before);
  await expect(page.locator('.l2d-part.is-selected')).toHaveCount(0);
  // Keys.
  await page.getByRole('button', { name: 'Zoom in' }).focus();
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  // Clamp: zooming far out stops at the floor.
  for (let i = 0; i < 40; i++) await page.keyboard.press('-');
  const floor = await k();
  await page.keyboard.press('-');
  expect(await k()).toBeCloseTo(floor, 6);
  expect(floor).toBeGreaterThan(0);
  // Double-click fits.
  await svg.dblclick({ position: { x: 6, y: 6 } });
  await expect.poll(k).toBeCloseTo(k0, 4);
});

test('oversize part shows a visible does-not-fit warning', async ({ page }) => {
  await open(page, '#v1/closedbox/x=160;y=110;h=70;_sheet=140x90');
  const warn = page.locator('.l2d-unfit');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('Does not fit on sheet');
  await expect(warn.getByRole('button').first()).toBeVisible();
  await warn.getByRole('button').first().click();
  await expect(warn.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
});

test('several sheets get a switcher', async ({ page }) => {
  await open(page, '#v1/closedbox/x=160;y=110;h=70;_sheet=200x180');
  const pick = page.getByRole('group', { name: 'Sheet', exact: true });
  await expect(pick).toBeVisible();
  const count = await pick.getByRole('button').count();
  expect(count).toBeGreaterThan(1);
  const onFirst = await page.locator('.l2d-part').count();
  await pick.getByRole('button').nth(1).click();
  await expect(page.locator('.l2d-svg')).toHaveAttribute('aria-label', /sheet 2 of/);
  expect(await page.locator('.l2d-part').count()).toBeGreaterThan(0);
  expect(onFirst).toBeGreaterThan(0);
});

test('selecting never rebuilds the sheet geometry', async ({ page }) => {
  await open(page);
  await page.getByRole('radio', { name: 'in', exact: true }).click(); // geometry rebuild is allowed here
  const marker = await page.evaluate(() => {
    const el = document.querySelector('.l2d-world')!;
    (el as unknown as { __m: number }).__m = 1;
    return true;
  });
  expect(marker).toBe(true);
  await page.locator('.l2d-part').first().click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (document.querySelector('.l2d-world') as unknown as { __m?: number }).__m)).toBe(1); // selection never replaces the world
});

for (const theme of ['light', 'dark'] as const) {
  test(`sheet tab has zero axe violations — ${theme}`, async ({ page }) => {
    await open(page, HASH, theme);
    await page.locator('.l2d-part').first().click(); // selected state with callouts
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

test('axe: warning state and multi-sheet', async ({ page }) => {
  await open(page, '#v1/closedbox/x=160;y=110;h=70;_sheet=140x90');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`sheet screenshots — ${theme}`, async ({ page }) => {
    await open(page, HASH, theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `artifacts/shots/sheet-${theme}.png` });
    await page.locator('.l2d-part').nth(2).click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `artifacts/shots/sheet-selected-${theme}.png` });
  });
}

test('sheet screenshot — does not fit', async ({ page }) => {
  await open(page, '#v1/closedbox/x=160;y=110;h=70;_sheet=140x90');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/shots/sheet-unfit-light.png' });
});

const scale = async (page: Page): Promise<number> =>
  Number(/scale\(([\d.e-]+)\)/.exec((await page.locator('.l2d-world').getAttribute('transform'))!)![1]);

test('Enter on the zoom and fit buttons activates them (keys are not swallowed)', async ({ page }) => {
  await open(page);
  const k0 = await scale(page);
  await page.getByRole('button', { name: 'Zoom in' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => scale(page)).toBeGreaterThan(k0 * 1.1);
  await page.getByRole('button', { name: 'Fit sheet to view' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => scale(page)).toBeCloseTo(k0, 4);
});

test('switching sheets does not reset zoom on the next render', async ({ page }) => {
  await open(page, '#v1/closedbox/x=160;y=110;h=70;_sheet=200x180');
  await page.getByRole('group', { name: 'Sheet', exact: true }).getByRole('button').nth(1).click();
  const k1 = await scale(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => scale(page)).toBeGreaterThan(k1 * 1.1);
  const k = await scale(page);
  await page.getByRole('radio', { name: 'in', exact: true }).click(); // re-renders the view
  await expect(page.locator('.l2d-svg')).toHaveAttribute('aria-label', /sheet 2 of/);
  expect(await scale(page)).toBeCloseTo(k, 6);
});

test('a release outside the SVG leaves no stale pointer or drag state', async ({ page }) => {
  await open(page);
  const box = (await page.locator('.l2d-svg').boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 3 });
  await page.mouse.move(40, 300, { steps: 3 }); // over the settings column
  await page.mouse.up();
  await expect(page.locator('.l2d-view')).not.toHaveClass(/is-dragging/);
  // A plain click still selects (a stale pointer would make this look like a pinch).
  await page.getByRole('button', { name: 'Fit sheet to view' }).click();
  await page.locator('.l2d-part').first().click();
  await expect(page.locator('.l2d-part.is-selected')).toHaveCount(1);
  // Window blur mid-drag also ends it.
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 50, { steps: 3 });
  await expect(page.locator('.l2d-view')).toHaveClass(/is-dragging/);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.l2d-view')).not.toHaveClass(/is-dragging/);
  await page.mouse.up();
});

test('the 2D view draws parts with its own screen strokes, not the export hairline', async ({ page }) => {
  await open(page);
  const w = await page.locator('.l2d-part path').first().evaluate((el) => getComputedStyle(el).strokeWidth);
  expect(w).toBe('1.15px');
});
