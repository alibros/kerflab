/** Shared 2D layout types and the part-to-sheet transform used by nesting and export. */
import { bounds, mat3Multiply, mat3Rotate, mat3Translate, type Mat3 } from '../../core/geometry';
import type { Part } from '../../core/part';

export type Rot = 0 | 90;
export type PlacedPart = {
  part: Part;
  /** Lower-left corner of the placed part's bounding box on the sheet (mm, y up). */
  x: number;
  y: number;
  rot: Rot;
  /** 0-based sheet index (always 0 on an unbounded sheet). */
  sheet: number;
};
export type Layout = {
  placed: PlacedPart[];
  /** Ids of parts larger than the usable sheet (less its SHEET_EDGE margins) in both rotations: never placed. */
  unfit: string[];
  /** Sheet size, or the used extent when nesting onto an unbounded sheet. */
  sheet: { w: number; h: number };
  /** Number of sheets used (a bounded sheet that fills continues on a new one); 0 when nothing is placed. */
  sheets: number;
};

/** Fixed, packer-independent arrangement: one row, rot 0, `gap` apart, on one sheet sized to fit. For snapshots. */
export function rowLayout(parts: Part[], gap: number): Layout {
  let x = 0;
  let h = 0;
  const placed: PlacedPart[] = parts.map((part) => {
    const s = orientedSize(part, 0);
    const p: PlacedPart = { part, x, y: 0, rot: 0, sheet: 0 };
    x += s.w + gap;
    h = Math.max(h, s.h);
    return p;
  });
  return { placed, unfit: [], sheet: { w: Math.max(0, x - gap), h }, sheets: placed.length ? 1 : 0 };
}

/**
 * Part-local 2D is viewed from INSIDE the box; exports show the OUTER face, so x is mirrored.
 * Then the optional 90 degree turn.
 */
const orient = (rot: Rot): Mat3 => mat3Multiply(rot === 90 ? mat3Rotate(90) : [1, 0, 0, 0, 1, 0, 0, 0, 1], [-1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Bounding box (of the kerfed outline) of a part after mirroring and rotation. */
export function orientedSize(part: Part, rot: Rot): { w: number; h: number } {
  const b = bounds(part.outline);
  const w = b.max.x - b.min.x;
  const h = b.max.y - b.min.y;
  return rot === 90 ? { w: h, h: w } : { w, h };
}

export const placedSize = (p: PlacedPart): { w: number; h: number } => orientedSize(p.part, p.rot);

/** Matrix taking part-local coordinates to sheet coordinates (y up, mm). */
export function placeMatrix(p: PlacedPart): Mat3 {
  const o = orient(p.rot);
  const b = bounds(p.part.outline);
  const corners = [b.min, b.max, { x: b.min.x, y: b.max.y }, { x: b.max.x, y: b.min.y }].map((c) => ({
    x: o[0] * c.x + o[1] * c.y,
    y: o[3] * c.x + o[4] * c.y,
  }));
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  return mat3Multiply(mat3Translate(p.x - minX, p.y - minY), o);
}
