/**
 * Laser cutting profiles: machine beds and stock sheets (sheet size for nesting) and sheet
 * materials (thickness + kerf, and how the stock looks in the 3D view). Machine and material data
 * come from the Eurorack case designer (same author), so both tools agree on numbers.
 *
 * Profiles are a convenience over plain values: the store only ever holds `sheet` {w, h} and the
 * generator's `thickness` / `kerf` params, so links stay unchanged and any value the user types
 * still works; it just reads as "Custom".
 */
import type { MaterialId } from './views/materials3d';

export interface SheetProfile {
  id: string;
  label: string;
  w: number;
  h: number;
}

/** Cut areas of common laser cutters, mm (from the Eurorack designer's LASER_MACHINES). */
export const LASER_MACHINES: SheetProfile[] = [
  { id: 'glowforge', label: 'Glowforge Basic / Plus / Pro', w: 495, h: 279 },
  { id: 'glowforge-aura', label: 'Glowforge Aura', w: 292, h: 292 },
  { id: 'xtool-f1u', label: 'xTool F1 Ultra', w: 220, h: 220 },
  { id: 'xtool-m1', label: 'xTool M1', w: 385, h: 300 },
  { id: 'xtool-s1', label: 'xTool S1', w: 498, h: 319 },
  { id: 'xtool-p2', label: 'xTool P2 / P2S', w: 600, h: 305 },
  { id: 'epilog-fusion-pro-48', label: 'Epilog Fusion Pro 48', w: 1219, h: 914 },
  { id: 'epilog-fusion-pro-36', label: 'Epilog Fusion Pro 36', w: 914, h: 610 },
  { id: 'epilog-fusion-pro-24', label: 'Epilog Fusion Pro 24', w: 610, h: 610 },
  { id: 'epilog-fusion-pro-32', label: 'Epilog Fusion Pro 32 (legacy)', w: 812, h: 508 },
  { id: 'epilog-fusion-edge-36', label: 'Epilog Fusion Edge / Maker 36', w: 914, h: 610 },
  { id: 'epilog-fusion-edge-24', label: 'Epilog Fusion Edge / Maker 24', w: 610, h: 610 },
  { id: 'epilog-fusion-edge-12', label: 'Epilog Fusion Edge / Maker 12', w: 610, h: 305 },
  { id: 'epilog-helix-24', label: 'Epilog Helix 24', w: 610, h: 457 },
  { id: 'epilog-zing-24', label: 'Epilog Zing 24 / Mini 24', w: 610, h: 305 },
  { id: 'epilog-zing-16', label: 'Epilog Zing 16', w: 406, h: 305 },
  { id: 'k40', label: 'K40 (stock)', w: 300, h: 200 },
  { id: 'omtech-50', label: 'OMTech 50W', w: 500, h: 300 },
  { id: 'omtech-60', label: 'OMTech 60W', w: 600, h: 400 },
  { id: 'ponoko-p3', label: 'Ponoko P3 sheet', w: 790, h: 384 },
];

/** Sheet stock you buy rather than a bed you own, mm. */
export const STOCK_SHEETS: SheetProfile[] = [
  { id: 'a4', label: 'A4', w: 297, h: 210 },
  { id: 'a3', label: 'A3', w: 420, h: 297 },
  { id: 'sheet-600x400', label: 'Laser sheet', w: 600, h: 400 },
  { id: 'half-sheet', label: 'Half sheet (4 × 2 ft)', w: 1220, h: 610 },
];

/**
 * Margin between parts and the edge of the cut area. The machine sizes above are cut areas, so
 * parts can go almost to the edge; the gap between parts is a separate setting.
 */
export const SHEET_EDGE = 1;

/** Sheet sizes the app accepts, mm (links and custom entry are clamped to this). */
export const SHEET_RANGE = { min: 10, max: 10000 } as const;

export const sheetById = (id: string): SheetProfile | undefined => [...LASER_MACHINES, ...STOCK_SHEETS].find((s) => s.id === id);

/**
 * The profile a sheet size reads as. Several beds share a size (Epilog Pro 36 and Edge 36), so a
 * `preferred` id — the one the viewer last picked — wins when its size matches. Otherwise stock
 * sheets come first (the default 600 × 400 reads as a plain laser sheet, not somebody's machine).
 */
export function matchSheet(sheet: { w: number; h: number }, preferred?: string | null): SheetProfile | null {
  const same = (s: SheetProfile): boolean => s.w === sheet.w && s.h === sheet.h;
  const pref = preferred ? sheetById(preferred) : undefined;
  if (pref && same(pref)) return pref;
  return STOCK_SHEETS.find(same) ?? LASER_MACHINES.find(same) ?? null;
}

/** What a sheet material looks like, for the preview. */
export type MaterialLook = 'plywood' | 'mdf' | 'acrylic';

export interface MaterialProfile {
  id: string;
  label: string;
  thickness: number;
  kerf: number;
  look: MaterialLook;
}

/** Sheet materials with a typical kerf, mm (from the Eurorack designer's LASER_MATERIALS). */
export const LASER_MATERIALS: MaterialProfile[] = [
  { id: 'ply3', label: 'Birch plywood 3 mm', thickness: 3.0, kerf: 0.2, look: 'plywood' },
  { id: 'ply6', label: 'Birch plywood 6 mm', thickness: 6.0, kerf: 0.25, look: 'plywood' },
  { id: 'mdf3', label: 'MDF 3 mm', thickness: 3.0, kerf: 0.16, look: 'mdf' },
  { id: 'mdf6', label: 'MDF 6 mm', thickness: 6.0, kerf: 0.2, look: 'mdf' },
  { id: 'acrylic3', label: 'Cast acrylic 3 mm', thickness: 3.0, kerf: 0.18, look: 'acrylic' },
  { id: 'acrylic5', label: 'Cast acrylic 5 mm', thickness: 5.0, kerf: 0.21, look: 'acrylic' },
];

const EPS = 1e-6;

/** The profile whose thickness and kerf are exactly the given values, else null ("Custom"). */
export function matchMaterial(thickness: unknown, kerf: unknown): MaterialProfile | null {
  if (typeof thickness !== 'number' || typeof kerf !== 'number') return null;
  return LASER_MATERIALS.find((m) => Math.abs(m.thickness - thickness) < EPS && Math.abs(m.kerf - kerf) < EPS) ?? null;
}

/** 3D materials that already read as each look; a choice inside the family is left alone. */
const FAMILY: Record<MaterialLook, MaterialId[]> = {
  plywood: ['birch', 'walnut'],
  mdf: ['mdf'],
  acrylic: ['acrylic'],
};

/**
 * The 3D material to show after the user picks a profile with `look`, given the current one.
 * Walnut stays walnut for a plywood profile (it is plywood); anything outside the family switches.
 */
export function material3dFor(look: MaterialLook, current: MaterialId | null): MaterialId {
  const fam = FAMILY[look];
  return current && fam.includes(current) ? current : fam[0]!;
}

/** Every 3D material id (the Record makes the compiler flag a new one), without importing three. */
const KNOWN_3D: Record<MaterialId, true> = { birch: true, walnut: true, mdf: true, acrylic: true, metal: true };

/** localStorage key of the 3D material choice (owned by the viewer). */
export const MATERIAL3D_KEY = 'kerflab:material3d';
/** Window event asking a live 3D viewer to show a material look; detail is a MaterialLook. */
export const LOOK_EVENT = 'kerflab:material-look';

/**
 * Tell the 3D view the user picked stock with this look. A viewer that is not open yet picks it
 * up from storage when it mounts; one that is open listens for LOOK_EVENT.
 */
export function requestLook(look: MaterialLook): void {
  let current: MaterialId | null = null;
  try {
    const v = localStorage.getItem(MATERIAL3D_KEY);
    current = v !== null && Object.hasOwn(KNOWN_3D, v) ? (v as MaterialId) : null;
  } catch {
    /* no storage: fall through with no current choice */
  }
  try {
    localStorage.setItem(MATERIAL3D_KEY, material3dFor(look, current));
  } catch {
    /* not persisted */
  }
  dispatchEvent(new CustomEvent(LOOK_EVENT, { detail: look }));
}
