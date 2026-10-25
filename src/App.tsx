import { useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { MathUtils } from 'three'
import { CAMERA_DISTANCE, FOV, Layer } from './Layer'
import { Hud } from './Hud'
import { SCALES } from './scales'
import { useScale } from './store'

function ZoomDriver() {
  useFrame((_, dt) => useScale.getState().step(dt))
  return null
}

export default function App() {
  useEffect(() => {
    // trackpad pinch arrives as ctrl+wheel; preventDefault stops the browser zooming the page
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // capped so a hard flick or momentum scroll can't jump tens of decades at once
      useScale.getState().zoomBy(MathUtils.clamp(e.deltaY * (e.ctrlKey ? 0.02 : 0.003), -0.3, 0.3))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <>
      <Canvas camera={{ position: [0, 0, CAMERA_DISTANCE], fov: FOV, near: 0.01, far: 1000 }}>
        <ZoomDriver />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} />
        {SCALES.map(({ id, size, color, Component }) => (
          <Layer key={id} size={size}>
            <Component color={color} />
          </Layer>
        ))}
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.3} />
        <EffectComposer>
          <Bloom mipmapBlur luminanceThreshold={1} intensity={1.2} />
        </EffectComposer>
      </Canvas>
      <Hud />
    </>
  )
}
