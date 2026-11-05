import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * 3D viewer. WebGL runs on SwiftShader (see playwright.config.ts), which is slow: waits key off the
 * viewer's own "not animating" hook rather than fixed timeouts, and rendering is verified by
 * reading pixels back (not by trusting a screenshot).
 */
const HASH = '#v1/closedbox/x=160;y=110;h=70';

type Hook = {
  frames(): number;
  builds(): number;
  isAnimating(): boolean;
  explode(): number;
  screenPoint(id: string): { x: number; y: number } | null;
  partAt(x: number, y: number): string | null;
  sample(): { distinct: number; coverage: number };
};

async function open(page: Page, opts: { theme?: 'light' | 'dark'; tab?: '3d' | 'sheet'; search?: string; hash?: string } = {}): Promise<void> {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.addInitScript(
    ([t, tab]) => {
      localStorage.setItem('kerflab:theme', t!);
      localStorage.setItem('kerflab:tab', tab!);
      localStorage.removeItem('kerflab:material3d');
    },
    [opts.theme ?? 'light', opts.tab ?? '3d'],
  );
  await page.goto(`/${opts.search ?? ''}${opts.hash ?? HASH}`);
  await page.evaluate(() => document.fonts.ready);
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const v = (document.querySelector('[data-testid=viewer3d]') as unknown as { __v3d?: Hook })?.__v3d;
      return !!v && v.frames() > 0 && !v.isAnimating();
    },
    null,
    { timeout: 30_000 },
  );
}

const hook = <T>(page: Page, fn: (v: Hook) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(document.querySelector('[data-testid=viewer3d]').__v3d)`) as Promise<T>;

test('renders the assembly with real pixels (not a blank canvas)', async ({ page }) => {
  await open(page);
  await settled(page);
  const s = await hook(page, (v) => v.sample());
  expect(s.distinct).toBeGreaterThan(40); // wood, grain, outlines, shadow, grid
  expect(s.coverage).toBeGreaterThan(0.05);
  await expect(page.locator('canvas.v3d-canvas')).toHaveAttribute('aria-label', /3D assembly, 6 parts/);
});

test('generator view hints: a turned home view shows the hooks; ghost plates let clicks through to the gears', async ({ page }) => {
  // KeyHolder's hooks point +y, away from the default camera: its view turns 180 degrees.
  await open(page, { hash: '#v1/keyholder' });
  await settled(page);
  expect(await hook4(page)).toBe('hook4');
  // GearBox: the top plate and the stage frames are see-through; the top plate's centre picks a part below it.
  await page.goto('/#v1/gearbox');
  await settled(page);
  const below = await hook(page, (v) => {
    const p = v.screenPoint('top');
    return p ? v.partAt(p.x, p.y) : 'offscreen';
  });
  expect(below).not.toBe('top');
  expect(below).not.toBeNull();
  expect(below).not.toMatch(/^frame/);
});

async function hook4(page: Page): Promise<string | null> {
  return hook(page, (v) => {
    const p = v.screenPoint('hook4');
    return p ? v.partAt(p.x, p.y) : null;
  });
}

test('editing a size rebuilds only the parts whose geometry changed', async ({ page }) => {
  await open(page);
  await settled(page);
  expect(await hook(page, (v) => v.builds())).toBe(6);
  // Height reshapes the four walls and lifts the top (geometry is baked in world space); the
  // bottom is untouched and keeps its geometry.
  const height = page.locator('input[type=number][name=h]');
  await height.fill('90');
  await height.press('Enter');
  await expect.poll(() => hook(page, (v) => v.builds())).toBe(11);
});

test('clicking a part in 3D selects it in the Sheet view', async ({ page }) => {
  await open(page);
  await settled(page);
  const pt = await hook(page, (v) => v.screenPoint('front'));
  expect(pt).not.toBeNull();
  expect(await page.evaluate(([x, y]) => (document.querySelector('[data-testid=viewer3d]') as unknown as { __v3d: Hook }).__v3d.partAt(x!, y!), [pt!.x, pt!.y])).toBe('front');
  await page.mouse.click(pt!.x, pt!.y);
  await expect(page.locator('.v3d-chip')).toContainText('Front wall');
  await expect(page.getByLabel('Selected part')).toHaveValue('front');
  await page.getByRole('tab', { name: /Sheet/ }).click();
  await expect(page.locator('.l2d-part.is-selected')).toHaveCount(1);
  await expect(page.locator('.l2d-part.is-selected')).toHaveAttribute('data-part', 'front');
  // Clicking empty space in 3D clears the selection everywhere.
  await page.getByRole('tab', { name: '3D' }).click();
  await settled(page);
  const box = (await page.locator('.v3d-view').boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + 40);
  await expect(page.locator('.v3d-chip')).toBeHidden();
  await page.getByRole('tab', { name: /Sheet/ }).click();
  await expect(page.locator('.l2d-part.is-selected')).toHaveCount(0);
});

test('selecting in the Sheet view highlights and frames the part in 3D', async ({ page }) => {
  await open(page, { tab: 'sheet' });
  await page.locator('.l2d-part[data-part="right"]').click();
  await page.getByRole('tab', { name: '3D' }).click();
  await settled(page);
  await expect(page.getByLabel('Selected part')).toHaveValue('right');
  await expect(page.locator('.v3d-chip')).toContainText('Right wall');
  // Framed: the part's centre sits near the middle of the view.
  const pt = (await hook(page, (v) => v.screenPoint('right')))!;
  const box = (await page.locator('.v3d-view').boundingBox())!;
  expect(Math.abs(pt.x - (box.x + box.width / 2))).toBeLessThan(box.width * 0.1);
  expect(Math.abs(pt.y - (box.y + box.height / 2))).toBeLessThan(box.height * 0.1);
});

test('explode slider eases the parts apart; materials and section toggle', async ({ page }) => {
  await open(page);
  await settled(page);
  await page.getByLabel('Explode').fill('60');
  await expect(page.locator('.v3d-out')).toHaveText('60 %');
  await settled(page);
  expect(await hook(page, (v) => v.explode())).toBeCloseTo(0.6, 3);
  const walnut = page.getByRole('radio', { name: 'Walnut ply' });
  await walnut.click();
  await expect(walnut).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Birch plywood' })).toHaveAttribute('aria-checked', 'false');
  const section = page.getByRole('button', { name: 'Section cut' });
  await section.click();
  await expect(section).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('canvas.v3d-canvas')).toHaveAttribute('aria-label', /section view/);
  await settled(page);
  expect((await hook(page, (v) => v.sample())).distinct).toBeGreaterThan(40);
});

test('a stock profile switches the 3D look, but keeps a manual choice that already fits', async ({ page }) => {
  await open(page);
  await settled(page);
  await page.locator('.bx-panel__trigger', { hasText: 'Material' }).click();
  const stock = page.getByRole('combobox', { name: 'Stock' });
  await stock.selectOption('acrylic3');
  await expect(page.getByRole('radio', { name: 'Clear acrylic' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Walnut ply' }).click();
  await stock.selectOption('ply6');
  await expect(page.getByRole('radio', { name: 'Walnut ply' })).toHaveAttribute('aria-checked', 'true');
  await stock.selectOption('mdf3');
  await expect(page.getByRole('radio', { name: 'MDF' })).toHaveAttribute('aria-checked', 'true');
});

test('picker tiles get 3D raster thumbnails, cached for the next visit; no WebGL keeps the drawings', async ({ page }) => {
  test.setTimeout(120_000); // SwiftShader compiles the thumbnail shaders on the CPU
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const k of Object.keys(localStorage)) if (k.startsWith('kerflab:')) localStorage.removeItem(k);
    localStorage.setItem('kerflab:tab', 'sheet');
  });
  // SwiftShader is a software GPU, which the app skips for thumbnails unless asked.
  await page.goto('/?thumbs3d=any');
  const tiles = page.locator('#gallery-list .app-gen:visible .app-thumb');
  const n = await tiles.count();
  expect(n).toBeGreaterThan(1);
  // Every visible tile and the current-generator card swap their cut-sheet drawing for a render.
  await expect(page.locator('#gallery-list .app-gen:visible .app-thumb[data-thumb="3d"] img')).toHaveCount(n, { timeout: 60_000 });
  await expect(page.locator('.app-current .app-thumb[data-thumb="3d"] img')).toHaveCount(1);
  const img = tiles.first().locator('img');
  expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  // The render is not blank: it has opaque pixels and some variety.
  const stats = await img.evaluate((el: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(el, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    const colours = new Set<number>();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! > 200) {
        opaque++;
        colours.add((d[i]! >> 4) * 256 + (d[i + 1]! >> 4) * 16 + (d[i + 2]! >> 4));
      }
    }
    return { opaque: opaque / (d.length / 4), colours: colours.size };
  });
  expect(stats.opaque).toBeGreaterThan(0.05);
  expect(stats.colours).toBeGreaterThan(8);

  // Reload: straight from the cache, before any renderer is loaded.
  await page.goto('/?thumbs3d=any');
  await expect(page.locator('#gallery-list .app-gen:visible .app-thumb[data-thumb="3d"]')).toHaveCount(n);
  expect(await page.evaluate(() => performance.getEntriesByName('thumbs3d:load').length)).toBe(0);

  // Without WebGL (and with an empty cache) the cut-sheet drawings stay.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('kerflab:thumb3d:')) localStorage.removeItem(k);
  });
  await page.goto('/?nowebgl&thumbs3d=any');
  await page.waitForTimeout(500);
  await expect(page.locator('#gallery-list .app-gen:visible .app-thumb[data-thumb="svg"] svg')).toHaveCount(n);

  // A software-only GPU (no opt-in) keeps the drawings too, and never stalls the page compiling.
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName('thumbs3d:load').length)).toBe(0);
  await page.waitForTimeout(1500);
  await expect(page.locator('#gallery-list .app-gen:visible .app-thumb[data-thumb="svg"] svg')).toHaveCount(n);
});

test('saves a PNG of the view', async ({ page }) => {
  await open(page);
  await settled(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save PNG image' }).click()]);
  expect(dl.suggestedFilename()).toBe('boxes-closedbox-3d.png');
});

test('without WebGL the 3D tab explains itself; Sheet and export still work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, { search: '?nowebgl' });
  const fb = page.getByTestId('webgl-fallback');
  await expect(fb).toBeVisible();
  await expect(fb).toContainText('needs WebGL');
  await expect(page.locator('canvas')).toHaveCount(0);
  await fb.getByRole('button', { name: 'Open the Sheet view' }).click();
  await expect(page.getByRole('tab', { name: /Sheet/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.l2d-part')).toHaveCount(6);
  await page.getByRole('button', { name: /^Export/ }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /SVG/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.svg$/);
  expect(errors).toEqual([]);
});

test('real WebGL failure (getContext returns null) falls back; Sheet and export still work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/.test(type)) return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    };
  });
  await open(page);
  const fb = page.getByTestId('webgl-fallback');
  await expect(fb).toBeVisible();
  await expect(fb).toContainText('WebGL turned off or unavailable');
  await expect(page.locator('canvas.v3d-canvas')).toHaveCount(0);
  await page.getByRole('tab', { name: /Sheet/ }).click();
  await expect(page.locator('.l2d-part')).toHaveCount(6);
  await page.getByRole('button', { name: /^Export/ }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /SVG/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.svg$/);
  expect(errors).toEqual([]);
});

test('a failure after the renderer exists releases the GL context and falls back', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __gls: WebGLRenderingContext[] };
    w.__gls = [];
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (/webgl/.test(type) && ctx) w.__gls.push(ctx as WebGLRenderingContext);
      return ctx;
    };
    // Make the viewer's own ResizeObserver fail, late in construction.
    const observe = ResizeObserver.prototype.observe;
    ResizeObserver.prototype.observe = function (this: ResizeObserver, target: Element, o?: ResizeObserverOptions) {
      if (target.classList?.contains('v3d-view')) throw new Error('injected failure');
      return observe.call(this, target, o);
    };
  });
  await open(page);
  const fb = page.getByTestId('webgl-fallback');
  await expect(fb).toBeVisible();
  await expect(fb).toContainText('injected failure');
  await expect(page.locator('canvas.v3d-canvas')).toHaveCount(0);
  const lost = await page.evaluate(() => (window as unknown as { __gls: WebGLRenderingContext[] }).__gls.map((g) => g.isContextLost()));
  expect(lost.length).toBeGreaterThan(0);
  expect(lost.every(Boolean)).toBe(true);
  // Theme changes after the failure must not reach a half-built viewer (no errors thrown).
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('radio', { name: 'Blueprint' }).click();
  await page.getByRole('tab', { name: /Sheet/ }).click();
  await expect(page.locator('.l2d-part')).toHaveCount(6);
  expect(errors).toEqual([]);
});

test('deselecting inside the viewer keeps the camera; double-click focuses a part', async ({ page }) => {
  await open(page);
  await settled(page);
  const pt = (await hook(page, (v) => v.screenPoint('front')))!;
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('.v3d-chip')).toContainText('Front wall');
  await settled(page);
  const after = (await hook(page, (v) => v.screenPoint('front')))!;
  expect(Math.hypot(after.x - pt.x, after.y - pt.y)).toBeLessThan(1); // a plain click does not move the camera
  const box = (await page.locator('.v3d-view').boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + 40);
  await expect(page.locator('.v3d-chip')).toBeHidden();
  await settled(page);
  const still = (await hook(page, (v) => v.screenPoint('front')))!;
  expect(Math.hypot(still.x - pt.x, still.y - pt.y)).toBeLessThan(1);
  // Double-click is the explicit focus action: the part ends up centred.
  const r = (await hook(page, (v) => v.screenPoint('right')))!;
  await page.mouse.dblclick(r.x, r.y);
  await expect(page.locator('.v3d-chip')).toContainText('Right wall');
  await settled(page);
  const c = (await hook(page, (v) => v.screenPoint('right')))!;
  expect(Math.abs(c.x - (box.x + box.width / 2))).toBeLessThan(box.width * 0.1);
  expect(Math.abs(c.y - (box.y + box.height / 2))).toBeLessThan(box.height * 0.1);
});

for (const theme of ['light', 'dark'] as const) {
  test(`3D tab has zero axe violations — ${theme}`, async ({ page }) => {
    await open(page, { theme });
    await settled(page);
    await page.getByLabel('Selected part').selectOption('top');
    await settled(page);
    const results = await new AxeBuilder({ page })
      .include('#stage')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

test('3D fallback has zero axe violations', async ({ page }) => {
  await open(page, { search: '?nowebgl' });
  await expect(page.getByTestId('webgl-fallback')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('#stage').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

// Visual-review captures (not assertions): artifacts/shots/3d-*.png
for (const theme of ['light', 'dark'] as const) {
  test(`3D screenshots — ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { theme });
    await settled(page);
    const view = page.locator('.v3d-view');
    const pane = page.locator('#stage');
    await pane.screenshot({ path: `artifacts/shots/3d-${theme}-assembled.png` });
    await page.getByLabel('Explode').fill('60');
    await settled(page);
    await pane.screenshot({ path: `artifacts/shots/3d-${theme}-exploded.png` });
    await page.getByLabel('Selected part').selectOption('right');
    await settled(page);
    await view.screenshot({ path: `artifacts/shots/3d-${theme}-selected.png` });
    await page.getByLabel('Selected part').selectOption('');
    await page.getByLabel('Explode').fill('0');
    await page.getByRole('button', { name: 'Section cut' }).click();
    await settled(page);
    await view.screenshot({ path: `artifacts/shots/3d-${theme}-section.png` });
    await page.getByRole('button', { name: 'Section cut' }).click();
    for (const m of ['Walnut ply', 'Clear acrylic', 'MDF', 'Aluminium']) {
      await page.getByRole('radio', { name: m }).click();
      await settled(page);
      await view.screenshot({ path: `artifacts/shots/3d-${theme}-${m.split(' ').pop()!.toLowerCase()}.png` });
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`app screenshot — 3D tab, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { theme, tab: 'sheet' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('tab', { name: /3D/ }).click();
    await settled(page);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `artifacts/shots/app-3d-${theme}.png` });
  });
}

test('3D screenshot — close-up of the ply edges', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1360, height: 900 });
  await open(page);
  await settled(page);
  const box = (await page.locator('.v3d-view').boundingBox())!;
  const pt = (await hook(page, (v) => v.screenPoint('front')))!;
  // Zoom towards the front-right corner with the wheel.
  await page.mouse.move(pt.x + box.width * 0.18, pt.y - box.height * 0.12);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
  await page.mouse.move(box.x + 5, box.y + box.height + 30); // no hover highlight in the shot
  await settled(page);
  await page.locator('.v3d-view').screenshot({ path: 'artifacts/shots/3d-light-closeup.png' });
});
