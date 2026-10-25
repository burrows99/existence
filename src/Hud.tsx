import { useScale } from './store'
import { MAX_ZOOM, MIN_ZOOM, SCALES } from './scales'

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

const top = (z: number) => ((MAX_ZOOM - z) / (MAX_ZOOM - MIN_ZOOM)) * 100

// push labels apart so close scales (proton/nucleus) don't overlap; SCALES is sorted small→large
const LABEL_TOP: number[] = []
for (let i = SCALES.length - 1; i >= 0; i--) {
  const prev = LABEL_TOP[i + 1]
  LABEL_TOP[i] = prev === undefined ? top(SCALES[i].size) : Math.max(top(SCALES[i].size), prev + 2.2)
}

export function Hud() {
  const zoom = useScale(s => s.zoom)
  const zoomTo = useScale(s => s.zoomTo)
  const near = SCALES.reduce((a, b) => (Math.abs(b.size - zoom) < Math.abs(a.size - zoom) ? b : a))
  const inRange = Math.abs(near.size - zoom) < 1.5

  return (
    <>
      <div className="hud">
        <div className="size">{scientific(zoom)}</div>
        <div className="friendly">{friendly(zoom) ?? 'smaller than anything measured'}</div>
        {inRange ? (
          <div className="info">
            <h1>
              {near.label}
              {near.speculative && <span className="tag">speculative</span>}
            </h1>
            <p>{near.fact}</p>
          </div>
        ) : (
          <div className="info">
            <p>No known structure at this scale.</p>
          </div>
        )}
        <div className="hint">Scroll or pinch to zoom · drag to rotate · click the ruler to jump</div>
      </div>

      <nav className="ruler" aria-label="Scale ruler">
        <div className="marker" style={{ top: `${top(zoom)}%` }} />
        {SCALES.map((s, i) => (
          <button key={s.id} style={{ top: `${LABEL_TOP[i]}%`, color: s.color }} onClick={() => zoomTo(s.size)}>
            {s.label}
          </button>
        ))}
      </nav>
    </>
  )
}
