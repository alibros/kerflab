import { checkEdge } from './check';
import type { Edge } from './types';

/**
 * Slot edge: a rectangular notch cut into the part (left of travel), depth thickness + play,
 * width length - 2*thickness + play (centred), receiving a hinge tab. Mating partner: `hingeEdge`.
 */
export const slotEdge: Edge = (t, length, ctx) => {
  checkEdge(length, ctx, 'slot');
  const w = length - 2 * ctx.thickness + ctx.play;
  const d = ctx.thickness + ctx.play;
  const m = (length - w) / 2;
  t.forward(m);
  t.turn(90); t.forward(d); t.turn(-90);
  t.forward(w);
  t.turn(-90); t.forward(d); t.turn(90);
  t.forward(m);
};
