import type { Edge } from './types';

/**
 * Mitre edge (boxes.py 'm'): geometrically a straight edge; the 45 degree bevel is applied when
 * cutting, not in the 2D outline. Mates with another mitre edge (self-complementary).
 */
export const mitreEdge: Edge = (t, length) => t.forward(length);
