// Orbital maths with no dependencies, so node can test it: Kepler ellipses for the bodies astronomy-engine does not
// know, and the belts' density and size distribution. node --test src/kinds/orbits.test.ts

// a, e, i, Ω, ω (J2000 ecliptic, degrees), period (years), perihelion passage (as a year)
export type Elements = [number, number, number, number, number, number, number]
const D = Math.PI / 180

// heliocentric ecliptic position (AU) at a decimal year, from the elements alone: no perturbations, so approximate
export function kepler([a, e, i, O, w, P, tp]: Elements, year: number) {
  const M = (2 * Math.PI * (year - tp)) / P
  let E = M
  for (let k = 0; k < 30; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)), r = a * (1 - e * Math.cos(E))
  const ci = Math.cos(i * D), si = Math.sin(i * D), cO = Math.cos(O * D), sO = Math.sin(O * D), cu = Math.cos(w * D + nu), su = Math.sin(w * D + nu)
  return { x: r * (cO * cu - sO * su * ci), y: r * (sO * cu + cO * su * ci), z: r * su * si }
}

// a belt: n bodies over dmin km in a ring r1..r2 AU with edges softened over w AU, Gaussian in height with scale
// h × r (h ≈ the typical inclination in radians); sizes follow N(>D) ∝ D⁻ᑫ up to brk km and D⁻ᑫ² beyond, capped at dmax
export type Belt = { r1: number; r2: number; w: number; h: number; n: number; dmin: number; q: number; brk: number; q2: number; dmax: number }

// bodies per AU³ in the midplane: the ring's volume with the Gaussian tails on both edges counted in
export const peak = (b: Belt) => b.n / (2 * Math.PI * Math.sqrt(2 * Math.PI) * b.h * ((b.r2 ** 3 - b.r1 ** 3) / 3 + (Math.sqrt(Math.PI) / 2) * b.w * (b.r1 ** 2 + b.r2 ** 2)))
// bodies per AU³ at radius r and height z (AU)
export function density(b: Belt, r: number, z: number) {
  const d = Math.max(0, b.r1 - r, r - b.r2)
  return peak(b) * Math.exp(-((d / b.w) ** 2) - 0.5 * (z / (b.h * r + 1e-9)) ** 2)
}
// a diameter in km from the belt's size distribution
export function diameter(b: Belt, rng: () => number) {
  const d = b.dmin * rng() ** (-1 / b.q)
  return Math.min(b.dmax, d > b.brk ? b.brk * rng() ** (-1 / b.q2) : d)
}
