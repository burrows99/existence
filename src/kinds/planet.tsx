// Planets other than ours, moons, dwarf planets and asteroids: rocky ones layered iron / rock with thin air, icy
// ones rock under ice (and an ocean where there is one), gas giants of hydrogen and helium thickening into metallic
// hydrogen around a rocky core. A procedural asteroid is a row of the table with its own radius in its props.
// (Our Earth is kinds/earth.tsx.)
import type { Node, Vec3 } from '../engine/tree'
import { rootProps, volume, volumeRoot, type Volume } from './volume'

const BLOCK = 1.3e-6
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])

type Material = 'iron' | 'melt' | 'forsterite' | 'quartz' | 'rock' | 'ice' | 'frost' | 'water' | 'metallic' | 'h2'
type Atmosphere = { f: 'co2' | 'h2' | 'air'; d0: number; h: number; top: number } // molecules/m³ at the surface (air: times sea-level air), scale height, extent (m)
type Planet = { name: string; r: number; color: string; layers: [number, Material][]; atm?: Atmosphere; fact: string; what?: string } // what: for the search list

export const PLANETS: Planet[] = [
  { name: 'Mercury', r: 2.44e6, color: '#9a9a9a', layers: [[0.83, 'iron'], [1, 'forsterite']], fact: 'An iron ball with a thin rocky rind, baked and frozen by turns, with no air to speak of.' },
  { name: 'Venus', r: 6.05e6, color: '#e6c58a', layers: [[0.53, 'melt'], [0.99, 'forsterite'], [1, 'quartz']], atm: { f: 'co2', d0: 2.3e27, h: 15.9e3, top: 250e3 }, fact: 'Earth’s twin under 90 atmospheres of carbon dioxide, hot enough at the surface to melt lead.' },
  { name: 'The Moon', r: 1.737e6, color: '#b0b0b0', layers: [[0.2, 'iron'], [1, 'forsterite']], what: 'our moon', fact: 'Rock knocked off the young Earth, 384,000 km away, drifting four centimetres further every year.' },
  { name: 'Mars', r: 3.39e6, color: '#c1603a', layers: [[0.5, 'iron'], [0.99, 'forsterite'], [1, 'quartz']], atm: { f: 'co2', d0: 1.5e23, h: 11e3, top: 200e3 }, fact: 'Half the size of Earth, with a wisp of carbon dioxide for air and rust-red dust over basalt.' },
  { name: 'Jupiter', r: 6.99e7, color: '#d8b48a', layers: [[0.1, 'iron'], [0.8, 'metallic'], [1, 'h2']], atm: { f: 'h2', d0: 2.7e25, h: 27e3, top: 1e6 }, fact: 'Eleven Earths across and 318 times the mass: hydrogen and helium squeezed into a metal around a rocky core.' },
  { name: 'Saturn', r: 5.82e7, color: '#e8d9a8', layers: [[0.15, 'iron'], [0.6, 'metallic'], [1, 'h2']], atm: { f: 'h2', d0: 1.2e25, h: 60e3, top: 1.5e6 }, fact: 'Less dense than water. The rings (not modelled yet) are ice, a few metres thick and 280,000 km across.' },
  { name: 'Uranus', r: 2.54e7, color: '#9fd8e0', layers: [[0.2, 'iron'], [0.8, 'ice'], [1, 'h2']], atm: { f: 'h2', d0: 3e25, h: 28e3, top: 1e6 }, fact: 'An ice giant tipped on its side: water, ammonia and methane ices (drawn as water) under a hydrogen sky.' },
  { name: 'Neptune', r: 2.46e7, color: '#4a6fd8', layers: [[0.2, 'iron'], [0.8, 'ice'], [1, 'h2']], atm: { f: 'h2', d0: 3e25, h: 20e3, top: 1e6 }, fact: 'The windiest place in the solar system, 2,000 km/h, four and a half billion km from the Sun.' },
  // dwarf planets and the big asteroids (radii are mean radii; densities set the rock fraction)
  { name: 'Pluto', r: 1.1883e6, color: '#d8b89a', layers: [[0.7, 'forsterite'], [1, 'frost']], what: 'dwarf planet', fact: 'Rock under a mantle of water ice, nitrogen and methane frost on top, and a wisp of nitrogen air (1 Pa, not drawn); its 248-year orbit crosses inside Neptune’s.' },
  { name: 'Charon', r: 6.06e5, color: '#b8b0a8', layers: [[0.6, 'rock'], [1, 'frost']], what: 'moon of Pluto', fact: 'Half Pluto’s width and an eighth of its mass: the two circle a point between them every 6.4 days, each keeping the same face to the other.' },
  { name: 'Ceres', r: 4.697e5, color: '#9a948c', layers: [[0.78, 'rock'], [1, 'frost']], what: 'dwarf planet', fact: 'The largest body in the asteroid belt and a third of its mass: rock under a hundred kilometres of ice and clay, with bright salt in its craters.' },
  { name: 'Vesta', r: 2.627e5, color: '#b8b0a0', layers: [[0.42, 'iron'], [1, 'forsterite']], what: 'asteroid', fact: 'A protoplanet with an iron core and a basalt crust, the brightest asteroid and at times a naked-eye one; the crater at its south pole is nearly as wide as Vesta itself.' },
  { name: 'Pallas', r: 2.56e5, color: '#8a8a88', layers: [[1, 'rock']], what: 'asteroid', fact: 'The third-largest asteroid, on an orbit tilted 35° out of the plane of the planets.' },
  { name: 'Hygiea', r: 2.17e5, color: '#605850', layers: [[1, 'rock']], what: 'asteroid', fact: 'The fourth-largest asteroid, dark carbonaceous rock and nearly round, which may qualify it as a dwarf planet.' },
  { name: 'Eris', r: 1.163e6, color: '#e8e8e8', layers: [[0.78, 'forsterite'], [1, 'frost']], what: 'dwarf planet', fact: 'A little smaller than Pluto and a quarter heavier, on a 559-year orbit between 38 and 98 AU that passed its far end in 1977; methane frost makes it one of the brightest surfaces known.' },
  { name: 'Makemake', r: 7.15e5, color: '#c89a78', layers: [[0.7, 'forsterite'], [1, 'frost']], what: 'dwarf planet', fact: 'Two-thirds the size of Pluto, red-brown with methane frost, 38 to 53 AU from the Sun on a 306-year orbit.' },
  { name: 'Haumea', r: 7.8e5, color: '#e0e0e8', layers: [[0.8, 'forsterite'], [1, 'frost']], what: 'dwarf planet', fact: 'Spun into an egg some 2,000 km long that turns every four hours: mostly rock under a thin shell of ice, with a ring and two moons (not drawn).' },
  { name: 'Sedna', r: 5e5, color: '#c86a50', layers: [[0.6, 'rock'], [1, 'frost']], what: 'dwarf planet', fact: 'The most distant dwarf planet known: an 11,400-year orbit from 76 to 900 AU, never nearer the Sun than twice Neptune, with a deep red surface of frozen methane and tholins.' },
  // moons
  { name: 'Io', r: 1.8216e6, color: '#d8c060', layers: [[0.52, 'iron'], [1, 'forsterite']], what: 'moon of Jupiter', fact: 'The most volcanic body known: Jupiter’s tides knead its interior and 400 volcanoes paint it yellow with sulphur, over an iron core and a mantle of partly molten rock.' },
  { name: 'Europa', r: 1.5608e6, color: '#c8b8a0', layers: [[0.4, 'iron'], [0.92, 'forsterite'], [0.987, 'water'], [1, 'frost']], what: 'moon of Jupiter', fact: 'A salty ocean 100 km deep under 20 km of ice, kept liquid by Jupiter’s tides, holding more water than all of Earth’s oceans.' },
  { name: 'Ganymede', r: 2.6341e6, color: '#a89888', layers: [[0.3, 'iron'], [0.65, 'forsterite'], [1, 'frost']], what: 'moon of Jupiter', fact: 'The largest moon in the solar system, bigger than Mercury: an iron core, a rock mantle and 800 km of ice with an ocean somewhere in it (not placed), and a magnetic field of its own.' },
  { name: 'Callisto', r: 2.4103e6, color: '#786858', layers: [[0.5, 'rock'], [1, 'frost']], what: 'moon of Jupiter', fact: 'The most heavily cratered body known, half rock and half ice barely sorted into layers (drawn as a rock core under ice), far enough from Jupiter to escape its tides.' },
  { name: 'Titan', r: 2.5747e6, color: '#d8a848', layers: [[0.8, 'forsterite'], [0.96, 'water'], [1, 'frost']], atm: { f: 'air', d0: 4.5, h: 21e3, top: 1e6 }, what: 'moon of Saturn', fact: 'The only moon with a thick atmosphere: nitrogen at 1.5 bar under an orange smog, with methane rain and lakes at −180 °C on an ice crust over a water ocean.' },
  { name: 'Enceladus', r: 2.521e5, color: '#f0f4f8', layers: [[0.75, 'rock'], [0.9, 'water'], [1, 'frost']], what: 'moon of Saturn', fact: 'As bright as fresh snow: geysers at its south pole vent a salty ocean into space, and that is where Saturn’s E ring comes from.' },
  { name: 'Rhea', r: 7.638e5, color: '#c0bcb8', layers: [[0.45, 'rock'], [1, 'frost']], what: 'moon of Saturn', fact: 'Saturn’s second-largest moon, three-quarters ice and a quarter rock, cratered everywhere.' },
  { name: 'Iapetus', r: 7.345e5, color: '#a09080', layers: [[0.42, 'rock'], [1, 'frost']], what: 'moon of Saturn', fact: 'One side as dark as coal and the other as bright as snow, with a ridge of mountains 13 km high along its equator; 3.6 million km out, on an orbit really tilted 15° to Saturn’s equator.' },
  { name: 'Titania', r: 7.884e5, color: '#b0a8a0', layers: [[0.62, 'rock'], [1, 'frost']], what: 'moon of Uranus', fact: 'Uranus’s largest moon, half rock and half ice, split by canyons that opened when its interior froze and swelled.' },
  { name: 'Oberon', r: 7.614e5, color: '#a09890', layers: [[0.6, 'rock'], [1, 'frost']], what: 'moon of Uranus', fact: 'The outermost of Uranus’s big moons, old cratered ice over rock, circling the planet’s equator, which is tipped nearly edge-on to its orbit.' },
  { name: 'Triton', r: 1.3534e6, color: '#d8c8c0', layers: [[0.7, 'forsterite'], [1, 'frost']], what: 'moon of Neptune', fact: 'Neptune’s big moon orbits backwards, a captured Kuiper belt object with nitrogen geysers and a surface at −235 °C; its real orbit is tipped 23° from Neptune’s equator and runs the other way.' },
  { name: 'Phobos', r: 1.11e4, color: '#7a7068', layers: [[1, 'rock']], what: 'moon of Mars', fact: '27 × 22 × 18 km of rubble skimming Mars 6,000 km above the ground every 7.7 hours, and spiralling in: it will break up into a ring in some 50 million years.' },
  { name: 'Deimos', r: 6.2e3, color: '#8a8078', layers: [[1, 'rock']], what: 'moon of Mars', fact: '15 × 12 × 11 km of rock, the smaller and farther of Mars’s two moons, 23,000 km out.' },
  // the belts' bodies (solar.tsx): the radius comes from each body's own props
  { name: 'Carbonaceous asteroid', r: 1e3, color: '#5a5550', layers: [[1, 'rock']], fact: 'Dark, water-bearing rock, the commonest kind: three asteroids in four are like this. Procedural: the belt’s numbers and sizes are real, this body is not a catalogued one.' },
  { name: 'Stony asteroid', r: 1e3, color: '#a09080', layers: [[1, 'rock']], fact: 'Olivine and pyroxene rock, the kind that falls to Earth as ordinary chondrites. Procedural: the belt’s numbers and sizes are real, this body is not a catalogued one.' },
  { name: 'Metallic asteroid', r: 1e3, color: '#8a8a95', layers: [[1, 'iron']], fact: 'Iron and nickel from the core of a shattered protoplanet. Procedural: the belt’s numbers and sizes are real, this body is not a catalogued one.' },
  { name: 'Kuiper belt object', r: 1e3, color: '#b8c8d8', layers: [[0.5, 'rock'], [1, 'frost']], fact: 'Ice and rock at −230 °C, a comet nucleus that never fell sunward. Procedural: the belt’s density and size distribution are real, this body is not a catalogued one.' },
]
export const cubeOf = (p: number, r = PLANETS[p].r) => 2.2 * r + 2 * (PLANETS[p].atm?.top ?? 0)
// a body's row, with the radius and position note a placed body may carry in its own props
const bodyOf = (root: Node): Planet => { const P = PLANETS[root.props.p as number]; return { ...P, r: (root.props.r as number) || P.r, fact: (root.props.fact as string) || P.fact } }

const HAZE: Record<Material, string> = { iron: '#8a8a95', melt: '#c05a2a', forsterite: '#7a8a3a', quartz: '#b8b0a0', rock: '#6a6258', ice: '#9fc8e8', frost: '#dfe9f2', water: '#1e5aa8', metallic: '#c0a060', h2: '#e0d0b0' }
const FACTS: Record<Material, [string, string]> = {
  iron: ['Iron core', 'Solid iron and nickel, kept solid by the weight of everything above it.'],
  melt: ['Molten core', 'Liquid iron and nickel.'],
  forsterite: ['Mantle', 'Rock, drawn as olivine.'],
  quartz: ['Crust', 'Rock, drawn as quartz.'],
  rock: ['Rock', 'Rock all the way through, never melted and sorted into layers; drawn as olivine.'],
  ice: ['Ice mantle', 'Water, ammonia and methane squeezed into a hot, dense fluid; drawn as water.'],
  frost: ['Ice', 'Water ice, with frozen methane, ammonia and carbon monoxide on the coldest bodies; drawn as liquid water, there being no ice lattice here yet.'],
  water: ['Ocean', 'A salty ocean of liquid water under the ice, kept from freezing by tides and the warm rock below.'],
  metallic: ['Metallic hydrogen', 'Hydrogen squeezed so hard its electrons come loose and it conducts like a metal: a plasma at a million atmospheres.'],
  h2: ['Hydrogen', 'Hydrogen and helium gas, thicker the deeper you go.'],
}

function layerAt(P: Planet, x: number) { // x: fraction of the planet's radius
  for (const [top, m] of P.layers) if (x <= top) return m
  return null
}

const planet: Volume = {
  leafDepth: root => Math.round(Math.log2(root.metres / BLOCK)),
  Near: ({ node }) => {
    const P = bodyOf(node)
    return (
      <mesh>
        <sphereGeometry args={[P.r / node.metres, 64, 48]} />
        <meshStandardMaterial color={P.color} roughness={0.9} />
      </mesh>
    )
  },
  nearMax: 100,

  fill: (r, _rng, leaf) => {
    const root = volumeRoot(leaf), P = bodyOf(root)
    const h = len(r.c) * root.metres - P.r // height above the surface, metres
    const block = (kind: string, props: Record<string, number | string>) => [{ kind, pos: [0, 0, 0] as Vec3, size: 1, props: { ...rootProps, ...props } }]
    if (h > 0) {
      if (!P.atm || h > P.atm.top) return []
      return block('fluid', { f: P.atm.f, d: P.atm.d0 * Math.exp(-h / P.atm.h) })
    }
    const m = layerAt(P, 1 + h / P.r)!
    if (m === 'h2') return block('fluid', { f: 'h2', d: Math.min(1e30, (P.atm?.d0 ?? 1e25) * Math.exp(-h / (P.atm?.h ?? 30e3))) })
    if (m === 'metallic') return block('fluid', { f: 'plasma', d: 3e30, he: 0.08 })
    if (m === 'melt') return block('fluid', { f: 'melt' })
    if (m === 'ice' || m === 'frost' || m === 'water') return block('fluid', { f: 'water', salt: m === 'water' ? 0.5 : 0 })
    return block('grain', { m: m === 'iron' ? 3 : m === 'quartz' ? 1 : 0 })
  },

  far: (r, node) => {
    const root = volumeRoot(node), P = bodyOf(root), R = P.r / root.metres
    if (r.depth === 0) return { shape: 'sphere', color: P.color, scale: 2 * R, minPx: 2 }
    if (r.depth < 10) return null
    const x = len(r.c) / R
    return x > 1 ? null : { shape: 'haze', color: HAZE[layerAt(P, x)!] }
  },

  info: (r, node) => {
    const root = volumeRoot(node), P = bodyOf(root)
    if (r.depth < 8) return { title: P.name, fact: `${(P.r * 2 / 1e3).toLocaleString()} km across. ${P.fact}` }
    const x = (len(r.c) * root.metres) / P.r
    if (x > 1) return { title: P.atm ? 'Atmosphere' : 'Space', fact: P.atm ? (P.atm.f === 'co2' ? 'Carbon dioxide, thinning with altitude.' : P.atm.f === 'air' ? 'Nitrogen with a few percent of methane (drawn as nitrogen and oxygen air), thinning with altitude.' : 'Hydrogen and helium, thinning with altitude.') : 'Nothing: this world has no air.' }
    const [title, fact] = FACTS[layerAt(P, x)!]
    return { title, fact }
  },
}

export const kinds = { planet: volume(planet) }
