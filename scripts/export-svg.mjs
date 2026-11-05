#!/usr/bin/env node
/**
 * Headless SVG export for scripts/compare-boxespy.py.
 *
 *   node scripts/export-svg.mjs <jobs.json> <outDir>
 *
 * jobs.json: [{ "id": "closedbox", "params": { "x": 100 } }, ...]. Each job builds the generator
 * with its defaults overridden by `params` (unknown keys are ignored), lays the parts out in a row
 * (no sheet limit) and writes <outDir>/<id>.svg through the app's own SVG exporter. Loads the
 * TypeScript sources through Vite's SSR loader, so no build step is needed. Prints a JSON summary.
 */
/* global process, console */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const [jobsPath, outDir] = process.argv.slice(2);
if (!jobsPath || !outDir) {
  console.error('usage: node scripts/export-svg.mjs <jobs.json> <outDir>');
  process.exit(2);
}
const jobs = JSON.parse(readFileSync(jobsPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

// Own cache dir and no dependency discovery: a running dev server (Playwright's, on the shared
// node_modules/.vite cache) would otherwise see its optimized deps change and reload every page.
const server = await createServer({
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  logLevel: 'error',
  cacheDir: 'node_modules/.vite-export-svg',
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { getGenerator } = await server.ssrLoadModule('/src/generators/index.ts');
  const { defaults } = await server.ssrLoadModule('/src/core/schema.ts');
  const { runBuild } = await server.ssrLoadModule('/src/app/build.ts');
  const { toSVG } = await server.ssrLoadModule('/src/app/export/svg.ts');
  const results = [];
  for (const job of jobs) {
    const g = getGenerator(job.id);
    if (!g) {
      results.push({ id: job.id, ok: false, message: 'unknown generator' });
      continue;
    }
    const params = defaults(g.schema);
    for (const [k, v] of Object.entries(job.params ?? {})) if (k in params) params[k] = v;
    const r = runBuild(g, params, null);
    if (!r.ok) {
      results.push({ id: job.id, ok: false, message: r.message });
      continue;
    }
    const file = join(outDir, `${job.id}.svg`);
    writeFileSync(file, toSVG(r.layout, { units: 'mm', stroke: 'cut' }));
    results.push({ id: job.id, ok: true, file, used: params });
  }
  console.log(JSON.stringify(results));
} finally {
  await server.close();
}
