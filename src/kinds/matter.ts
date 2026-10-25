import { Vector3 } from 'three'
import { randomRotation, type ChildSpec, type Kind, type Node, type Vec3 } from '../engine/tree'
import { diameterOf, LIB } from './molecule'

const LEAF_DEPTH = 6 // root cube splits 6 times → leaf cubes of 6×6×6 molecules
const MOLECULE_DEPTH = 3 // one biomolecule per 14.9 nm region
const GRID = 6
const MOLECULE = 0.44e-9 // H₂O bounding diameter: O (152 pm vdW) + O–H bond + H (120 pm)
const WEIGHTS = [0.25, 0.15, 0.2, 0.2, 0.2] // myoglobin, insulin, DNA, ATP, glucose

// an exclusion sphere (a biomolecule) handed down through the octree so water is not generated inside it
const exclusion = (node: Node) => (node.props.er === undefined ? null : { e: [node.props.ex, node.props.ey, node.props.ez] as Vec3, r: node.props.er as number })
function exclude(child: ChildSpec, e: Vec3, r: number) {
  const ce: Vec3 = [(e[0] - child.pos[0]) / child.size, (e[1] - child.pos[1]) / child.size, (e[2] - child.pos[2]) / child.size]
  const cr = r / child.size
  if (Math.max(Math.abs(ce[0]), Math.abs(ce[1]), Math.abs(ce[2])) - cr > 0.5) return // misses this cube
  child.props = { ...child.props, ex: ce[0], ey: ce[1], ez: ce[2], er: cr }
}

const water: Kind = {
  open: 0.25,
  far: () => ({ shape: 'box', color: '#3fa7ff' }),
  children: (node, rng) => {
    const depth = node.props.depth as number
    const ex = exclusion(node)
    if (depth < LEAF_DEPTH) {
      const kids: ChildSpec[] = [-0.25, 0.25].flatMap(x => [-0.25, 0.25].flatMap(y => [-0.25, 0.25].map(z => (
        { kind: 'water', pos: [x, y, z] as Vec3, size: 0.5, props: { depth: depth + 1 } }
      ))))
      if (ex) for (const k of kids) exclude(k, ex.e, ex.r)
      if (depth === MOLECULE_DEPTH) {
        let u = rng() * WEIGHTS.reduce((a, b) => a + b), m = 0
        while (u > WEIGHTS[m]) u -= WEIGHTS[m++]
        const r = diameterOf(m) / node.metres / 2
        const pos = [0, 1, 2].map(() => (rng() - 0.5) * 2 * (0.5 - r)) as Vec3 // wholly inside this region
        for (const k of kids) exclude(k, pos, r)
        kids.push({ kind: 'molecule', pos, size: 2 * r, props: { m } })
      }
      return kids
    }
    // liquid: one molecule per 0.31 nm cell, displaced at random, at the real density of 33.4 per nm³
    const out: ChildSpec[] = []
    const size = MOLECULE / node.metres
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) for (let k = 0; k < GRID; k++) {
      const at = (n: number) => (n + 0.5) / GRID - 0.5 + (rng() - 0.5) * (0.6 / GRID)
      const pos: Vec3 = [at(i), at(j), at(k)]
      // ponytail: biomolecules carve a spherical void; hydration shells hug the surface more tightly than this
      if (ex && Math.hypot(pos[0] - ex.e[0], pos[1] - ex.e[1], pos[2] - ex.e[2]) < ex.r + 0.3 * size) continue
      out.push({ kind: 'h2o', pos, size })
    }
    return out
  },
  info: node => ({
    title: 'Liquid water',
    fact: `${(node.metres * 1e9).toPrecision(3)} nm cube. 33.4 molecules per cubic nanometre, each tumbling and trading hydrogen bonds a trillion times a second${node.props.depth === MOLECULE_DEPTH ? `, with one ${LIB[0] ? 'biomolecule' : 'molecule'} drifting through` : ''}.`,
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
