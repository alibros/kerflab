/**
 * Generator registry: the single list the UI, URL state and the registry-wide tests iterate.
 * To add a generator, create `src/generators/<id>.ts` exporting a `Generator` and append it here;
 * `tests/generators/generators.test.ts` then covers it automatically.
 */
import type { Generator } from '../core/part';
import { angledBox } from './angledbox';
import { angledCutJig } from './angledcutjig';
import { basedBox } from './basedbox';
import { binTray } from './bintray';
import { beam } from './beam';
import { bookHolder } from './bookholder';
import { calibration } from './calibration';
import { canDispenser } from './candispenser';
import { capsuleDispenser } from './capsuledispenser';
import { cardBox } from './cardbox';
import { chest } from './chest';
import { closedBox } from './closedbox';
import { compartmentBox } from './compartmentbox';
import { cradleRack } from './cradle';
import { diceBox } from './dicebox';
import { diceTower } from './dicetower';
import { displayShelf } from './displayshelf';
import { dividerTray } from './dividertray';
import { flexBook } from './flexbook';
import { frame } from './frame';
import { gearBox } from './gearbox';
import { gearsGenerator } from './gears';
import { gridfinity } from './gridfinity';
import { flexBox } from './flexbox';
import { flexBox2 } from './flexbox2';
import { flexBox5 } from './flexbox5';
import { drawer } from './drawer';
import { enclosureBox } from './enclosure';
import { halfBox } from './halfbox';
import { hingeBox } from './hingebox';
import { holdfast } from './holdfast';
import { hook } from './hook';
import { integratedHingeBox } from './integratedhinge';
import { jointPanel } from './jointpanel';
import { keyHolder } from './keyholder';
import { knob } from './knob';
import { laptopStand } from './laptopstand';
import { lightBox } from './lightbox';
import { openBox } from './openbox';
import { patternPanel } from './patternpanel';
import { penHolder } from './penholder';
import { phoneHolder } from './phoneholder';
import { planetary } from './planetary';
import { profileBox } from './profilebox';
import { pulley } from './pulley';
import { regularBox } from './regularbox';
import { roundedBox } from './roundedbox';
import { roundedRegularBox } from './roundedregularbox';
import { silverware } from './silverware';
import { slopedOrganizer } from './slopedorganizer';
import { slotRack } from './slotrack';
import { slidingLidBox } from './slidinglid';
import { smallPartsTray } from './smallpartstray';
import { spicesRack } from './spicesrack';
import { spool } from './spool';
import { stackableBin } from './stackablebin';
import { storageShelf } from './storageshelf';
import { strapClamp } from './strapclamp';
import { twoPiece } from './twopiece';
import { uBox } from './ubox';
import { trayInsert } from './trayinsert';
import { trayLayout } from './traylayout';
import { typeTray } from './typetray';
import { unevenHeightBox } from './unevenheightbox';
import { universalBox } from './universalbox';
import { wallHolder } from './wallholder';
import { wineRack } from './winerack';

export const registry: Generator[] = [closedBox, openBox, basedBox, universalBox, unevenHeightBox, halfBox,
  hingeBox, integratedHingeBox, slidingLidBox, twoPiece, regularBox, angledBox, stackableBin,
  typeTray, trayLayout, trayInsert, dividerTray, compartmentBox, smallPartsTray, binTray,
  drawer, penHolder, keyHolder, cardBox, silverware, diceBox, flexBox, flexBox2, flexBox5, roundedBox, uBox, roundedRegularBox, flexBook,
  storageShelf, laptopStand, displayShelf, spicesRack, wineRack, bookHolder, phoneHolder,
  enclosureBox, slopedOrganizer, capsuleDispenser, calibration, profileBox,
  gearsGenerator, pulley, knob, patternPanel, beam, wallHolder, spool, diceTower, jointPanel, holdfast, slotRack, cradleRack, hook,
  gridfinity, angledCutJig, strapClamp, planetary, frame, chest, canDispenser, gearBox, lightBox];

const byId = new Map(registry.map((g) => [g.id, g]));

export function getGenerator(id: string): Generator | undefined {
  return byId.get(id);
}
