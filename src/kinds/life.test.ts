// Natural selection works: brains that evolved in the meadow find food better than random brains of the same size.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advance, createSim, emax, spawn, think, WEIGHTS, type Genome } from './life.ts'
import { mulberry32 } from '../engine/tree.ts'

// plants eaten by one creature alone in a fresh meadow for 30 s, summed over a few meadows
function forage(g: Genome) {
  let eaten = 0
  for (let seed = 100; seed < 106; seed++) {
    const s = createSim(seed, 0, 0)
    spawn(s, 0, g, 0, 0, 0, 0.5 * emax(g.L))
    while (s.t < 30) advance(s, 1 / 60)
    eaten += s.cs[0]!.plants
  }
  return eaten
}

test('the brain is bounded', () => {
  const out = new Float32Array(2)
  think(new Float32Array(WEIGHTS).fill(50), new Float32Array(9).fill(1), out)
  assert.ok(Math.abs(out[0]) <= 1 && Math.abs(out[1]) <= 1)
})

test('evolved brains forage better than random ones', () => {
  const s = createSim(1)
  while (s.t < 1200) advance(s, 1 / 60) // 20 simulated minutes, some fifty generations
  assert.ok(s.born > 500, 'creatures breed')
  const rng = mulberry32(7)
  let evolved = 0, random = 0
  for (const c of s.cs.filter(c => c?.alive).slice(0, 8)) {
    const g = c!.g
    evolved += forage(g)
    const w = new Float32Array(WEIGHTS).map(() => (rng() * 2 - 1) * 1.4)
    random += forage({ ...g, w })
  }
  assert.ok(evolved > 2 * random, `evolved ${evolved.toFixed(1)} vs random ${random.toFixed(1)}`)
})
