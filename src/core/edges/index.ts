import { clickinEdge, clickinHoleEdge } from './clickin';
import { crossSlotEdge } from './crossslot';
import { flatEdge } from './flat';
import { flexEdge } from './flex';
import { angledFingerHoleEdge, angledFingerJoint, fingerHoleEdge, fingerJoint } from './finger';
import { hingeEdge } from './hinge';
import { mitreEdge } from './mitre';
import { roundedEdge } from './rounded';
import { slotEdge } from './slot';
import { tslotEdge, tslotHoleEdge } from './tslot';
import type { Edge } from './types';

export type EdgeType =
  | 'flat' | 'finger' | 'fingerHole' | 'mitre' | 'rounded' | 'hinge' | 'slot' | 'tslot' | 'tslotHole' | 'clickin' | 'clickinHole' | 'flex'
  | 'angledFinger' | 'angledFingerHole' | 'crossSlot';

const EDGES: Record<EdgeType, Edge> = {
  flat: flatEdge, finger: fingerJoint, fingerHole: fingerHoleEdge, mitre: mitreEdge, rounded: roundedEdge,
  hinge: hingeEdge, slot: slotEdge, tslot: tslotEdge, tslotHole: tslotHoleEdge, clickin: clickinEdge,
  clickinHole: clickinHoleEdge, flex: flexEdge, angledFinger: angledFingerJoint, angledFingerHole: angledFingerHoleEdge,
  crossSlot: crossSlotEdge,
};

export function edgeFor(type: EdgeType): Edge {
  return EDGES[type];
}

/**
 * Mating partner of an edge type; an involution. finger<->fingerHole, angledFinger<->angledFingerHole, hinge<->slot, tslot<->tslotHole,
 * clickin<->clickinHole; every other
 * type (flat, mitre, rounded, flex, crossSlot) is self-complementary. In particular rounded
 * mates with itself rather than flat, because rounded->flat would force flat->rounded.
 */
const PARTNER: Record<EdgeType, EdgeType> = {
  flat: 'flat', finger: 'fingerHole', fingerHole: 'finger', mitre: 'mitre', rounded: 'rounded',
  hinge: 'slot', slot: 'hinge', tslot: 'tslotHole', tslotHole: 'tslot', clickin: 'clickinHole',
  clickinHole: 'clickin', flex: 'flex', angledFinger: 'angledFingerHole', angledFingerHole: 'angledFinger',
  crossSlot: 'crossSlot',
};

export function complement(type: EdgeType): EdgeType {
  return PARTNER[type];
}

export { flexPeriod } from './flex';
export { angledFingerWidths } from './finger';
