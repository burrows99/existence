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

export const CAMERA_DISTANCE = 10
export const FOV = 50
const VIEW = 2 * CAMERA_DISTANCE * Math.tan(MathUtils.degToRad(FOV / 2)) // scene units across the view height
type Batch = 'sphere' | 'haze' | 'cube' | 'box' | 'point'
const BATCHES: Batch[] = ['sphere', 'haze', 'cube', 'box', 'point']
const CAP: Record<Batch, number> = { sphere: 500000, haze: 100000, cube: 100000, box: 50000, point: 600000 } // items per batch; beyond it the farthest chunks go
const TEX_W = 128 // chunk transform texture: one texel (offset.xyz, scale) per chunk
const MAX_CHUNKS = TEX_W * TEX_W
const FRONT = 0.1, DEPTH = 0.6 // cutaway: solid things are drawn from this far in front of the focus plane to this far behind it, in view heights
const EVICT_EVERY = 300 // walks
const GEN_MS = 7 // ms per walk spent generating new nodes; the rest waits, their parents' chunks stand in
const SNAP = 24 // px: scrolling near a tiny thing still targets it
const STRIDE = 14 // floats per item: pos3 size1 color3 misc4 (minPx, jitter, phase, flags) rank2 chunk1

type Chunk = { sig: string; kids: Node[]; version: number; data: Record<Batch, Float32Array>; count: Record<Batch, number>; owners: Record<Batch, (Node | null)[]> }
type Visible = { n: Node; rel: Vec3; s: number; chunk: Chunk; index: number }
type Pick = { solid?: Node; solidZ: number; open?: Node; openR: number; near?: Node; nearD: number }
const chunks = new WeakMap<Node, Chunk>()
let versions = 0

// point: never cut away (a star behind the focus is still a star); blob: a node's stand-in, drawn only while its detail is not
const FLAG_GLOW = 1, FLAG_POINT = 2, FLAG_BLOB = 4

// ---- shaders -----------------------------------------------------------------------------------------------

const CHUNK_GLSL = /* glsl */ `
  in vec3 iPos; in float iSize; in vec3 iColor; in vec4 iMisc; in vec2 iRank; in float iChunk;
  uniform sampler2D chunks; uniform float time, front, depth, fovScale; uniform vec3 back;
  // the item's centre in scene units, or culled
  bool place(out vec3 w, out float r) {
    int ci = int(iChunk + 0.5);
    vec4 t = texelFetch(chunks, ivec2(ci % ${TEX_W}, ci / ${TEX_W}), 0);
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
    vec4 vp = modelViewMatrix * vec4(w, 1.0);
    r = max(r, 0.5 * iMisc.x * max(0.001, -vp.z) / fovScale); // never smaller than minPx pixels
    vCorner = position.xy; vColor = iColor; vR = r; vCenter = vp.xyz; vFlags = iMisc.w;
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
const openOf = (kind: Kind, n: Node) => n.open ?? (n.open = typeof kind.open === 'function' ? kind.open(n) : kind.open ?? 0.3)
const batchOf = (f: Far): Batch => (f.shape === 'haze' ? 'haze' : f.shape === 'cube' ? 'cube' : f.shape === 'box' ? 'box' : f.shape === 'point' ? 'point' : 'sphere')

// the drawable items of a node's closed children (and its own inner ones), in the node's units
function buildChunk(n: Node, kind: Kind, kids: Node[], closed: Node[], sig: string): Chunk {
  const lists: Record<Batch, number[]> = { sphere: [], haze: [], cube: [], box: [], point: [] }
  const owners: Record<Batch, (Node | null)[]> = { sphere: [], haze: [], cube: [], box: [], point: [] }
  // rank: a sample is drawn while rank ≤ (span / open)³; detail (rank 1) once the node spans its detail threshold
  const push = (f: Far, at: Vec3, size: number, rank: number, spanFactor: number, jit: number, phase: number, own: Node | null, blob = false) => {
    const [r, g, b] = rgb(f.color), a = f.alpha ?? 1
    const pos = f.pos ? [at[0] + f.pos[0] * size, at[1] + f.pos[1] * size, at[2] + f.pos[2] * size] : at
    const flags = (f.glow ? FLAG_GLOW : 0) | (f.minPx || f.shape === 'point' ? FLAG_POINT : 0) | (blob ? FLAG_BLOB : 0)
    const b2 = batchOf(f)
    lists[b2].push(pos[0], pos[1], pos[2], size * (f.scale ?? (f.shape === 'haze' ? 0.7 : 1)), r * a, g * a, b * a, f.minPx ?? 0, jit, phase, flags, rank, spanFactor, 0)
    owners[b2].push(own)
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
  const data = {} as Record<Batch, Float32Array>, count = {} as Record<Batch, number>
  for (const b of BATCHES) { data[b] = Float32Array.from(lists[b]); count[b] = lists[b].length / STRIDE }
  return { sig, kids, version: ++versions, data, count, owners }
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
  const uploaded = useRef(0)
  const uploads = useRef(0)
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
      const array = new Float32Array(CAP[b] * STRIDE)
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
    make('point', null, material(POINT_VERT, POINT_FRAG, { pointSize: { value: 2.5 * Math.min(2, window.devicePixelRatio) } }, { transparent: true, blending: AdditiveBlending, depthWrite: false }), true)
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
    el.addEventListener('pointermove', track)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointermove', track)
      el.removeEventListener('wheel', onWheel)
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
      const hx = 0.9 * (size.width / size.height) * w, hy = 0.9 * w, zf = (FRONT + 0.05) * w, zb = (DEPTH + 0.05) * w
      const reach = Math.hypot(hx, hy, zb)
      const gen: Record<string, number> = {}
      let generating = true, spent = 0 // ms of this walk spent generating (the walk itself can take as long again)

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
      const visit = (n: Node, o: Vec3, s: number) => {
        const kind = kindOf(n.kind)
        if (!kind?.children || visible.length >= MAX_CHUNKS) return
        const rel: Vec3 = [o[0] - focus[0], o[1] - focus[1], o[2] - focus[2]]
        const h = s * 0.87, rz = rel[0] * back.x + rel[1] * back.y + rel[2] * back.z
        if (rz - h > zf || -rz - h > (kind.deep ? reach : zb)) return
        if (Math.abs(rel[0] * right.x + rel[1] * right.y + rel[2] * right.z) - h > hx || Math.abs(rel[0] * up.x + rel[1] * up.y + rel[2] * up.z) - h > hy) return
        const span = s / w
        if (span <= openOf(kind, n)) return
        n.seen = f
        const kids = childrenOf(n)
        if (!kids.length) return
        const closed: Node[] = [], open: Node[] = []
        let sig = ''
        for (let i = 0; i < kids.length; i++) {
          const c = kids[i], ck = kindOf(c.kind)
          if (!ck) { sig += 'x'; continue }
          // a child opens only once its own children exist; generate them now if there is time, else it stays
          // closed (and in this chunk) until a later frame, so nothing flips back and forth
          if (ck.children && (s * c.size) / w > openOf(ck, c)) {
            if (c.children === undefined && generating) {
              if (spent > GEN_MS) generating = false
              else {
                const g0 = performance.now()
                childrenOf(c)
                const ms = performance.now() - g0
                spent += ms
                gen[c.kind] = (gen[c.kind] ?? 0) + ms
              }
            }
            if (c.children !== undefined) { open.push(c); sig += i + ','; continue }
          }
          closed.push(c)
        }
        let chunk = chunks.get(n)
        if (!chunk || chunk.sig !== sig || chunk.kids !== kids) chunks.set(n, (chunk = buildChunk(n, kind, kids, closed, sig)))
        visible.push({ n, rel, s, chunk, index: visible.length })
        if (kind.Near && (kind.nearFor?.(n) ?? true) && (!kind.nearOnPath || onPath.has(n.key)) && span >= (kind.nearMin ?? 0) && span < (kind.nearMax ?? Infinity)) nearList.push({ node: n, rel, s })
        // nearest first, so what the caps cut off is the far edge
        const d2 = (c: Node) => (rel[0] + s * c.pos[0]) ** 2 + (rel[1] + s * c.pos[1]) ** 2 + (rel[2] + s * c.pos[2]) ** 2
        if (open.length > 1) open.sort((a, b) => d2(a) - d2(b))
        for (const c of open) visit(c, [o[0] + s * c.pos[0], o[1] + s * c.pos[1], o[2] + s * c.pos[2]], s * c.size)
      }
      visit(top, o, s)
      complete.current = generating
      walked.current = visible
      if (import.meta.env.DEV) lastGen.current = gen
      if (f % EVICT_EVERY === 0) evict(root, f - EVICT_EVERY)

      // upload the items when the set of chunks changed
      let hash = 0
      for (const v of visible) hash = (hash * 31 + v.chunk.version) | 0
      if (hash !== uploaded.current) {
        uploaded.current = hash
        uploads.current++
        for (const b of BATCHES) {
          const { buffer, geometry } = gpu.buffers[b]
          const arr = buffer.array as Float32Array
          let n = 0
          for (const v of visible) {
            const c = v.chunk.count[b]
            if (!c || n + c > CAP[b]) continue
            arr.set(v.chunk.data[b], n * STRIDE)
            for (let i = 0; i < c; i++) arr[(n + i) * STRIDE + 13] = v.index
            n += c
          }
          buffer.clearUpdateRanges()
          buffer.addUpdateRange(0, n * STRIDE)
          buffer.needsUpdate = true
          if (geometry instanceof InstancedBufferGeometry) geometry.instanceCount = n
          else geometry.setDrawRange(0, n)
        }
      }
      // one transform per chunk
      const td = gpu.texData
      for (const v of visible) {
        const i = v.index * 4
        td[i] = v.rel[0] * k; td[i + 1] = v.rel[1] * k; td[i + 2] = v.rel[2] * k; td[i + 3] = v.s * k
      }
      gpu.tex.needsUpdate = true

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
    gpu.uniforms.front.value = FRONT * w * k
    gpu.uniforms.depth.value = DEPTH * w * k
    gpu.uniforms.back.value.copy(back)
    gpu.uniforms.fovScale.value = size.height / (2 * Math.tan(MathUtils.degToRad(FOV / 2)))
    gpu.uniforms.proj.value = camera.projectionMatrix

    // what is under the cursor: the nearest solid thing, else the smallest open thing, else the closest tiny thing
    const pickAt = (cx: number, cy: number): Node | undefined => {
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      const D = CAMERA_DISTANCE / k, pxPerUnit = size.height / w
      const pick: Pick = { solidZ: -Infinity, openR: Infinity, nearD: SNAP }
      for (const v of shown) {
        const z = v.rel[0] * back.x + v.rel[1] * back.y + v.rel[2] * back.z
        if (z - v.s * 0.87 >= D) continue // wholly behind the camera (its centre may be, while things in it are not)
        if (z < D && !kindOf(v.n.kind)?.space) {
          const per = (D / (D - z)) * pxPerUnit
          const x = v.rel[0] * right.x + v.rel[1] * right.y + v.rel[2] * right.z, y = v.rel[0] * up.x + v.rel[1] * up.y + v.rel[2] * up.z
          const rpx = (v.s / 2) * per, dx = x * per - cx, dy = y * per - cy
          if (dx * dx + dy * dy < rpx * rpx && rpx < pick.openR) { pick.open = v.n; pick.openR = rpx }
        }
        for (const b of BATCHES) {
          const d = v.chunk.data[b], own = v.chunk.owners[b]
          for (let i = 0; i < v.chunk.count[b]; i++) {
            const c = own[i]
            if (!c) continue
            const j = i * STRIDE
            const p: Vec3 = [v.rel[0] + d[j] * v.s, v.rel[1] + d[j + 1] * v.s, v.rel[2] + d[j + 2] * v.s]
            const pz = p[0] * back.x + p[1] * back.y + p[2] * back.z
            if (pz >= D) continue
            const pp = (D / (D - pz)) * pxPerUnit
            const px = (p[0] * right.x + p[1] * right.y + p[2] * right.z) * pp - cx, py = (p[0] * up.x + p[1] * up.y + p[2] * up.z) * pp - cy
            const d2 = px * px + py * py, rr = Math.max((d[j + 3] * v.s * pp) / 2, d[j + 7] / 2)
            if (d2 < rr * rr && pz > pick.solidZ) { pick.solid = c; pick.solidZ = pz }
            if (d2 < pick.nearD * pick.nearD) { pick.near = c; pick.nearD = Math.sqrt(d2) }
          }
        }
      }
      return pick.solid ?? pick.open ?? pick.near
    }

    // apply this frame's scrolling, aimed at what is under the cursor
    const wh = wheel.current
    if (wh.decades) {
      const cam = useCam.getState()
      let { anchor, goal } = cam
      if (wh.retarget) {
        const target = pickAt(pointer.current.x, pointer.current.y)
        goal = target?.key ?? null
        const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        const per = w / size.height // node units per px
        anchor = target ? centreIn(target, node) : [0, 1, 2].map(i => focus[i] + pointer.current.x * per * right.getComponent(i) + pointer.current.y * per * up.getComponent(i)) as Vec3
      }
      cam.zoomAt(wh.decades, anchor, goal)
      wh.decades = 0
      wh.retarget = false
    }

    if (import.meta.env.DEV) Object.assign(window, { __gpu: gpu, __perf: { ms: performance.now() - t0, walks: walks.current, complete: complete.current, uploads: uploads.current, chunks: shown.length, items: Object.fromEntries(BATCHES.map(b => [b, gpu.buffers[b].geometry instanceof InstancedBufferGeometry ? gpu.buffers[b].geometry.instanceCount : gpu.buffers[b].geometry.drawRange.count])), near: near.length, gen: lastGen.current } })
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
