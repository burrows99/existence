// Life in the meadow: creatures steered by small neural networks, living on what they eat and breeding when they can.
// Nothing is scripted. The first brains are random. A creature that eats enough breeds, and its young inherit its
// brain, size and colour with small mutations; one that does not, starves. Energy is the only reward, so whatever
// steers well spreads: natural selection. Big creatures can eat smaller ones; small ones are cheap to run.
import { mulberry32 } from '../engine/tree.ts'

export const ARENA = 3 // m, radius of the meadow
export const SLOTS = 48 // most creatures alive at once (a node each: a creature's key is its slot)
export const PLANTS = 36
export const PLANT_D = 0.12 // m, a tuft of grass
export const SPEED = 2 // simulated seconds per real second
export const IN = 9, HID = 8, OUT = 2 // the brain: senses → hidden neurons → turn and thrust
export const WEIGHTS = HID * (IN + 1) + OUT * (HID + 1)

const DT = 1 / 30
const REGROW = 0.04 // of a full tuft per second
const BITE = 0.8 // tufts per second while eating
const PLANT_J = 150 // J in a full tuft
const MEAT_J = 300 // J per kg of prey
const STORE_J = 70 // J of reserves per kg of body
const MOVE = 2 // J per kg per (m/s)² per second
const TURN = 4 // rad/s at full turn
const PREY = 1.25 // eats creatures at least this much smaller
const L_MIN = 0.03, L_MAX = 0.45

// ponytail: energies are scaled down together (real reserves last days, not a minute) so that a generation fits in a
// minute of watching; the laws between them (Kleiber's ¾ power, size-limited speed) are the real ones
export const mass = (L: number) => 520 * L ** 3 // kg: a ball of water L across
export const emax = (L: number) => STORE_J * mass(L)
export const vmax = (L: number) => 0.6 * Math.sqrt(L / 0.1) // m/s
export const lifespan = (L: number) => 60 * (L / 0.1) ** 0.25 // s
const basal = (m: number) => 3.4 * m ** 0.75 // W: Kleiber's law

export type Genome = { L: number; hue: number; w: Float32Array }
export type Creature = {
  id: number; alive: boolean; g: Genome; gen: number
  x: number; y: number; a: number; v: number // position in the meadow's plane (m), heading, speed
  e: number; age: number; kids: number; plants: number; prey: number; fit: number // energy (J); reward so far
  turn: number; thrust: number; cause?: 'starved' | 'eaten' | 'old age'
}
export type Plant = { x: number; y: number; food: number }
export type Sim = {
  t: number; tick: number; acc: number; rng: () => number; nextId: number
  cs: (Creature | undefined)[]; ps: Plant[]
  born: number; died: Record<NonNullable<Creature['cause']>, number>
  best: { g: Genome; fit: number; gen: number }[] // the hall of fame: the most rewarded brains so far
  hold: number // a slot not to reuse (the one being looked inside)
  floor: number // below this many alive the best brains so far are reintroduced, mutated (the meadow never empties)
}

const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng())

// the brain: one hidden layer of tanh neurons, weights flat (each neuron's bias first)
const hidden = new Float32Array(HID)
export function think(w: Float32Array, x: ArrayLike<number>, out: Float32Array) {
  let k = 0
  for (let i = 0; i < HID; i++) { let s = w[k++]; for (let j = 0; j < IN; j++) s += w[k++] * x[j]; hidden[i] = Math.tanh(s) }
  for (let o = 0; o < OUT; o++) { let s = w[k++]; for (let i = 0; i < HID; i++) s += w[k++] * hidden[i]; out[o] = Math.tanh(s) }
}

function randomGenome(rng: () => number): Genome {
  const w = new Float32Array(WEIGHTS)
  for (let i = 0; i < WEIGHTS; i++) w[i] = gauss(rng) * 0.8
  return { L: Math.exp(Math.log(0.05) + rng() * Math.log(0.3 / 0.05)), hue: rng(), w }
}
function mutate(g: Genome, rng: () => number): Genome {
  const w = g.w.slice()
  for (let i = 0; i < WEIGHTS; i++) if (rng() < 0.25) w[i] += gauss(rng) * 0.25
  return { L: Math.min(L_MAX, Math.max(L_MIN, g.L * Math.exp(gauss(rng) * 0.08))), hue: (g.hue + gauss(rng) * 0.03 + 1) % 1, w }
}

export function spawn(s: Sim, slot: number, g: Genome, x: number, y: number, gen: number, e: number) {
  s.cs[slot] = { id: s.nextId++, alive: true, g, gen, x, y, a: s.rng() * 2 * Math.PI, v: 0, e, age: 0, kids: 0, plants: 0, prey: 0, fit: 0, turn: 0, thrust: 0 }
}
const freeSlot = (s: Sim) => s.cs.findIndex((c, i) => !c?.alive && i !== s.hold)
const randomSpot = (rng: () => number, r: number): [number, number] => {
  const d = r * Math.sqrt(rng()), t = rng() * 2 * Math.PI
  return [d * Math.cos(t), d * Math.sin(t)]
}

export function createSim(seed: number, start = 28, floor = 8): Sim {
  const rng = mulberry32(seed)
  const s: Sim = { t: 0, tick: 0, acc: 0, rng, nextId: 1, cs: new Array(SLOTS).fill(undefined), ps: [], born: 0, died: { starved: 0, eaten: 0, 'old age': 0 }, best: [], hold: -1, floor }
  while (s.ps.length < PLANTS) { // tufts spread out, at least 0.6 m apart
    const [x, y] = randomSpot(rng, ARENA - PLANT_D)
    if (s.ps.every(p => Math.hypot(p.x - x, p.y - y) > 0.6)) s.ps.push({ x, y, food: 0.5 + 0.5 * rng() })
  }
  for (let i = 0; i < start; i++) {
    const g = randomGenome(rng), [x, y] = randomSpot(rng, ARENA * 0.9)
    spawn(s, i, g, x, y, 0, 0.6 * emax(g.L))
  }
  return s
}

function die(s: Sim, c: Creature, cause: NonNullable<Creature['cause']>) {
  c.alive = false
  c.cause = cause
  s.died[cause]++
  s.best.push({ g: c.g, fit: c.fit, gen: c.gen })
  s.best.sort((a, b) => b.fit - a.fit)
  s.best.length = Math.min(s.best.length, 10)
}
const gain = (c: Creature, J: number) => { const m = emax(c.g.L); c.fit += J / m; c.e = Math.min(m, c.e + J) }

const senses = new Float32Array(IN), act = new Float32Array(OUT)
function step(s: Sim) {
  s.t += DT
  const { cs, ps, rng } = s
  for (const p of ps) p.food = Math.min(1, p.food + REGROW * DT)
  for (const c of cs) {
    if (!c?.alive) continue
    const L = c.g.L, sight = 1 + 3 * L, ca = Math.cos(c.a), sa = Math.sin(c.a)
    // the nearest tuft worth eating and the nearest other creature, as direction (ahead, to the left) and closeness
    let pf: Plant | undefined, pd = sight
    for (const p of ps) { if (p.food < 0.1) continue; const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < pd) { pd = d; pf = p } }
    let of: Creature | undefined, od = sight
    for (const o of cs) { if (!o?.alive || o === c) continue; const d = Math.hypot(o.x - c.x, o.y - c.y); if (d < od) { od = d; of = o } }
    senses.fill(0)
    if (pf) { const dx = (pf.x - c.x) / (pd || 1), dy = (pf.y - c.y) / (pd || 1); senses[0] = dx * ca + dy * sa; senses[1] = dy * ca - dx * sa; senses[2] = 1 - pd / sight }
    if (of) { const dx = (of.x - c.x) / (od || 1), dy = (of.y - c.y) / (od || 1); senses[3] = dx * ca + dy * sa; senses[4] = dy * ca - dx * sa; senses[5] = 1 - od / sight; senses[6] = Math.max(-1, Math.min(1, Math.log2(of.g.L / L) / 2)) }
    senses[7] = (2 * c.e) / emax(L) - 1
    senses[8] = (c.x * ca + c.y * sa) / ARENA // heading out towards the edge (+) or in (−)
    think(c.g.w, senses, act)
    c.turn = act[0]; c.thrust = act[1]
    c.a += act[0] * TURN * DT
    c.v = ((act[1] + 1) / 2) * vmax(L)
    c.x += Math.cos(c.a) * c.v * DT
    c.y += Math.sin(c.a) * c.v * DT
    const r = Math.hypot(c.x, c.y), lim = ARENA - L / 2
    if (r > lim) { c.x *= lim / r; c.y *= lim / r }
    const m = mass(L)
    c.e -= (basal(m) + MOVE * m * c.v * c.v) * DT
    c.age += DT
    // eat: a tuft it is touching, or a creature it is touching that is small enough
    if (pf && pd < (L + PLANT_D) / 2) { const bite = Math.min(pf.food, BITE * DT); pf.food -= bite; c.plants += bite; gain(c, bite * PLANT_J) }
    if (of?.alive && od < (L + of.g.L) / 2 && L > PREY * of.g.L) { gain(c, Math.max(0, of.e) + MEAT_J * mass(of.g.L)); c.prey++; die(s, of, 'eaten') }
    if (c.e <= 0) { die(s, c, 'starved'); continue }
    if (c.age > lifespan(L)) { die(s, c, 'old age'); continue }
    // breed: well fed and old enough, if there is room
    if (c.e > 0.75 * emax(L) && c.age > 4) {
      const slot = freeSlot(s)
      if (slot < 0) continue
      const g = mutate(c.g, rng), e = 0.3 * emax(g.L)
      c.e -= e / 0.8
      c.kids++
      c.fit += 1
      s.born++
      spawn(s, slot, g, c.x - Math.cos(c.a) * L, c.y - Math.sin(c.a) * L, c.gen + 1, e)
    }
  }
  // the meadow never empties: the most rewarded brains so far come back, mutated (or new random ones at first)
  let alive = cs.reduce((n, c) => n + (c?.alive ? 1 : 0), 0)
  while (alive < s.floor) {
    const slot = freeSlot(s)
    if (slot < 0) break
    const b = s.best.length && rng() < 0.8 ? s.best[Math.floor(rng() * s.best.length)] : undefined
    const g = b ? mutate(b.g, rng) : randomGenome(rng), [x, y] = randomSpot(rng, ARENA * 0.9)
    spawn(s, slot, g, x, y, b ? b.gen + 1 : 0, 0.6 * emax(g.L))
    alive++
  }
}

// run the simulation on by `dt` real seconds, in fixed steps (at most a few per frame: a long pause is not caught up)
export function advance(s: Sim, dt: number) {
  s.acc = Math.min(s.acc + dt * SPEED, 8 * DT)
  while (s.acc >= DT) { step(s); s.acc -= DT }
  s.tick++
}

export function stats(s: Sim) {
  const alive = s.cs.filter((c): c is Creature => !!c?.alive)
  return {
    alive: alive.length,
    gen: alive.reduce((g, c) => Math.max(g, c.gen), 0),
    size: alive.length ? alive.reduce((t, c) => t + c.g.L, 0) / alive.length : 0,
    born: s.born, died: s.died, t: s.t,
  }
}
