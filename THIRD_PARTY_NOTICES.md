# Third-party notices

KerfLab itself is licensed under the GNU General Public License v3.0 or later (see
[LICENSE](LICENSE)). It includes or derives from the following third-party works. Each remains
under its own license; the full license texts ship with the packages in `node_modules/` after
`npm install` and are linked below.

## Derived work

### boxes.py

- Source: https://github.com/florianfesti/boxes
- Copyright: Florian Festi and contributors
- License: GNU General Public License v3.0 (GPL-3.0)

The generators and edge library port the geometry and logic of boxes.py generators (each ported
source file names the boxes.py file it follows). KerfLab is therefore a derivative work and is
distributed under GPL-3.0-or-later, which is compatible.

## Bundled in the built app

### three.js

- Source: https://github.com/mrdoob/three.js (npm `three`, including modules from
  `three/examples/jsm`: OrbitControls, RoomEnvironment, LineMaterial, LineSegments2,
  LineSegmentsGeometry)
- Copyright: © 2010-2026 three.js authors
- License: MIT (https://github.com/mrdoob/three.js/blob/dev/LICENSE)

### Bricolage Grotesque (font)

- Source: https://github.com/ateliertriay/bricolage, packaged by Fontsource
  (`@fontsource-variable/bricolage-grotesque`)
- Copyright: 2022 The Bricolage Grotesque Project Authors
- License: SIL Open Font License 1.1 (https://openfontlicense.org)

### IBM Plex Mono (font)

- Source: https://github.com/IBM/plex, packaged by Fontsource (`@fontsource/ibm-plex-mono`)
- Copyright: 2017 IBM Corp.
- License: SIL Open Font License 1.1 (https://openfontlicense.org)

The fonts are served unmodified (as the WOFF/WOFF2 files Fontsource publishes) and are not sold
on their own, as the OFL requires.

## Development-only tools

Build and test tooling (Vite, TypeScript, ESLint, Vitest, Playwright, axe-core, ...) is used to
build and test the app but is not bundled into it. Their licenses are in `node_modules/` and
`package-lock.json`.
