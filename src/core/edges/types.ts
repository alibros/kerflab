import type { Turtle } from '../turtle';

/**
 * Joint settings shared by all edges. All lengths are absolute millimetres (boxes.py stores
 * finger/space/play as multiples of thickness; callers scale them before building a ctx).
 */
export interface EdgeCtx {
  /** Material thickness; also the finger depth for 90 degree joints. */
  thickness: number;
  /**
   * Laser kerf (full cut width). Edges and holes are drawn at NOMINAL size and ignore this;
   * compensation happens once per finished part (outer contour offset +kerf/2, holes -kerf/2).
   */
  kerf: number;
  /** Nominal finger width. */
  finger: number;
  /** Nominal space between fingers. */
  space: number;
  /** Margin at each end, in multiples of `space` (boxes.py `surroundingspaces`). */
  surroundingSpaces: number;
  /** Total clearance per finger: notches/slots are `play` wider than the finger (play/2 per side). */
  play: number;
  /**
   * Corner turn (degrees, exterior angle between the two walls' directions) for the angled finger
   * edges ('angledFinger' / 'angledFingerHole'); default 90. Ignored by every other edge.
   */
  angle?: number;
}

/**
 * Draws an edge of `length` from the turtle's current pose. Convention: the part lies to the LEFT
 * of travel (outlines are CCW); the turtle must end at start + length along the start heading,
 * with the same heading, exactly like a plain `forward(length)`.
 */
export type Edge = (t: Turtle, length: number, ctx: EdgeCtx) => void;
