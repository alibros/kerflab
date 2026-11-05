import { defineConfig } from '@playwright/test';

// Dedicated port so we never reuse some other project's dev server on Vite's default 5173.
const PORT = 5287;
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: `http://localhost:${PORT}` },
  // The 3D specs need WebGL, which headless runners usually lack: they render on SwiftShader
  // (CPU). That is heavy enough to starve timing-sensitive UI tests (gesture coalescing) running
  // beside it, so the 3D project runs as a second phase, after the app project.
  projects: [
    { name: 'app', testIgnore: /(viewer|screenshots)\.spec\.ts/ },
    {
      name: '3d',
      testMatch: /viewer\.spec\.ts/,
      dependencies: ['app'],
      use: { launchOptions: { args: SWIFTSHADER } },
    },
    // Registry-wide screenshot sweep (every generator, Sheet + 3D, light + dark) into artifacts/shots/.
    // Slow on SwiftShader: run alone with `npx playwright test --project=shots --no-deps --workers=4`.
    {
      name: 'shots',
      testMatch: /screenshots\.spec\.ts/,
      dependencies: ['3d'],
      retries: 2, // heavy CPU rendering under parallel workers occasionally stalls or crashes a page
      use: { launchOptions: { args: SWIFTSHADER } },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/sandbox.html`,
    reuseExistingServer: !process.env.CI,
  },
});
