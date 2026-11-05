/**
 * Project facts shown on the About dialog and used by the README. Keep the credits here so the
 * app and the docs say the same thing.
 */
export const ABOUT = {
  name: 'KerfLab',
  /** Public source repository (the About dialog hides the link when this is empty). */
  repoUrl: 'https://github.com/alibros/kerflab',
  author: { name: 'Ali Bross', url: 'https://forestofrods.com' },
  boxesPy: {
    repo: 'https://github.com/florianfesti/boxes',
    site: 'https://boxes.hackerspace-bamberg.de',
  },
  license: { name: 'GPL v3', url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
  madeWith: 'Claude Opus 5.5',
} as const;
