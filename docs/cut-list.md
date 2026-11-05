# Cut list

Generators dropped from a batch rather than shipped half-done, with the reason. Each can be
revisited once the noted prerequisite exists.

## Basic boxes batch

ubox ships since the Flex batch, on the bent-part model (`Part.bend`).

## Lids & hinges batch

### shutter (boxes.py ShutterBox)

Both prerequisites now exist: the bent-part model with living hinges (Flex batch) and angled
finger joints (polygon batch). Still not attempted, for effort reasons:
- the side walls are double, joined by slats with angled finger joints (`a`/`A`/`b`/`B`,
  90/n and 45/n degrees) that form the guide channel round the rounded corner(s);
- the shutter is a moving part riding in that channel, so modelling its closed position (a bent
  part running along the top and down round the corner, inside the channel) and checking the
  clearances is a task of its own.

### sidehinge (boxes.py SideHingeBox)

Not attempted in this batch, for effort reasons; no core prerequisite is missing.
- The box is double-walled on the hinge sides.
- Each hinge side has a bespoke profile edge (`Inner2SidesEdge`, `Outer2SidesEdge`), with a
  rotation clearance (`gap`) and two corner radii derived from the hinge centre.
- The hinge is axle pins through loose discs.
- There are optional Cherry-MX latches plus a 3D-printed button.

Each part is buildable with the tools from this batch (custom sides, interior hinge/slot
joints, loose discs as in integratedhinge). Rebuilding the closed-state 3D layout from the code
alone and checking it fully is a task of its own. Revisit after the batches; leave the latches
out.

## Round / polygon / special batch

angledbox (cut from the basic boxes batch) now ships: the core has angled finger joints (`angledFinger` /
`angledFingerHole`).

### roundedtrapezoidbox (boxes.py RoundedTrapezoidBox)

roundedbox and roundedregularbox ship since the Flex batch. The boxes.py checkout this
port follows has no RoundedTrapezoidBox generator, so there is nothing to port; with the
Flex helpers (`flexWall`, a trapezoid plate with rounded corners) it would be a small job.

### regularstarbox (boxes.py RegularStarBox)

Two identical polygon boxes, the second turned upside down and rotated by 180/n, **interlocked
through slots in the top edges of their walls** (egg-crate crossings at 180/n degrees), so the
closed box is a star. The halves touch only at those oblique crossings and where each half's
walls rest on the other's plate. The harness needs every mate's joint line on both parts' outer
(z = 0) faces; the two crossing walls' outer faces meet `t * cot(180/n)` inside the slot (more
than thickness + play from either outline, e.g. 1.4 t for n = 5), and the resting contacts are on
the plates' inner faces, so the halves cannot be connected through mates (connectivity has no
opt-out). Needs a crossing-slot mate type in the harness (the organizer batches' divider grids want the same
for square crossings). Not attempted further.

## Trays & organizers batch (part 1)

All seven shipped: typetray, traylayout, trayinsert, dividertray, compartmentbox, smallpartstray
and bintray (as "tray"; boxes.py has no TrayBox). The crossing-slot mate (`crossSlot`) asked for
under regularstarbox now exists for square crossings; regularstarbox's oblique crossings still
need their joint line on both outer faces and stay cut.

## Trays & organizers batch (part 2)

All six shipped: drawer, cardbox, dicebox, penholder, keyholder and silverware. silverware is
square-cornered: its flex-wrapped rounded wall can now be built on the bent-part model
but has not been revisited; see docs/differences.md.

## Flex batch

Core: bent-part model (`Part.bend`) and living hinge (`livingHinge`). Shipped: flexbox, flexbox2,
flexbox5, flexbook (simplified, see docs/differences.md), plus the earlier cuts ubox, roundedbox
and roundedregularbox.

### flexbox3 (boxes.py FlexBox3)

Not attempted: besides the flex wall it has a separate lid with hinged side flaps (`g` edges with
1:1 finger settings) and a lid clearance, a distinct mechanism from the latch flap of the other
FlexBoxes.

### flexbox4 (boxes.py FlexBox4)

Not ported: in the boxes.py checkout it draws only the wall and the two sides, although the
sides' bottom edges and the wall's end carry fingers for a bottom plate that is never drawn (an
incomplete generator upstream). flexbox2 covers the same shape with a bottom plate.

## Storage & display batch

All shipped: winerack, spicesrack, phoneholder, laptopstand, bookholder, and both shelves
(displayshelf, storageshelf). Their simplifications are in docs/differences.md:
- spicesrack: no feet, no in-place brackets;
- displayshelf: forward slope only, no dividers, bottom/front panels or sloped top;
- storageshelf: open front only, no retainers, no top/bottom edge styles.

sidehinge (lids & hinges batch above) was not retried in this batch, for time reasons.

## Generic generators batch

The batch covers boxes.py items through generic generators (docs/coverage.md has the full map):
enclosure, slopedorganizer, capsuledispenser, calibration and profilebox. Considered and left out:

### Separate ports of ElectronicsBox / Rack19Box / MagazineFile / SlantedTray / BurnTest

Built first as one-off generators, then folded into the generic ones (presets keep the names).

### FlexTest2, roof overhang for BirdHouse

FlexTest2 (a 2D grid of flex settings on one sheet) would need several hinge patterns per part;
the calibration flex strip tests one setting at a time. A roof overhang needs the roof panels as
plates resting on the gables (slot rows with a brim) instead of profile walls.

### Wall-mounted family (WallRack, WallPliersHolder, ...)

Needs the boxes.py wall edges (French cleat / pin row); not attempted.

### DinRailBox, SideDoorHousing, Console2 hatches

Need latch and spring edges (and the DIN rail profile); not attempted.

## Mechanical, panels and wall-mount batch

Shipped: gears, pulley, knob, patternpanel, beam and wallholder (with the wall-system edges), plus
the harness's `assembly: 'loose'` mode. Not attempted in this batch, in value order:

### Jigs and small parts (AngledCutJig, LaserClamp, LaserHoldfast, Hook, PoleHook, Spool, FilamentSpool, DiceTower, JointPanel, TriangularWall)

All in scope. Each is a flat part or a small jointed set; left for the next batch for time.

### Planetary, GearBox stage plates, gear racks

Planetary needs internal (ring) gear teeth (the involute of an internal gear and its trochoid);
GearBox needs the stage plates and axle layout around gears' pairs.

### Z profile beams

The Z's middle plate has joints on both of its faces; the harness needs joint lines on a part's
outer face.

### Remaining wall-mounted modules (WallCaliper, WallHopper, WallPinRow, WallPlaneHolder, WallRollHolder, WallStairs)

Each needs a bespoke profile on the wall holder's back edge (now available in walledges.ts).

## Jigs, small parts and racks batch

Shipped: spool, dicetower, jointpanel, holdfast, slotrack, cradle; gear racks in gears; a hole
field option on enclosure. Still not built:

### AngledCutJig, LaserClamp, Hook, PoleHook, TriangularWall

AngledCutJig (an angled sled) and LaserClamp (two sliding parts and a screw) need their own
part sets; Hook and PoleHook are bespoke profiles; TriangularWall is a single plate with edge
types (a plate-shape option on the pattern panel would cover its outline, not its edges).

### PirateChest, DrillStand, CanStorage

PirateChest needs a polygon lid on chest hinges (integratedhinge + an angled lid); DrillStand
needs a grid of compartments with per-cell heights (typetray with height steps); CanStorage needs
ramps feeding a dispensing slot. Each is a task of its own.

## Coverage worklist batch

Shipped: `step` on typetray (DrillStand), gridfinity (GridfinityBase, GridfinityTrayLayout,
GridfinityDrillBox bin), angledcutjig (AngledCutJig), strapclamp (LaserClamp stand-in), the
`mount: pole` option on hook (PoleHook) and planetary (Planetary, with internal ring gear teeth).
Still not built, in value order:

### PirateChest, CanStorage

PirateChest needs a polygon (barrel) lid on chest hinges: the integratedhinge hinge parts and
angled finger joints exist, but the lid's polygon side plates and the hinge on an angled lid edge
are a task of their own. CanStorage needs ramps feeding a dispensing slot (the dice tower's ramps
are the starting point).

### Remaining wall-mounted modules (WallCaliper, WallHopper, WallPinRow, WallPlaneHolder, WallRollHolder, WallStairs)

Still each a bespoke side profile or part set on the wall holder's back edge; not attempted.

### GearBox stage plates

The gear pairs and the planetary set exist; the stage plates with axle layouts are still missing.

### Then

RollHolder, Lamp / NightLightBox, RegularStarBox, BreadBox, Display (leaflet stand) and the other
"no" rows of coverage.md. (A generic layered frame now covers PhotoFrame, Shadowbox and, without
its stand, EngravingFrame.)

## Chest, can dispenser, wall styles and gearbox batch

Shipped: chest (PirateChest), candispenser (CanStorage), gearbox (GearBox stage plates), wallholder
`style` hopper / rod and `steps` (WallHopper, WallRollHolder, RollHolder, WallStairs, WallCaliper
preset) and the bookholder "Display (A4 leaflets)" preset. Still not built, in value order:

### WallPinRow, WallPlaneHolder

WallPinRow needs pins standing at an angle through an outset plate (a part set of its own);
WallPlaneHolder a profile that holds a plane on its side. Neither fits the wall holder's bin,
hopper or rod styles.

### Lamp, NightLightBox, TriangleLamp shapes

A generic perforated light box (lightbox) now covers them partially; NightLightBox's layered
picture plates and the shaped lamp shades still need their own profiles.

### RegularStarBox, BreadBox and the other "no" rows

RegularStarBox needs the oblique crossing-slot mate (see above); BreadBox a gliding flex door in
rails (see shutter). Then BrickSorter (typetray with a perforated floor), TriangularWall,
SevenSegmentPattern, FatBallDispenser, Kamishibai and the rest of coverage.md's "no" rows.

## Gear kerf fix and light box batch

Shipped: kerf-robust gear outlines (gears, planetary, gearbox) and lightbox (Lamp, NightLightBox,
TriangleLamp partial). Not attempted this time, in value order: RegularStarBox, BreadBox,
SideHingeBox, BayonetBox, SBCMicroRack, Dispenser, CoinDisplay / CoinBankSafe, TriangularWall,
WallPinRow / WallPlaneHolder, BrickSorter and the remaining "no" rows.
