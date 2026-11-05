/**
 * Shelf nesting of part bounding boxes (0/90 degree rotations, uniform gap). With a bounded sheet,
 * parts keep `edge` (default SHEET_EDGE) clear of every sheet edge, a full sheet continues on a
 * new one, and `unfit` holds only parts larger than the usable area (the sheet less its margins).
 */
import { orientedSize, type Layout, type PlacedPart, type Rot } from './layout';
import type { Part } from '../../core/part';
import { SHEET_EDGE } from '../profiles';

export type { Layout, PlacedPart } from './layout';

type Shelf = { y: number; h: number; x: number };
type Cand = { cost: number; x: number; y: number; rot: Rot; shelf: Shelf | null; w: number; h: number };
type Orient = { rot: Rot; w: number; h: number };

const EPS = 1e-9;

export function nest(parts: Part[], sheet: { w: number; h: number } | null, gap: number, edge = SHEET_EDGE): Layout {
  const g = Math.max(0, gap);
  const m = sheet ? Math.max(0, edge) : 0; // margin round a bounded sheet; placements are offset by it
  const items = parts.map((part) => ({ part, o: ([0, 90] as Rot[]).map((rot): Orient => ({ rot, ...orientedSize(part, rot) })) }));
  const maxH = (it: (typeof items)[number]): number => Math.max(...it.o.map((v) => v.h));
  items.sort((a, b) => maxH(b) - maxH(a));

  const W = sheet
    ? Math.max(0, sheet.w - 2 * m)
    : Math.max(
        ...items.flatMap((it) => it.o.map((v) => v.w)),
        Math.ceil(Math.sqrt(items.reduce((s, it) => s + (it.o[0]!.w + g) * (it.o[0]!.h + g), 0) * 1.25)),
        0,
      );
  const H = sheet ? Math.max(0, sheet.h - 2 * m) : Infinity;

  /** Best position for the part on one sheet's shelves, or null when it does not fit there. */
  const tryShelves = (shelves: Shelf[], o: Orient[]): Cand | null => {
    let best: Cand | null = null;
    for (const v of o) {
      if (v.w > W + EPS || v.h > H + EPS) continue;
      shelves.forEach((s, i) => {
        const last = i === shelves.length - 1;
        if (s.x + v.w > W + EPS) return;
        if (v.h > s.h + EPS && !(last && s.y + v.h <= H + EPS)) return;
        const cost = (s.y + Math.max(s.h, v.h)) * 1e6 + (W - (s.x + v.w)); // lowest, then tightest
        if (!best || cost < best.cost) best = { cost, x: s.x, y: s.y, rot: v.rot, shelf: s, w: v.w, h: v.h };
      });
      const lastShelf = shelves[shelves.length - 1];
      const top = lastShelf ? lastShelf.y + lastShelf.h + g : 0;
      if (top + v.h <= H + EPS) {
        const cost = (top + v.h) * 1e6 + 1e5 + (W - v.w); // opening a shelf is worse than reuse at equal height
        if (!best || cost < best.cost) best = { cost, x: 0, y: top, rot: v.rot, shelf: null, w: v.w, h: v.h };
      }
    }
    return best;
  };

  const sheets: Shelf[][] = [];
  const placed: PlacedPart[] = [];
  const unfit: string[] = [];
  let usedW = 0;
  let usedH = 0;

  for (const it of items) {
    if (!it.o.some((v) => v.w <= W + EPS && v.h <= H + EPS)) {
      unfit.push(it.part.id);
      continue;
    }
    let si = 0;
    let b: Cand | null = null;
    for (; si < sheets.length && !(b = tryShelves(sheets[si]!, it.o)); si++);
    if (!b) {
      sheets.push([]);
      si = sheets.length - 1;
      b = tryShelves(sheets[si]!, it.o)!; // fits an empty sheet: checked above
    }
    const shelves = sheets[si]!;
    if (b.shelf) {
      b.shelf.x = b.x + b.w + g;
      b.shelf.h = Math.max(b.shelf.h, b.h);
    } else shelves.push({ y: b.y, h: b.h, x: b.w + g });
    placed.push({ part: it.part, x: b.x + m, y: b.y + m, rot: b.rot, sheet: si });
    usedW = Math.max(usedW, b.x + b.w);
    usedH = Math.max(usedH, b.y + b.h);
  }
  return {
    placed,
    unfit,
    sheet: sheet ? { w: sheet.w, h: sheet.h } : { w: usedW, h: usedH },
    sheets: sheets.length,
  };
}
