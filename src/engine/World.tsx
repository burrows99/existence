import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BoxGeometry, Color, InstancedMesh, MathUtils, Matrix4, MeshBasicMaterial, MeshStandardMaterial,
  Quaternion, SphereGeometry, Vector3, type BufferGeometry, type Group, type Material,
} from 'three'
import { ancestry, childrenOf, evict, kindOf, type Far, type Node, type Vec3 } from './tree'
import { centreIn, root, stepCamera, useCam } from './camera'

export const CAMERA_DISTANCE = 10
export const FOV = 50
const VIEW = 2 * CAMERA_DISTANCE * Math.tan(MathUtils.degToRad(FOV / 2)) // scene units across the view height
const CAP = 60000 // instances per batch
const MAX_VISITS = 200000 // nodes considered per frame
const FRONT = 0.1, DEPTH = 0.6 // cutaway: draw from just in front of the focus plane to this far behind it, in view heights
const EVICT_EVERY = 300 // frames
const SNAP = 24 // px: scrolling near a tiny thing still targets it

function batch(geometry: BufferGeometry, material: Material) {
  const m = new InstancedMesh(geometry, material, CAP)
  m.frustumCulled = false
  m.setColorAt(0, new Color())
  m.count = 0
  return m
}

const colors = new Map<string, Color>()
const colorOf = (hex: string, glow?: boolean) => {
  const k = hex + (glow ? '!' : '')
  if (!colors.has(k)) colors.set(k, new Color(hex).multiplyScalar(glow ? 4 : 1))
  return colors.get(k)!
}

type NearEntry = { node: Node; rel: Vec3; s: number }
// what is under the cursor this frame: the nearest solid thing, the smallest opened thing, the closest tiny thing
type Pick = { solid?: Node; solidZ: number; open?: Node; openR: number; near?: Node; nearD: number }

export function World() {
  const { camera, gl, size } = useThree()
  const batches = useMemo(() => ({
    solid: batch(new SphereGeometry(0.5, 24, 16), new MeshStandardMaterial({ roughness: 0.45 })),
    glow: batch(new SphereGeometry(0.5, 12, 8), new MeshBasicMaterial({ toneMapped: false })),
    box: batch(new BoxGeometry(), new MeshStandardMaterial({ transparent: true, opacity: 0.08, depthWrite: false })),
  }), [])
  const nearRefs = useRef(new Map<string, Group>())
  const [near, setNear] = useState<Node[]>([])
  const nearKey = useRef('')
  const frame = useRef(0)
  const pointer = useRef({ x: 0, y: 0 }) // px from the canvas centre, y up
  const wheel = useRef({ decades: 0, retarget: false, last: 0 })

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
    stepCamera(dt)
    const { node, focus, zoom } = useCam.getState()
    const f = ++frame.current
    const path = ancestry(node)
    for (const a of path) a.seen = f
    if (f % EVICT_EVERY === 0) evict(root, f - EVICT_EVERY)

    const w = 10 ** zoom / node.metres // view height in node units
    const k = VIEW / w // scene units per node unit
    const pxPerUnit = size.height / w
    const D = CAMERA_DISTANCE / k // camera distance in node units
    const halfH = w / 2, halfW = (halfH * size.width) / size.height
    const front = FRONT * w, depth = DEPTH * w
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    const back = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)
    const t = clock.elapsedTime
    const onPath = new Set(path.map(n => n.key))
    const { x: cx, y: cy } = pointer.current
    const pick: Pick = { solidZ: -Infinity, openR: Infinity, nearD: SNAP }

    // start from the smallest ancestor that contains the whole view box, so neighbours across seams are drawn too
    const ext = w * Math.max(1, size.width / size.height) * 0.6
    let top = node, o: Vec3 = [0, 0, 0], s = 1
    while (top.parent) {
      const off = Math.max(Math.abs(focus[0] - o[0]), Math.abs(focus[1] - o[1]), Math.abs(focus[2] - o[2]))
      if (top !== node && (off + ext) / s < 0.5) break
      s /= top.size
      o = [o[0] - s * top.pos[0], o[1] - s * top.pos[1], o[2] - s * top.pos[2]]
      top = top.parent
    }

    for (const b of Object.values(batches)) b.count = 0
    const nearList: NearEntry[] = []
    const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), sc = new Vector3()
    let visited = 0

    const put = (far: Far, rel: Vec3, diameter: number) => {
      const b = far.glow ? batches.glow : far.shape === 'box' ? batches.box : batches.solid
      if (b.count >= CAP) return
      const d = Math.max(diameter * k, far.minPx ? (far.minPx * VIEW) / size.height : 0)
      b.setMatrixAt(b.count, m.compose(p.set(rel[0] * k, rel[1] * k, rel[2] * k), q, sc.set(d, d, d)))
      b.setColorAt(b.count++, colorOf(far.color, far.glow))
    }

    const draw = (n: Node, o: Vec3, s: number) => {
      if (++visited > MAX_VISITS) return
      const kind = kindOf(n.kind)
      if (!kind) return
      const rel: Vec3 = [o[0] - focus[0], o[1] - focus[1], o[2] - focus[2]]
      const r = s * 0.87
      const x = rel[0] * right.x + rel[1] * right.y + rel[2] * right.z
      const y = rel[0] * up.x + rel[1] * up.y + rel[2] * up.z
      const z = rel[0] * back.x + rel[1] * back.y + rel[2] * back.z
      // cutaway: cull what is in front of the focus plane, except point-like things, which never occlude
      const far = (n.far ??= kind.far(n))
      if (Math.abs(x) - r > halfW || Math.abs(y) - r > halfH || -z - r > depth || (z - r > front && !far.minPx)) return
      n.seen = f

      // where this lands on screen, for picking
      const per = z < D ? (D / (D - z)) * pxPerUnit : 0
      const dx = x * per - cx, dy = y * per - cy, d2 = dx * dx + dy * dy
      const rpx = (s / 2) * per

      const span = s / w
      if (kind.children && span > (kind.open ?? 0.3)) {
        const kids = childrenOf(n)
        if (!kids.length) return // empty (or not loaded yet): draw nothing
        if (per && d2 < rpx * rpx && rpx < pick.openR) { pick.open = n; pick.openR = rpx }
        for (const c of kids) {
          const a = onPath.has(c.key) ? 0 : (kindOf(c.kind)?.jitter ?? 0) / node.metres
          draw(c, [
            o[0] + s * c.pos[0] + (a && a * Math.sin(t * 3.1 + (c.seed & 255))),
            o[1] + s * c.pos[1] + (a && a * Math.sin(t * 2.7 + ((c.seed >> 8) & 255))),
            o[2] + s * c.pos[2] + (a && a * Math.sin(t * 3.7 + ((c.seed >> 16) & 255))),
          ], s * c.size)
        }
        if (kind.Near && span > (kind.near ?? kind.open ?? 0.3)) nearList.push({ node: n, rel, s })
        return
      }
      if (!far.minPx && s * pxPerUnit < 0.5) return // sub-pixel
      if (per) {
        const rr = Math.max(rpx, (far.minPx ?? 0) / 2)
        if (d2 < rr * rr && z > pick.solidZ) { pick.solid = n; pick.solidZ = z }
        if (d2 < pick.nearD * pick.nearD) { pick.near = n; pick.nearD = Math.sqrt(d2) }
      }
      put(far, rel, s)
    }
    draw(top, o, s)

    for (const b of Object.values(batches)) {
      b.instanceMatrix.needsUpdate = true
      if (b.instanceColor) b.instanceColor.needsUpdate = true
    }
    for (const e of nearList) {
      const g = nearRefs.current.get(e.node.key)
      g?.position.set(e.rel[0] * k, e.rel[1] * k, e.rel[2] * k)
      g?.scale.setScalar(e.s * k)
    }
    const key = nearList.map(e => e.node.key).join()
    if (key !== nearKey.current) {
      nearKey.current = key
      setNear(nearList.map(e => e.node))
    }

    // apply this frame's scrolling, aimed at what the pick found
    const wh = wheel.current
    if (wh.decades) {
      const cam = useCam.getState()
      let { anchor, goal } = cam
      if (wh.retarget) {
        const target = pick.solid ?? pick.open ?? pick.near
        goal = target?.key ?? null
        anchor = target
          ? centreIn(target, node)
          : [0, 1, 2].map(i => focus[i] + (cx / pxPerUnit) * right.getComponent(i) + (cy / pxPerUnit) * up.getComponent(i)) as Vec3
      }
      cam.zoomAt(wh.decades, anchor, goal)
      wh.decades = 0
      wh.retarget = false
    }
  })

  return (
    <>
      {Object.values(batches).map(b => <primitive key={b.uuid} object={b} />)}
      {near.map(n => {
        const Near = kindOf(n.kind)!.Near!
        return (
          <group key={n.key} ref={g => { if (g) nearRefs.current.set(n.key, g); else nearRefs.current.delete(n.key) }}>
            <Near node={n} />
          </group>
        )
      })}
    </>
  )
}
