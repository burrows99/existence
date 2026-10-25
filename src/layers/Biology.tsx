import { useMemo } from 'react'
import { Instance, Instances, MeshDistortMaterial } from '@react-three/drei'
import { Quaternion, Vector3 } from 'three'

type V3 = [number, number, number]

// rotation that points a Y-aligned geometry (cylinder, capsule) along dir
const UP = new Vector3(0, 1, 0)
const alongY = (dir: V3) => new Quaternion().setFromUnitVectors(UP, new Vector3(...dir).normalize())

// evenly spread points on a sphere
function fibonacciSphere(n: number, r: number): V3[] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n, s = Math.sqrt(1 - y * y)
    return [Math.cos(golden * i) * s * r, y * r, Math.sin(golden * i) * s * r]
  })
}

// B-DNA: 2 nm wide (1 unit), 0.34 nm rise and 34.3° twist per base pair.
const RISE = 0.17
const TWIST = (34.3 * Math.PI) / 180
const GROOVE = (150 * Math.PI) / 180 // strands are offset, giving the major/minor grooves
const PAIRS = [['#ff6b6b', '#feca57'], ['#feca57', '#ff6b6b'], ['#48dbfb', '#1dd1a1'], ['#1dd1a1', '#48dbfb']] // A–T, T–A, G–C, C–G

export function Dna() {
  const bases = useMemo(() => Array.from({ length: 120 }, (_, i) => {
    const y = (i - 60) * RISE, a = i * TWIST
    return { y, a, pair: PAIRS[Math.floor(Math.random() * 4)] }
  }), [])
  const strand = (y: number, a: number): V3 => [Math.cos(a) * 0.45, y, Math.sin(a) * 0.45]

  return (
    <group rotation={[0, 0, 0.35]}>
      <Instances limit={240}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial roughness={0.35} />
        {bases.flatMap(({ y, a }, i) => [
          <Instance key={`a${i}`} position={strand(y, a)} color="#dfe6ee" />,
          <Instance key={`b${i}`} position={strand(y, a + GROOVE)} color="#a4b0be" />,
        ])}
      </Instances>
      <Instances limit={240}>
        <cylinderGeometry args={[0.035, 0.035, 1, 8]} />
        <meshStandardMaterial roughness={0.5} />
        {bases.flatMap(({ y, a, pair }, i) => {
          // each base runs from its strand to the middle of the rung
          const A = strand(y, a), B = strand(y, a + GROOVE)
          const mid: V3 = [(A[0] + B[0]) / 2, y, (A[2] + B[2]) / 2]
          return [A, B].map((p, j) => {
            const dir: V3 = [p[0] - mid[0], 0, p[2] - mid[2]]
            return (
              <Instance
                key={`${i}${j}`}
                position={[(p[0] + mid[0]) / 2, y, (p[2] + mid[2]) / 2]}
                quaternion={alongY(dir)}
                scale={[1, Math.hypot(dir[0], dir[2]), 1]}
                color={pair[j]}
              />
            )
          })
        })}
      </Instances>
    </group>
  )
}

// Influenza: a fatty envelope studded with protein spikes. Drawn 1 unit = 100 nm.
export function Virus() {
  const spikes = useMemo(() => fibonacciSphere(260, 0.42), [])
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.42, 48, 48]} />
        <MeshDistortMaterial color="#c0566a" roughness={0.6} distort={0.12} speed={1.5} />
      </mesh>
      <Instances limit={spikes.length}>
        <cylinderGeometry args={[0.012, 0.006, 0.12, 6]} />
        <meshStandardMaterial roughness={0.4} />
        {spikes.map((p, i) => {
          const len = Math.hypot(...p)
          const tip: V3 = [p[0] / len * 0.48, p[1] / len * 0.48, p[2] / len * 0.48]
          return <Instance key={i} position={tip} quaternion={alongY(p)} color={i % 6 ? '#ffb8c2' : '#ffe08a'} />
        })}
      </Instances>
    </group>
  )
}

// A human cell, 1 unit = 20 µm: membrane, nucleus at the centre (where the DNA lives), mitochondria.
export function Cell() {
  const mito = useMemo(() => Array.from({ length: 70 }, () => {
    const r = 0.2 + Math.random() * 0.22, t = Math.random() * Math.PI * 2, z = Math.random() * 2 - 1, s = Math.sqrt(1 - z * z)
    return {
      position: [Math.cos(t) * s * r, z * r, Math.sin(t) * s * r] as V3,
      rotation: [Math.random() * 3, Math.random() * 3, Math.random() * 3] as V3,
    }
  }), [])
  const vesicles = useMemo(() => fibonacciSphere(160, 1).map(p => p.map(x => x * (0.18 + Math.random() * 0.27)) as V3), [])

  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.5, 64, 64]} />
        <MeshDistortMaterial color="#f368e0" roughness={0.3} distort={0.15} speed={0.6} transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.15, 48, 48]} />
        <MeshDistortMaterial color="#8e44ad" emissive="#2c0a3a" roughness={0.5} distort={0.1} speed={0.8} transparent opacity={0.85} />
      </mesh>
      <Instances limit={mito.length}>
        <capsuleGeometry args={[0.012, 0.045, 4, 8]} />
        <meshStandardMaterial color="#ff9f43" roughness={0.5} />
        {mito.map((m, i) => <Instance key={i} {...m} />)}
      </Instances>
      <Instances limit={vesicles.length}>
        <sphereGeometry args={[0.008, 8, 8]} />
        <meshStandardMaterial color="#c8d6e5" roughness={0.3} />
        {vesicles.map((p, i) => <Instance key={i} position={p} />)}
      </Instances>
    </group>
  )
}
