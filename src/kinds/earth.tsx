// Earth: layers by depth (hexagonal iron inner core, molten outer core, olivine mantle, quartz crust), the real
// surface (NOAA ETOPO2 elevation: oceans where it is below sea level, ground where it is above, with the countries
// of Natural Earth drawn on NASA's Blue Marble), air thinning for 100 km, and a meadow of evolving creatures in the Galápagos.
import { Suspense, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, SRGBColorSpace, TextureLoader } from 'three'
import type { ChildSpec, Node, Vec3 } from '../engine/tree'
import { PERF } from '../engine/perf'
import { rootProps, volume, type Region, type Volume } from './volume'

const SIDE = 1.3e7 // metres
const R = 6.371e6 / SIDE
const KM = 1e3 / SIDE
const LEAF_DEPTH = 43 // 1.48 µm blocks of rock, water or air
const PLACE_DEPTH = 20 // 12.4 m regions; one of them holds the meadow
const CORE_INNER = 1220 * KM, CORE_OUTER = 3480 * KM, CRUST = R - 30 * KM, SKY = R + 100 * KM

type Material = 'space' | 'air' | 'water' | 'quartz' | 'forsterite' | 'melt' | 'iron'
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])

// ---- the real surface (prepared by scripts/earth.mjs) -------------------------------------------------------
// the sphere's +y is north and longitude 0 is +x, as the equirectangular textures wrap onto a three.js sphere
const DATA = `${import.meta.env.BASE_URL}data/earth/`
const ELEV = await (async () => { // 2048×1024: G,B = metres above sea level + 11000, high byte first
  const bmp = await createImageBitmap(await (await fetch(DATA + 'elevation.png')).blob(), { colorSpaceConversion: 'none' })
  const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  return { w: bmp.width, h: bmp.height, px: ctx.getImageData(0, 0, bmp.width, bmp.height).data }
})()
const COUNTRIES: { n: string; r: number[][] }[] = await fetch(DATA + 'countries.json').then(r => r.json())

const latLon = (d: Vec3): [number, number] => [(Math.asin(Math.max(-1, Math.min(1, d[1]))) * 180) / Math.PI, (Math.atan2(-d[2], d[0]) * 180) / Math.PI]
export function elevationAt(d: Vec3) { // metres above sea level in direction d (unit vector); ETOPO2 averaged to 20 km
  const [lat, lon] = latLon(d)
  const i = Math.min(ELEV.w - 1, Math.floor(((lon + 180) / 360) * ELEV.w)), j = Math.min(ELEV.h - 1, Math.floor(((90 - lat) / 180) * ELEV.h))
  const k = (j * ELEV.w + i) * 4
  return ELEV.px[k + 1] * 256 + ELEV.px[k + 2] - 11000
}
export function countryAt(d: Vec3): string | null { // even-odd over every ring of every country
  const [lat, lon] = latLon(d)
  for (const c of COUNTRIES) {
    let inside = false
    for (const r of c.r) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (r[i + 1] > lat !== r[j + 1] > lat && lon < r[j] + ((lat - r[j + 1]) * (r[i] - r[j])) / (r[i + 1] - r[j + 1])) inside = !inside
    }
    if (inside) return c.n
  }
  return null
}

export function materialAt(p: Vec3): Material {
  const r = len(p)
  if (r > SKY) return 'space'
  if (r > R + 9 * KM) return 'air' // above the highest ground
  if (r < CRUST) return r > CORE_OUTER ? 'forsterite' : r > CORE_INNER ? 'melt' : 'iron'
  const ground = R + (elevationAt([p[0] / r, p[1] / r, p[2] / r]) / SIDE)
  if (r > ground) return r > R ? 'air' : 'water' // the sea fills from the seabed up to sea level
  return 'quartz'
}

const xyz = (lat: number, lon: number, r: number): Vec3 => [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon)]

// the meadow (kinds/meadow.tsx): on Santa Cruz in the Galápagos, where the local vertical is within a degree of the
// +z axis, so the meadow's ground can be the plane z = const. It is nudged along until the 7 m patch sits inside one
// 12 m region with that plane on a boundary of the 1.5 m regions, within a centimetre of the real ground: the blocks
// of rock under it are then flat at every scale you would see a creature at.
export const MEADOW_M = 7
export const MEADOW = (() => {
  const D = PLACE_DEPTH, FLAT = PLACE_DEPTH + 3
  const grid = (v: number, d = D) => (v + 0.5) * 2 ** d // region coordinates at depth d
  const off = (v: number) => Math.abs(grid(v) - Math.floor(grid(v)) - 0.5) // from the middle of its region, in regions
  const fits = 0.5 - (MEADOW_M / 2 / SIDE) * 2 ** D - 0.01, tol = 0.01 / (SIDE / 2 ** FLAT)
  const at = (lat: number, lon: number) => {
    const up = xyz(lat, lon, 1)
    return up.map(u => u * (R + elevationAt(up) / SIDE)) as Vec3
  }
  let lat = (-0.62 * Math.PI) / 180
  while (off(at(lat, (-90.36 * Math.PI) / 180)[1]) > fits - 0.05) lat += 1e-8
  for (let lon = (-90.36 * Math.PI) / 180, i = 0; i < 3e5; lon += 1e-8, i++) {
    const c = at(lat, lon), z = grid(c[2], FLAT)
    if (off(c[0]) > fits || off(c[1]) > fits || off(c[2]) > fits || Math.abs(z - Math.round(z)) > tol || elevationAt(xyz(lat, lon, 1)) <= 0) continue
    const centre: Vec3 = [c[0], c[1], Math.round(z) / 2 ** FLAT - 0.5] // the ground, on the boundary
    const key: number[] = []
    let o: Vec3 = [0, 0, 0], s = 1
    for (let d = 0; d < D; d++) {
      const ix = centre[0] >= o[0] ? 1 : 0, iy = centre[1] >= o[1] ? 1 : 0, iz = centre[2] >= o[2] ? 1 : 0
      key.push(4 * ix + 2 * iy + iz)
      s /= 2
      o = [o[0] + (ix - 0.5) * s, o[1] + (iy - 0.5) * s, o[2] + (iz - 0.5) * s]
    }
    return { centre, path: `${key.join('.')}.8` } // child indices from the Earth node down to the meadow
  }
  throw new Error('no room for the meadow')
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

// NASA's Blue Marble on a sphere with the real relief (bump-shaded, and raised at true scale), the countries'
// outlines, and a thin blue atmosphere
function Globe() {
  const [map, relief] = useLoader(TextureLoader, [DATA + 'blue-marble.jpg', DATA + 'elevation.png'])
  map.colorSpace = SRGBColorSpace
  const borders = useMemo(() => {
    const pts: number[] = []
    for (const c of COUNTRIES) for (const r of c.r) for (let i = 0; i + 3 < r.length; i += 2) {
      pts.push(...xyz((r[i + 1] * Math.PI) / 180, (r[i] * Math.PI) / 180, R + 2 * KM), ...xyz((r[i + 3] * Math.PI) / 180, (r[i + 2] * Math.PI) / 180, R + 2 * KM))
    }
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3))
  }, [])
  return (
    <group>
      <mesh>
        <sphereGeometry args={[R, 256, 128]} />
        <meshStandardMaterial map={map} bumpMap={relief} bumpScale={0.004} displacementMap={relief} displacementScale={6400 / SIDE} roughness={0.9} />
      </mesh>
      <lineSegments geometry={borders}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.3} />
      </lineSegments>
      <mesh>
        <sphereGeometry args={[R + 60 * KM, 64, 48]} />
        <meshStandardMaterial color="#7ab8ff" transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  )
}

const infos = new WeakMap<Node, { title: string; fact?: string }>()
const earth: Volume = {
  leafDepth: () => LEAF_DEPTH,
  placeDepth: () => PLACE_DEPTH,
  open: r => (r.depth === PLACE_DEPTH ? PERF.openPlace : undefined),
  Near: () => <Suspense fallback={null}><Globe /></Suspense>,
  nearMax: SIDE / 300e3, // the globe's pixels are 20 km wide: closer than that the rock itself is the ground

  placements: r => {
    const c = MEADOW.centre
    if (Math.max(...[0, 1, 2].map(i => Math.abs(c[i] - r.c[i]))) > r.s / 2) return []
    return [{ kind: 'meadow', pos: [0, 1, 2].map(i => (c[i] - r.c[i]) / r.s) as Vec3, size: MEADOW_M / (r.s * SIDE) }]
  },

  // a leaf is one block of whatever is here
  fill: (r, _rng) => {
    const m = materialAt(r.c)
    if (m === 'space') return []
    const block = (kind: string, props: Record<string, number | string>): ChildSpec[] => [{ kind, pos: [0, 0, 0], size: 1, props: { ...rootProps, ...props } }]
    if (m === 'air') return block('fluid', { f: 'air', d: Math.exp(-((len(r.c) - R) / (8.5 * KM))) })
    if (m === 'water') return block('fluid', { f: 'water', salt: 0.6 })
    if (m === 'melt') return block('fluid', { f: 'melt' })
    return block('grain', { m: m === 'quartz' ? 1 : m === 'forsterite' ? 0 : 3 })
  },

  far: r => {
    if (r.depth === 0) return { shape: 'sphere', color: '#4a7fc0', scale: 2 * R, minPx: 2 } // seen from space
    if (r.depth < 10) return null // coarser than 13 km the globe itself is the picture
    let m = materialAt(r.c)
    if (m === 'air') { // a block whose middle is in the air but whose floor is ground or sea is drawn as that floor
      const d = len(r.c), k = 1 - (0.4 * r.s) / d // just above its floor: a block resting on the ground is air
      m = materialAt([r.c[0] * k, r.c[1] * k, r.c[2] * k])
    }
    const color = HAZE[m]
    return color ? { shape: 'cube', color } : null // a solid block of rock or sea: the ground follows the real relief
  },

  info: (r, node) => {
    if (r.depth < 8) return { title: 'Earth', fact: '12,742 km across. A hot iron core, a mantle of slowly creeping rock, a thin crust, oceans 4 km deep and 100 km of air, with a meadow of evolving creatures in the Galápagos.' }
    let out = infos.get(node)
    if (out) return out
    const d = len(r.c), dir: Vec3 = [r.c[0] / d, r.c[1] / d, r.c[2] / d], h = elevationAt(dir)
    if (Math.abs(d - (R + Math.max(0, h) / SIDE)) < r.s * 0.87) { // straddles the surface
      const country = h >= 0 ? countryAt(dir) : null, [lat, lon] = latLon(dir)
      const where = `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(1)}° ${lon < 0 ? 'W' : 'E'}`
      out = h >= 0
        ? { title: country ?? 'Land', fact: `The ground, ${Math.round(h).toLocaleString()} m above sea level, at ${where}${country ? '' : ': no country claims it'}.` }
        : { title: 'Sea surface', fact: `Open water at ${where}; the sea floor is ${Math.round(-h).toLocaleString()} m down.` }
    } else {
      const [title, fact] = FACTS[materialAt(r.c)]
      out = { title, fact }
    }
    infos.set(node, out)
    return out
  },
}

export const kinds = { earth: volume(earth) }
export type { Region }
