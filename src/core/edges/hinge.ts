import { checkEdge } from './check';
import type { Edge } from './types';

/**
 * Hinge edge: one knuckle tab of height `thickness` protruding right, width length - 2*thickness,
 * with both outer corners rounded (radius thickness/2) so it can pivot in the matching slot.
 * Mating partner: `slotEdge` (complement(hinge) = slot).
 */
export const hingeEdge: Edge = (t, length, ctx) => {
  checkEdge(length, ctx, 'hinge');
  const h = ctx.thickness;
  const m = h;
  const w = length - 2 * m;
  const r = Math.min(h / 2, w / 2);
  t.forward(m);
  t.turn(-90); t.forward(h - r);
  t.arc(r, 90); t.forward(w - 2 * r); t.arc(r, 90);
  t.forward(h - r); t.turn(-90);
  t.forward(m);
};
