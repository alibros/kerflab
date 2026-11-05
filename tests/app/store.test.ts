import { describe, expect, it } from 'vitest';
import type { Generator } from '../../src/core/part';
import { commonParams, defaults } from '../../src/core/schema';
import { getGenerator, registry } from '../../src/generators';
import { History } from '../../src/app/history';
import { createStore, defaultState, type State } from '../../src/app/store';
import { runBuild } from '../../src/app/build';
import { displayStep, fromDisplay, toDisplay } from '../../src/app/units';
import { applyPreset, deleteUserPreset, loadUserPresets, saveUserPreset, uniquePresetName } from '../../src/app/presets';

const gen = registry[0]!;

/** Fake clock so coalescing windows are deterministic. */
function clock(): { now: () => number; tick: (ms: number) => void } {
  let t = 1000;
  return { now: () => t, tick: (ms) => void (t += ms) };
}

describe('store', () => {
  it('starts from defaults for the first generator', () => {
    const s = defaultState();
    expect(s.generatorId).toBe(gen.id);
    expect(s.params).toEqual(defaults(gen.schema));
    expect(s).toMatchObject({ units: 'mm', theme: 'system', selectedPart: null, exploded: 0 });
    expect(s.sheet.w).toBeGreaterThan(0);
  });

  it('set() merges a patch and notifies subscribers with the previous state', () => {
    const store = createStore();
    const seen: [State, State][] = [];
    const off = store.subscribe((s, prev) => seen.push([s, prev]));
    store.set({ params: { ...store.state.params, x: 140 } });
    expect(store.state.params.x).toBe(140);
    expect(seen).toHaveLength(1);
    expect(seen[0]![1].params.x).toBe(100);
    off();
    store.set({ exploded: 0.5 });
    expect(seen).toHaveLength(1);
  });

  it('undo/redo restores params', () => {
    const c = clock();
    const store = createStore(undefined, { now: c.now });
    const p0 = store.state.params;
    store.setParam('x', 120);
    c.tick(5000);
    store.setParam('h', 60);
    expect(store.undo()).toBe(true);
    expect(store.state.params).toEqual({ ...p0, x: 120 });
    expect(store.undo()).toBe(true);
    expect(store.state.params).toEqual(p0);
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.state.params).toEqual({ ...p0, x: 120, h: 60 });
    expect(store.redo()).toBe(false);
  });

  it('coalesces a slider drag into one history entry', () => {
    const c = clock();
    const store = createStore(undefined, { now: c.now });
    for (let v = 101; v <= 160; v++) {
      store.setParam('x', v, { gesture: 'x' });
      c.tick(30);
    }
    store.endGesture();
    store.setParam('x', 170, { gesture: 'x' });
    expect(store.undo()).toBe(true);
    expect(store.state.params.x).toBe(160);
    expect(store.undo()).toBe(true);
    expect(store.state.params.x).toBe(100);
    expect(store.canUndo).toBe(false);
  });

  it('a new edit after undo drops the redo branch', () => {
    const store = createStore();
    store.setParam('x', 120);
    store.undo();
    store.setParam('y', 50);
    expect(store.canRedo).toBe(false);
  });

  it('non-document state (theme, selection, explode, units) is not undoable', () => {
    const store = createStore();
    store.set({ theme: 'dark', exploded: 1, selectedPart: 'front', units: 'in' });
    expect(store.canUndo).toBe(false);
  });

  it('switching generator resets params to its defaults, keeping shared material settings', () => {
    const other: Generator = { ...gen, id: 'tray', name: 'Tray', schema: [
      { key: 'x', label: 'Width', help: '', unit: 'mm', group: 'Size', kind: 'number', min: 10, max: 50, default: 20, step: 1 },
      ...commonParams,
    ] };
    const lookup = (id: string): Generator | undefined => (id === 'tray' ? other : getGenerator(id));
    const store = createStore(undefined, { lookup });
    store.setParam('thickness', 4);
    store.setParam('x', 300);
    store.set({ selectedPart: 'front' });
    store.selectGenerator('tray');
    expect(store.state.generatorId).toBe('tray');
    expect(store.state.params).toEqual({ ...defaults(other.schema), thickness: 4 });
    expect(store.state.selectedPart).toBeNull();
    store.undo();
    expect(store.state.generatorId).toBe(gen.id);
    expect(store.state.params.x).toBe(300);
    expect(() => store.selectGenerator('nope')).toThrow();
  });

  it('switching from a customised closedbox to any generator gives its defaults plus material settings only', () => {
    const material = { thickness: 3.2, kerf: 0.15, burn: false, finger: 2.5, space: 2.5, play: 0.05 };
    for (const g of registry) {
      if (g.id === 'closedbox') continue;
      const store = createStore();
      store.selectGenerator('closedbox');
      const custom = { x: 123, y: 77, h: 55, outside: true, inside: true, radius: 9, ...material };
      for (const [k, v] of Object.entries(custom)) if (k in store.state.params) store.setParam(k, v);
      store.selectGenerator(g.id);
      const expected = defaults(g.schema);
      for (const [k, v] of Object.entries(material)) if (k in expected) expected[k] = v;
      expect(store.state.params, g.id).toEqual(expected);
      const r = runBuild(g, store.state.params, store.state.sheet);
      expect(r.ok ? '' : r.message, g.id).toBe('');
    }
  });

  it('keeps params.units in sync with the units toggle', () => {
    const store = createStore();
    store.set({ units: 'in' });
    expect(store.state.params.units).toBe('in');
  });
});

describe('history', () => {
  it('undo on empty history returns undefined', () => {
    expect(new History<number>().undo(1)).toBeUndefined();
  });

  it('caps its length', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 10; i++) h.record(i);
    let cur = 10;
    let n = 0;
    for (let v = h.undo(cur); v !== undefined; v = h.undo(cur)) {
      cur = v;
      n++;
    }
    expect(n).toBe(3);
    expect(cur).toBe(7);
  });

  it('a different gesture key, or a pause longer than the window, starts a new entry', () => {
    const h = new History<number>(100, 500);
    h.record(0, 'a', 0);
    h.record(1, 'a', 100);
    h.record(2, 'b', 200);
    h.record(3, 'b', 1000);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(0);
  });
});

describe('units', () => {
  it('mm -> in -> mm round-trips within 1e-9', () => {
    for (const mm of [0, 0.01, 0.1, 3, 25.4, 100, 333.333, 1000, 1234.5678]) {
      expect(Math.abs(fromDisplay(toDisplay(mm, 'in'), 'in') - mm)).toBeLessThan(1e-9);
      expect(fromDisplay(toDisplay(mm, 'mm'), 'mm')).toBe(mm);
    }
    expect(toDisplay(25.4, 'in')).toBeCloseTo(1, 12);
  });

  it('toggling units never touches stored params', () => {
    const store = createStore();
    const before = { ...store.state.params, units: undefined };
    store.set({ units: 'in' });
    store.set({ units: 'mm' });
    expect({ ...store.state.params, units: undefined }).toEqual(before);
  });

  it('picks a sensible inch step', () => {
    expect(displayStep(1, 'mm')).toBe(1);
    expect(displayStep(1, 'in')).toBe(0.001); // thou
    expect(displayStep(0.01, 'in')).toBe(0.0001);
  });
});

describe('presets', () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k) => m.get(k) ?? null,
      key: (i) => [...m.keys()][i] ?? null,
      removeItem: (k) => void m.delete(k),
      setItem: (k, v) => void m.set(k, v),
    };
  }

  it('saves, lists and deletes user presets per generator', () => {
    const st = memoryStorage();
    expect(loadUserPresets(gen.id, st)).toEqual({});
    expect(saveUserPreset(gen.id, 'Mine', { ...defaults(gen.schema), x: 77 }, st)).toBe(true);
    expect(loadUserPresets(gen.id, st).Mine?.x).toBe(77);
    expect(loadUserPresets('other', st)).toEqual({});
    deleteUserPreset(gen.id, 'Mine', st);
    expect(loadUserPresets(gen.id, st)).toEqual({});
  });

  it('names a preset "name (2)" rather than overwrite an existing one', () => {
    const st = memoryStorage();
    expect(uniquePresetName(gen.id, 'Mine', st)).toBe('Mine');
    saveUserPreset(gen.id, 'Mine', defaults(gen.schema), st);
    expect(uniquePresetName(gen.id, 'Mine', st)).toBe('Mine (2)');
    saveUserPreset(gen.id, 'Mine (2)', defaults(gen.schema), st);
    expect(uniquePresetName(gen.id, 'Mine', st)).toBe('Mine (3)');
    expect(uniquePresetName('other', 'Mine', st)).toBe('Mine');
  });

  it('frees the thumbnail cache when a preset save hits the storage quota', () => {
    const st = memoryStorage();
    const set = st.setItem.bind(st);
    st.setItem('kerflab:thumb3d:big', 'v\ndata:image/png;base64,AAAA');
    st.setItem = (k, v) => {
      if (k === 'kerflab:presets' && st.getItem('kerflab:thumb3d:big') !== null) throw new DOMException('full', 'QuotaExceededError');
      set(k, v);
    };
    expect(saveUserPreset(gen.id, 'Mine', defaults(gen.schema), st)).toBe(true);
    expect(st.getItem('kerflab:thumb3d:big')).toBeNull();
    expect(Object.keys(loadUserPresets(gen.id, st))).toEqual(['Mine']);
  });

  it('survives corrupt or unavailable storage', () => {
    const st = memoryStorage();
    st.setItem('kerflab:presets', '{not json');
    expect(loadUserPresets(gen.id, st)).toEqual({});
    const broken = { ...memoryStorage(), getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } } as Storage;
    expect(loadUserPresets(gen.id, broken)).toEqual({});
    expect(saveUserPreset(gen.id, 'x', defaults(gen.schema), broken)).toBe(false);
  });

  it('applies a partial preset onto current params, ignoring unknown or invalid keys', () => {
    const g = getGenerator('closedbox')!;
    const cur = { ...defaults(g.schema), thickness: 4 };
    const next = applyPreset(g.schema, cur, { x: 60, bogus: 1, y: 'wide' });
    expect(next).toEqual({ ...cur, x: 60 });
    for (const preset of Object.values(g.presets)) expect(Object.keys(applyPreset(g.schema, cur, preset)).sort()).toEqual(Object.keys(cur).sort());
  });
});
