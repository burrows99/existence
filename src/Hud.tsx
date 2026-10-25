import { MIN_ZOOM, maxZoom, useCam } from './engine/camera'
import { useSyncExternalStore } from 'react'
import { ancestry, kindOf, kindsLoaded, subscribeKinds } from './engine/tree'
import { PERSON } from './kinds/earth'
import { EARTH_KEY } from './kinds/solar'

const PERSON_KEY = `${EARTH_KEY}.${PERSON.path}`
const LANDMARKS: [string, string][] = [
  ['Solar system', '#at=s&z=13.1'],
  ['The Sun', '#at=s.8&z=9.3'],
  ['Earth', `#at=${EARTH_KEY}&z=7.25`],
  ['A person', `#at=${PERSON_KEY}&z=0.35`],
  ['A muscle cell', `#at=${PERSON_KEY}&f=0.06,-0.1,0.02&z=-4.8`],
  ['Molecules', `#at=${PERSON_KEY}&f=0.06,-0.1,0.02&z=-8.4`],
  ['Atoms', `#at=${PERSON_KEY}&f=0.06,-0.1,0.02&z=-9.6`],
]

const UNITS: [number, string][] = [
  [9.461e24, 'billion light-years'],
  [9.461e21, 'million light-years'],
  [9.461e15, 'light-years'],
  [1.496e11, 'AU'],
  [1e3, 'km'],
  [1, 'm'],
  [1e-3, 'mm'],
  [1e-6, 'µm'],
  [1e-9, 'nm'],
  [1e-12, 'pm'],
  [1e-15, 'fm'],
  [1e-18, 'am'],
  [1e-21, 'zm'],
]

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const sup = (n: number) => String(n).replace('-', '⁻').replace(/\d/g, d => SUP[+d])

function scientific(log: number) {
  const exp = Math.floor(log)
  return `${(10 ** (log - exp)).toFixed(1)} × 10${sup(exp)} m`
}

function friendly(log: number) {
  const metres = 10 ** log
  const unit = UNITS.find(([u]) => metres >= u)
  return unit ? `${(metres / unit[0]).toPrecision(3)} ${unit[1]}` : null
}

export function Hud() {
  const node = useCam(s => s.node)
  const zoom = useCam(s => s.zoom)
  const zoomTo = useCam(s => s.zoomTo)
  useSyncExternalStore(subscribeKinds, kindsLoaded)
  const path = ancestry(node).map(n => ({ n, title: kindOf(n.kind)?.info(n).title ?? '…' }))
  const info = kindOf(node.kind)?.info(node)
  // collapse runs of the same title (the water octree), keeping the smallest
  const marks = path.filter((p, i) => path[i + 1]?.title !== p.title)
  const pct = (z: number) => ((maxZoom() - z) / (maxZoom() - MIN_ZOOM)) * 100
  // labels sit at their true size but never closer than 2.4% of the ruler
  const tops = marks.map(m => pct(Math.log10(m.n.metres)))
  for (let i = 1; i < tops.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + 2.4)

  return (
    <>
      <div className="hud">
        <div className="size">{scientific(zoom)}</div>
        <div className="friendly">{friendly(zoom) ?? 'below the smallest SI unit'}</div>
        <div className="path">{marks.map(p => p.title).join(' › ')}</div>
        {info && (
          <div className="info">
            <h1>{info.title}</h1>
            <p>{info.fact}</p>
          </div>
        )}
        <div className="hint">Scroll to zoom into whatever is under the cursor · drag to look around · click the ruler to zoom back out</div>
      </div>
      <nav className="landmarks" aria-label="Go to">
        {LANDMARKS.map(([label, href]) => <a key={label} href={href}>{label}</a>)}
      </nav>

      <nav className="ruler" aria-label="Where you are">
        <div className="marker" style={{ top: `${pct(zoom)}%` }} />
        {marks.map(({ n, title }, i) => (
          <button key={n.key} style={{ top: `${tops[i]}%` }} onClick={() => zoomTo(Math.log10(n.metres) + 0.2)}>
            {title}
          </button>
        ))}
      </nav>
    </>
  )
}
