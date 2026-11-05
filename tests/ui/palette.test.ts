import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankCommands, type Command } from '../../src/app/ui/palette';

const cmd = (title: string, group = 'Generator', keywords?: string): Command => ({ id: title, title, group, ...(keywords ? { keywords } : {}), run: () => {} });

describe('palette ranking', () => {
  it('requires every token to match in order, and rejects non-matches', () => {
    expect(fuzzyScore('cbx', 'Closed box')).not.toBeNull();
    expect(fuzzyScore('xbc', 'Closed box')).toBeNull();
    expect(fuzzyScore('closed zzz', 'Closed box')).toBeNull();
    expect(fuzzyScore('BOX closed', 'Closed box')).not.toBeNull();
  });
  it('ranks word-start substrings above scattered matches', () => {
    const r = rankCommands([cmd('Abstract object'), cmd('Box with lid'), cmd('Tray')], 'box').map((c) => c.title);
    expect(r[0]).toBe('Box with lid');
    expect(r).not.toContain('Tray');
  });
  it('searches group and keywords too, and keeps order for an empty query', () => {
    const list = [cmd('Export SVG', 'Export', 'download'), cmd('Closed box')];
    expect(rankCommands(list, 'download').map((c) => c.title)).toEqual(['Export SVG']);
    expect(rankCommands(list, '  ')).toBe(list);
  });
});
