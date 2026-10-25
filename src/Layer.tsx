import { useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Material, Mesh } from 'three'
import { useScale } from './store'

export const CAMERA_DISTANCE = 10
export const FOV = 50
// scene units spanned by the view height at the origin
const VIEW = 2 * CAMERA_DISTANCE * Math.tan((FOV / 2) * (Math.PI / 180))

const IN = 1 // visible until the thing is 10× bigger than the view
const OUT = 2.5 // and from when it is ~300× smaller than the view
const FADE = 0.5 // decades spent fading at each end

// Mounts children only near their scale, sized in local units so floats stay sane.
export function Layer({ size, children }: { size: number; children: ReactNode }) {
  const visible = useScale(s => s.zoom > size - IN && s.zoom < size + OUT)
  const ref = useRef<Group>(null!)

  useFrame(() => {
    if (!ref.current) return // unmounted while out of range
    const { zoom } = useScale.getState()
    ref.current.scale.setScalar(VIEW * 10 ** (size - zoom))
    const fade = Math.min(1, (zoom - (size - IN)) / FADE, (size + OUT - zoom) / FADE)
    ref.current.traverse(o => {
      const m = (o as Mesh).material as Material | undefined
      if (!m) return
      m.userData.opacity ??= m.opacity
      m.transparent = true
      m.opacity = m.userData.opacity * fade
    })
  })

  return visible ? <group ref={ref}>{children}</group> : null
}
