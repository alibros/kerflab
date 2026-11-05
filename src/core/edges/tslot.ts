import { checkEdge } from './check';
import type { Edge, EdgeCtx } from './types';

/**
 * T-slot edge (cf. boxes.py TSlot / bolt slots): a centred T-shaped notch cut into the part (left
 * of travel). A bolt neck of width `thickness` and depth `thickness` leads to a nut pocket of width
 * 2*thickness and depth `thickness`. Nominal size; mating partner: `tslotHoleEdge`.
 */
export const tslotEdge: Edge = (t, length, ctx) => drawT(t, length, ctx, 0);

/**
 * Opening counterpart of `tslotEdge` (the cut-out for the nut and bolt in the mating part): the
 * same T notch with neck width thickness + play and pocket width 2*thickness + play (play/2
 * clearance per side), same depth 2*thickness. complement(tslot) = tslotHole and vice versa.
 */
export const tslotHoleEdge: Edge = (t, length, ctx) => drawT(t, length, ctx, ctx.play);

function drawT(t: Parameters<Edge>[0], length: number, ctx: EdgeCtx, p: number): void {
  checkEdge(length, ctx, 'T-slot');
  const th = ctx.thickness;
  const nw = th + p;
  const ww = 2 * th + p;
  const e = (ww - nw) / 2;
  t.forward((length - nw) / 2);
  t.turn(90); t.forward(th); // up the neck
  t.turn(90); t.forward(e); // widen west
  t.turn(-90); t.forward(th); // pocket wall
  t.turn(-90); t.forward(ww); // pocket top
  t.turn(-90); t.forward(th);
  t.turn(-90); t.forward(e); // narrow back to neck
  t.turn(90); t.forward(th); // down the neck
  t.turn(90);
  t.forward((length - nw) / 2);
}
