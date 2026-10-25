// node --test src/kinds/orbitals.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { element, orbitals, sampleOrbital } from './orbitals.ts'
import { mulberry32 } from '../engine/tree.ts'

test('every element has Z electrons', () => {
  for (let z = 1; z <= 118; z++) assert.equal(orbitals(z).length, z, element(z)[2])
})

test("Slater's rules give the textbook Z_eff", () => {
  const zeff = (z: number, n: number, l: number) => orbitals(z).find(o => o.n === n && o.l === l)!.zeff
  for (const [z, n, l, want] of [[6, 2, 1, 3.25], [26, 4, 0, 3.75], [26, 3, 2, 6.25]]) {
    assert.ok(Math.abs(zeff(z, n, l) - want) < 1e-9, `Z=${z} ${n}${'spdf'[l]}: ${zeff(z, n, l)} ≠ ${want}`)
  }
})

test('hydrogen 1s samples average 1.5 Bohr radii from the nucleus', () => {
  const rng = mulberry32(1), [o] = orbitals(1), N = 20000
  let sum = 0
  for (let i = 0; i < N; i++) sum += Math.hypot(...sampleOrbital(o, rng))
  const mean = sum / N / 52.9177e-12
  assert.ok(Math.abs(mean - 1.5) < 0.05, `mean radius ${mean.toFixed(3)} a₀`)
})
