// What is left when a big star dies. A black hole is its event horizon, a black sphere of the real Schwarzschild
// radius, with the accretion disc drawn as a glowing stand-in (the real one is a thin plasma flow); a neutron star
// is a ball of neutrons at nuclear density, nested like the Earth's blocks because no one octree spans 20 km to
// femtometres.
import { hash, mulberry32, type Far, type Kind, type Vec3 } from '../engine/tree'
import { PERF } from '../engine/perf'
import { rootProps, volume, volumeRoot, type Volume } from './volume'

export const RS = 2953 // Schwarzschild radius per solar mass, metres: 2GM☉/c²
export const DISC = 40 // a black hole's cube is this many Schwarzschild radii across; the disc is drawn out to 15
export const R_NS = 1.2e4 // a neutron star's radius, metres (NICER puts it at 12–13 km)
const N0 = 1.6e44 // nuclear saturation density, nucleons per m³
const BLOCK = 1.3e-6 // the blocks of neutron matter a neutron star is divided into
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
const suns = (m: number) => (m >= 1e9 ? `${(m / 1e9).toPrecision(2)} billion` : m >= 1e6 ? `${(m / 1e6).toPrecision(3)} million` : m >= 1e3 ? `${Math.round(m).toLocaleString()}` : m.toPrecision(2))
const across = (m: number) => (m >= 1e9 ? `${(m / 1e9).toPrecision(2)} million km` : m >= 1e6 ? `${(m / 1e6).toPrecision(2)} thousand km` : `${(m / 1e3).toPrecision(2)} km`)

// the disc: points on a thin ring from the innermost stable orbit (3 radii) out to 15, white-hot inside, orange outside
function disc(seed: number, n: number): Far[] {
  const rng = mulberry32(hash(seed, 0xd15c)), out: Far[] = []
  for (let i = 0; i < n; i++) {
    const r = 3 + 12 * rng() ** 2, ph = 2 * Math.PI * rng() // crowded inward, where the real disc is brightest
    out.push({ shape: 'point', color: r < 5 ? '#ffffff' : r < 9 ? '#ffd9a6' : '#ff9a5a', pos: [(r / DISC) * Math.cos(ph), (rng() - 0.5) * 0.006, (r / DISC) * Math.sin(ph)], alpha: 0.5 + 0.5 * rng() })
  }
  return out
}

const blackhole: Kind = {
  // closed: the glow of the inner disc (a bright dot from afar), then the ring as it grows
  far: n => [{ shape: 'sphere', color: '#fff0d0', glow: true, minPx: 3, scale: 6 / DISC }, ...disc(n.seed, PERF.samples)],
  children: () => [{ kind: 'horizon', pos: [0, 0, 0], size: 2 / DISC }],
  inner: n => [{ shape: 'haze', color: '#ffe0b0', scale: 0.3 }, ...disc(n.seed, PERF.disc)],
  info: n => {
    const m = n.props.mass as number
    return { title: n.props.name as string, fact: `${suns(m)} solar masses${n.props.est ? ' (an estimate from the galaxy’s size: 4 million × (stars ÷ 10¹¹)^1.2)' : ''}, so an event horizon ${across(2 * RS * m)} across. ${n.props.fact ?? ''}The disc is a stand-in for the real accretion flow; inside the horizon nothing can be seen, and there is no known inner structure.` }
  },
}

const horizon: Kind = {
  far: () => ({ shape: 'sphere', color: '#000000', glow: true }), // glow with no colour: flat black, no shading
  info: n => ({ title: 'Event horizon', fact: `${across(n.metres)} across: the surface from inside which nothing, not even light, comes back out. General relativity puts a singularity at the centre; nobody knows what really replaces it. This is the end of what is known.` }),
}

// a ~24 km ball of neutron matter: 2.5× saturation density at the core, falling to 1× at the crust, then thinning
// out. ponytail: the real outer kilometre is a crust of nuclei and electrons, drawn here as free neutrons
const neutron: Volume = {
  leafDepth: root => Math.round(Math.log2(root.metres / BLOCK)),
  fill: (r, _rng, leaf) => {
    const root = volumeRoot(leaf), x = (len(r.c) * root.metres) / R_NS
    if (x > 1) return []
    const d = x < 0.92 ? N0 * (2.5 - 1.5 * (x / 0.92) ** 2) : N0 * Math.exp(-150 * (x - 0.92))
    return [{ kind: 'fluid', pos: [0, 0, 0], size: 1, props: { ...rootProps, f: 'neutron', d, leaf: 8e-15 } }]
  },
  far: (r, node) => {
    const R = R_NS / volumeRoot(node).metres
    if (r.depth === 0) return { shape: 'sphere', color: '#cfe0ff', minPx: 3, scale: 2 * R }
    if (r.depth < 10) return null // the sphere is the picture
    return len(r.c) < R ? { shape: 'haze', color: '#cfe0ff' } : null
  },
  info: (r, node) => {
    const root = volumeRoot(node)
    if (r.depth < 6) return { title: root.props.name as string, fact: `${root.props.fact} A city-sized ball of neutrons, ${(2 * R_NS / 1e3).toFixed(0)} km across, with more mass than the Sun; a teaspoon of it weighs a billion tonnes.` }
    const x = (len(r.c) * root.metres) / R_NS
    return x > 1 ? { title: 'Magnetosphere', fact: 'Empty space in a magnetic field a trillion times the Earth’s, whirling with the star; the radio beam comes from here (not drawn).' }
      : x > 0.92 ? { title: 'Crust', fact: 'The outer kilometre: really a lattice of neutron-rich nuclei in a sea of electrons, drawn here as neutrons thinning out toward the surface.' }
      : { title: 'Core', fact: 'Neutron matter at two to three times the density of an atomic nucleus. Whether the deepest part is still neutrons or has dissolved into quarks is not known.' }
  },
}

export const kinds = { blackhole, horizon, neutron: volume(neutron) }
