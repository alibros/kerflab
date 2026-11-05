import { checkEdge } from './check';
import type { Edge, EdgeCtx } from './types';

/** Period of the flex pattern: one notch (width thickness) plus one tooth (width thickness). */
export function flexPeriod(ctx: EdgeCtx): number {
  return 2 * ctx.thickness;
}

/**
 * Flex edge: a row of rectangular relief notches (width thickness, depth thickness/2, left of
 * travel) repeated with period 2*thickness, whole periods only, remainder split between the ends.
 * Self-complementary.
 */
export const flexEdge: Edge = (t, length, ctx) => {
  checkEdge(length, ctx, 'flex edge');
  const th = ctx.thickness;
  const n = Math.floor(length / flexPeriod(ctx));
  const m = (length - n * flexPeriod(ctx)) / 2;
  t.forward(m + th / 2);
  for (let i = 0; i < n; i++) {
    if (i !== 0) t.forward(th);
    t.turn(90); t.forward(th / 2); t.turn(-90);
    t.forward(th);
    t.turn(-90); t.forward(th / 2); t.turn(90);
  }
  t.forward(th / 2 + m);
};
