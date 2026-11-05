import type { Edge } from './types';

/**
 * Crossing-slot joint (boxes.py SlottedEdge `slots`, egg-crate / half-lap): two plates that cross
 * each other, each with a slot one thickness wide cut halfway in from opposite edges, or a divider
 * tab resting in a slot cut into the top of a wall. The slots are drawn by the generator as part
 * of the plates' outlines; this edge type only names the joint in the parts' metadata (as a joint
 * line along the two plates' common vertical line where the slots meet). Drawn as a straight line.
 * Self-complementary, and unlike 'flat' it must be mated.
 */
export const crossSlotEdge: Edge = (t, length) => t.forward(length);
