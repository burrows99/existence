// A galaxy: stars in an exponential disc with spiral arms and a bulge, each one a star you can fall into.
// The stars are procedural (drawn from the initial mass function at the local density); our Sun sits 26,000
// light-years out in the Milky Way, and the solar system is placed there.
import { useMemo } from 'react'
import { AdditiveBlending, Color } from 'three'
import { childrenOf, hash, mulberry32, type ChildSpec, type Far, type Node, type Vec3 } from '../engine/tree'
import { rootProps, volume, volumeRoot, type Region, type Volume } from './volume'
import { starColor } from './star'

export const LY = 9.461e15
const SUN_R = 6.96e8
const LEAF_DEPTH = 17 // ~1 light-year leaves

// the real stars around the Sun, from the HYG catalogue (scripts/stars.mjs): every named star and everything within
// 25 light-years: [name, x, y, z (light-years from the Sun), radius (suns), temperature (K), luminosity (suns), distance (ly), spectral type]
type Star = [string, number, number, number, number, number, number, number, string]
const STARS: Star[] = await fetch(`${import.meta.env.BASE_URL}data/stars.json`).then(r => r.json())
const KNOWN = 25 * LY // this close to the Sun the catalogue is complete, so no procedural stars stand in
const FARTHEST = Math.max(...STARS.map(s => s[7])) * LY
const suns = (l: number) => (l >= 10 ? l.toFixed(0) : l >= 1 ? l.toFixed(1) : l.toPrecision(2))

// shape parameters live in the root's props: rd (disc scale length), hz (scale height), n (stars), fb (bulge fraction), all in metres
type Shape = { rd: number; hz: number; rb: number; n0: number; nb: number; fb: number; metres: number; mw: boolean }
const shapes = new WeakMap<Node, Shape>()
function shapeOf(root: Node): Shape {
  let s = shapes.get(root)
  if (s) return s
  const metres = root.metres, rd = (root.props.rd as number) / metres, hz = (root.props.hz as number) / metres
  const n = root.props.n as number, fb = (root.props.fb as number) ?? 0.15, rb = rd / 4
  // normalise the disc and bulge to the star count, in stars per cubic root-unit
  s = { rd, hz, rb, n0: ((1 - fb) * n) / (4 * Math.PI * rd * rd * hz), nb: (fb * n) / (8 * Math.PI * rb ** 3), fb, metres, mw: !!root.props.mw }
  shapes.set(root, s)
  return s
}

// stars per cubic root-unit at p
function density(p: Vec3, S: Shape) {
  const R = Math.hypot(p[0], p[2]), z = Math.abs(p[1]), r = Math.hypot(R, z)
  const arms = 1 + 0.7 * Math.cos(2 * (Math.atan2(p[2], p[0]) - Math.log(R / S.rd + 1e-9) / Math.tan(0.21))) // two arms, 12° pitch
  return S.n0 * Math.exp(-R / S.rd) * Math.exp(-z / S.hz) * (R > 0.5 * S.rd ? arms : 1) + S.nb * Math.exp(-r / S.rb)
}

// the Sun: 26,000 light-years out, in the plane, between the arms
export const SUN_POS: Vec3 = [(26000 * LY) / (13 * 9.8e3 * LY), 0.00031, 0.0012]
export function sunPath() { // child indices from the Milky Way node to the solar system
  const key: number[] = []
  let o: Vec3 = [0, 0, 0], s = 1
  for (let d = 0; d < LEAF_DEPTH; d++) {
    const ix = SUN_POS[0] >= o[0] ? 1 : 0, iy = SUN_POS[1] >= o[1] ? 1 : 0, iz = SUN_POS[2] >= o[2] ? 1 : 0
    key.push(4 * ix + 2 * iy + iz)
    s /= 2
    o = [o[0] + (ix - 0.5) * s, o[1] + (iy - 0.5) * s, o[2] + (iz - 0.5) * s]
  }
  return `${key.join('.')}.0`
}

// Kroupa initial mass function, solar masses
function imfMass(rng: () => number) {
  const draw = (a: number, m1: number, m2: number) => (m1 ** (1 - a) + rng() * (m2 ** (1 - a) - m1 ** (1 - a))) ** (1 / (1 - a))
  return rng() < 0.62 ? draw(1.3, 0.08, 0.5) : draw(2.3, 0.5, 60)
}
function starOf(m: number) {
  const t = Math.min(40000, Math.max(2500, 5772 * m ** 0.55)), r = SUN_R * m ** 0.8
  const name = m < 0.45 ? 'Red dwarf' : m < 0.8 ? 'Orange dwarf' : m < 1.2 ? 'Sun-like star' : m < 2 ? 'White star' : m < 8 ? 'Blue-white star' : 'Blue giant'
  const fact = m < 0.45 ? `${(m).toFixed(2)} solar masses, the commonest kind of star by far: it will burn for a trillion years.`
    : m < 1.2 ? `${m.toFixed(2)} solar masses, much like the Sun.`
    : m < 8 ? `${m.toFixed(1)} solar masses and ${(m ** 3.5).toFixed(0)} times the Sun’s light; it will not last long.`
    : `${m.toFixed(0)} solar masses, ${(m ** 3.5 / 1e3).toFixed(0)} thousand Suns of light, and a supernova in a few million years.`
  return { r, t, name, fact }
}

// 40,000 stars drawn exactly from the galaxy's density: Gamma-distributed radii, Laplace heights, arms by rejection
function StarCloud({ node }: { node: Node }) {
  const { positions, colors } = useMemo(() => {
    const S = shapeOf(node), rng = mulberry32(hash(node.seed, 0x5c10)), N = 40000
    const positions = new Float32Array(N * 3), colors = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      let x = 0, y = 0, z = 0
      if (rng() < S.fb) {
        const r = -S.rb * Math.log(rng() * rng() * rng() + 1e-12), u = 2 * rng() - 1, ph = 2 * Math.PI * rng(), sq = Math.sqrt(1 - u * u)
        x = r * sq * Math.cos(ph); y = r * u; z = r * sq * Math.sin(ph)
      } else {
        let R = 0, ph = 0
        for (;;) {
          R = -S.rd * Math.log(rng() * rng() + 1e-12); ph = 2 * Math.PI * rng()
          const arms = 1 + 0.7 * Math.cos(2 * (ph - Math.log(R / S.rd + 1e-9) / Math.tan(0.21)))
          if (R < 0.5 * S.rd || rng() * 1.7 < arms) break
        }
        x = R * Math.cos(ph); z = R * Math.sin(ph); y = (rng() < 0.5 ? 1 : -1) * -S.hz * Math.log(rng() + 1e-12)
      }
      positions.set([x, y, z], i * 3)
      const c = new Color(starColor(starOf(imfMass(rng)).t))
      colors.set([c.r, c.g, c.b], i * 3)
    }
    return { positions, colors }
  }, [node])
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={1.5} sizeAttenuation={false} vertexColors transparent opacity={0.6} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </points>
  )
}

const galaxy: Volume = {
  deep: true,
  leafDepth: () => LEAF_DEPTH,
  open: () => 0.25, // coarser than most kinds: 48 points per region is the picture, and a tighter grid of them is a white wall
  Near: StarCloud,
  nearMax: 40, // the cloud is the picture down to ~3,000 light-years; inside that the regions take over

  // the stars that fall in this light-year, or the solar system if it lives here
  fill: (r, rng, leaf) => {
    const root = volumeRoot(leaf), S = shapeOf(root)
    const out: ChildSpec[] = []
    if (S.mw && Math.max(...[0, 1, 2].map(i => Math.abs(SUN_POS[i] - r.c[i]))) < r.s / 2) {
      out.push({ kind: 'solar', pos: [0, 1, 2].map(i => (SUN_POS[i] - r.c[i]) / r.s) as Vec3, size: 1.496e13 / (r.s * S.metres), props: { ...rootProps } })
    }
    if (S.mw) { // the real stars that fall in this region (metres from the Sun)
      const side = r.s * S.metres, d = [0, 1, 2].map(i => (r.c[i] - SUN_POS[i]) * S.metres), fromSun = Math.hypot(d[0], d[1], d[2])
      if (fromSun - side * 0.87 < FARTHEST) for (const s of STARS) {
        const p = [s[1] * LY - d[0], s[2] * LY - d[1], s[3] * LY - d[2]]
        if (Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) >= side / 2) continue
        out.push({ kind: 'star', pos: [p[0] / side, p[1] / side, p[2] / side], size: (2.2 * s[4] * SUN_R) / side, props: { ...rootProps, r: s[4] * SUN_R, t: s[5], name: s[0] || `${s[8]} star`, fact: `${s[7]} light-years from the Sun, ${suns(s[6])} times its light, spectral type ${s[8]}${s[0] ? '' : ' (no name, just a catalogue number)'}.` } })
      }
      if (fromSun < KNOWN) return out
    }
    const mean = density(r.c, S) * r.s ** 3
    let n = Math.floor(mean) + (rng() < mean - Math.floor(mean) ? 1 : 0)
    while (n-- > 0) {
      const st = starOf(imfMass(rng))
      out.push({ kind: 'star', pos: [0, 1, 2].map(() => rng() - 0.5) as Vec3, size: (2.2 * st.r) / (r.s * S.metres), props: { ...rootProps, r: st.r, t: st.t, name: st.name, fact: st.fact } })
    }
    return out
  },

  // a closed region: its stars as points. A closed light-year draws exactly the stars it holds (and the Sun);
  // a bigger region draws a few dozen sampled from the local density
  far: (r, node) => {
    const S = shapeOf(volumeRoot(node))
    if (r.depth === LEAF_DEPTH) {
      const out = childrenOf(node).map(c => (c.kind === 'solar'
        ? { shape: 'sphere' as const, color: '#fff3dc', glow: true, minPx: 3, scale: c.size, pos: c.pos }
        : { shape: 'point' as const, color: starColor(c.props.t as number), pos: c.pos }))
      return out.length ? out : null
    }
    if (r.depth === 0) return { shape: 'haze', color: S.fb > 0.5 ? '#ffd9a6' : '#cbd8ff', scale: 8 * S.rd, minPx: 2 } // a closed galaxy, seen from outside: its glow
    if (r.depth < 5) return null // the star cloud shows the whole galaxy; regions this big would only double it
    const rng = mulberry32(hash(node.seed, 0x57a))
    const samples = [-0.5, 0, 0.5].flatMap(x => [-0.5, 0, 0.5].flatMap(y => [-0.5, 0, 0.5].map(z => density([r.c[0] + x * r.s, r.c[1] + y * r.s, r.c[2] + z * r.s], S))))
    const dmax = Math.max(...samples), mean = (samples.reduce((a, b) => a + b, 0) / 27) * r.s ** 3
    const n = Math.min(48, Math.floor(mean) + (rng() < mean - Math.floor(mean) ? 1 : 0))
    const alpha = Math.min(1, Math.max(0.12, Math.log10(mean / 48) / 6 + 0.12)) // 48 points stand for up to 10⁸ stars: brighter for more
    const out: Far[] = []
    // near the Sun the real stars are drawn instead of samples (the catalogue is complete there), and among them further out
    const side = r.s * S.metres, d = S.mw ? [0, 1, 2].map(i => (r.c[i] - SUN_POS[i]) * S.metres) : [Infinity, 0, 0], fromSun = Math.hypot(d[0], d[1], d[2])
    if (fromSun - side * 0.87 > KNOWN) for (let i = 0, tries = 0; i < n && tries < 800; tries++) {
      const pos = [0, 1, 2].map(() => rng() - 0.5) as Vec3
      if (rng() * dmax > density([r.c[0] + pos[0] * r.s, r.c[1] + pos[1] * r.s, r.c[2] + pos[2] * r.s], S)) continue
      out.push({ shape: 'point', color: starColor(starOf(imfMass(rng)).t), pos, alpha })
      i++
    }
    if (fromSun - side * 0.87 < FARTHEST) for (const s of STARS) {
      const p = [s[1] * LY - d[0], s[2] * LY - d[1], s[3] * LY - d[2]]
      if (Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) < side / 2) out.push({ shape: 'point', color: starColor(s[5]), pos: [p[0] / side, p[1] / side, p[2] / side] })
    }
    if (S.mw && Math.max(...[0, 1, 2].map(i => Math.abs(SUN_POS[i] - r.c[i]))) < r.s / 2) out.push({ shape: 'sphere', color: '#fff3dc', glow: true, minPx: 3, scale: 1e-9, pos: [0, 1, 2].map(i => (SUN_POS[i] - r.c[i]) / r.s) as Vec3 })
    return out.length ? out : null
  },

  info: (r, node) => {
    const root = volumeRoot(node), S = shapeOf(root)
    if (r.depth < 5) return { title: root.props.name as string, fact: root.props.fact as string }
    const per = density(r.c, S) / S.metres ** 3 * LY ** 3
    return { title: 'Interstellar space', fact: per > 0.001 ? `About one star per ${Math.round(1 / per).toLocaleString()} cubic light-years here, and between them a gas thinner than any vacuum on Earth (not drawn).` : 'The thin outskirts: hardly a star for thousands of light-years.' }
  },
}

export const MILKY_WAY = { rd: 9.8e3 * LY, hz: 1e3 * LY, n: 1e11, fb: 0.15, mw: 1, name: 'Milky Way', fact: 'Our galaxy: a hundred billion stars in a disc 100,000 light-years across and a thousand thick, with two main spiral arms and a bulge of old stars around a black hole of four million solar masses. The stars here are procedural; the Sun is where it really is.' }
export const galaxyCube = (rd: number) => 13 * rd
export type { Region }

export const kinds = { galaxy: volume(galaxy) }
