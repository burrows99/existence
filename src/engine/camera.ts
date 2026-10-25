import { create } from 'zustand'
import { MathUtils } from 'three'
import { ancestry, childrenOf, kindOf, type Node, type Vec3 } from './tree'

// The camera lives *inside* a node: focus is a point in that node's units, zoom = log10(metres across the view).
// As you zoom we re-root into the child under the focus (or back out to the parent), so numbers stay small forever.
type Cam = {
  node: Node
  focus: Vec3
  anchor: Vec3 | null // point (node units) that stays put on screen while zooming: whatever is under the cursor
  goal: string | null // key of the node under the cursor, so re-rooting follows the path to it
  zoom: number
  target: number
  pending?: { key: string; focus: Vec3; zoom: number } // location from the URL, applied once its kinds load
  zoomAt: (decades: number, anchor: Vec3 | null, goal: string | null) => void
  zoomTo: (zoom: number) => void
}

export const MIN_ZOOM = -19 // one decade below the smallest scale anything has been found at

// a 100 AU cube holding the solar system (see kinds/solar.tsx)
export const root: Node = { key: 's', kind: 'solar', seed: 1, props: { depth: 0, x: 0, y: 0, z: 0, s: 1 }, pos: [0, 0, 0], size: 1, metres: 1.496e13 }
export const maxZoom = () => Math.log10(root.metres * 3)

// #at=<node key>&f=<focus>&z=<zoom> is a complete location; #z=<zoom> alone keeps the default spot
function parseHash(): NonNullable<Cam['pending']> {
  const h = new URLSearchParams(location.hash.slice(1))
  return {
    key: h.get('at') ?? root.key,
    focus: (h.get('f') ?? '0,0,0').split(',').map(Number) as Vec3,
    zoom: MathUtils.clamp(Number(h.get('z') ?? 13.1), MIN_ZOOM, maxZoom()),
  }
}

export const useCam = create<Cam>((set, get) => ({
  node: root,
  focus: [0, 0, 0],
  anchor: null,
  goal: null,
  zoom: -8.6,
  target: -8.6,
  pending: parseHash(),
  zoomAt: (decades, anchor, goal) => set({ target: MathUtils.clamp(get().target + decades, MIN_ZOOM, maxZoom()), anchor, goal }),
  zoomTo: zoom => set({ target: MathUtils.clamp(zoom, MIN_ZOOM, maxZoom()), anchor: null, goal: null }),
}))

if (import.meta.env.DEV) Object.assign(window, { __cam: useCam })
window.addEventListener('hashchange', () => useCam.setState({ pending: parseHash() }))

const toChild = (p: Vec3, c: Node): Vec3 => [(p[0] - c.pos[0]) / c.size, (p[1] - c.pos[1]) / c.size, (p[2] - c.pos[2]) / c.size]
const toParent = (p: Vec3, c: Node): Vec3 => [c.pos[0] + p[0] * c.size, c.pos[1] + p[1] * c.size, c.pos[2] + p[2] * c.size]

function restore({ key, focus, zoom }: NonNullable<Cam['pending']>) {
  let node = root
  for (const i of key.split('.').slice(1).map(Number)) {
    const c = childrenOf(node)[i]
    if (!c) {
      if (kindOf(node.kind)) useCam.setState({ pending: undefined }) // loaded but no such child: bad link, give up
      return
    }
    node = c
  }
  useCam.setState({ node, focus, zoom, target: zoom, anchor: null, goal: null, pending: undefined })
}

// centre of node n expressed in `frame`'s units, for any two nodes in the tree
export function centreIn(n: Node, frame: Node): Vec3 {
  const up = ancestry(n), down = ancestry(frame)
  let i = 0
  while (i < up.length && i < down.length && up[i].key === down[i].key) i++
  let p: Vec3 = [0, 0, 0]
  for (let j = up.length - 1; j >= i; j--) p = toParent(p, up[j])
  for (let j = i; j < down.length; j++) p = toChild(p, down[j])
  return p
}

const contains = (c: Node, p: Vec3) => Math.max(Math.abs(p[0] - c.pos[0]), Math.abs(p[1] - c.pos[1]), Math.abs(p[2] - c.pos[2])) / c.size
const under = (goal: string, key: string) => goal === key || goal.startsWith(key + '.')

// one frame of camera motion: ease zoom around the anchor, then re-root
export function stepCamera(dt: number) {
  const s = useCam.getState()
  if (s.pending) return restore(s.pending)
  let { node, focus, anchor, zoom } = s
  const { goal } = s

  if (Math.abs(s.target - zoom) > 1e-5) {
    const next = MathUtils.damp(zoom, s.target, 6, dt)
    const f = 10 ** (next - zoom)
    if (anchor) focus = [0, 1, 2].map(i => anchor![i] + (focus[i] - anchor![i]) * f) as Vec3
    zoom = next
  }

  for (let guard = 0; guard < 64; guard++) {
    const w = 10 ** zoom / node.metres // view height in node units
    const outside = Math.max(Math.abs(focus[0]), Math.abs(focus[1]), Math.abs(focus[2])) > 0.55
    if (node.parent && (w > 2 || outside || (goal && !under(goal, node.key)))) {
      focus = toParent(focus, node)
      anchor = anchor && toParent(anchor, node)
      node = node.parent
      continue
    }
    // descend once the child spans most of the view and holds the focus: along the path to the goal if there is
    // one, else into the nearest centre (bounding cubes overlap, e.g. bonded atoms)
    let best: Node | undefined, bestD = 0.5 // a focus exactly on a seam belongs to the first child that reaches it
    if (goal && goal !== node.key) {
      const c = childrenOf(node)[Number(goal.slice(node.key.length + 1).split('.')[0])]
      if (c && c.size > 0.6 * w && contains(c, focus) <= 0.5) best = c
    } else {
      // a thing (a cell, a molecule) beats a mere region of space that also holds the focus
      let bestThing = false
      for (const c of childrenOf(node)) {
        if (c.size < 0.6 * w) continue
        const d = contains(c, focus)
        if (d > 0.5) continue
        const thing = !kindOf(c.kind)?.space
        if ((thing && !bestThing) || (thing === bestThing && (d < bestD || !best))) { best = c; bestD = d; bestThing = thing }
      }
    }
    if (!best) break
    focus = toChild(focus, best)
    anchor = anchor && toChild(anchor, best)
    node = best
  }

  // lock on: once inside the thing that was scrolled into, glide its centre to the middle of the view
  if (goal === node.key && (focus[0] || focus[1] || focus[2])) {
    const keep = Math.exp(-5 * dt)
    focus = Math.hypot(...focus) < 1e-7 ? [0, 0, 0] : [focus[0] * keep, focus[1] * keep, focus[2] * keep]
    anchor = [0, 0, 0]
  }

  if (node !== s.node || zoom !== s.zoom || focus !== s.focus) useCam.setState({ node, focus, anchor, zoom })
}
