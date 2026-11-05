/**
 * App state: one plain object, replaced (never mutated) on every change. The "document" part
 * (generator + params) is undoable; view state (theme, units, sheet, selection, explode) is not.
 * Params are always millimetres; `units` is display-only.
 */
import type { Generator } from '../core/part';
import { defaults, validate, type ParamValue, type Params } from '../core/schema';
import { getGenerator, registry } from '../generators';
import { History } from './history';
import type { ThemeChoice } from './ui/theme';
import type { Units } from './units';

export type { Units } from './units';
export type Sheet = { w: number; h: number };

export type State = {
  generatorId: string;
  params: Params;
  theme: ThemeChoice;
  units: Units;
  /** Material sheet (laser bed) size in mm, used for nesting. */
  sheet: Sheet;
  /** Part id highlighted in the 2D and 3D views. */
  selectedPart: string | null;
  /** 3D explode amount, 0 (assembled) .. 1 (fully apart). */
  exploded: number;
};

export type Patch = Partial<State>;
export type Listener = (state: State, prev: State) => void;

export const DEFAULT_SHEET: Sheet = { w: 600, h: 400 };

export interface Store {
  readonly state: State;
  /** Merge a patch. A params/generator change is recorded for undo; `gesture` coalesces a drag. */
  set(patch: Patch, opts?: { gesture?: string }): void;
  setParam(key: string, value: ParamValue, opts?: { gesture?: string }): void;
  /** Switch generator: its defaults, keeping the material/joint settings (CARRIED_PARAMS) valid there. */
  selectGenerator(id: string): void;
  /** End the current coalesced gesture (slider released, field committed). */
  endGesture(): void;
  subscribe(fn: Listener): () => void;
  undo(): boolean;
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

type Doc = Pick<State, 'generatorId' | 'params'>;

export type StoreOptions = {
  now?: () => number;
  /** Generator lookup (tests inject fakes). */
  lookup?: (id: string) => Generator | undefined;
};

export function defaultState(): State {
  const g = registry[0]!;
  return {
    generatorId: g.id,
    params: defaults(g.schema),
    theme: 'system',
    units: 'mm',
    sheet: { ...DEFAULT_SHEET },
    selectedPart: null,
    exploded: 0,
  };
}

/**
 * Material and joint settings that mean the same thing in every generator, so they follow the
 * user across a generator switch. Everything else (sizes, `inside`, radii…) is generator-specific:
 * the same key can mean something else elsewhere, so it resets to the new generator's default.
 */
export const CARRIED_PARAMS: readonly string[] = ['thickness', 'kerf', 'burn', 'finger', 'space', 'play', 'units'];

/** Params for `next`: its defaults, plus the CARRIED_PARAMS of `prev` that validate there. */
export function carryOver(next: Generator, prev: Params): Params {
  const out = defaults(next.schema);
  for (const d of next.schema) {
    if (!CARRIED_PARAMS.includes(d.key) || !(d.key in prev)) continue;
    const trial = { ...out, [d.key]: prev[d.key] };
    if (validate(next.schema, trial).ok) out[d.key] = prev[d.key]!;
  }
  return out;
}

export function createStore(initial: State = defaultState(), opts: StoreOptions = {}): Store {
  const now = opts.now ?? Date.now;
  const lookup = opts.lookup ?? getGenerator;
  const history = new History<Doc>();
  const listeners = new Set<Listener>();
  let state: State = syncUnits(initial);

  function syncUnits(s: State): State {
    // The schema's `units` param mirrors the toggle so exports and generators see one value.
    if ('units' in s.params && s.params.units !== s.units) return { ...s, params: { ...s.params, units: s.units } };
    return s;
  }

  function commit(next: State): void {
    const prev = state;
    state = syncUnits(next);
    for (const fn of [...listeners]) fn(state, prev);
  }

  const doc = (s: State): Doc => ({ generatorId: s.generatorId, params: s.params });
  const docChanged = (a: State, b: State): boolean =>
    a.generatorId !== b.generatorId || JSON.stringify(a.params) !== JSON.stringify(b.params);

  const store: Store = {
    get state() {
      return state;
    },
    set(patch, o) {
      const next: State = { ...state, ...patch };
      if (docChanged(state, next)) history.record(doc(state), o?.gesture, now());
      commit(next);
    },
    setParam(key, value, o) {
      if (state.params[key] === value) return;
      store.set({ params: { ...state.params, [key]: value } }, o);
    },
    selectGenerator(id) {
      const g = lookup(id);
      if (!g) throw new Error(`unknown generator "${id}"`);
      if (id === state.generatorId) return;
      history.break();
      store.set({ generatorId: id, params: carryOver(g, state.params), selectedPart: null });
    },
    endGesture() {
      history.break();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    undo() {
      const prev = history.undo(doc(state));
      if (!prev) return false;
      commit({ ...state, ...prev, selectedPart: null });
      return true;
    },
    redo() {
      const next = history.redo(doc(state));
      if (!next) return false;
      commit({ ...state, ...next, selectedPart: null });
      return true;
    },
    get canUndo() {
      return history.canUndo;
    },
    get canRedo() {
      return history.canRedo;
    },
  };
  return store;
}
