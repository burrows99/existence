// A star: a ball of plasma, protons and helium nuclei and the electrons stripped off them, densest at the core.
import { Color } from 'three'
import type { Vec3 } from '../engine/tree'
import { rootProps, volume, volumeRoot, type Volume } from './volume'

const BLOCK = 1.3e-6 // the blocks of plasma a star is divided into
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])

// the colour of a star by surface temperature
export function starColor(T: number) {
  return T < 3700 ? '#ffb27a' : T < 5200 ? '#ffd9a6' : T < 6000 ? '#fff3dc' : T < 7500 ? '#f5f6ff' : T < 10000 ? '#cbd8ff' : '#9fb4ff'
}

function Glow({ node }: { node: { props: Record<string, number | string>; metres: number } }) {
  const R = (node.props.r as number) / node.metres
  return (
    <mesh>
      <sphereGeometry args={[R, 48, 32]} />
      <meshBasicMaterial color={new Color(starColor(node.props.t as number)).multiplyScalar(2.5)} toneMapped={false} />
    </mesh>
  )
}

const star: Volume = {
  leafDepth: root => Math.round(Math.log2(root.metres / BLOCK)),
  open: (r, root) => (r.depth >= Math.round(Math.log2(root.metres / BLOCK)) ? 0.15 : 0.1),
  Near: Glow,

  // nucleon density: ~9 × 10³¹ per m³ at the Sun's core, ~10²³ at the photosphere
  fill: (r, _rng, leaf) => {
    const root = volumeRoot(leaf), x = (len(r.c) * root.metres) / (root.props.r as number)
    if (x > 1) return []
    const d = 9e31 * Math.exp(-12 * x * x) + 2e23
    return [{ kind: 'fluid', pos: [0, 0, 0], size: 1, props: { ...rootProps, f: 'plasma', d, he: 0.08 } }]
  },

  far: (r, node) => {
    const root = volumeRoot(node), R = (root.props.r as number) / root.metres
    if (r.depth === 0) return { shape: 'sphere', color: starColor(root.props.t as number), glow: true, scale: 2 * R, minPx: 3 }
    if (r.depth < 10) return null // the glowing sphere is the picture
    return len(r.c) < R ? { shape: 'haze', color: '#ffd080' } : null
  },

  info: (r, node) => {
    const root = volumeRoot(node)
    if (r.depth < 6) return { title: root.props.name as string, fact: root.props.fact as string }
    const x = (len(r.c) * root.metres) / (root.props.r as number)
    return x > 1
      ? { title: 'Corona', fact: 'The thin outer atmosphere of the star, a million degrees hot and all but empty.' }
      : { title: x < 0.25 ? 'Core' : x < 0.7 ? 'Radiative zone' : 'Convective zone',
          fact: x < 0.25 ? 'Where hydrogen fuses into helium at 15 million degrees. The real density here is 150 times that of water; it is drawn far thinner.'
            : x < 0.7 ? 'Light made in the core takes a hundred thousand years to random-walk out through this.'
            : 'Hot plasma boiling upward in cells the size of a country.' }
  },
}

export const kinds = { star: volume(star) }
