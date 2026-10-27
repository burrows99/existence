// The observable universe: galaxies along a cosmic web, with the Milky Way at the centre (that is what "observable"
// means), Andromeda 2.5 million light-years away, and the cosmic microwave background at the edge.
import { DoubleSide } from 'three'
import { childrenOf, hash, inCell, mulberry32, type ChildSpec, type Node, type Vec3 } from '../engine/tree'
import { PERF } from '../engine/perf'
import { regionOf, rootProps, volume, type Region, type Volume } from './volume'
import { LY, MILKY_WAY, galaxyCube } from './galaxy'

export const SIDE = 9.3e26 // metres; the observable universe is a sphere 8.8e26 m across
const R_CMB = 4.4e26 / SIDE
const LEAF_DEPTH = 16 // ~1.4 million light-year leaves
export const MW_POS: Vec3 = [0.00013, 0.00021, 0.00017] // a touch off the octree seams

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

// ---- the real neighbourhood ------------------------------------------------------------------------------------
// Positions from the sky (J2000 right ascension in hours, declination in degrees, distance in light-years) into this
// frame, in which the Milky Way lies flat with the Sun on its +x side and galactic north up
const EQ_TO_GAL = [[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.44482963, 0.7469822445], [-0.867666149, -0.1980763734, 0.4559837762]]
export function at(ra: number, dec: number, ly: number): Vec3 {
  const a = (ra * 15 * Math.PI) / 180, d = (dec * Math.PI) / 180
  const e = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]
  const g = EQ_TO_GAL.map(row => row[0] * e[0] + row[1] * e[1] + row[2] * e[2]), k = (ly * LY) / SIDE
  return [MW_POS[0] - g[0] * k, MW_POS[1] + g[2] * k, MW_POS[2] + g[1] * k]
}
type Place = {
  name: string; fact: string; ra: number; dec: number; ly: number
  galaxy?: { rd: number; hz: number; n: number; fb: number; bh?: number } // placed as a galaxy of this shape (bh: its central black hole, solar masses)
  boost?: [number, number] // a cluster: [σ in light-years, × the galaxies at its centre]
  hole?: number // a void: radius in light-years, emptied
  region?: number // just a name for everything within this radius
}
export const CATALOGUE: Place[] = [
  { name: 'Andromeda', ra: 0.712, dec: 41.27, ly: 2.54e6, galaxy: { rd: 12e3 * LY, hz: 1.2e3 * LY, n: 1e12, fb: 0.2 }, fact: 'The nearest big galaxy, 2.5 million light-years away and a trillion stars strong, falling toward us at 110 km/s; the two will merge in four billion years.' },
  { name: 'Triangulum Galaxy', ra: 1.564, dec: 30.66, ly: 2.73e6, galaxy: { rd: 5e3 * LY, hz: 500 * LY, n: 4e10, fb: 0.05 }, fact: 'The third-largest galaxy of the Local Group: forty billion stars in a loose spiral with hardly any bulge.' },
  { name: 'Large Magellanic Cloud', ra: 5.393, dec: -69.76, ly: 1.63e5, galaxy: { rd: 3e3 * LY, hz: 1e3 * LY, n: 2e10, fb: 0.1 }, fact: 'The Milky Way’s biggest satellite, 14,000 light-years across and a naked-eye cloud in southern skies; the Tarantula Nebula in it is the busiest star factory nearby.' },
  { name: 'Small Magellanic Cloud', ra: 0.878, dec: -72.8, ly: 2.0e5, galaxy: { rd: 1.5e3 * LY, hz: 1e3 * LY, n: 3e9, fb: 0.05 }, fact: 'A dwarf galaxy being pulled apart by the Milky Way and its bigger sibling, trailing a stream of gas across the sky.' },
  { name: 'Sagittarius Dwarf', ra: 18.917, dec: -30.48, ly: 7e4, galaxy: { rd: 1.5e3 * LY, hz: 1e3 * LY, n: 1e8, fb: 0.5 }, fact: 'A dwarf galaxy on the far side of the Milky Way’s core, in the middle of being torn apart and swallowed; its stars already wrap around our galaxy.' },
  { name: 'Centaurus A', ra: 13.424, dec: -43.02, ly: 1.2e7, galaxy: { rd: 10e3 * LY, hz: 8e3 * LY, n: 2e11, fb: 0.9 }, fact: 'The nearest big radio galaxy: an elliptical that swallowed a spiral and is still digesting it, with a black hole of 55 million suns firing jets a million light-years long.' },
  { name: 'Sculptor Galaxy', ra: 0.793, dec: -25.29, ly: 1.14e7, galaxy: { rd: 8e3 * LY, hz: 800 * LY, n: 1e11, fb: 0.1 }, fact: 'A starburst spiral seen nearly edge-on, making stars many times faster than the Milky Way does.' },
  { name: 'Bode’s Galaxy (M81)', ra: 9.927, dec: 69.07, ly: 1.18e7, galaxy: { rd: 7e3 * LY, hz: 700 * LY, n: 2.5e11, fb: 0.3 }, fact: 'A grand-design spiral of 250 billion stars, locked in a gravitational dance with the Cigar Galaxy next door.' },
  { name: 'Cigar Galaxy (M82)', ra: 9.931, dec: 69.68, ly: 1.15e7, galaxy: { rd: 4e3 * LY, hz: 1e3 * LY, n: 3e10, fb: 0.2 }, fact: 'Its close pass by M81 set off a starburst: stars form ten times faster than in the Milky Way, blowing a wind of gas out of its core.' },
  { name: 'Whirlpool Galaxy (M51)', ra: 13.498, dec: 47.2, ly: 2.3e7, galaxy: { rd: 8e3 * LY, hz: 700 * LY, n: 1.6e11, fb: 0.2 }, fact: 'The first spiral ever recognised as one (1845), its arms stretched by the small galaxy hanging off one of them.' },
  { name: 'Pinwheel Galaxy (M101)', ra: 14.053, dec: 54.35, ly: 2.1e7, galaxy: { rd: 15e3 * LY, hz: 800 * LY, n: 1e12, fb: 0.1 }, fact: 'A face-on spiral 170,000 light-years across, nearly twice the Milky Way, with a trillion stars.' },
  { name: 'Sombrero Galaxy (M104)', ra: 12.667, dec: -11.62, ly: 2.93e7, galaxy: { rd: 7e3 * LY, hz: 2e3 * LY, n: 8e11, fb: 0.6 }, fact: 'A bright bulge wrapped in a thick ring of dust, seen six degrees from edge-on, with a black hole of a billion suns at its centre.' },
  { name: 'Messier 87', ra: 12.514, dec: 12.39, ly: 5.35e7, galaxy: { rd: 30e3 * LY, hz: 25e3 * LY, n: 1e12, fb: 0.95 }, fact: 'The giant elliptical at the heart of the Virgo Cluster: a trillion stars and 15,000 globular clusters around the black hole of 6.5 billion suns that was photographed in 2019.' },
  { name: 'Local Group', ra: 0.712, dec: 41.27, ly: 1.3e6, region: 5e6, fact: 'The Milky Way, Andromeda, Triangulum and some eighty dwarf galaxies, bound together across ten million light-years; everything beyond is drifting away with the expansion of space.' },
  { name: 'Virgo Cluster', ra: 12.514, dec: 12.39, ly: 5.4e7, boost: [5e6, 20], fact: 'About 1,500 galaxies in a few million light-years, the nearest big cluster; its pull slows the Local Group’s drift away from it.' },
  { name: 'Fornax Cluster', ra: 3.633, dec: -35.45, ly: 6.2e7, boost: [4e6, 15], fact: 'The second-nearest cluster, some sixty galaxies in the southern sky.' },
  { name: 'Perseus Cluster', ra: 3.33, dec: 41.5, ly: 2.4e8, boost: [8e6, 25], fact: 'Thousands of galaxies in a cloud of 50-million-degree gas, the brightest X-ray source in the sky beyond the solar system, and the anchor of the Perseus–Pisces Supercluster.' },
  { name: 'Coma Cluster', ra: 12.983, dec: 27.98, ly: 3.21e8, boost: [8e6, 30], fact: 'Ten thousand galaxies. In 1933 Fritz Zwicky found them moving far too fast for the mass he could see: the first sign of dark matter.' },
  { name: 'Norma Cluster and the Great Attractor', ra: 16.25, dec: -60.9, ly: 2.2e8, boost: [1.5e7, 15], fact: 'The dense heart of Laniakea, hidden behind the dust of the Milky Way; the mass here and beyond it pulls our galaxy along at 600 km/s.' },
  { name: 'Hercules Cluster', ra: 16.083, dec: 17.7, ly: 5.0e8, boost: [2e7, 10], fact: 'A loose, young cluster of spirals still falling together, 500 million light-years away.' },
  { name: 'Shapley Supercluster', ra: 13.467, dec: -31.5, ly: 6.5e8, boost: [2.5e7, 25], fact: 'The biggest concentration of galaxies in the nearby universe, 650 million light-years away, with the mass of ten thousand Milky Ways.' },
  { name: 'Boötes Void', ra: 14.833, dec: 46, ly: 7.0e8, hole: 1.65e8, fact: 'A hole 330 million light-years across with only sixty-odd galaxies in it, where two thousand would be expected. If the Milky Way were at its centre, we would not have known there were other galaxies until the 1960s.' },
  { name: 'Laniakea Supercluster', ra: 16.25, dec: -60.9, ly: 2.2e8, region: 2.6e8, fact: 'Our supercluster, 520 million light-years across and a hundred thousand galaxies, defined in 2014 as everything that flows toward the Great Attractor; the Milky Way sits near its edge.' },
  // the Milky Way's other satellites and the Local Group's neighbours
  { name: 'Fornax Dwarf', ra: 2.666, dec: -34.45, ly: 4.6e5, galaxy: { rd: 1.5e3 * LY, hz: 1e3 * LY, n: 4e7, fb: 0.9 }, fact: 'A dwarf spheroidal satellite of the Milky Way, 460,000 light-years away: tens of millions of old stars, six globular clusters of its own, and hardly any gas.' },
  { name: 'Sculptor Dwarf', ra: 1.003, dec: -33.71, ly: 2.9e5, galaxy: { rd: 1e3 * LY, hz: 1e3 * LY, n: 1e7, fb: 0.9 }, fact: 'The first dwarf spheroidal galaxy found (1938): a few million old stars 290,000 light-years away, held together mostly by dark matter.' },
  { name: 'Leo I', ra: 10.141, dec: 12.31, ly: 8.2e5, galaxy: { rd: 1e3 * LY, hz: 1e3 * LY, n: 2e7, fb: 0.9 }, fact: 'One of the most distant of the Milky Way’s satellites, 820,000 light-years out, a dwarf spheroidal that was still forming stars a billion years ago.' },
  { name: 'Draco Dwarf', ra: 17.337, dec: 57.92, ly: 2.6e5, galaxy: { rd: 700 * LY, hz: 700 * LY, n: 3e6, fb: 0.9 }, fact: 'A faint dwarf spheroidal 260,000 light-years away, among the most dark-matter-dominated galaxies known: its stars move as if there were thirty times more mass than can be seen.' },
  { name: 'Ursa Minor Dwarf', ra: 15.153, dec: 67.22, ly: 2.25e5, galaxy: { rd: 700 * LY, hz: 700 * LY, n: 3e6, fb: 0.9 }, fact: 'A dwarf spheroidal 225,000 light-years away whose stars are all ancient: it stopped forming them twelve billion years ago.' },
  { name: 'Messier 83', ra: 13.617, dec: -29.87, ly: 1.5e7, galaxy: { rd: 6e3 * LY, hz: 600 * LY, n: 4e10, fb: 0.2 }, fact: 'The Southern Pinwheel: a barred spiral seen face-on, 15 million light-years away, with six supernovae seen in a century.' },
  { name: 'Leo Triplet', ra: 11.33, dec: 13.2, ly: 3.5e7, region: 1.2e6, fact: 'Three spirals 35 million light-years away, close enough to pull each other out of shape: M65, M66 and the edge-on NGC 3628.' },
  { name: 'Messier 65', ra: 11.316, dec: 13.09, ly: 3.5e7, galaxy: { rd: 6e3 * LY, hz: 600 * LY, n: 1e11, fb: 0.3 }, fact: 'A spiral of the Leo Triplet, tilted nearly edge-on, with little gas left to make new stars.' },
  { name: 'Messier 66', ra: 11.337, dec: 12.99, ly: 3.1e7, galaxy: { rd: 7e3 * LY, hz: 700 * LY, n: 1e11, fb: 0.3 }, fact: 'The brightest of the Leo Triplet, its arms and dust lanes warped by its neighbours.' },
  { name: 'NGC 3628', ra: 11.337, dec: 13.59, ly: 3.5e7, galaxy: { rd: 7e3 * LY, hz: 800 * LY, n: 1e11, fb: 0.2 }, fact: 'The Hamburger Galaxy: a spiral seen exactly edge-on, split by a dark lane of dust, trailing a tail of stars 300,000 light-years long.' },
  { name: 'Antennae Galaxies', ra: 12.031, dec: -18.87, ly: 4.5e7, galaxy: { rd: 8e3 * LY, hz: 1.5e3 * LY, n: 3e11, fb: 0.3 }, fact: 'Two spirals, NGC 4038 and 4039, in the middle of colliding: 45 million light-years away, their stars thrown out in two long tails. Drawn here as one galaxy.' },
  { name: 'Hoag’s Object', ra: 15.287, dec: 21.59, ly: 6.0e8, galaxy: { rd: 15e3 * LY, hz: 1.5e3 * LY, n: 1e11, fb: 0.5 }, fact: 'A ring galaxy 600 million light-years away: a core of old yellow stars inside a detached ring of young blue ones, with almost nothing between. Nobody is sure how it formed.' },
  { name: 'Cygnus A', ra: 19.991, dec: 40.73, ly: 7.6e8, galaxy: { rd: 15e3 * LY, hz: 10e3 * LY, n: 3e11, fb: 0.9 }, fact: 'The brightest radio galaxy in the sky, 760 million light-years away: an elliptical whose central black hole fires two jets that end in lobes 500,000 light-years apart.' },
  { name: '3C 273', ra: 12.485, dec: 2.05, ly: 2.44e9, galaxy: { rd: 15e3 * LY, hz: 10e3 * LY, n: 5e11, fb: 0.9, bh: 8.9e8 }, fact: 'The first quasar identified (1963) and the brightest in our sky: a black hole of 900 million suns, 2.4 billion light-years away, feeding so hard that its disc outshines four trillion Suns.' },
  { name: 'TON 618', ra: 12.473, dec: 31.47, ly: 1.82e10, galaxy: { rd: 20e3 * LY, hz: 15e3 * LY, n: 1e12, fb: 0.9, bh: 6.6e10 }, fact: 'A quasar whose light left 10.4 billion years ago (the galaxy is now 18 billion light-years away): around a black hole of some 40 to 66 billion suns, one of the most massive known.' },
  { name: 'IC 1101', ra: 15.182, dec: 5.74, ly: 1.04e9, galaxy: { rd: 1.5e5 * LY, hz: 1e5 * LY, n: 1e14, fb: 0.95 }, fact: 'The largest galaxy known: a giant elliptical at the centre of the cluster Abell 2029, a billion light-years away, with a diffuse halo of stars four million light-years across and a hundred trillion stars.' },
  { name: 'GN-z11', ra: 12.607, dec: 62.24, ly: 3.2e10, galaxy: { rd: 500 * LY, hz: 300 * LY, n: 1e9, fb: 0.5 }, fact: 'One of the most distant galaxies known: its light set out 13.4 billion years ago, when the universe was 400 million years old. Expansion has since carried it 32 billion light-years away.' },
  // groups, clusters, superclusters, walls and voids
  { name: 'M81 Group', ra: 9.93, dec: 69.1, ly: 1.18e7, region: 3e6, fact: 'One of the nearest groups to our own: M81, M82 and some thirty dwarfs, 12 million light-years away.' },
  { name: 'Sculptor Group', ra: 0.8, dec: -27, ly: 1.2e7, region: 4e6, fact: 'A loose string of galaxies 12 million light-years away along the southern sky, the Sculptor Galaxy the brightest of them.' },
  { name: 'Centaurus A / M83 Group', ra: 13.5, dec: -36, ly: 1.3e7, region: 4e6, fact: 'Two clumps of galaxies 13 million light-years away, around Centaurus A and M83, the nearest group of its size beyond our own.' },
  { name: 'Virgo Supercluster', ra: 12.514, dec: 12.39, ly: 5.4e7, region: 5.5e7, fact: 'The Local Supercluster: a flattened cloud 110 million light-years across of a hundred groups of galaxies, ours included, around the Virgo Cluster. Since 2014 it counts as one lobe of Laniakea.' },
  { name: 'Centaurus Cluster', ra: 12.814, dec: -41.31, ly: 1.7e8, boost: [5e6, 15], fact: 'A cluster of a few hundred galaxies 170 million light-years away, the main knot of the Hydra–Centaurus Supercluster.' },
  { name: 'Hydra Cluster', ra: 10.613, dec: -27.53, ly: 1.6e8, boost: [5e6, 12], fact: 'A compact cluster 160 million light-years away, the other anchor of the Hydra–Centaurus Supercluster.' },
  { name: 'Hydra–Centaurus Supercluster', ra: 12, dec: -35, ly: 1.7e8, region: 8e7, fact: 'The supercluster next door, 170 million light-years away, which Laniakea’s definition swallowed along with ours.' },
  { name: 'Pavo–Indus Supercluster', ra: 20.5, dec: -50, ly: 2.3e8, region: 7e7, fact: 'A supercluster 230 million light-years away in the far southern sky, also part of Laniakea.' },
  { name: 'Abell 2029', ra: 15.182, dec: 5.74, ly: 1.04e9, boost: [8e6, 25], fact: 'A rich cluster a billion light-years away, built around the giant galaxy IC 1101.' },
  { name: 'Perseus–Pisces Supercluster', ra: 1.5, dec: 30, ly: 2.5e8, region: 1.2e8, fact: 'A wall of clusters 300 million light-years long on the opposite side of the sky from Laniakea, the Perseus Cluster at one end of it.' },
  { name: 'CfA2 Great Wall', ra: 13, dec: 29, ly: 2.5e8, region: 2.5e8, fact: 'The Great Wall of 1989, the first giant structure ever mapped: a sheet of galaxies 500 million light-years long and only 15 million thick, with the Coma Cluster at its heart.' },
  { name: 'Horologium Supercluster', ra: 3.3, dec: -50, ly: 7e8, boost: [4e7, 8], region: 2.5e8, fact: 'A supercluster 700 million light-years away, 550 million light-years long, with thousands of galaxy clusters in it.' },
  { name: 'Pisces–Cetus Supercluster Complex', ra: 1, dec: -5, ly: 9e8, region: 5e8, fact: 'A complex of superclusters a billion light-years long, of which Laniakea and Perseus–Pisces are only parts; drawn here as a name, its shape is not modelled.' },
  { name: 'Sloan Great Wall', ra: 11.5, dec: 0, ly: 1.0e9, region: 6e8, fact: 'A wall of galaxies 1.37 billion light-years long, a billion light-years away, found in the Sloan survey in 2003; drawn here as a name, its shape is not modelled.' },
  { name: 'Hercules–Corona Borealis Great Wall', ra: 17.3, dec: 27.5, ly: 1.7e10, region: 5e9, fact: 'A clump of gamma-ray bursts found in 2013 that may trace a structure ten billion light-years long, the largest known if it is real; whether it is remains argued.' },
  { name: 'Local Void', ra: 18.63, dec: 18, ly: 7.5e7, hole: 7e7, fact: 'A near-empty region 150 million light-years across right beside the Local Group; the lack of mass there pushes us away at 260 km/s.' },
  { name: 'Eridanus Supervoid', ra: 3.25, dec: -19.6, ly: 3e9, hole: 5e8, fact: 'An under-dense region a billion light-years across, found behind the cold spot in the cosmic microwave background and possibly its cause.' },
]
const STRUCTURES = CATALOGUE.filter(c => c.boost || c.hole).map(c => ({ pos: at(c.ra, c.dec, c.ly), sigma: ((c.boost?.[0] ?? 0) * LY) / SIDE, factor: c.boost?.[1] ?? 0, hole: ((c.hole ?? 0) * LY) / SIDE }))
const NAMED = CATALOGUE.filter(c => !c.galaxy).map(c => ({ ...c, pos: at(c.ra, c.dec, c.ly), radius: ((c.region ?? c.hole ?? 2 * c.boost![0]) * LY) / SIDE })).sort((a, b) => a.radius - b.radius)
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
// clusters crowd the galaxies around them, voids empty them
function structure(p: Vec3) {
  let f = 1
  for (const s of STRUCTURES) {
    const d = dist(p, s.pos)
    if (s.factor) f *= 1 + s.factor * Math.exp(-0.5 * (d / s.sigma) ** 2)
    if (s.hole) f *= 1 - 0.97 * Math.exp(-((d / s.hole) ** 6))
  }
  return f
}

// the cosmic web: a few overlapping waves make sheets and filaments; galaxies crowd where they add up
function web(p: Vec3) {
  let v = 0
  for (const [kx, ky, kz, ph] of [[31, 17, 23, 0.3], [-19, 29, 13, 1.7], [11, -23, 37, 2.9], [41, 7, -29, 4.1], [-7, 13, 19, 5.3]]) v += Math.sin(kx * p[0] + ky * p[1] + kz * p[2] + ph)
  return v
}
// galaxies per cubic root-unit: ~2 trillion in all, concentrated on the web
const MEAN = 2e12 / (Math.PI / 6)
const density = (p: Vec3) => MEAN * Math.exp(2.2 * (web(p) - 1.6)) * structure(p)

const KINDS = [
  { p: 0.75, rd: 1.5e3 * LY, hz: 300 * LY, n: 2e9, fb: 0.1, name: 'Dwarf galaxy', color: '#9fb4ff', fact: 'A few billion stars in a loose blob; most galaxies are like this.' },
  { p: 0.2, rd: 6e3 * LY, hz: 700 * LY, n: 4e10, fb: 0.15, name: 'Spiral galaxy', color: '#cbd8ff', fact: 'A disc of tens of billions of stars with spiral arms where gas is being squeezed into new ones.' },
  { p: 0.05, rd: 12e3 * LY, hz: 8e3 * LY, n: 4e11, fb: 0.9, name: 'Giant elliptical', color: '#ffd9a6', fact: 'Hundreds of billions of old red stars in a smooth swarm, the wreck of many merged galaxies.' },
]
const pick = (rng: () => number) => { let u = rng(); for (const k of KINDS) { if (u < k.p) return k; u -= k.p } return KINDS[0] }

// A closed region is drawn as a sample of the galaxies it holds, and the sample persists: a region's sample is its
// parent's samples that fall inside it (first, so they are the last to be thinned) plus new ones up to what its
// density expects, and a leaf makes every sample that reached it a real galaxy. So a galaxy seen from afar is still
// there, in the same place, when you arrive.
type Sample = { pos: Vec3; k: number } // in root units; which of KINDS
const samples = new WeakMap<Node, { sample: Sample[]; mean: number }>()
function samplesOf(node: Node, r: Region): { sample: Sample[]; mean: number } {
  let s = samples.get(node)
  if (s) return s
  const parent = node.parent
  const above: Sample[] = parent && parent.kind === node.kind && (parent.props.depth as number) >= 5 ? samplesOf(parent, regionOf(parent)).sample : []
  const sample = above.filter(p => Math.max(Math.abs(p.pos[0] - r.c[0]), Math.abs(p.pos[1] - r.c[1]), Math.abs(p.pos[2] - r.c[2])) < r.s / 2)
  const rng = mulberry32(hash(node.seed, 0x6a1a))
  // the density at 27 points of the region: a cell is picked by its weight and a point drawn anywhere in it
  const lattice = [-0.5, 0, 0.5].flatMap(x => [-0.5, 0, 0.5].flatMap(y => [-0.5, 0, 0.5].map(z => density([r.c[0] + x * r.s, r.c[1] + y * r.s, r.c[2] + z * r.s]))))
  const total = lattice.reduce((a, b) => a + b, 0), mean = (total / 27) * r.s ** 3
  const want = Math.min(PERF.samples, Math.floor(mean) + (rng() < mean - Math.floor(mean) ? 1 : 0))
  while (sample.length < want) {
    const p = inCell(lattice, total, rng)
    sample.push({ pos: [r.c[0] + p[0] * r.s, r.c[1] + p[1] * r.s, r.c[2] + p[2] * r.s], k: KINDS.indexOf(pick(rng)) })
  }
  samples.set(node, (s = { sample, mean }))
  return s
}

const SPECIAL: [Vec3, Record<string, number | string>][] = [
  [MW_POS, MILKY_WAY],
  ...CATALOGUE.filter(c => c.galaxy).map((c): [Vec3, Record<string, number | string>] => [at(c.ra, c.dec, c.ly), { ...c.galaxy!, name: c.name, fact: c.fact }]),
]

const universe: Volume = {
  deep: true,
  leafDepth: () => LEAF_DEPTH,
  open: () => 0.2, // coarse, like the galaxy: finer and a tenth of the universe is a million buffered sample points
  Near: () => (
    <mesh position={MW_POS}>
      <sphereGeometry args={[R_CMB, 64, 48]} />
      <meshBasicMaterial color="#5a2a1a" transparent opacity={0.25} side={DoubleSide} depthWrite={false} />
    </mesh>
  ),

  fill: (r, rng, leaf) => {
    const out: ChildSpec[] = []
    const inLeaf = (p: Vec3) => Math.max(...[0, 1, 2].map(i => Math.abs(p[i] - r.c[i]))) < r.s / 2
    for (const [p, props] of SPECIAL) if (inLeaf(p)) {
      out.push({ kind: 'galaxy', pos: [0, 1, 2].map(i => (p[i] - r.c[i]) / r.s) as Vec3, size: galaxyCube(props.rd as number) / (r.s * SIDE), props: { ...rootProps, ...props } })
    }
    if (Math.hypot(r.c[0] - MW_POS[0], r.c[1] - MW_POS[1], r.c[2] - MW_POS[2]) > R_CMB) return out // beyond what light has had time to show us
    // the galaxies drawn for this leaf from afar become real, exactly where they were, then the rest of the expected number
    const { sample, mean } = samplesOf(leaf, r)
    const add = (p: Vec3, k: (typeof KINDS)[number]) => out.push({ kind: 'galaxy', pos: p, size: galaxyCube(k.rd) / (r.s * SIDE), props: { ...rootProps, rd: k.rd, hz: k.hz, n: k.n, fb: k.fb, name: k.name, fact: k.fact } })
    for (const s of sample) add([0, 1, 2].map(i => (s.pos[i] - r.c[i]) / r.s) as Vec3, KINDS[s.k])
    let n = Math.floor(mean) + (rng() < mean - Math.floor(mean) ? 1 : 0) - sample.length
    while (n-- > 0) add([0, 1, 2].map(() => rng() - 0.5) as Vec3, pick(rng))
    return out
  },

  far: (r, node) => {
    if (Math.hypot(r.c[0] - MW_POS[0], r.c[1] - MW_POS[1], r.c[2] - MW_POS[2]) - r.s * 0.87 > R_CMB) return null
    if (r.depth === LEAF_DEPTH) { // a closed leaf draws exactly its galaxies
      const out = childrenOf(node).map(c => ({ shape: 'point' as const, color: c.props.mw ? '#fff3dc' : (c.props.fb as number) > 0.5 ? '#ffd9a6' : '#cbd8ff', pos: c.pos }))
      return out.length ? out : null
    }
    const { sample, mean } = samplesOf(node, r)
    if (!sample.length) return null
    const alpha = Math.min(1, Math.max(0.2, Math.log10(mean / PERF.samples) / 4 + 0.2))
    return sample.map(s => ({ shape: 'point' as const, color: KINDS[s.k].color, pos: [0, 1, 2].map(i => (s.pos[i] - r.c[i]) / r.s) as Vec3, alpha }))
  },

  info: r => {
    if (r.depth < 4) return { title: 'Observable universe', fact: '93 billion light-years across: everything whose light has had the 13.8 billion years since the Big Bang to reach us. Two trillion galaxies strung along a web of filaments around great voids, drawn here from a noise field rather than a survey. We are at the centre, because that is what "observable" means.' }
    const d = Math.hypot(r.c[0] - MW_POS[0], r.c[1] - MW_POS[1], r.c[2] - MW_POS[2])
    if (d > R_CMB) return { title: 'Beyond the horizon', fact: 'Space continues, but its light has not reached us yet.' }
    const named = NAMED.find(s => r.s < 2 * s.radius && dist(r.c, s.pos) < s.radius) // the smallest named structure this region sits in
    if (named) return { title: named.name, fact: named.fact }
    const w = web(r.c)
    return w > 1.5 ? { title: 'Galaxy filament', fact: 'A strand of the cosmic web, where galaxies crowd.' } : w < -1 ? { title: 'Void', fact: 'One of the great empty regions between the filaments, a hundred million light-years across with almost nothing in it.' } : { title: 'Intergalactic space', fact: 'A few galaxies every million light-years, and between them a gas of a single atom per cubic metre.' }
  },
}

export const kinds = { universe: volume(universe) }
