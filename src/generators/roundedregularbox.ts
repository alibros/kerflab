/**
 * RoundedRegularBox: a regular n-gon box with rounded vertical edges, ported from boxes.py
 * (florianfesti/boxes, boxes/generators/roundedregularbox.py, RoundedRegularBox). ONE living-hinge
 * wall wraps a bottom and a top plate.
 *
 * Plates: the regular n-gon whose inscribed circle has diameter `inner_size`, corners rounded with
 * radius r (turn 360 / n each): fingers on the straight parts (length
 * s = (inner_size - 2r) tan(180 / n)), plain arcs; side 0 is horizontal at the bottom and split
 * in two halves where the wall starts and ends. Wall (inner height h): fingerHole spans and n
 * living hinges. Top: closed, or a rim with an opening inset 2 thickness (boxes.py "hole").
 *
 * World frame: plates horizontal, side 0 along world X at the front; bbox starts at 0. Outer size:
 * the plate profile grown by t all round, (h + 2t) tall.
 *
 * Deliberate differences from boxes.py: one wall piece (boxes.py defaults to one per side, joined
 * by dovetails), its ends butt in the middle of side 0; no loose "lid" top; the radius is clamped
 * so every straight part keeps 3 * thickness per half side.
 */
import { edgeFor } from '../core/edges';
import type { Path } from '../core/geometry';
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { Turtle } from '../core/turtle';
import { ParamError } from '../core/validate';
import { flexParams, flexSettings, flexWall, requireFlexArc } from './flexwall';
import { at, finishPanels, num, requireJointLength, type PanelSpec, type Wall, type WallLine } from './walls';

const schema: Schema = [
  { key: 'sides', label: 'Sides', help: 'Number of sides of the polygon', group: 'Size', kind: 'int', min: 3, max: 12, default: 5 },
  { key: 'inner_size', label: 'Inner size', help: 'Diameter of the circle inscribed in the inner polygon', unit: 'mm',
    group: 'Size', kind: 'number', min: 30, max: 1000, default: 150, step: 1 },
  { key: 'h', label: 'Height', help: 'Inner height', unit: 'mm', group: 'Size', kind: 'number', min: 10, max: 1000, default: 100, step: 1 },
  { key: 'radius', label: 'Corner radius', help: 'Inner radius of the rounded vertical edges (the living hinges)', unit: 'mm',
    group: 'Box', kind: 'number', min: 3, max: 300, default: 15, step: 0.5 },
  { key: 'top', label: 'Top', help: 'Closed top plate, or a rim with an opening', group: 'Box',
    kind: 'enum', options: ['hole', 'closed'], default: 'hole' },
  ...flexParams,
  ...commonParams,
];

type Geo = { n: number; A: number; r: number; s: number; tan: number };

function geometry(p: Params): Geo {
  const t = num(p, 'thickness');
  const n = num(p, 'sides');
  const A = num(p, 'inner_size') / 2;
  const tan = Math.tan(Math.PI / n);
  // Each half side keeps 3t of fingers: (A - r) tan >= 3t.
  const r = Math.min(num(p, 'radius'), A - (3 * t) / tan);
  return { n, A, r, s: 2 * (A - r) * tan, tan };
}

/** Extents of the sharp n-gon of apothem a (side 0 horizontal at the bottom, centre at 0). */
function polyBox(n: number, a: number): { x0: number; x1: number; y0: number; y1: number } {
  const R = a / Math.cos(Math.PI / n);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k < n; k++) {
    const ang = -Math.PI / 2 + Math.PI / n + (2 * Math.PI * k) / n;
    xs.push(R * Math.cos(ang)); ys.push(R * Math.sin(ang));
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function expectedSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const g = geometry(p);
  // Outer profile = sharp n-gon of apothem A - r grown by r + t.
  const b = polyBox(g.n, g.A - g.r);
  const R = g.r + t;
  return { x: b.x1 - b.x0 + 2 * R, y: b.y1 - b.y0 + 2 * R, z: num(p, 'h') + 2 * t };
}

/** Rounded n-gon plate centred at 0: side 0 = right half of the bottom side, 1..n-1 the others, n the left half. */
function plate(g: Geo, ctx: ReturnType<typeof edgeCtx>, holes: Path[]): Wall {
  const t = ctx.thickness;
  const tt = new Turtle({ x: 0, y: -g.A });
  const lines: WallLine[] = [];
  const run = (side: number, len: number): void => {
    const p0 = tt.pos;
    const hd = (tt.heading * Math.PI) / 180;
    edgeFor('finger')(tt, len, ctx);
    const o = { x: t * Math.sin(hd), y: -t * Math.cos(hd) };
    lines.push({ side, type: 'finger', from: { x: p0.x + o.x, y: p0.y + o.y }, to: { x: tt.pos.x + o.x, y: tt.pos.y + o.y } });
  };
  run(0, g.s / 2);
  for (let k = 1; k < g.n; k++) { tt.arc(g.r, 360 / g.n); run(k, g.s); }
  tt.arc(g.r, 360 / g.n);
  run(g.n, g.s / 2);
  return { outline: tt.toPath(true), holes, lines };
}

/** Opening of the top rim: the profile inset by 2t (corners sharp when r <= 2t). */
function opening(g: Geo, t: number): Path {
  const d = 2 * t;
  if (g.r > d + 0.5) {
    const tt = new Turtle({ x: -g.s / 2, y: -g.A + d });
    for (let k = 0; k < g.n; k++) { tt.forward(g.s); tt.arc(g.r - d, 360 / g.n); }
    return tt.toPath(true);
  }
  const s = 2 * (g.A - d) * g.tan;
  const tt = new Turtle({ x: -s / 2, y: -g.A + d });
  for (let k = 0; k < g.n; k++) { tt.forward(s); tt.turn(360 / g.n); }
  return tt.toPath(true);
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const fs = flexSettings(p);
  const g = geometry(p);
  const h = num(p, 'h');
  requireJointLength('h', h, t);
  if (g.s / 2 < 3 * t - 1e-9) throw new ParamError('inner_size too small for the number of sides: a half side has less than 3 * thickness', 'inner_size');
  if (p.top !== 'closed' && g.A - 2 * t < 3 * t) throw new ParamError('inner_size too small for the top opening', 'inner_size');
  requireFlexArc('radius', g.r, 360 / g.n, fs, t);

  const spans: Parameters<typeof flexWall>[0] = [{ kind: 'flat', length: g.s / 2, edge: 'fingerHole' }];
  for (let k = 1; k < g.n; k++) spans.push({ kind: 'arc', angle: 360 / g.n, r: g.r }, { kind: 'flat', length: g.s, edge: 'fingerHole' });
  spans.push({ kind: 'arc', angle: 360 / g.n, r: g.r }, { kind: 'flat', length: g.s / 2, edge: 'fingerHole' });
  const wall = flexWall(spans, h, ['flat', 'flat'], ctx, fs);
  const bottom = plate(g, ctx, []);
  const top = plate(g, ctx, p.top === 'closed' ? [] : [opening(g, t)]);
  // The wall runs clockwise seen from above (n inwards): its span 2k lies on bottom side n - k; the
  // top plate (mirrored, u = -X) has side j where the bottom has side n - j, i.e. on wall span 2j.
  const wm: PanelSpec['mates'] = [];
  const bm: PanelSpec['mates'] = [];
  const tm: PanelSpec['mates'] = [];
  for (let k = 0; k <= g.n; k++) {
    wm[2 * k] = ['bottom', g.n - k]; bm[g.n - k] = ['wall', 2 * k];
    wm[100 + 2 * k] = ['top', k]; tm[k] = ['wall', 100 + 2 * k];
  }
  const b = polyBox(g.n, g.A - g.r);
  const R = g.r + t;
  const cx = R - b.x0;
  const cy = R - b.y0;
  const panels: PanelSpec[] = [
    { id: 'wall', name: 'Flex wall', ...wall, placement: at([cx, cy - g.A - t, t], [-1, 0, 0], [0, 0, 1]), mates: wm },
    { id: 'bottom', name: 'Bottom', ...bottom, placement: at([cx, cy, 0], [1, 0, 0], [0, 1, 0]), mates: bm },
    { id: 'top', name: p.top === 'closed' ? 'Top' : 'Top rim', ...top, placement: at([cx, cy, h + 2 * t], [-1, 0, 0], [0, 1, 0]), mates: tm },
  ];
  return finishPanels(panels, t, effectiveKerf(p));
}

export const roundedRegularBox: Generator = {
  id: 'roundedregularbox',
  name: 'Rounded polygon box',
  category: 'Flex',
  description: 'Regular polygon box with rounded vertical edges: one living-hinge wall wraps the bottom and top plates.',
  schema,
  presets: {
    Pentagon: { sides: 5, inner_size: 150, h: 100, radius: 15, top: 'hole' },
    Hexagon: { sides: 6, inner_size: 120, h: 60, radius: 20, top: 'closed' },
    Triangle: { sides: 3, inner_size: 100, h: 80, radius: 12, top: 'hole' },
  },
  build,
  expectedSize,
};
