/**
 * Slotted rack: two notched rails between two end plates that hold flat things upright side by
 * side: discs, records, plates, lids, tablets, cutting boards, books. Generic version of boxes.py
 * (florianfesti/boxes) DiscRack (discrack.py), which leans the discs on angled rails; here the
 * items stand in notches across two level rails.
 *
 * Parts: two end plates (depth * rail height, plain), and two rails (L * rail height) standing on
 * edge at a quarter and three quarters of the depth, their ends fingered through slot rows in the
 * end plates, `count` notches (item thickness + clearance wide, notch depth deep) in their top
 * edges, `web` apart. When `item_d` is given, an item of that diameter resting in both rails'
 * notches must clear the ground.
 *
 * World frame: x along the rack, y across (front to back), z up; outer size L + 2t, depth, rail
 * height.
 */
import type { Generator, Part } from '../core/part';
import { commonParams, edgeCtx, effectiveKerf, type Params, type Schema } from '../core/schema';
import { ParamError } from '../core/validate';
import { STORAGE_CATEGORY } from './storage';
import { autoMate, slotInto } from './trays';
import { at, finishPanels, num, panel, rectangularWall, requireJointLength, type CustomSide, type PanelSpec } from './walls';

const schema: Schema = [
  { key: 'count', label: 'Slots', help: 'Number of items the rack holds', unit: '', group: 'Rack', kind: 'int', min: 2, max: 60, default: 10 },
  { key: 'item_thickness', label: 'Item thickness', help: 'Thickness of one item (disc, record sleeve, plate rim)', unit: 'mm', group: 'Rack', kind: 'number', min: 1, max: 60, default: 6, step: 0.5 },
  { key: 'clearance', label: 'Clearance', help: 'Extra width of each notch', unit: 'mm', group: 'Rack', kind: 'number', min: 0, max: 5, default: 1, step: 0.1 },
  { key: 'web', label: 'Spacing', help: 'Material between neighbouring notches (and at the rail ends)', unit: 'mm', group: 'Rack', kind: 'number', min: 3, max: 50, default: 8, step: 0.5 },
  { key: 'depth', label: 'Depth', help: 'Depth of the rack across the rails', unit: 'mm', group: 'Rack', kind: 'number', min: 40, max: 400, default: 120, step: 1 },
  { key: 'rail_height', label: 'Rail height', help: 'Height of the rails and end plates', unit: 'mm', group: 'Rack', kind: 'number', min: 20, max: 150, default: 40, step: 1 },
  { key: 'notch', label: 'Notch depth', help: 'Depth of the notches as a fraction of the rail height', unit: '', group: 'Rack', kind: 'number', min: 0.2, max: 0.7, default: 0.5, step: 0.05 },
  { key: 'item_d', label: 'Item diameter', help: 'Diameter of round items, to check they clear the ground (0: no check)', unit: 'mm',
    group: 'Rack', kind: 'number', min: 0, max: 400, default: 0, step: 1 },
  ...commonParams.map((d) => (d.key === 'thickness' && d.kind === 'number' ? { ...d, max: 10 } : d)),
];

const railLength = (p: Params): number => {
  const w = num(p, 'item_thickness') + num(p, 'clearance');
  return num(p, 'count') * w + (num(p, 'count') + 1) * num(p, 'web');
};

function build(p: Params): Part[] {
  const ctx = edgeCtx(p);
  const t = ctx.thickness;
  const n = num(p, 'count');
  const w = num(p, 'item_thickness') + num(p, 'clearance');
  const web = num(p, 'web');
  const L = railLength(p);
  const D = num(p, 'depth');
  const hr = num(p, 'rail_height');
  const nd = num(p, 'notch') * hr;
  requireJointLength('rail_height', hr - nd, t, 'rail height below the notches');
  if (!(web >= t)) throw new ParamError(`web too small: at least one thickness (${t} mm) of rail between notches and at the ends`, 'web');
  const d = num(p, 'item_d');
  if (d > 0) {
    // Item resting in the notches of both rails (D / 2 apart): its lowest point above the ground.
    const half = D / 4;
    if (!(d / 2 > half)) throw new ParamError(`item_d too small for the rails: a ${d} mm item falls between rails ${D / 2} mm apart`, 'item_d');
    const low = hr - nd + Math.sqrt((d / 2) ** 2 - half ** 2) - d / 2;
    if (!(low >= 2)) throw new ParamError(`depth too small: a ${d} mm item would touch the ground (rails ${D / 2} mm apart, notches ${nd.toFixed(0)} mm deep)`, 'depth');
  }
  // Rail top edge, travelling -x: web, notch, web, ..., web (symmetric).
  const top: CustomSide = {
    start: 0, end: 0,
    draw: (tu) => {
      for (let k = 0; k < n; k++) {
        tu.forward(web);
        tu.turn(90); tu.forward(nd); tu.turn(-90);
        tu.forward(w);
        tu.turn(-90); tu.forward(nd); tu.turn(90);
      }
      tu.forward(web);
    },
  };
  const left = panel('left', 'End plate', rectangularWall(D, hr, ['flat', 'flat', 'flat', 'flat'], ctx), at([0, 0, 0], [0, 1, 0], [0, 0, 1]), []);
  const right = panel('right', 'End plate', rectangularWall(D, hr, ['flat', 'flat', 'flat', 'flat'], ctx), at([L + 2 * t, D, 0], [0, -1, 0], [0, 0, 1]), []);
  const specs: PanelSpec[] = [left, right];
  for (const [k, y0] of [[1, D / 4 + t / 2], [2, (3 * D) / 4 + t / 2]] as const) {
    const rail = panel(`rail${k}`, `Rail ${k}`, rectangularWall(L, hr, ['flat', 'finger', top, 'finger'], ctx), at([t, y0, 0], [1, 0, 0], [0, 0, 1]), []);
    specs.push(rail);
    slotInto(left, rail, [3], ctx);
    slotInto(right, rail, [1], ctx);
  }
  autoMate(specs);
  return finishPanels(specs, t, effectiveKerf(p));
}

export const slotRack: Generator = {
  id: 'slotrack',
  name: 'Slotted rack',
  category: STORAGE_CATEGORY,
  description: 'Rack of notched rails between end plates that holds discs, records, plates, lids, tablets or boards upright (DiscRack).',
  schema,
  presets: {
    'DiscRack (CDs)': { count: 20, item_thickness: 10, clearance: 1, web: 5, depth: 90, rail_height: 30, notch: 0.5, item_d: 120 },
    'Vinyl records': { count: 12, item_thickness: 4, clearance: 2, web: 12, depth: 200, rail_height: 50, notch: 0.4, item_d: 315, thickness: 4 },
    'Plate / lid rack': { count: 8, item_thickness: 8, clearance: 2, web: 20, depth: 140, rail_height: 45, notch: 0.5, item_d: 0 },
  },
  build,
  expectedSize: (p) => ({ x: railLength(p) + 2 * num(p, 'thickness'), y: num(p, 'depth'), z: num(p, 'rail_height') }),
};
