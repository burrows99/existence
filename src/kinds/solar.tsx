// The solar system: the Sun, eight planets and the Moon where they really are today (VSOP87, via astronomy-engine),
// in a 100 AU cube of otherwise empty space.
import { useMemo } from 'react'
import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three'
import { Body, Ecliptic, GeoMoon, HelioVector } from 'astronomy-engine'
import type { ChildSpec, Vec3 } from '../engine/tree'
import { rootProps, volume, type Volume } from './volume'
import { PLANETS, cubeOf } from './planet'

export const AU = 1.496e11
export const SIDE = 100 * AU
export const EPOCH = new Date()
const SUN_R = 6.96e8

// ecliptic position in cube units, with the orbital plane horizontal and north up
const place = (v: { x: number; y: number; z: number }): Vec3 => [(v.x * AU) / SIDE, (v.z * AU) / SIDE, (-v.y * AU) / SIDE]
const helio = (b: Body, date = EPOCH) => place(Ecliptic(HelioVector(b, date)).vec)

const ORBITS: [Body, number][] = [[Body.Mercury, 0.241], [Body.Venus, 0.615], [Body.Earth, 1], [Body.Mars, 1.881], [Body.Jupiter, 11.86], [Body.Saturn, 29.46], [Body.Uranus, 84.0], [Body.Neptune, 164.8]]

function bodies(): ChildSpec[] {
  const earth = helio(Body.Earth)
  const moon = place(Ecliptic(GeoMoon(EPOCH)).vec)
  const planet = (p: number, pos: Vec3) => ({ kind: 'planet', pos, size: cubeOf(p) / SIDE, props: { ...rootProps, p } })
  return [
    { kind: 'star', pos: [0, 0, 0], size: (2.2 * SUN_R) / SIDE, props: { ...rootProps, r: SUN_R, t: 5772, name: 'The Sun', fact: 'A ball of plasma 1.39 million km across, 333,000 Earths in mass, fusing 600 million tonnes of hydrogen a second. Everything else here is leftovers.' } },
    planet(0, helio(Body.Mercury)),
    planet(1, helio(Body.Venus)),
    { kind: 'earth', pos: earth, size: 1.3e7 / SIDE, props: { ...rootProps } },
    planet(2, [earth[0] + moon[0], earth[1] + moon[1], earth[2] + moon[2]]),
    planet(3, helio(Body.Mars)),
    planet(4, helio(Body.Jupiter)),
    planet(5, helio(Body.Saturn)),
    planet(6, helio(Body.Uranus)),
    planet(7, helio(Body.Neptune)),
  ]
}
export const EARTH_KEY = 's.11' // the Earth is the fourth placement after the eight octants

function Orbits() {
  const lines = useMemo(() => ORBITS.map(([b, years], i) => {
    const pts = Array.from({ length: 181 }, (_, k) => new Vector3(...helio(b, new Date(EPOCH.getTime() + (k / 180) * years * 365.25 * 864e5))))
    return new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: i === 2 ? '#4a7fc0' : '#ffffff', transparent: true, opacity: i === 2 ? 0.7 : 0.3 }))
  }), [])
  return <group>{lines.map((l, i) => <primitive key={i} object={l} />)}</group>
}

const solar: Volume = {
  deep: true,
  leafDepth: () => 1,
  placeDepth: () => 0,
  placements: () => bodies(),
  fill: () => [],
  far: r => (r.depth === 0 ? { shape: 'sphere', color: '#fff3dc', glow: true, scale: (2.2 * SUN_R) / SIDE, minPx: 3 } : null),
  Near: Orbits,
  info: () => ({ title: 'Solar system', fact: `The Sun and its planets as they are today (${EPOCH.toISOString().slice(0, 10)}): Neptune’s orbit is 60 AU across, 9 billion km, and almost all of it is empty.` }),
}

export const kinds = { solar: volume(solar) }
export { PLANETS }
