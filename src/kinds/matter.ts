import { Vector3 } from 'three'
import { randomRotation, type ChildSpec, type Kind, type Vec3 } from '../engine/tree'
import { ATOMS } from './molecule'

export const H2O = 0.44e-9 // H₂O bounding diameter: O (152 pm vdW) + O–H bond + H (120 pm)
const WATER = 33.4e27 // molecules per m³ of liquid water
const AIR = 2.5e25 // molecules per m³ of air at sea level

// Fill a cube of `side` metres with liquid water at the real density: a jittered grid, thinned to the right count,
// skipping wherever keepOut says something else already is. Positions are in cube units (side = 1).
export function fillWater(side: number, rng: () => number, keepOut: (p: Vec3, radius: number) => boolean, salt = 0): ChildSpec[] {
  const N = Math.round(WATER * side ** 3)
  const G = Math.ceil(Math.cbrt(N)), keep = N / G ** 3
  const size = H2O / side, radius = 0.14e-9 / side
  const out: ChildSpec[] = []
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) for (let k = 0; k < G; k++) {
    if (rng() > keep) continue
    const at = (n: number) => (n + 0.5) / G - 0.5 + (rng() - 0.5) * (0.6 / G)
    const pos: Vec3 = [at(i), at(j), at(k)]
    if (keepOut(pos, radius)) continue
    out.push({ kind: 'h2o', pos, size })
  }
  // dissolved salt: sodium and chloride ions, `salt` moles per litre
  const ions = salt * 6.022e26 * side ** 3
  for (const [z, q, d] of [[11, 1, 0.24e-9], [17, -1, 0.36e-9]] as const) {
    let n = Math.floor(ions) + (rng() < ions - Math.floor(ions) ? 1 : 0)
    while (n-- > 0) {
      const pos = [0, 1, 2].map(() => rng() - 0.5) as Vec3
      if (!keepOut(pos, d / 2 / side)) out.push({ kind: 'atom', pos, size: d / side, props: { z, q } })
    }
  }
  return out
}

// A gas: `perM3` molecules per m³ of the given species (kind, fraction, diameter), thrown in at random.
export function fillGas(side: number, rng: () => number, keepOut: (p: Vec3, radius: number) => boolean, perM3: number, species: [string, number, number][]): ChildSpec[] {
  const mean = perM3 * side ** 3
  let n = Math.floor(mean) + (rng() < mean - Math.floor(mean) ? 1 : 0)
  const out: ChildSpec[] = []
  while (n-- > 0) {
    const pos = [0, 1, 2].map(() => rng() - 0.5) as Vec3
    let u = rng(), sp = species[species.length - 1]
    for (const s of species) { if (u < s[1]) { sp = s; break } u -= s[1] }
    if (keepOut(pos, sp[2] / 2 / side)) continue
    out.push(sp[0] === 'he' ? { kind: 'atom', pos, size: sp[2] / side, props: { z: 2 } } : { kind: sp[0], pos, size: sp[2] / side })
  }
  return out
}

// Air: 78% N₂, 21% O₂ (argon and the rest left out), a thousandth as dense as water, so most nanometres are empty.
export const fillAir = (side: number, rng: () => number, keepOut: (p: Vec3, radius: number) => boolean, density = 1) =>
  fillGas(side, rng, keepOut, AIR * density, [['n2', 0.79, 0.42e-9], ['o2', 0.21, 0.42e-9]])

// Water: O–H bonds 95.84 pm, H–O–H angle 104.45°.
const BOND = 95.84e-12, ANGLE = (104.45 * Math.PI) / 180
const H2O_ATOMS: [number, Vector3][] = [
  [8, new Vector3(0, 0, 0)],
  [1, new Vector3(Math.sin(ANGLE / 2) * BOND, Math.cos(ANGLE / 2) * BOND, 0)],
  [1, new Vector3(-Math.sin(ANGLE / 2) * BOND, Math.cos(ANGLE / 2) * BOND, 0)],
]
const CENTRE = new Vector3(0, (Math.cos(ANGLE / 2) * BOND) / 3, 0)
const VDW: Record<number, number> = { 1: 120e-12, 7: 155e-12, 8: 152e-12 }

const h2o: Kind = {
  open: 0.3,
  detail: ATOMS,
  jitter: 10e-12, // thermal vibration, ~0.1 Å
  far: () => ({ shape: 'sphere', color: '#9fd3ff' }),
  children: (_, rng) => {
    const rot = randomRotation(rng)
    return H2O_ATOMS.map(([z, p]) => {
      const v = p.clone().sub(CENTRE).applyQuaternion(rot).divideScalar(H2O)
      return { kind: 'atom', pos: [v.x, v.y, v.z] as Vec3, size: (2 * VDW[z]) / H2O, props: { z } }
    })
  },
  info: () => ({ title: 'Water molecule (H₂O)', fact: 'One oxygen and two hydrogen atoms sharing electrons. Bond angle 104.45°, bond length 95.84 pm.' }),
}

// a diatomic molecule, drawn 0.42 nm across
function diatomic(z: number, bond: number, color: string, title: string, fact: string): Kind {
  return {
    open: 0.3,
    detail: ATOMS,
    jitter: 10e-12,
    far: () => ({ shape: 'sphere', color }),
    children: (_, rng) => {
      const axis = new Vector3(bond / 2, 0, 0).applyQuaternion(randomRotation(rng)).divideScalar(0.42e-9)
      return [1, -1].map(s => ({ kind: 'atom', pos: [s * axis.x, s * axis.y, s * axis.z] as Vec3, size: (2 * VDW[z]) / 0.42e-9, props: { z } }))
    },
    info: () => ({ title, fact }),
  }
}

// carbon dioxide: linear, C=O 1.16 Å
const co2: Kind = {
  open: 0.3,
  detail: ATOMS,
  jitter: 10e-12,
  far: () => ({ shape: 'sphere', color: '#b0b0b0' }),
  children: (_, rng) => {
    const axis = new Vector3(1.16e-10, 0, 0).applyQuaternion(randomRotation(rng)).divideScalar(0.5e-9)
    return [[6, 0], [8, 1], [8, -1]].map(([z, s]) => ({ kind: 'atom', pos: [s * axis.x, s * axis.y, s * axis.z] as Vec3, size: (2 * (z === 6 ? 170e-12 : 152e-12)) / 0.5e-9, props: { z } }))
  },
  info: () => ({ title: 'Carbon dioxide (CO₂)', fact: 'One carbon between two oxygens. What you breathe out, what plants breathe in, and what Venus and Mars have for air.' }),
}

export const kinds = {
  h2o, co2,
  n2: diatomic(7, 1.098e-10, '#8fa3bf', 'Nitrogen molecule (N₂)', 'Two nitrogen atoms triple-bonded so tightly that they pass through your lungs untouched. Four fifths of every breath.'),
  o2: diatomic(8, 1.208e-10, '#ff6b6b', 'Oxygen molecule (O₂)', 'A fifth of the air. Your blood takes it from your lungs and your mitochondria use it to burn sugar.'),
  h2: diatomic(1, 0.741e-10, '#f0f0f0', 'Hydrogen molecule (H₂)', 'The simplest molecule and most of what a gas giant is made of: two protons sharing two electrons.'),
}
