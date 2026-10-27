import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { CAMERA_DISTANCE, FOV, World } from './engine/World'
import { useCam } from './engine/camera'
import { PERF } from './engine/perf'
import { Hud } from './Hud'

export default function App() {
  // the URL is the location: #at=<node path>&f=<focus>&z=<zoom>
  useEffect(() => {
    const id = setInterval(() => {
      const { node, focus, zoom, pending } = useCam.getState()
      if (!pending) history.replaceState(null, '', `#at=${node.key}&f=${focus.map(v => v.toFixed(4))}&z=${zoom.toFixed(2)}`)
    }, 500)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <Canvas dpr={PERF.dpr} camera={{ position: [0, 0.55 * CAMERA_DISTANCE, 0.835 * CAMERA_DISTANCE], fov: FOV, near: 0.05, far: 5000 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 10]} intensity={2} />
        <World />
        <OrbitControls enableZoom={false} enablePan={false} />
        {PERF.bloom > 0 && (
          <EffectComposer resolutionScale={PERF.bloom}>
            <Bloom mipmapBlur luminanceThreshold={1} intensity={1} />
          </EffectComposer>
        )}
      </Canvas>
      <Hud />
    </>
  )
}
