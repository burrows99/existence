import { create } from 'zustand'
import { MathUtils } from 'three'
import { MAX_ZOOM, MIN_ZOOM } from './scales'

// zoom = log10(metres across the view). The whole app hangs off this one number.
type ScaleState = {
  zoom: number
  target: number
  zoomTo: (target: number) => void
  zoomBy: (decades: number) => void
  step: (dt: number) => void
}

// deep link: #z=-14.2 opens at that scale
const start = MathUtils.clamp(Number(location.hash.match(/z=(-?[\d.]+)/)?.[1] ?? 0.24), MIN_ZOOM, MAX_ZOOM)

export const useScale = create<ScaleState>((set, get) => ({
  zoom: start,
  target: start,
  zoomTo: target => set({ target: MathUtils.clamp(target, MIN_ZOOM, MAX_ZOOM) }),
  zoomBy: decades => get().zoomTo(get().target + decades),
  step: dt => {
    const { zoom, target } = get()
    if (Math.abs(target - zoom) < 1e-4) return
    // ponytail: long jumps (e.g. ruler clicks across 40 decades) take ~2 s regardless of distance
    set({ zoom: MathUtils.damp(zoom, target, 3, dt) })
  },
}))
