// A block of fluid: seawater, air (thinner with altitude) or molten iron.
import type { ChildSpec, Node, Vec3 } from '../engine/tree'
import { volume, volumeRoot, type Volume } from './volume'
import { fillAir, fillGas, fillWater } from './matter'
import { element } from './orbitals.ts'

const leafDepth = (root: Node) => Math.round(Math.log2(root.metres / 1.46e-9))

// liquid metal: atoms thrown in at the real density, no two closer than `min`
function fillLiquid(z: number, perM3: number, min: number, side: number, rng: () => number): ChildSpec[] {
  const N = Math.round(perM3 * side ** 3)
  const pts: Vec3[] = []
  let d = min / side
  while (pts.length < N) {
    let placed = false
    for (let t = 0; t < 40 && !placed; t++) {
      const p = [0, 1, 2].map(() => rng() - 0.5) as Vec3
      if (pts.every(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) >= d)) { pts.push(p); placed = true }
    }
    if (!placed) d *= 0.95 // ponytail: random sequential addition jams; loosen rather than relax properly
  }
  return pts.map(pos => ({ kind: 'atom', pos, size: (1.2 * element(z)[6] * 1e-12) / side, props: { z } }))
}

// plasma: bare nuclei and free electrons, at most `CAP` particles per block (the Sun's core is far denser)
const CAP = 300
function fillPlasma(side: number, rng: () => number, perM3: number, he: number): ChildSpec[] {
  const n = Math.round(Math.min(CAP, perM3 * side ** 3))
  const out: ChildSpec[] = []
  const at = () => [0, 1, 2].map(() => rng() - 0.5) as Vec3
  for (let i = 0; i < n; i++) {
    const alpha = rng() < he
    out.push(alpha ? { kind: 'nucleus', pos: at(), size: 4e-15 / side, props: { z: 2, a: 4 } } : { kind: 'nucleon', pos: at(), size: 1.7e-15 / side, props: { q: 1 } })
    for (let e = alpha ? 2 : 1; e > 0; e--) out.push({ kind: 'electron', pos: at(), size: 1e-18 / side, props: { n: 0, l: 0 } })
  }
  return out
}

const FACTS: Record<string, [string, string, string]> = {
  water: ['Seawater', '#1e5aa8', 'Water with 0.6 moles of salt per litre: sodium and chloride ions drifting among the molecules. 1.3 billion cubic kilometres of it.'],
  air: ['Air', '', 'Nitrogen and oxygen, thinning with altitude: half as dense every 5.5 km up.'],
  melt: ['Molten iron', '#c05a2a', 'The outer core: liquid iron and nickel at 4,000 °C, churning slowly, which is what makes the Earth’s magnetic field.'],
  plasma: ['Plasma', '#ffd080', 'Hydrogen and helium too hot to hold their electrons: bare protons and helium nuclei in a sea of free electrons. Where the real density exceeds 300 particles per block it is drawn thinner.'],
  h2: ['Hydrogen', '', 'Hydrogen molecules with some helium atoms, thicker the deeper you go.'],
  co2: ['Carbon dioxide', '', 'Carbon dioxide, thinning with altitude.'],
}

const fluid: Volume = {
  leafDepth,
  fill: (r, rng, leaf) => {
    const root = volumeRoot(leaf), side = r.s * root.metres, f = root.props.f as string
    if (f === 'air') return fillAir(side, rng, () => false, (root.props.d as number) ?? 1)
    if (f === 'melt') return fillLiquid(26, 1.18e29, 1.8e-10, side, rng)
    if (f === 'plasma') return fillPlasma(side, rng, root.props.d as number, (root.props.he as number) ?? 0)
    if (f === 'h2') return fillGas(side, rng, () => false, root.props.d as number, [['h2', 0.9, 0.3e-9], ['he', 0.1, 0.28e-9]])
    if (f === 'co2') return fillGas(side, rng, () => false, root.props.d as number, [['co2', 0.96, 0.5e-9], ['n2', 0.04, 0.42e-9]])
    return fillWater(side, rng, () => false, (root.props.salt as number) ?? 0)
  },
  far: (_, node) => {
    const color = FACTS[volumeRoot(node).props.f as string][1]
    return color ? { shape: 'haze', color } : null
  },
  info: (_, node) => {
    const [title, , fact] = FACTS[volumeRoot(node).props.f as string]
    return { title, fact }
  },
}

export const kinds = { fluid: volume(fluid) }
