/**
 * Generates the LFG HQ source icon (1024×1024 PNG) with no image dependencies.
 *
 * The mark is three sheared bars — a forward-motion glyph — on a dark squircle,
 * drawn with 3× supersampling so the edges stay clean when the Tauri CLI
 * downscales it to 32px for the tray.
 *
 *   node scripts/generate-icon.mjs
 *   npx tauri icon src-tauri/icons/source.png
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SIZE = 1024
const SS = 3 // supersampling factor per axis

// --- palette (sRGB, matching the app's design tokens) ----------------------
const BG_TOP = [26, 28, 36]
const BG_BOTTOM = [15, 16, 21]
const BORDER = [44, 47, 60]
const MARK_START = [124, 108, 240] // primary violet
const MARK_END = [95, 216, 232] // signal cyan

// --- geometry --------------------------------------------------------------
const CORNER = 224
const SHEAR = 0.32
const BAR_TOP = 322
const BAR_BOTTOM = 702
const BAR_WIDTH = 88
const BAR_GAP = 46
const BAR_COUNT = 3
const MARK_SPAN = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP
const MARK_LEFT = (SIZE - MARK_SPAN) / 2

const lerp = (a, b, t) => a + (b - a) * t
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Signed distance from a point to a rounded rectangle; negative is inside. */
function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius))
  const cy = Math.max(top + radius, Math.min(y, bottom - radius))
  const dx = x - cx
  const dy = y - cy
  const d = Math.hypot(dx, dy)
  const inCore = x >= left + radius || x <= right - radius
  if (d === 0 && inCore) {
    // Inside the straight-edged core: distance to the nearest edge.
    return -Math.min(x - left, right - x, y - top, bottom - y)
  }
  return d - radius
}

/** True when the sample falls inside one of the sheared bars. */
function barIndexAt(x, y) {
  if (y < BAR_TOP || y > BAR_BOTTOM) return -1
  const u = x + SHEAR * (y - SIZE / 2)
  const offset = u - MARK_LEFT
  if (offset < 0 || offset > MARK_SPAN) return -1
  const slot = Math.floor(offset / (BAR_WIDTH + BAR_GAP))
  const within = offset - slot * (BAR_WIDTH + BAR_GAP)
  return within <= BAR_WIDTH ? slot : -1
}

// --- rasterise -------------------------------------------------------------
const pixels = Buffer.alloc(SIZE * SIZE * 4)

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0

    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS
        const y = py + (sy + 0.5) / SS

        const dist = roundedRectDistance(x, y, 0, 0, SIZE, SIZE, CORNER)
        const inside = clamp01(0.5 - dist)
        if (inside <= 0) continue

        // Background gradient, with a hairline border near the outer edge.
        let colour = mixRgb(BG_TOP, BG_BOTTOM, y / SIZE)
        const edge = clamp01((dist + 5) / 4)
        colour = mixRgb(colour, BORDER, edge * 0.85)

        const bar = barIndexAt(x, y)
        if (bar >= 0) {
          const t = clamp01((x - MARK_LEFT + SHEAR * 200) / (MARK_SPAN + SHEAR * 400))
          colour = mixRgb(MARK_START, MARK_END, t)
        }

        r += colour[0] * inside
        g += colour[1] * inside
        b += colour[2] * inside
        a += inside
      }
    }

    const samples = SS * SS
    const i = (py * SIZE + px) * 4
    if (a > 0) {
      // Un-premultiply so the stored colour is correct at partial coverage.
      pixels[i] = Math.round(r / a)
      pixels[i + 1] = Math.round(g / a)
      pixels[i + 2] = Math.round(b / a)
      pixels[i + 3] = Math.round((a / samples) * 255)
    }
  }
}

// --- PNG encoding ----------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type: RGBA
ihdr[10] = 0 // deflate
ihdr[11] = 0 // adaptive filtering
ihdr[12] = 0 // no interlace

// One filter byte (0 = None) per scanline.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = resolve(import.meta.dirname, '../src-tauri/icons/source.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`Wrote ${out} (${(png.length / 1024).toFixed(1)} KB)`)
