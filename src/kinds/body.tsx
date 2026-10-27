// A human body: tissue is a function of position (a stylised anatomy of capsules and ellipsoids), every tissue is
// packed with cells of its kind, the fluid between them is water, and outside the skin is air.
import { useMemo } from 'react'
import { DoubleSide, Quaternion, Vector3 } from 'three'
import { childrenOf, hash, mulberry32, type ChildSpec, type Far, type Node, type Vec3 } from '../engine/tree'
import { hitsAtoms, inclusions, rootProps, volume, type Volume } from './volume'
import { PERF } from '../engine/perf'
import { fillAir, fillWater } from './matter'
import { TYPES, cubeOf } from './cell'

const SIDE = 2 // metres; the figure stands with its hips at the centre
const LEAF_DEPTH = 30 // 1.86 nm
const PLACE_DEPTH = 15 // 61 µm regions place cells

type Tissue = 'air' | 'skin' | 'fat' | 'muscle' | 'bone' | 'brain' | 'heart' | 'blood' | 'lung' | 'liver' | 'gut'
type Seg = { a: Vec3; b: Vec3; r: number; zs?: number; t?: Tissue } // a capsule, optionally flattened front-to-back
type Ell = { c: Vec3; s: Vec3; t: Tissue }

const mirror = (segs: Seg[]) => segs.flatMap(s => [s, { ...s, a: [-s.a[0], s.a[1], s.a[2]] as Vec3, b: [-s.b[0], s.b[1], s.b[2]] as Vec3 }])
// in metres, y up
const PARTS: Seg[] = [
  { a: [0, 0.72, 0], b: [0, 0.72, 0], r: 0.11 }, // head
  { a: [0, 0.55, 0], b: [0, 0.65, 0], r: 0.055 }, // neck
  { a: [0, -0.02, 0], b: [0, 0.5, 0], r: 0.17, zs: 0.65 }, // torso
  ...mirror([
    { a: [0.2, 0.52, 0], b: [0.26, 0.22, 0], r: 0.045 }, // upper arm
    { a: [0.26, 0.22, 0], b: [0.3, -0.05, 0], r: 0.04 }, // forearm
    { a: [0.31, -0.12, 0], b: [0.31, -0.12, 0], r: 0.05 }, // hand
    { a: [0.09, -0.02, 0], b: [0.1, -0.42, 0], r: 0.08 }, // thigh
    { a: [0.1, -0.42, 0], b: [0.1, -0.78, 0], r: 0.055 }, // shin
    { a: [0.1, -0.82, 0], b: [0.1, -0.82, 0.13], r: 0.04 }, // foot
  ]),
]
const BONES: Seg[] = [
  { a: [0, -0.02, -0.06], b: [0, 0.55, -0.06], r: 0.02 }, // spine
  ...mirror([
    { a: [0.09, -0.02, 0], b: [0.1, -0.42, 0], r: 0.016 }, // femur
    { a: [0.1, -0.42, 0], b: [0.1, -0.78, 0], r: 0.012 }, // tibia
    { a: [0.2, 0.52, 0], b: [0.26, 0.22, 0], r: 0.012 }, // humerus
    { a: [0.26, 0.22, 0], b: [0.3, -0.05, 0], r: 0.009 }, // radius
  ]),
]
const ORGANS: Ell[] = [
  { c: [0, 0.745, 0.005], s: [0.08, 0.07, 0.09], t: 'brain' },
  { c: [-0.03, 0.4, 0.03], s: [0.055, 0.065, 0.05], t: 'heart' },
  { c: [0.085, 0.38, -0.01], s: [0.065, 0.12, 0.08], t: 'lung' },
  { c: [-0.095, 0.38, -0.01], s: [0.06, 0.12, 0.08], t: 'lung' },
  { c: [0.07, 0.24, 0.03], s: [0.1, 0.07, 0.07], t: 'liver' },
  { c: [-0.06, 0.26, 0.04], s: [0.06, 0.05, 0.045], t: 'gut' }, // stomach
  { c: [0, 0.09, 0.03], s: [0.13, 0.1, 0.07], t: 'gut' }, // intestines
]
const SKULL: Ell = { c: [0, 0.72, 0], s: [0.105, 0.105, 0.105], t: 'bone' }
const RIBS: Ell = { c: [0, 0.4, -0.01], s: [0.15, 0.14, 0.1], t: 'bone' }

// signed distance to a capsule, metres
function capsule(p: Vec3, s: Seg) {
  const z = s.zs ?? 1
  const ab: Vec3 = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]]
  const ap: Vec3 = [p[0] - s.a[0], p[1] - s.a[1], (p[2] - s.a[2]) / z]
  const l2 = ab[0] ** 2 + ab[1] ** 2 + (ab[2] / z) ** 2
  const t = l2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + (ap[2] * ab[2]) / z) / l2)) : 0
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - (t * ab[2]) / z) - s.r
}
const ellipsoidU = (p: Vec3, e: Ell) => Math.sqrt(((p[0] - e.c[0]) / e.s[0]) ** 2 + ((p[1] - e.c[1]) / e.s[1]) ** 2 + ((p[2] - e.c[2]) / e.s[2]) ** 2)
const bodySdf = (p: Vec3) => Math.min(...PARTS.map(s => capsule(p, s)))

export function tissueAt(p: Vec3): Tissue { // p in metres
  const d = bodySdf(p)
  if (d > 0) return 'air'
  if (d > -0.002) return 'skin'
  if (d > -0.008) return 'fat'
  const sk = ellipsoidU(p, SKULL), rb = ellipsoidU(p, RIBS)
  if (sk > 0.9 && sk < 1) return 'bone'
  if (rb > 0.93 && rb < 1) return 'bone'
  for (const o of ORGANS) {
    const u = ellipsoidU(p, o)
    if (u < 1) return o.t === 'heart' && u < 0.6 ? 'blood' : o.t
  }
  for (const b of BONES) if (capsule(p, b) < 0) return 'bone'
  return 'muscle'
}

type TissueSpec = { cell: number; keep: number; air?: boolean; color: string; name: string; fact: string }
const TISSUE: Record<Tissue, TissueSpec> = {
  air: { cell: -1, keep: 0, air: true, color: '', name: 'Air', fact: 'Nitrogen and oxygen molecules, a thousand times sparser than the water in you.' },
  skin: { cell: 1, keep: 1, color: '#d9a37a', name: 'Skin', fact: 'The epidermis: layers of keratinocytes, dividing at the bottom and dead and flattened at the top. About two square metres of it.' },
  fat: { cell: 2, keep: 1, color: '#f0d070', name: 'Fat', fact: 'Subcutaneous fat: adipocytes storing energy as triglyceride, and keeping you warm.' },
  muscle: { cell: 0, keep: 1, color: '#b03030', name: 'Muscle', fact: 'Skeletal muscle, about 40% of your mass. Its cells are shown round; real ones are fibres running the length of the muscle.' },
  bone: { cell: 3, keep: 0.1, color: '#efe9d8', name: 'Bone', fact: 'Osteocytes in a mineral they built. The mineral itself (hydroxyapatite and collagen) is not modelled yet, so bone looks sparse here.' },
  brain: { cell: 4, keep: 0.5, color: '#e6b8c8', name: 'Brain', fact: '86 billion neurons and as many glial cells (not modelled yet), wired by axons that are not modelled yet either.' },
  heart: { cell: 0, keep: 1, color: '#a02020', name: 'Heart muscle', fact: 'Cardiac muscle: cells packed with mitochondria that contract three billion times in a life.' },
  blood: { cell: 6, keep: 0.45, color: '#c01010', name: 'Blood', fact: 'Red cells, 45% by volume, in plasma: water with salts, glucose, hormones and proteins such as albumin (not modelled yet).' },
  lung: { cell: 7, keep: 0.2, air: true, color: '#e88080', name: 'Lung', fact: 'Alveoli: 300 million air sacs with 70 m² of surface, lined by cells a fraction of a micron thin.' },
  liver: { cell: 5, keep: 1, color: '#7a2e1a', name: 'Liver', fact: 'The body’s chemical plant: 240 billion hepatocytes storing sugar, making proteins and clearing the blood.' },
  gut: { cell: 8, keep: 1, color: '#c98a6a', name: 'Gut', fact: 'The lining of the stomach and intestines, where food becomes molecules small enough to take in.' },
}
// the body stands along `up` (props ux, uy, uz; default +y): points are rotated into the figure's own frame
const Yv = new Vector3(0, 1, 0)
const quats = new WeakMap<Node, Quaternion>()
function toFigure(node: Node, p: Vec3): Vec3 {
  const up = (node.props.uy === undefined) ? null : new Vector3(node.props.ux as number, node.props.uy as number, node.props.uz as number)
  if (!up) return [p[0] * SIDE, p[1] * SIDE, p[2] * SIDE]
  let q = quats.get(node)
  if (!q) quats.set(node, (q = new Quaternion().setFromUnitVectors(up.normalize(), Yv)))
  const v = new Vector3(p[0] * SIDE, p[1] * SIDE, p[2] * SIDE).applyQuaternion(q)
  return [v.x, v.y, v.z]
}
const uprightOf = (node: Node) => node.props.uy === undefined ? new Quaternion() : new Quaternion().setFromUnitVectors(Yv, new Vector3(node.props.ux as number, node.props.uy as number, node.props.uz as number).normalize())

function Figure({ node }: { node: Node }) {
  const Y = new Vector3(0, 1, 0)
  const upright = useMemo(() => uprightOf(node), [node])
  const caps = useMemo(() => [...PARTS.map(s => ({ s, color: '#d9a37a', opacity: 0.22 })), ...BONES.map(s => ({ s, color: '#efe9d8', opacity: 0.6 }))].map(({ s, color, opacity }) => {
    const a = new Vector3(...s.a), b = new Vector3(...s.b), dir = b.clone().sub(a)
    const q = dir.length() ? new Quaternion().setFromUnitVectors(Y, dir.clone().normalize()) : new Quaternion()
    return { mid: a.clone().add(b).multiplyScalar(0.5 / SIDE), q, len: dir.length() / SIDE, r: s.r / SIDE, zs: s.zs ?? 1, color, opacity }
  }), [])
  return (
    <group quaternion={upright}>
      {caps.map((c, i) => (
        <mesh key={i} position={c.mid} quaternion={c.q} scale={[1, 1, c.zs]}>
          <capsuleGeometry args={[c.r, c.len, 6, 16]} />
          <meshStandardMaterial color={c.color} transparent opacity={c.opacity} side={DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      {ORGANS.map((o, i) => (
        <mesh key={i} position={[o.c[0] / SIDE, o.c[1] / SIDE, o.c[2] / SIDE]} scale={[o.s[0] / SIDE, o.s[1] / SIDE, o.s[2] / SIDE]}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshStandardMaterial color={TISSUE[o.t].color} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

const body: Volume = {
  leafDepth: () => LEAF_DEPTH,
  placeDepth: () => PLACE_DEPTH,
  open: r => (r.depth === PLACE_DEPTH ? PERF.openPlace : undefined),
  Near: Figure,
  nearMax: SIDE / 2e-3, // the outline is a guide down to a couple of millimetres
  inside: (node, p) => bodySdf(toFigure(node, p)) < 0,

  // cells of the local tissue, packed on a jittered grid
  placements: (r, rng, node) => {
    const T = TISSUE[tissueAt(toFigure(node, r.c))]
    if (T.cell < 0) return []
    const d = TYPES[T.cell].d * 1e-6, side = r.s * SIDE
    const n = Math.max(1, Math.round(side / (d * 1.02))), gap = 1 / n, jit = n > 1 ? 0.3 * (gap - d / side) : 0
    const size = cubeOf(T.cell) / side
    const out: ChildSpec[] = []
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      if (rng() > T.keep) continue
      const at = (q: number) => (q + 0.5) * gap - 0.5 + (rng() - 0.5) * 2 * jit
      out.push({ kind: 'cell', pos: [at(i), at(j), at(k)], size, props: { ...rootProps, t: T.cell } })
    }
    return out
  },

  // between the cells: water, or air in the lungs and outside the skin
  fill: (r, rng, leaf) => {
    const T = TISSUE[tissueAt(toFigure(leaf, r.c))]
    const incs = inclusions(body, leaf)
    const keepOut = (p: Vec3, rad: number) => incs.some(inc => hitsAtoms(inc, p, rad))
    return T.air ? fillAir(r.s * SIDE, rng, keepOut) : fillWater(r.s * SIDE, rng, keepOut, 0.15)
  },

  far: (r, node) => {
    const T = TISSUE[tissueAt(toFigure(node, r.c))]
    if (!T.color) return null
    if (r.depth < 9) return { shape: 'haze', color: T.color } // coarser than 4 mm: a tint
    if (r.depth > PLACE_DEPTH) return null // its cells are drawn by the open parent
    const color = TYPES[T.cell].color
    // at the placing depth: the first couple of dozen of its real cells, so nothing pops when it opens
    if (r.depth === PLACE_DEPTH) return childrenOf(node).slice(8, 32).map(c => ({ shape: 'sphere' as const, color, scale: c.size / 1.2, pos: c.pos }))
    // above it: a couple of dozen cells thrown in at random stand in for all of them
    const rng = mulberry32(hash(node.seed, 0x5a3))
    const d = (TYPES[T.cell].d * 1e-6) / (r.s * SIDE)
    const n = Math.min(24, Math.round(T.keep / d ** 3))
    const out: Far[] = []
    for (let i = 0; i < n; i++) out.push({ shape: 'sphere', color, scale: d, pos: [0, 1, 2].map(() => rng() - 0.5) as Vec3 })
    return out
  },

  info: (r, node) => {
    if (r.depth < 12) return { title: 'Human body', fact: 'A person 1.7 m tall, drawn as a stylised figure: skin and fat over muscle and bone, organs inside, air outside. Every tissue is cells, every cell is molecules.' }
    const T = TISSUE[tissueAt(toFigure(node, r.c))]
    return { title: T.name, fact: T.fact }
  },
}

export const kinds = { body: volume(body) }
