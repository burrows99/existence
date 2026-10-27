// A grain of crystal: a real unit cell (from the Crystallography Open Database, prepared by scripts/crystals.mjs)
// tiled through a micron-sized grain with its own random orientation, as in a polycrystalline rock.
import { Matrix3, Matrix4 } from 'three'
import { hash, mulberry32, randomRotation, type ChildSpec, type Node, type Vec3 } from '../engine/tree'
import { volume, volumeRoot, type Volume } from './volume'
import { element } from './orbitals.ts'

type Crystal = { id: string; name: string; fact: string; color: string; cell: [Vec3, Vec3, Vec3]; atoms: [number, number, number, number, number][] }
export const IDS = ['forsterite', 'quartz', 'hydroxylapatite', 'iron']
export const C = { FORSTERITE: 0, QUARTZ: 1, APATITE: 2, IRON: 3 }
export const LIB: Crystal[] = await Promise.all(
  IDS.map(id => fetch(`${import.meta.env.BASE_URL}data/crystals/${id}.json`).then(r => r.json())),
)

type Grain = { R: Matrix3; Ri: Matrix3; inv: Matrix3; shift: Vec3; A: number } // rotation, lattice inverse, origin (Å), Å per grain unit
const grains = new WeakMap<Node, Grain>()
function grainOf(root: Node): Grain {
  let g = grains.get(root)
  if (g) return g
  const rng = mulberry32(hash(root.seed, 0x6a1))
  const R = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(randomRotation(rng)))
  const c = LIB[root.props.m as number].cell
  const M = new Matrix3().set(c[0][0], c[1][0], c[2][0], c[0][1], c[1][1], c[2][1], c[0][2], c[1][2], c[2][2]) // columns: cell vectors
  g = { R, Ri: R.clone().transpose(), inv: M.clone().invert(), shift: [0, 1, 2].map(i => rng() * (c[0][i] + c[1][i] + c[2][i])) as Vec3, A: root.metres * 1e10 }
  grains.set(root, g)
  return g
}

const grain: Volume = {
  leafDepth: root => Math.round(Math.log2(root.metres / 1.46e-9)),

  // every lattice point of the unit cell that falls inside this leaf
  fill: (r, _rng, leaf) => {
    const root = volumeRoot(leaf), g = grainOf(root), { cell, atoms } = LIB[root.props.m as number]
    const out: ChildSpec[] = []
    // the leaf cube's corners in fractional lattice coordinates give the range of cells to visit
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
      const p = [(r.c[0] + dx * r.s) * g.A, (r.c[1] + dy * r.s) * g.A, (r.c[2] + dz * r.s) * g.A] // Å, grain frame
      const l = [0, 1, 2].map(i => g.Ri.elements[i] * p[0] + g.Ri.elements[i + 3] * p[1] + g.Ri.elements[i + 6] * p[2] - g.shift[i]) // lattice frame
      const f = [0, 1, 2].map(i => g.inv.elements[i] * l[0] + g.inv.elements[i + 3] * l[1] + g.inv.elements[i + 6] * l[2])
      lo = lo.map((v, i) => Math.min(v, f[i])); hi = hi.map((v, i) => Math.max(v, f[i]))
    }
    for (let i = Math.floor(lo[0]) - 1; i <= Math.ceil(hi[0]); i++) for (let j = Math.floor(lo[1]) - 1; j <= Math.ceil(hi[1]); j++) for (let k = Math.floor(lo[2]) - 1; k <= Math.ceil(hi[2]); k++) {
      atoms.forEach(([z, x, y, zz, occ], a) => {
        if (occ < 1 && hash(hash(i * 73856093 ^ j * 19349663, k * 83492791), a) / 4294967296 >= occ) return
        const l = [x + i * cell[0][0] + j * cell[1][0] + k * cell[2][0] + g.shift[0], y + i * cell[0][1] + j * cell[1][1] + k * cell[2][1] + g.shift[1], zz + i * cell[0][2] + j * cell[1][2] + k * cell[2][2] + g.shift[2]]
        const p = [0, 1, 2].map(n => (g.R.elements[n] * l[0] + g.R.elements[n + 3] * l[1] + g.R.elements[n + 6] * l[2]) / g.A) // grain units
        const pos: Vec3 = [(p[0] - r.c[0]) / r.s, (p[1] - r.c[1]) / r.s, (p[2] - r.c[2]) / r.s]
        if (Math.max(Math.abs(pos[0]), Math.abs(pos[1]), Math.abs(pos[2])) > 0.5) return
        // ponytail: van der Waals radii overlap badly in ionic lattices; drawn at 60%
        out.push({ kind: 'atom', pos, size: (1.2 * element(z)[6] * 1e-12) / root.metres / r.s, props: { z } })
      })
    }
    return out
  },

  far: (_, node) => ({ shape: 'cube', color: LIB[volumeRoot(node).props.m as number].color }),
  info: (r, node) => {
    const root = volumeRoot(node), m = LIB[root.props.m as number]
    return { title: m.name, fact: `${m.fact}${r.depth === 0 ? ` This grain is ${(root.metres * 1e6).toPrecision(2)} µm across; its neighbours are tilted differently, as in any rock.` : ''}` }
  },
}

export const kinds = { grain: volume(grain) }
