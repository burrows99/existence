// Prepare the Earth's real surface from public-domain data:
//   public/data/earth/elevation.png  2048×1024 equirectangular. R: land relief 0–6400 m (for the globe's bump and
//                                    displacement maps); G,B: the elevation in metres + 11000, high byte first
//                                    (NOAA ETOPO2v2 2-arc-minute ice-surface grid, box-averaged to 20 km pixels)
//   public/data/earth/blue-marble.jpg NASA Blue Marble, land_shallow_topo_2048 (credit: NASA Earth Observatory)
//   public/data/earth/countries.json  Natural Earth 1:110m admin-0 countries: [{ n: name, r: [[lon, lat, …], …] }]
//   node scripts/earth.mjs <dir with ETOPO2v2c_i2_LSB.bin, blue_marble_2048.jpg, countries110.geojson>
// Sources: https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2/ETOPO2v2-2006/ETOPO2v2c/raw_binary/ETOPO2v2c_i2_LSB.zip
//          https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg
//          https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

const src = process.argv[2]
if (!src) throw new Error('usage: node scripts/earth.mjs <download dir>')
const out = new URL('../public/data/earth/', import.meta.url)
await mkdir(out, { recursive: true })

// ---- elevation ---------------------------------------------------------------------------------------------
const W = 2048, H = 1024
const EW = 10800, EH = 5400 // ETOPO2v2c: cell-centred 2' grid from 180°W, 90°N
const etopo = await readFile(join(src, 'ETOPO2v2c_i2_LSB.bin'))
const px = new Uint8Array(W * H * 3)
let min = Infinity, max = -Infinity
for (let j = 0; j < H; j++) {
  const r0 = Math.floor((j * EH) / H), r1 = Math.floor(((j + 1) * EH) / H)
  for (let i = 0; i < W; i++) {
    const c0 = Math.floor((i * EW) / W), c1 = Math.floor(((i + 1) * EW) / W)
    let sum = 0, n = 0
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) { sum += etopo.readInt16LE((r * EW + c) * 2); n++ }
    const h = Math.round(sum / n)
    min = Math.min(min, h); max = Math.max(max, h)
    const v = Math.max(0, Math.min(65535, h + 11000)), k = (j * W + i) * 3
    px[k] = Math.round((Math.max(0, Math.min(6400, h)) / 6400) * 255)
    px[k + 1] = v >> 8
    px[k + 2] = v & 255
  }
}
await writeFile(new URL('elevation.png', out), png(px, W, H))
console.log(`elevation.png: ${W}×${H}, ${min} m to ${max} m`)

// ---- colour ------------------------------------------------------------------------------------------------
await copyFile(join(src, 'blue_marble_2048.jpg'), new URL('blue-marble.jpg', out))

// ---- countries ---------------------------------------------------------------------------------------------
const geo = JSON.parse(await readFile(join(src, 'countries110.geojson'), 'utf8'))
const countries = geo.features.map(f => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  return { n: f.properties.NAME, r: polys.flat().map(ring => ring.flatMap(([lon, lat]) => [+lon.toFixed(2), +lat.toFixed(2)])) }
})
await writeFile(new URL('countries.json', out), JSON.stringify(countries))
console.log(`countries.json: ${countries.length} countries, ${countries.reduce((n, c) => n + c.r.reduce((m, r) => m + r.length / 2, 0), 0)} points`)

// a minimal PNG encoder: 8-bit RGB, Paeth-filtered rows (the elevation bytes compress twice as well that way)
function png(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h), n = w * 3
  for (let y = 0; y < h; y++) {
    raw[y * (n + 1)] = 4
    for (let x = 0; x < n; x++) {
      const a = x >= 3 ? rgb[y * n + x - 3] : 0, b = y > 0 ? rgb[(y - 1) * n + x] : 0, c = x >= 3 && y > 0 ? rgb[(y - 1) * n + x - 3] : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      raw[y * (n + 1) + 1 + x] = (rgb[y * n + x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
