// A volume of space filled by a medium: an octree of regions that know their absolute position, so what is
// at a point can be a function of where it is (inside the nucleus, near a membrane, below the crust…).
// Regions at `placeDepth` may place things (molecules, cells…) that the leaves then leave room for.
import { childrenOf, hash, kindOf, mulberry32, type ChildSpec, type Far, type Kind, type Node, type Vec3 } from '../engine/tree'
import { PERF } from '../engine/perf'

export type Region = { c: Vec3; s: number; depth: number } // centre and side, in root units
export type Inclusion = { node: Node; c: Vec3; s: number } // a placed thing, in leaf units

export type Volume = {
  leafDepth: (root: Node) => number
  placeDepth?: (root: Node) => number
  placements?: (r: Region, rng: () => number, node: Node) => ChildSpec[] // pos/size in region units
  fill: (r: Region, rng: () => number, leaf: Node) => ChildSpec[] // leaf contents, pos in leaf units
  far: (r: Region, node: Node) => Far | Far[] | null
  open?: (r: Region, root: Node) => number | undefined // undefined: the PERF defaults for regions and leaves
  inside?: (node: Node, p: Vec3) => boolean // is this point (node units) inside the thing itself, not just its cube?
  deep?: boolean // nothing opaque in here: see Kind.deep
  Near?: Kind['Near'] // drawn for the root only
  nearMin?: number // and only once the root spans this fraction of the view
  nearMax?: number // hide the Near once the root spans more than this many views
  nearOnPath?: boolean // and only for the one the camera is inside
  info: (r: Region, node: Node) => { title: string; fact?: string }
}

export const rootProps = { depth: 0, x: 0, y: 0, z: 0, s: 1 }
export const regionOf = (n: Node): Region => ({ c: [n.props.x as number, n.props.y as number, n.props.z as number], s: n.props.s as number, depth: n.props.depth as number })
// the top of this volume: regions share their root's kind (cached on the node: asked for every new region)
export const volumeRoot = (n: Node): Node => n.vroot ?? (n.vroot = n.parent && n.parent.kind === n.kind ? volumeRoot(n.parent) : n)

const placed = new WeakMap<Node, ChildSpec[]>()
function placementsOf(v: Volume, n: Node) {
  let p = placed.get(n)
  if (!p) placed.set(n, (p = v.placements!(regionOf(n), mulberry32(hash(n.seed, 0x9a1ce)), n)))
  return p
}

// things placed by the ancestor region that reach into this leaf, in leaf units
export function inclusions(v: Volume, leaf: Node): Inclusion[] {
  if (!v.placeDepth) return []
  const pd = v.placeDepth(volumeRoot(leaf))
  let a: Node | undefined = leaf
  while (a && a.props.depth !== pd) a = a.parent
  if (!a) return []
  const L = regionOf(leaf), A = regionOf(a)
  const out: Inclusion[] = []
  for (const n of childrenOf(a).slice(8)) { // after the octants
    const c = [0, 1, 2].map(i => (A.c[i] + n.pos[i] * A.s - L.c[i]) / L.s) as Vec3
    const s = (n.size * A.s) / L.s
    if (Math.max(Math.abs(c[0]), Math.abs(c[1]), Math.abs(c[2])) - s / 2 > 0.87) continue
    out.push({ node: n, c, s })
  }
  return out
}

// would a sphere (leaf units) overlap the placed thing: its atoms, or its own extent if it is a volume?
export function hitsAtoms(inc: Inclusion, p: Vec3, r: number) {
  const d = Math.hypot(p[0] - inc.c[0], p[1] - inc.c[1], p[2] - inc.c[2])
  const kind = kindOf(inc.node.kind)
  if (kind?.space) return kind.inside ? kind.inside(inc.node, [(p[0] - inc.c[0]) / inc.s, (p[1] - inc.c[1]) / inc.s, (p[2] - inc.c[2]) / inc.s]) : d < 0.5 * inc.s + r
  if (d - r > inc.s / 2) return false
  for (const a of childrenOf(inc.node)) {
    const ar = (a.size / 2) * inc.s
    if (Math.hypot(p[0] - inc.c[0] - a.pos[0] * inc.s, p[1] - inc.c[1] - a.pos[1] * inc.s, p[2] - inc.c[2] - a.pos[2] * inc.s) < ar + r) return true
  }
  return false
}

export function volume(v: Volume): Kind {
  return {
    space: true,
    deep: v.deep,
    inside: v.inside,
    // regions open at PERF.openRegion, leaves at PERF.openLeaf, unless the volume says otherwise
    open: n => { const r = regionOf(n), root = volumeRoot(n); return v.open?.(r, root) ?? (r.depth >= v.leafDepth(root) ? PERF.openLeaf : PERF.openRegion) },
    far: n => v.far(regionOf(n), n),
    Near: v.Near,
    nearFor: n => n.props.depth === 0,
    nearMin: v.nearMin,
    nearMax: v.nearMax,
    nearOnPath: v.nearOnPath,
    info: n => v.info(regionOf(n), n),
    children: (node, rng) => {
      const r = regionOf(node)
      const root = volumeRoot(node)
      if (r.depth < v.leafDepth(root)) {
        const kids: ChildSpec[] = []
        for (const x of [-0.25, 0.25]) for (const y of [-0.25, 0.25]) for (const z of [-0.25, 0.25]) {
          kids.push({ kind: node.kind, pos: [x, y, z], size: 0.5, props: { ...node.props, depth: r.depth + 1, x: r.c[0] + x * r.s, y: r.c[1] + y * r.s, z: r.c[2] + z * r.s, s: r.s / 2 } })
        }
        if (v.placements && r.depth === v.placeDepth?.(root)) kids.push(...placementsOf(v, node))
        return kids
      }
      return v.fill(r, rng, node)
    },
  }
}
