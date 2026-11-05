/**
 * Tiny explanatory drawings for parameter tooltips. Ink is currentColor (the tooltip's text
 * colour); the dimension being explained is drawn in the laser accent.
 */
const W = 'viewBox="0 0 160 60" width="160" height="60" fill="none" stroke-width="1.25" stroke-linecap="square"';
const ink = (d: string): string => `<path d="${d}" stroke="currentColor"/>`;
const faint = (d: string): string => `<path d="${d}" stroke="currentColor" opacity=".45"/>`;
const mark = (d: string): string => `<path d="${d}" style="stroke: var(--accent)" stroke-width="1.5"/>`;

const BOX = ink('M24 22H88V52H24ZM24 22 40 10H104L88 22M88 52 104 40V10');
const FINGERS = 'M4 34h24v-12h24v12h24v-12h24v12h24v-12h28';

const diagrams: Record<string, string> = {
  x: BOX + mark('M24 57H88M24 54v6M88 54v6'),
  y: BOX + mark('M95 55 111 43M93 52l4 6M109 40l4 6'),
  h: BOX + mark('M15 22V52M12 22h6M12 52h6'),
  thickness: ink('M8 24H138V36H8Z') + faint('M14 24l-6 6M30 24l-12 12M46 24 34 36M62 24 50 36M78 24 66 36M94 24 82 36M110 24 98 36M126 24l-12 12M138 28l-8 8') + mark('M148 24V36M144 24h8M144 36h8'),
  kerf: ink('M8 16H74V46H8ZM86 16H152V46H86Z') + mark('M80 12V50') + mark('M74 6H86M74 3v6M86 3v6'),
  burn: faint('M30 18H130V44H30Z') + ink('M26 14H134V48H26Z') + mark('M130 31H134'),
  finger: ink(FINGERS) + mark('M28 12H52M28 9v6M52 9v6'),
  space: ink(FINGERS) + mark('M52 44H76M52 41v6M76 41v6'),
  play: ink('M10 44H56V22H104V44H150') + faint('M60 50V26H100V50') + mark('M56 14H60M100 14H104'),
  inside: ink('M30 14H130V50H30Z') + faint('M38 22H122V42H38Z') + mark('M38 32H122M38 29v6M122 29v6'),
};

export function diagramFor(key: string): string | undefined {
  const body = diagrams[key];
  return body ? `<svg ${W}>${body}</svg>` : undefined;
}
