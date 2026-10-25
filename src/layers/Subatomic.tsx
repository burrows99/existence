import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Color, type Group, type Points } from 'three'
import { inSphere } from 'maath/random'

// colours pushed above 1 so Bloom picks them up
const glow = (c: string, k = 3) => new Color(c).multiplyScalar(k)
const RED = '#ff3b3b', GREEN = '#3bff6b', BLUE = '#3b8bff'

function Haze({ count, radius, color, size }: { count: number; radius: number; color: string; size: number }) {
  const positions = useMemo(() => inSphere(new Float32Array(count * 3), { radius }) as Float32Array, [count, radius])
  const ref = useRef<Points>(null!)
  useFrame((_, dt) => { ref.current.rotation.y += dt * 0.2; ref.current.rotation.x += dt * 0.07 })
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={color} size={size} transparent opacity={0.6} blending={AdditiveBlending} depthWrite={false} />
    </points>
  )
}

// Point-like: a bright core inside the experimental upper bound (the faint shell).
export function Quark() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshBasicMaterial color={glow(RED, 8)} toneMapped={false} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.5, 3]} />
        <meshBasicMaterial color={RED} wireframe transparent opacity={0.15} />
      </mesh>
      <Haze count={400} radius={0.5} color="#ff9a9a" size={0.01} />
    </group>
  )
}

// uud held together by a gluon field. The red up quark sits at the origin so zooming in lands on it.
export function Proton() {
  const ref = useRef<Group>(null!)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    ref.current.children.forEach((q, i) => {
      if (i === 0) return
      q.position.set(Math.cos(t * (0.9 + i * 0.3) + i * 2) * 0.28, Math.sin(t * (1.1 + i * 0.2) + i) * 0.22, Math.sin(t * 0.7 + i * 3) * 0.25)
    })
  })
  return (
    <group>
      <group ref={ref}>
        {[RED, GREEN, BLUE].map(c => (
          <mesh key={c}>
            <sphereGeometry args={[0.035, 16, 16]} />
            <meshBasicMaterial color={glow(c, 5)} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <Haze count={1500} radius={0.45} color="#ffd29a" size={0.006} />
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshBasicMaterial color="#ff9f43" transparent opacity={0.08} depthWrite={false} />
      </mesh>
    </group>
  )
}

// Carbon-12: 6 protons + 6 neutrons. A proton at the centre lines up with the Proton layer.
const NUCLEON_R = 0.135 // 1.7 fm proton / 6.3 fm nucleus, as a radius
// the 12 icosahedron vertices (0, ±1, ±φ) and their cyclic shifts; 11 of them ring the centre
const PHI = (1 + Math.sqrt(5)) / 2
const ICO = [-1, 1].flatMap(a => [-PHI, PHI].flatMap(b => [[0, a, b], [a, b, 0], [b, 0, a]]))
const k = (NUCLEON_R * 2) / Math.hypot(1, PHI)
const NUCLEONS = [[0, 0, 0], ...ICO.slice(0, 11).map(v => v.map(x => x * k))]

export function Nucleus() {
  return (
    <group>
      {NUCLEONS.map((p, i) => (
        <mesh key={i} position={p as [number, number, number]}>
          <sphereGeometry args={[NUCLEON_R, 32, 32]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? '#ff7a3d' : '#8fa3bf'}
            emissive={i % 2 === 0 ? '#5a1a00' : '#101820'}
            roughness={0.4}
            transparent
            opacity={0.75}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

// Hydrogen 1s orbital: radial density ∝ r² e^(−2r/a₀), sampled as Gamma(3, a₀/2).
const A0 = 0.5 // atom drawn 1 unit across ≈ 2 Bohr radii
function electronCloud(n: number) {
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const r = -(A0 / 2) * Math.log(Math.random() * Math.random() * Math.random())
    const z = Math.random() * 2 - 1, phi = Math.random() * Math.PI * 2, s = Math.sqrt(1 - z * z)
    out.set([r * s * Math.cos(phi), r * s * Math.sin(phi), r * z], i * 3)
  }
  return out
}

export function Atom() {
  const positions = useMemo(() => electronCloud(30000), [])
  return (
    <group>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#48dbfb" size={0.004} transparent opacity={0.5} blending={AdditiveBlending} depthWrite={false} />
      </points>
      {/* the nucleus is really 1/100,000 of the atom: this dot is drawn far too big so you can find it */}
      <mesh>
        <sphereGeometry args={[0.006, 12, 12]} />
        <meshBasicMaterial color={glow('#feca57', 6)} toneMapped={false} />
      </mesh>
    </group>
  )
}
