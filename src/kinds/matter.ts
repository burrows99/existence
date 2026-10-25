import { Vector3 } from 'three'
import { randomRotation, type ChildSpec, type Kind, type Vec3 } from '../engine/tree'

export const H2O = 0.44e-9 // H₂O bounding diameter: O (152 pm vdW) + O–H bond + H (120 pm)
const DENSITY = 33.4e27 // molecules per m³ of liquid water

// Fill a cube of `side` metres with liquid water at the real density: a jittered grid, thinned to the right count,
// skipping wherever keepOut says something else already is. Positions are in cube units (side = 1).
export function fillWater(side: number, rng: () => number, keepOut: (p: Vec3, radius: number) => boolean): ChildSpec[] {
  const N = Math.round(DENSITY * side ** 3)
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
  return out
}

// Water: O–H bonds 95.84 pm, H–O–H angle 104.45°.
const BOND = 95.84e-12, ANGLE = (104.45 * Math.PI) / 180
const H2O_ATOMS: [number, Vector3][] = [
  [8, new Vector3(0, 0, 0)],
  [1, new Vector3(Math.sin(ANGLE / 2) * BOND, Math.cos(ANGLE / 2) * BOND, 0)],
  [1, new Vector3(-Math.sin(ANGLE / 2) * BOND, Math.cos(ANGLE / 2) * BOND, 0)],
]
const CENTRE = new Vector3(0, (Math.cos(ANGLE / 2) * BOND) / 3, 0)
const VDW: Record<number, number> = { 1: 120e-12, 8: 152e-12 }

const h2o: Kind = {
  open: 0.01, // opens into its atoms almost immediately: never shown as a blob
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

export const kinds = { h2o }
