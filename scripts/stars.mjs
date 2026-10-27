// The real stars around the Sun, from the HYG database (v3, CC BY-SA 2.5, https://astronexus.com/hyg): every star
// with a proper name and everything within 25 light-years. Written as public/data/stars.json:
//   [[name, x, y, z (light-years from the Sun in the galaxy's frame: +x away from the galactic centre, +y north,
//     +z along galactic longitude 90°), radius (suns), temperature (K), luminosity (suns), distance (ly), spectral type], …]
//   node scripts/stars.mjs <hygdata_v3.csv>
import { readFile, writeFile } from 'node:fs/promises'

const csv = await readFile(process.argv[2], 'utf8')
const [head, ...rows] = csv.trim().split('\n')
const col = Object.fromEntries(head.split(',').map((k, i) => [k, i]))
const PC = 3.26156 // light-years per parsec
// J2000 equatorial → galactic (Hipparcos vol. 1, §1.5)
const G = [[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.44482963, 0.7469822445], [-0.867666149, -0.1980763734, 0.4559837762]]
const TYPE_T = { O: 35000, B: 15000, A: 8500, F: 6800, G: 5700, K: 4500, M: 3200, L: 2000, T: 1300 }

const out = []
for (const row of rows) {
  const f = row.split(',')
  const name = f[col.proper], dist = +f[col.dist]
  if (name === 'Sol' || dist >= 99999) continue
  if (!name && dist * PC > 25) continue
  const eq = [+f[col.x], +f[col.y], +f[col.z]]
  const gal = G.map(r => r[0] * eq[0] + r[1] * eq[1] + r[2] * eq[2])
  const ci = f[col.ci] === '' ? null : +f[col.ci], spect = f[col.spect]
  const T = Math.round(ci !== null ? 4600 * (1 / (0.92 * ci + 1.7) + 1 / (0.92 * ci + 0.62)) : TYPE_T[spect[0]] ?? 5000)
  const lum = +f[col.lum] || 1
  const r = Math.sqrt(lum) * (5772 / T) ** 2
  out.push([name || '', ...[-gal[0], gal[2], gal[1]].map(v => +(v * PC).toFixed(3)), +r.toFixed(3), T, +lum.toPrecision(3), +(dist * PC).toFixed(2), spect])
}
out.sort((a, b) => a[7] - b[7])
await writeFile(new URL('../public/data/stars.json', import.meta.url), JSON.stringify(out))
console.log(`${out.length} stars; nearest ${out[0][0] || out[0][8]} at ${out[0][7]} ly; ${out.filter(s => s[0]).length} named`)
