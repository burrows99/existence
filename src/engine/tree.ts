import type { ComponentType } from 'react'
import { Quaternion } from 'three'

export type Vec3 = [number, number, number]
export type Props = Record<string, number | string>

// A thing in existence. Frames are axis-aligned: a child is an offset + uniform scale inside its parent.
export type Node = {
  key: string // child indices from the root, so it doubles as a URL
  kind: string
  seed: number
  props: Props
  parent?: Node
  pos: Vec3 // centre, in parent units (parent diameter = 1)
  size: number // diameter, in parent units
  metres: number // diameter, in metres
  children?: Node[]
  far?: Far
  seen?: number // last frame this node was drawn; stale subtrees get evicted
}

export type ChildSpec = { kind: string; pos: Vec3; size: number; props?: Props }

export type Far = {
  shape: 'sphere' | 'box'
  color: string
  glow?: boolean // pushed past 1 so Bloom catches it
  minPx?: number // point-like: never drawn smaller than this
}

export type Kind = {
  // deterministic in node.seed: the same node always regenerates the same contents
  children?: (node: Node, rng: () => number) => ChildSpec[]
  far: (node: Node) => Far
  Near?: ComponentType<{ node: Node }> // detail drawn in node units while the node is open
  open?: number // fraction of the view height a node must span to open into its children (default 0.3)
  near?: number // same, for Near (default: open)
  jitter?: number // thermal / confinement motion amplitude, metres
  info: (node: Node) => { title: string; fact?: string }
}

// ---- seeded randomness -------------------------------------------------------

export function hash(a: number, b: number) {
  let h = Math.imul(a ^ (b + 0x9e3779b9), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// uniformly random orientation (Shoemake)
export function randomRotation(rng: () => number) {
  const [u1, u2, u3] = [rng(), rng(), rng()]
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1)
  return new Quaternion(a * Math.sin(2 * Math.PI * u2), a * Math.cos(2 * Math.PI * u2), b * Math.sin(2 * Math.PI * u3), b * Math.cos(2 * Math.PI * u3))
}

// ---- lazily loaded kinds -----------------------------------------------------

const matter = () => import('../kinds/matter')
const atom = () => import('../kinds/atom')
const LOADERS: Record<string, () => Promise<{ kinds: Record<string, Kind> }>> = {
  water: matter, h2o: matter,
  molecule: () => import('../kinds/molecule'),
  atom, electron: atom, nucleus: atom, nucleon: atom, quark: atom,
}

const kinds: Record<string, Kind> = {}
const loading = new Set<string>()
const listeners = new Set<() => void>()
let loaded = 0

export function kindOf(id: string): Kind | undefined {
  if (!kinds[id] && !loading.has(id)) {
    loading.add(id)
    LOADERS[id]().then(m => {
      Object.assign(kinds, m.kinds)
      loaded++
      listeners.forEach(cb => cb())
    })
  }
  return kinds[id]
}

// for React: re-render when a kind module arrives
export const subscribeKinds = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb))
export const kindsLoaded = () => loaded

export function childrenOf(node: Node): Node[] {
  if (node.children) return node.children
  const kind = kindOf(node.kind)
  if (!kind) return [] // not loaded yet; try again next frame
  node.children = (kind.children?.(node, mulberry32(node.seed)) ?? []).map((c, i) => ({
    key: `${node.key}.${i}`,
    kind: c.kind,
    seed: hash(node.seed, i),
    props: c.props ?? {},
    parent: node,
    pos: c.pos,
    size: c.size,
    metres: node.metres * c.size,
  }))
  return node.children
}

// drop generated subtrees nobody has looked at lately; they come back identical when needed
export function evict(node: Node, before: number) {
  if (!node.children) return
  if ((node.seen ?? 0) < before) node.children = undefined
  else for (const c of node.children) evict(c, before)
}

export const ancestry = (node: Node) => {
  const out: Node[] = []
  for (let n: Node | undefined = node; n; n = n.parent) out.unshift(n)
  return out
}
