# boxes.py coverage

Every generator in boxes.py (`boxes/generators/*.py` in the checkout this port follows, 175
modules, `_template.py` excluded) mapped to the boxes-js generator that builds it, with the params or
preset that reproduce it. boxes-js prefers **generic generators** whose presets carry the boxes.py
names (search for "BirdHouse" or "Rack19Box" finds the generator through its description), over
one-off ports. Simplifications are in [differences.md](differences.md); generators dropped from a
batch are in [cut-list.md](cut-list.md).

Status: **yes** = built (possibly simplified), **partial** = the generic generator makes the same
kind of object but misses a defining feature, **no** = not covered yet but in scope (would need the
noted work), **out** = out of scope (with the reason).

## Summary

| Status | Count |
|---|---|
| yes | 83 |
| partial | 35 |
| no (in scope, not built) | 22 |
| out of scope | 35 |
| **total** | **175** |

Out of scope: bespoke single-product devices (keyboards, the Otto robot, specific product
housings), demo and unstable modules, paper items, novelties and Eurorack. Multipurpose parts
(gears, pulleys, knobs, hole patterns, brackets, jigs, hooks, spools) are in scope.

## Boxes

| boxes.py | Status | boxes-js | How |
|---|---|---|---|
| ABox | yes | closedbox | default (boxes.py ABox is a closed box with a lid option) |
| AngledBox | yes | angledbox | |
| BasedBox | yes | basedbox | |
| BayonetBox | no | | round layered box with twist lock; needs circular layer stacks |
| CardBox | yes | cardbox | |
| ClosedBox | yes | closedbox | |
| Console | yes | profilebox | presets "Console (arcade stick)", "Console (keyboard / mixer)" |
| Console2 | partial | profilebox | `shape: console`; no service hatches / latches |
| DiceBox | yes | dicebox | |
| DisplayCase | yes | closedbox | closed box, cut from acrylic (material choice) |
| ElectronicsBox | yes | enclosure | preset "ElectronicsBox" |
| EngravingFrame | partial | frame | preset "EngravingFrame (rounded)": a layered frame; no stand |
| EuroRackSkiff | out | | Eurorack is a separate project (spec non-goal) |
| HalfBox | yes | halfbox | |
| HingeBox | yes | hingebox | |
| IntegratedHingeBox | yes | integratedhinge | |
| NotesHolder | partial | slopedorganizer | preset "NotesHolder (sticky notes)": grip cut-outs, no split front / feet / bottom U-slot |
| OpenBox | yes | openbox | |
| PirateChest | yes | chest | preset "PirateChest (5 staves)": arched lid of staves (angled finger joints) on the integrated chest hinge; `arch` makes it flatter |
| Rack10Box | yes | enclosure | preset "Rack10Box (10\" 3U)" (`front: rack10`) |
| Rack19Box | yes | enclosure | preset "Rack19Box (19\" 2U)" (`front: rack19`) |
| Rack19HalfWidth | partial | enclosure | `front: rack19` builds a full-width unit; no half-width panel |
| RackBox | yes | enclosure | `front: plain` (boxes.py RackBox is the ElectronicsBox layout) |
| RegularBox | yes | regularbox | |
| RegularStarBox | no | | see cut-list.md (oblique crossing-slot mate) |
| SideDoorHousing | no | | box with latched service hatches; needs latch edges |
| SideHingeBox | no | | see cut-list.md |
| SlidingDrawer | yes | drawer | |
| SlidingLidBox | yes | slidinglid | |
| TwoPiece | yes | twopiece | |
| UnevenHeightBox | yes | unevenheightbox | |
| UniversalBox | yes | universalbox | |
| BrickSorter | no | | stackable sieve trays; a typetray variant with a perforated floor |

## Flex

| boxes.py | Status | boxes-js | How |
|---|---|---|---|
| BreadBox | no | | gliding flex door in rails; shutter-like (see shutterbox in cut-list.md) |
| DoubleFlexDoorBox | no | | two-part flex lid |
| FlexBook | yes | flexbook | simplified |
| FlexBox | yes | flexbox | |
| FlexBox2 | yes | flexbox2 | |
| FlexBox3 | no | | see cut-list.md |
| FlexBox4 | partial | flexbox2 | see cut-list.md (upstream incomplete) |
| FlexBox5 | yes | flexbox5 | |
| HeartBox | no | | heart-shaped flex wall; needs a profile of arcs for flexWall |
| RoundedBox | yes | roundedbox | |
| RoundedRegularBox | yes | roundedregularbox | |
| ShutterBox | no | | see cut-list.md |
| UBox | yes | ubox | |
| Folder | no | | book cover with flex spine: a flat flex part, close to the calibration flex strip |

## Trays & organizers

| boxes.py | Status | boxes-js | How |
|---|---|---|---|
| BinTray | yes | bintray | |
| CompartmentBox | yes | compartmentbox | |
| DividerTray | yes | dividertray | |
| DrillBox | partial | typetray | grid of compartments, rows can step up (`step`); no drill-holder plates with holes |
| GridfinityBase | yes | gridfinity | `mode: baseplate`, preset "GridfinityBase (3 x 2)"; `fit_x` / `fit_y` fill a drawer, optional magnet holes |
| GridfinityDrillBox | partial | gridfinity | `mode: bin` (compartment bin with feet); no drill-holder plates |
| GridfinityTrayLayout | yes | gridfinity | `mode: bin`, preset "GridfinityTrayLayout (3 x 2, 3 x 2 compartments)": equal compartments (traylayout has free lists, without feet) |
| HobbyCase | partial | typetray / storageshelf | case of drawers; no hinged front |
| SlantedTray | yes | slopedorganizer | preset "SlantedTray" |
| SmallPartsTray | yes | smallpartstray | |
| SmallPartsTray2 | partial | smallpartstray | |
| TrayInsert | yes | trayinsert | |
| TrayLayout | yes | traylayout | |
| TypeTray | yes | typetray | |
| Silverware | yes | silverware | square-cornered |
| AgricolaInsert | out | | a bespoke board-game insert set |
| CardHolder | partial | slopedorganizer | "Card piles" preset: piles of cards in a sloped row (boxes.py: angled shelf) |

## Storage & display

| boxes.py | Status | boxes-js | How |
|---|---|---|---|
| BookHolder | yes | bookholder | |
| BottleStack | yes | cradle | preset "BottleStack (wine bottles)": cradles joined by stretchers |
| CanStorage | yes | candispenser | preset "CanStorage (330 ml cans, 2 ramps)": zig-zag ramps (1-4) to a front opening, filled through a top slot |
| CoffeeCapsuleHolder | yes | capsuledispenser | preset "CoffeeCapsuleHolder (Nespresso, 4 x 5)" |
| DiscRack | partial | slotrack | preset "DiscRack (CDs)": items stand in level notched rails (boxes.py: leaning on angled rails) |
| Dispenser | no | | card dispenser edge; box variant |
| Display | partial | bookholder | preset "Display (A4 leaflets)": an angled back with a ledge; no separate front frame |
| DisplayShelf | yes | displayshelf | simplified |
| KeyHolder | yes | keyholder | |
| LaptopStand | yes | laptopstand | |
| MagazineFile | yes | slopedorganizer | preset "MagazineFile" (`profile: curve`) |
| PaintStorage | partial | storageshelf | shelf of slots; no angled bottle holes |
| PhoneHolder | yes | phoneholder | |
| SBCMicroRack | no | | stackable SBC racks |
| SpicesRack | yes | spicesrack | simplified |
| StackableBin | yes | stackablebin | |
| StorageRack | partial | storageshelf | shelves without own floors |
| StorageShelf | yes | storageshelf | |
| WineRack | yes | winerack | |
| RollHolder | partial | wallholder | `style: rod` (back plate and two brackets with the rod holes), e.g. `walltype: plain`; straight brackets, no rounded holder shape |
| DrillStand | yes | typetray | preset "DrillStand (stepped rows)" (`step`: each row taller than the one in front); one step size (boxes.py: per-row heights list and a sloped top) |
| Shadowbox | yes | frame | preset "Shadowbox (A5, 30 mm deep)" (`spacers`) |
| PhotoFrame | yes | frame | preset "PhotoFrame (10 x 15 cm)" |
| BirdHouse | yes | profilebox | preset "BirdHouse" (`shape: house`): no roof overhang |
| FatBallDispenser | no | | bird feeder; a house variant with a feeding tray |
| CoinBankSafe | no | | box with a dial-lock door |
| CoinDisplay | no | | angled coin display; bookholder-like |
| Desksign | no | | needs text engraving |
| Kamishibai | no | | picture-theatre box with doors |
| NightLightBox | partial | lightbox | preset "NightLightBox (low, slots)": a box with hole-pattern walls and a cable hole; no layered picture front |
| TriangleLamp | partial | lightbox | a rectangular light box with perforated walls; no triangular shade |
| Lamp | partial | lightbox | preset "Lamp shade (open top)": perforated walls round a bulb; no shaped shade |
| Shoe | out | | novelty |

## Wall-mounted (boxes.py wall system)

`wallholder` implements the boxes.py wall-system edges (walledges.ts): the side walls' back edge
is fingered into slot rows in a back plate, and hook sections pass through the plate to hang on a
French cleat, slat wall, IKEA Skadis board or DIN rail (or the plate is screwed to a plain wall).
Its tool plate (holes or slots, optionally split into `steps`), compartments, front height and
`style` (bin, hopper, rod) make the Wall* generators presets.

| boxes.py | Status | boxes-js | How |
|---|---|---|---|
| DinRailBox | partial | wallholder | preset "DIN rail box" (`walltype: dinrail`): no lid, spring or latch |
| WallCaliper | partial | wallholder | preset "WallCaliper (slot plate)": the beam hangs through one slot in a tool plate; no caliper-shaped side walls |
| WallChiselHolder | partial | wallholder | preset "WallChiselHolder / WallPliersHolder" (`tools: slots`); round-ended slots |
| WallConsole | partial | wallholder | open holder with a low front; no angled console plate |
| WallDrillBox | yes | wallholder | preset "WallDrillBox" (`tools: holes`); one hole size (boxes.py: per-row heights) |
| WallHopper | yes | wallholder | preset "WallHopper" (`style: hopper`): sloped inner floor down to an opening at the bottom of the front |
| WallPinRow | no | | row of pins at an angle |
| WallPlaneHolder | no | | plane-shaped holder |
| WallPliersHolder | partial | wallholder | `tools: slots` |
| WallRack | partial | wallholder | preset "WallRack (French cleat)": one shelf (boxes.py: several shelves on one back) |
| WallRollHolder | yes | wallholder | preset "WallRollHolder (paper towel)" (`style: rod`): two brackets with rod holes on the back plate |
| WallSlottedHolder | partial | wallholder | `tools: slots` |
| WallStackableBin | yes | wallholder | preset "WallStackableBin (screwed)"; not stackable |
| WallStairs | yes | wallholder | preset "WallStairs (3 steps)" (`steps`): tool platforms rising towards the back |
| WallTypeTray | yes | wallholder | preset "WallTypeTray (slat wall)" (`cols`) |
| WallWrenchHolder | partial | wallholder | `tools: slots` |
| WallEdges | out | | edge catalogue (demo) |

## Test & calibration

| boxes.py | Status | boxes-js | How |
|---|---|---|---|
| BurnTest | yes | calibration | `mode: fit`, preset "BurnTest": the clearance varies per section instead of the burn per side |
| FlexTest | yes | calibration | `mode: flex`, preset "FlexTest" |
| FlexTest2 | partial | calibration | `mode: flex`; one pattern per strip, not a 2D grid of settings |
| FillTest | out | | tests raster hole filling, not a cut part |

## Mechanical parts, panels and jigs

Multipurpose parts are in scope: gears, pulleys, knobs, hole patterns, brackets and jigs.

| boxes.py | Status | boxes-js | How |
|---|---|---|---|
| Gears | yes | gears | single gear, meshing pair and/or straight rack (`rack_length`); no profile shift |
| GearBox | yes | gearbox | preset "GearBox (1:27, 3 stages)": folded train on two shafts in a bolted stack of stage frames and end plates |
| Planetary | yes | planetary | sun, planets and an involute internal ring gear, plus a carrier plate |
| Pulley | yes | pulley | GT2 / HTD / T / MXL / round, stacked layers with flanges |
| ConcaveKnob | yes | knob | preset "ConcaveKnob" |
| WavyKnob | yes | knob | preset "WavyKnob" |
| HolePattern | yes | patternpanel | preset "HolePattern (hex vent)" |
| FanHole | yes | patternpanel | preset "FanHole 80 mm" (`mount: fan40` .. `fan140`) |
| NemaPattern | yes | patternpanel | preset "NemaPattern 17" (`mount: nema17` / `nema23`) |
| SkadisBoard | yes | patternpanel | preset "SkadisBoard (pegboard)" |
| FrontPanel | partial | patternpanel | hole fields and mounts; no free list of cut-outs |
| SevenSegmentPattern | no | | segment-shaped hole pattern |
| NemaMount | yes | beam | preset "NemaMount 17" |
| LBeam | yes | beam | preset "LBeam" |
| ZBeam | partial | beam | U form only (preset "U channel (ZBeam U-beam)"); no Z profile |
| RectangularWall | partial | patternpanel | a plain plate (`pattern: none`); no edge types |
| TriangularWall | no | | single triangular plate with edge types |
| AngledCutJig | yes | angledcutjig | preset "AngledCutJig (45 deg mitre)": wedge sled with ribs and a stop strip |
| LaserClamp | partial | strapclamp | preset "LaserClamp (3 mm sheet)": a slotted strap (step) clamp on a stacked heel, not boxes.py's scissor clamp |
| LaserHoldfast | yes | holdfast | preset "LaserHoldfast" |
| JointPanel | yes | jointpanel | preset "JointPanel (600 x 400 on a 300 mm bed)" |
| Hook | partial | hook | J-shaped flat profile hooks (presets "Coat hook", "Towel hook (deep)", "Cable hook"); boxes.py's is a box-shaped hook built from plates |
| PoleHook | partial | hook | preset "PoleHook (25 mm rail)" (`mount: pole`): a ring that slides onto the pole, no screw clamp |
| Spool | yes | spool | preset "Spool (cable)": flanges joined by staves |
| FilamentSpool | partial | spool | preset "FilamentSpool (1 kg)": one-piece drum, no bayonet halves |
| DiceTower | yes | dicetower | preset "DiceTower" |

## Electronics

| boxes.py | Status | boxes-js | How |
|---|---|---|---|
| AirPurifier | out | | housing for one specific product |
| Arcade | partial | profilebox | console shape; no screen bezel / cabinet sides |
| MakitaPowerSupply | out | | housing for one specific product |
| Matrix | out | | LED matrix enclosure for one specific product |
| SevenSegmentClock | out | | LED clock for a specific build |
| TrafficLight | out | | novelty |
| Atreus21 | out | | keyboard case (bespoke device) |
| Keyboard | out | | keyboard base module (library for keyboards) |
| Keypad | out | | keypad with switch plate (bespoke device) |
| OttoBody | out | | robot kit part |
| OttoLegs | out | | robot kit part |
| OttoSoles | out | | robot kit part |

## Out of scope

Bespoke single-product devices, demos and unstable modules, paper items and novelties: AllEdges,
BottleTag (paper), Castle (unstable), CarbonFilter (specific product), Clock (specific build), Edges,
JigsawPuzzle (alpha), OrganPipe (unstable), PaperBox (folded paper), PizzaShovel, Planetary2
(unstable), Platonic (unstable), RobotArm (servo-specific), Rotary (unstable), RoyalGame, Sphere,
Stachel, Tetris, _walltemplate.

(The summary counts modules: 175, including `_walltemplate.py`.)
