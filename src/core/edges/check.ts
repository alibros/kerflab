import { ParamError } from '../validate';
import type { EdgeCtx } from './types';

/** Shared argument validation for the simple edges: finite inputs, thickness > 0, length >= 3*thickness. */
export function checkEdge(length: number, ctx: EdgeCtx, what: string): void {
  if (!Number.isFinite(length)) throw new ParamError(`length must be a finite number, got ${String(length)}`);
  if (!Number.isFinite(ctx.thickness) || ctx.thickness <= 0) throw new ParamError('thickness must be > 0');
  if (!Number.isFinite(ctx.play) || ctx.play < 0) throw new ParamError('play must be >= 0');
  if (length < 3 * ctx.thickness) throw new ParamError(`too short for ${what}`);
}
