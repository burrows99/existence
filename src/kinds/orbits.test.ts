// node --test src/kinds/orbits.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Body, Ecliptic, HelioVector } from 'astronomy-engine'
import { density, diameter, kepler, type Belt, type Elements } from './orbits.ts'
import { mulberry32 } from '../engine/tree.ts'

// the asteroid belt as solar.tsx draws it
const BELT: Belt = { r1: 2.1, r2: 3.3, w: 0.1, h: 0.1, n: 1.1e6, dmin: 1, q: 2, brk: 100, q2: 2.4, dmax: 500 }

test('a Kepler ellipse with Neptune’s J2000 elements stays within 1° of VSOP87 for fifty years', () => {
  // a, e, i, Ω, ω = ϖ − Ω, P; the perihelion passage from the mean anomaly at J2000, L − ϖ = 304.88° − 44.97°
  // (fixed elements drift: 0.4 AU off by 2050 and 0.7 by 2100, which is what "approximate" means in the facts)
  const el: Elements = [30.07, 0.0086, 1.77, 131.78, 44.97 - 131.78, 164.8, 2000 - ((304.88 - 44.97) / 360) * 164.8]
  for (const year of [2000, 2026.8, 2050]) {
    const v = Ecliptic(HelioVector(Body.Neptune, new Date(Date.UTC(2000, 0, 1, 12) + (year - 2000) * 365.25 * 864e5))).vec, k = kepler(el, year)
    const off = Math.hypot(v.x - k.x, v.y - k.y, v.z - k.z)
    assert.ok(off < 0.5, `${year}: ${off.toFixed(2)} AU off`)
  }
})

test('the asteroid belt’s density integrates to its count', () => {
  let sum = 0
  for (let r = 1.5; r < 4; r += 0.01) for (let z = -1.5; z < 1.5; z += 0.01) sum += density(BELT, r + 0.005, z + 0.005) * 2 * Math.PI * (r + 0.005) * 1e-4
  assert.ok(Math.abs(sum / BELT.n - 1) < 0.05, `${sum.toExponential(3)} bodies, wanted ${BELT.n.toExponential(3)}`)
})

test('sizes: all within range, about 1% over 10 km', () => {
  const rng = mulberry32(7)
  let big = 0
  for (let i = 0; i < 20000; i++) {
    const d = diameter(BELT, rng)
    assert.ok(d >= BELT.dmin && d <= BELT.dmax, `${d} km`)
    if (d > 10) big++
  }
  assert.ok(big > 140 && big < 260, `${big} of 20,000 over 10 km`)
})
