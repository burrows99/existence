// A block of fluid: seawater, air (thinner with altitude), molten iron, plasma, nebular gas or neutron matter.
import { childrenOf, type ChildSpec, type Node, type Vec3 } from '../engine/tree'
import { volume, volumeRoot, type Volume } from './volume'
import { fillAir, fillGas, fillWater } from './matter'
import { element } from './orbitals.ts'

// leaves are 1.46 nm unless the placer says otherwise (nebular gas: big enough to hold a few atoms; neutron matter: femtometres)
const leafDepth = (root: Node) => Math.round(Math.log2(root.metres / ((root.props.leaf as number) ?? 1.46e-9)))
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const perM3 = (d: number) => `about 10${String(Math.round(Math.log10(d))).replace(/\d/g, c => SUP[+c])} per cubic metre here`

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
  plasma: ['Plasma', '#ffd080', 'Hydrogen and helium too hot to hold their electrons: bare protons and helium nuclei in a sea of free electrons. Where the real density exceeds 300 particles per block it is drawn thinner. In a star’s core the flashes are fusion: four protons at a time becoming a helium nucleus (the proton–proton chain), drawn far more often than the real once every few hours in a block this small.'],
  h2: ['Hydrogen', '', 'Hydrogen molecules with a tenth as many helium atoms.'],
  co2: ['Carbon dioxide', '', 'Carbon dioxide, thinning with altitude.'],
  hii: ['Ionised hydrogen', '#ff6b6b', 'Hydrogen stripped of its electrons by the ultraviolet light of hot stars nearby: protons and free electrons, with a tenth as many helium nuclei. The glow is electrons being recaptured.'],
  hi: ['Atomic hydrogen', '#6fa8ff', 'Neutral hydrogen atoms with a tenth as many helium atoms, lit by starlight scattered off dust grains (not drawn).'],
  neutron: ['Neutron matter', '#cfe0ff', 'Neutrons packed at nuclear density, 10¹⁷ kg/m³, held up by their own quantum pressure. They are drawn at random positions; the real matter is a superfluid whose particles have no definite positions.'],
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
    if (f === 'hii') return fillPlasma(side, rng, root.props.d as number, 0.1)
    if (f === 'hi') return fillGas(side, rng, () => false, root.props.d as number, [['h', 0.9, 0.24e-9], ['he', 0.1, 0.28e-9]])
    if (f === 'neutron') return fillGas(side, rng, () => false, root.props.d as number, [['nucleon', 1, 1.7e-15]]) // no charge: neutrons
    return fillWater(side, rng, () => false, (root.props.salt as number) ?? 0)
  },
  far: (_, node) => {
    const { f, color } = volumeRoot(node).props, c = (color as string) ?? FACTS[f as string][1] // a nebula's gas glows its colour
    return c ? { shape: 'haze', color: c } : null
  },
  // fusion, where a star is dense enough for it (its core): one proton in ten flashes now and then as it fuses
  inner: node => {
    const root = volumeRoot(node)
    if (root.props.f !== 'plasma' || (root.props.d as number) < 3e31 || node.props.depth !== leafDepth(root)) return []
    return childrenOf(node).filter((c, i) => c.kind === 'nucleon' && i % 20 === 0).map(c => ({ shape: 'sphere' as const, color: '#fff6c0', glow: true, flash: true, scale: c.size * 8, pos: c.pos, phase: (c.seed % 97) * 0.065 }))
  },
  info: (_, node) => {
    const { f, salt, d } = volumeRoot(node).props, [title, , fact] = FACTS[f as string]
    if (f === 'water' && !salt) return { title: 'Water', fact: 'Pure water, 33 molecules per cubic nanometre, drawn as a liquid whatever the real temperature.' }
    return { title, fact: f === 'hii' || f === 'hi' ? `${fact} ${perM3(d as number)[0].toUpperCase()}${perM3(d as number).slice(1)}, a far better vacuum than any made on Earth.` : fact }
  },
}

export const kinds = { fluid: volume(fluid) }
