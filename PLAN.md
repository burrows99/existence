# Existence: plan

A single continuous zoom from the smallest things known to physics up to the observable universe, built with React + three.js. Multiple universes come later.

## What "smallest" means here

- **Quarks and electrons** are the smallest *known* particles. Experiments find no internal structure: they act like points, and the measured upper limit on quark size is about **4 × 10⁻¹⁸ m** (ZEUS/HERA).
- **Planck length (1.6 × 10⁻³⁵ m)** is where current physics stops working. Below it, distance probably loses its meaning. This is theory, not something anyone has observed.
- **Strings and loop quantum gravity** are hypotheses that have never been observed.

So the zoom starts at quarks (10⁻¹⁸ m). An optional zone marked **"speculative"** extends down to the Planck length.

Full range: 10⁻³⁵ → 10²⁷ m, which is **62 orders of magnitude** (45 if we start at quarks).

## Core technical problem and solution

A 32-bit float has about 7 significant digits. That means 62 orders of magnitude **cannot live in one three.js scene**: no depth-buffer trick, logarithmic or reversed, covers that range.

**Solution: a log-scale camera with local-unit layers.**

- The whole app state is one number: `zoom = log10(metres across the view)`. It runs from -35 to 27.
- Each **scale layer** (atom, cell, Earth, galaxy and so on) is a React component that declares the range of scales it covers.
- A layer is mounted only while `zoom` is inside its range. It renders in **local units**: `sceneUnit = metres / 10^layerZoom`. Every layer sees numbers between roughly 0.01 and 100, so floats stay accurate.
- Neighbouring layers cross-fade and scale smoothly as `zoom` passes between them. The camera itself never moves very far; only the content gets resized. This is the same idea as "Powers of Ten" and Cary Huang's "Scale of the Universe".
- Rotating and panning stay as normal camera controls inside the current layer.

As a result we need no floating-origin system, no logarithmic depth buffer and no double-precision maths.

## Libraries (official / pmndrs first, to avoid custom code)

| Need | Library | Status |
|------|---------|--------|
| React renderer for three.js | `@react-three/fiber` v9 | installed |
| Helpers: `CameraControls`, `Instances`, `Points`, `Text`, `Billboard`, `Html`, `Stars`, `Sparkles`, `Sphere`, `useTexture` | `@react-three/drei` | installed |
| Bloom/glow (stars, quarks, galaxies) | `@react-three/postprocessing` | phase 1 |
| Global zoom state | `zustand` | phase 1 |
| Debug sliders (dev only) | `leva` | phase 1 |
| Easing, random points in a sphere or disc (galaxies, clouds) | `maath` | phase 2 |
| Real Sun, Moon and planet positions (VSOP87, ±1′) | `astronomy-engine` | phase 5 |
| Star positions | HYG star database (CSV → trimmed JSON in `public/data`) | phase 6, licence to check |
| Galaxy positions / cosmic web | 2MASS Redshift Survey or Cosmicflows catalogue | phase 7, source and licence to check |
| Planet textures | Solar System Scope (CC BY 4.0) / NASA | phase 4–5 |

Considered but skipped: `@react-three/uikit` (DOM overlays are enough for the HUD), physics engines (nothing collides), `@react-three/xr` (maybe later).

## Scale ladder (log10 metres)

| zoom | Layer | Content |
|-----:|-------|---------|
| -35 | Planck (speculative) | foam/noise shader, labelled as theory |
| -18 | Quarks | 3 quarks plus gluon field (`Sparkles`), colour charge |
| -15 | Proton / neutron | uud / udd quark triplets |
| -14 | Nucleus | packed nucleons (`Instances`) |
| -10 | Atom | nucleus speck plus electron orbital cloud (`Points`) |
| -9 | Molecule | water, then a DNA helix (2 nm) |
| -7 | Virus | icosahedral capsid |
| -5 | Cell | membrane, nucleus, organelles |
| 0 | Human | silhouette / everyday objects |
| 7 | Earth | textured globe, atmosphere |
| 9 | Sun | glowing sphere |
| 13 | Solar system | orbits from `astronomy-engine` |
| 16 | Nearest stars | HYG neighbourhood |
| 21 | Milky Way | procedural spiral of points |
| 23 | Local Group | Andromeda, Triangulum, satellites |
| 25 | Laniakea / cosmic web | catalogue points or procedural filaments |
| 26.9 | Observable universe | CMB sphere at the edge |
| >27 | Multiverse (later) | sibling universe bubbles |

## Project structure (lean, grows by phase)

```
existence/
├─ PLAN.md
├─ public/
│  ├─ data/             # trimmed catalogues (stars.json, galaxies.json)
│  └─ textures/         # planet maps, CMB
└─ src/
   ├─ main.tsx
   ├─ App.tsx           # <Canvas>, effects, renders active layers + HUD
   ├─ store.ts          # zustand: zoom, target zoom, actions (jumpTo)
   ├─ scales.ts         # the ladder table above as data (id, min, max, label, facts)
   ├─ Layer.tsx         # mounts children in local units + cross-fade by zoom
   ├─ Hud.tsx           # DOM overlay: current size, ruler, layer name, facts
   └─ layers/           # one file per layer; becomes a folder only when it grows
      ├─ Quarks.tsx
      ├─ Atom.tsx
      ├─ ...
      └─ Universe.tsx
```

Rule: a new layer = a new file in `layers/` plus one row in `scales.ts`. Nothing else changes.

## Phases

Each phase ends with something visible that you can zoom through.

### Phase 0: Boilerplate ✅
Vite + React 19 + TS + three + fiber 9 + drei. Spinning cube.

### Phase 1: Scale engine
- `store.ts`: `zoom`, `targetZoom`, damped towards the target each frame.
- Wheel or pinch changes `targetZoom` (log-linear, so each scroll step covers the same number of decades).
- `Layer.tsx`: visibility, local scaling and opacity fade.
- `Hud.tsx`: "1.6 × 10⁻¹⁵ m", layer name, a ruler from 10⁻³⁵ to 10²⁷ that can be clicked to jump.
- A placeholder labelled sphere for every row in the ladder.
- **Done when:** you can scroll smoothly from quarks to the universe and see the labels hand off.

### Phase 2: Subatomic → atomic
Quarks, proton/neutron, nucleus, atom (electron cloud as points). Bloom added.

### Phase 3: Molecular → cellular
Water, DNA helix, virus capsid, cell.

### Phase 4: Human → Earth
Human scale, textured Earth with atmosphere glow.

### Phase 5: Solar system
Sun and planets at true positions for the current date (`astronomy-engine`), orbit lines.

### Phase 6: Stars → Milky Way
Nearby stars from HYG, procedural Milky Way, Sun marker.

### Phase 7: Cosmic scale
Local Group, cosmic web, observable universe edge (CMB texture).

### Phase 8: Polish
Info cards per layer, search and jump-to, a "tour" auto-zoom, mobile performance, loading only the layers near the current zoom (lazy `import()`).

### Phase 9: Multiverse (speculative)
Zoom past 10²⁷: our universe becomes one bubble among procedural siblings. Clearly labelled as hypothesis.

## Open questions

- Should it look realistic (textures, data) or stylised (consistent abstract look across all scales)? Stylised is far cheaper and hides the scales where real images don't exist (quarks have no "look").
- Desktop only at first, or mobile from phase 1?

## Sources

- [R3F installation](https://r3f.docs.pmnd.rs/getting-started/installation)
- [pmndrs libraries](https://docs.pmnd.rs/)
- [react-postprocessing](https://github.com/pmndrs/react-postprocessing)
- [astronomy-engine](https://npmjs.com/package/astronomy-engine)
- [three.js reverse depth buffer example](https://threejs.org/examples/webgl_reverse_depth_buffer.html) (not needed thanks to local-unit layers)
- [Log depth buffer performance cost](https://discourse.threejs.org/t/beware-of-logarithmic-depth-buffer-it-can-degrade-scene-performance/88495)
- [ZEUS quark radius limit](https://ora.ox.ac.uk/objects/uuid:28001a3f-2bb2-4750-b13c-60dcb25d28e1)
