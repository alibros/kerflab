/**
 * Build pipeline for the UI: validate -> generator.build -> nest, with every failure turned into a
 * message (and the param to blame, when known) instead of an exception.
 */
import type { Path } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { validate, type Params } from '../core/schema';
import { ParamError } from '../core/validate';
import { nest, type Layout } from './export/nest';
import type { Sheet } from './store';

export type BuildResult =
  | { ok: true; parts: Part[]; layout: Layout }
  | { ok: false; message: string; param?: string };

/** Spacing between nested parts, mm. */
export const NEST_GAP = 4;

function blame(g: Generator, e: ParamError): string | undefined {
  if (e.param && g.schema.some((d) => d.key === e.param)) return e.param;
  const first = /^(\w+)/.exec(e.message)?.[1];
  return g.schema.find((d) => d.key === first)?.key;
}

/** Generator messages name params by key ("x too small: inner x is…"); show the label instead. */
function humanize(g: Generator, message: string, param: string): string {
  const label = g.schema.find((d) => d.key === param)?.label;
  if (!label) return message;
  const esc = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return message
    .replace(new RegExp(`^${esc}\\b`), label)
    .replace(new RegExp(`\\b(inner|outer) ${esc}\\b`, 'g'), `$1 ${label.toLowerCase()}`)
    .replace(/ \* /g, ' × ');
}

export function runBuild(g: Generator, params: Params, sheet: Sheet | null): BuildResult {
  const v = validate(g.schema, params);
  if (!v.ok) {
    const [param, message] = Object.entries(v.errors)[0] ?? ['*', 'invalid settings'];
    const label = g.schema.find((d) => d.key === param)?.label ?? param;
    return param === '*' ? { ok: false, message } : { ok: false, message: `${label} ${message}`, param };
  }
  try {
    const parts = g.build(v.params);
    return { ok: true, parts, layout: nest(parts, sheet, NEST_GAP) };
  } catch (e) {
    if (e instanceof ParamError) {
      const param = blame(g, e);
      return param ? { ok: false, message: humanize(g, e.message, param), param } : { ok: false, message: e.message };
    }
    return { ok: false, message: `Couldn’t build this design: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Total length (mm) of the given paths; arcs measured exactly. */
export function cutLength(paths: Path[]): number {
  let total = 0;
  for (const p of paths) {
    let cur = p.start;
    for (const s of p.segs) {
      if (s.t === 'L') total += Math.hypot(s.to.x - cur.x, s.to.y - cur.y);
      else {
        const r = Math.hypot(cur.x - s.c.x, cur.y - s.c.y);
        const a0 = Math.atan2(cur.y - s.c.y, cur.x - s.c.x);
        const a1 = Math.atan2(s.to.y - s.c.y, s.to.x - s.c.x);
        let sw = s.ccw ? a1 - a0 : a0 - a1;
        sw = ((sw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (sw < 1e-9) sw = 2 * Math.PI;
        total += r * sw;
      }
      cur = s.to;
    }
  }
  return total;
}

/** Cut length of every part's outline and holes. */
export const partsCutLength = (parts: Part[]): number => cutLength(parts.flatMap((p) => [p.outline, ...p.holes]));
