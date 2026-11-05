import { checkEdge } from './check';
import type { Edge } from './types';

/**
 * Rounded edge: straight edge whose middle bulges outward (right of travel) as a circular segment
 * (60 degree half-angle) with chord min(length/2, 4*thickness). The bulge starts and ends on the
 * edge line, so net displacement is exactly `length`. Cosmetic only, with no distinct counterpart:
 * complement(rounded) = 'rounded' (self-complementary, see index).
 */
export const roundedEdge: Edge = (t, length, ctx) => {
  checkEdge(length, ctx, 'rounded edge');
  const chord = Math.min(length / 2, 4 * ctx.thickness);
  const theta = 60;
  const r = chord / (2 * Math.sin((theta * Math.PI) / 180));
  const m = (length - chord) / 2;
  t.forward(m);
  t.turn(-theta); t.arc(r, 2 * theta); t.turn(-theta);
  t.forward(m);
};
