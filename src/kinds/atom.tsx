import { useMemo } from 'react'
import { AdditiveBlending, DoubleSide } from 'three'
import { inSphere } from 'maath/random'
import { mulberry32, type ChildSpec, type Far, type Kind, type Node, type Vec3 } from '../engine/tree'
import { element, orbitals, sampleOrbital } from './orbitals.ts'

const FM = 1e-15
const POINT = 1e-18 // experimental upper bound on the size of electrons and quarks
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const sup = (s: string | number) => String(s).replace(/\d/g, d => SUP[+d])
const count = (n: number, word: string) => (n === 0 ? `no ${word}s` : n === 1 ? `1 ${word}` : `${n} ${word}s`)

const CLOUD = 400 // samples per electron
// where the electrons are likely to be: samples of each orbital's probability density, drawn while the atom is open
function cloud(node: Node): Far[] {
  const rng = mulberry32(node.seed ^ 0x9e3779b9)
  const electrons = (node.props.z as number) - ((node.props.q as number) ?? 0)
  const out: Far[] = []
  if (electrons > 0) for (const o of orbitals(electrons)) for (let j = 0; j < CLOUD; j++) {
    const p = sampleOrbital(o, rng)
    out.push({ shape: 'point', color: '#6fe3ff', alpha: 0.55, pos: [p[0] / node.metres, p[1] / node.metres, p[2] / node.metres] })
  }
  return out
}

const atom: Kind = {
  open: 0.5,
  jitter: 5e-12, // bond vibration
  far: n => ({ shape: 'sphere', color: element(n.props.z as number)[5] }),
  children: (node, rng) => {
    const z = node.props.z as number, A = element(z)[3], q = (node.props.q as number) ?? 0
    const d = (A === 1 ? 1.7 : 2.4 * Math.cbrt(A) + 1.7) * FM
    const out: ChildSpec[] = [{ kind: 'nucleus', pos: [0, 0, 0], size: d / node.metres, props: { z, a: A } }]
    if (z - q > 0) for (const o of orbitals(z - q)) { // an ion has the electrons of the element it is isoelectronic with
      const p = sampleOrbital(o, rng)
      out.push({ kind: 'electron', pos: [p[0] / node.metres, p[1] / node.metres, p[2] / node.metres], size: POINT / node.metres, props: { n: o.n, l: o.l } })
    }
    return out
  },
  inner: cloud,
  info: n => {
    const [z, sym, name, A] = element(n.props.z as number), q = (n.props.q as number) ?? 0
    const cfg = z - q > 0 ? element(z - q)[4] : 'none'
    const ratio = n.metres / ((A === 1 ? 1.7 : 2.4 * Math.cbrt(A)) * FM)
    return {
      title: q ? `${name} ion (${sym}${q > 0 ? '⁺' : '⁻'})` : `${name} atom`,
      fact: `${count(z, 'proton')}, ${count(A - z, 'neutron')}, ${count(z - q, 'electron')} (${cfg.replace(/(\d+)$|(\d+)(?= )/g, s => sup(s))})${q ? `: it has ${q > 0 ? 'lost' : 'gained'} one, which is what makes it an ion` : ''}. ${Math.round(n.metres * 1e12)} pm across; the nucleus is ${ratio.toExponential(0).replace('e+', ' × 10').replace(/10(\d+)/, (_, e) => '10' + sup(e))} times smaller. Everything else is where the electrons might be.`,
    }
  },
}

const electron: Kind = {
  far: () => ({ shape: 'sphere', color: '#48dbfb', glow: true, minPx: 3 }),
  info: n => ({
    title: 'Electron',
    fact: `In the ${n.props.n}${'spdf'[n.props.l as number]} orbital. Charge −1, 1/1836 of a proton's mass, and point-like: no size has been found down to 10⁻¹⁸ m. This dot is one place a measurement could find it; the cloud is everywhere it might be.`,
  }),
}

// ---- nucleus: protons and neutrons packed at nuclear density ----

// random sequential addition of hard spheres (min distance d) inside a sphere of radius rc
function pack(count: number, rc: number, rng: () => number): Vec3[] {
  const pts: Vec3[] = []
  let d = 1.7 * FM
  while (pts.length < count) {
    let placed = false
    for (let t = 0; t < 200 && !placed; t++) {
      const r = rc * Math.cbrt(rng()), z = 2 * rng() - 1, ph = 2 * Math.PI * rng(), s = Math.sqrt(1 - z * z)
      const p: Vec3 = [r * s * Math.cos(ph), r * s * Math.sin(ph), r * z]
      if (pts.every(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) >= d)) { pts.push(p); placed = true }
    }
    if (!placed) d *= 0.95 // ponytail: RSA jams near 38% packing; loosen the spacing rather than relax properly
  }
  return pts
}

const nucleus: Kind = {
  open: 0.3,
  far: () => ({ shape: 'sphere', color: '#feca57', glow: true, minPx: 2 }),
  children: (node, rng) => {
    const z = node.props.z as number, A = node.props.a as number
    const pts = pack(A, A === 1 ? 0 : 1.2 * Math.cbrt(A) * FM - 0.3 * FM, rng)
    const order = pts.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    return pts.map((p, i) => ({
      kind: 'nucleon', pos: p.map(v => v / node.metres) as Vec3, size: (1.7 * FM) / node.metres, props: { q: order[i] < z ? 1 : 0 },
    }))
  },
  info: n => {
    const [z, , name, A] = element(n.props.z as number)
    return {
      title: `${name} nucleus`,
      fact: `${count(z, 'proton')}${A > z ? ` and ${count(A - z, 'neutron')}` : ''}, held together by the strong force. Nearly all of the atom's mass, at 10¹⁷ kg/m³: a teaspoon of this would weigh a billion tonnes.`,
    }
  },
}

function Gluons({ node }: { node: Node }) {
  const positions = useMemo(() => inSphere(new Float32Array(600 * 3), { radius: 0.45 }) as Float32Array, [])
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial color={node.props.q ? '#ff7a3d' : '#8fa3bf'} transparent opacity={0.2} depthWrite={false} side={DoubleSide} />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={2} sizeAttenuation={false} color="#ffd29a" transparent opacity={0.6} blending={AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  )
}

const nucleon: Kind = {
  open: 0.3,
  jitter: 0.3 * FM, // Fermi motion
  far: n => ({ shape: 'sphere', color: n.props.q ? '#ff7a3d' : '#8fa3bf' }),
  children: (node, rng) => ['u', node.props.q ? 'u' : 'd', 'd'].map((f, i) => {
    const r = 0.3 * Math.cbrt(rng()), z = 2 * rng() - 1, ph = 2 * Math.PI * rng(), s = Math.sqrt(1 - z * z)
    return { kind: 'quark', pos: [r * s * Math.cos(ph), r * s * Math.sin(ph), r * z] as Vec3, size: POINT / node.metres, props: { f, c: 'rgb'[i] } }
  }),
  Near: Gluons,
  info: n => n.props.q
    ? { title: 'Proton', fact: 'Two up quarks and one down quark (charge +1), bound by gluons. About 1.7 fm across; almost all of its mass is the energy of the field between the quarks, not the quarks themselves.' }
    : { title: 'Neutron', fact: 'One up quark and two down quarks (charge 0). On its own it decays in about 15 minutes; inside a nucleus it is stable.' },
}

const QCOL: Record<string, string> = { r: '#ff3b3b', g: '#3bff6b', b: '#3b8bff' }
const quark: Kind = {
  jitter: 0.25 * FM, // confinement
  far: n => ({ shape: 'sphere', color: QCOL[n.props.c as string], glow: true, minPx: 4 }),
  info: n => ({
    title: `${n.props.f === 'u' ? 'Up' : 'Down'} quark`,
    fact: `Charge ${n.props.f === 'u' ? '+⅔' : '−⅓'}, colour charge ${{ r: 'red', g: 'green', b: 'blue' }[n.props.c as string]}. Point-like as far as anyone can tell: no size or inner structure has been found down to 10⁻¹⁸ m. This is the bottom of what is known.`,
  }),
}

export const kinds = { atom, electron, nucleus, nucleon, quark }
