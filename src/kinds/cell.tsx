// A muscle cell, drawn round: a lipid-bilayer membrane around cytosol crowded with proteins, a nucleus full of
// DNA, and hundreds of mitochondria, each with its own membrane. Every bit of it is real molecules.
import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { DoubleSide, Quaternion, Vector3 } from 'three'
import { hash, mulberry32, randomRotation, type ChildSpec, type Node, type Vec3 } from '../engine/tree'
import { hitsAtoms, inclusions, rootOf, volume, type Region, type Volume } from './volume'
import { fillWater } from './matter'
import { LIB, M, diameterOf } from './molecule'

export const SIDE = 24e-6 // root cube, metres
const NM = 1e-9 / SIDE // one nanometre in root units
const R_CELL = 10e-6 / SIDE
const R_NUC = 3e-6 / SIDE
const C_NUC: Vec3 = [0.05, 0.03, -0.02]
const MITO = { n: 600, a: 0.5e-6 / SIDE, b: 0.22e-6 / SIDE } // ellipsoid semi-axes
const LEAF_DEPTH = 14 // 1.46 nm leaves
const PLACE_DEPTH = 11 // 11.7 nm regions place molecules
const BILAYER = 2.4 * NM // half-thickness kept free of water
const LIPID_SPACING = 0.8 * NM // ~0.65 nm² per lipid per leaflet

type Mito = { c: Vec3; q: Quaternion; qi: Quaternion }
const layouts = new Map<number, Mito[]>()
function layout(seed: number): Mito[] {
  let L = layouts.get(seed)
  if (L) return L
  const rng = mulberry32(hash(seed, 0xce11))
  L = []
  while (L.length < MITO.n) {
    const c = [0, 1, 2].map(() => (rng() - 0.5) * 2 * R_CELL) as Vec3
    if (len(c) > R_CELL - MITO.a || len(sub(c, C_NUC)) < R_NUC + MITO.a) continue
    if (L.some(m => len(sub(c, m.c)) < 2 * MITO.a)) continue
    const q = randomRotation(rng)
    L.push({ c, q, qi: q.clone().invert() })
  }
  layouts.set(seed, L)
  if (import.meta.env.DEV) Object.assign(window, { __cellLayout: L })
  return L
}

type Medium = 'outside' | 'cytosol' | 'nucleoplasm' | 'matrix'
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const seedOf = (n: Node) => rootOf(n).seed

function mediumAt(p: Vec3, L: Mito[]): Medium {
  if (len(p) > R_CELL) return 'outside'
  if (len(sub(p, C_NUC)) < R_NUC) return 'nucleoplasm'
  for (const m of L) {
    if (len(sub(p, m.c)) > MITO.a) continue
    const l = new Vector3(...sub(p, m.c)).applyQuaternion(m.qi)
    if ((l.x / MITO.a) ** 2 + (l.y / MITO.b) ** 2 + (l.z / MITO.b) ** 2 < 1) return 'matrix'
  }
  return 'cytosol'
}

type Surface = { d: number; n: Vec3; p: Vec3; name: string } // signed distance (outward +), outward normal, nearest point
function surface(p: Vec3, L: Mito[]): Surface {
  const sphere = (c: Vec3, R: number, name: string): Surface => {
    const v = sub(p, c), r = len(v) || 1e-12
    const n: Vec3 = [v[0] / r, v[1] / r, v[2] / r]
    return { d: r - R, n, p: [c[0] + n[0] * R, c[1] + n[1] * R, c[2] + n[2] * R], name }
  }
  let best = sphere([0, 0, 0], R_CELL, 'Cell membrane')
  const nuc = sphere(C_NUC, R_NUC, 'Nuclear envelope')
  if (Math.abs(nuc.d) < Math.abs(best.d)) best = nuc
  for (const m of L) {
    const v = sub(p, m.c)
    if (len(v) > MITO.a + Math.abs(best.d)) continue
    const l = new Vector3(...v).applyQuaternion(m.qi)
    const u = Math.sqrt((l.x / MITO.a) ** 2 + (l.y / MITO.b) ** 2 + (l.z / MITO.b) ** 2) || 1e-12
    const d = l.length() * (1 - 1 / u) // along the radial line to the ellipsoid: close enough for a thin membrane
    if (Math.abs(d) >= Math.abs(best.d)) continue
    const g = new Vector3(l.x / MITO.a ** 2, l.y / MITO.b ** 2, l.z / MITO.b ** 2).normalize().applyQuaternion(m.q)
    const n: Vec3 = [g.x, g.y, g.z]
    best = { d, n, p: [p[0] - n[0] * d, p[1] - n[1] * d, p[2] - n[2] * d], name: 'Mitochondrial membrane' }
  }
  return best
}

function basis(n: Vec3): [Vec3, Vec3] {
  const a = new Vector3(...n), b = Math.abs(n[0]) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
  const u = new Vector3().crossVectors(a, b).normalize(), v = new Vector3().crossVectors(a, u)
  return [[u.x, u.y, u.z], [v.x, v.y, v.z]]
}

const Y = new Vector3(0, 1, 0)
const RECIPES: Record<Medium, [number, number][]> = {
  outside: [[M.GLUCOSE, 2]], // 5 mM, as in blood; insulin is added rarely below
  cytosol: [[M.MYOGLOBIN, 3], [M.ATP, 5], [M.GLUCOSE, 1]],
  nucleoplasm: [[M.DNA, 6], [M.ATP, 1]],
  matrix: [[M.DNA, 1], [M.ATP, 5]],
}
const HAZE: Record<Medium, string> = { outside: '', cytosol: '#2a4f7a', nucleoplasm: '#5a3a8a', matrix: '#9a5a2a' }
const FACTS: Record<Medium, [string, string]> = {
  outside: ['Extracellular fluid', 'Salty water between cells. Glucose at its real blood concentration; insulin far more concentrated than in real blood, so that you can find one.'],
  cytosol: ['Cytosol', 'The crowded fluid that fills the cell: about 70% water and 20% protein by mass. Myoglobin stands in for the thousands of kinds of protein here, at a fraction of the real crowding; ATP at its real 5 mM.'],
  nucleoplasm: ['Nucleus', 'Two metres of DNA packed into 6 µm, shown as short double-helix segments at the real density. The histone spools it wraps around are not modelled yet.'],
  matrix: ['Mitochondrial matrix', 'Where the cell’s ATP is made. Mitochondria keep their own small loop of DNA; the enzymes that do the work are not modelled yet.'],
}
const MEMBRANES: Record<string, string> = {
  'Cell membrane': 'A bilayer of phospholipids about 4 nm thick, heads out and tails in, stiffened by cholesterol. Everything that enters or leaves the cell crosses it; the proteins that let things through are not modelled yet.',
  'Nuclear envelope': 'Two bilayers (drawn as one here) around the nucleus, with pores that let RNA out and proteins in.',
  'Mitochondrial membrane': 'The outer of a mitochondrion’s two membranes; the folded inner one is not modelled yet. Inside, sugar is burnt to make ATP.',
}

function Organelles({ node }: { node: Node }) {
  const L = useMemo(() => layout(node.seed), [node])
  return (
    <group>
      <mesh>
        <sphereGeometry args={[R_CELL, 64, 48]} />
        <meshStandardMaterial color="#f368e0" transparent opacity={0.1} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={C_NUC}>
        <sphereGeometry args={[R_NUC, 48, 32]} />
        <meshStandardMaterial color="#8e44ad" transparent opacity={0.3} side={DoubleSide} depthWrite={false} />
      </mesh>
      <Instances limit={L.length}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#ff9f43" transparent opacity={0.4} side={DoubleSide} depthWrite={false} />
        {L.map((m, i) => <Instance key={i} position={m.c} quaternion={m.q} scale={[MITO.a, MITO.b, MITO.b]} />)}
      </Instances>
    </group>
  )
}

const cell: Volume = {
  metres: SIDE,
  leafDepth: LEAF_DEPTH,
  placeDepth: PLACE_DEPTH,
  open: r => (r.depth >= LEAF_DEPTH ? 0.15 : 0.1),
  Near: Organelles,

  placements: (r, rng, node) => {
    const L = layout(seedOf(node))
    if (Math.abs(surface(r.c, L).d) < r.s * 0.87 + 3 * NM) return [] // membrane zone: membrane proteins not modelled
    const med = mediumAt(r.c, L)
    const recipe = [...RECIPES[med]]
    if (med === 'outside' && rng() < 0.05) recipe.push([M.INSULIN, 1])
    const out: ChildSpec[] = []
    const placed: [Vec3, number][] = []
    for (const [m, count] of recipe) for (let i = 0; i < count; i++) {
      const size = diameterOf(m) / SIDE / r.s
      const reff = size / 4 // molecules are not spheres: keep centres this far apart and let the atoms sort it out
      for (let t = 0; t < 30; t++) {
        const pos = [0, 1, 2].map(() => (rng() - 0.5) * 2 * Math.max(0.1, 0.5 - reff)) as Vec3
        if (placed.every(([p, pr]) => len(sub(pos, p)) > reff + pr)) {
          placed.push([pos, reff])
          out.push({ kind: 'molecule', pos, size, props: { m } })
          break
        }
      }
    }
    return out
  },

  fill: (r, rng, leaf) => {
    const L = layout(seedOf(leaf))
    const S = surface(r.c, L)
    const half = r.s * 0.87
    const toLeaf = (p: Vec3): Vec3 => [(p[0] - r.c[0]) / r.s, (p[1] - r.c[1]) / r.s, (p[2] - r.c[2]) / r.s]
    const out: ChildSpec[] = []
    const membrane = Math.abs(S.d) < half + 3 * NM
    if (membrane) {
      // lipids on a jittered grid in the tangent plane, two leaflets with tails meeting at the surface
      const [u, v] = basis(S.n)
      const K = Math.ceil((half + 2 * NM) / LIPID_SPACING)
      for (let i = -K; i <= K; i++) for (let j = -K; j <= K; j++) {
        const a = (i + 0.3 * (rng() - 0.5)) * LIPID_SPACING, b = (j + 0.3 * (rng() - 0.5)) * LIPID_SPACING
        const P: Vec3 = [S.p[0] + a * u[0] + b * v[0], S.p[1] + a * u[1] + b * v[1], S.p[2] + a * u[2] + b * v[2]]
        const Pl = toLeaf(P)
        if (Math.max(Math.abs(Pl[0]), Math.abs(Pl[1]), Math.abs(Pl[2])) > 0.5) continue // another leaf owns this site
        for (const sign of [1, -1]) {
          const chol = rng() < 0.3
          const m = chol ? M.CHOLESTEROL : M.POPC
          const off = (chol ? 0.35 : 0.15) * NM
          const q = new Quaternion().setFromUnitVectors(Y, new Vector3(S.n[0] * sign, S.n[1] * sign, S.n[2] * sign))
            .multiply(new Quaternion().setFromAxisAngle(Y, rng() * Math.PI * 2))
          const tail = new Vector3(...LIB[m].tail!).multiplyScalar(1e-10 / SIDE).applyQuaternion(q)
          const C: Vec3 = [P[0] + sign * off * S.n[0] - tail.x, P[1] + sign * off * S.n[1] - tail.y, P[2] + sign * off * S.n[2] - tail.z]
          out.push({ kind: 'molecule', pos: toLeaf(C), size: diameterOf(m) / SIDE / r.s, props: { m, qx: q.x, qy: q.y, qz: q.z, qw: q.w } })
        }
      }
    }
    const incs = inclusions(cell, leaf)
    out.push(...fillWater(r.s * SIDE, rng, (p, rad) => {
      if (membrane) {
        const dd = (r.c[0] + p[0] * r.s - S.p[0]) * S.n[0] + (r.c[1] + p[1] * r.s - S.p[1]) * S.n[1] + (r.c[2] + p[2] * r.s - S.p[2]) * S.n[2]
        if (Math.abs(dd) < BILAYER) return true
      }
      return incs.some(inc => hitsAtoms(inc, p, rad))
    }))
    return out
  },

  far: (r, node) => {
    const color = HAZE[mediumAt(r.c, layout(seedOf(node)))]
    return color ? { shape: 'haze', color } : null
  },

  nearMax: SIDE / 150e-9, // the organelle outlines are a guide; below 150 nm the molecules speak for themselves
  info: (r, node) => {
    if (r.depth < 6) { // big regions straddle several media: they are just "the cell"
      return { title: 'Muscle cell', fact: 'About 20 µm across, one of roughly 37 trillion cells in a person (drawn round here). Its 600 mitochondria burn glucose to make ATP, its nucleus holds two metres of DNA, and the myoglobin in its cytosol stores oxygen.' }
    }
    const L = layout(seedOf(node))
    const S = surface(r.c, L)
    if (Math.abs(S.d) < r.s * 0.87 + 3 * NM) return { title: S.name, fact: MEMBRANES[S.name] } // straddles a membrane
    const [title, fact] = FACTS[mediumAt(r.c, L)]
    return { title, fact }
  },
}

export const kinds = { cell: volume(cell) }
export { regionOf } from './volume'
export type { Region }
