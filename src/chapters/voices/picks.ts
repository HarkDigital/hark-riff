import * as THREE from 'three'
import { FONT } from '../../kit/materials'
import { rng } from '../../core/math'

/*
 * THE PICKS — eight custom guitar picks in the classic 351 shape (a wide,
 * rounded triangle), thin extruded celluloid with a hairline bevel. Each
 * celluloid is a procedural pattern (tortoiseshell, aged cream, black, red
 * pearloid, white pearloid, honey amber, tobacco pearloid, slate pearloid), and each
 * pick is printed with a client's company name the way custom band picks
 * are: Anybody caps and a Yellowtail script word, in gold foil on the dark
 * celluloids and in ink on the light ones.
 *
 * Everything is drawn into ONE small atlas (4 × 2 cells) plus a matching
 * roughness / metalness atlas (foil glints, ink is matte), so the eight picks
 * are eight tiny geometries that differ only in their UVs. Units: 1 = 10 cm,
 * so a pick is 0.266 wide and 0.306 tall (26.6 × 30.6 mm), 1.2 mm thick.
 *
 * Pick local space: the face is +Z, the rounded top is +Y, the tip -Y.
 */

export const PICK_W = 0.266
export const PICK_H = 0.306
const THICK = 0.008
const BEVEL = 0.002

export type Celluloid = 'tortoise' | 'cream' | 'black' | 'oxblood' | 'pearl' | 'amber' | 'tobacco' | 'slate'

interface Line {
  text: string
  face: 'display' | 'script'
  /** cap height as a fraction of the pick height */
  size: number
  /** baseline-centre y in pick units (+ up) */
  y: number
  /** extra letter spacing (em) for display lines */
  track?: number
}

export interface PickDesign {
  celluloid: Celluloid
  /** print colour (sRGB css) and whether it's metallic foil */
  ink: string
  foil: boolean
  lines: Line[]
  /** a hairline border following the pick outline */
  border?: boolean
  /** a small ornament under the name */
  ornament?: 'star' | 'rule' | 'dots'
}

/** CSS approximations of each celluloid (the DOM card's pick badge) */
export const CELLULOID_CSS: Record<Celluloid, { bg: string; ink: string }> = {
  tortoise: { bg: 'radial-gradient(circle at 30% 30%, #d89040 0%, #8a4414 38%, #3a1606 70%, #1a0903 100%)', ink: '#f0cf8a' },
  cream: { bg: 'linear-gradient(160deg, #fbf1da 0%, #eadbb6 60%, #d9c396 100%)', ink: '#7a2018' },
  black: { bg: 'linear-gradient(160deg, #2a2320 0%, #0e0b0a 60%, #050404 100%)', ink: '#f0cf8a' },
  oxblood: { bg: 'radial-gradient(circle at 35% 30%, #b8443a 0%, #7a1c16 45%, #3e0a07 100%)', ink: '#f0cf8a' },
  pearl: { bg: 'radial-gradient(circle at 30% 28%, #ffffff 0%, #ece6dc 40%, #c7beb2 100%)', ink: '#1a1412' },
  amber: { bg: 'radial-gradient(circle at 32% 30%, #ffe2a0 0%, #f4c055 45%, #c98a1c 100%)', ink: '#2a1206' },
  tobacco: { bg: 'radial-gradient(circle at 34% 30%, #8a5228 0%, #4a2610 50%, #1e0e06 100%)', ink: '#f3e6cc' },
  slate: { bg: 'radial-gradient(circle at 34% 30%, #b8b2aa 0%, #6a6560 45%, #2e2a28 100%)', ink: '#f3e6cc' },
}

/* ---------------------------------------------------------------- shape */

/** The 351 outline: the convex hull of two big shoulder circles and a small tip circle. */
export function pickOutline(): THREE.Vector2[] {
  const circles: [number, number, number][] = [
    [-0.064, 0.085, 0.069],
    [0.064, 0.085, 0.069],
    [0, -0.1225, 0.0305],
    // a soft belly on each side so the flanks aren't ruler-straight
    [-0.052, -0.012, 0.078],
    [0.052, -0.012, 0.078],
  ]
  const pts: THREE.Vector2[] = []
  for (const [cx, cy, r] of circles)
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r))
    }
  // monotone-chain convex hull (counter-clockwise)
  pts.sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: THREE.Vector2[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: THREE.Vector2[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  // resample evenly (the hull has long straight runs and dense arcs)
  const curve = new THREE.CatmullRomCurve3(
    hull.map(p => new THREE.Vector3(p.x, p.y, 0)),
    true,
    'centripetal',
  )
  return curve.getSpacedPoints(120).slice(0, -1).map(p => new THREE.Vector2(p.x, p.y))
}

/** half-width of the outline at height y (pick units) */
function halfWidthAt(outline: THREE.Vector2[], y: number) {
  let w = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % outline.length]
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) {
      const t = (y - a.y) / (b.y - a.y)
      w = Math.max(w, Math.abs(a.x + (b.x - a.x) * t))
    }
  }
  return w
}

/* ---------------------------------------------------------------- celluloid */

/** smooth value noise (non-tiling; the cells are drawn whole) */
function makeNoise(seed: number) {
  const r = rng(seed)
  const P = 64
  const g = Array.from({ length: P * P }, () => r())
  const at = (x: number, y: number) => g[(((y % P) + P) % P) * P + (((x % P) + P) % P)]
  const n = (x: number, y: number) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    let fx = x - ix
    let fy = y - iy
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    const a = at(ix, iy)
    const b = at(ix + 1, iy)
    const c = at(ix, iy + 1)
    const d = at(ix + 1, iy + 1)
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
  }
  const fbm = (x: number, y: number, oct = 4) => {
    let s = 0
    let amp = 0.5
    let f = 1
    for (let o = 0; o < oct; o++) {
      s += amp * n(x * f, y * f)
      f *= 2.03
      amp *= 0.5
    }
    return s / (1 - Math.pow(0.5, oct))
  }
  return { n, fbm }
}

/** cellular (Voronoi) flakes for pearloid: returns [cell value, edge distance] */
function makeCells(seed: number) {
  const r = rng(seed)
  const P = 32
  const jx = Array.from({ length: P * P }, () => r())
  const jy = Array.from({ length: P * P }, () => r())
  const val = Array.from({ length: P * P }, () => r())
  const idx = (x: number, y: number) => (((y % P) + P) % P) * P + (((x % P) + P) % P)
  return (x: number, y: number): [number, number] => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    let d1 = 9
    let d2 = 9
    let v = 0
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const k = idx(ix + ox, iy + oy)
        const px = ix + ox + jx[k]
        const py = iy + oy + jy[k]
        const d = (px - x) * (px - x) + (py - y) * (py - y)
        if (d < d1) {
          d2 = d1
          d1 = d
          v = val[k]
        } else if (d < d2) d2 = d
      }
    return [v, Math.sqrt(d2) - Math.sqrt(d1)]
  }
}

type RGB = [number, number, number]
const hex = (h: string): RGB => {
  const c = new THREE.Color(h)
  return [c.r * 255, c.g * 255, c.b * 255]
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The celluloid's colour at (u, v) in 0..1 across the cell (per-pixel, so a
 * phone can draw the same pattern at half size). Deterministic per kind.
 */
function celluloidFn(kind: Celluloid): (u: number, v: number) => RGB {
  const seed = { tortoise: 3, cream: 5, black: 7, oxblood: 11, pearl: 13, amber: 17, tobacco: 19, slate: 23 }[kind]
  const { fbm } = makeNoise(seed)
  const cells = makeCells(seed * 3 + 1)
  const pearloid = (dark: RGB, mid: RGB, light: RGB, hi: RGB) => (u: number, v: number): RGB => {
    // flakes sheared along a flow, each at its own brightness, with a pearly sheen inside
    const wx = u * 7 + 1.6 * fbm(u * 2.2, v * 2.2)
    const wy = v * 4.2 + 1.1 * fbm(u * 2.2 + 5, v * 2.2 + 3)
    const [cv, edge] = cells(wx, wy)
    const sheen = fbm(u * 9 + cv * 7, v * 9, 3)
    let c = mix(dark, mid, sstep(0.05, 0.55, cv))
    c = mix(c, light, sstep(0.5, 0.95, cv * 0.7 + sheen * 0.45))
    c = mix(c, hi, sstep(0.72, 0.98, sheen) * 0.55)
    // hairline seams between flakes
    return mix(c, dark, (1 - sstep(0.0, 0.06, edge)) * 0.35)
  }
  switch (kind) {
    case 'tortoise': {
      const light = hex('#e09a44')
      const mid = hex('#9a4c16')
      const dark = hex('#2a1004')
      return (u, v) => {
        const w = fbm(u * 2.5, v * 2.5)
        const n = fbm(u * 4 + w * 2.2, v * 5 - w * 1.4)
        const spot = fbm(u * 11 + 3, v * 11 + 1, 3)
        let c = mix(light, mid, sstep(0.36, 0.52, n))
        c = mix(c, dark, sstep(0.5, 0.66, n))
        c = mix(c, dark, sstep(0.66, 0.8, spot) * 0.8)
        return mix(c, light, sstep(0.72, 0.9, 1 - n) * 0.35)
      }
    }
    case 'cream': {
      const a = hex('#f4e8cc')
      const b = hex('#e2cfa4')
      return (u, v) => {
        const s = fbm(u * 3 + fbm(u * 2, v * 2) * 1.2, v * 9)
        return mix(a, b, sstep(0.35, 0.75, s) * 0.7)
      }
    }
    case 'black': {
      const a = hex('#0c0a09')
      const b = hex('#221c19')
      return (u, v) => mix(a, b, sstep(0.55, 0.85, fbm(u * 3 + fbm(u * 2, v * 2) * 1.5, v * 3)) * 0.8)
    }
    case 'amber': {
      // honey amber: translucent-looking flow lines, light and yellow
      const a = hex('#d69426')
      const b = hex('#f4c45e')
      const c2 = hex('#ffe4a4')
      return (u, v) => {
        const w = fbm(u * 2, v * 2)
        const s = fbm(u * 3 + w * 2, v * 6 - w)
        let c = mix(a, b, sstep(0.25, 0.7, s))
        c = mix(c, c2, sstep(0.72, 0.92, s) * 0.6)
        return c
      }
    }
    case 'pearl':
      return pearloid(hex('#9c948a'), hex('#c4bcb0'), hex('#e0d9cd'), hex('#f2ece2'))
    case 'oxblood':
      return pearloid(hex('#3e0907'), hex('#7c1a14'), hex('#b0392e'), hex('#e0776a'))
    case 'tobacco':
      return pearloid(hex('#1e0d05'), hex('#4c2611'), hex('#7e4a24'), hex('#b07a48'))
    case 'slate':
      return pearloid(hex('#1c1a19'), hex('#46423f'), hex('#7a7570'), hex('#b4aea6'))
  }
}

/* ---------------------------------------------------------------- atlas */

export interface PickAtlas {
  map: THREE.CanvasTexture
  orm: THREE.CanvasTexture
  /** a small PNG of each printed pick, cut to its outline (the quote card's badge) */
  minis: string[]
  /** uv rect of cell i: [u0, v0, u1, v1] */
  cell(i: number): [number, number, number, number]
}

const COLS = 4
const ROWS = 2
/** the square of pick space one cell covers (a hair larger than the pick) */
const SPAN = 0.33

/**
 * Draw the eight picks' faces (celluloid + print) and their foil/ink
 * roughness-metalness. `cellPx` 256 on phones, 512 on desktop. Yields
 * between cells through `yieldFn`.
 */
export async function drawAtlas(designs: PickDesign[], cellPx: number, yieldFn: () => Promise<void>): Promise<PickAtlas> {
  const W = cellPx * COLS
  const H = cellPx * ROWS
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  const cvO = document.createElement('canvas')
  cvO.width = W
  cvO.height = H
  const o = cvO.getContext('2d')!
  // ORM: G = roughness, B = metalness. Celluloid: glossy, not metal.
  o.fillStyle = 'rgb(0, 60, 0)'
  o.fillRect(0, 0, W, H)
  const outline = pickOutline()
  // the celluloid is computed at half the cell size and scaled up (it's soft):
  // ~15–25 ms a cell on a laptop, a quarter of the work of drawing it full size
  const pat = cellPx / 2
  const tmp = document.createElement('canvas')
  tmp.width = tmp.height = pat
  const tg = tmp.getContext('2d')!

  for (let i = 0; i < designs.length; i++) {
    const d = designs[i]
    const cx = (i % COLS) * cellPx
    const cy = Math.floor(i / COLS) * cellPx
    // celluloid
    const fn = celluloidFn(d.celluloid)
    const img = tg.createImageData(pat, pat)
    for (let y = 0; y < pat; y++)
      for (let x = 0; x < pat; x++) {
        const c = fn(x / pat, y / pat)
        const k = (y * pat + x) * 4
        img.data[k] = c[0]
        img.data[k + 1] = c[1]
        img.data[k + 2] = c[2]
        img.data[k + 3] = 255
      }
    tg.putImageData(img, 0, 0)
    g.imageSmoothingEnabled = true
    g.drawImage(tmp, cx, cy, cellPx, cellPx)
    printPick(g, o, d, outline, cx, cy, cellPx)
    await yieldFn()
  }

  // miniatures for the DOM cards, cut from the atlas before it goes to the GPU
  const minis: string[] = []
  {
    const mw = 80
    const mh = Math.round((mw * PICK_H) / 0.266)
    const m = document.createElement('canvas')
    m.width = mw
    m.height = mh
    const mg = m.getContext('2d')!
    const k = mh / PICK_H
    for (let i = 0; i < designs.length; i++) {
      mg.clearRect(0, 0, mw, mh)
      mg.save()
      mg.beginPath()
      outline.forEach((p, j) => (j ? mg.lineTo(mw / 2 + p.x * k, mh / 2 - p.y * k) : mg.moveTo(mw / 2 + p.x * k, mh / 2 - p.y * k)))
      mg.closePath()
      mg.clip()
      // the cell spans SPAN pick units; draw it so the pick fills the canvas
      const cellK = cellPx / SPAN
      const sx = (i % COLS) * cellPx + cellPx / 2 - (mw / 2 / k) * cellK
      const sy = Math.floor(i / COLS) * cellPx + cellPx / 2 - (mh / 2 / k) * cellK
      mg.drawImage(cv, sx, sy, (mw / k) * cellK, (mh / k) * cellK, 0, 0, mw, mh)
      // a lacquer sheen across the shoulder
      const sheen = mg.createLinearGradient(0, 0, mw, mh)
      sheen.addColorStop(0, 'rgba(255,248,230,0.28)')
      sheen.addColorStop(0.35, 'rgba(255,248,230,0)')
      mg.fillStyle = sheen
      mg.fillRect(0, 0, mw, mh)
      mg.restore()
      try {
        minis.push(m.toDataURL('image/png'))
      } catch {
        minis.push('')
      }
    }
  }

  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    // free the canvas once it's on the GPU (a lost context reloads the page)
    t.onUpdate = () => {
      c.width = c.height = 1
      t.onUpdate = null
    }
    return t
  }
  return {
    map: mk(cv, true),
    orm: mk(cvO, false),
    minis,
    cell(i) {
      const c = i % COLS
      const r = Math.floor(i / COLS)
      // canvas rows run down; uv v runs up (flipY)
      return [c / COLS, 1 - (r + 1) / ROWS, (c + 1) / COLS, 1 - r / ROWS]
    },
  }
}

/** print one pick's name into its cell (colour atlas `g`, roughness/metal atlas `o`) */
function printPick(g: CanvasRenderingContext2D, o: CanvasRenderingContext2D, d: PickDesign, outline: THREE.Vector2[], cx: number, cy: number, px: number) {
  const k = px / SPAN
  const X = (x: number) => cx + px / 2 + x * k
  const Y = (y: number) => cy + px / 2 - y * k
  // the ORM value of the print: foil glints (metal, fairly smooth), ink is matte
  const orm = d.foil ? 'rgb(0, 128, 150)' : 'rgb(0, 150, 0)'
  const both = (fn: (c: CanvasRenderingContext2D, ink: string) => void) => {
    fn(g, d.ink)
    fn(o, orm)
  }
  // clip to the pick's face (a hair inside the edge)
  const clip = (c: CanvasRenderingContext2D) => {
    c.save()
    c.beginPath()
    outline.forEach((p, j) => (j ? c.lineTo(X(p.x * 0.97), Y(p.y * 0.97)) : c.moveTo(X(p.x * 0.97), Y(p.y * 0.97))))
    c.closePath()
    c.clip()
  }
  clip(g)
  clip(o)

  if (d.border) {
    both((c, ink) => {
      c.strokeStyle = ink
      c.lineWidth = Math.max(1, 0.0032 * k)
      c.beginPath()
      outline.forEach((p, j) => (j ? c.lineTo(X(p.x * 0.86), Y(p.y * 0.86 + 0.004)) : c.moveTo(X(p.x * 0.86), Y(p.y * 0.86 + 0.004))))
      c.closePath()
      c.stroke()
    })
  }

  for (const ln of d.lines) {
    const capPx = ln.size * PICK_H * k
    // font size from the cap height (Anybody caps ≈ 0.7 em; Yellowtail's ≈ 0.62)
    const size = ln.face === 'display' ? capPx / 0.7 : capPx / 0.6
    const font = ln.face === 'display' ? FONT.display(size, 860) : FONT.script(size)
    const maxW = 2 * halfWidthAt(outline, ln.y + ln.size * PICK_H * 0.5) * 0.8 * k
    both((c, ink) => {
      c.save()
      c.font = font
      c.fillStyle = ink
      c.textAlign = 'center'
      c.textBaseline = 'alphabetic'
      const track = (ln.track ?? 0) * size
      const chars = [...ln.text]
      const widths = chars.map(ch => c.measureText(ch).width)
      const natural = ln.face === 'display' && track ? widths.reduce((s, w) => s + w, 0) + track * (chars.length - 1) : c.measureText(ln.text).width
      // display lines are set wide (Anybody pushed ~115%), then fit to the chord
      const wide = ln.face === 'display' ? 1.14 : 1
      const sx = Math.min(wide, maxW / Math.max(1, natural))
      c.translate(X(0), Y(ln.y))
      c.scale(sx, 1)
      if (ln.face === 'display' && track) {
        let x = -natural / 2
        c.textAlign = 'left'
        chars.forEach((ch, j) => {
          c.fillText(ch, x, 0)
          x += widths[j] + track
        })
      } else c.fillText(ln.text, 0, 0)
      c.restore()
    })
  }

  if (d.ornament) {
    const y = Math.min(...d.lines.map(l => l.y)) - 0.03
    both((c, ink) => {
      c.fillStyle = ink
      c.strokeStyle = ink
      if (d.ornament === 'star') {
        const r = 0.011 * k
        c.beginPath()
        for (let j = 0; j < 10; j++) {
          const a = -Math.PI / 2 + (j * Math.PI) / 5
          const rr = j % 2 ? r * 0.42 : r
          c.lineTo(X(0) + Math.cos(a) * rr, Y(y) + Math.sin(a) * rr)
        }
        c.closePath()
        c.fill()
      } else if (d.ornament === 'rule') {
        c.lineWidth = Math.max(1, 0.003 * k)
        c.beginPath()
        c.moveTo(X(-0.035), Y(y + 0.006))
        c.lineTo(X(0.035), Y(y + 0.006))
        c.stroke()
      } else {
        for (const dx of [-0.018, 0, 0.018]) {
          c.beginPath()
          c.arc(X(dx), Y(y + 0.004), 0.0042 * k, 0, Math.PI * 2)
          c.fill()
        }
      }
    })
  }
  g.restore()
  o.restore()
}

/* ---------------------------------------------------------------- geometry */

let baseGeo: THREE.ExtrudeGeometry | null = null

/** the extruded pick, centred on its thickness (shared base; copies differ in UVs) */
function pickBase() {
  if (baseGeo) return baseGeo
  const shape = new THREE.Shape(pickOutline())
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: THICK,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 2,
    curveSegments: 1,
  })
  g.translate(0, 0, -THICK / 2)
  baseGeo = g
  return g
}

/** a pick geometry whose faces sample atlas cell `rect` */
export function pickGeometry(rect: [number, number, number, number]) {
  const g = pickBase().clone()
  const pos = g.attributes.position
  const nor = g.attributes.normal
  const uv = g.attributes.uv
  const [u0, v0, u1, v1] = rect
  for (let i = 0; i < pos.count; i++) {
    // the back is printed too (mirrored so it reads from behind)
    const back = nor.getZ(i) < -0.5
    const x = back ? -pos.getX(i) : pos.getX(i)
    const y = pos.getY(i)
    const s = x / SPAN + 0.5
    const t = y / SPAN + 0.5
    uv.setXY(i, u0 + (u1 - u0) * s, v0 + (v1 - v0) * t)
  }
  uv.needsUpdate = true
  return g
}

/** the celluloid itself: glossy lacquer-like plastic; pearloids shimmer */
export function pickMaterial(atlas: PickAtlas, kind: Celluloid) {
  const pearly = kind === 'pearl' || kind === 'oxblood' || kind === 'tobacco' || kind === 'slate'
  const m = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map: atlas.map,
    roughnessMap: atlas.orm,
    metalnessMap: atlas.orm,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    iridescence: pearly ? 0.55 : 0,
    iridescenceIOR: 1.4,
    iridescenceThicknessRange: [180, 520],
    envMapIntensity: 0.9,
  })
  return m
}
