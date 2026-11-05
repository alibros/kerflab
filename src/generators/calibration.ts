/**
 * Calibration pieces for laser settings, one generator with a `mode`:
 *  - 'fit' covers boxes.py (florianfesti/boxes) BurnTest (boxes/generators/burntest.py), LBeam as a
 *    compact burn test, and finger-joint fit tests;
 *  - 'flex' covers FlexTest (flextest.py): a strip with a living hinge, shown bent.
 *
 * Fit mode: a gauge strip with a row of notched sections, each `step` looser
 * than the one before, and one finger tab per section. Cut it, push each tab into its section and
 * keep the clearance that fits best. Inspired by boxes.py (florianfesti/boxes,
 * boxes/generators/burntest.py), which varies the burn (kerf) value from side to side of a piece.
 *
 * Here every part is cut with the same kerf (kerf compensation is one value per part, as in every
 * generator); what varies is the clearance of the notches: section i is notched with play
 * clearance + i * step (mm), i.e. each notch is that much wider than the matching finger. The best
 * fitting section tells you what to set:
 *  - keep the kerf and set `play` to (clearance of that section) / thickness, or
 *  - keep play 0 and lower `kerf` by half that clearance (a kerf change of d moves every finger
 *    and notch edge by d / 2, so the fit loosens by d per side pair).
 * If even the first section is loose, cut again with a larger kerf. Sections and tabs are
 * numbered by engraved tick marks (section i: i ticks), and the tabs' part names give the clearance.
 *
 * Joints: the gauge's back edge is a run of notched sections ('F', one per tab) separated by plain
 * gaps; each tab's bottom edge is fingered ('f'), standing on the gauge like a box wall on its
 * floor. World frame: the gauge lies in z in [0, t], its notched edge at y = gauge depth + t; the
 * tabs stand on it, x across.
 */
import { fingerLayout, fingerHoleEdge } from '../core/edges/finger';
import type { Path } from '../core/geometry';
import { livingHinge } from '../core/livinghinge';
import { finishWithKerf, type Generator, type Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { flexParams, flexSettings, MAX_SLITS } from './flexwall';
import { autoMate } from './trays';
import { at, finishPanels, num, panel, rect, rectangularWall, requireJointLength, sideLine, type PanelSpec } from './walls';

export const TEST_CATEGORY = 'Test & calibration';

const schema: Schema = [
  { key: 'mode', label: 'Test', help: 'Fit: finger-joint gauge with progressively looser sections, to find kerf / play. Flex: living-hinge strip, to try flex settings',
    group: 'Test', kind: 'enum', options: ['fit', 'flex'], default: 'fit' },
  { key: 'count', label: 'Sections', help: 'Number of notched sections (and tabs) on the gauge', unit: '', group: 'Test', kind: 'int', min: 2, max: 10, default: 5 },
  { key: 'clearance', label: 'First clearance', help: 'Clearance of the first section: how much wider each notch is than its finger', unit: 'mm',
    group: 'Test', kind: 'number', min: 0, max: 0.3, default: 0, step: 0.01 },
  { key: 'step', label: 'Step', help: 'Clearance added from one section to the next', unit: 'mm', group: 'Test', kind: 'number', min: 0.01, max: 0.2, default: 0.05, step: 0.01 },
  { key: 'x', label: 'Section length', help: 'Length of each notched section and width of each tab', unit: 'mm', group: 'Size', kind: 'number', min: 15, max: 100, default: 30, step: 1 },
  { key: 'h', label: 'Tab height', help: 'Height of the tabs; also the depth of the gauge strip', unit: 'mm', group: 'Size', kind: 'number', min: 12, max: 60, default: 20, step: 1 },
  { key: 'flex_length', label: 'Hinge length', help: 'Flex mode: length of the living hinge (the strip has 10 mm plain at each end)', unit: 'mm',
    group: 'Flex test', kind: 'number', min: 20, max: 200, default: 60, step: 1 },
  { key: 'flex_height', label: 'Strip width', help: 'Flex mode: width of the strip across the hinge', unit: 'mm',
    group: 'Flex test', kind: 'number', min: 15, max: 150, default: 40, step: 1 },
  { key: 'bend', label: 'Preview bend', help: 'Flex mode: angle the strip is shown bent by in 3D (0: flat)', unit: 'deg',
    group: 'Flex test', kind: 'number', min: 0, max: 180, default: 90, step: 5 },
  ...flexParams,
  // The clearance replaces `play`: every section has its own.
  ...commonParams.filter((d) => d.key !== 'play'),
];

/** Plain gap between sections (and at the gauge's ends). */
const gapOf = (t: number): number => Math.max(5, 2 * t);

/** `n` tick marks (open paths) centred on (cx, y0), each `len` long going +y, 1.5 mm apart. */
function ticks(n: number, cx: number, y0: number, len: number): Path[] {
  return Array.from({ length: n }, (_, k) => {
    const x = cx + (k - (n - 1) / 2) * 1.5;
    return { start: { x, y: y0 }, segs: [{ t: 'L' as const, to: { x, y: y0 + len } }], closed: false };
  });
}

function buildFit(p: Params): Part[] {
  const ctx = edgeCtx({ ...p, play: 0 });
  const t = ctx.thickness;
  const n = num(p, 'count');
  const c0 = num(p, 'clearance');
  const step = num(p, 'step');
  const L = num(p, 'x');
  const h = num(p, 'h');
  requireJointLength('x', L, t, 'section length');
  requireJointLength('h', h, t, 'tab height');
  const lay = fingerLayout(L, ctx);
  if (lay.fingers < 1) throw new ParamError(`x too small: a ${L} mm section has no room for a finger at this finger width`, 'x');
  const last = c0 + (n - 1) * step;
  if (!(last < ctx.space && last < 2 * lay.margin))
    throw new ParamError(`step too large: the loosest section's clearance ${last.toFixed(2)} mm must stay below the space between fingers (${ctx.space.toFixed(2)} mm) and the end margins`, 'step');
  if (!(h >= 10)) throw new ParamError('h too small: the gauge needs 10 mm for its tick marks', 'h');

  const g = gapOf(t);
  const W = n * L + (n + 1) * g;
  const D = h;
  const plays = Array.from({ length: n }, (_, i) => c0 + i * step);
  const starts = plays.map((_, i) => g + i * (L + g)); // along the notched side's travel (from x = W towards 0)
  const gauge = rectangularWall(W, D, ['flat', 'flat', {
    start: t, end: t,
    draw: (tu) => {
      plays.forEach((pl) => {
        tu.forward(g);
        fingerHoleEdge(tu, L, { ...ctx, play: pl });
      });
      tu.forward(g);
    },
  }, 'flat'], ctx);
  gauge.lines = starts.map((a, i) => ({ side: 10 + i, type: 'fingerHole' as const, ...sideLine(2, a, L, t, W, D) }));
  const specs: PanelSpec[] = [panel('gauge', 'Gauge', gauge, at([0, 0, 0], [1, 0, 0], [0, 1, 0]), [])];
  plays.forEach((pl, i) => {
    const x0 = W - starts[i]! - L;
    specs.push(panel(`tab${i + 1}`, `Tab ${i + 1}: clearance ${pl.toFixed(2)} mm`, rectangularWall(L, h, ['finger', 'flat', 'flat', 'flat'], ctx),
      at([x0, D + t, t], [1, 0, 0], [0, 0, 1]), []));
  });
  autoMate(specs);
  const parts = finishPanels(specs, t, effectiveKerf(p));
  const tickLen = Math.min(4, D / 3);
  parts[0]!.engrave = plays.flatMap((_, i) => ticks(i + 1, W - starts[i]! - L / 2, D - 2 - tickLen, tickLen));
  parts.slice(1).forEach((q, i) => { q.engrave = ticks(i + 1, L / 2, h - 2 - tickLen, tickLen); });
  return parts;
}

/** Plain length at each end of the flex strip. */
const FLEX_END = 10;

/** Flex strip bend: inner-face radius from the hinge length, stretch and preview angle. */
function flexBend(p: Params): { a: number; R: number } | undefined {
  const a = (num(p, 'bend') * Math.PI) / 180;
  if (!(a > 1e-6)) return undefined;
  const rIn = (num(p, 'flex_length') * num(p, 'flex_stretch')) / a;
  return { a, R: rIn + num(p, 'thickness') };
}

function buildFlex(p: Params): Part[] {
  const t = num(p, 'thickness');
  const kerf = effectiveKerf(p);
  const L = num(p, 'flex_length');
  const Y = num(p, 'flex_height');
  const hinge = livingHinge(FLEX_END, 0, L, Y, flexSettings(p), t, kerf);
  if (hinge.holes.length > MAX_SLITS)
    throw new ParamError(`flex_distance: ${hinge.holes.length} slits (max ${MAX_SLITS}); use a wider slit spacing or a shorter strip`, 'flex_distance');
  const b = flexBend(p);
  return [finishWithKerf({
    id: 'strip', name: 'Flex test strip', outline: rect(0, 0, L + 2 * FLEX_END, Y), holes: hinge.holes, engrave: [],
    placement: at([0, 0, 0], [1, 0, 0], [0, 1, 0]), thickness: t, edges: [],
    ...(b ? { bend: { arcs: [{ at: FLEX_END, length: L, angle: num(p, 'bend'), radius: b.R }] } } : {}),
  }, kerf)];
}

/** World extents of the (bent) flex strip: x-z profile of both faces, y the strip width. */
function flexSize(p: Params): { x: number; y: number; z: number } {
  const t = num(p, 'thickness');
  const L = num(p, 'flex_length');
  const Y = num(p, 'flex_height');
  const b = flexBend(p);
  if (!b) return { x: L + 2 * FLEX_END, y: Y, z: t };
  const { a, R } = b;
  const pts: [number, number][] = [[0, 0], [0, t]];
  const phis = [0, a, ...(a > Math.PI / 2 ? [Math.PI / 2] : []), ...(a >= Math.PI - 1e-12 ? [Math.PI] : [])];
  for (const r of [R, R - t]) {
    for (const f of phis) pts.push([FLEX_END + r * Math.sin(f), R - r * Math.cos(f)]);
    pts.push([FLEX_END + r * Math.sin(a) + FLEX_END * Math.cos(a), R - r * Math.cos(a) + FLEX_END * Math.sin(a)]);
  }
  const xs = pts.map((q) => q[0]);
  const zs = pts.map((q) => q[1]);
  return { x: Math.max(...xs) - Math.min(...xs), y: Y, z: Math.max(...zs) - Math.min(...zs) };
}

export const calibration: Generator = {
  id: 'calibration',
  name: 'Calibration test',
  category: TEST_CATEGORY,
  description: 'Test pieces for your laser and material: a kerf / finger-joint fit gauge with progressively looser sections (BurnTest), or a living-hinge flex strip (FlexTest).',
  schema,
  presets: {
    'BurnTest (5 steps of 0.05 mm)': { mode: 'fit', count: 5, clearance: 0, step: 0.05 },
    'Fine fit (8 steps of 0.02 mm)': { mode: 'fit', count: 8, clearance: 0, step: 0.02, x: 25 },
    'FlexTest': { mode: 'flex', flex_length: 60, flex_height: 40, bend: 90 },
    'Plywood 6 mm fit': { mode: 'fit', count: 6, clearance: 0.05, step: 0.05, x: 40, h: 30, thickness: 6 },
  },
  build: (p) => (p.mode === 'flex' ? buildFlex(p) : buildFit(p)),
  expectedSize: (p) => {
    if (p.mode === 'flex') return flexSize(p);
    const t = num(p, 'thickness');
    const n = num(p, 'count');
    const g = gapOf(t);
    return { x: n * num(p, 'x') + (n + 1) * g, y: num(p, 'h') + t, z: num(p, 'h') + t };
  },
};
