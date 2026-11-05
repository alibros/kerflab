/**
 * FlexBox5: a box with two round ends of (possibly) different diameters, ported from boxes.py
 * (florianfesti/boxes, boxes/generators/flexbox5.py, FlexBox5). ONE living-hinge wall wraps two
 * side plates whose profile is the hull of two circles (radii r1 = top_diameter / 2,
 * r2 = bottom_diameter / 2, centres d_c = x - r1 - r2 apart) standing on their common tangent.
 *
 * Side profile, CCW from the tangent point under circle 2: finger (l) along the bottom tangent,
 * arc (r1, 180 + 2a), latch bump (latch) + finger (l - latch) along the upper tangent, arc
 * (r2, 180 - 2a); a = asin((r1 - r2) / d_c), l = d_c cos a. The wall starts after the latch:
 * fingerHole (l - latch), hinge (r2), fingerHole (l), hinge (r1), latch flap.
 *
 * World frame: profile in world X (along the bottom tangent) and Z (up); the plates are h apart
 * along world Y. Outer size: the hull of the two disks plus t all round, (h + 2t) deep; (r2 + l + r1 + 2t) long
 * when neither disk overhangs the other.
 *
 * Deliberate differences from boxes.py: x is raised (as boxes.py does) so the straight parts
 * keep 3 * thickness of fingers beside the latch; latch grip plain; flex strips shortened by
 * `stretch`.
 */
import { edgeFor } from '../core/edges';
import type { Vec2 } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { flexParams, flexSettings, flexWall, latchBump, mirrorWall, requireFlexArc } from './flexwall';
import { at, finishPanels, num, requireJointLength, type PanelSpec, type Wall, type WallLine } from './walls';

const schema: Schema = [
  { key: 'x', label: 'Length', help: 'Length along the line through both round ends (raised when the ends need more room)', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 1000, default: 150, step: 1 },
  { key: 'h', label: 'Depth', help: 'Distance between the two side plates', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 1000, default: 60, step: 1 },
  { key: 'top_diameter', label: 'Top diameter', help: 'Diameter of the round end at the latch', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 400, default: 60, step: 1 },
  { key: 'bottom_diameter', label: 'Bottom diameter', help: 'Diameter of the other round end', unit: 'mm',
    group: 'Size', kind: 'number', min: 10, max: 400, default: 60, step: 1 },
  { key: 'inside', label: 'Inner dimensions', help: 'On: sizes are the inside of the box. Off: they are the outside',
    group: 'Size', kind: 'bool', default: true },
  { key: 'latchsize', label: 'Latch', help: 'Length of the latch (door flap) in multiples of thickness', unit: '',
    group: 'Box', kind: 'number', min: 2, max: 20, default: 8, step: 0.5 },
  ...flexParams,
  ...commonParams,
];

type Geo = { r1: number; r2: number; h: number; L: number; dc: number; a: number; l: number };

function geometry(p: Params): Geo {
  const t = num(p, 'thickness');
  const d = p.inside === false ? 2 * t : 0;
  const r1 = (num(p, 'top_diameter') - d) / 2;
  const r2 = (num(p, 'bottom_diameter') - d) / 2;
  const L = num(p, 'latchsize') * t;
  // Centre distance: from x, raised so the upper tangent keeps latch + 3t (boxes.py raises x too).
  const dc = Math.max(num(p, 'x') - d - r1 - r2, Math.hypot(L + 3 * t, r1 - r2));
  const a = Math.asin((r1 - r2) / dc);
  return { r1, r2, h: num(p, 'h') - d, L, dc, a, l: dc * Math.cos(a) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const g = geometry(p);
  // The profile is the hull of both circles (centres (0, r2) and (l, r1)): it spans both disks.
  return { x: Math.max(g.r2, g.l + g.r1) - Math.min(-g.r2, g.l - g.r1) + 2 * t, y: g.h + 2 * t, z: 2 * Math.max(g.r1, g.r2) + 2 * t };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const fs = flexSettings(p);
  const g = geometry(p);
  const { r1, r2, h, L, l } = g;
  const a1 = 180 + (2 * g.a * 180) / Math.PI;
  const a2 = 180 - (2 * g.a * 180) / Math.PI;
  requireJointLength('h', h, t);
  requireFlexArc('top_diameter', r1, a1, fs, t);
  requireFlexArc('bottom_diameter', r2, a2, fs, t);

  // Side profile; joint lines one thickness out (right of travel) along the straight runs.
  const tt = new Turtle({ x: 0, y: 0 });
  const lines: WallLine[] = [];
  const run = (side: number, len: number): void => {
    const p0 = tt.pos;
    const hd = (tt.heading * Math.PI) / 180;
    edgeFor('finger')(tt, len, ctx);
    const o: Vec2 = { x: t * Math.sin(hd), y: -t * Math.cos(hd) };
    lines.push({ side, type: 'finger', from: { x: p0.x + o.x, y: p0.y + o.y }, to: { x: tt.pos.x + o.x, y: tt.pos.y + o.y } });
  };
  run(0, l);
  tt.arc(r1, a1);
  latchBump(tt, L, t);
  const q = tt.pos; // wall start (profile, inner face)
  const qh = (tt.heading * Math.PI) / 180;
  run(1, l - L);
  tt.arc(r2, a2);
  const side: Wall = { outline: tt.toPath(true), holes: [], lines };

  const wall = flexWall([
    { kind: 'flat', length: l - L, edge: 'fingerHole' }, { kind: 'arc', angle: a2, r: r2 },
    { kind: 'flat', length: l, edge: 'fingerHole' }, { kind: 'arc', angle: a1, r: r1 },
    { kind: 'latch', length: L },
  ], h, ['flat', 'flat'], ctx, fs);
  // World: X = profile x + r2 + t, Z = profile y + t.
  const ox = r2 + t;
  const u: [number, number, number] = [Math.cos(qh), 0, Math.sin(qh)];
  const start: [number, number, number] = [ox + q.x + t * Math.sin(qh), t, t + q.y - t * Math.cos(qh)];
  const wallMates: PanelSpec['mates'] = [];
  wallMates[0] = ['front', 1]; wallMates[100] = ['back', 1];
  wallMates[2] = ['front', 0]; wallMates[102] = ['back', 0];
  const panels: PanelSpec[] = [
    { id: 'wall', name: 'Flex wall', ...wall, placement: at(start, u, [0, 1, 0]), mates: wallMates },
    { id: 'back', name: 'Back side', ...side, placement: at([ox, h + 2 * t, t], [1, 0, 0], [0, 0, 1]), mates: [['wall', 102], ['wall', 100]] },
    { id: 'front', name: 'Front side', ...mirrorWall(side, 0), placement: at([ox, 0, t], [-1, 0, 0], [0, 0, 1]), mates: [['wall', 2], ['wall', 0]] },
  ];
  return finishPanels(panels, t, effectiveKerf(p));
}

export const flexBox5: Generator = {
  id: 'flexbox5',
  name: 'Flex box (round ends)',
  category: 'Flex',
  description: 'Box with two round ends of different diameters: one living-hinge wall wraps two side plates, closed by a latched flap.',
  schema,
  presets: {
    Pencil: { x: 200, h: 50, top_diameter: 50, bottom_diameter: 50, inside: true },
    Teardrop: { x: 160, h: 70, top_diameter: 90, bottom_diameter: 40, inside: true },
    Large: { x: 300, h: 120, top_diameter: 120, bottom_diameter: 160, latchsize: 10, inside: false },
  },
  build,
  expectedSize,
};
