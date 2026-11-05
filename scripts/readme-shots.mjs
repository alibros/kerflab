/* global process, console, URL, localStorage, document */
/* Captures the README screenshots from a running dev server: node scripts/readme-shots.mjs [baseUrl] */
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = new URL('../docs/images/', import.meta.url).pathname;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function shot(name, { hash = '', theme = 'light', tab = '3d', w = 1440, h = 900, clip, after } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.addInitScript(([t, tb]) => {
    localStorage.setItem('kerflab:theme', t);
    localStorage.setItem('kerflab:tab', tb);
  }, [theme, tab]);
  await page.goto(`${base}/?thumbs3d=any${hash}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3500);
  if (after) await after(page);
  if (clip === 'canvas') {
    // Only the rendered model: hide the overlay buttons and hint text that sit over the canvas.
    await page.evaluate(() => {
      const canvas = document.querySelector('#stage canvas.v3d-canvas');
      for (const el of document.querySelectorAll('#stage *')) {
        if (el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden';
      }
    });
  }
  const target = clip === 'canvas' ? page.locator('#stage canvas.v3d-canvas') : page;
  await target.screenshot({ path: `${out}${name}.jpg`, type: 'jpeg', quality: 86, animations: 'disabled' });
  await ctx.close();
  console.log('saved', name);
}

await shot('hero', { hash: '#v1/chest' });
await shot('picker', { theme: 'light' });
await shot('sheet-dark', { hash: '#v1/typetray', theme: 'dark', tab: 'sheet' });
const gens = {
  chest: 'chest', gears: 'gears/teeth2=34', gridfinity: 'gridfinity', enclosure: 'enclosure',
  planetary: 'planetary', storageshelf: 'storageshelf', wallholder: 'wallholder', typetray: 'typetray',
};
for (const [name, hash] of Object.entries(gens)) {
  await shot(`gen-${name}`, { hash: `#v1/${hash}`, clip: 'canvas', w: 1200, h: 900 });
}
await browser.close();
