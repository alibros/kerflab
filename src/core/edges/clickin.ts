import { checkEdge } from './check';
import type { Edge } from './types';

/**
 * Click-in edge (cf. boxes.py ClickConnector): a centred snap tab of height `thickness`
 * protruding right, base width length - 2*thickness, tapering by thickness/4 per side so it
 * snaps into a matching opening. Mating partner: `clickinHoleEdge`.
 */
export const clickinEdge: Edge = (t, length, ctx) => {
  checkEdge(length, ctx, 'click-in');
  const h = ctx.thickness;
  const taper = h / 4;
  const w = length - 2 * h;
  const a = (Math.atan2(-h, taper) * 180) / Math.PI;
  const side = Math.hypot(h, taper);
  t.forward(h);
  t.turn(a); t.forward(side); t.turn(-a);
  t.forward(w - 2 * taper);
  t.turn(-a); t.forward(side); t.turn(a);
  t.forward(h);
};

/**
 * Opening for `clickinEdge`: a trapezoidal notch cut into the part (left of travel), mouth width
 * length - 2*thickness + play, depth thickness + play, same taper per side, so the tab fits with
 * play/2 clearance per side at the base. complement(clickinHole) = clickin.
 */
export const clickinHoleEdge: Edge = (t, length, ctx) => {
  checkEdge(length, ctx, 'click-in hole');
  const h = ctx.thickness;
  const taper = h / 4;
  const w = length - 2 * h + ctx.play;
  const d = h + ctx.play;
  const b = (Math.atan2(d, taper) * 180) / Math.PI;
  const side = Math.hypot(d, taper);
  t.forward((length - w) / 2);
  t.turn(b); t.forward(side); t.turn(-b);
  t.forward(w - 2 * taper);
  t.turn(-b); t.forward(side); t.turn(b);
  t.forward((length - w) / 2);
};
