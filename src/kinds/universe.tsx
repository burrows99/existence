// The observable universe: galaxies along a cosmic web, with the Milky Way at the centre (that is what "observable"
// means), Andromeda 2.5 million light-years away, and the cosmic microwave background at the edge.
import { DoubleSide } from 'three'
import { childrenOf, hash, mulberry32, type ChildSpec, type Far, type Vec3 } from '../engine/tree'
import { rootProps, volume, type Volume } from './volume'
import { LY, MILKY_WAY, galaxyCube } from './galaxy'

export const SIDE = 9.3e26 // metres; the observable universe is a sphere 8.8e26 m across
const R_CMB = 4.4e26 / SIDE
const MLY = 1e6 * LY
const LEAF_DEPTH = 16 // ~1.4 million light-year leaves
export const MW_POS: Vec3 = [0.00013, 0.00021, 0.00017] // a touch off the octree seams
const ANDROMEDA: Vec3 = [MW_POS[0] + (2.5 * MLY) / SIDE * 0.6, MW_POS[1] + (2.5 * MLY) / SIDE * 0.5, MW_POS[2] - (2.5 * MLY) / SIDE * 0.62]

export function mwPath() { // child indices from the universe node to the Milky Way
  const key: number[] = []
  let o: Vec3 = [0, 0, 0], s = 1
  for (let d = 0; d < LEAF_DEPTH; d++) {
    const ix = MW_POS[0] >= o[0] ? 1 : 0, iy = MW_POS[1] >= o[1] ? 1 : 0, iz = MW_POS[2] >= o[2] ? 1 : 0
    key.push(4 * ix + 2 * iy + iz)
    s /= 2
    o = [o[0] + (ix - 0.5) * s, o[1] + (iy - 0.5) * s, o[2] + (iz - 0.5) * s]
  }
  return `${key.join('.')}.0`
}

// the cosmic web: a few overlapping waves make sheets and filaments; galaxies crowd where they add up
function web(p: Vec3) {
  let v = 0
  for (const [kx, ky, kz, ph] of [[31, 17, 23, 0.3], [-19, 29, 13, 1.7], [11, -23, 37, 2.9], [41, 7, -29, 4.1], [-7, 13, 19, 5.3]]) v += Math.sin(kx * p[0] + ky * p[1] + kz * p[2] + ph)
  return v
}
// galaxies per cubic root-unit: ~2 trillion in all, concentrated on the web
const MEAN = 2e12 / (Math.PI / 6)
const density = (p: Vec3) => MEAN * Math.exp(2.2 * (web(p) - 1.6))

const KINDS = [
  { p: 0.75, rd: 1.5e3 * LY, hz: 300 * LY, n: 2e9, fb: 0.1, name: 'Dwarf galaxy', color: '#9fb4ff', fact: 'A few billion stars in a loose blob; most galaxies are like this.' },
  { p: 0.2, rd: 6e3 * LY, hz: 700 * LY, n: 4e10, fb: 0.15, name: 'Spiral galaxy', color: '#cbd8ff', fact: 'A disc of tens of billions of stars with spiral arms where gas is being squeezed into new ones.' },
  { p: 0.05, rd: 12e3 * LY, hz: 8e3 * LY, n: 4e11, fb: 0.9, name: 'Giant elliptical', color: '#ffd9a6', fact: 'Hundreds of billions of old red stars in a smooth swarm, the wreck of many merged galaxies.' },
]
const pick = (rng: () => number) => { let u = rng(); for (const k of KINDS) { if (u < k.p) return k; u -= k.p } return KINDS[0] }

const SPECIAL: [Vec3, Record<string, number | string>][] = [
  [MW_POS, MILKY_WAY],
  [ANDROMEDA, { rd: 12e3 * LY, hz: 1.2e3 * LY, n: 1e12, fb: 0.2, name: 'Andromeda', fact: 'The nearest big galaxy, 2.5 million light-years away and a trillion stars strong, falling toward us at 110 km/s; the two will merge in four billion years.' }],
]

const universe: Volume = {
  leafDepth: () => LEAF_DEPTH,
  open: () => 0.1,
  Near: () => (
    <mesh position={MW_POS}>
      <sphereGeometry args={[R_CMB, 64, 48]} />
      <meshBasicMaterial color="#5a2a1a" transparent opacity={0.25} side={DoubleSide} depthWrite={false} />
    </mesh>
  ),

  fill: (r, rng) => {
    const out: ChildSpec[] = []
    const inLeaf = (p: Vec3) => Math.max(...[0, 1, 2].map(i => Math.abs(p[i] - r.c[i]))) < r.s / 2
    for (const [p, props] of SPECIAL) if (inLeaf(p)) {
      out.push({ kind: 'galaxy', pos: [0, 1, 2].map(i => (p[i] - r.c[i]) / r.s) as Vec3, size: galaxyCube(props.rd as number) / (r.s * SIDE), props: { ...rootProps, ...props } })
    }
    if (Math.hypot(r.c[0] - MW_POS[0], r.c[1] - MW_POS[1], r.c[2] - MW_POS[2]) > R_CMB) return out // beyond what light has had time to show us
    const mean = density(r.c) * r.s ** 3
    let n = Math.floor(mean) + (rng() < mean - Math.floor(mean) ? 1 : 0)
    while (n-- > 0) {
      const k = pick(rng)
      out.push({ kind: 'galaxy', pos: [0, 1, 2].map(() => rng() - 0.5) as Vec3, size: galaxyCube(k.rd) / (r.s * SIDE), props: { ...rootProps, rd: k.rd, hz: k.hz, n: k.n, fb: k.fb, name: k.name, fact: k.fact } })
    }
    return out
  },

  far: (r, node) => {
    if (Math.hypot(r.c[0] - MW_POS[0], r.c[1] - MW_POS[1], r.c[2] - MW_POS[2]) - r.s * 0.87 > R_CMB) return null
    if (r.depth === LEAF_DEPTH) { // a closed leaf draws exactly its galaxies
      const out = childrenOf(node).map(c => ({ shape: 'point' as const, color: c.props.mw ? '#fff3dc' : (c.props.fb as number) > 0.5 ? '#ffd9a6' : '#cbd8ff', pos: c.pos }))
      return out.length ? out : null
    }
    const rng = mulberry32(hash(node.seed, 0x6a1a))
    const samples = [-0.5, 0, 0.5].flatMap(x => [-0.5, 0, 0.5].flatMap(y => [-0.5, 0, 0.5].map(z => density([r.c[0] + x * r.s, r.c[1] + y * r.s, r.c[2] + z * r.s]))))
    const dmax = Math.max(...samples), mean = (samples.reduce((a, b) => a + b, 0) / 27) * r.s ** 3
    const n = Math.min(48, Math.floor(mean) + (rng() < mean - Math.floor(mean) ? 1 : 0))
    if (n < 1) return null
    const alpha = Math.min(1, Math.max(0.2, Math.log10(mean / 48) / 4 + 0.2))
    const out: Far[] = []
    for (let i = 0, tries = 0; i < n && tries < 800; tries++) {
      const pos = [0, 1, 2].map(() => rng() - 0.5) as Vec3
      if (rng() * dmax * 1.5 > density([r.c[0] + pos[0] * r.s, r.c[1] + pos[1] * r.s, r.c[2] + pos[2] * r.s])) continue
      out.push({ shape: 'point', color: pick(rng).color, pos, alpha })
      i++
    }
    return out
  },

  info: r => {
    if (r.depth < 4) return { title: 'Observable universe', fact: '93 billion light-years across: everything whose light has had the 13.8 billion years since the Big Bang to reach us. Two trillion galaxies strung along a web of filaments around great voids, drawn here from a noise field rather than a survey. We are at the centre, because that is what "observable" means.' }
    const d = Math.hypot(r.c[0] - MW_POS[0], r.c[1] - MW_POS[1], r.c[2] - MW_POS[2])
    if (d > R_CMB) return { title: 'Beyond the horizon', fact: 'Space continues, but its light has not reached us yet.' }
    const w = web(r.c)
    return w > 1.5 ? { title: 'Galaxy filament', fact: 'A strand of the cosmic web, where galaxies crowd.' } : w < -1 ? { title: 'Void', fact: 'One of the great empty regions between the filaments, a hundred million light-years across with almost nothing in it.' } : { title: 'Intergalactic space', fact: 'A few galaxies every million light-years, and between them a gas of a single atom per cubic metre.' }
  },
}

export const kinds = { universe: volume(universe) }
