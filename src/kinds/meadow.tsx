// A meadow in the Galápagos where creatures evolve (the simulation is kinds/life.ts). Each creature and each tuft of
// grass is a node made of tissue, the tissue of cells, the cells of molecules, as everywhere else; the meadow moves
// its creatures' nodes as they live, and draws their eyes and life bars over them. Time runs while you watch the
// meadow and stands still when you zoom inside one of its creatures.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three'
import { childrenOf, hash, mulberry32, type ChildSpec, type Far, type Kind, type Node, type Vec3 } from '../engine/tree'
import { useCam } from '../engine/camera'
import { PERF } from '../engine/perf'
import { rootProps, volume, volumeRoot, type Volume } from './volume'
import { fillAir, fillWater } from './matter'
import { TYPES, cubeOf } from './cell'
import { ARENA, HID, IN, OUT, PLANT_D, SLOTS, WEIGHTS, advance, createSim, emax, lifespan, mass, stats, type Sim } from './life'

const BODY = 0.45 // a creature's (or tuft's) radius, as a fraction of its cube

// ---- the simulation, kept by meadow (it outlives the meadow's nodes, which are regenerated after you leave) ----
const sims = new Map<string, Sim>()
export const simOf = (n: Node) => { let s = sims.get(n.key); if (!s) sims.set(n.key, (s = createSim(hash(n.seed, 0x11fe)))); return s }

const hex = (c: Color) => `#${c.getHexString()}`
const creatureColor = (hue: number) => hex(new Color().setHSL(hue, 0.6, 0.55))
const GRASS = [new Color('#8a7a4a'), new Color('#4caf50')]
const grassColor = (level: number) => hex(GRASS[0].clone().lerp(GRASS[1], level / 4))

// a slot's creature as a node: its cube, centred on the body resting on the ground (the meadow's z = 0 plane)
function creatureSpec(s: Sim, i: number, M: number): ChildSpec {
  const c = s.cs[i]
  if (!c?.alive) return { kind: 'organism', pos: [0, 0, 0], size: 1e-3, props: { ...rootProps, o: 'creature', id: 0, dead: 1 } }
  return { kind: 'organism', pos: [c.x / M, c.y / M, c.g.L / 2 / M], size: c.g.L / (2 * BODY) / M, props: { ...rootProps, o: 'creature', id: c.id, hue: c.g.hue } }
}

// after a step: move the creatures' nodes, and give a slot whose creature changed a fresh node's worth of contents. A
// creature that dies keeps its node where it fell (id negated, nothing in it), so whoever was looking at it sees why
function sync(meadow: Node, s: Sim) {
  const kids = meadow.children
  if (!kids) return
  const M = meadow.metres
  for (let i = 0; i < SLOTS; i++) {
    const n = kids[i], c = s.cs[i], id = c ? (c.alive ? c.id : -c.id) : 0
    if (n.props.id === id) { if (c?.alive) n.pos = [c.x / M, c.y / M, c.g.L / 2 / M]; continue }
    Object.assign(n, { seed: hash(meadow.seed, 0x5eed + Math.abs(id)), children: undefined, far: undefined, open: undefined })
    if (id < 0) { n.props = { ...n.props, id, dead: 1 }; continue }
    const spec = creatureSpec(s, i, M)
    Object.assign(n, { props: spec.props, pos: spec.pos, size: spec.size, metres: M * spec.size })
  }
  s.ps.forEach((p, j) => {
    const n = kids[SLOTS + j], level = Math.round(p.food * 4)
    if (n.props.f !== level) { n.props.f = level; n.far = undefined }
  })
}

// ---- eyes and life bars, over the creatures' bodies ----
function Meadow({ node }: { node: Node }) {
  const sim = simOf(node)
  const eyes = useRef<InstancedMesh>(null), pupils = useRef<InstancedMesh>(null), bars = useRef<InstancedMesh>(null), fills = useRef<InstancedMesh>(null)
  const tmp = useMemo(() => ({ m: new Matrix4(), p: new Vector3(), q: new Quaternion(), s: new Vector3(), r: new Vector3(), c: new Color() }), [])
  const ring = useMemo(() => {
    const pts: number[] = []
    for (let i = 0; i <= 128; i++) pts.push((ARENA / node.metres) * Math.cos((i / 64) * Math.PI), (ARENA / node.metres) * Math.sin((i / 64) * Math.PI), 0.002)
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3))
  }, [node])

  // before the world is walked (priority −1), so the bodies drawn this frame are where the eyes are
  useFrame(({ camera }, dt) => {
    const cam = useCam.getState().node
    let a: Node | undefined = cam
    while (a && a.parent !== node) a = a.parent
    sim.hold = a && a.index! < SLOTS ? a.index! : -1
    advance(sim, Math.min(dt, 0.1))
    childrenOf(node)
    sync(node, sim)
    const M = node.metres, { m, p, q, s, r, c } = tmp
    const right = r.set(1, 0, 0).applyQuaternion(camera.quaternion)
    const hide = m.makeScale(0, 0, 0).clone()
    for (let i = 0; i < SLOTS; i++) {
      const k = sim.cs[i]
      if (!k?.alive) {
        for (const ref of [eyes, pupils]) { ref.current!.setMatrixAt(2 * i, hide); ref.current!.setMatrixAt(2 * i + 1, hide) }
        bars.current!.setMatrixAt(i, hide); fills.current!.setMatrixAt(i, hide)
        continue
      }
      const R = k.g.L / 2 / M, x = k.x / M, y = k.y / M, z = R
      for (const side of [-1, 1]) { // two eyes on the front, a little apart and up, pupils looking where it goes
        const t = k.a + side * 0.45
        p.set(x + Math.cos(t) * 0.82 * R, y + Math.sin(t) * 0.82 * R, z + 0.5 * R)
        eyes.current!.setMatrixAt(2 * i + (side + 1) / 2, m.compose(p, q.identity(), s.setScalar(0.28 * R)))
        p.x += Math.cos(k.a) * 0.17 * R; p.y += Math.sin(k.a) * 0.17 * R
        pupils.current!.setMatrixAt(2 * i + (side + 1) / 2, m.compose(p, q, s.setScalar(0.15 * R)))
      }
      // the life bar: energy as a fraction of what the body can store, facing the camera
      const w = Math.max(2 * R, 0.08 / M), h = w * 0.13, f = Math.max(0, k.e / emax(k.g.L))
      p.set(x, y, 2 * R + 0.25 * w)
      bars.current!.setMatrixAt(i, m.compose(p, camera.quaternion, s.set(w * 1.06, h * 1.6, 1)))
      p.addScaledVector(right, (-(1 - f) * w) / 2)
      fills.current!.setMatrixAt(i, m.compose(p, camera.quaternion, s.set(Math.max(1e-4, w * f), h, 1)))
      fills.current!.setColorAt(i, c.setHSL(0.33 * f, 0.9, 0.5))
    }
    for (const ref of [eyes, pupils, bars, fills]) ref.current!.instanceMatrix.needsUpdate = true
    if (fills.current!.instanceColor) fills.current!.instanceColor.needsUpdate = true
  }, -1)

  return (
    <group>
      <lineLoop geometry={ring}><lineBasicMaterial color="#c8f0a0" transparent opacity={0.25} /></lineLoop>
      <instancedMesh ref={eyes} args={[undefined, undefined, 2 * SLOTS]} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color="#ffffff" />
      </instancedMesh>
      <instancedMesh ref={pupils} args={[undefined, undefined, 2 * SLOTS]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 6]} /><meshBasicMaterial color="#111111" />
      </instancedMesh>
      <instancedMesh ref={bars} args={[undefined, undefined, SLOTS]} frustumCulled={false} renderOrder={3}>
        <planeGeometry /><meshBasicMaterial color="#000000" transparent opacity={0.55} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={fills} args={[undefined, undefined, SLOTS]} frustumCulled={false} renderOrder={4}>
        <planeGeometry /><meshBasicMaterial toneMapped={false} transparent depthWrite={false} />
      </instancedMesh>
    </group>
  )
}

const meadow: Kind = {
  space: true,
  slab: [1.5, 1.5], // open ground: the rock under it is not cut away
  version: n => simOf(n).tick,
  Near: Meadow,
  nearMax: 400, // closer than 2 cm you are inside a creature: time stands still there
  far: () => null,
  children: n => {
    const s = simOf(n), M = n.metres
    const out: ChildSpec[] = []
    for (let i = 0; i < SLOTS; i++) out.push(creatureSpec(s, i, M))
    s.ps.forEach((p, j) => out.push({ kind: 'organism', pos: [p.x / M, p.y / M, PLANT_D / 2 / M], size: PLANT_D / (2 * BODY) / M, props: { ...rootProps, o: 'plant', id: j, f: Math.round(p.food * 4) } }))
    return out
  },
  info: n => {
    const st = stats(simOf(n))
    return {
      title: 'Meadow',
      fact: `Santa Cruz, Galápagos, where Darwin's finches helped make the case for natural selection. ${st.alive} creatures alive, up to generation ${st.gen}, ${Math.round(st.size * 100)} cm across on average; ${st.born.toLocaleString()} born and ${(st.died.starved + st.died.eaten + st.died['old age']).toLocaleString()} dead (${st.died.starved} starved, ${st.died.eaten} eaten, ${st.died['old age']} of old age) in ${Math.round(st.t / 60)} simulated minutes. Each is steered by its own small neural network; the only reward is food, and only the well fed breed.`,
    }
  },
}

// ---- a creature or a tuft of grass: a ball of tissue, every tissue packed with cells of its kind ----
type Tissue = 'air' | 'skin' | 'fat' | 'muscle' | 'brain' | 'grass'
type TissueSpec = { cell: number; keep: number; color: string; name: string; fact: string }
const TISSUE: Record<Tissue, TissueSpec> = {
  air: { cell: -1, keep: 0, color: '', name: 'Air', fact: 'Nitrogen and oxygen molecules, a thousand times sparser than the water in a body.' },
  skin: { cell: 1, keep: 1, color: '#d9a37a', name: 'Skin', fact: 'Layers of keratinocytes, dividing at the bottom and flattened at the top.' },
  fat: { cell: 2, keep: 1, color: '#f0d070', name: 'Fat', fact: 'Adipocytes: in the simulation this creature’s energy store, the life bar above it.' },
  muscle: { cell: 0, keep: 1, color: '#b03030', name: 'Muscle', fact: 'What moves it: in the simulation, running costs energy in proportion to its mass and the square of its speed.' },
  brain: { cell: 4, keep: 0.5, color: '#e6b8c8', name: 'Brain', fact: `Nervous tissue, drawn as neurons at the real density. The network steering this creature is ${IN} senses (food, the nearest creature and its size, its own energy, the edge of the meadow) wired to ${HID} hidden neurons and ${OUT} outputs (turn, run): ${WEIGHTS} weights, inherited from its parent with small mutations.` },
  grass: { cell: 9, keep: 1, color: '#4caf50', name: 'Grass', fact: 'Blades of grass, drawn as a tuft of grass cells. Grazed, it grows back.' },
}

const isPlant = (root: Node) => root.props.o === 'plant'
function tissueAt(root: Node, p: Vec3): Tissue { // p in root units
  const x = Math.hypot(p[0], p[1], p[2]) / BODY
  if (x > 1) return 'air'
  if (isPlant(root)) return 'grass'
  const skin = 2e-3 / (BODY * root.metres) // 2 mm of skin and 4 mm of fat, at most a fifth of the radius between them
  return x > 1 - Math.min(0.07, skin) ? 'skin' : x > 1 - Math.min(0.2, 3 * skin) ? 'fat' : x > 0.3 ? 'muscle' : 'brain'
}
const leafOf = (root: Node) => Math.max(1, Math.round(Math.log2(root.metres / 1.86e-9)))
const placeOf = (root: Node) => leafOf(root) - 15 // regions of about 60 µm place cells

const organism: Volume = {
  leafDepth: leafOf,
  placeDepth: placeOf,
  open: (r, root) => (r.depth === placeOf(root) ? PERF.openPlace : undefined),
  inside: (_, p) => Math.hypot(p[0], p[1], p[2]) < BODY,

  // cells of the local tissue, packed on a jittered grid
  placements: (r, rng, node) => {
    const root = volumeRoot(node), T = TISSUE[tissueAt(root, r.c)]
    if (T.cell < 0) return []
    const d = TYPES[T.cell].d * 1e-6, side = r.s * root.metres
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

  // between the cells water; outside the body air
  // ponytail: the ground's own air is not cleared where a creature stands (it moves); the two overlap
  fill: (r, rng, leaf) => {
    const root = volumeRoot(leaf), side = r.s * root.metres
    return tissueAt(root, r.c) === 'air' ? fillAir(side, rng, () => false) : fillWater(side, rng, () => false, 0.15)
  },

  far: (r, node) => {
    const root = volumeRoot(node)
    if (root.props.dead) return null
    if (r.depth === 0) return { shape: 'sphere', color: isPlant(root) ? grassColor(root.props.f as number) : creatureColor(root.props.hue as number), scale: 2 * BODY }
    const T = TISSUE[tissueAt(root, r.c)]
    if (!T.color) return null
    const side = r.s * root.metres
    if (side > 4e-3) return { shape: 'haze', color: T.color } // coarser than 4 mm: a tint
    const place = placeOf(root)
    if (r.depth > place) return null // its cells are drawn by the open parent
    const color = TYPES[T.cell].color
    if (r.depth === place) return childrenOf(node).slice(8, 32).map(c => ({ shape: 'sphere' as const, color, scale: c.size / 1.2, pos: c.pos }))
    // above it: a couple of dozen cells thrown in at random stand in for all of them
    const rng = mulberry32(hash(node.seed, 0x5a3))
    const d = (TYPES[T.cell].d * 1e-6) / side
    const n = Math.min(24, Math.round(T.keep / d ** 3))
    const out: Far[] = []
    for (let i = 0; i < n; i++) out.push({ shape: 'sphere', color, scale: d, pos: [0, 1, 2].map(() => rng() - 0.5) as Vec3 })
    return out
  },

  info: (r, node) => {
    const root = volumeRoot(node)
    if (r.depth >= 3) { const T = TISSUE[tissueAt(root, r.c)]; return { title: T.name, fact: T.fact } }
    const s = root.parent && simOf(root.parent)
    if (isPlant(root)) {
      const p = s?.ps[root.props.id as number]
      return { title: 'Grass', fact: `A tuft of grass, ${Math.round((p?.food ?? 1) * 100)}% grown. Creatures graze it; it grows back in about half a minute. Every blade is grass cells, every cell molecules.` }
    }
    const c = s?.cs[root.index!]
    if (c && !c.alive && -c.id === root.props.id) return { title: `Creature ${c.id}, dead`, fact: `It ${c.cause === 'eaten' ? 'was eaten by a bigger creature' : c.cause === 'starved' ? 'starved: its brain did not find food fast enough' : 'died of old age'}, at ${Math.round(c.age)} seconds old, generation ${c.gen}, leaving ${c.kids === 1 ? 'one offspring' : `${c.kids} offspring`}. Its body is gone; the next creature born takes its place once you look away.` }
    if (!c || c.id !== root.props.id) return { title: 'Nothing', fact: 'A creature was here. Its place waits for the next one born.' }
    const kids = c.kids === 1 ? 'one offspring' : `${c.kids} offspring`
    return {
      title: `Creature ${c.id}`,
      fact: `Generation ${c.gen}, ${(c.g.L * 100).toFixed(1)} cm across and ${mass(c.g.L) < 1 ? `${Math.round(mass(c.g.L) * 1000)} g` : `${mass(c.g.L).toFixed(1)} kg`}. Energy ${Math.round((100 * c.e) / emax(c.g.L))}% (the bar above it), ${Math.round(c.age)} of about ${Math.round(lifespan(c.g.L))} seconds lived. It has grazed ${c.plants.toFixed(1)} tufts, eaten ${c.prey} creatures and had ${kids}. Right now its brain says turn ${c.turn > 0 ? 'left' : 'right'} ${Math.round(Math.abs(c.turn) * 100)}%, run ${Math.round(((c.thrust + 1) / 2) * 100)}%.`,
    }
  },
}

const organismVolume = volume(organism)
export const kinds = {
  meadow,
  organism: { ...organismVolume, children: (n, rng) => (n.props.dead ? [] : organismVolume.children!(n, rng)) } as Kind,
}
