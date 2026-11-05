/**
 * Parameter schemas: every generator declares its inputs as a `Schema`; the UI form, URL state,
 * validation and the fuzz harness are all derived from it.
 */
import type { EdgeCtx } from './edges/types';

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

export type ParamDef = { key: string; label: string; help: string; unit?: 'mm' | 'deg' | ''; group: string }
  & ({ kind: 'number'; min: number; max: number; default: number; step: number }
   | { kind: 'int'; min: number; max: number; default: number }
   | { kind: 'bool'; default: boolean }
   | { kind: 'enum'; options: string[]; default: string }
   /**
    * Free text, e.g. a comma-separated list of sizes. `pattern` (a regular expression source,
    * matched against the whole value) restricts the accepted text; the generator still parses it
    * and throws ParamError naming the key for values it cannot use. `examples` are valid values
    * the fuzz harness draws from (it cannot invent text for an arbitrary grammar).
    */
   | { kind: 'text'; default: string; maxLength: number; pattern?: string; examples: string[] });
export type Schema = ParamDef[];

export type ValidateResult = { ok: true; params: Params } | { ok: false; errors: Record<string, string> };

/** Error message for one value, or undefined when it is valid for `d`. */
function checkValue(d: ParamDef, v: unknown): string | undefined {
  switch (d.kind) {
    case 'number':
    case 'int':
      if (typeof v !== 'number') return `must be a number, got ${typeof v}`;
      if (!Number.isFinite(v)) return `must be a finite number, got ${String(v)}`;
      if (d.kind === 'int' && !Number.isInteger(v)) return `must be an integer, got ${v}`;
      if (v < d.min || v > d.max) return `must be between ${d.min} and ${d.max}, got ${v}`;
      return undefined;
    case 'bool':
      return typeof v === 'boolean' ? undefined : `must be true or false, got ${typeof v}`;
    case 'enum':
      return typeof v === 'string' && d.options.includes(v)
        ? undefined : `must be one of: ${d.options.join(', ')}, got ${String(v)}`;
    case 'text':
      if (typeof v !== 'string') return `must be text, got ${typeof v}`;
      if (v.length > d.maxLength) return `must be at most ${d.maxLength} characters`;
      if (d.pattern !== undefined && !new RegExp(`^(?:${d.pattern})$`).test(v)) return `has an invalid format: "${v}"`;
      return undefined;
  }
}

/** Throws on a malformed schema (duplicate keys, empty enum, min > max, default out of range). */
function checkSchema(s: Schema): void {
  const seen = new Set<string>();
  for (const d of s) {
    if (!d.key || d.key === '*') throw new Error(`schema: invalid key "${d.key}"`);
    if (seen.has(d.key)) throw new Error(`schema: duplicate key "${d.key}"`);
    seen.add(d.key);
    if ((d.kind === 'number' || d.kind === 'int') && !(d.min <= d.max)) throw new Error(`schema: ${d.key} has min > max`);
    if (d.kind === 'number' && !(d.step > 0)) throw new Error(`schema: ${d.key} needs step > 0`);
    if (d.kind === 'enum' && d.options.length === 0) throw new Error(`schema: ${d.key} has no options`);
    if (d.kind === 'text') {
      if (!(Number.isInteger(d.maxLength) && d.maxLength > 0)) throw new Error(`schema: ${d.key} needs maxLength > 0`);
      if (d.examples.length === 0) throw new Error(`schema: ${d.key} needs at least one example`);
      for (const x of d.examples) if (checkValue(d, x)) throw new Error(`schema: example "${x}" of ${d.key} ${checkValue(d, x)}`);
    }
    const e = checkValue(d, d.default);
    if (e) throw new Error(`schema: default of ${d.key} ${e}`);
  }
}

/** Default value for every key. Throws when the schema itself is malformed. */
export function defaults(s: Schema): Params {
  checkSchema(s);
  const out: Params = {};
  for (const d of s) out[d.key] = d.default;
  return out;
}

/**
 * Strict validation: every schema key must be present with the right type and range; unknown keys
 * are rejected. Errors are keyed by parameter (`'*'` for a non-object input). On success returns a
 * fresh object holding exactly the schema keys. Callers that accept partial input (URL state,
 * presets) merge with `defaults(s)` first.
 */
export function validate(s: Schema, p: unknown): ValidateResult {
  checkSchema(s);
  if (typeof p !== 'object' || p === null || Array.isArray(p))
    return { ok: false, errors: { '*': 'params must be an object' } };
  const input = p as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const params: Params = {};
  for (const d of s) {
    if (!Object.prototype.hasOwnProperty.call(input, d.key)) {
      errors[d.key] = 'required';
      continue;
    }
    const v = input[d.key];
    const e = checkValue(d, v);
    if (e) errors[d.key] = e;
    else params[d.key] = v as ParamValue;
  }
  const keys = new Set(s.map((d) => d.key));
  for (const k of Object.keys(input)) if (!keys.has(k)) errors[k] = 'unknown parameter';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, params };
}

/**
 * Parameters shared by every generator. Lengths are millimetres; finger, space and play are
 * multiples of `thickness` (boxes.py convention). `burn` switches kerf compensation on/off (when
 * off, parts are cut at nominal size, e.g. when the laser software compensates). `units` only
 * affects display/export; all geometry is computed in millimetres.
 */
export const commonParams: Schema = [
  { key: 'thickness', label: 'Thickness', help: 'Material thickness', unit: 'mm', group: 'Material',
    kind: 'number', min: 0.5, max: 20, default: 3, step: 0.1 },
  { key: 'kerf', label: 'Kerf', help: 'Laser cut width (full beam width)', unit: 'mm', group: 'Material',
    kind: 'number', min: 0, max: 0.5, default: 0.1, step: 0.01 },
  { key: 'burn', label: 'Kerf compensation', help: 'Offset outlines by +kerf/2 and holes by -kerf/2 so parts come out at nominal size',
    group: 'Material', kind: 'bool', default: true },
  { key: 'finger', label: 'Finger width', help: 'Finger width in multiples of thickness', unit: '', group: 'Joints',
    kind: 'number', min: 1, max: 5, default: 2, step: 0.1 },
  { key: 'space', label: 'Space width', help: 'Space between fingers in multiples of thickness', unit: '', group: 'Joints',
    kind: 'number', min: 1, max: 5, default: 2, step: 0.1 },
  { key: 'play', label: 'Play', help: 'Extra clearance per joint in multiples of thickness', unit: '', group: 'Joints',
    kind: 'number', min: 0, max: 0.5, default: 0, step: 0.01 },
  { key: 'units', label: 'Units', help: 'Display and export units (geometry is always mm)', group: 'Output',
    kind: 'enum', options: ['mm', 'in'], default: 'mm' },
];

const num = (p: Params, k: string): number => {
  const v = p[k];
  if (typeof v !== 'number') throw new Error(`param ${k} must be a number`);
  return v;
};

/** Kerf the part builder must apply: `kerf` when `burn` is on (or absent), else 0. */
export function effectiveKerf(p: Params): number {
  return p.burn === false ? 0 : num(p, 'kerf');
}

/** Absolute-millimetre edge settings from validated common params (surroundingSpaces fixed at 2). */
export function edgeCtx(p: Params): EdgeCtx {
  const t = num(p, 'thickness');
  return {
    thickness: t,
    kerf: effectiveKerf(p),
    finger: num(p, 'finger') * t,
    space: num(p, 'space') * t,
    play: num(p, 'play') * t,
    surroundingSpaces: 2,
  };
}
