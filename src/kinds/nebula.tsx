// A nebula: a cloud of real gas (ionised hydrogen, molecular hydrogen, or neutral hydrogen with helium) at its real
// density, drawn as a coloured haze. The shape is a blob, shell or filamentary shell with noise, not the real one.
// The gas is nested: blocks of 10,000 km, each a fluid whose leaves are sized to hold a few atoms at this density.
import type { Vec3 } from '../engine/tree'
import { PERF } from '../engine/perf'
import { rootProps, volume, volumeRoot, type Volume } from './volume'

const BLOCK = 1e7
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
export type Sort = 'emission' | 'planetary' | 'remnant' | 'reflection' | 'molecular'
// colour when closed, the gas it is made of, and what to call it
export const SORTS: Record<Sort, [string, string, string]> = {
  emission: ['#ff5a5a', 'hii', 'Emission nebula'],
  planetary: ['#4fd1c5', 'hii', 'Planetary nebula'],
  remnant: ['#e0a0ff', 'hii', 'Supernova remnant'],
  reflection: ['#6fa8ff', 'hi', 'Reflection nebula'],
  molecular: ['#6a4a3a', 'h2', 'Molecular cloud'],
}

// clumps and filaments: a few overlapping waves, −5..5
function clumps(p: Vec3) {
  let v = 0
  for (const [a, b, c, ph] of [[31, 17, 23, 0.3], [-19, 29, 13, 1.7], [11, -23, 37, 2.9], [41, 7, -29, 4.1], [-7, 13, 19, 5.3]]) v += Math.sin(a * p[0] + b * p[1] + c * p[2] + ph)
  return v
}
// the fraction of the peak density at p (node units: the nebula fills the unit sphere)
export function shape(p: Vec3, sort: Sort) {
  const r = 2 * len(p)
  if (r > 1) return 0
  const c = clumps(p)
  if (sort === 'planetary') return Math.exp(-((r - 0.7) / 0.15) ** 2) + 0.05 // a shell blown off a dying star, thin inside
  if (sort === 'remnant') return Math.exp(-((r - 0.8) / 0.1) ** 2) * Math.max(0, c) ** 2 * 0.25 // a shell of filaments
  return (1 - r * r) * (0.4 + 0.12 * (c + 5)) // a clumpy blob
}

const nebula: Volume = {
  deep: true,
  leafDepth: root => Math.round(Math.log2(root.metres / BLOCK)),
  fill: (r, _rng, leaf) => {
    const root = volumeRoot(leaf), d = (root.props.n as number) * shape(r.c, root.props.t as Sort), [color, f] = SORTS[root.props.t as Sort]
    if (d < 1e5) return [] // thinner than the general interstellar medium: nothing to show
    return [{ kind: 'fluid', pos: [0, 0, 0], size: 1, props: { ...rootProps, f, d, leaf: Math.cbrt(PERF.gasAtoms / d), color } }]
  },
  far: (r, node) => {
    const root = volumeRoot(node), [color] = SORTS[root.props.t as Sort]
    if (r.depth === 0) return { shape: 'haze', color, minPx: 2 }
    const a = shape(r.c, root.props.t as Sort)
    return a > 0.02 ? { shape: 'haze', color, alpha: Math.min(1, a) } : null
  },
  info: (r, node) => {
    const root = volumeRoot(node), sort = root.props.t as Sort
    if (r.depth < 6) return { title: root.props.name as string, fact: `${SORTS[sort][2]}. ${root.props.fact} Its shape here is a ${sort === 'planetary' ? 'shell' : sort === 'remnant' ? 'shell of filaments' : 'clumpy blob'} drawn from noise, not the real one.` }
    const a = shape(r.c, sort)
    return a > 0.02 ? { title: SORTS[sort][2], fact: `Gas at ${Math.round(100 * a)}% of the nebula’s peak density, ${(root.props.n as number) * a >= 1e9 ? 'thousands' : 'a few'} of atoms per cubic centimetre: a far better vacuum than any made on Earth, glowing because there is so much of it.` }
      : { title: 'Interstellar space', fact: 'Outside the cloud: a gas of a million atoms per cubic metre (not drawn).' }
  },
}

export const kinds = { nebula: volume(nebula) }
