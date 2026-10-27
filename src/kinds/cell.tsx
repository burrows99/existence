// Cells, drawn round: a lipid-bilayer membrane around cytosol with proteins, a nucleus full of DNA, mitochondria
// each with its own membrane, and for fat cells a droplet of triglyceride. Every bit of it is real molecules.
import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { DoubleSide, Quaternion, Vector3 } from 'three'
import { hash, mulberry32, randomRotation, type ChildSpec, type Node, type Vec3 } from '../engine/tree'
import { hitsAtoms, inclusions, volume, volumeRoot, type Volume } from './volume'
import { fillWater } from './matter'
import { LIB, M, diameterOf } from './molecule'

export type CellType = { name: string; d: number; color: string; mito: number; nucleus: boolean; droplet?: boolean; cytosol: [number, number][]; fact: string }
export const TYPES: CellType[] = [
  { name: 'Muscle cell', d: 20, color: '#f368e0', mito: 600, nucleus: true, cytosol: [[M.MYOGLOBIN, 3], [M.UBIQUITIN, 1], [M.ATP, 5], [M.GLUCOSE, 1]],
    fact: 'Drawn round here; real muscle cells are long fibres. Its 600 mitochondria burn glucose to make ATP, its nucleus holds two metres of DNA, and the myoglobin in its cytosol stores oxygen.' },
  { name: 'Skin cell', d: 30, color: '#e8b89a', mito: 150, nucleus: true, cytosol: [[M.UBIQUITIN, 2], [M.ATP, 4], [M.GLUCOSE, 1]],
    fact: 'A keratinocyte. Born at the bottom of the epidermis, it is pushed outward, fills with keratin (not modelled yet) and flakes off a month later.' },
  { name: 'Fat cell', d: 58, color: '#f5d76e', mito: 100, nucleus: true, droplet: true, cytosol: [[M.UBIQUITIN, 1], [M.ATP, 2]],
    fact: 'An adipocyte: one huge droplet of triglyceride, with the nucleus and a thin rim of cytoplasm squeezed to the side.' },
  { name: 'Bone cell', d: 15, color: '#efe9d8', mito: 100, nucleus: true, cytosol: [[M.UBIQUITIN, 2], [M.ATP, 4]],
    fact: 'An osteocyte, walled into the mineral it built. The mineral (hydroxyapatite) and the collagen around it are not modelled yet.' },
  { name: 'Neuron', d: 20, color: '#e6b8c8', mito: 500, nucleus: true, cytosol: [[M.UBIQUITIN, 2], [M.ATP, 5], [M.GLUCOSE, 1]],
    fact: 'The body of a nerve cell; its axon and dendrites, which can reach a metre, are not modelled yet. Your brain has 86 billion of them.' },
  { name: 'Liver cell', d: 25, color: '#9c4a2e', mito: 1500, nucleus: true, cytosol: [[M.UBIQUITIN, 2], [M.ATP, 5], [M.GLUCOSE, 3]],
    fact: 'A hepatocyte: 1,500 mitochondria and a chemistry set of enzymes that store sugar, make bile and break down poisons.' },
  { name: 'Red blood cell', d: 8, color: '#c0392b', mito: 0, nucleus: false, cytosol: [[M.MYOGLOBIN, 8], [M.ATP, 1]],
    fact: 'No nucleus, no mitochondria: a bag of haemoglobin (shown here as its single-chain cousin myoglobin) carrying oxygen. 25 trillion of them, each lasting about four months.' },
  { name: 'Lung cell', d: 10, color: '#e88080', mito: 100, nucleus: true, cytosol: [[M.UBIQUITIN, 2], [M.ATP, 4]],
    fact: 'An alveolar cell, a fraction of a micron thin, where air is close enough to blood for oxygen to cross.' },
  { name: 'Gut cell', d: 20, color: '#c98a6a', mito: 300, nucleus: true, cytosol: [[M.UBIQUITIN, 2], [M.ATP, 4], [M.GLUCOSE, 4]],
    fact: 'An enterocyte lining the intestine, replaced every five days. It pulls glucose and amino acids out of your food.' },
]
export const cubeOf = (t: number) => 1.2 * TYPES[t].d * 1e-6 // the cube a cell lives in, metres
const R_CELL = 1 / 2.4 // cell radius as a fraction of its cube

type Spec = { t: number; metres: number; nm: number; rNuc: number; cNuc: Vec3; droplet: number; mitoA: number; mitoB: number; leaf: number; place: number }
const specs = new Map<number, Spec>()
function spec(t: number): Spec {
  let s = specs.get(t)
  if (s) return s
  const T = TYPES[t], metres = cubeOf(t), leaf = Math.round(Math.log2(metres / 1.46e-9))
  s = { t, metres, nm: 1e-9 / metres, rNuc: T.nucleus ? (T.droplet ? 0.04 : 0.125) : 0, cNuc: T.droplet ? [0.33, 0.1, 0.05] : [0.05, 0.03, -0.02], droplet: T.droplet ? 0.36 : 0, mitoA: 0.5e-6 / metres, mitoB: 0.22e-6 / metres, leaf, place: leaf - 3 }
  specs.set(t, s)
  return s
}
const specOf = (n: Node) => spec((n.props.t as number) ?? 0)
const BILAYER_NM = 2.4 // half-thickness kept free of water
const LIPID_NM = 0.8 // spacing: ~0.65 nm² per lipid per leaflet

type Mito = { c: Vec3; q: Quaternion; qi: Quaternion }
const layouts = new Map<string, Mito[]>()
function layout(seed: number, S: Spec): Mito[] {
  const key = `${seed}:${S.t}`
  let L = layouts.get(key)
  if (L) return L
  const rng = mulberry32(hash(seed, 0xce11))
  L = []
  let tries = 0
  while (L.length < TYPES[S.t].mito && tries++ < 200000) {
    const c = [0, 1, 2].map(() => (rng() - 0.5) * 2 * R_CELL) as Vec3
    if (len(c) > R_CELL - S.mitoA || len(sub(c, S.cNuc)) < S.rNuc + S.mitoA || len(c) < S.droplet + S.mitoA) continue
    if (L.some(m => len(sub(c, m.c)) < 2 * S.mitoA)) continue
    const q = randomRotation(rng)
    L.push({ c, q, qi: q.clone().invert() })
  }
  layouts.set(key, L)
  return L
}

type Medium = 'outside' | 'cytosol' | 'nucleoplasm' | 'matrix' | 'fat'
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

function mediumAt(p: Vec3, S: Spec, L: Mito[]): Medium {
  if (len(p) > R_CELL) return 'outside'
  if (S.rNuc && len(sub(p, S.cNuc)) < S.rNuc) return 'nucleoplasm'
  if (S.droplet && len(p) < S.droplet) return 'fat'
  for (const m of L) {
    if (len(sub(p, m.c)) > S.mitoA) continue
    const l = new Vector3(...sub(p, m.c)).applyQuaternion(m.qi)
    if ((l.x / S.mitoA) ** 2 + (l.y / S.mitoB) ** 2 + (l.z / S.mitoB) ** 2 < 1) return 'matrix'
  }
  return 'cytosol'
}

type Surface = { d: number; n: Vec3; p: Vec3; name: string } // signed distance (outward +), outward normal, nearest point
function surface(p: Vec3, S: Spec, L: Mito[]): Surface {
  const sphere = (c: Vec3, R: number, name: string): Surface => {
    const v = sub(p, c), r = len(v) || 1e-12
    const n: Vec3 = [v[0] / r, v[1] / r, v[2] / r]
    return { d: r - R, n, p: [c[0] + n[0] * R, c[1] + n[1] * R, c[2] + n[2] * R], name }
  }
  let best = sphere([0, 0, 0], R_CELL, 'Cell membrane')
  if (S.rNuc) {
    const nuc = sphere(S.cNuc, S.rNuc, 'Nuclear envelope')
    if (Math.abs(nuc.d) < Math.abs(best.d)) best = nuc
  }
  for (const m of L) {
    const v = sub(p, m.c)
    if (len(v) > S.mitoA + Math.abs(best.d)) continue
    const l = new Vector3(...v).applyQuaternion(m.qi)
    const u = Math.sqrt((l.x / S.mitoA) ** 2 + (l.y / S.mitoB) ** 2 + (l.z / S.mitoB) ** 2) || 1e-12
    const d = l.length() * (1 - 1 / u) // along the radial line to the ellipsoid: close enough for a thin membrane
    if (Math.abs(d) >= Math.abs(best.d)) continue
    const g = new Vector3(l.x / S.mitoA ** 2, l.y / S.mitoB ** 2, l.z / S.mitoB ** 2).normalize().applyQuaternion(m.q)
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

// a fat droplet: triglyceride at its liquid density, 0.61 molecules per nm³, thrown in at random
function fillFat(side: number, rng: () => number): ChildSpec[] {
  const mean = 0.61e27 * side ** 3
  let n = Math.floor(mean) + (rng() < mean - Math.floor(mean) ? 1 : 0)
  const out: ChildSpec[] = []
  // ponytail: molecules may overlap; a real droplet packs them like a liquid
  while (n-- > 0) out.push({ kind: 'molecule', pos: [0, 1, 2].map(() => rng() - 0.5) as Vec3, size: diameterOf(M.FAT) / side, props: { m: M.FAT } })
  return out
}

const Y = new Vector3(0, 1, 0)
const HAZE: Record<Medium, string> = { outside: '', cytosol: '#2a4f7a', nucleoplasm: '#5a3a8a', matrix: '#9a5a2a', fat: '#8a7a2a' }
const FACTS: Record<Medium, [string, string]> = {
  outside: ['Extracellular fluid', 'Salty water between cells. Glucose at its real blood concentration; insulin far more concentrated than in real blood, so that you can find one.'],
  cytosol: ['Cytosol', 'The crowded fluid that fills the cell: about 70% water and 20% protein by mass. Ubiquitin and a few others stand in for the thousands of kinds of protein here, at a fraction of the real crowding; ATP at its real 5 mM.'],
  nucleoplasm: ['Nucleus', 'Two metres of DNA packed into 6 µm, shown as short double-helix segments at the real density. The histone spools it wraps around are not modelled yet.'],
  matrix: ['Mitochondrial matrix', 'Where the cell’s ATP is made. Mitochondria keep their own small loop of DNA; the enzymes that do the work are not modelled yet.'],
  fat: ['Fat droplet', 'Pure triglyceride: the cell’s energy store, drawn from and topped up between meals.'],
}
const MEMBRANES: Record<string, string> = {
  'Cell membrane': 'A bilayer of phospholipids about 4 nm thick, heads out and tails in, stiffened by cholesterol. Everything that enters or leaves the cell crosses it; the proteins that let things through are not modelled yet.',
  'Nuclear envelope': 'Two bilayers (drawn as one here) around the nucleus, with pores that let RNA out and proteins in.',
  'Mitochondrial membrane': 'The outer of a mitochondrion’s two membranes; the folded inner one is not modelled yet. Inside, sugar is burnt to make ATP.',
}

function Organelles({ node }: { node: Node }) {
  const S = specOf(node)
  const L = useMemo(() => layout(node.seed, S), [node, S])
  return (
    <group>
      <mesh>
        <sphereGeometry args={[R_CELL, 64, 48]} />
        <meshStandardMaterial color={TYPES[S.t].color} transparent opacity={0.1} side={DoubleSide} depthWrite={false} />
      </mesh>
      {S.rNuc > 0 && (
        <mesh position={S.cNuc}>
          <sphereGeometry args={[S.rNuc, 48, 32]} />
          <meshStandardMaterial color="#8e44ad" transparent opacity={0.3} side={DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {S.droplet > 0 && (
        <mesh>
          <sphereGeometry args={[S.droplet, 48, 32]} />
          <meshStandardMaterial color="#f7e27a" transparent opacity={0.35} side={DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {L.length > 0 && (
        <Instances limit={L.length}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color="#ff9f43" transparent opacity={0.4} side={DoubleSide} depthWrite={false} />
          {L.map((m, i) => <Instance key={i} position={m.c} quaternion={m.q} scale={[S.mitoA, S.mitoB, S.mitoB]} />)}
        </Instances>
      )}
    </group>
  )
}

const cell: Volume = {
  leafDepth: root => specOf(root).leaf,
  placeDepth: root => specOf(root).place,
  inside: (_, p) => len(p) < R_CELL,
  Near: Organelles,
  nearOnPath: true, // the organelle outlines are a guide for the cell you are in, not for every cell in a tissue
  nearMax: 160, // and deep inside, the molecules speak for themselves

  placements: (r, rng, node) => {
    const S = specOf(node), L = layout(volumeRoot(node).seed, S)
    if (Math.abs(surface(r.c, S, L).d) < r.s * 0.87 + 3 * S.nm) return [] // membrane zone: membrane proteins not modelled
    const med = mediumAt(r.c, S, L)
    if (med === 'fat') return []
    const recipe: [number, number][] = med === 'cytosol' ? [...TYPES[S.t].cytosol]
      : med === 'nucleoplasm' ? [[M.DNA, 6], [M.ATP, 1]]
      : med === 'matrix' ? [[M.DNA, 1], [M.ATP, 5]]
      : [[M.GLUCOSE, 2]] // outside: 5 mM, as in blood
    if (med === 'outside' && rng() < 0.05) recipe.push([M.INSULIN, 1])
    const out: ChildSpec[] = []
    const placed: [Vec3, number][] = []
    for (const [m, count] of recipe) for (let i = 0; i < count; i++) {
      const size = diameterOf(m) / S.metres / r.s
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
    const S = specOf(leaf), L = layout(volumeRoot(leaf).seed, S)
    const Sf = surface(r.c, S, L)
    const half = r.s * 0.87
    const toLeaf = (p: Vec3): Vec3 => [(p[0] - r.c[0]) / r.s, (p[1] - r.c[1]) / r.s, (p[2] - r.c[2]) / r.s]
    const out: ChildSpec[] = []
    const membrane = Math.abs(Sf.d) < half + 3 * S.nm
    if (membrane) {
      // lipids on a jittered grid in the tangent plane, two leaflets with tails meeting at the surface
      const [u, v] = basis(Sf.n)
      const g = LIPID_NM * S.nm
      const K = Math.ceil((half + 2 * S.nm) / g)
      for (let i = -K; i <= K; i++) for (let j = -K; j <= K; j++) {
        const a = (i + 0.3 * (rng() - 0.5)) * g, b = (j + 0.3 * (rng() - 0.5)) * g
        const P: Vec3 = [Sf.p[0] + a * u[0] + b * v[0], Sf.p[1] + a * u[1] + b * v[1], Sf.p[2] + a * u[2] + b * v[2]]
        const Pl = toLeaf(P)
        if (Math.max(Math.abs(Pl[0]), Math.abs(Pl[1]), Math.abs(Pl[2])) > 0.5) continue // another leaf owns this site
        for (const sign of [1, -1]) {
          const chol = rng() < 0.3
          const m = chol ? M.CHOLESTEROL : M.POPC
          const off = (chol ? 0.35 : 0.15) * S.nm
          const q = new Quaternion().setFromUnitVectors(Y, new Vector3(Sf.n[0] * sign, Sf.n[1] * sign, Sf.n[2] * sign))
            .multiply(new Quaternion().setFromAxisAngle(Y, rng() * Math.PI * 2))
          const tail = new Vector3(...LIB[m].tail!).multiplyScalar(1e-10 / S.metres).applyQuaternion(q)
          const C: Vec3 = [P[0] + sign * off * Sf.n[0] - tail.x, P[1] + sign * off * Sf.n[1] - tail.y, P[2] + sign * off * Sf.n[2] - tail.z]
          out.push({ kind: 'molecule', pos: toLeaf(C), size: diameterOf(m) / S.metres / r.s, props: { m, qx: q.x, qy: q.y, qz: q.z, qw: q.w } })
        }
      }
    }
    if (mediumAt(r.c, S, L) === 'fat') return out.concat(fillFat(r.s * S.metres, rng))
    const incs = inclusions(cell, leaf)
    out.push(...fillWater(r.s * S.metres, rng, (p, rad) => {
      if (membrane) {
        const dd = (r.c[0] + p[0] * r.s - Sf.p[0]) * Sf.n[0] + (r.c[1] + p[1] * r.s - Sf.p[1]) * Sf.n[1] + (r.c[2] + p[2] * r.s - Sf.p[2]) * Sf.n[2]
        if (Math.abs(dd) < BILAYER_NM * S.nm) return true
      }
      return incs.some(inc => hitsAtoms(inc, p, rad))
    }))
    return out
  },

  far: (r, node) => {
    const S = specOf(node)
    if (r.depth === 0) return { shape: 'sphere', color: TYPES[S.t].color, scale: 2 * R_CELL }
    const color = HAZE[mediumAt(r.c, S, layout(volumeRoot(node).seed, S))]
    return color ? { shape: 'haze', color } : null
  },

  info: (r, node) => {
    const S = specOf(node), T = TYPES[S.t]
    if (r.depth < 6) return { title: T.name, fact: `About ${T.d} µm across. ${T.fact}` } // big regions straddle several media
    const L = layout(volumeRoot(node).seed, S)
    const Sf = surface(r.c, S, L)
    if (Math.abs(Sf.d) < r.s * 0.87 + 3 * S.nm) return { title: Sf.name, fact: MEMBRANES[Sf.name] } // straddles a membrane
    const [title, fact] = FACTS[mediumAt(r.c, S, L)]
    return { title, fact }
  },
}

export const kinds = { cell: volume(cell) }
