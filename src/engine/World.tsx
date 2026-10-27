// Draws the tree like a chunked world engine: every open node caches a "chunk" (the drawable items of its closed
// children, in its own units) which is rebuilt only when which of its children are open changes. Per frame the CPU
// walks open nodes only (and not at all while the view stands still) and uploads one transform per chunk; the GPU
// places, jitters, cuts away and sizes every instance, and spheres are ray-cast impostors (two triangles each).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, DataTexture, DynamicDrawUsage, FloatType, GLSL3, InstancedBufferGeometry,
  InstancedInterleavedBuffer, InterleavedBuffer, InterleavedBufferAttribute, MathUtils, Mesh, NearestFilter, PlaneGeometry,
  Points, RGBAFormat, ShaderMaterial, Vector3, type Group,
} from 'three'
import { ancestry, childrenOf, evict, kindOf, kindsLoaded, type Far, type Kind, type Node, type Vec3 } from './tree'
import { centreIn, root, stepCamera, useCam } from './camera'
import { PERF } from './perf'

export const CAMERA_DISTANCE = 10
export const FOV = 50
const VIEW = 2 * CAMERA_DISTANCE * Math.tan(MathUtils.degToRad(FOV / 2)) // scene units across the view height
type Batch = 'sphere' | 'haze' | 'cube' | 'box' | 'point'
const BATCHES: Batch[] = ['sphere', 'haze', 'cube', 'box', 'point']
const TEX_W = 128 // chunk transform texture: one texel (offset.xyz, scale) per chunk
const MAX_CHUNKS = TEX_W * TEX_W
const STRIDE = 14 // floats per item: pos3 size1 color3 misc4 (minPx, jitter, phase, flags) rank2 chunk1

// open: the children that were open when it was built (the walk follows them again while a rebuild has to wait);
// lo..hi: the node spans for which that partition still holds, so most frames need not look at the children at all;
// at/slot: where it sits in the GPU buffers and the chunk texture while resident (-1 while not)
type Chunk = {
  sig: string; kids: Node[]; open: Node[]; lo: number; hi: number
  data: Record<Batch, Float32Array>; count: Record<Batch, number>; owners: Partial<Record<Batch, (Node | null)[]>>
  at: Record<Batch, number>; slot: number; used: number
}
type Visible = { n: Node; rx: number; ry: number; rz: number; s: number; chunk: Chunk } // r: its centre from the focus, in top units
// spot: the nearest drawn item of any kind, a sample included (a star in a far galaxy is a sample until its leaf opens)
type Pick = { solid?: Node; solidZ: number; open?: Node; openR: number; near?: Node; nearD: number; spot?: Vec3; spotD: number }
const chunks = new WeakMap<Node, Chunk>()
const buildCost = new Map<string, number>() // ms a chunk of each kind has taken to build lately, to budget before opening one

// GPU residency, the way a chunked world engine keeps terrain on the GPU: each batch's buffer is an arena of item
// ranges, a resident chunk owns one range per batch it has items in plus one texel of the chunk texture, and only
// chunks that just became resident are uploaded. Everything else sits where it is; the GPU skips what is not on
// screen this frame (its texel is zero). Ranges come back when a chunk is rebuilt, or swept once nobody wants it.
type Arena = { free: [number, number][]; high: number } // free ranges [start, end) in items, sorted; items used so far
const arenas = Object.fromEntries(BATCHES.map(b => [b, { free: [], high: 0 }])) as unknown as Record<Batch, Arena>
const freeSlots: number[] = []
let nextSlot = 0
const resident = new Set<Chunk>()
function alloc(a: Arena, n: number, cap: number) { // first fit, else the top; -1 when full
  for (let i = 0; i < a.free.length; i++) {
    const r = a.free[i]
    if (r[1] - r[0] < n) continue
    const s = r[0]
    if (r[1] - r[0] === n) a.free.splice(i, 1); else r[0] += n
    return s
  }
  if (a.high + n > cap) return -1
  return (a.high += n) - n
}
function release(a: Arena, s: number, n: number) { // insert in order (binary search) and coalesce
  const f = a.free, e = s + n
  let lo = 0, hi = f.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (f[m][0] < s) lo = m + 1; else hi = m }
  const i = lo
  f.splice(i, 0, [s, e])
  if (i + 1 < f.length && f[i + 1][0] === e) { f[i][1] = f[i + 1][1]; f.splice(i + 1, 1) }
  if (i > 0 && f[i - 1][1] === f[i][0]) { f[i - 1][1] = f[i][1]; f.splice(i, 1) }
  if (f.length && f[f.length - 1][1] === a.high) a.high = f.pop()![0]
}
function drop(c: Chunk) {
  if (c.slot < 0) return
  for (const b of BATCHES) if (c.at[b] >= 0) { release(arenas[b], c.at[b], c.count[b]); c.at[b] = -1 }
  freeSlots.push(c.slot)
  c.slot = -1
  resident.delete(c)
}
// give back chunks last wanted before `before`, at most `limit` of them (thousands at once would be a long frame;
// the rest go next time), oldest first
function sweep(before: number, limit: number) {
  let n = 0
  for (const c of resident) if (c.used < before && (drop(c), ++n >= limit)) break
  return n
}

// point: never cut away (a star behind the focus is still a star); blob: a node's stand-in, drawn only while its detail
// is not; flash: an event, a brief burst now and then and nothing between
const FLAG_GLOW = 1, FLAG_POINT = 2, FLAG_BLOB = 4, FLAG_FLASH = 8

// ---- shaders -----------------------------------------------------------------------------------------------

const CHUNK_GLSL = /* glsl */ `
  in vec3 iPos; in float iSize; in vec3 iColor; in vec4 iMisc; in vec2 iRank; in float iChunk;
  uniform sampler2D chunks; uniform float time, front, depth, fovScale; uniform vec3 back;
  // the item's centre in scene units, or culled
  bool place(out vec3 w, out float r) {
    int ci = int(iChunk + 0.5);
    vec4 t = texelFetch(chunks, ivec2(ci % ${TEX_W}, ci / ${TEX_W}), 0);
    if (t.w == 0.0) return false; // its chunk is not on screen this frame
    // how much of this item's node is wanted: (its span / the span it is complete at)³, so samples thin out as a
    // node shrinks and a node's detail (rank 1) appears, replacing its blob, once the node is big enough
    float frac = pow(min(1.0, t.w / ${VIEW.toFixed(6)} * iRank.y), 3.0);
    bool blob = mod(iMisc.w, 8.0) >= 4.0;
    if (blob ? frac >= 1.0 : iRank.x > frac + 0.001) return false;
    vec3 p = iPos;
    if (iMisc.y > 0.0) p += iMisc.y * vec3(sin(time * 3.1 + iMisc.z), sin(time * 2.7 + iMisc.z * 1.37), sin(time * 3.7 + iMisc.z * 0.71));
    w = t.xyz + p * t.w;
    r = 0.5 * iSize * t.w;
    bool pointLike = mod(iMisc.w, 4.0) >= 2.0;
    float z = dot(w, back);
    return pointLike || (z <= front && z >= -depth);
  }
`
const SPHERE_VERT = CHUNK_GLSL + /* glsl */ `
  out vec2 vCorner; out vec3 vColor; out float vR; out vec3 vCenter; out float vFlags;
  void main() {
    vec3 w; float r;
    if (!place(w, r)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 color = iColor;
    if (iMisc.w >= 8.0) { // a flash: a burst every few seconds at its own phase, nothing between
      float pulse = pow(max(0.0, sin(time * 1.3 + iMisc.z * 9.0)), 40.0);
      if (pulse < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      r *= 1.0 + 6.0 * pulse;
      color *= 1.0 + 4.0 * pulse;
    }
    vec4 vp = modelViewMatrix * vec4(w, 1.0);
    r = max(r, 0.5 * iMisc.x * max(0.001, -vp.z) / fovScale); // never smaller than minPx pixels
    vCorner = position.xy; vColor = color; vR = r; vCenter = vp.xyz; vFlags = iMisc.w;
    vp.xy += position.xy * r * 1.05;
    gl_Position = projectionMatrix * vp;
  }
`
const SPHERE_FRAG = /* glsl */ `
  precision highp float;
  uniform mat4 proj; uniform vec3 light; uniform float hazeAlpha;
  in vec2 vCorner; in vec3 vColor; in float vR; in vec3 vCenter; in float vFlags;
  out vec4 fragColor;
  void main() {
    vec2 c = vCorner * 1.05;
    float d2 = dot(c, c);
    if (d2 > 1.0) discard;
    if (hazeAlpha > 0.0) { fragColor = vec4(vColor * hazeAlpha * exp(-3.0 * d2), 1.0); return; }
    vec3 n = vec3(c, sqrt(1.0 - d2));
    bool glow = mod(vFlags, 2.0) >= 1.0;
    vec3 col = glow ? vColor * 2.5
      : vColor * (0.28 + 0.8 * max(dot(n, light), 0.0)) + vec3(0.22) * pow(max(dot(reflect(-light, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
    vec4 clip = proj * vec4(vCenter + n * vR, 1.0);
    gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
    fragColor = vec4(col, 1.0);
  }
`
const BOX_VERT = CHUNK_GLSL + /* glsl */ `
  out vec3 vN; out vec3 vColor;
  void main() {
    vec3 w; float r;
    if (!place(w, r)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vN = normalize(normalMatrix * normal); vColor = iColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(w + position * 2.0 * r, 1.0);
  }
`
const BOX_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 light; uniform float alpha;
  in vec3 vN; in vec3 vColor;
  out vec4 fragColor;
  void main() { fragColor = vec4(vColor * (0.35 + 0.65 * max(dot(normalize(vN), light), 0.0)), alpha); }
`
const POINT_VERT = CHUNK_GLSL + /* glsl */ `
  uniform float pointSize;
  out vec3 vColor;
  void main() {
    vec3 w; float r;
    if (!place(w, r)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vColor = iColor;
    gl_PointSize = pointSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
  }
`
const POINT_FRAG = /* glsl */ `
  precision highp float;
  in vec3 vColor;
  out vec4 fragColor;
  void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; if (dot(c, c) > 1.0) discard; fragColor = vec4(vColor, 1.0); }
`

// ---- chunk building ------------------------------------------------------------------------------------------

const colorCache = new Map<string, [number, number, number]>()
function rgb(hex: string): [number, number, number] {
  let c = colorCache.get(hex)
  if (!c) colorCache.set(hex, (c = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255]))
  return c
}
const openOf = (kind: Kind, n: Node) => n.open ?? (n.open = typeof kind.open === 'function' ? kind.open(n) : kind.open ?? PERF.open)
const batchOf = (f: Far): Batch => (f.shape === 'haze' ? 'haze' : f.shape === 'cube' ? 'cube' : f.shape === 'box' ? 'box' : f.shape === 'point' ? 'point' : 'sphere')

// the drawable items of a node's closed children (and its own inner ones), in the node's units
const scratch = Object.fromEntries(BATCHES.map(b => [b, new Float32Array(1024 * STRIDE)])) as Record<Batch, Float32Array> // grown as needed
const EMPTY = new Float32Array(0)
function buildChunk(n: Node, kind: Kind, kids: Node[], closed: Node[], open: Node[], lo: number, hi: number, sig: string): Chunk {
  const len: Record<Batch, number> = { sphere: 0, haze: 0, cube: 0, box: 0, point: 0 }
  const owners: Partial<Record<Batch, (Node | null)[]>> = {}
  // rank: a sample is drawn while rank ≤ (span / open)³; detail (rank 1) once the node spans its detail threshold
  const push = (f: Far, at: Vec3, size: number, rank: number, spanFactor: number, jit: number, phase: number, own: Node | null, blob = false) => {
    const [r, g, b] = rgb(f.color), a = f.alpha ?? 1
    const flags = (f.glow ? FLAG_GLOW : 0) | (f.minPx || f.shape === 'point' ? FLAG_POINT : 0) | (blob ? FLAG_BLOB : 0) | (f.flash ? FLAG_FLASH : 0)
    const b2 = batchOf(f), j = len[b2]
    let s = scratch[b2]
    if (j + STRIDE > s.length) { const t = new Float32Array(s.length * 2); t.set(s); scratch[b2] = s = t }
    s[j] = f.pos ? at[0] + f.pos[0] * size : at[0]; s[j + 1] = f.pos ? at[1] + f.pos[1] * size : at[1]; s[j + 2] = f.pos ? at[2] + f.pos[2] * size : at[2]
    s[j + 3] = size * (f.scale ?? (f.shape === 'haze' ? 0.7 : 1))
    s[j + 4] = r * a; s[j + 5] = g * a; s[j + 6] = b * a
    s[j + 7] = f.minPx ?? 0; s[j + 8] = jit; s[j + 9] = f.phase ?? phase; s[j + 10] = flags; s[j + 11] = rank; s[j + 12] = spanFactor; s[j + 13] = 0
    len[b2] = j + STRIDE
    ;(owners[b2] ??= []).push(own)
  }
  if (kind.inner) for (const f of kind.inner(n)) push(f, [0, 0, 0], 1, 0, 1e9, 0, 0, null)
  for (const c of closed) {
    const ck = kindOf(c.kind)!
    const far = c.far === undefined ? (c.far = ck.far(c)) : c.far
    if (!far && !ck.detail) continue
    const jitter = (ck.jitter ?? 0) / n.metres, phase = (c.seed % 251) * 0.025
    const owner = !ck.space || c.props.depth === 0 ? c : null
    const detailAt = ck.detail ? c.size / ck.detail.at : 1e9 // span factor: the child's span over the span it is complete at
    if (Array.isArray(far)) far.forEach((f, i) => push(f, c.pos, c.size, i / far.length, c.size / openOf(ck, c), 0, phase, null))
    else if (far) push(far, c.pos, c.size, 0, detailAt, jitter, phase, owner, !!ck.detail)
    if (ck.detail) for (const f of ck.detail.far(c)) push(f, c.pos, c.size, 1, detailAt, jitter, phase, owner)
  }
  const data = {} as Record<Batch, Float32Array>, count = {} as Record<Batch, number>, at = {} as Record<Batch, number>
  for (const b of BATCHES) { data[b] = len[b] ? scratch[b].slice(0, len[b]) : EMPTY; count[b] = len[b] / STRIDE; at[b] = -1 }
  return { sig, kids, open, lo, hi, data, count, owners, at, slot: -1, used: 0 }
}

// ---- the component -----------------------------------------------------------------------------------------

export function World() {
  const { camera, gl, size } = useThree()
  const nearRefs = useRef(new Map<string, Group>())
  const nearPlace = useRef(new Map<string, { rel: Vec3; s: number; k: number }>()) // where each Near goes, for groups that mount after the walk
  const [near, setNear] = useState<Node[]>([])
  const nearKey = useRef('')
  const walks = useRef(0)
  const still = useRef('') // the view the last walk was made for…
  const complete = useRef(false) // …and whether it got to generate everything it wanted
  const walked = useRef<Visible[]>([])
  const pointer = useRef({ x: 0, y: 0 }) // px from the canvas centre, y up
  const wheel = useRef({ decades: 0, retarget: false, last: 0 })
  const tap = useRef({ x: 0, y: 0, at: 0, fly: false }) // a click (no drag) flies to whatever is under the cursor
  const lastGen = useRef<Record<string, number>>({}) // dev: ms spent generating, by kind, in the last walk

  const gpu = useMemo(() => {
    const texData = new Float32Array(TEX_W * TEX_W * 4)
    const tex = new DataTexture(texData, TEX_W, TEX_W, RGBAFormat, FloatType)
    tex.minFilter = tex.magFilter = NearestFilter
    tex.generateMipmaps = false
    const uniforms = {
      chunks: { value: tex }, time: { value: 0 }, front: { value: 0 }, depth: { value: 0 }, back: { value: new Vector3(0, 0, 1) }, fovScale: { value: 1 },
      proj: { value: camera.projectionMatrix }, light: { value: new Vector3(0.35, 0.6, 0.72).normalize() },
    }
    const material = (vert: string, frag: string, extra: Record<string, { value: unknown }>, opts: Partial<ShaderMaterial>) =>
      new ShaderMaterial({ glslVersion: GLSL3, vertexShader: vert, fragmentShader: frag, uniforms: { ...uniforms, ...extra }, ...opts })
    const buffers = {} as Record<Batch, { buffer: InterleavedBuffer; object: Mesh | Points; geometry: BufferGeometry }>
    const make = (b: Batch, base: BufferGeometry | null, mat: ShaderMaterial, points = false) => {
      const array = new Float32Array(PERF.cap[b] * STRIDE)
      const buffer = points ? new InterleavedBuffer(array, STRIDE) : new InstancedInterleavedBuffer(array, STRIDE)
      buffer.setUsage(DynamicDrawUsage)
      const geometry = points ? new BufferGeometry() : new InstancedBufferGeometry()
      if (base) { geometry.index = base.index; for (const k of Object.keys(base.attributes)) geometry.setAttribute(k, base.attributes[k]) }
      const attr = (name: string, n: number, off: number) => geometry.setAttribute(name, new InterleavedBufferAttribute(buffer, n, off))
      attr('iPos', 3, 0); attr('iSize', 1, 3); attr('iColor', 3, 4); attr('iMisc', 4, 7); attr('iRank', 2, 11); attr('iChunk', 1, 13)
      if (points) geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0))
      const object = points ? new Points(geometry, mat) : new Mesh(geometry, mat)
      object.frustumCulled = false
      buffers[b] = { buffer, object, geometry }
    }
    const quad = new PlaneGeometry(2, 2), box = new BoxGeometry(1, 1, 1)
    make('sphere', quad, material(SPHERE_VERT, SPHERE_FRAG, { hazeAlpha: { value: 0 } }, {}))
    make('haze', quad, material(SPHERE_VERT, SPHERE_FRAG, { hazeAlpha: { value: 0.12 } }, { transparent: true, blending: AdditiveBlending, depthWrite: false }))
    make('cube', box, material(BOX_VERT, BOX_FRAG, { alpha: { value: 1 } }, {}))
    make('box', box, material(BOX_VERT, BOX_FRAG, { alpha: { value: 0.08 } }, { transparent: true, depthWrite: false }))
    make('point', null, material(POINT_VERT, POINT_FRAG, { pointSize: { value: PERF.pointPx * Math.min(2, window.devicePixelRatio) } }, { transparent: true, blending: AdditiveBlending, depthWrite: false }), true)
    buffers.haze.object.renderOrder = 1
    buffers.box.object.renderOrder = 1
    buffers.point.object.renderOrder = 2
    return { tex, texData, uniforms, buffers }
  }, [camera])

  useEffect(() => {
    const el = gl.domElement
    const track = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      pointer.current = { x: e.clientX - r.left - r.width / 2, y: r.height / 2 - (e.clientY - r.top) }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      track(e)
      const now = performance.now()
      const w = wheel.current
      if (now - w.last > 300) w.retarget = true // a new gesture aims at whatever is under the cursor now
      w.last = now
      // capped so a hard flick or momentum scroll can't jump tens of decades at once
      w.decades += MathUtils.clamp(e.deltaY * (e.ctrlKey ? 0.02 : 0.003), -0.3, 0.3)
    }
    const down = (e: PointerEvent) => { tap.current = { x: e.clientX, y: e.clientY, at: performance.now(), fly: false } }
    const up = (e: PointerEvent) => { // a tap, not a drag (dragging is the orbit controls' job)
      const t = tap.current
      if (e.button === 0 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 6 && performance.now() - t.at < 500) { track(e); t.fly = true }
    }
    el.addEventListener('pointermove', track)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointermove', track)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
    }
  }, [gl])

  useFrame(({ clock }, dt) => {
    const t0 = performance.now()
    stepCamera(dt)
    const { node, focus, zoom } = useCam.getState()
    const w = 10 ** zoom / node.metres // view height in node units
    const k = VIEW / w // scene units per node unit
    const back = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)

    // a view that has not moved since the last walk, with nothing left to generate, is redrawn from the same chunks
    const view = `${node.key}|${focus}|${zoom}|${size.width}x${size.height}|${camera.quaternion.toArray()}|${kindsLoaded()}`
    if (view !== still.current || !complete.current) {
      still.current = view
      const f = ++walks.current
      const onPath = new Set<string>()
      for (const a of ancestry(node)) { a.seen = f; onPath.add(a.key) }
      // what is in play: the screen rectangle (as wide as it gets at the back of the cutaway slab), the slab deep;
      // anything beyond is left to the coarse picture its ancestors' chunks draw of it
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      const hx = PERF.margin * (size.width / size.height) * w, hy = PERF.margin * w, zf = (PERF.front + 0.05) * w, zb = (PERF.depth + 0.05) * w
      const reach = Math.hypot(hx, hy, zb)
      const gen: Record<string, number> = {}
      let generating = true, spent = 0 // ms of this walk spent generating (the walk itself can take as long again)
      let built = 0, builds = 0, starved = false // ms spent building chunks, how many, and whether any had to wait

      // start from the smallest ancestor that contains the whole view box, so neighbours across seams are drawn too
      let top = node, o: Vec3 = [0, 0, 0], s = 1
      while (top.parent) {
        const off = Math.max(Math.abs(focus[0] - o[0]), Math.abs(focus[1] - o[1]), Math.abs(focus[2] - o[2]))
        if (top !== node && (off + reach) / s < 0.5) break
        s /= top.size
        o = [o[0] - s * top.pos[0], o[1] - s * top.pos[1], o[2] - s * top.pos[2]]
        top = top.parent
      }

      const visible: Visible[] = []
      const nearList: { node: Node; rel: Vec3; s: number }[] = []

      // walk the open nodes; closed ones live in their parent's chunk
      const visit = (n: Node, ox: number, oy: number, oz: number, s: number) => {
        const kind = kindOf(n.kind)
        if (!kind?.children || visible.length >= MAX_CHUNKS) return
        const rx = ox - focus[0], ry = oy - focus[1], rz0 = oz - focus[2]
        const h = s * 0.87, rz = rx * back.x + ry * back.y + rz0 * back.z
        if (rz - h > zf || -rz - h > (kind.deep ? reach : zb)) return
        if (Math.abs(rx * right.x + ry * right.y + rz0 * right.z) - h > hx || Math.abs(rx * up.x + ry * up.y + rz0 * up.z) - h > hy) return
        const span = s / w
        if (span <= openOf(kind, n)) return
        n.seen = f
        const kids = childrenOf(n)
        if (!kids.length) return
        let chunk = chunks.get(n), open: Node[]
        if (chunk && chunk.kids === kids && span > chunk.lo && span < chunk.hi) open = chunk.open // nothing crossed a threshold
        else {
          const closed: Node[] = []
          let sig = '', lo = 0, hi = Infinity, reserved = 0 // ms the chunks of the children opened here will probably take
          open = []
          for (let i = 0; i < kids.length; i++) {
            const c = kids[i], ck = kindOf(c.kind)
            if (!ck) { sig += 'x'; continue }
            if (!ck.children) { closed.push(c); continue }
            // a child opens only once its own children exist (generated now if there is time) and there is time to
            // build its chunk; until then it stays closed, in this chunk, so nothing flips back and forth
            const at = openOf(ck, c) / c.size // the node span at which this child opens
            if (span > at) {
              if (c.children === undefined && generating) {
                if (spent > PERF.genMs) generating = false
                else {
                  const g0 = performance.now()
                  childrenOf(c)
                  const ms = performance.now() - g0
                  spent += ms
                  gen[c.kind] = (gen[c.kind] ?? 0) + ms
                }
              }
              if (c.children !== undefined) {
                const est = chunks.has(c) ? 0 : buildCost.get(c.kind) ?? 0.05
                if (built + reserved + est <= PERF.buildMs || (est === 0 && built <= PERF.buildMs)) { reserved += est; open.push(c); sig += i + ','; if (at > lo) lo = at; continue }
              }
              starved = true
              hi = 0 // not settled: look again next frame
            } else if (at < hi) hi = at
            closed.push(c)
          }
          if (!chunk || chunk.sig !== sig || chunk.kids !== kids) {
            if (chunk && chunk.kids === kids && built > PERF.buildMs) { starved = true; open = chunk.open } // out of time: the old chunk stands
            else {
              const b0 = performance.now()
              if (chunk) drop(chunk)
              chunks.set(n, (chunk = buildChunk(n, kind, kids, closed, open, lo, hi, sig)))
              const ms = performance.now() - b0
              built += ms
              builds++
              buildCost.set(n.kind, 0.7 * (buildCost.get(n.kind) ?? ms) + 0.3 * ms)
            }
          } else { chunk.lo = lo; chunk.hi = hi } // same partition, maybe a wider range of spans for it
        }
        visible.push({ n, rx, ry, rz: rz0, s, chunk })
        if (kind.Near && (kind.nearFor?.(n) ?? true) && (!kind.nearOnPath || onPath.has(n.key)) && span >= (kind.nearMin ?? 0) && span < (kind.nearMax ?? Infinity)) nearList.push({ node: n, rel: [rx, ry, rz0], s })
        // nearest first, so what the caps cut off is the far edge
        if (open.length > 1) open.sort((a, b) => (rx + s * a.pos[0]) ** 2 + (ry + s * a.pos[1]) ** 2 + (rz0 + s * a.pos[2]) ** 2 - (rx + s * b.pos[0]) ** 2 - (ry + s * b.pos[1]) ** 2 - (rz0 + s * b.pos[2]) ** 2)
        for (const c of open) visit(c, ox + s * c.pos[0], oy + s * c.pos[1], oz + s * c.pos[2], s * c.size)
      }
      const w0 = performance.now()
      visit(top, o[0], o[1], o[2], s)
      complete.current = generating && !starved
      walked.current = visible
      if (import.meta.env.DEV) lastGen.current = { ...gen, _walk: performance.now() - w0 - spent - built, _gen: spent, _build: built, _builds: builds }
      if (f % PERF.evictEvery === 0) evict(root, f - PERF.evictEvery)

      // GPU residency: every visible chunk gets its texel and, the first time, its items go into the buffers
      const u0 = performance.now()
      const td = gpu.texData
      td.fill(0)
      let uploads = 0
      const place = (c: Chunk): boolean => { // make it resident; false when the buffers are full
        if (c.slot >= 0) return true
        if (!freeSlots.length && nextSlot >= MAX_CHUNKS) return false
        for (const b of BATCHES) {
          if (!c.count[b]) continue
          if ((c.at[b] = alloc(arenas[b], c.count[b], PERF.cap[b])) < 0) {
            for (const bb of BATCHES) if (c.at[bb] >= 0) { release(arenas[bb], c.at[bb], c.count[bb]); c.at[bb] = -1 }
            return false
          }
        }
        c.slot = freeSlots.length ? freeSlots.pop()! : nextSlot++
        for (const b of BATCHES) {
          const n = c.count[b], at = c.at[b]
          if (!n) continue
          const arr = gpu.buffers[b].buffer.array as Float32Array
          arr.set(c.data[b], at * STRIDE)
          for (let i = 0; i < n; i++) arr[(at + i) * STRIDE + 13] = c.slot
          dirty[b].push(at * STRIDE, (at + n) * STRIDE)
          uploads++
        }
        resident.add(c)
        return true
      }
      const dirty = Object.fromEntries(BATCHES.map(b => [b, [] as number[]])) as Record<Batch, number[]> // [start, end) floats to upload
      let swept = 0
      for (const v of visible) {
        const c = v.chunk
        c.used = f
        if (c.slot < 0 && !place(c) && swept < 2) { // full: give back some of what is not on screen, then try again
          swept += sweep(f, 500) ? 1 : 2
          place(c)
        }
        if (c.slot < 0) continue
        const i = c.slot * 4
        td[i] = v.rx * k; td[i + 1] = v.ry * k; td[i + 2] = v.rz * k; td[i + 3] = v.s * k
      }
      if (f % 10 === 0) sweep(f - PERF.evictEvery, 500)
      for (const b of BATCHES) {
        const { geometry, buffer } = gpu.buffers[b], d = dirty[b]
        if (geometry instanceof InstancedBufferGeometry) geometry.instanceCount = arenas[b].high
        else geometry.setDrawRange(0, arenas[b].high)
        if (!d.length) continue
        // thousands of tiny chunks would be thousands of GL calls: upload them as a few runs, gaps included
        const runs: number[][] = []
        for (let i = 0; i < d.length; i += 2) runs.push([d[i], d[i + 1]])
        runs.sort((p, q) => p[0] - q[0])
        let [s, e] = runs[0]
        for (let i = 1; i <= runs.length; i++) {
          if (i < runs.length && runs[i][0] - e < 65536) { e = Math.max(e, runs[i][1]); continue }
          buffer.addUpdateRange(s, e - s)
          if (i < runs.length) [s, e] = runs[i]
        }
        buffer.needsUpdate = true
      }
      gpu.tex.needsUpdate = true
      if (import.meta.env.DEV) { lastGen.current._upload = performance.now() - u0; lastGen.current._uploads = uploads }

      nearPlace.current.clear()
      for (const e of nearList) {
        nearPlace.current.set(e.node.key, { rel: e.rel, s: e.s, k })
        const g = nearRefs.current.get(e.node.key)
        g?.position.set(e.rel[0] * k, e.rel[1] * k, e.rel[2] * k)
        g?.scale.setScalar(e.s * k)
      }
      const key = nearList.map(e => e.node.key).join()
      if (key !== nearKey.current) {
        nearKey.current = key
        setNear(nearList.map(e => e.node))
      }
    }

    const shown = walked.current
    gpu.uniforms.time.value = clock.elapsedTime
    gpu.uniforms.front.value = PERF.front * w * k
    gpu.uniforms.depth.value = PERF.depth * w * k
    gpu.uniforms.back.value.copy(back)
    gpu.uniforms.fovScale.value = size.height / (2 * Math.tan(MathUtils.degToRad(FOV / 2)))
    gpu.uniforms.proj.value = camera.projectionMatrix

    // what is under the cursor: the nearest solid thing, else the smallest open thing, else the closest tiny thing
    // (`node`), and failing those the nearest drawn point of anything (`spot`, a position in node units)
    const pickAt = (cx: number, cy: number): { node?: Node; spot?: Vec3 } => {
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      const D = CAMERA_DISTANCE / k, pxPerUnit = size.height / w
      const pick: Pick = { solidZ: -Infinity, openR: Infinity, nearD: PERF.snapPx, spotD: PERF.snapPx }
      for (const v of shown) {
        const z = v.rx * back.x + v.ry * back.y + v.rz * back.z
        if (z - v.s * 0.87 >= D) continue // wholly behind the camera (its centre may be, while things in it are not)
        if (z < D && !kindOf(v.n.kind)?.space) {
          const per = (D / (D - z)) * pxPerUnit
          const x = v.rx * right.x + v.ry * right.y + v.rz * right.z, y = v.rx * up.x + v.ry * up.y + v.rz * up.z
          const rpx = (v.s / 2) * per, dx = x * per - cx, dy = y * per - cy
          if (dx * dx + dy * dy < rpx * rpx && rpx < pick.openR) { pick.open = v.n; pick.openR = rpx }
        }
        for (const b of BATCHES) {
          const d = v.chunk.data[b], own = v.chunk.owners[b]
          for (let i = 0; i < v.chunk.count[b]; i++) {
            const c = own?.[i]
            const j = i * STRIDE
            const p: Vec3 = [v.rx + d[j] * v.s, v.ry + d[j + 1] * v.s, v.rz + d[j + 2] * v.s]
            const pz = p[0] * back.x + p[1] * back.y + p[2] * back.z
            if (pz >= D) continue
            const pp = (D / (D - pz)) * pxPerUnit
            const px = (p[0] * right.x + p[1] * right.y + p[2] * right.z) * pp - cx, py = (p[0] * up.x + p[1] * up.y + p[2] * up.z) * pp - cy
            const d2 = px * px + py * py, rr = Math.max((d[j + 3] * v.s * pp) / 2, d[j + 7] / 2)
            if (d2 < pick.spotD * pick.spotD) { pick.spot = [focus[0] + p[0], focus[1] + p[1], focus[2] + p[2]]; pick.spotD = Math.sqrt(d2) }
            if (!c) continue
            if (d2 < rr * rr && pz > pick.solidZ) { pick.solid = c; pick.solidZ = pz }
            if (d2 < pick.nearD * pick.nearD) { pick.near = c; pick.nearD = Math.sqrt(d2) }
          }
        }
      }
      return { node: pick.solid ?? pick.open ?? pick.near, spot: pick.spot }
    }

    // apply this frame's scrolling, aimed at what is under the cursor
    const wh = wheel.current
    if (wh.decades) {
      const cam = useCam.getState()
      let { anchor, goal } = cam
      if (wh.retarget) {
        const { node: target, spot } = pickAt(pointer.current.x, pointer.current.y)
        goal = target?.key ?? null
        const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        const per = w / size.height // node units per px
        anchor = target ? centreIn(target, node) : spot ?? [0, 1, 2].map(i => focus[i] + pointer.current.x * per * right.getComponent(i) + pointer.current.y * per * up.getComponent(i)) as Vec3
      }
      cam.zoomAt(wh.decades, anchor, goal)
      wh.decades = 0
      wh.retarget = false
    }
    // a click flies to the thing under the cursor until it fills two thirds of the view, locked on; a click on a
    // mere sample (a star drawn for a region that has not opened yet) zooms in on that spot until it is real
    if (tap.current.fly) {
      tap.current.fly = false
      const { node: target, spot } = pickAt(pointer.current.x, pointer.current.y)
      const cam = useCam.getState()
      if (target) cam.zoomAt(Math.log10(target.metres * 1.5) - cam.target, centreIn(target, node), target.key)
      else if (spot) cam.zoomAt(-3, spot, null)
    }

    if (import.meta.env.DEV) Object.assign(window, { __gpu: gpu, __perf: { ms: performance.now() - t0, walks: walks.current, complete: complete.current, chunks: shown.length, resident: resident.size, items: Object.fromEntries(BATCHES.map(b => [b, arenas[b].high])), near: near.length, gen: lastGen.current } })
  })

  return (
    <>
      {BATCHES.map(b => <primitive key={b} object={gpu.buffers[b].object} />)}
      {near.map(n => {
        const Near = kindOf(n.kind)!.Near!
        return (
          <group key={n.key} ref={g => {
            if (!g) { nearRefs.current.delete(n.key); return }
            nearRefs.current.set(n.key, g)
            const p = nearPlace.current.get(n.key) // placed now: the walk that asked for it has already run
            if (p) { g.position.set(p.rel[0] * p.k, p.rel[1] * p.k, p.rel[2] * p.k); g.scale.setScalar(p.s * p.k) }
          }}>
            <Near node={n} />
          </group>
        )
      })}
    </>
  )
}
