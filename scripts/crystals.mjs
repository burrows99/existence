// Fetch mineral structures from the Crystallography Open Database and write unit cells as JSON:
// { id, name, fact, color, cell: [a, b, c] (Å vectors), atoms: [[Z, x, y, z, occupancy], …] (Å, inside the cell) }
//   node scripts/crystals.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const MINERALS = [
  { id: 'forsterite', cod: 1572959, name: 'Olivine (forsterite)', color: '#7a8a3a',
    fact: 'Mg₂SiO₄, the mineral most of the upper mantle is made of: magnesium and silicate tetrahedra in an orthorhombic lattice. Green when you can see a crystal of it.' },
  { id: 'quartz', cod: 5000035, name: 'Quartz', color: '#c9c3b6',
    fact: 'SiO₂: every silicon bonded to four oxygens, every oxygen to two silicons, in a helical lattice. The commonest mineral of the continents.' },
  { id: 'hydroxylapatite', cod: 9002213, name: 'Hydroxylapatite', color: '#efe9d8',
    fact: 'Ca₁₀(PO₄)₆(OH)₂, the mineral of bone and teeth, laid down by cells on a scaffold of collagen.' },
  { id: 'iron', name: 'Iron (hexagonal close-packed)', color: '#8a8a95', hcp: [2.466, 4.04],
    fact: 'Iron atoms stacked as tightly as spheres can be. At the pressure of the inner core they sit 15% closer than this.' },
]

const elements = JSON.parse(await readFile(new URL('../src/data/elements.json', import.meta.url), 'utf8'))
const Z = Object.fromEntries(elements.map(e => [e[1].toUpperCase(), e[0]]))

function parseCif(text) {
  const lines = text.split('\n').map(l => l.trim())
  const num = tag => +lines.find(l => l.startsWith(tag + ' ')).split(/\s+/)[1].replace(/\(.*\)/, '')
  const cell = ['a', 'b', 'c'].map(k => num('_cell_length_' + k))
  const ang = ['alpha', 'beta', 'gamma'].map(k => num('_cell_angle_' + k))
  // symmetry operations: a loop of 'x,y,z'-style strings
  let ops = []
  const si = lines.findIndex(l => l === '_symmetry_equiv_pos_as_xyz' || l === '_space_group_symop_operation_xyz')
  if (si >= 0) {
    for (let i = si + 1; i < lines.length && lines[i] && !lines[i].startsWith('_') && lines[i] !== 'loop_'; i++) {
      const m = lines[i].match(/'?([-+xyz0-9/., ]+)'?$/)
      if (m) ops.push(m[1].replace(/\s/g, ''))
    }
  }
  if (!ops.length) ops = ['x,y,z']
  // atom sites: a loop whose columns we discover
  const ai = lines.findIndex(l => l.startsWith('_atom_site_label'))
  let hi = ai
  while (lines[hi - 1]?.startsWith('_atom_site_')) hi--
  const cols = []
  let i = hi
  for (; lines[i]?.startsWith('_atom_site_'); i++) cols.push(lines[i].split(/\s+/)[0])
  const col = name => cols.indexOf(name)
  const sites = []
  for (; i < lines.length && lines[i] && !lines[i].startsWith('_') && !lines[i].startsWith('loop_'); i++) {
    const f = lines[i].split(/\s+/)
    const label = f[col('_atom_site_label')]
    const sym = col('_atom_site_type_symbol') >= 0 ? f[col('_atom_site_type_symbol')] : label
    const el = sym.match(/^[A-Z][a-z]?/)[0]
    const get = c => +f[col(c)].replace(/\(.*\)/, '')
    sites.push({ z: Z[el.toUpperCase()], f: [get('_atom_site_fract_x'), get('_atom_site_fract_y'), get('_atom_site_fract_z')], occ: col('_atom_site_occupancy') >= 0 ? get('_atom_site_occupancy') : 1 })
  }
  return { cell, ang, ops, sites }
}

// fractional → cartesian cell vectors (a along x, b in the xy plane)
function vectors([a, b, c], [al, be, ga]) {
  const r = d => (d * Math.PI) / 180
  const cb = Math.cos(r(be)), cg = Math.cos(r(ga)), sg = Math.sin(r(ga)), ca = Math.cos(r(al))
  const cx = c * cb, cy = (c * (ca - cb * cg)) / sg, cz = Math.sqrt(c * c - cx * cx - cy * cy)
  return [[a, 0, 0], [b * cg, b * sg, 0], [cx, cy, cz]]
}

function expand({ cell, ang, ops, sites }) {
  const V = vectors(cell, ang)
  const out = []
  const seen = []
  for (const s of sites) for (const op of ops) {
    const f = new Function('x', 'y', 'z', `return [${op}]`)(...s.f).map(v => ((v % 1) + 1) % 1)
    if (seen.some(t => t.z === s.z && Math.max(...[0, 1, 2].map(i => Math.min(Math.abs(t.f[i] - f[i]), 1 - Math.abs(t.f[i] - f[i])))) < 1e-3)) continue
    seen.push({ z: s.z, f })
    const p = [0, 1, 2].map(i => f[0] * V[0][i] + f[1] * V[1][i] + f[2] * V[2][i])
    out.push([s.z, ...p.map(x => +x.toFixed(3)), s.occ])
  }
  return { cell: V.map(v => v.map(x => +x.toFixed(4))), atoms: out }
}

await mkdir(new URL('../public/data/crystals/', import.meta.url), { recursive: true })
for (const m of MINERALS) {
  let data
  if (m.hcp) {
    const [a, c] = m.hcp
    data = expand({ cell: [a, a, c], ang: [90, 90, 120], ops: ['x,y,z'], sites: [{ z: 26, f: [1 / 3, 2 / 3, 1 / 4], occ: 1 }, { z: 26, f: [2 / 3, 1 / 3, 3 / 4], occ: 1 }] })
  } else {
    const text = await (await fetch(`https://www.crystallography.net/cod/${m.cod}.cif`)).text()
    data = expand(parseCif(text))
  }
  const out = { id: m.id, name: m.name, fact: m.fact, color: m.color, cod: m.cod, ...data }
  await writeFile(new URL(`../public/data/crystals/${m.id}.json`, import.meta.url), JSON.stringify(out))
  const vol = Math.abs(data.cell[0][0] * (data.cell[1][1] * data.cell[2][2] - data.cell[1][2] * data.cell[2][1]))
  console.log(`${m.name}: ${data.atoms.length} atoms per cell, ${vol.toFixed(1)} Å³, ${(data.atoms.reduce((n, a) => n + a[4], 0) / vol).toFixed(3)} atoms/Å³`)
}
