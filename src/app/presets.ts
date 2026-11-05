/**
 * Presets: the generator's built-in ones plus user presets in localStorage
 * (`kerflab:presets` = { [generatorId]: { [name]: Params } }). Storage may be missing, full or
 * corrupt; every access is guarded and failures degrade to "no user presets".
 */
import { defaults, validate, type Params, type Schema } from '../core/schema';
import { clearThumbCache } from './ui/thumbs';

const KEY = 'kerflab:presets';
type All = Record<string, Record<string, Params>>;

function storage(s?: Storage): Storage | null {
  if (s) return s;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readAll(s?: Storage): All {
  try {
    const raw = storage(s)?.getItem(KEY);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as All) : {};
  } catch {
    return {};
  }
}

/** Write presets; on a quota error, free the (re-renderable) thumbnail cache and try once more. */
function writeAll(all: All, s?: Storage): boolean {
  const st = storage(s);
  if (!st) return false;
  const text = JSON.stringify(all);
  try {
    st.setItem(KEY, text);
    return true;
  } catch {
    if (!clearThumbCache(st)) return false;
    try {
      st.setItem(KEY, text);
      return true;
    } catch {
      return false;
    }
  }
}

/** `name`, or "name (2)", "name (3)"… when the generator already has a user preset called that. */
export function uniquePresetName(generatorId: string, name: string, s?: Storage): string {
  const taken = new Set(Object.keys(loadUserPresets(generatorId, s)));
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}

/**
 * Keeps only the values that are schema keys and validate there (each checked over the schema
 * defaults); undefined when none survive.
 */
function cleanPreset(schema: Schema, p: Record<string, unknown>): Params | undefined {
  const base = defaults(schema);
  const out: Params = {};
  for (const d of schema) {
    if (!Object.prototype.hasOwnProperty.call(p, d.key)) continue;
    if (validate(schema, { ...base, [d.key]: p[d.key] }).ok) out[d.key] = p[d.key] as Params[string];
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * User presets for a generator. Storage is user-editable: only plain-object entries are kept, so a
 * chip can't throw; with `schema`, each stored value must also validate against the generator's
 * schema (unknown keys and invalid values are dropped, and a preset left empty is dropped).
 */
export function loadUserPresets(generatorId: string, s?: Storage, schema?: Schema): Record<string, Params> {
  const mine = readAll(s)[generatorId];
  if (typeof mine !== 'object' || mine === null || Array.isArray(mine)) return {};
  const out: Record<string, Params> = {};
  for (const [name, p] of Object.entries(mine)) {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) continue;
    const kept = schema ? cleanPreset(schema, p as Record<string, unknown>) : p;
    if (kept) out[name] = kept;
  }
  return out;
}

/** Returns false when storage is unavailable or full. */
export function saveUserPreset(generatorId: string, name: string, params: Params, s?: Storage): boolean {
  const all = readAll(s);
  all[generatorId] = { ...loadUserPresets(generatorId, s), [name]: { ...params } };
  return writeAll(all, s);
}

export function deleteUserPreset(generatorId: string, name: string, s?: Storage): void {
  const all = readAll(s);
  const mine = { ...loadUserPresets(generatorId, s) };
  delete mine[name];
  all[generatorId] = mine;
  writeAll(all, s);
}

/**
 * Apply a (possibly partial, possibly stale) preset onto the current params: each preset value is
 * taken only if the key is in the schema and the value validates there; everything else (e.g.
 * the user's material settings) stays as it is.
 */
export function applyPreset(schema: Schema, current: Params, preset: Record<string, unknown>): Params {
  const out: Params = { ...current };
  for (const d of schema) {
    if (!Object.prototype.hasOwnProperty.call(preset, d.key) || d.key === 'units') continue;
    const trial = { ...out, [d.key]: preset[d.key] };
    if (validate(schema, trial).ok) out[d.key] = preset[d.key] as Params[string];
  }
  return out;
}
