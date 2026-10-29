import { MIN_ZOOM, maxZoom, useCam } from './engine/camera'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ancestry, kindOf, kindsLoaded, subscribeKinds } from './engine/tree'
import { LANDMARKS, index, lookup, type Entry } from './engine/search'

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

const pct = (z: number) => ((maxZoom() - z) / (maxZoom() - MIN_ZOOM)) * 100

// type a name (a galaxy, a star, a planet, a cluster, a void…) and go there; the list is built on first focus
function Search() {
  const [things, setThings] = useState<Entry[]>([])
  const go = (text: string) => lookup(text).then(t => { if (t) location.hash = t.href })
  return (
    <form className="search" role="search" onSubmit={e => { e.preventDefault(); go((e.currentTarget.elements[0] as HTMLInputElement).value) }}>
      <input type="search" list="things" placeholder="Go to… Andromeda, Proxima Centauri, Jupiter, Boötes Void" aria-label="Go to"
        onFocus={() => things.length || index().then(setThings)}
        onChange={e => { const v = e.target.value; if (things.some(t => t.name.toLowerCase() === v.toLowerCase())) go(v) }} />
      <datalist id="things">{things.map(t => <option key={t.name} value={t.name}>{t.what}</option>)}</datalist>
    </form>
  )
}

export function Hud() {
  const node = useCam(s => s.node)
  const zoomTo = useCam(s => s.zoomTo)
  const loaded = useSyncExternalStore(subscribeKinds, kindsLoaded)
  // inside something alive (the meadow) the facts change as you watch: refresh them every second
  const [tick, setTick] = useState(0)
  const live = useMemo(() => ancestry(node).some(n => kindOf(n.kind)?.version), [node, loaded])
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [live])
  // the breadcrumb only changes with the node (not every frame of a zoom): collapse runs of the same title (the
  // water octree), keeping the smallest
  const { info, marks } = useMemo(() => {
    const path = ancestry(node).map(n => ({ n, title: kindOf(n.kind)?.info(n).title ?? '…' }))
    return { info: kindOf(node.kind)?.info(node), marks: path.filter((p, i) => path[i + 1]?.title !== p.title) }
  }, [node, loaded, tick])
  // labels sit at their true size but never closer than 2.4% of the ruler
  const tops = marks.map(m => pct(Math.log10(m.n.metres)))
  for (let i = 1; i < tops.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + 2.4)
  // the size readout and the ruler's marker follow the zoom every frame, straight into the DOM: a React render of
  // the whole HUD per frame was a millisecond of every zoom
  const sizeRef = useRef<HTMLDivElement>(null), friendlyRef = useRef<HTMLDivElement>(null), markerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let shown = NaN
    const show = (zoom: number) => {
      if (zoom === shown) return
      shown = zoom
      if (sizeRef.current) sizeRef.current.textContent = scientific(zoom)
      if (friendlyRef.current) friendlyRef.current.textContent = friendly(zoom) ?? 'below the smallest SI unit'
      if (markerRef.current) markerRef.current.style.top = `${pct(zoom)}%`
    }
    show(useCam.getState().zoom)
    return useCam.subscribe(s => show(s.zoom))
  }, [])

  return (
    <>
      <div className="hud">
        <div className="size" ref={sizeRef} />
        <div className="friendly" ref={friendlyRef} />
        <div className="path">{marks.map(p => p.title).join(' › ')}</div>
        {info && (
          <div className="info">
            <h1>{info.title}</h1>
            <p>{info.fact}</p>
          </div>
        )}
        <div className="hint">Click a thing to fly to it · scroll to zoom into whatever is under the cursor · drag to look around · click the ruler to zoom back out</div>
      </div>
      <nav className="landmarks" aria-label="Go to">
        {LANDMARKS.map(([label, href]) => <a key={label} href={href}>{label}</a>)}
      </nav>
      <Search />

      <nav className="ruler" aria-label="Where you are">
        <div className="marker" ref={markerRef} />
        {marks.map(({ n, title }, i) => (
          <button key={n.key} style={{ top: `${tops[i]}%` }} onClick={() => zoomTo(Math.log10(n.metres) + 0.2)}>
            {title}
          </button>
        ))}
      </nav>
    </>
  )
}
