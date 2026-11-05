# KerfLab (working title: boxes-js) — Design Spec (2026-11-05)

> The original design brief the project was built from, kept for its goals, identity and
> quality gates. Some details (e.g. the generator list) have since moved on; see
> [coverage.md](../coverage.md) for what ships today.

A browser-only, modern reimagining of boxes.py (florianfesti/boxes): parametric
laser/CNC box generators with live 2D cut layout, assembled 3D preview, and
SVG/DXF export. General-purpose boxes only (Eurorack is a separate project).

## Goals
- Faithful, correct, cut-ready output (finger joints that actually fit).
- Broad generator library, schema-driven so adding one needs no UI code.
- A distinctive, polished, intuitive UI (see Identity).
- Quality enforced mechanically (see Quality Gates).

## Non-goals (v1)
Accounts/cloud, backend, Eurorack, plugin API, mobile-first editing (must remain usable).

## Stack
Vite + TypeScript (strict) + Three.js. Plain DOM/CSS with a tiny reactive store
(no heavy framework). Vitest, ESLint, Playwright. Fonts self-hosted (fontsource).
Static site; deployable anywhere.

## Architecture
1. `src/core/` — pure TS, no DOM. Path primitives, edge library (flat, finger,
   mitre, rounded, hinge, slot, T-slot, click-in, flex), kerf/offset, 2D part
   model, nesting. Fully unit-tested.
2. `src/generators/` — one file per box type exporting `{ id, name, category,
   params: Schema, build(params) -> Part[] }`. Part = outlines, holes, engraving
   paths, 3D placement (transform + thickness), edge-mating metadata.
3. `src/app/` — UI generated from schemas, Three.js viewer, exporters
   (SVG, DXF; PDF if cheap), presets, undo/redo, URL-state sharing.

Data flow: params -> build() -> Part[] -> {2D layout/nest, 3D assembly, export}.
The 3D view is derived from the same parts as the cut files, so preview == output.

## Generator scope (v1, ~30, grouped)
Cross-checked against boxes.py generator list. Grouped for the gallery:
- **Boxes:** closed, open, based (base-only), half, uneven-height, angled,
  universal, hinge, integrated-hinge, side-hinge, sliding-lid, shutter,
  two-piece, stackable bin, rounded, rounded-regular, regular (n-gon),
  regular-star, rounded-trapezoid, U-box, slanted tray.
- **Trays & organizers:** tray, tray insert, tray layout, divider tray,
  compartment box, small-parts tray, type tray, drawer (sliding), card box,
  dice box, pen holder, key holder, silverware box.
- **Flex:** flexbox (living hinge) variants, flex book.
- **Storage/display:** wine rack, spice rack, phone holder, laptop stand,
  bookholder, shelf.
Order of delivery: core + closed/open/tray/drawer/sliding/flex first, then the
rest in batches; each batch only lands when it passes all gates. Items that
prove disproportionate in effort are cut and listed in the plan, not shipped
half-done.

## UI & Identity ("not another AI-looking app")
Concept: **a maker's drafting table** — the warmth of paper, ink, brass and
plywood, with a single sharp laser-vermilion accent. Not purple gradients, not
glassmorphism, not Inter-on-dark.
- **Palette:** Light "Paper": warm off-white (#F3EFE6), ink (#1B1F2A), vermilion
  laser accent (#E8452C), brass secondary (#B08A3E), birch/walnut material
  swatches. Dark "Blueprint": deep ink-navy (#0F1420), chalk text, same vermilion.
  Both defined as tokens; WCAG AA contrast verified.
- **Type:** distinctive display/UI face (Bricolage Grotesque) + technical mono
  (IBM Plex Mono) for dimensions/numbers. Tabular numerals in inputs. No Inter/Roboto/system default look.
- **Details:** drafting-style dimension callouts on the 2D view, subtle paper
  grain/grid, hairline rules, crisp square-ish geometry with deliberate radii.
- **Layout:** left: searchable generator gallery with thumbnail previews, then
  grouped, collapsible settings with units toggle (mm/in) and sensible defaults.
  Center: 3D | 2D tabs or split. Bottom bar: sheet size, nesting, cut-time/length
  estimate, export. Command palette (Cmd/Ctrl-K) for generators and actions.
- **Intuition:** sliders + typed inputs with live validation, hover tooltips
  explaining each parameter with a tiny diagram, reset-per-field, presets,
  undo/redo, copy shareable link, clear empty/error states.
- **Motion (restrained):** only purposeful — parts assemble/explode on a slider
  with eased interpolation, smooth camera focus on part selection, 120–200ms
  UI state transitions, panel reveal. No decorative looping animation.
  Respects `prefers-reduced-motion`.
- **3D:** orbit/pan/zoom, exploded slider, material looks (birch, walnut,
  acrylic, MDF, metal), edge outlines, soft shadows, section cut, part
  highlight linked to 2D selection, screenshot/PNG export.
- Keyboard accessible, responsive down to tablet, usable on phone.

## Quality Gates (all enforced by `npm run check`)
1. `tsc --strict`, ESLint (no warnings), Vitest, production build must pass.
2. **Per-generator invariants (property/fuzz tests over randomized params):**
   closed non-self-intersecting outlines; mating edges complementary and within
   tolerance; assembled 3D parts don't interpenetrate or leave gaps; part
   dimensions match requested dimensions; kerf applied consistently.
3. **Schema fuzzing:** min/max/invalid params yield clear validation errors,
   never crashes or NaN geometry.
4. **Snapshot tests** of SVG output; geometry changes require explicit review.
5. **Visual review:** Playwright screenshots of every generator (2D + 3D, light
   + dark) are reviewed before a generator is marked done.
6. **Reference comparison:** where boxes.py is runnable locally, compare part
   sizes/edge counts for equal inputs; document deliberate differences.
7. Definition of done per generator: all of the above + documented params +
   a preset + gallery thumbnail.
8. A UI accessibility pass (axe) and contrast check on both themes.

## Licensing note
boxes.py is GPL-3.0. Generators port its geometry and logic, so boxes-js is a
derivative work and is licensed GPL-3.0-or-later.

## Risks
Finger-joint fit correctness across mixed edge types and kerf (mitigated by
invariant tests); scope (mitigated by batch delivery and cut list); 3D
placement for non-rectangular generators (per-generator placement metadata +
assembly test).
