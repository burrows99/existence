// Electrons from first principles: configuration → (n, l, m, Z_eff) per electron, sampled from hydrogen-like orbitals.
import raw from '../data/elements.json' with { type: 'json' }
import type { Vec3 } from '../engine/tree.ts'

// [Z, symbol, name, mass number, electron configuration, CPK colour, van der Waals radius (pm)]
type Element = [number, string, string, number, string, string, number]
const ELEMENTS = raw as unknown as Element[]
export const element = (z: number) => ELEMENTS[z - 1]

const A0 = 52.9177e-12 // Bohr radius

// ---- electrons: configuration → orbitals, sampled from hydrogen-like wavefunctions ----

export type Orbital = { n: number; l: number; m: number; zeff: number }
const L: Record<string, number> = { s: 0, p: 1, d: 2, f: 3 }
const orbitalCache = new Map<number, Orbital[]>()

// One (n, l, m, Z_eff) per electron. Hund's rule fills each orbital singly first; Z_eff from Slater's rules.
export function orbitals(z: number): Orbital[] {
  if (orbitalCache.has(z)) return orbitalCache.get(z)!
  const shells = element(z)[4].split(' ').map(s => ({ n: +s[0], l: L[s[1]], count: +s.slice(2) }))
  const group = (n: number, l: number) => (l <= 1 ? `${n}sp` : `${n}${l}`)
  const zeff = (n: number, l: number) => {
    let S = 0
    for (const s of shells) {
      if (group(s.n, s.l) === group(n, l)) S += (s.count - (s.n === n && s.l === l ? 1 : 0)) * (n === 1 ? 0.3 : 0.35)
      else if (l <= 1) S += s.n === n - 1 ? 0.85 * s.count : s.n < n - 1 ? s.count : 0
      else if (s.n < n || (s.n === n && s.l < l)) S += s.count
    }
    return Math.max(1, z - S)
  }
  const out: Orbital[] = []
  for (const { n, l, count } of shells) {
    const ze = zeff(n, l)
    for (let i = 0; i < count; i++) out.push({ n, l, m: (i % (2 * l + 1)) - l, zeff: ze })
  }
  orbitalCache.set(z, out)
  return out
}

function laguerre(k: number, a: number, x: number) {
  let l0 = 1, l1 = 1 + a - x
  if (k === 0) return l0
  for (let i = 1; i < k; i++) {
    const l2 = ((2 * i + 1 + a - x) * l1 - (i + a) * l0) / (i + 1)
    l0 = l1
    l1 = l2
  }
  return l1
}

// radial probability r²R²(r) as a CDF, so radii can be drawn by inverting a uniform number
const RBINS = 2048
const radialCache = new Map<string, { cdf: Float64Array; rmax: number }>()
function radial({ n, l, zeff }: Orbital) {
  const key = `${n}${l}${zeff.toFixed(2)}`
  let r = radialCache.get(key)
  if (r) return r
  const rmax = ((n * n) / zeff) * 12 * A0
  const cdf = new Float64Array(RBINS)
  let acc = 0
  for (let i = 0; i < RBINS; i++) {
    const rr = ((i + 0.5) / RBINS) * rmax
    const rho = (2 * zeff * rr) / (n * A0)
    const R = rho ** l * Math.exp(-rho / 2) * laguerre(n - l - 1, 2 * l + 1, rho)
    cdf[i] = acc += rr * rr * R * R
  }
  for (let i = 0; i < RBINS; i++) cdf[i] /= acc
  radialCache.set(key, (r = { cdf, rmax }))
  return r
}

// real spherical harmonics up to f, unnormalised; the angular density is Y²
const Y: ((x: number, y: number, z: number) => number)[][] = [
  [() => 1],
  [(_, y) => y, (_, __, z) => z, x => x],
  [(x, y) => x * y, (_, y, z) => y * z, (_, __, z) => 3 * z * z - 1, (x, _, z) => x * z, (x, y) => x * x - y * y],
  [
    (x, y) => y * (3 * x * x - y * y), (x, y, z) => x * y * z, (_, y, z) => y * (5 * z * z - 1), (_, __, z) => z * (5 * z * z - 3),
    (x, _, z) => x * (5 * z * z - 1), (x, y, z) => z * (x * x - y * y), (x, y) => x * (x * x - 3 * y * y),
  ],
]
const YMAX = Y.map(row => row.map(f => {
  let m = 0
  for (let i = 0; i <= 90; i++) for (let j = 0; j < 180; j++) {
    const th = (Math.PI * i) / 90, ph = (Math.PI * j) / 90
    m = Math.max(m, f(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)) ** 2)
  }
  return m * 1.02
}))

// one position (metres from the nucleus) drawn from the orbital's probability density
export function sampleOrbital(o: Orbital, rng: () => number): Vec3 {
  const { cdf, rmax } = radial(o)
  const u = rng()
  let lo = 0, hi = RBINS - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid }
  const r = ((lo + rng()) / RBINS) * rmax
  const f = Y[o.l][o.m + o.l], max = YMAX[o.l][o.m + o.l]
  for (;;) {
    const z = 2 * rng() - 1, ph = 2 * Math.PI * rng(), s = Math.sqrt(1 - z * z)
    const x = s * Math.cos(ph), y = s * Math.sin(ph)
    if (rng() * max <= f(x, y, z) ** 2) return [r * x, r * y, r * z]
  }
}
