// Real molecules from experimental structures (NMR entries, PubChem 3D conformers and PDB ideal ligand geometries,
// all with hydrogens), prepared by scripts/molecules.mjs. A molecule is nothing but its atoms.
import { Quaternion } from 'three'
import { randomRotation, type Kind, type Vec3 } from '../engine/tree'
import { element } from './orbitals.ts'

type Molecule = {
  id: string; name: string; fact: string; color: string; diameter: number // Å
  atoms: [number, number, number, number][] // Z, x, y, z in Å about the centroid
  head?: Vec3; tail?: Vec3 // lipids: oriented head-up (+Y); where the head and tail end sit
}

export const IDS = ['1MYF', '2HIU', '1NAJ', '5957', '5793', 'POV', 'CLR', '1D3Z', 'TGL']
export const M = { MYOGLOBIN: 0, INSULIN: 1, DNA: 2, ATP: 3, GLUCOSE: 4, POPC: 5, CHOLESTEROL: 6, UBIQUITIN: 7, FAT: 8 }
export const LIB: Molecule[] = await Promise.all(
  IDS.map(id => fetch(`${import.meta.env.BASE_URL}data/molecules/${id}.json`).then(r => r.json())),
)

export const diameterOf = (m: number) => LIB[m].diameter * 1e-10 // metres

const molecule: Kind = {
  open: 0.3, // atoms once it spans a third of the view; a coloured blob before that (the budget is the atoms')
  jitter: 10e-12,
  far: n => ({ shape: 'sphere', color: LIB[n.props.m as number].color }),
  children: (node, rng) => {
    const { atoms, diameter } = LIB[node.props.m as number]
    // placed with a given orientation (membranes), else tumbling at random
    const q = node.props.qw === undefined
      ? randomRotation(rng)
      : new Quaternion(node.props.qx as number, node.props.qy as number, node.props.qz as number, node.props.qw as number)
    return atoms.map(([z, x, y, zz]) => {
      // Å → fraction of the molecule's diameter, rotated (expanded quaternion maths: no allocation per atom)
      const vx = x / diameter, vy = y / diameter, vz = zz / diameter
      const ix = q.w * vx + q.y * vz - q.z * vy, iy = q.w * vy + q.z * vx - q.x * vz
      const iz = q.w * vz + q.x * vy - q.y * vx, iw = -q.x * vx - q.y * vy - q.z * vz
      const pos: Vec3 = [
        ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
        iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
        iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
      ]
      return { kind: 'atom', pos, size: (2 * element(z)[6]) / 100 / diameter, props: { z } }
    })
  },
  info: n => {
    const { name, fact, atoms, diameter } = LIB[n.props.m as number]
    return { title: name, fact: `${fact} ${atoms.length.toLocaleString()} atoms, ${(diameter / 10).toPrecision(2)} nm across.` }
  },
}

export const kinds = { molecule }
