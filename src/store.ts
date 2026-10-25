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

export const useScale = create<ScaleState>((set, get) => ({
  zoom: 0.24,
  target: 0.24,
  zoomTo: target => set({ target: MathUtils.clamp(target, MIN_ZOOM, MAX_ZOOM) }),
  zoomBy: decades => get().zoomTo(get().target + decades),
  step: dt => {
    const { zoom, target } = get()
    if (Math.abs(target - zoom) < 1e-4) return
    // ponytail: long jumps (e.g. ruler clicks across 40 decades) take ~2 s regardless of distance
    set({ zoom: MathUtils.damp(zoom, target, 3, dt) })
  },
}))
