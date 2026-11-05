/**
 * Hairline icon set, drawn on a 16-unit grid with 1.5 strokes and square caps
 * so they sit with the drafting aesthetic (no rounded "app" glyphs).
 */
const wrap = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter">${body}</svg>`;

export const icons = {
  reset: wrap('<path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2"/><path d="M3.5 2.5v2.8h2.8"/>'),
  chevron: wrap('<path d="M4.5 6.5 8 10l3.5-3.5"/>'),
  info: wrap('<circle cx="8" cy="8" r="6"/><path d="M8 7.2V11.5M8 4.6v.1"/>'),
  download: wrap('<path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M2.5 13.5h11"/>'),
  plus: wrap('<path d="M8 3v10M3 8h10"/>'),
  link: wrap('<path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8"/>'),
  sun: wrap('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>'),
  moon: wrap('<path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6Z"/>'),
  system: wrap('<rect x="2" y="3" width="12" height="8.5"/><path d="M5.5 14h5M8 11.5V14"/>'),
  alert: wrap('<path d="M8 2 14.5 13.5h-13Z"/><path d="M8 6.5v3.2M8 11.4v.1"/>'),
} as const;

export type IconName = keyof typeof icons;
