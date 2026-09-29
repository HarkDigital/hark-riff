/*
 * Small procedural tiles for the DOM layer (loader, menu, rotate card),
 * drawn once on tiny canvases and handed to CSS as data URLs — the same
 * materials the 3D stage is made of, so the UI and the scene share one
 * visual language:
 *
 *   weave()   BASKETWEAVE GRILLE CLOTH, woven on the diagonal — the exact
 *             weave of kit/materials.ts grilleMap() and of the cab cut in
 *             core/post.ts (8 cells across a tile, three threads a cell,
 *             each thread diving under its neighbour). `lit` draws the
 *             threads white on black (a multiply layer: whatever glows
 *             behind it shows through the threads); `wheat` draws the
 *             gold-wheat cloth itself.
 *   tolex()   the fine pebble grain of black amp tolex / road-case laminate
 *             (a transparent speckle to lay over a flat dark colour).
 *
 * Cost: a 128² tile is ~16k pixel writes, well under a millisecond; each
 * tile is built once per page (cached) and only when a caller asks for it.
 * Blocked canvases (privacy modes) just return '' and the CSS falls back
 * to its flat colour.
 */

const cache = new Map<string, string>()

/** a tiny seeded PRNG, so the cloth is the same on every visit */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function paint(key: string, size: number, draw: (img: ImageData, size: number) => void) {
  const hit = cache.get(key)
  if (hit != null) return hit
  let url = ''
  try {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')
    if (g) {
      const img = g.createImageData(size, size)
      draw(img, size)
      g.putImageData(img, 0, 0)
      url = c.toDataURL('image/png')
    }
  } catch {
    url = ''
  }
  cache.set(key, url)
  return url
}

/**
 * Basketweave grille cloth (the kit's weave). `lit`: white threads on black
 * (for mix-blend-mode: multiply over a glow); `wheat`: the gold-wheat cloth.
 */
export function weave(kind: 'lit' | 'wheat' = 'lit', size = 128) {
  const col = kind === 'wheat' ? [206, 164, 104] : [255, 255, 255]
  const base = kind === 'wheat' ? [5, 4, 3] : [0, 0, 0]
  return paint(`weave-${kind}-${size}`, size, (img, w) => {
    const r = rng(kind.length * 7 + 3)
    const tone: number[] = Array.from({ length: 64 }, () => 0.8 + r() * 0.35)
    const cells = 8 // cells across the tile (the diagonal wraps on 8, so it tiles)
    const d = img.data
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const px = (x / w) * cells
        const py = (y / w) * cells
        const qx = px + py
        const qy = px - py + cells
        const ix = Math.floor(qx)
        const iy = Math.floor(qy)
        const fx = qx - ix
        const fy = qy - iy
        const hor = (ix + iy) % 2 === 0
        const across = hor ? fy : fx
        const along = hor ? fx : fy
        const th = (across * 3) % 1
        const tid = Math.floor(across * 3)
        const prof = Math.sqrt(Math.max(Math.sin(Math.PI * th), 0))
        const dive = 0.45 + 0.55 * Math.sin(Math.PI * along)
        const t = tone[(ix * 3 + iy * 5 + tid * 7) & 63]
        const v = Math.min(1, prof * dive * t)
        const i = (y * w + x) * 4
        d[i] = Math.min(255, base[0] + col[0] * v)
        d[i + 1] = Math.min(255, base[1] + col[1] * v)
        d[i + 2] = Math.min(255, base[2] + col[2] * v)
        d[i + 3] = 255
      }
  })
}

/**
 * Tolex / road-case pebble grain: a fine pebble (two octaves of value noise,
 * ~2 CSS px pebbles at the intended 64 px tile size) as faint light tops and
 * dark valleys on transparent.
 */
export function tolex(size = 128) {
  return paint(`tolex-${size}`, size, (img, w) => {
    const r = rng(41)
    const d = img.data
    const field = (g: number) => {
      const lattice = Array.from({ length: g * g }, () => r())
      const at = (ix: number, iy: number) => lattice[((iy + g) % g) * g + ((ix + g) % g)]
      return (x: number, y: number) => {
        const fx = (x / w) * g
        const fy = (y / w) * g
        const ix = Math.floor(fx)
        const iy = Math.floor(fy)
        let tx = fx - ix
        let ty = fy - iy
        tx = tx * tx * (3 - 2 * tx)
        ty = ty * ty * (3 - 2 * ty)
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx
        return a + (b - a) * ty
      }
    }
    const fine = field(42)
    const coarse = field(8)
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        // pebbles, very gently modulated by a broad field (no visible clouds)
        const n = fine(x, y) * 0.9 + coarse(x, y) * 0.1
        const i = (y * w + x) * 4
        if (n > 0.52) {
          d[i] = 255
          d[i + 1] = 238
          d[i + 2] = 210
          d[i + 3] = Math.round(Math.min(1, (n - 0.52) * 2.6) * 15)
        } else {
          d[i] = d[i + 1] = d[i + 2] = 0
          d[i + 3] = Math.round(Math.min(1, (0.52 - n) * 2.4) * 28)
        }
      }
  })
}

/** `url("…")` for CSS, or 'none' when the canvas was blocked. */
export const cssUrl = (u: string) => (u ? `url("${u}")` : 'none')

/**
 * Publish the tiles as CSS custom properties on :root (--tx-weave-lit,
 * --tx-weave-wheat, --tx-tolex), in a <style> of their own — not on <html>'s
 * inline style, which the hero rewrites with its mark rect.
 */
export function publishTextures(which: ('lit' | 'wheat' | 'tolex')[]) {
  let el = document.getElementById('rf-textures') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'rf-textures'
    document.head.appendChild(el)
  }
  const have = el.textContent ?? ''
  let add = ''
  for (const k of which) {
    const name = k === 'tolex' ? '--tx-tolex' : `--tx-weave-${k}`
    if (have.includes(`${name}:`) || add.includes(`${name}:`)) continue
    add += `${name}:${cssUrl(k === 'tolex' ? tolex() : weave(k))};`
  }
  if (add) el.textContent = `${have}:root{${add}}`
}
