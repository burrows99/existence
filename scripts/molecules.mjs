// Fetch real structures (NMR entries, so hydrogens are present; PubChem 3D conformers) and write them as
// compact JSON: { id, name, fact, atoms: [[Z, x, y, z], …] } with coordinates in Å about the centroid.
//   node scripts/molecules.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const MOLECULES = [
  { id: '1MYF', name: 'Myoglobin', color: '#d9a066', src: 'pdb',
    fact: 'Stores oxygen in muscle. 153 amino acids folded into eight helices around a haem group whose single iron atom holds the O₂.' },
  { id: '2HIU', name: 'Insulin', color: '#f6b93b', src: 'pdb',
    fact: 'The hormone that tells cells to take up glucose. 51 amino acids in two chains, tied together by sulphur bridges.' },
  { id: '1NAJ', name: 'DNA', color: '#1dd1a1', src: 'pdb',
    fact: 'Twelve base pairs of B-DNA, the Dickerson dodecamer CGCGAATTCGCG. Each phosphorus on the backbone carries a negative charge; the bases pair A–T and G–C down the middle.' },
  { id: '5957', name: 'ATP', color: '#feca57', src: 'pubchem',
    fact: 'Adenosine triphosphate, the energy currency of every cell. Snapping off its last phosphate releases the energy that powers almost everything a cell does.' },
  { id: '5793', name: 'Glucose', color: '#ff9ff3', src: 'pubchem',
    fact: 'C₆H₁₂O₆, the sugar your cells burn. Blood carries about a teaspoon of it at any moment.' },
  // lipids: oriented head-up (+Y) so membranes can stand them along the surface normal
  { id: 'POV', name: 'Phospholipid (POPC)', color: '#f5cd79', src: 'ccd', lipid: true, head: 15,
    fact: 'A phosphatidylcholine: a charged phosphate head that loves water and two fatty-acid tails that hate it. Billions of them, tails inward, make every membrane in you.' },
  { id: 'CLR', name: 'Cholesterol', color: '#e8c872', src: 'ccd', lipid: true, head: 8,
    fact: 'Four stiff carbon rings wedged between the phospholipids. About a third of the lipids in an animal cell membrane are cholesterol, which keeps the membrane firm.' },
]

const elements = JSON.parse(await readFile(new URL('../src/data/elements.json', import.meta.url), 'utf8'))
const Z = Object.fromEntries(elements.map(e => [e[1].toUpperCase(), e[0]]))

function parsePdb(text) {
  const atoms = []
  for (const line of text.split('\n')) {
    if (line.startsWith('ENDMDL')) break // first NMR model only
    if (!/^(ATOM|HETATM)/.test(line)) continue
    const sym = line.slice(76, 78).trim().toUpperCase()
    if (!Z[sym]) throw new Error(`unknown element ${sym}: ${line}`)
    atoms.push([Z[sym], +line.slice(30, 38), +line.slice(38, 46), +line.slice(46, 54)])
  }
  return atoms
}

function parseSdf(text) {
  const lines = text.split('\n')
  const n = +lines[3].slice(0, 3)
  return lines.slice(4, 4 + n).map(l => {
    const [x, y, z, sym] = l.trim().split(/\s+/)
    return [Z[sym.toUpperCase()], +x, +y, +z]
  })
}

const dist = (a, b) => Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3])
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l) }

await mkdir(new URL('../public/data/molecules/', import.meta.url), { recursive: true })
const index = []
for (const m of MOLECULES) {
  const url = m.src === 'pdb' ? `https://files.rcsb.org/download/${m.id}.pdb`
    : m.src === 'ccd' ? `https://files.rcsb.org/ligands/download/${m.id}_ideal.sdf`
    : `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${m.id}/SDF?record_type=3d`
  const text = await (await fetch(url)).text()
  const atoms = m.src === 'pdb' ? parsePdb(text) : parseSdf(text)
  const c = [1, 2, 3].map(i => atoms.reduce((a, p) => a + p[i], 0) / atoms.length)
  for (const a of atoms) for (let i = 1; i <= 3; i++) a[i] -= c[i - 1]
  const out = { id: m.id, name: m.name, fact: m.fact, color: m.color, diameter: 0, atoms }
  if (m.lipid) {
    // head = first atom of the head element; tail end = the heavy atom farthest from it; rotate head−tail onto +Y
    const H = atoms.find(a => a[0] === m.head)
    const T = atoms.filter(a => a[0] !== 1).reduce((b, a) => (dist(a, H) > dist(b, H) ? a : b))
    const ax = norm([H[1] - T[1], H[2] - T[2], H[3] - T[3]])
    const v = [-ax[2], 0, ax[0]], s = Math.hypot(...v), cth = ax[1] // ax × ŷ, |ax × ŷ|, ax · ŷ
    const k = (1 - cth) / (s * s)
    const R = [
      [1 + k * (-v[2] * v[2] - v[1] * v[1]), -v[2] + k * v[0] * v[1], v[1] + k * v[0] * v[2]],
      [v[2] + k * v[0] * v[1], 1 + k * (-v[2] * v[2] - v[0] * v[0]), -v[0] + k * v[1] * v[2]],
      [-v[1] + k * v[0] * v[2], v[0] + k * v[1] * v[2], 1 + k * (-v[1] * v[1] - v[0] * v[0])],
    ]
    for (const a of atoms) {
      const [x, y, z] = [a[1], a[2], a[3]]
      for (let i = 0; i < 3; i++) a[i + 1] = R[i][0] * x + R[i][1] * y + R[i][2] * z
    }
    out.head = [H[1], H[2], H[3]].map(x => +x.toFixed(2))
    out.tail = [T[1], T[2], T[3]].map(x => +x.toFixed(2))
  }
  let radius = 0
  for (const a of atoms) {
    for (let i = 1; i <= 3; i++) a[i] = +a[i].toFixed(2)
    radius = Math.max(radius, Math.hypot(a[1], a[2], a[3]) + elements[a[0] - 1][6] / 100)
  }
  out.diameter = +(2 * radius).toFixed(2)
  await writeFile(new URL(`../public/data/molecules/${m.id}.json`, import.meta.url), JSON.stringify(out))
  index.push({ id: m.id, name: m.name, atoms: atoms.length, diameter: out.diameter })
  console.log(`${m.name}: ${atoms.length} atoms, ${out.diameter} Å across`)
}
await writeFile(new URL('../public/data/molecules/index.json', import.meta.url), JSON.stringify(index))
