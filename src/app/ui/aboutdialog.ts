/**
 * The About dialog: what KerfLab is, where it comes from (boxes.py), who made it, and how to
 * help. A native <dialog>, so focus trapping, Escape and the backdrop come from the browser.
 */
import { ABOUT } from '../about';
import { h } from './dom';

export interface AboutHandle {
  el: HTMLDialogElement;
  open(): void;
  close(): void;
}

const link = (href: string, text: string): HTMLAnchorElement =>
  h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

export function createAbout(): AboutHandle {
  const titleId = 'about-title';
  const closeBtn = h('button', { type: 'button', class: 'bx-btn bx-btn--sm bx-btn--quiet app-about__close', 'aria-label': 'Close' }, '✕');

  const section = (heading: string, ...body: (Node | string)[]): HTMLElement =>
    h('section', { class: 'app-about__sec' }, h('h3', { class: 'bx-label app-about__h' }, heading), h('p', {}, ...body));

  const sections: HTMLElement[] = [
    h(
      'p',
      { class: 'app-about__lede' },
      'KerfLab makes laser-cut boxes, trays, gears, jigs and all sorts of flat-pack bits, right in your browser. Pick a generator, nudge the numbers, spin it around in 3D, then grab a cut file that’s ready for your laser.',
    ),
    section(
      'Standing on the shoulders of boxes.py',
      'KerfLab is a reimagining of ',
      link(ABOUT.boxesPy.repo, 'boxes.py'),
      ' by Florian Festi and its many contributors, the brilliant open-source box generator that’s been helping makers for years. Loads of the joint geometry and generator ideas here come straight from it. If KerfLab is useful to you, go show ',
      link(ABOUT.boxesPy.site, 'boxes.py'),
      ' some love too.',
    ),
    section(
      'Who made this',
      'Made by ',
      link(ABOUT.author.url, ABOUT.author.name),
      `, built together with ${ABOUT.madeWith} (an AI pair-programmer from Anthropic). Yes, a lot of the code was written by an AI, and it was reviewed and tested to within an inch of its life along the way.`,
    ),
    section(
      'Open source, and you’re invited',
      'KerfLab is free and open source under the ',
      link(ABOUT.license.url, ABOUT.license.name),
      ' licence, same as boxes.py. Found a bug, got an idea for a generator, or made something cool with it? Contributions of every size are very welcome: issues, pull requests, presets, docs, or just showing us what you cut.',
      ...(ABOUT.repoUrl ? [' The code lives on ', link(ABOUT.repoUrl, 'GitHub'), '.'] : []),
    ),
    h('p', { class: 'app-about__note' }, 'Please check your cut files before you fire the laser, and never leave a laser running unattended.'),
  ];

  const el = h(
    'dialog',
    { class: 'app-about', 'aria-labelledby': titleId },
    h(
      'div',
      { class: 'app-about__box' },
      h(
        'header',
        { class: 'app-about__head' },
        h('h2', { id: titleId, class: 'app-about__title' }, 'kerf', h('span', { class: 'app-wordmark__kerf', 'aria-hidden': 'true' }), 'lab', h('span', { class: 'vh' }, ' — about')),
        closeBtn,
      ),
      ...sections,
    ),
  ) as HTMLDialogElement;

  closeBtn.addEventListener('click', () => el.close());
  // A click on the backdrop lands on the dialog itself, outside the box.
  el.addEventListener('click', (e) => {
    if (e.target === el) el.close();
  });

  return {
    el,
    open() {
      if (!el.isConnected) document.body.append(el);
      if (!el.open) el.showModal();
    },
    close() {
      el.close();
    },
  };
}
