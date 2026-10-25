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

await mkdir(new URL('../public/data/molecules/', import.meta.url), { recursive: true })
const index = []
for (const m of MOLECULES) {
  const url = m.src === 'pdb'
    ? `https://files.rcsb.org/download/${m.id}.pdb`
    : `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${m.id}/SDF?record_type=3d`
  const text = await (await fetch(url)).text()
  const atoms = m.src === 'pdb' ? parsePdb(text) : parseSdf(text)
  const c = [1, 2, 3].map(i => atoms.reduce((a, p) => a + p[i], 0) / atoms.length)
  let radius = 0
  for (const a of atoms) {
    for (let i = 1; i <= 3; i++) a[i] = +(a[i] - c[i - 1]).toFixed(2)
    radius = Math.max(radius, Math.hypot(a[1], a[2], a[3]) + elements[a[0] - 1][6] / 100)
  }
  const out = { id: m.id, name: m.name, fact: m.fact, color: m.color, diameter: +(2 * radius).toFixed(2), atoms }
  await writeFile(new URL(`../public/data/molecules/${m.id}.json`, import.meta.url), JSON.stringify(out))
  index.push({ id: m.id, name: m.name, atoms: atoms.length, diameter: out.diameter })
  console.log(`${m.name}: ${atoms.length} atoms, ${out.diameter} Å across`)
}
await writeFile(new URL('../public/data/molecules/index.json', import.meta.url), JSON.stringify(index))
