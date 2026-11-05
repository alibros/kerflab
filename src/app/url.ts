/**
 * Shareable URL state, kept in the hash:
 *
 *   #v1/<generatorId>/<key>=<value>;<key>=<value>;_u=in;_sheet=600x400
 *
 * Only values that differ from the generator's defaults are written, so links stay short.
 * Booleans are 1/0; numbers use their shortest exact decimal form. `_`-prefixed keys are view
 * state (units, sheet). Theme, selection and explode are personal and not shared.
 *
 * `decodeState` never throws: anything it cannot use falls back to defaults (or the nearest
 * valid value) and is reported in `notice`, a sentence for a non-blocking toast.
 */
import type { ParamDef, ParamValue, Params } from '../core/schema';
import { defaults, validate } from '../core/schema';
import { getGenerator, registry } from '../generators';
import { SHEET_RANGE } from './profiles';
import { DEFAULT_SHEET, defaultState, type Sheet, type State } from './store';

export const URL_VERSION = 'v1';

/** `unitsInLink`: the link named its units (`_u`); otherwise `units` is just the default. */
export type DecodedState = State & { notice?: string; unitsInLink?: boolean };

const enc = (v: ParamValue): string => (typeof v === 'boolean' ? (v ? '1' : '0') : encodeURIComponent(String(v)));

export function encodeState(s: State): string {
  const g = getGenerator(s.generatorId) ?? registry[0]!;
  const def = defaults(g.schema);
  const pairs: string[] = [];
  for (const d of g.schema) {
    if (d.key === 'units') continue; // mirrored by _u
    const v = s.params[d.key];
    if (v === undefined || v === def[d.key]) continue;
    pairs.push(`${d.key}=${enc(v)}`);
  }
  if (s.units !== 'mm') pairs.push(`_u=${s.units}`);
  if (s.sheet.w !== DEFAULT_SHEET.w || s.sheet.h !== DEFAULT_SHEET.h) pairs.push(`_sheet=${s.sheet.w}x${s.sheet.h}`);
  return `${URL_VERSION}/${g.id}${pairs.length ? `/${pairs.join(';')}` : ''}`;
}

/** Parse one value for `d`; returns the value to use and whether it had to be adjusted. */
function parseValue(d: ParamDef, raw: string): { value: ParamValue; adjusted: boolean } {
  switch (d.kind) {
    case 'number':
    case 'int': {
      const n = raw.trim() === '' ? NaN : Number(raw);
      if (!Number.isFinite(n)) return { value: d.default, adjusted: true };
      let v = d.kind === 'int' ? Math.round(n) : n;
      v = Math.min(Math.max(v, d.min), d.max);
      return { value: v, adjusted: v !== n };
    }
    case 'bool':
      if (raw === '1' || raw === 'true') return { value: true, adjusted: false };
      if (raw === '0' || raw === 'false') return { value: false, adjusted: false };
      return { value: d.default, adjusted: true };
    case 'enum':
      return d.options.includes(raw) ? { value: raw, adjusted: false } : { value: d.default, adjusted: true };
    case 'text': {
      const ok = raw.length <= d.maxLength && (d.pattern === undefined || new RegExp(`^(?:${d.pattern})$`).test(raw));
      return ok ? { value: raw, adjusted: false } : { value: d.default, adjusted: true };
    }
  }
}

function parseSheet(raw: string): Sheet | null {
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(raw);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w >= SHEET_RANGE.min && h >= SHEET_RANGE.min && w <= SHEET_RANGE.max && h <= SHEET_RANGE.max ? { w, h } : null;
}

const MAX_LISTED = 5;
const list = (keys: string[]): string => {
  const shown = keys.slice(0, MAX_LISTED).map((k) => `“${k}”`).join(', ');
  return keys.length > MAX_LISTED ? `${shown} and ${keys.length - MAX_LISTED} more` : shown;
};

export function decodeState(hash: string): DecodedState {
  const base = defaultState();
  const fallback = (notice: string): DecodedState => ({ ...base, notice });
  try {
    const body = hash.replace(/^#/, '');
    if (body === '' || body === '/') return base;
    const [version, genId, rest = '', ...extra] = body.split('/');
    if (version !== URL_VERSION) {
      return /^v\d+$/.test(version ?? '')
        ? fallback(`This link comes from another version of KerfLab (${version}); the default design is shown instead.`)
        : fallback('That link isn’t a KerfLab design, so the default design is shown.');
    }
    const g = genId ? getGenerator(genId) : undefined;
    if (!g) return fallback(genId ? `There is no “${genId.slice(0, 40)}” generator; showing ${registry[0]!.name} instead.` : 'That link has no design in it; showing the default.');

    const params: Params = defaults(g.schema);
    const byKey = new Map(g.schema.map((d) => [d.key, d]));
    const adjusted: string[] = [];
    const unknown: string[] = [];
    let units = base.units;
    let unitsInLink = false;
    let sheet = base.sheet;
    const segments = [rest, ...extra].join('/').split(';').filter(Boolean);
    for (const seg of segments) {
      const i = seg.indexOf('=');
      const key = decodeURIComponent(i < 0 ? seg : seg.slice(0, i));
      const raw = decodeURIComponent(i < 0 ? '' : seg.slice(i + 1));
      if (key === '_u') {
        if (raw === 'mm' || raw === 'in') {
          units = raw;
          unitsInLink = true;
        } else adjusted.push('units');
        continue;
      }
      if (key === '_sheet') {
        const s = parseSheet(raw);
        if (s) sheet = s;
        else adjusted.push('sheet size');
        continue;
      }
      const d = byKey.get(key);
      if (!d || key === 'units') {
        unknown.push(key.slice(0, 24));
        continue;
      }
      const r = parseValue(d, raw);
      params[key] = r.value;
      if (r.adjusted) adjusted.push(d.key);
    }
    if ('units' in params) params.units = units;
    if (!validate(g.schema, params).ok) return fallback('That link’s settings didn’t make sense together; showing the defaults.');

    const notes: string[] = [];
    if (adjusted.length) notes.push(`Adjusted ${list(adjusted)} to the nearest valid value.`);
    if (unknown.length) notes.push(`Ignored unknown setting${unknown.length > 1 ? 's' : ''} ${list(unknown)}.`);
    const state: DecodedState = { ...base, generatorId: g.id, params, units, sheet };
    if (unitsInLink) state.unitsInLink = true;
    if (notes.length) state.notice = `Link partly loaded: ${notes.join(' ')}`;
    return state;
  } catch {
    return fallback('That link couldn’t be read, so the default design is shown.');
  }
}
