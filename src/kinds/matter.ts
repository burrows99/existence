import { Quaternion, Vector3 } from 'three'
import type { ChildSpec, Kind, Vec3 } from '../engine/tree'

const LEAF_DEPTH = 6 // root cube splits 6 times → leaf cubes of 6×6×6 molecules
const GRID = 6
const MOLECULE = 0.44e-9 // H₂O bounding diameter: O (152 pm vdW) + O–H bond + H (120 pm)

// uniformly random orientation (Shoemake)
export function randomRotation(rng: () => number) {
  const [u1, u2, u3] = [rng(), rng(), rng()]
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1)
  return new Quaternion(a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2), b * Math.sin(2 * Math.PI * u3), b * Math.cos(2 * Math.PI * u3))
}

const water: Kind = {
  open: 0.25,
  far: () => ({ shape: 'box', color: '#3fa7ff' }),
  children: (node, rng) => {
    const depth = node.props.depth as number
    if (depth < LEAF_DEPTH) {
      return [-0.25, 0.25].flatMap(x => [-0.25, 0.25].flatMap(y => [-0.25, 0.25].map(z => (
        { kind: 'water', pos: [x, y, z] as Vec3, size: 0.5, props: { depth: depth + 1 } }
      ))))
    }
    // liquid: one molecule per 0.31 nm cell, displaced at random, at the real density of 33.4 per nm³
    const out: ChildSpec[] = []
    const size = MOLECULE / node.metres
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) for (let k = 0; k < GRID; k++) {
      const at = (n: number) => (n + 0.5) / GRID - 0.5 + (rng() - 0.5) * (0.6 / GRID)
      out.push({ kind: 'h2o', pos: [at(i), at(j), at(k)], size })
    }
    return out
  },
  info: node => ({
    title: 'Liquid water',
    fact: `${(node.metres * 1e9).toPrecision(3)} nm cube. 33.4 molecules per cubic nanometre, each tumbling and trading hydrogen bonds a trillion times a second.`,
  }),
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
      const v = p.clone().sub(CENTRE).applyQuaternion(rot).divideScalar(MOLECULE)
      return { kind: 'atom', pos: [v.x, v.y, v.z] as Vec3, size: (2 * VDW[z]) / MOLECULE, props: { z } }
    })
  },
  info: () => ({ title: 'Water molecule (H₂O)', fact: 'One oxygen and two hydrogen atoms sharing electrons. Bond angle 104.45°, bond length 95.84 pm.' }),
}

export const kinds = { water, h2o }
