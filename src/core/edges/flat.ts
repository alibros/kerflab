import type { Edge } from './types';

/** Plain straight edge (boxes.py 'e'). Mates with another flat edge (butt joint, glue or external fasteners). */
export const flatEdge: Edge = (t, length) => t.forward(length);
