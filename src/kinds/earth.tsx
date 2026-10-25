// Earth: layers by depth (hexagonal iron inner core, molten outer core, olivine mantle, quartz crust), oceans
// under procedural continents, air thinning for 100 km, and one person standing on a continent.
import { useMemo } from 'react'
import { BufferAttribute, Color, SphereGeometry } from 'three'
import { kindOf, type ChildSpec, type Vec3 } from '../engine/tree'
import { rootProps, volume, type Region, type Volume } from './volume'

const SIDE = 1.3e7 // metres
const R = 6.371e6 / SIDE
const KM = 1e3 / SIDE
const LEAF_DEPTH = 43 // 1.48 µm blocks of rock, water or air
const PLACE_DEPTH = 20 // 12.4 m regions; one of them holds the person
const CORE_INNER = 1220 * KM, CORE_OUTER = 3480 * KM, CRUST = R - 30 * KM, OCEAN = R - 4 * KM, SKY = R + 100 * KM

type Material = 'space' | 'air' | 'water' | 'quartz' | 'forsterite' | 'melt' | 'iron'
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])

// continents: caps around a few fixed directions
const CONTINENTS: [Vec3, number][] = [
  [[0.707, 0.707, 0], 0.5], [[-0.3, 0.45, 0.84], 0.55], [[-0.75, -0.2, -0.62], 0.6], [[0.35, -0.55, 0.76], 0.4], [[0.1, 0.2, -0.97], 0.45], [[0.9, -0.3, -0.3], 0.3],
]
export function landAt(dir: Vec3) {
  return CONTINENTS.some(([c, w]) => Math.acos(Math.max(-1, Math.min(1, dir[0] * c[0] + dir[1] * c[1] + dir[2] * c[2]))) < w)
}

export function materialAt(p: Vec3): Material {
  const r = len(p)
  if (r > SKY) return 'space'
  if (r > R) return 'air'
  if (r > OCEAN && !landAt([p[0] / r, p[1] / r, p[2] / r])) return 'water'
  if (r > CRUST) return 'quartz'
  if (r > CORE_OUTER) return 'forsterite'
  if (r > CORE_INNER) return 'melt'
  return 'iron'
}

// the person: on the first continent, nudged so the whole figure sits well inside one 12 m region
const UP: Vec3 = [0.707, 0.707, 0]
export const PERSON = (() => {
  const key: number[] = []
  for (let lon = 0; lon < 1e-3; lon += 1e-7) {
    const up: Vec3 = [Math.cos(Math.PI / 4) * Math.cos(lon), Math.sin(Math.PI / 4), Math.cos(Math.PI / 4) * Math.sin(lon)]
    const c = up.map(u => u * (R + 0.87 / SIDE)) as Vec3 // hips 0.87 m above the ground
    key.length = 0
    let o: Vec3 = [0, 0, 0], s = 1
    for (let d = 0; d < PLACE_DEPTH; d++) {
      const ix = c[0] >= o[0] ? 1 : 0, iy = c[1] >= o[1] ? 1 : 0, iz = c[2] >= o[2] ? 1 : 0
      key.push(4 * ix + 2 * iy + iz)
      s /= 2
      o = [o[0] + (ix - 0.5) * s, o[1] + (iy - 0.5) * s, o[2] + (iz - 0.5) * s]
    }
    if (Math.max(...[0, 1, 2].map(i => Math.abs(c[i] - o[i]))) < s / 2 - 1.2 / SIDE) {
      UP[0] = up[0]; UP[1] = up[1]; UP[2] = up[2]
      return { centre: c, up, path: `${key.join('.')}.8` } // child indices from the Earth node down to the body
    }
  }
  throw new Error('no room for a person')
})()

const HAZE: Record<Material, string> = { space: '', air: '', water: '#1e5aa8', quartz: '#b8b0a0', forsterite: '#7a8a3a', melt: '#c05a2a', iron: '#8a8a95' }
const FACTS: Record<Material, [string, string]> = {
  space: ['Space', 'Above 100 km the air has all but run out: the edge of space.'],
  air: ['Atmosphere', 'Nitrogen and oxygen, thinning with altitude: half as dense every 5.5 km up. All of the weather is in the bottom 15 km.'],
  water: ['Ocean', 'Seawater, about 4 km deep on average, covering 70% of the surface.'],
  quartz: ['Crust', 'Continental crust, 30 km of it, drawn as quartz; real granite is quartz, feldspar and mica.'],
  forsterite: ['Mantle', '2,900 km of hot rock, solid but creeping a few centimetres a year, drawn as olivine; deeper down the same atoms rearrange into denser minerals.'],
  melt: ['Outer core', 'Liquid iron and nickel at 4,000 °C, 2,200 km thick. Its slow churning makes the magnetic field.'],
  iron: ['Inner core', 'A ball of solid iron 2,400 km across, as hot as the surface of the Sun and kept solid by the pressure of everything above it.'],
}

function Globe() {
  const geometry = useMemo(() => {
    const g = new SphereGeometry(R, 96, 64)
    const pos = g.getAttribute('position'), colors = new Float32Array(pos.count * 3)
    const land = new Color('#6b7a3a'), sea = new Color('#1e5aa8'), ice = new Color('#e8f0f5')
    for (let i = 0; i < pos.count; i++) {
      const d: Vec3 = [pos.getX(i) / R, pos.getY(i) / R, pos.getZ(i) / R]
      const c = Math.abs(d[1]) > 0.94 ? ice : landAt(d) ? land : sea
      colors.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new BufferAttribute(colors, 3))
    return g
  }, [])
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>
      <mesh>
        <sphereGeometry args={[R + 60 * KM, 64, 48]} />
        <meshStandardMaterial color="#7ab8ff" transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  )
}

const earth: Volume = {
  leafDepth: () => LEAF_DEPTH,
  placeDepth: () => PLACE_DEPTH,
  open: r => (r.depth === PLACE_DEPTH ? 0.2 : r.depth >= LEAF_DEPTH ? 0.15 : 0.1),
  Near: Globe,
  nearMax: SIDE / 300e3, // the globe's facets are 100 km wide: closer than that the rock itself is the ground

  placements: r => {
    const c = PERSON.centre
    if (Math.max(...[0, 1, 2].map(i => Math.abs(c[i] - r.c[i]))) > r.s / 2) return []
    return [{ kind: 'body', pos: [0, 1, 2].map(i => (c[i] - r.c[i]) / r.s) as Vec3, size: 2 / (r.s * SIDE), props: { ...rootProps, ux: PERSON.up[0], uy: PERSON.up[1], uz: PERSON.up[2] } }]
  },

  // a leaf is one block of whatever is here, unless the person is standing in it
  fill: (r, _rng, leaf) => {
    const m = materialAt(r.c)
    if (m === 'space') return []
    let a = leaf.parent
    while (a && a.props.depth !== PLACE_DEPTH) a = a.parent
    const body = a?.children?.[8]
    if (body && kindOf('body')?.inside?.(body, [0, 1, 2].map(i => (r.c[i] - (regionCentre(a!)[i] + body.pos[i] * (a!.props.s as number))) / (body.size * (a!.props.s as number))) as Vec3)) return []
    const block = (kind: string, props: Record<string, number | string>): ChildSpec[] => [{ kind, pos: [0, 0, 0], size: 1, props: { ...rootProps, ...props } }]
    if (m === 'air') return block('fluid', { f: 'air', d: Math.exp(-((len(r.c) - R) / (8.5 * KM))) })
    if (m === 'water') return block('fluid', { f: 'water', salt: 0.6 })
    if (m === 'melt') return block('fluid', { f: 'melt' })
    return block('grain', { m: m === 'quartz' ? 1 : m === 'forsterite' ? 0 : 3 })
  },

  far: r => {
    if (r.depth === 0) return { shape: 'sphere', color: '#4a7fc0', scale: 2 * R, minPx: 2 } // seen from space
    if (r.depth < 10) return null // coarser than 13 km the globe itself is the picture
    const color = HAZE[materialAt(r.c)]
    return color ? { shape: 'haze', color } : null
  },

  info: r => {
    if (r.depth < 8) return { title: 'Earth', fact: '12,742 km across. A hot iron core, a mantle of slowly creeping rock, a thin crust, oceans 4 km deep and 100 km of air, with one person standing on a continent.' }
    if (Math.abs(len(r.c) - R) < r.s * 0.87) return { title: 'Surface', fact: 'Where rock meets air: the ground.' } // straddles the surface
    const [title, fact] = FACTS[materialAt(r.c)]
    return { title, fact }
  },
}
const regionCentre = (n: { props: Record<string, number | string> }): Vec3 => [n.props.x as number, n.props.y as number, n.props.z as number]

export const kinds = { earth: volume(earth) }
export type { Region }
