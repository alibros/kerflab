import { describe, expect, it } from 'vitest';
import { ALL, CATEGORY_ORDER, filterGenerators, matchesQuery, orderCategories } from '../../src/app/ui/gallery';
import { registry } from '../../src/generators';

const g = (id: string, category: string, name = id, description = ''): { id: string; name: string; description: string; category: string } => ({ id, name, description, category });

describe('gallery categories', () => {
  it('orders known categories first, then new ones in first-seen order', () => {
    const gens = [g('a', 'Zany'), g('b', 'Flex'), g('c', 'Boxes'), g('d', 'Electronics'), g('e', 'Another'), g('f', 'Boxes')];
    expect(orderCategories(gens)).toEqual(['Boxes', 'Flex', 'Electronics', 'Zany', 'Another']);
  });

  it('covers every registered generator exactly once', () => {
    const cats = orderCategories(registry);
    expect(cats.slice(0, 1)).toEqual([CATEGORY_ORDER[0]]);
    const total = cats.reduce((n, c) => n + filterGenerators(registry, c, '').length, 0);
    expect(total).toBe(registry.length);
    expect(filterGenerators(registry, ALL, '')).toHaveLength(registry.length);
  });

  it('filters by category and by every search word', () => {
    const gens = [g('closedbox', 'Boxes', 'Closed box', 'Six walls'), g('typetray', 'Trays', 'Type tray', 'Open box with compartments'), g('flexbox', 'Flex', 'Flex box', 'Rounded')];
    expect(filterGenerators(gens, 'Boxes', '').map((x) => x.id)).toEqual(['closedbox']);
    expect(filterGenerators(gens, ALL, 'box').map((x) => x.id)).toEqual(['closedbox', 'typetray', 'flexbox']);
    expect(filterGenerators(gens, 'Trays', 'box').map((x) => x.id)).toEqual(['typetray']);
    expect(filterGenerators(gens, ALL, 'open compart').map((x) => x.id)).toEqual(['typetray']);
    expect(matchesQuery(gens[0]!, '  ')).toBe(true);
    expect(matchesQuery(gens[0]!, 'CLOSED')).toBe(true);
    expect(matchesQuery(gens[0]!, 'zzz')).toBe(false);
  });
});
