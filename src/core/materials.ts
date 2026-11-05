/**
 * Sheet material presets: one-click thickness/kerf defaults plus a base colour for the 3D view.
 * Kerf values are typical CO2-laser starting points; users should calibrate for their machine.
 */
export type MaterialKind = 'wood' | 'mdf' | 'acrylic' | 'metal';

export type Material = {
  id: string;
  name: string;
  kind: MaterialKind;
  /** Sheet thickness, mm. */
  thickness: number;
  /** Typical full kerf width, mm. */
  kerf: number;
  /** Base colour (#rrggbb) for previews. */
  color: string;
};

export const materials: Material[] = [
  { id: 'birch3', name: 'Birch plywood 3 mm', kind: 'wood', thickness: 3, kerf: 0.15, color: '#e3c9a0' },
  { id: 'birch4', name: 'Birch plywood 4 mm', kind: 'wood', thickness: 4, kerf: 0.18, color: '#e3c9a0' },
  { id: 'birch6', name: 'Birch plywood 6 mm', kind: 'wood', thickness: 6, kerf: 0.2, color: '#e3c9a0' },
  { id: 'walnut3', name: 'Walnut veneer ply 3 mm', kind: 'wood', thickness: 3, kerf: 0.15, color: '#6b4a33' },
  { id: 'mdf3', name: 'MDF 3 mm', kind: 'mdf', thickness: 3, kerf: 0.2, color: '#a98763' },
  { id: 'acrylic3', name: 'Acrylic 3 mm', kind: 'acrylic', thickness: 3, kerf: 0.1, color: '#d8e6ea' },
  { id: 'acrylic5', name: 'Acrylic 5 mm', kind: 'acrylic', thickness: 5, kerf: 0.12, color: '#d8e6ea' },
  { id: 'alu1_5', name: 'Aluminium 1.5 mm', kind: 'metal', thickness: 1.5, kerf: 0.1, color: '#a7adb3' },
];

export function getMaterial(id: string): Material | undefined {
  return materials.find((m) => m.id === id);
}
