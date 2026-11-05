/**
 * Angled cut jig: a wedge-shaped sled that tilts a workpiece by `angle` on the laser bed, so the
 * beam cuts a bevel (or a mitre on the end of a strip). Generic version of boxes.py
 * (florianfesti/boxes) AngledCutJig (angledcutjig.py): a bottom plate, a sloped top plate and
 * `ribs` right-triangle ribs finger-jointed through slot rows in both plates; an optional stop
 * strip across the low end of the top plate keeps the work from sliding off.
 *
 * World frame: x across the jig (width), y along the slope from its low end (y = 0) to the high
 * end (y = length), z up. Bottom plate z in [0, t]; ribs stand on it (normal +x); the top plate
 * rests on the ribs' sloped edges, its outer face up.
 */
import type { Vec2 } from '../core/geometry';
import type { Generator, Part, Vec3 } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { JIGS_CATEGORY } from './holdfast';
import { autoMate, rest, slotInto } from './trays';
import { at, finishPanels, num, panel, polygonPlate, rect, requireJointLength, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'angle', label: 'Angle', help: 'Tilt of the top plate, i.e. the bevel the laser cuts', unit: 'deg', group: 'Jig', kind: 'number', min: 5, max: 60, default: 30, step: 0.5 },
  { key: 'x', label: 'Width', help: 'Width of the jig across the slope', unit: 'mm', group: 'Jig', kind: 'number', min: 40, max: 600, default: 120, step: 1 },
  { key: 'length', label: 'Length', help: 'Length of the jig along the slope (on the bed)', unit: 'mm', group: 'Jig', kind: 'number', min: 40, max: 600, default: 120, step: 1 },
  { key: 'ribs', label: 'Ribs', help: 'Number of triangular ribs between the plates', unit: '', group: 'Jig', kind: 'int', min: 2, max: 8, default: 3 },
  { key: 'stop', label: 'Stop strip', help: 'Height of a stop strip glued across the low end of the top plate; 0 for none', unit: 'mm',
    group: 'Jig', kind: 'number', min: 0, max: 30, default: 8, step: 0.5 },
  ...commonParams,
];

function dims(p: Params) {
  const t = num(p, 'thickness');
  const a = (num(p, 'angle') * Math.PI) / 180;
  const L = num(p, 'length');
  const H = L * Math.tan(a);
  return { t, a, L, H, W: num(p, 'x'), stop: num(p, 'stop') };
}

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const { t, a, L, H, W, stop } = dims(p);
  const n = num(p, 'ribs');
  requireJointLength('length', L, t, 'rib length');
  if (!(H >= 2 * t)) throw new ParamError(`angle too small for ${L} mm: the high end of the ribs is ${H.toFixed(1)} mm, needs at least 2 * thickness`, 'angle');
  const pitch = (W - 3 * t) / (n - 1); // ribs from x = t to x = W - 2t
  if (!(pitch >= 4 * t)) throw new ParamError(`ribs: ${n} ribs do not fit in ${W} mm (needs ${(4 * t).toFixed(1)} mm between them)`, 'ribs');
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const Ls = L / cos; // slope length
  const specs: PanelSpec[] = [];
  const bottom = panel('bottom', 'Bottom plate', { outline: rect(0, 0, W, L), holes: [], lines: [] }, at([0, 0, 0], [1, 0, 0], [0, 1, 0]), []);
  // Top plate: u along -x (from x = W), v up the slope; its z = 0 face is the outer (upper) face,
  // one thickness above the ribs' sloped edges; its low corner rests on the bottom plate.
  const o: Vec3 = [W, -t * sin, t + t * cos];
  const top = panel('top', 'Top plate', { outline: rect(0, 0, W, Ls), holes: [], lines: [] }, at(o, [-1, 0, 0], [0, cos, sin]), []);
  specs.push(bottom, top);
  const tri: Vec2[] = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: H }];
  for (let j = 0; j < n; j++) {
    const w = polygonPlate(tri, ['finger', 'flat', 'finger'], ctx);
    w.lines = w.lines.filter((l) => l.type !== 'flat');
    const r = panel(`rib${j + 1}`, 'Rib', w, at([t + j * pitch, 0, t], [0, 1, 0], [0, 0, 1]), []);
    specs.push(r);
    slotInto(bottom, r, [0], ctx);
    slotInto(top, r, [2], ctx);
  }
  if (stop > 0) {
    // A strip standing on the top plate's outer face along its low edge, glued (a flat resting
    // mate): u along -x like the top plate, v along the plate's outward normal, its material up
    // the slope from the plate's low edge.
    const strip = panel('stop', 'Stop strip', { outline: rect(0, 0, W, stop), holes: [], lines: [] }, at(o, [-1, 0, 0], [0, -sin, cos]), []);
    specs.push(strip);
    rest(top, strip, o, [0, o[1], o[2]], 900, t);
  }
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const angledCutJig: Generator = {
  id: 'angledcutjig',
  name: 'Angled cut jig',
  category: JIGS_CATEGORY,
  description: 'Wedge sled that tilts the workpiece on the laser bed to cut bevels and mitres, with a stop strip (AngledCutJig).',
  schema,
  presets: {
    'AngledCutJig (45 deg mitre)': { angle: 45, x: 120, length: 100, ribs: 3, stop: 8 },
    'Shallow bevel (15 deg)': { angle: 15, x: 200, length: 160, ribs: 4, stop: 6 },
  },
  build,
  expectedSize: (p) => {
    const { t, a, L, H, W, stop } = dims(p);
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    // Stop strip: from the top plate's low edge (y0, z0) out along the normal (0, -sin, cos), t thick up the slope.
    const y0 = -t * sin;
    const z0 = t + t * cos;
    const ys = [y0, L, ...(stop > 0 ? [y0 - stop * sin] : [])];
    const zs = [0, z0 + H, ...(stop > 0 ? [z0 + stop * cos + t * sin] : [])];
    return { x: W, y: Math.max(...ys) - Math.min(...ys), z: Math.max(...zs) - Math.min(...zs) };
  },
};
