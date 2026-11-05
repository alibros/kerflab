# Contributing to KerfLab

Thanks for taking a look! Contributions of every size are welcome: a new generator, a fix to a
joint that doesn't quite fit, a clearer tooltip, a bug report with a share link, or a photo of
something you cut. If you're unsure whether an idea fits, open an issue and ask; there are no
silly questions here.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

You need Node.js (current LTS) and npm.

```sh
npm install
npm run dev        # the app on http://localhost:5173 (component sheet at /sandbox.html)
npm run check      # tsc (strict) + eslint (0 warnings) + vitest + vite build
```

`npm run check` is the main gate; if it's green locally, CI will almost certainly be green too.

### End-to-end tests (Playwright)

The first time, download the browsers Playwright drives:

```sh
npx playwright install            # add --with-deps on Linux to pull in system libraries
npm run test:e2e                  # the `app` and `3d` projects (starts its own dev server)
```

The 3D specs render on SwiftShader (software WebGL), so they're slower than the rest and run as a
second phase after the `app` project.

There is also a registry-wide screenshot sweep (every generator, Sheet + 3D, light + dark) into
`artifacts/shots/`. It's slow and not part of CI by default; run it when you want to eyeball a
change visually:

```sh
npx playwright test --project=shots --no-deps --workers=4
```

### Optional: compare with boxes.py

`scripts/compare-boxespy.py` compares part sizes and edge counts with
[boxes.py](https://github.com/florianfesti/boxes) for the generators mapped one-to-one. Point it
at the path to your boxes.py checkout (the directory that holds the `boxes` package):

```sh
BOXESPY_PATH=/path/to/boxes python3 scripts/compare-boxespy.py -v
# or
python3 scripts/compare-boxespy.py --boxespy /path/to/boxes -v
```

Without boxes.py it prints "skipped" and exits 0, so it never blocks anything.

## Adding a generator

It's deliberately small: **one file plus one line**.

1. Create `src/generators/<id>.ts` exporting a `Generator` (`id`, `name`, `category`,
   `description`, `schema`, `presets`, `build`, and ideally `expectedSize`). `closedbox.ts` is the
   reference pattern: own params first, then `...commonParams`; derive inner sizes; throw a
   `ParamError` that names the offending param key for infeasible input; draw panels with the
   wall helpers, place them in world space and finish with kerf.
2. Import it and add it to the `registry` array in `src/generators/index.ts`.
3. Add a headline-dimension test to the matching `tests/generators/<batch>.test.ts` (or a new
   file if it starts a new family).

That's it for UI: the form, thumbnails, URL state, picker, command palette and screenshot sweep
all come from the registry and the schema.

### What the harness checks for you

Every registered generator runs through `tests/generators/suite.ts` automatically (sharded across
workers). It checks that:

- **Valid parts**: every outline is closed, simple (no self-intersections) and counter-clockwise,
  with its holes inside.
- **Kerf**: kerf compensation applies cleanly to every part.
- **Joints / contact**: every finger edge mates a complementary edge over the same span, and parts
  that touch really do touch where their mates say.
- **Connectivity**: the assembled parts form one connected object. Things that are meant to be a
  set of separate pieces (gears, a loose lid, spare parts) declare `assembly: 'loose'`.
- **No interpenetration**: no two parts occupy the same space in the assembled 3D model.
- **Size**: the assembled size equals `expectedSize(params)` within 0.01 mm.
- **Presets**: every preset validates, builds and assembles.
- **Fuzzing** (fixed seed, 200 random cases plus defaults, presets, min/max corners and per-param
  extremes): each case either builds valid output or throws a `ParamError` whose message names
  the parameter(s) at fault. At least **50 %** of the corner cases and of the random cases must
  build, so the parameter ranges have to be honest.
- **Snapshots**: the default SVG export matches `tests/generators/__snapshots__/<id>.svg`.

### Updating snapshots deliberately

Snapshots are there so geometry never changes by accident. When you *mean* to change the output:

```sh
npx vitest run -u tests/generators     # rewrite the SVG snapshots
git diff --stat tests/generators/__snapshots__
```

Only the generators you intended to touch should show up in the diff. Open the changed SVGs (or
compare in the app) and mention in your PR *why* the geometry changed. A new generator's snapshot
is written on its first run; commit it along with the generator.

## Docs conventions

Three files in `docs/` keep track of how this project relates to boxes.py. Please keep them in sync
with your change:

- **`docs/coverage.md`**: every boxes.py generator mapped to what builds it here
  (`yes` / `partial` / `no` / `out`, plus the params or preset that reproduce it). Update the row
  and the summary counts when you add or extend a generator.
- **`docs/differences.md`**: deliberate differences from boxes.py, per generator plus shared
  conventions. If your generator simplifies or changes something on purpose, write it down here
  so nobody "fixes" it later.
- **`docs/cut-list.md`**: things considered and *not* built, with the reason and what would be
  needed. If you build one, remove or update its entry; if you drop something, add one.

`docs/design/` holds the original design brief (goals, visual identity, quality gates).

## Code style

- TypeScript `strict` (plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`); no `any`
  escape hatches without a good reason.
- ESLint with **zero warnings** (`npm run lint`).
- `src/core/` stays DOM-free and pure; app concerns live in `src/app/`.
- Units are millimetres internally; inches are display-only.
- Comments explain *why* (and cite the boxes.py source when porting), not what the next line does.
- Keep UI motion purposeful and honour `prefers-reduced-motion`; axe must stay at zero violations
  in both themes.

## Pull request checklist

- [ ] `npm run check` passes
- [ ] `npm run test:e2e` passes (or explain why it couldn't run for you)
- [ ] New/changed generator: headline-dimension test added, presets build, snapshot updated on
      purpose
- [ ] `docs/coverage.md`, `docs/differences.md` and `docs/cut-list.md` updated where relevant
- [ ] UI change: checked in light and dark themes (a screenshot in the PR helps a lot)
- [ ] If you cut it: a photo or a note on material/kerf is very welcome!

## License

KerfLab is GPL-3.0-or-later (it ports geometry and logic from boxes.py, which is GPL-3.0). By
contributing you agree that your contribution is licensed under the same terms.
