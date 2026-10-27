// Everything with a name, and the way to it. The index is built on first use from the catalogues (the galaxies,
// clusters and voids of the universe, the real stars near the Sun, the bodies of the solar system) and the
// landmarks; each entry is a node key, found by descending the octrees to where the thing is.
import { childrenOf, kindOf, ready, type Node, type Vec3 } from './tree'
import { root } from './camera'
import { CATALOGUE, MW_POS, at, mwPath } from '../kinds/universe'
import { LY, OBJECTS, STARS, SUN_POS, sunPath } from '../kinds/galaxy'
import { EARTH_KEY as EARTH_IN_SOLAR, PLANETS } from '../kinds/solar'
import { PERSON } from '../kinds/earth'
import { Quaternion, Vector3 } from 'three'

export type Entry = { name: string; href: string; what: string }

export const MW_KEY = `u.${mwPath()}`
export const SOLAR_KEY = `${MW_KEY}.${sunPath()}`
export const EARTH_KEY = `${SOLAR_KEY}.${EARTH_IN_SOLAR.slice(2)}`
export const PERSON_KEY = `${EARTH_KEY}.${PERSON.path}`
// a point in the right thigh's muscle, in body units: the figure (2 m cube, hips at the centre) stands along PERSON.up
const MUSCLE = new Vector3(0.135, -0.22, 0).applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...PERSON.up).normalize())).divideScalar(2).toArray().map(v => v.toFixed(4))
export const LANDMARKS: [string, string][] = [
  ['Universe', '#at=u&z=26.95'],
  ['Milky Way', `#at=${MW_KEY}&z=21.2`],
  ['Solar system', `#at=${SOLAR_KEY}&z=13.1`],
  ['The Sun', `#at=${SOLAR_KEY}.8&z=9.3`],
  ['Earth', `#at=${EARTH_KEY}&z=7.25`],
  ['A person', `#at=${PERSON_KEY}&z=0.35`],
  ['A muscle cell', `#at=${PERSON_KEY}&f=${MUSCLE}&z=-4.8`],
  ['Molecules', `#at=${PERSON_KEY}&f=${MUSCLE}&z=-8.4`],
  ['Atoms', `#at=${PERSON_KEY}&f=${MUSCLE}&z=-9.6`],
]

const toChild = (p: Vec3, c: Node): Vec3 => [(p[0] - c.pos[0]) / c.size, (p[1] - c.pos[1]) / c.size, (p[2] - c.pos[2]) / c.size]
const inside = (p: Vec3) => Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) <= 0.5
const region = (n: Node, kind: string) => n.kind === kind && n.props.depth !== undefined

// the node at a key, generating along the way
export function nodeAt(key: string): Node | undefined {
  let node: Node | undefined = root
  for (const i of key.split('.').slice(1).map(Number)) node = node && childrenOf(node)[i]
  return node
}

// descend from `from` through the regions that hold `pos` (in from's units): to the child `want` picks, or, with
// `metres`, to the smallest region at least that big
function descend(from: Node, pos: Vec3, want?: (c: Node) => boolean, metres = 0): Node | undefined {
  let node = from, p = pos
  for (let d = 0; d < 60; d++) {
    const kids = childrenOf(node)
    const hit = want && kids.find(want)
    if (hit) return hit
    const next = kids.find(c => region(c, node.kind) && inside(toChild(p, c)))
    if (!next || (metres && next.metres < metres)) return want ? undefined : node
    p = toChild(p, next)
    node = next
  }
  return undefined
}

const fit = (n: Node, views = 1) => Math.log10(n.metres * views).toFixed(2) // the zoom at which it spans 1/views of the view
const entry = (name: string, n: Node, what: string, views = 1): Entry => ({ name, href: `#at=${n.key}&z=${fit(n, views)}`, what })

let built: Promise<Entry[]> | undefined
export const index = () => (built ??= ready('universe', 'galaxy', 'solar', 'star', 'planet', 'earth').then(build))
function build(): Entry[] {
  const out: Entry[] = LANDMARKS.map(([name, href]) => ({ name, href, what: 'landmark' }))
  // the universe's catalogue: galaxies are placed things; clusters, voids and superclusters are named regions
  for (const c of CATALOGUE) {
    const pos = at(c.ra, c.dec, c.ly)
    if (c.galaxy) { const n = descend(root, pos, k => k.props.name === c.name); if (n) out.push(entry(c.name, n, 'galaxy')) }
    else {
      const radius = ((c.region ?? c.hole ?? 2 * c.boost![0]) * LY)
      const n = descend(root, pos, undefined, radius * 2)
      if (n) out.push(entry(c.name, n, c.hole ? 'void' : c.region ? 'region' : 'cluster of galaxies'))
    }
  }
  const mw = descend(root, MW_POS, k => k.props.name === 'Milky Way')
  if (mw) {
    out.push(entry('Milky Way', mw, 'our galaxy'))
    // the real stars near the Sun, placed in the galaxy's frame
    for (const s of STARS) {
      if (!s[0]) continue
      const pos: Vec3 = [SUN_POS[0] + (s[1] * LY) / mw.metres, SUN_POS[1] + (s[2] * LY) / mw.metres, SUN_POS[2] + (s[3] * LY) / mw.metres]
      const n = descend(mw, pos, k => k.kind === 'star' && k.props.name === s[0])
      if (n) out.push(entry(s[0], n, `${s[8]} star, ${s[7]} light-years away`, 1.8)) // inside its node, so the HUD names it
    }
    // the galaxy's own catalogue: black holes, pulsars and nebulae are placed things; clusters and arms are named regions
    for (const o of OBJECTS) {
      const n = o.placed ? descend(mw, o.pos, k => k.props.name === o.name) : descend(mw, o.pos, undefined, o.radius * 2)
      if (n) out.push(entry(o.name, n, o.what, o.placed ? 1.5 : 1))
    }
  }
  const solar = nodeAt(SOLAR_KEY)
  if (solar) for (const c of childrenOf(solar).slice(8)) {
    const title = kindOf(c.kind)?.info(c).title ?? (c.kind === 'planet' ? PLANETS[c.props.p as number].name : c.kind === 'earth' ? 'Earth' : (c.props.name as string))
    if (title && !out.some(e => e.name === title)) out.push(entry(title, c, c.kind === 'star' ? 'our star' : c.kind === 'earth' ? 'our planet' : PLANETS[c.props.p as number]?.what ?? 'planet', 1.5))
  }
  return out
}

// the first entry whose name matches, exactly first, else by prefix, else anywhere
export async function lookup(text: string): Promise<Entry | undefined> {
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  const all = await index()
  return all.find(e => e.name.toLowerCase() === t) ?? all.find(e => e.name.toLowerCase().startsWith(t)) ?? all.find(e => e.name.toLowerCase().includes(t))
}

if (import.meta.env.DEV) Object.assign(window, { __search: { index, lookup, nodeAt } })
