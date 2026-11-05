import { describe, expect, it } from 'vitest';
import type { Generator } from '../../src/core/part';
import { clearThumbCache, hashString, MAX_THUMBS, readCached, RENDER_VERSION, thumbKey, writeCached, type ThumbStorage } from '../../src/app/ui/thumbs';
import { registry } from '../../src/generators';

const fake = (over: Partial<Generator> = {}): Generator => ({ ...registry[0]!, ...over });

class MemStorage implements ThumbStorage {
  m = new Map<string, string>();
  full = false;
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.full) throw new DOMException('quota', 'QuotaExceededError');
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}
const blocked: ThumbStorage = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};
const URL1 = 'data:image/png;base64,AAAA';

describe('3D thumbnail cache key', () => {
  it('is stable, versioned and differs between generators', () => {
    expect(hashString('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
    const keys = registry.map((g) => thumbKey(g));
    for (const k of keys) expect(k.startsWith(`v${RENDER_VERSION}-`)).toBe(true);
    expect(thumbKey(registry[0]!)).toBe(thumbKey(registry[0]!));
  });

  it('changes when the default params or the build code change', () => {
    const g = fake();
    const s0 = g.schema[0]!;
    const changedDefault = fake({ schema: [{ ...s0, default: (s0.default as number) + 1 } as typeof s0, ...g.schema.slice(1)] });
    expect(thumbKey(changedDefault)).not.toBe(thumbKey(g));
    const changedBuild = fake({ build: (p) => g.build(p).slice(0, 1) });
    expect(thumbKey(changedBuild)).not.toBe(thumbKey(g));
  });
});

describe('3D thumbnail storage', () => {
  it('round-trips and rejects stale keys or malformed entries', () => {
    const s = new MemStorage();
    expect(readCached('box', 'v1-a', s)).toBeNull();
    expect(writeCached('box', 'v1-a', URL1, s)).toBe(true);
    expect(readCached('box', 'v1-a', s)).toBe(URL1);
    expect(readCached('box', 'v1-b', s)).toBeNull(); // generator changed: re-render
    s.m.set('kerflab:thumb3d:box', 'v1-a\njavascript:alert(1)');
    expect(readCached('box', 'v1-a', s)).toBeNull();
    s.m.set('kerflab:thumb3d:box', 'garbage');
    expect(readCached('box', 'v1-a', s)).toBeNull();
  });

  it('falls back quietly when storage is blocked, missing or full', () => {
    expect(readCached('box', 'k', blocked)).toBeNull();
    expect(writeCached('box', 'k', URL1, blocked)).toBe(false);
    expect(readCached('box', 'k', null)).toBeNull();
    expect(writeCached('box', 'k', URL1, null)).toBe(false);
    const s = new MemStorage();
    writeCached('box', 'old', URL1, s);
    s.full = true;
    expect(writeCached('box', 'new', URL1, s)).toBe(false);
    expect(s.m.has('kerflab:thumb3d:box')).toBe(false); // no stale leftover
  });
});

describe('3D thumbnail storage budget', () => {
  it('keeps at most MAX_THUMBS images, dropping the oldest written', () => {
    const s = new MemStorage();
    for (let i = 0; i < MAX_THUMBS + 5; i++) expect(writeCached(`g${i}`, 'k', URL1, s)).toBe(true);
    const stored = [...s.m.keys()].filter((k) => k.startsWith('kerflab:thumb3d:'));
    expect(stored).toHaveLength(MAX_THUMBS);
    expect(readCached('g0', 'k', s)).toBeNull();
    expect(readCached(`g${MAX_THUMBS + 4}`, 'k', s)).toBe(URL1);
    writeCached('g10', 'k', URL1, s); // rewriting moves it to the newest end, not a duplicate
    expect([...s.m.keys()].filter((k) => k.startsWith('kerflab:thumb3d:'))).toHaveLength(MAX_THUMBS);
  });

  it('clearThumbCache frees every image (indexed or left over) and nothing else', () => {
    const s = new MemStorage();
    writeCached('a', 'k', URL1, s);
    writeCached('b', 'k', URL1, s);
    s.m.set('kerflab:presets', '{}');
    expect(clearThumbCache(s)).toBe(2);
    expect([...s.m.keys()]).toEqual(['kerflab:presets']);
    expect(clearThumbCache(blocked)).toBe(0);
  });
});
