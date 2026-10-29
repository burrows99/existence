# Existence: plan v2

A universe you can zoom into **anywhere**, where everything is genuinely made of the level below it:

```
observable universe → superclusters → galaxies → stars → planets → surface → life
→ creatures → tissues → tissues → cells → organelles → molecules → atoms → nucleus + electrons
→ protons + neutrons → quarks
```

Any atom you reach really is Z protons + N neutrons + Z electrons in their real orbitals. Every cell really is made of molecules, and every molecule of atoms.

## The honest constraint, and how we get around it

A human body has about **7 × 10²⁷ atoms**; the observable universe has about 10⁸⁰. No computer can store them, and nobody knows where the atoms in your body actually are (quantum mechanics says there is no single answer anyway).

**So nothing is stored. Everything is generated on demand, deterministically.** This is the same idea as Minecraft worlds and SpaceEngine:

- Every object is a **node** with a **seed**. Its contents (children) are generated from that seed only when you zoom close enough to see them, and are thrown away when you leave.
- The same seed always gives the same contents. Zoom into the third cell on the left, leave, come back: same cell, same molecules, same atoms.
- The **rules are real**:
  - real element data
  - real molecule geometry, from PDB/PubChem structures
  - real concentrations (water is 33 molecules/nm³, and a cell is about 70% water and 15% protein by mass)
  - real orbital shapes
  - real cell and organelle sizes
  - real anatomy, catalogues and orbits where they exist
- The **exact arrangement** is random within those rules, like reality at that level.
- **"Simulation" means local dynamics** where you are looking: electrons resampled from their probability clouds every frame, thermal jiggling of molecules and nucleons, orbits moving. A full physics simulation of everything at once is impossible at any compute budget.

## Architecture

### 1. Node tree (`src/engine/`)

```ts
type Kind = {
  id: string
  children(node): Child[]       // deterministic from node.seed; lazy
  Far: Component                // what it looks like when too small to open (LOD)
  Near?: Component              // extra detail drawn while open (orbitals, membranes…)
}
type Child = { kind: string; pos: Vec3; size: number; seed: number }  // pos/size in parent units
```

- **Kinds are lazy-loaded** with `import()`, so atom code isn't downloaded until you reach atoms, and protein structures aren't fetched until you see that protein.
- Huge collections (a cell's 10¹⁴ atoms) are never listed. They are split into **region nodes** (octree cubes), and only the leaf cube you are looking at generates its molecules.

### 2. Camera: hierarchical floating origin

- The camera state is `path` (the chain of nodes from the root to the node you're in) + `focus` (a point in that node's local coordinates) + `zoom` (log10 of the view width in metres).
- **Zoom toward the cursor**: the point under the mouse stays fixed while you zoom, like Google Maps.
- When the view gets much smaller than a child containing the focus, we **descend** into it and convert the focus point into the child's coordinates. When the view gets much bigger than the current node, we **ascend**. The numbers therefore stay small forever: no float limits from the quark to the universe.
- JS numbers are 64-bit, so positions are computed in float64 relative to the camera and only then handed to the GPU as float32.

### 3. Level-of-detail renderer (chunked, GPU-driven)

How Minecraft draws a world and how Mol* draws a million atoms, combined:

- Starting a few levels above the current node, walk down the tree. A node is **opened** (children generated and drawn) if it appears bigger than a threshold on screen, otherwise its `far` look is drawn: a sphere/haze/point, a *sample* of what it holds (thinned on the GPU as it shrinks), or its `detail` (a molecule's exact atoms) once it is a few pixels across.
- Every open node owns a **chunk**: one packed buffer of its closed children's items, in its own units, rebuilt only when which of its children are open changes (like a Minecraft chunk mesh). Per frame the CPU uploads one transform per chunk (a 128×128 float texture); the GPU places, jitters, cuts away and thins every item. While the view stands still nothing is walked at all.
- **Spheres are ray-cast impostors** (two triangles each, depth written per pixel, like Mol*), so half a million atoms are one draw call. Five batches in all: spheres, haze, cubes, boxes, points.
- What is in play is the screen rectangle × the cutaway slab, so dense matter stays bounded (~500k atoms of seawater); kinds marked `deep` (space) draw as far behind as beside. Generation and chunk rebuilding are each budgeted per walk, nearest first: a chunk that cannot be rebuilt yet keeps drawing as it was (detail streams in over a few frames, like Minecraft chunks loading), and the farthest chunks are what any cap cuts off.
- **Every knob lives in `src/engine/perf.ts`** (`PERF`): budgets, cutaway slab, open thresholds, sample counts, buffer caps, DPR, bloom, point size. In dev it is `window.PERF`.

### 4. URL = location

`#at=<node key>&f=<focus>&z=<zoom>` so any spot in existence is a shareable link. Node keys are the chain of child indices from the root, so a link regenerates exactly the same thing.

### 5. Navigating (what Phase A settled)

- Scrolling aims at whatever is under the cursor: the nearest solid thing, else the smallest opened thing, else anything within 24 px. Picking happens in the draw pass itself (every node's screen position is already known there), not with a raycaster.
- Once the camera is inside the thing you scrolled into, it **locks on**: the centre glides to the middle of the view, so zooming into an atom lands on its nucleus.
- A **cutaway** shows a slab from just in front of the focus plane to 0.6 views behind it (you are inside a liquid, after all); points are exempt because they never occlude.
- Files: `src/engine/tree.ts` (nodes, kinds, seeds, eviction), `src/engine/camera.ts` (zoom, re-rooting, lock-on, URL), `src/engine/World.tsx` (walk, chunks, shaders, picking), `src/kinds/*` (what things are made of). `npm test` checks the orbital maths. In dev, `window.__perf` reports walk time, chunk and item counts and generation time by kind.

## Real data sources (minimise custom work)

| Level | Source | Notes |
|-------|--------|-------|
| Elements (118) | [Periodic-Table-JSON](https://github.com/Bowserinator/Periodic-Table-JSON): Z, mass, electron configuration, CPK colour, radii | trimmed to factual fields, attributed |
| Orbitals | hydrogen-like wavefunctions with Slater's rules (Z_eff) | sampled per electron |
| Small molecules | PubChem 3D conformers (water, glucose, amino acids, ATP, lipids) | |
| Proteins, DNA, ribosomes | RCSB PDB files, parsed by three.js's built-in `PDBLoader` | fetched lazily |
| Cell contents | abundances / sizes from literature; [cellPACK](https://ccsb.scripps.edu/mycoplasma_model/) whole-cell recipes as reference | |
| Human anatomy | [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy) / BodyParts3D | CC BY-SA 4.0: attribution + share-alike |
| Solar system | `astronomy-engine` (VSOP87) | |
| Stars | HYG catalogue + procedural fill | |
| Galaxies | 2MASS / Cosmicflows catalogues + procedural fill | |

Rendering stays on R3F, drei (Instances, CameraControls, …), postprocessing and zustand. The Phase 1–3 visuals (DNA, virus, cell, nucleus) get reused as `Far` looks.

## Phases

Each phase is one PR against `main`, merged = live on https://burrows99.github.io/existence/.

| Phase | Delivers |
|-------|----------|
| **A. Engine + matter** ✅ | Node tree, float64 hierarchical camera, zoom-to-cursor anywhere, lazy kinds, seeded RNG. Content: a box of liquid water → H₂O → atoms → nucleus + electrons (real orbitals, all 118 elements supported) → protons/neutrons → quarks. |
| **B. Molecules of life** ✅ | Real structures that include hydrogens (NMR entries 1MYF myoglobin, 2HIU insulin, 1NAJ B-DNA; PubChem 3D ATP and glucose), one per 14.9 nm of water, each decomposing into its real atoms. `scripts/molecules.mjs` regenerates the data. No lipids yet: PubChem has no 3D conformers for phospholipids, so membranes (Phase C) will need a built lipid. |
| **C. Cell** ✅ | A muscle cell (drawn round): every membrane (cell, nucleus, 600 mitochondria) is a real bilayer of POPC + 30% cholesterol from the PDB component dictionary; cytosol with myoglobin/ATP/glucose, nucleus with DNA segments at the real density, mitochondrial matrix with mtDNA. Built on a generic `volume` (octree whose contents are a function of absolute position, with placements and exclusions). Not yet: histones, membrane proteins, cristae, ribosomes, other cell types. |
| **D. Body** ✅ | A stylised figure (capsules, ellipsoid organs, long bones, skull and rib shells) where tissue is a function of position; every tissue packs cells of its type (muscle, skin, fat with a triglyceride droplet, bone, neuron, liver, gut, lung, red blood cells in the heart), water between cells, real N₂/O₂ air outside. Closed regions draw a sample of their real cells. Not yet: real anatomy meshes, vessels, nerves, bone mineral, collagen, plasma proteins. |
| **E. Earth** ✅ | Layers by depth: hexagonal close-packed iron inner core, liquid iron outer core, forsterite mantle, quartz crust (real unit cells from the Crystallography Open Database, tiled through 1.5 µm grains with random orientations, like a polycrystalline rock), 4 km oceans of seawater with Na⁺/Cl⁻ ions under procedural continents, 100 km of air thinning with altitude, and the person standing on a continent, rotated to the local vertical. Landmarks menu. Not yet: real coastlines and terrain, soil, lower-mantle minerals, granite's other minerals, weather. |
| **F. Solar system** ✅ | The Sun as a volume of plasma (protons, helium nuclei, free electrons, densest at the core), eight planets and the Moon at today's positions from VSOP87 (`astronomy-engine`), rocky planets layered iron/rock with CO₂ air, gas giants of H₂/He thickening into metallic hydrogen, our Earth placed where it really is. Orbit lines. Since H2: Pluto (real position) and the other dwarf planets, 17 moons (the Galilean four at their real positions, the rest on circular orbits, labelled approximate), Ceres/Vesta/Pallas/Hygiea, and procedural asteroid and Kuiper belts at the real counts and size law. Not yet: rings, comets, the Oort cloud, the solar wind. |
| **G. Galaxy → universe** ✅ | The Milky Way as an exponential disc with two spiral arms and a bulge, stars drawn from the Kroupa initial mass function at the local density (each a real plasma volume), the solar system 26,000 ly out; the observable universe as a cosmic web of galaxies from a noise field with the Milky Way at the centre, Andromeda 2.5 Mly away, and the CMB sphere at the edge. Not yet: real star catalogues (HYG), real galaxy surveys, dark matter, the interstellar medium. |
| **H. Polish** | ✅ Performance: the chunked, impostor-sphere renderer above, budgeted rebuilds and GPU-resident chunks (every landmark at the display's refresh rate; zooming at 110–120 fps). ✅ Real Earth (ETOPO2 relief, Blue Marble, country borders), HYG stars, real galaxies/clusters/voids. ✅ Search box over everything named. Still to do: a guided tour, touch/pinch on phones, smoother star-field LOD, body tissue as cubes up close. |
| **H2. What is known** | Fill in the rest of what astronomy knows, each thing made of its parts: the solar system's dwarf planets, moons, asteroid and Kuiper belts; the Milky Way's black holes, neutron stars, nebulae (as gas), star clusters (as denser stars), arms and bubbles; the universe's groups, superclusters, walls, voids, quasars and the most distant galaxies; and, at the atomic end, the Sun's plasma fusing (hydrogen to helium) rather than standing still. Exoplanets around the nearby stars (NASA Exoplanet Archive) next. |
| **J. Evolving life** ✅ | The person is gone; in their place, a 6 m meadow on Santa Cruz (Galápagos) where creatures evolve (`src/kinds/life.ts`, simulated where you look). Each creature has a brain of 9 senses → 8 tanh neurons → turn and run (98 weights), energy reserves ∝ mass (its life bar), Kleiber's ¾-power metabolism, size-limited speed and lifespan; it grazes 36 regrowing tufts of grass, eats creatures at least 1.25× smaller, breeds when 75% full (young inherit brain, size and hue with mutations), and dies starved, eaten or old. Energy is the only reward, so selection is natural: predator–prey cycles and size drift emerge, and `npm test` checks that evolved brains out-forage random ones. Every creature is a node that moves (`Kind.version` rebuilds the meadow's chunk as they do; the camera rides along with a moving goal) made of skin, fat, muscle and brain tissue packed with real cells; grass is grass cells. Time stops when you zoom inside a creature. Not yet: limbs and real body plans, sexual reproduction, sound/smell senses, a running chart of the population. |
| **I. Multiverse** | Sibling universes as seeds; clearly labelled as hypothesis. |

## Non-goals (honest limits)

- **No global physics simulation** (no MD of a whole cell, no N-body universe): only local, visual dynamics.
- **Below quarks**: the Planck scale stays as a labelled "speculative" zone, because nothing is known to be there.
- **Electrons are not little balls in orbits**: they are drawn as positions sampled from their real probability clouds, which is what a measurement would find.
