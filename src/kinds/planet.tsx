// Planets other than ours: rocky ones layered iron / rock with thin air, gas giants of hydrogen and helium
// thickening into metallic hydrogen around a rocky core. (Our Earth is kinds/earth.tsx.)
import type { Vec3 } from '../engine/tree'
import { rootProps, volume, volumeRoot, type Volume } from './volume'

const BLOCK = 1.3e-6
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])

type Material = 'iron' | 'melt' | 'forsterite' | 'quartz' | 'ice' | 'metallic' | 'h2'
type Atmosphere = { f: 'co2' | 'h2'; d0: number; h: number; top: number } // molecules/m³ at the surface, scale height, extent (m)
type Planet = { name: string; r: number; color: string; layers: [number, Material][]; atm?: Atmosphere; fact: string }

export const PLANETS: Planet[] = [
  { name: 'Mercury', r: 2.44e6, color: '#9a9a9a', layers: [[0.83, 'iron'], [1, 'forsterite']], fact: 'An iron ball with a thin rocky rind, baked and frozen by turns, with no air to speak of.' },
  { name: 'Venus', r: 6.05e6, color: '#e6c58a', layers: [[0.53, 'melt'], [0.99, 'forsterite'], [1, 'quartz']], atm: { f: 'co2', d0: 2.3e27, h: 15.9e3, top: 250e3 }, fact: 'Earth’s twin under 90 atmospheres of carbon dioxide, hot enough at the surface to melt lead.' },
  { name: 'The Moon', r: 1.737e6, color: '#b0b0b0', layers: [[0.2, 'iron'], [1, 'forsterite']], fact: 'Rock knocked off the young Earth, 384,000 km away, drifting four centimetres further every year.' },
  { name: 'Mars', r: 3.39e6, color: '#c1603a', layers: [[0.5, 'iron'], [0.99, 'forsterite'], [1, 'quartz']], atm: { f: 'co2', d0: 1.5e23, h: 11e3, top: 200e3 }, fact: 'Half the size of Earth, with a wisp of carbon dioxide for air and rust-red dust over basalt.' },
  { name: 'Jupiter', r: 6.99e7, color: '#d8b48a', layers: [[0.1, 'iron'], [0.8, 'metallic'], [1, 'h2']], atm: { f: 'h2', d0: 2.7e25, h: 27e3, top: 1e6 }, fact: 'Eleven Earths across and 318 times the mass: hydrogen and helium squeezed into a metal around a rocky core.' },
  { name: 'Saturn', r: 5.82e7, color: '#e8d9a8', layers: [[0.15, 'iron'], [0.6, 'metallic'], [1, 'h2']], atm: { f: 'h2', d0: 1.2e25, h: 60e3, top: 1.5e6 }, fact: 'Less dense than water. The rings (not modelled yet) are ice, a few metres thick and 280,000 km across.' },
  { name: 'Uranus', r: 2.54e7, color: '#9fd8e0', layers: [[0.2, 'iron'], [0.8, 'ice'], [1, 'h2']], atm: { f: 'h2', d0: 3e25, h: 28e3, top: 1e6 }, fact: 'An ice giant tipped on its side: water, ammonia and methane ices (drawn as water) under a hydrogen sky.' },
  { name: 'Neptune', r: 2.46e7, color: '#4a6fd8', layers: [[0.2, 'iron'], [0.8, 'ice'], [1, 'h2']], atm: { f: 'h2', d0: 3e25, h: 20e3, top: 1e6 }, fact: 'The windiest place in the solar system, 2,000 km/h, four and a half billion km from the Sun.' },
]
export const cubeOf = (p: number) => 2.2 * PLANETS[p].r + 2 * (PLANETS[p].atm?.top ?? 0)

const HAZE: Record<Material, string> = { iron: '#8a8a95', melt: '#c05a2a', forsterite: '#7a8a3a', quartz: '#b8b0a0', ice: '#9fc8e8', metallic: '#c0a060', h2: '#e0d0b0' }
const FACTS: Record<Material, [string, string]> = {
  iron: ['Iron core', 'Solid iron and nickel, kept solid by the weight of everything above it.'],
  melt: ['Molten core', 'Liquid iron and nickel.'],
  forsterite: ['Mantle', 'Rock, drawn as olivine.'],
  quartz: ['Crust', 'Rock, drawn as quartz.'],
  ice: ['Ice mantle', 'Water, ammonia and methane squeezed into a hot, dense fluid; drawn as water.'],
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
    const P = PLANETS[node.props.p as number]
    return (
      <mesh>
        <sphereGeometry args={[P.r / node.metres, 64, 48]} />
        <meshStandardMaterial color={P.color} roughness={0.9} />
      </mesh>
    )
  },
  nearMax: 100,

  fill: (r, _rng, leaf) => {
    const root = volumeRoot(leaf), P = PLANETS[root.props.p as number]
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
    if (m === 'ice') return block('fluid', { f: 'water', salt: 0 })
    return block('grain', { m: m === 'iron' ? 3 : m === 'quartz' ? 1 : 0 })
  },

  far: (r, node) => {
    const root = volumeRoot(node), P = PLANETS[root.props.p as number], R = P.r / root.metres
    if (r.depth === 0) return { shape: 'sphere', color: P.color, scale: 2 * R, minPx: 2 }
    if (r.depth < 10) return null
    const x = len(r.c) / R
    return x > 1 ? null : { shape: 'haze', color: HAZE[layerAt(P, x)!] }
  },

  info: (r, node) => {
    const root = volumeRoot(node), P = PLANETS[root.props.p as number]
    if (r.depth < 8) return { title: P.name, fact: `${(P.r * 2 / 1e3).toLocaleString()} km across. ${P.fact}` }
    const x = (len(r.c) * root.metres) / P.r
    if (x > 1) return { title: P.atm ? 'Atmosphere' : 'Space', fact: P.atm ? (P.atm.f === 'co2' ? 'Carbon dioxide, thinning with altitude.' : 'Hydrogen and helium, thinning with altitude.') : 'Nothing: this world has no air.' }
    const [title, fact] = FACTS[layerAt(P, x)!]
    return { title, fact }
  },
}

export const kinds = { planet: volume(planet) }
