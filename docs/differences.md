# Deliberate differences from boxes.py

Generators are ported from [boxes.py](https://github.com/florianfesti/boxes) for their logic.
Where boxes-js deliberately behaves differently, it is recorded here (per generator, plus shared
conventions). The automated bounds/edge-count comparison results are at the end.

## Shared conventions

- **Inner/outer sizes**: `inside: true` corresponds to boxes.py `outside: false`.
- **No bed bolts, labels or burn-test extras.** Kerf compensation is applied once per part.
- **Finger-hole slots** (`'fingerHoles'` wall sides and slot rows, boxes.py edge `h`/FingerHoles)
  follow boxes.py: `(finger + play) x (thickness + play)`. The assembly harness accepts a contact
  gap of up to `play` at a mate for this reason.
- **Finger-hole brim** (boxes.py FingerJointSettings `edge_width`) is fixed at one thickness: the
  harness requires the joint line within thickness + play of the outline.

## Shared: cut files and nesting

- **Sheet-edge margin.** Nesting keeps every part `SHEET_EDGE` (1 mm, src/app/profiles.ts) clear
  of each edge of a bounded sheet, so a slightly undersized or skewed sheet does not clip a part;
  a part counts as too large ("unfit") when it exceeds the sheet less both margins. boxes.py has no
  nesting; its parts are packed from the origin.
- **SVG stroke** is a 0.01 mm hairline (boxes.py: max(2 * burn, 0.05) mm, 0.2 mm at its default
  burn; 0.01 mm only for its Ponoko format). Epilog
  and Trotec print drivers only vector-cut strokes this thin (thicker ones raster-engrave);
  LightBurn and similar ignore the width. The in-app sheet view draws its own screen strokes.
- **DXF is always millimetres** (`$INSUNITS` 4), whatever the display units; the SVG carries the
  display units in its width / height. Laser and CAD software read DXF as mm by default, so an
  inch DXF would import 25.4 times too small.
- **No part labels in cut files.** Names appear only in the app's sheet view, placed at the pole
  of inaccessibility of the part's material (the centre of the largest circle clear of every cut
  and engraving) and scaled to fit there, or left out when too small (boxes.py, `labels` on by
  default, writes each label as annotation text at the centre of the part's bounding box).

## openbox (boxes.py OpenBox)

- `edgetype` (`F` finger joints / `h` finger holes) is fixed to finger joints.

## basedbox (boxes.py BasedBox)

- Lid styles of `top_edge` reduced to a finger-jointed top (`top: closed`) or `none`.
- Brim fixed at one thickness (see shared conventions).

## universalbox (boxes.py UniversalBox)

- `top_edge` lid styles reduced to finger-jointed top (`closed`) or `open`; no top-hole rim, no
  hinged/sliding/chest lids (lid generators come in the lids batch).
- `bottom_edge` reduced to a finger-jointed bottom (`closed`) or `none`.
- `vertical_edges` kept: `finger joints` or `finger holes`.

## unevenheightbox (boxes.py UnevenHeightBox)

- No lid (`add_lid`, `lid_height`): the lid is a separate sub-assembly resting on the sloped top
  edges and is left for the lids batch.
- No grooved top edges (`edge_types` z/Z); all top edges are plain.
- `bottom_edge` reduced to a finger-jointed bottom (`closed`) or `none`.

## halfbox (boxes.py HalfBox)

- Sections are equal: `sections` x `y` (section width) instead of the free `sy` list
  ("50:50" is `sections: 2, y: 50`, the default). Middle supports stand in slot rows in the bottom
  and back, declared as interior joints (`PartEdge.holes`).
- The end supports key into notched plate edges. boxes.py places finger holes half a thickness
  from the plate edge, so its slots touch the edge, which is the same cut as a notch; our parts
  must have holes strictly inside the outline.
- Overall width is capped at 5000 mm (ParamError naming `sections`).
- No `Sturdy`, `Clamping` or `Mounting` options.

## Shared: lids & hinges batch (walls.ts)

- `rectangularWall` gained boxes.py's `CompoundEdge` (a side made of pieces, each with its own
  joint line), hand-drawn sides (hinge profiles), the `'outset'` edge (boxes.py `E`) and a
  configurable finger-hole brim (`WallOpts.brim`, declared against the slots).
- **Resting and sliding contacts are flat mates.** A lid that rests on (two-piece, hinge boxes) or
  slides over (sliding lid) a wall is joined to it by a `flat` mate along the line where it rests.
  No new edge type and no harness opt-out were needed.
- Generators in this batch use the category **Lids & hinges**.

## hingebox (boxes.py HingeBox, CabinetHingeEdge)

- Only the `inside` hinge style. No `outside` style, no angled `v`/`V` edges, no `splitlid`.
- Eye radius is limited to 1–2 thicknesses. That is boxes.py's first eye shape; the `e > 2t`
  shape is not ported.
- Eyes per hinge are 3, 5 or 7. An odd count keeps the box and lid layouts as mirror images.
- The eyes are keyed into their walls; the axles (nails) are not modelled.

## integratedhinge (boxes.py IntegratedHingeBox, ChestHinge edges)

- The disc that turns in each hinge ring is cut as a separate part. Its radius is `pin` − play/2,
  so play/2 is left all round. boxes.py cuts it in place with tabs and relies on the kerf for
  clearance.
- The box front and the lid front are outset (plain) over the hinge band, so their finger joints
  match the shorter side walls. boxes.py lays the front fingers out over the full height, which
  does not line up with the sides' fingers.
- The lid sides' concave arc starts at the inner back face. boxes.py adds a hair-thin sliver out
  to the outer face, which ends in a zero-angle cusp.
- No finger joints on the hinge itself: `finger_joints_on_box` and `finger_joints_on_lid` are off.
- With inside off, `h` and `lidheight` are the outer heights of the body and the lid, including
  the bottom and top panels.
- `hingeplay` is at least 0.01 thicknesses: with no play the disc binds in its ring (boxes.py
  allows 0 and relies on the kerf).

## slidinglid (boxes.py SlidingLidBox)

- `bottom_edge` `s` (stackable) is not offered; the choices are finger joints or finger holes.
- The lower rails' back ends butt against the back wall. boxes.py uses a finger joint there, but
  a rail of the default 1.5 thicknesses is too short for one. So the two lower rails are y long
  (220 mm at boxes.py's defaults) where boxes.py's are y + t (223 mm, the finger reaching into the
  back wall); the upper rails match.
- The rail margin has no burn correction; kerf is compensated per part.

## twopiece (boxes.py TwoPiece)

- `hi` is a percentage of `h` (20–100) and cannot exceed it. In boxes.py a taller body lifts the
  lid off the base brim.
- The lid clearance is its own parameter, `clearance` (boxes.py `play`, default 0.15). It is
  separate from the finger-joint play.

## Shared: angled finger joints (core, polygon batch)

- Edges `angledFinger` / `angledFingerHole` (boxes.py `g` / `G`, FingerJointSettings `angle`)
  take the corner turn from `EdgeCtx.angle`. Geometry follows boxes.py `fingerLength`: fingers
  end at the outer corner, `t * tan(a/2)` past the inner corner; spaces are cut back to
  `-t * cos(a) * tan(a/2)`; depth `t * sin(a)`. At 90 degrees they are the plain finger joint.
- **Only corner turns up to 90 degrees** (interior angles of 90 degrees or more). boxes.py falls
  back to plain 90 degree fingers for sharper corners, which leaves the outer corner unfilled; here
  such corners are rejected (`ParamError`).
- Where a wall is cut back inside its inner rectangle (an `angledFinger` side), the neighbouring
  sides' joint lines stop where the material does (boxes.py draws a backwards run there).
- Assembly harness: for angled finger mates with play, contact at a sample point may be found in
  a cross-section up to `play` along the joint line. Beside each finger the notch's play strip
  leaves the two walls up to `2 t cos(a) sin(a/2)` apart in that cross-section (0.5 t at 60
  degrees), although the finger's side face is only play/2 away. With play 0 the check is the
  usual one.

## Shared: bent parts and living hinges (core, flex batch)

- **Bent-part model** (`Part.bend`, src/core/part.ts): one flat cut part placed as flat spans
  joined by circular arcs along its local x (axes parallel to local y). Each arc is given by its
  flat strip (`at`, `length`), turn `angle` (positive bends towards +n, into the box) and the
  radius of the z=0 face; the strip maps to the arc uniformly. boxes.py has no 3D model at all;
  cut files are unchanged (bent parts are cut flat).
- **Living hinge** (`livingHinge`, src/core/livinghinge.ts, boxes.py `X` FlexEdge with
  FlexSettings distance / connection / width / stretch) is a set of closed slit holes strictly
  inside the part: boxes.py runs every other line's end dashes out to the strip's edges (open
  slits); here the dashes stop `connection / 2` short of the long edges, so the outline stays
  whole. Slits are rectangles `kerf + 0.1` mm wide (nominal), i.e. after kerf compensation a
  0.1 mm cut loop.
- **Stretch** is applied consistently: the flat strip of an arc is (arc length at the wall's
  inner face) / `stretch` (boxes.py `surroundingWall`). This boxes.py convention is kept on
  purpose: with stretch > 1 the cut strip is *shorter* than the inner arc (the slit pattern opens
  up when bent); it is not lengthened to arc * stretch. In boxes.py only `surroundingWall` (used by
  RoundedBox) divides by stretch; FlexBox, FlexBox2, FlexBox5, UBox and RoundedRegularBox use the
  unstretched arc length. So at the default stretch 1.05 our walls in those five are shorter by
  (total arc length) × (1 − 1/1.05), 2 to 8 mm at boxes.py's defaults; with `flex_stretch` 1 they
  match boxes.py to 0.1 mm (checked: FlexBox 350.25, FlexBox2 217.1, FlexBox5 249.6 mm). Applying
  stretch everywhere is deliberate: the hinge pattern does stretch when bent, and the 3D model
  wraps the strip exactly round the plates (strip = inner-face arc / stretch on every arc).
- A living hinge needs at least two slit lines: its strip must be at least 3 line spacings long
  (`flex_distance` * thickness each); shorter strips raise a ParamError (the radius-like param,
  or `flex_distance`). boxes.py draws whatever fits, down to a single line.
- Assembly harness: bent parts are sampled through the bend (interpenetration, bounding box).
  A mate's joint lines must coincide as world curves (not only at their ends) when either part
  is bent; cross-sections for the contact check stay within the flat span (or the line x =
  const of an arc) through the sample point, so material beyond a bend never counts as contact.
  Because the bent-part model maps any strip length uniformly onto its angle, the harness also
  bounds each strip independently: strip / (inner-face radius * angle) must lie in [1/1.3, 1]
  (1 / stretch, with `flex_stretch` limited to [1, 1.2] plus margin), so a strip built from the
  wrong radius, angle or face fails.

## Shared: polygon batch

- Generators in this batch use the category **Polygon & special**.
- Polygon boxes (regularbox, angledbox) are built by one helper (`polygonbox.ts`): every wall has
  the same `g` ... `G` ends (boxes.py alternates `gg`/`GG` walls for even counts), and the walls'
  bottom/top fingers go into notched plates that reach the walls' outer faces.

## regularbox (boxes.py RegularBox)

- `n` is 4–12: a triangle's corners are too sharp (see angled finger joints).
- Straight walls only: one `radius` (boxes.py `radius_bottom` = `radius_top`), so no tapered
  (frustum) boxes.
- `top` is none / closed / hole (a rim one thickness wide); `bottom` is closed / none. No angled,
  round or bayonet lids.
- With inside off, `radius` is the outer corner radius and `h` the outer height, as in boxes.py.

## angledbox (boxes.py AngledBox)

- The walls' fingers go into a notched floor (boxes.py: the floor's fingers go into the walls'
  bottom edges, `bottom_edge`). No `bottom_edge` choice; `bottom` is closed / none.
- `top` is none / closed / hole (rim); no angled lids.
- When `x < y` the cornered ends are along y; boxes.py swaps x and y so x is always the long side.
- The outer size is exact: for even `n` a corner, not a side, is at the x extremes and adds
  `t / cos(180 / (2n + 2))` per end (boxes.py's `adjustSize` subtracts t).
- **Outer height.** With `inside` off, `h` is the outer height here. boxes.py's default
  `bottom_edge` is `h` (finger holes: the floor sits inside the walls, which run a one-thickness
  brim below it, edge width t + t), but its `adjustSize(h, False)` subtracts only one thickness for
  the bottom, so at its defaults (outside, h = 100) its walls are 103 mm tall: the box comes out
  one thickness taller than asked. Our walls stand in a notched floor and are exactly h tall. This
  is the 100.2 vs 103.2 mm in the automated comparison.

## stackablebin (boxes.py StackableBin)

- Sections are equal: `sections` x `x` (section width) instead of the free `sx` list. With inside
  off, `x` is the overall width.
- No bottom stabilizer strips and no label strip ("EEEE" parts).
- Finger margins use the common surrounding spaces (2), not 0.5: with 0.5 a divider slot in the
  retainer can reach the retainer's cut-back angled bottom edge.
- The outer depth (inside off) counts the retainer's thickness (`t / sqrt 2` in front of the
  slant); boxes.py's `adjustSize` does not.
- **Stacking clearance**: the recess between a bin's feet is max(play, 0.1 t) longer in total than
  the stacking tongue on the bin below (each foot narrower by half of it), so stacked bins seat
  without binding. boxes.py draws feet and tongue the same size.

## Shared: trays & organizers batch (part 1)

- Generators in this batch use the category **Trays & organizers**.
- **Crossing slots** (boxes.py SlottedEdge `slots`, egg-crate walls; divider tabs in wall slots)
  are declared with the new self-complementary edge type `crossSlot`, which must be mated. Its
  joint line is the two plates' common line where their slots meet, about two thicknesses long
  (it hugs both outlines). Contact, interpenetration and connectivity are checked as for any mate.
- **Crossing slots are t + play wide on both halves** (centred on the crossing panel), so the
  half-lap slides together with the joint play: egg-crate walls (typetray, trayinsert),
  dividertray, laptopstand, bintray's shelf and divider halves (the divider's slot in its sloped
  front profile included). boxes.py cuts every crossing slot exactly one thickness wide and relies
  on the kerf. With `play` 0 (the default) the slots are one thickness, as in boxes.py.
- Schemas gained a `text` param kind (comma-separated size lists, traylayout). Its `examples` feed
  the fuzz harness.
- Compartment grids are equal-sized (x, y per compartment and a count) except in traylayout, which
  takes relative size lists. boxes.py takes free `sx` / `sy` lists everywhere.
- Panels are placed in world space and joints are derived from where the joint lines are
  (`trays.ts`: `slotInto`, `crossing`, `autoMate`); the harness checks every mate independently.

## typetray (boxes.py TypeTray)

- `hi` (inner wall height) is a fraction of `h` (0.2–1). Inner walls are never higher than the
  outer walls (boxes.py allows that with compound side edges).
- Top edge always open: no lids, no `back_height`/`radius`, no `handle` (bottom 'Y' edge), no
  compartment labels.
- `bottom` on/off. On: a finger-jointed floor; the walls' bottom edges are notched (boxes.py
  `bottom_edge` 'h' puts finger holes in the walls).
- Finger cut-outs (boxes.py FingerHoleEdge 'A'): `fingerhole_depth` is a fraction of the inner
  wall height (default 0.5). The width (0.3 of the compartment) and the 10 mm radius cap are
  boxes.py's.
- The grip hole is over the middle compartment (boxes.py centres it on the wall, which with an even
  number of columns cuts an inner wall's slot row). `gripwidth` is a fraction of that
  compartment's width and `gripheight` a fraction of the wall height (boxes.py: mm).

## traylayout (boxes.py TrayLayout / TrayLayout2)

- boxes.py's two-stage text layout (generate ASCII art, edit it, build from it) is replaced by a
  schema: overall `x`, `y`, `h` plus `cols` / `rows`, or the optional lists `sx` / `sy` of relative
  column / row sizes ("2,1,1"); a non-empty list overrides the count. The inner space left after
  the walls is split in those proportions, so the outer size is always exactly the params.
- Every grid line is a full wall (crossing the others in half-height slots, as typetray). Removing
  single wall segments (TrayLayout2's free layouts, non-continuous walls) is not supported.
- Same options as typetray (floor, inner wall height, finger cut-outs, grip hole).

## trayinsert (boxes.py TrayInsert)

- Equal compartments over the given `x`, `y` (cols x rows, at least 2 x 2 so the dividers cross)
  instead of `sx` / `sy` plus margin walls when `x`, `y` are larger.
- No `draft_angle` (the divider ends are square).
- **Fit clearance**: `x`, `y` are the inside of the box the insert drops into, and the insert is
  `clearance` (mm, total, default 0.5) smaller in each: its outer size is x − clearance by
  y − clearance. boxes.py makes the insert exactly x by y, which binds in a box of that inside
  size. (The automated comparison shows 149.7 vs 150.2 mm for this reason.)

## dividertray (boxes.py DividerTray)

- Equal columns and rows instead of `sx` / `sy` lists (no "0:" / ":0" end slots).
- Only the spanning divider is modelled (one divider per slot row across all columns, its tabs
  through the outer side walls flush with their outer faces); boxes.py also draws per-column
  dividers with full, half or asymmetric tabs to choose from.
- Vertical slots only (no `Slot_angle`), no rounded slot entrance (`Slot_radius`).
- `slot_depth` and `notch_depth` are fractions of the height (boxes.py: 20 mm and 15 mm). Notch
  radii are boxes.py's (1 mm / 8 mm), capped by the depth.
- Slot slack is the common `play` (default 0.05 here; boxes.py `extra_slack` 0.2 mm); below the
  tabs the divider clears each wall by play / 2 (boxes.py `Divider_play`).
- Both outer side walls are always present; no `handle`, no lid.

## compartmentbox (boxes.py CompartmentBox)

- Equal compartments; always a finger-jointed floor (no stackable or plain bottom).
- Split lips only (no one-piece lip); `holes` is one grip hole as a fraction of the lid width
  (boxes.py: a list of percentages).
- The lid is modelled resting on the inner walls and the front wall (boxes.py centres it in the
  vertical margin); a flat mate joins it to the front wall.

## smallpartstray (boxes.py SmallPartsTray)

- Equal compartments (`x`, `cols`) instead of an `sx` list.
- Always a front panel: without it boxes.py's ramp ends and their slots stick out of the side
  walls. `angle` is limited to 30–80 degrees; steeper ramps in thick material are rejected
  (`ParamError` on `angle`) when their slots would break out of the side walls.
- No loose sliding dividers (two-sided), no lid.
- The floor is shortened so it keeps room for a finger joint (boxes.py: a thickness).

## bintray (boxes.py BinTray)

- Equal columns and rows (`x`, `h`) instead of `sx` / `sh` lists; the front geometry is
  stackablebin's single bin row repeated per row.
- The retainers' and shelves' angled finger joints run continuously across all columns (boxes.py
  interrupts them at each divider with a flat gap).
- No mounting holes (`hole_dD`).
- The shelf / divider crossing has play on both halves: the shelf's slot and the divider's slot
  in its sloped front profile ('B') are each t + play wide, centred on the other panel (boxes.py:
  both one thickness).

## Shared: trays & organizers batch (part 2)

- Clearances that a moving part needs are their own parameters with a minimum above zero:
  the drawer's `clearance`, and the card box lid's `lid_clearance` (sides) and `margin_t` (above).
  The common finger `play` stays a joint setting.
- Parts that rest on or are glued to others without a joint are joined by flat ("rests on") mates
  on the line where they touch, as in the lids batch. Where that line lies on a part's inner face
  the joint line says so (`face: 'inner'`): the drawer's front corner columns on the frame bottom's
  inner face at its front edge, the card box lid's underside on its front wall's top and its glued
  inner sides on the floor's inner face.
- `inside` means the inside of the part that holds things (the drawer, not its frame).

## drawer (boxes.py SlidingDrawer)

- `clearance` (multiples of thickness, default 0.15 as boxes.py `play`) is a separate parameter.
- With inner dimensions, x, y, h are the drawer's inside. boxes.py adds 4t + 2p to the frame's
  inner size, which makes its drawer 2t larger than asked.
- The drawer's corners follow closedbox: the front and back own the corner columns and the bottom
  is fingered on all four sides (boxes.py: the bottom is notched along the sides).
- A rounded grip hole near the top of the drawer front instead of the grooved top edge ('z').
  `grip_width` / `grip_height` are maxima: on a narrow or low front the hole shrinks to leave one
  thickness of material round it (earlier versions rejected such fronts, including boxes.py's
  default 60 x 100 x 30 drawer).
- `hi` (the lower side and back walls) is a fraction of the front's height; within 0.5 mm of the
  front it is taken as the front's height.
- Modelled closed: the drawer rests on the frame bottom with its front flush, so the clearance is c
  at each side and 2c above and behind it.

## penholder (boxes.py PenHolderBox)

- `plate1_offset` is in thicknesses and `plate_gap` is a fraction of the room below the top plate
  (boxes.py: both in mm). This keeps the lower plate inside the walls for any height.
- The cap diameter is given as a margin over the pen hole (`cap_margin`; cap = hole + margin, also
  the hole pitch), so the holes cannot merge. The grid must fit the plate (`nx`, `ny` errors);
  boxes.py only checks it and draws anyway.
- `bottom` is a switch (finger-jointed floor or none) instead of a choice of bottom edge.

## keyholder (boxes.py KeyHolder, HangerEdge)

- Optional plain round screw holes in the top padding instead of keyhole mounting slots ('G').
- The hooks' finger joints use the common finger settings; boxes.py defaults this generator to
  finger = space = 1 with no surrounding spaces.
- The hanger profile needs hook_thickness < 0.4 hook_height (and hook_height >= 16 mm for its
  1.5 mm inner radii); boxes.py draws a self-intersecting hook otherwise.

## cardbox (boxes.py CardBox)

- Opening direction "front" only; no lid topper.
- Lid clearances are parameters: `lid_clearance` at each side (boxes.py: 0.1 t) and `margin_t`
  above the lid (boxes.py: none). The side walls are `margin_t` taller.
- The grip rail is as wide as the lid and stands on the front wall between the corner columns
  (boxes.py's rail, "Lid Lip" `fEeE`, has outset ends that would sit on the corner columns,
  colliding with them once there is a vertical margin). So the rail is 2t shorter than boxes.py's
  (274.6 vs 280.6 mm at its defaults).
- The lowered front top dips by t + margin_t. Heights where the side walls' top finger would cut
  into that dip are rejected (`h`).
- The finger cut-out is 20 mm wide with 10 mm radius as boxes.py; `deep` is h - t - 10 mm.

## silverware (boxes.py Silverware)

- Square corners: boxes.py wraps the outer wall round the corners as one flex part
  (`cornerradius`). Bent parts are not modelled yet (see the ubox entry in cut-list.md).
- Divider counts per side are parameters (`front_compartments`, `back_compartments`, equal
  compartments). boxes.py has three dividers at fixed positions (x/3 and 2x/3 on one side, x/2 on
  the other: the defaults 3 and 2). A back divider within 2t of a front divider butts flat against
  the centre wall instead of fingering through it.
- `inner_drop` (boxes.py: fixed 10 mm) sets how much lower the dividers and the centre wall below
  its handle are.
- The handle corner radius is min(30 mm, handlewidth / 2.5, (handleheight - t) / 4) so the handle
  always fits; the grip hole starts a thickness above the dividers' tops, clear of their slots.
  The Bezier shoulders are flattened to line segments.

## dicebox (boxes.py DiceBox)

- The hinge is integratedhinge's, with its differences (separate discs, outset fronts over the
  hinge band, no finger joints on the hinge, `hingeplay` > 0).
- The plates are the box's top and the lid's bottom, as in boxes.py, and touch in the hinge axis
  plane when the lid is shut, so the magnets meet. They are fingered into the box front and back
  (notched top edges) and the lid front and back (notched bottom edges, the lid back between its
  pins); their sides are plain, between the side walls, which end lower under the hinge band.
  boxes.py also fingers them into the side walls using ChestHinge's finger-jointed variant, which
  is not ported.
- The box height is derived from the dice: inner h = `dice_height` + `dice_clearance` (boxes.py
  has a free `h`, so dice can rattle or not fit). The tallest die stands on the bottom with its top
  `dice_clearance` below the lid plate, inside the box plate's hole; `dice_clearance` is at most
  half the thickness so the box plate holds at least half its thickness of the die.
- The lid plate has magnet holes only, no dice holes, so it caps the dice. In boxes.py the dice
  reach through the lid plate into the lid and only the lid top stops them.
- The hexagon corner radius is limited to 0.9 of the apothem. Magnet holes that would meet a dice
  hole are rejected (`magnet_diameter`); 0 gives none.

## Shared: flex batch

- Generators in this batch use the category **Flex**. All flex walls are built by `flexWall`
  (src/generators/flexwall.ts): one bent part whose long edges sit one thickness outside the
  plates' inner faces, notched ('F') where the plates have fingers, plain elsewhere.
- Living hinge settings are params (`flex_distance`, `flex_connection`, `flex_width`,
  `flex_stretch`, boxes.py FlexSettings); a wall with more than 6000 slits is rejected
  (`flex_distance`) to keep cut files and the 3D view manageable (a 300 mm cube roundedbox
  with radius 100 in 3 mm material, about 4100 slits, is accepted; a 1000 mm one with radius
  300, about 40000, is not).
- Radii are clamped (as boxes.py does) so every fingered straight part keeps 3 * thickness;
  boxes.py only keeps them >= 0 and merges two hinges when the straight part between them
  vanishes.
- Latches (flexbox, flexbox2, flexbox5): the box side's bump and the door flap's notch follow
  boxes.py `latch`; the door's grip is a plain edge.
- Plain resting contacts (e.g. the lid part of a FlexBox wall on the side plates' top) are flat
  mates, as in the lids batch.

## flexbox (boxes.py FlexBox)

- Profile x * y with four rounded corners, h between the side plates; world: x along X, y up,
  h along Y. The wall's flex strips are shortened by `stretch` (boxes.py FlexBox: unstretched,
  see "Shared: bent parts and living hinges").
- The wall is h + 2t high everywhere. boxes.py's door end carries a latch grip (`_latchGrip`) that
  stands out t/2 above the wall (101.7 vs 100.2 mm at its defaults; also FlexBox2 and FlexBox5);
  ours is a plain edge (see "Shared: flex batch").

## flexbox2 (boxes.py FlexBox2)

- Top corners rounded; `inside: false` subtracts 2t from every size (the bottom plate and the
  wall top both count).

## flexbox5 (boxes.py FlexBox5)

- `x` is raised (boxes.py raises it too) so the upper straight keeps latch + 3t; the outer size
  is the hull of both round ends grown by t, which exceeds r1 + l + r2 when one end overhangs
  the other.

## roundedbox (boxes.py RoundedBox)

- One wall piece (no `wallpieces`); its ends butt in the middle of the front instead of a
  dovetail. boxes.py's `surroundingWall` applies the stretch like ours; its wall is still about
  5 mm longer (350.9 vs 345.8 mm at its defaults) because of the dovetail ends ('D' / 'd') and the
  burn added to its arc radius. One compartment (no `sh` list of shelf heights). Edge style 'f' only. Top: closed or
  a rim with an opening inset 2t (no loose lid).

## roundedregularbox (boxes.py RoundedRegularBox)

- One wall piece (boxes.py defaults to one per side, dovetailed); ends butt in the middle of
  side 0. The wall's flat length is n * s + (2 pi r) / stretch (s the straight side, r the corner
  radius at the wall's inner face): 525.7 mm at the defaults, 530.2 mm with stretch 1, which is
  exactly boxes.py's five pieces (side + r * 72 degrees each) end to end. The comparison's 566.5 mm
  for boxes.py is the bounding box of its five pieces drawn side by side in one group, with their
  dovetail ends and the spacing between them, not a longer wall. Top: closed or rim (no loose lid). No `inside` option (as boxes.py: inner sizes).

## ubox (boxes.py UBox)

- No lid / top-edge options: the top is open with plain edges.

## flexbook (boxes.py FlexBook)

- Simplified: no latch (brackets, pin, cover holes) and no recess in the inner wall; square
  cover corners; the hinge is the stretched half circle (boxes.py adds one thickness). The
  compartment is fore-edge wall to inner wall, x wide; the side plates' straight part is x + t.

## Shared: storage & display batch

- Category "Storage & display". Thickness is limited to 10 mm where thicker stock leaves no room
  for the joints of a piece of this size (all but laptopstand and storageshelf).
- Plates that lean or slope (laptop stand, display shelves, book holder, phone holder) are placed
  exactly in 3D. Where two plates meet in a valley or a lip, the joint line is declared where
  the two show faces meet. The 2D outline still follows boxes.py's corner convention.

## storageshelf (boxes.py StorageShelf)

- Built as typetray's grid tray stood on its back, so the back, bottom, top and sides are all
  finger-jointed and the shelves and dividers cross in half-depth slots.
- Open front with plain edges; no top or bottom edge styles, no lid and no retainer walls.
- Columns and rows are counts, or relative lists (`sx`, `sh`) of the overall size. boxes.py uses
  absolute lists.

## displayshelf (boxes.py DisplayShelf)

- Shelves slope down to the front only (0–45°; boxes.py also allows negative angles).
- No dividers (`sx`), no bottom or front panel, and no sloped top.
- The layout comes from the corners. Each lip keeps a thickness from the side walls' front edge
  and each shelf one from the back. Shelves are spread evenly between `bottom_distance` and
  `top_distance`, and each needs its own height plus a thickness above it (`num`, `h` errors).
  boxes.py's offsets differ slightly.
- A lip lower than 3t has plain sides: there is no room for fingers into the side walls, so it is
  held by the shelf's fingers alone. A lip height of 0 leaves the shelf's front edge plain.

## laptopstand (boxes.py LaptopStand)

- The outline is computed from its vertices, so it always closes. boxes.py approximates the
  45° recess run as 7 mm and the slot depths with 3.5 mm. The nub corners are sharp; boxes.py
  rounds two of them with r = 1 mm.
- The plates cross at the middle of the top edge's span. The slots meet halfway between the
  bottom recess and the top edge.
- Sizes where the slots would cut into the feet (`l_depth`), the plates are too low for the
  slots (`ground_offset`) or the nub would reach the ground (`nub_size`) are rejected.

## spicesrack (boxes.py SpicesRack)

- No feet and no in-place brackets: the brackets are always separate parts under the shelves.
- The can holes are centred on the cans. boxes.py shifts them by d(1 − cos 10°)/2. Holes that
  would break out of the scalloped front edge are rejected (`can_space`).
- The can spacing is `can_space`: `space` is the finger-joint setting here.
- The back's top margin is at least 9 mm and the hanging holes at least 3 mm from the corners,
  so the 3 mm holes stay inside thin backs. boxes.py uses 6t and 3t.

## winerack (boxes.py WineRack)

- The wall sets are defined per cell. `all`: every edge of every cell. `no_verticals`: the
  slanted edges. `minimal`: the two slanted edges under each cell, where a bottle rests.
  boxes.py's loops differ at the outermost cells of some rows.
- The cover over the front plate is part of the assembly, resting on the front plate (a flat mate
  on its inner face).
- At most 48 walls, plates up to 600 mm. Larger racks raise an error on `radius`; build several
  modules instead.

## bookholder (boxes.py BookHolder)

- `radius` is in mm and may be 0. boxes.py: a negative value means one thickness.
- The back plate's side joints stop t·tan(angle) + t short of its top, where the side wall's
  corner is 90° − angle wide. boxes.py notches right into that acute corner, which can cut
  through it. At steep angles the back plate's top stands slightly out of the side walls'
  profile, as in boxes.py.
- Errors: plates that would reach the floor or the stretcher (`bottom_support`), a stretcher
  deeper than the side walls (`back_support`).

## phoneholder (boxes.py PhoneHolder)

- The support spacing is at least the cable cut-out plus a thickness. boxes.py allows the
  cut-out alone, whose sides then run into the support notches.
- Sizes are rejected where the tab runs past the plate's top or is too short for its rounded
  ends (`tab_size`), the supports would leave less than 2t at the plate's sides
  (`bottom_support_spacing`), or the bottom margin is too small for the cut-out (`bottom_margin`).

## Shared: generic generators batch

- boxes.py items are covered by **generic generators with presets** named after the boxes.py
  generator (see docs/coverage.md), rather than one port per item.
- `prismBox` (polygonbox.ts) now takes a different angled-finger turn per corner
  (`rectangularWall` option `angles`); corners still turn by at most 90 degrees. RegularBox and
  AngledBox output is unchanged.

## enclosure (boxes.py ElectronicsBox, RackBox, Rack10Box, Rack19Box)

- One generator; `front` picks a plain wall or a 19" / 10" rack panel, `mounts` flanges, inside
  holes or none, and `vents` adds slots to the side walls (new).
- Mounting flanges have square corners (boxes.py rounds them with radius `holedist`).
- Rack panels follow EIA-310 exactly: 482.6 / 254 mm wide, units * 44.45 - 0.79 mm tall, slots
  on the 465.1 / 236.5 mm hole spacing 6.35 mm from the top and bottom of the rack space. boxes.py
  uses 17 mm ears beside a 448 / 219 mm body and slots 8.5 mm from the panel edge, 6 mm up.
- The rack panel is exactly as tall as the box (boxes.py: one thickness more).

## slopedorganizer (boxes.py SlantedTray, MagazineFile, NotesHolder)

- Equal compartments (count and width) instead of a size list; the front height is a fraction of
  the back height.
- MagazineFile: the side walls are fingered into the front, back and bottom (boxes.py: the walls
  are fingered into the sides); no mounting holes or 'G' top edge.
- NotesHolder: approximated by a full-height front with rounded grip cut-outs. boxes.py splits the
  front into pieces with full-height openings, adds a U-slot in the bottom and stackable feet.

## capsuledispenser (boxes.py CoffeeCapsuleHolder)

- Screw hole sizes are params (boxes.py: 7 mm in the front plate, 3.5 mm otherwise). The plates
  are mated face to face in 3D.

## calibration (boxes.py BurnTest, FlexTest)

- Kerf compensation is one value per part in boxes-js, so the fit test cannot vary the burn per
  side as boxes.py BurnTest does. It varies the **clearance** instead: a gauge strip with `count`
  notched sections, section i `clearance + i * step` mm looser, and a finger tab per section;
  the best fit gives `play` (clearance / thickness) or a kerf correction (kerf - clearance / 2).
  Sections and tabs are numbered with engraved ticks (no text engraving); the tab part names give
  the clearance. No uncompensated reference rectangle.
- Flex mode: a strip with 10 mm plain ends and a living hinge (boxes-js closed slits, see the
  flex batch notes), shown bent by `bend` degrees.

## profilebox (boxes.py Console, BirdHouse)

- Console: defined by the front height, panel angle and the fraction of the depth the panel covers
  (boxes.py: back height and angle, the panel shrinking to fit). Every corner turns by at most 90
  degrees, so the panel must leave a level top.
- BirdHouse: roof pitch at most 45 degrees; no roof overhang (the roof panels are profile walls
  fingered into the gables like the rest); a round entrance hole instead of boxes.py's large
  rectangular windows; the floor is fingered into the gables (boxes.py: slot rows with a brim).

## Shared: mechanical, panels and wall-mount batch

- Generators may declare `assembly: 'loose'` (core `Generator`): their parts are separate pieces
  shown together (a meshing gear pair, a stack of layers) and need not be connected through mates.
  The harness then skips only the connectivity check; valid parts, kerf, declared mates,
  interpenetration, presets, fuzz and expectedSize all still apply.
- Round parts (pulley, knob) are stacks of identical-axis layers, shown touching face to face.
- Shaft bores: round, D (one flat 0.1 d deep) or hex (d across the flats), shared by gears,
  pulleys and knobs (`src/core/gear.ts`).

## gears (boxes.py Gears)

- Kerf-robust outlines (shared by gears, planetary and gearbox): flank samples are thinned to
  segments of at least max(0.4 mm, 0.3 m) where the dropped samples only take material away (or
  lie in the 0.25 m tip-clearance band at the root), so kerf compensation's mitres cannot collapse
  them; where a tooth gap at the root is narrower than the beam (small modules, undercut pinions)
  the root is filled up to where the gap is 1.2 kerf + 0.02 mm wide (always inside the clearance
  band, so meshing is unaffected). The ring gear's flanks are thinned the same way.

- ISO 53 full-depth teeth (addendum m, dedendum 1.25 m), no profile shift. The root is generated
  by the basic-rack cutter's tip corner (undercut trochoid, made 0.003 mm conservative), so pinions
  below 17 teeth are undercut and a meshing pair never interferes; the tip is an arc of the tip
  circle; no root fillet radius. boxes.py has profile shift, spokes and racks.
- Backlash is a circular backlash split evenly between the two gears.
- A pair is shown meshed at the standard centre distance.

## pulley (boxes.py Pulley)

- Tooth spaces are simplified shapes (U groove for GT2/HTD, 40-degree trapezoid for T/MXL) from
  the belts' nominal pitch, pitch line offset, tooth height and width, plus `clearance`. boxes.py
  interpolates measured profiles.
- Width is in layers of material (rounded up); flanges are separate layers.

## knob (boxes.py WavyKnob, ConcaveKnob)

- One generator with wavy, concave, polygon and round rims; a stack of layers with an optional
  closed cap and an engraved pointer. No hex nut pocket.

## patternpanel (boxes.py HolePattern, FanHole, NemaPattern, SkadisBoard)

- Fixed lattices (square, hex, squares, slots, Skadis); the field is clipped to the plate less
  the margin (or a circle) and kept one web clear of mounting holes. Fan grilles are a hole field in
  the aperture (boxes.py also has spiral and ring grilles). At most 1500 holes.
- Fan screw spacing and NEMA 17/23 patterns use the standard dimensions.

## beam (boxes.py LBeam, ZBeam, NemaMount)

- L and U profiles only: in a Z profile the middle plate has its two corners on opposite faces,
  and joint lines must lie on a part's outer face.
- NemaMount: gussets go through slot rows one thickness in from each end (boxes.py: at the ends);
  the base has two round screw holes (boxes.py: slots).

## wallholder (boxes.py wall-mounted family, walledges.py)

- One generic holder: back plate, sloping side walls, bottom, front, compartments or a tool
  plate (holes or slots). The side walls' back edges carry the wall-system hooks (walledges.ts).
- Hook profiles are simplified: a 45-degree French-cleat tongue, J hooks for slat wall (101.6 mm
  pitch), Skadis (40 mm pitch) and DIN rail (a hook behind the top lip and a snap hook under the
  bottom lip, 35 mm apart). boxes.py has springs, studs and reinforced variants.
- No wall cleat, rail or board parts are generated; the back plate is two thicknesses wider than
  the box each side; compartments only without a tool plate.

## Shared: jigs, small parts and racks batch

- gears gains a straight rack (`rack_length`): the basic rack itself (addendum m, dedendum
  1.25 m, tooth thinned by half the backlash), meshing under gear 1 and running to the left, away
  from a second gear. boxes.py draws racks in its gear module with its own options.
- enclosure gains an optional hole field (`panel_holes`: lid, front or back) from the pattern
  panel's lattices, kept clear of the lid screws and below the triangles' slot rows; off by
  default.

## spool (boxes.py Spool, FilamentSpool)

- A drum of two flanges joined by flat staves fingered through slot rows (boxes.py Spool: a
  polygon core of walls; FilamentSpool: two bayonet-locked halves). The core size is a fraction of
  the flange diameter. No reinforcement rings or bayonet.

## dicetower (boxes.py DiceTower)

- The tower's height follows from the ramps: each ramp's low end sits one dice clearance above the
  high end of the ramp below, plus `headroom` at the top (boxes.py: height and ramp count given).
  Ramps clear the walls by one thickness at their ends; the bottom is always present.

## jointpanel (boxes.py JointPanel)

- Straight-sided dovetails, `clearance` narrower than their sockets; the grid is the fewest tiles
  that fit the maximum tile size. The tiles are a loose assembly lying in the panel's plane.

## holdfast (boxes.py LaserHoldfast)

- boxes.py's last run (shaftwidth - sin(15) hookheight) misses the start point by a fraction of a
  millimetre; the outline is closed with a straight line back to the start instead. Hooks taller
  than the shaft allows are rejected (`hookheight`). Several can be cut at once (`count`).

## slotrack (boxes.py DiscRack)

- Items stand upright in notches across two level rails between end plates (boxes.py leans the
  discs back on rails at an angle). Optional ground-clearance check for round items (`item_d`).

## cradle (boxes.py BottleStack)

- Two cradle plates with circular hollows joined by two stretchers under the end ridges (boxes.py:
  interlocking front pieces and beams with a "double" option).

## hook (boxes.py Hook)

- A J-shaped profile cut flat (one piece per hook; glue several for thickness) with a half-circle
  bend and round ends, screwed through the back strip. boxes.py Hook is a box-shaped hook with a
  rectangular mouth built from several finger-jointed plates.
- `mount: pole` (boxes.py PoleHook): the back strip ends in a closed ring that slides onto a pole
  or rail, in the plane of the profile; boxes.py PoleHook clamps onto the pole with a screw.

## Shared: coverage worklist batch (DrillStand, Gridfinity, jigs, Planetary)

- **Stepped walls** (`steppedWall`, walls.ts) draw a wall whose top steps between segments; the
  grid tray (`gridTray`, typetray.ts) uses them for `rowStep`. Slotted sides accept one slot depth
  per gap (`slottedSide`).

## typetray step (boxes.py DrillStand)

- One height step per row (`step`, front row lowest) instead of boxes.py's per-row heights list
  and the extra sloped rise across the columns. Inner walls scale with the row they belong to
  (`hi` fraction); each inner x wall is as tall as the row behind it. The inner y walls step on
  the front face of each x wall; the outer side walls step one thickness further forward, so the
  x walls' slot rows keep a brim. Crossing slots meet at half the lower row's inner height.

## gridfinity (boxes.py GridfinityBase, GridfinityTrayLayout, GridfinityDrillBox)

- Baseplate: a grid plate with rounded square openings (`pitch - web` wide) over `layers` solid
  plates; magnet holes (four per cell, 13/42 of the pitch off centre, or closer in when the cell
  is small) only in the first bottom plate. No outer frame walls (boxes.py `h`), no pads cut-outs.
- Bin: a finger-jointed typetray body `n x pitch - 0.5` mm outside, equal compartments, one foot
  plate (the opening less `foot_play`) per cell glued under the floor. No stacking lip, no label
  shelf; feet are one layer (the depth of the baseplate's grid plate).
- Both modes are loose assemblies (glued stacks); the bin's tray itself is fully jointed.

## angledcutjig (boxes.py AngledCutJig)

- A wedge sled: bottom plate, sloped top plate the slope length long, triangular ribs fingered
  through slot rows in both plates, and a glued stop strip across the low end. boxes.py's jig
  is a box-like sled with adjustable fences.

## strapclamp (boxes.py LaserClamp)

- A different mechanism: a strap (step) clamp, a slotted bar on a heel of stacked plates, tightened
  by a bolt through the slot. boxes.py LaserClamp is a scissor-like clamp with a threaded rod.

## planetary (boxes.py Planetary)

- Internal ring teeth: the tooth spaces are bounded by the same involutes as an external tooth
  (space width pi m / 2 plus half the backlash on the pitch circle), tips at r - m, roots at
  r + 1.25 m, radial below the base circle; no profile shift. Ring and pinion must differ by at
  least 12 teeth (tip interference; the planets always do, ring - planet = sun + planet >= 16).
- Planets go to the meshing angles (multiples of 360 / (sun + ring) degrees) nearest even
  spacing, so any count meshes; boxes.py requires the assembly condition. Neighbouring planets
  must clear each other's tips by 1 mm (`planets`). Backlash is at least 0.05 mm.
- An optional carrier plate (axle holes for the planets and the sun's bore) is stacked under the gears;
  no ring mounting holes, no output stage plates (stacked spur stages are the gearbox generator).

## frame (boxes.py PhotoFrame, Shadowbox, EngravingFrame)

- One generic layered frame: back (with an optional hanging slot), depth layers with the visible
  opening, holding layers with the picture-sized opening plus clearance, and the front with a lip.
  No mat/glass size split (one clearance), no separate stand or easel back (EngravingFrame's stand),
  no light channel for the shadow box; layers are glued, not finger-jointed.

## Shared: chest, can dispenser, wall styles and gearbox batch

- New generic generators: chest (PirateChest), candispenser (CanStorage) and gearbox (GearBox);
  wallholder gains `style` (hopper, rod) and `steps` (WallHopper, WallRollHolder / RollHolder,
  WallStairs, WallCaliper preset); bookholder gains a leaflet "Display" preset. New params default
  to the previous behaviour.

## chest (boxes.py PirateChest)

- The box, hinge rings, discs and lid-back pins are integratedhinge's chest hinge; the lid's
  straight front and back walls (`lidheight`) carry an arch of `staves` equal staves, joined by
  angled finger joints, between two hand-drawn end plates that own the lid's corners (notched along
  the lid walls and staves, reaching their outer faces, with the clearance arc round the ring at
  the back). boxes.py cuts the lid ends as half polygons directly on the hinge.
- `arch` (60-180 degrees, the total turn of the lid from front to back) makes the barrel flatter;
  180 is boxes.py's half polygon. One stave gives a flat lid.
- `lidheight` is always the inner height of the lid walls above the hinge plane (it does not
  change with "Inner dimensions").

## candispenser (boxes.py CanStorage)

- A closed finger-jointed box with plain ramp plates in slot rows in the side walls (as dicetower):
  the lowest ramp falls to the front over the whole depth, each one above falls the other way and
  stops a can (diameter + clearance) short of the wall so cans drop onto the ramp below. boxes.py
  builds chutes with their own walls and a fixed two-level layout; here `ramps` is 1 to 4.
- Cans are filled through a slot in the top above the top ramp's high end; the dispensing opening
  is a hole in the front `stop` above the lowest ramp (the wall below it stops the cans).
- Free height between ramps: diameter / cos(angle) + clearance, measured where two ramps are
  closest (the upper one's low end).

## wallholder styles (boxes.py WallHopper, WallStairs, WallRollHolder, RollHolder, WallCaliper)

- `style: hopper`: a sloped floor plate (fingers through slot rows in the side walls) from the
  back plate down to the front, ends one thickness from the walls, and an opening `opening` high
  in the front one thickness above the floor's front end. No dividers or tool plate.
- `steps`: the tool plate split into equal-depth platforms, each one (back height - front
  height) / steps higher towards the back; only the first is jointed to the front and the last to
  the back plate, all to the side walls. No risers. boxes.py WallStairs has per-step heights.
- `style: rod`: the back plate and two brackets (sloping from the back height down to the front
  height) with a hole of `tool_d` for a rod; no bottom or front. boxes.py's RollHolder brackets are
  rounded and open at the top.
- WallCaliper is a preset (one slot in a tool plate), not boxes.py's caliper-shaped walls;
  WallPinRow and WallPlaneHolder are not built.

## gearbox (boxes.py GearBox)

- Stages of pinion and wheel alternate between two shafts (wheel k glued to pinion k + 1); each
  stage sits in a spacer frame (the plate with an obround cavity, larger tip radius + clearance),
  between a bottom and a top plate with the shaft holes, held by four corner bolts. boxes.py draws
  the gears and plates for the user to space. One thickness per gear; round shaft holes only.

## lightbox (boxes.py Lamp, NightLightBox, TriangleLamp)

- One generic light box: a closed finger-jointed box (open top optional) whose walls and top carry a
  hole pattern (hex, circles, squares, slots) inside a border, with a cable hole low in the back.
  NightLightBox's stacked picture plates and the Lamp / TriangleLamp shade shapes are not built.

## Automated comparison with boxes.py

`scripts/compare-boxespy.py` builds every generator that docs/coverage.md maps one-to-one ("yes" with
no preset, 37 rows) in boxes.py at its own defaults and in boxes-js with the shared params copied
across (x, y, h, thickness, sx, sy, `outside` -> `inside`, `burn` -> `kerf`, finger / space / play),
then compares per-part bounding boxes (rotation-free, +-1 mm) and edge-segment counts. Run it with
`python3 scripts/compare-boxespy.py [-v]` when `import boxes` works, or point `BOXESPY_PATH` (or
`--boxespy PATH`) at the path to your boxes.py checkout (the directory holding the `boxes` package);
without boxes.py it prints "skipped"
and exits 0. It needs Node (it exports our SVG through `scripts/export-svg.mjs`, which loads the
sources via Vite's SSR loader) and a Python with boxes.py's requirements, e.g.
`python3 -m venv .venv && .venv/bin/pip install -r /path/to/boxes/requirements.txt`, then
`BOXESPY_PATH=/path/to/boxes .venv/bin/python scripts/compare-boxespy.py -v`.

Part sizes include the bulge of arcs (SVG `A`, sampled) and points on cubic curves (boxes.py draws
arcs as Béziers; their control points are not counted). Earlier runs used arc end points and curve
control points, which made rounded parts look smaller here (BookHolder sides, RoundedRegularBox
plates, FlexBox5 sides) and slightly larger in boxes.py.

Run of 2026-11-05 against a boxes.py checkout at upstream commit 9a83398 (2025-11-07), Python 3.12 venv with boxes.py's requirements:

**Identical part sizes (all parts within 1 mm):** ClosedBox, BasedBox, HalfBox, OpenBox,
RegularBox, TwoPiece, KeyHolder, WineRack, BookHolder, SlidingDrawer (10). ABox and UniversalBox
match on every boxes.py part; boxes-js draws one more part (a closed top) than boxes.py does at
its defaults.

**Segment counts:** boxes.py draws every finger corner with a tiny burn-compensation curve, so its
counts run about 2x ours on finger-jointed parts (ratio 1.3 to 2.2 on the matching boxes; above 3
where the designs differ). Living-hinge parts invert the ratio (0.4 to 0.95): the boxes-js hinge
pattern has more segments. Counts are a sanity signal only.

**Remaining size differences, all explained** (same params, same part, off by more than 1 mm):

| boxes.py | boxes-js | Difference | Verdict |
|---|---|---|---|
| AngledBox | angledbox | 12 walls 100.2 mm vs 103.2 mm tall. | boxes.py quirk: its default `bottom_edge` `h` hangs the walls a brim below the floor while `adjustSize` only subtracts t, so its box is h + t tall; ours is exactly h (see angledbox). |
| SlidingLidBox | slidinglid | Two lower rails 220.2 vs 223.2 mm. | Deliberate: our lower rails butt against the back wall instead of a finger joint into it (see slidinglid). |
| CardBox | cardbox | Grip rail 274.6 vs 280.6 mm. | Deliberate: no outset ends on the rail (see cardbox). |
| FlexBox, FlexBox2, FlexBox5, UBox | flex batch | Flex walls 2 to 8 mm shorter (346.0 vs 350.4, 215.1 vs 217.3, 241.8 vs 249.8, 270.0 vs 274.4) and 100.2 vs 101.7 tall. | Deliberate: we divide every arc by `flex_stretch` (1.05), these boxes.py generators do not; equal to 0.1 mm with stretch 1. Height: boxes.py's latch grip stands t/2 proud (see flexbox). |
| RoundedBox | roundedbox | Flex wall 346.0 vs 351.1 mm. | Deliberate: one piece without dovetail ends (see roundedbox). |
| RoundedRegularBox | roundedregularbox | Flex wall 525.9 vs 566.5 mm. | Not a length difference: boxes.py's five dovetailed pieces are drawn side by side in one group, and the stretch as above (see roundedregularbox). Plates match. |
| TrayInsert | trayinsert | Dividers 149.7 vs 150.2 mm. | Deliberate: fit clearance (see trayinsert). |

**Not comparable at defaults** (the copied params mean different things, or the designs differ by
intent, as recorded in the sections above): DiceBox, HingeBox, IntegratedHingeBox (different
hinge construction and part split), UnevenHeightBox, BinTray, CompartmentBox, DividerTray,
SmallPartsTray, TypeTray, StorageShelf, StackableBin (boxes.py `sx`/`sy` are absolute section
widths, several boxes-js trays take a count plus a compartment size), LaptopStand and PhoneHolder
(different construction). TrayLayout fails in boxes.py itself at its defaults (it needs a layout
description).
