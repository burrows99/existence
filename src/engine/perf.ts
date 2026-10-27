// Every performance knob in one place. Budgets are per walk (one frame while the view moves), caps are buffer
// sizes, thresholds are fractions of the view height. In dev `window.PERF` is this object: change a value in the
// console and the next walk uses it (caps, display settings and already-cached thresholds need a reload).
export const PERF = {
  // --- frame budgets, ms ---
  genMs: 4, // generating new nodes; the rest waits, their parents' chunks stand in
  buildMs: 3, // rebuilding chunks; stale chunks keep drawing meanwhile, so detail streams in over a few frames

  // --- what is in play, in view heights ---
  front: 0.1, // cutaway: solid things are drawn from this far in front of the focus plane…
  depth: 0.6, // …to this far behind it
  margin: 0.9, // the screen rectangle is taken this much wider than at the focus plane (it widens with depth)

  // --- level of detail: a node opens (its children are drawn) once it spans this fraction of the view height ---
  open: 0.3, // things: molecules, nuclei…
  openRegion: 0.14, // regions of a volume (0.1 looks a touch finer and walks 3× the chunks)
  openLeaf: 0.15, // a volume's leaves, the ones that hold the atoms
  openPlace: 0.2, // regions that place things (cells in tissue, the person on Earth)
  samples: 48, // points a closed region of stars or galaxies is drawn with
  cloud: 400, // electron-cloud samples per electron
  disc: 400, // accretion-disc points around an open black hole
  gasAtoms: 10, // atoms a leaf of nebular gas holds: its size follows the density (a nanometre of nebula is empty)

  // --- buffers ---
  cap: { sphere: 500_000, haze: 100_000, cube: 100_000, box: 50_000, point: 600_000 }, // items per batch; past it the farthest chunks go
  evictEvery: 120, // walks between sweeps of subtrees and chunks nobody looked at (a second of zooming)

  // --- display ---
  dpr: [1, 1.5] as [number, number], // device pixel ratio range
  bloom: 0.5, // bloom resolution scale; 0 turns bloom off
  pointPx: 2.5, // star / galaxy / electron-cloud point size, CSS px
  snapPx: 24, // scrolling this close to a tiny thing still targets it
}

if (import.meta.env.DEV) Object.assign(window, { PERF })
