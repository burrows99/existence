// Real molecules from experimental structures (NMR entries and PubChem 3D conformers, so hydrogens are present),
// prepared by scripts/molecules.mjs. A molecule is nothing but its atoms.
import { randomRotation, type Kind, type Vec3 } from '../engine/tree'
import { element } from './orbitals.ts'

type Molecule = { id: string; name: string; fact: string; color: string; diameter: number; atoms: [number, number, number, number][] }

export const IDS = ['1MYF', '2HIU', '1NAJ', '5957', '5793']
export const LIB: Molecule[] = await Promise.all(
  IDS.map(id => fetch(`${import.meta.env.BASE_URL}data/molecules/${id}.json`).then(r => r.json())),
)

// diameter in metres, for placement before the node exists
export const diameterOf = (m: number) => LIB[m].diameter * 1e-10

const molecule: Kind = {
  open: 0.01, // never a blob: always its atoms
  jitter: 10e-12,
  far: n => ({ shape: 'sphere', color: LIB[n.props.m as number].color }),
  children: (node, rng) => {
    const { atoms, diameter } = LIB[node.props.m as number]
    const rot = randomRotation(rng)
    return atoms.map(([z, x, y, zz]) => {
      // Å → fraction of the molecule's diameter, in a random orientation
      const v = { x: x / diameter, y: y / diameter, z: zz / diameter }
      const q = rot
      // quaternion rotation without allocating a Vector3 per atom
      const ix = q.w * v.x + q.y * v.z - q.z * v.y, iy = q.w * v.y + q.z * v.x - q.x * v.z
      const iz = q.w * v.z + q.x * v.y - q.y * v.x, iw = -q.x * v.x - q.y * v.y - q.z * v.z
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
