import * as THREE from 'three'
import { rng } from '../core/math'

/*
 * RIFF materials — one vocabulary of surfaces for every chapter: nickel and
 * chrome hardware, rosewood, mahogany, cream binding plastic, amber "top hat"
 * knobs, mother-of-pearl, tolex, basketweave grille cloth, stage planks,
 * rubber cable. Textures are small procedural canvas TILES (repeat them) —
 * never big canvases per chapter (Silicon's boot-time lesson). Each factory
 * caches its texture, so calling it twice costs nothing.
 *
 * All sizes are in RIFF units: 1 unit = 10 cm (a guitar is ~10 units long).
 */

const cache = new Map<string, THREE.Texture>()

/** A canvas texture tile, drawn once and cached by key. */
export function tile(
  key: string,
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  { srgb = true, repeat = true }: { srgb?: boolean; repeat?: boolean } = {},
): THREE.Texture {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g, w, h)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  // free the canvas once it's on the GPU (a lost context reloads the page).
  // So NEVER .clone() a tile texture to change its repeat — scale the mesh's
  // UVs instead (stage.ts scaleUv): a clone would re-upload a 1x1 canvas.
  tex.onUpdate = () => {
    c.width = c.height = 1
    tex.onUpdate = null
  }
  cache.set(key, tex)
  return tex
}

/** value noise on a small ImageData, tileable (wraps at `period`) */
function noiseTile(g: CanvasRenderingContext2D, w: number, h: number, period: number, seed: number, fn: (n: number, x: number, y: number) => [number, number, number]) {
  const r = rng(seed)
  const grid = Array.from({ length: period * period }, () => r())
  const at = (x: number, y: number) => grid[((y % period) + period) % period * period + (((x % period) + period) % period)]
  const img = g.createImageData(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * period
      const fy = (y / h) * period
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      let tx = fx - ix
      let ty = fy - iy
      tx = tx * tx * (3 - 2 * tx)
      ty = ty * ty * (3 - 2 * ty)
      const n = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty
      const [a, b, c] = fn(n, x, y)
      const i = (y * w + x) * 4
      img.data[i] = a
      img.data[i + 1] = b
      img.data[i + 2] = c
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
}

/* ------------------------------------------------------------------ textures */

/** tolex: pebbled vinyl — a grey bump tile */
export function tolexBump() {
  return tile(
    'tolex',
    128,
    128,
    (g, w, h) => {
      noiseTile(g, w, h, 24, 11, n => {
        const v = 110 + n * 110
        return [v, v, v]
      })
      // pebbles
      const r = rng(4)
      for (let i = 0; i < 900; i++) {
        const x = r() * w
        const y = r() * h
        const s = 0.8 + r() * 1.8
        g.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.18})`
        g.beginPath()
        g.arc(x, y, s, 0, Math.PI * 2)
        g.fill()
      }
    },
    { srgb: false },
  )
}

/** basketweave grille cloth: gold-wheat threads on black, woven on the diagonal */
export function grilleMap(kind: 'wheat' | 'oxblood' | 'salt' = 'wheat') {
  const col = { wheat: [206, 164, 104], oxblood: [128, 36, 30], salt: [196, 192, 184] }[kind]
  return tile('grille-' + kind, 128, 128, (g, w, h) => {
    g.fillStyle = '#050403'
    g.fillRect(0, 0, w, h)
    const img = g.getImageData(0, 0, w, h)
    const r = rng(kind.length * 7)
    const tone: number[] = Array.from({ length: 64 }, () => 0.8 + r() * 0.35)
    const cells = 8 // cells across the tile (must tile: the diagonal wraps on 8)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const px = (x / w) * cells
        const py = (y / h) * cells
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
        const v = prof * dive * t
        const i = (y * w + x) * 4
        img.data[i] = Math.min(255, 5 + col[0] * v)
        img.data[i + 1] = Math.min(255, 4 + col[1] * v)
        img.data[i + 2] = Math.min(255, 3 + col[2] * v)
      }
    g.putImageData(img, 0, 0)
  })
}

/** rosewood fingerboard: dark brown with long streaky grain (x = along the neck) */
export function rosewoodMap() {
  return tile('rosewood', 512, 64, (g, w, h) => {
    noiseTile(g, w, h, 8, 21, n => [44 + n * 22, 24 + n * 12, 16 + n * 8])
    const r = rng(9)
    for (let i = 0; i < 140; i++) {
      const y = r() * h
      const a = 0.08 + r() * 0.22
      g.strokeStyle = r() > 0.5 ? `rgba(12,6,4,${a})` : `rgba(96,52,30,${a * 0.7})`
      g.lineWidth = 0.4 + r() * 1.4
      g.beginPath()
      g.moveTo(0, y)
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 1.6)
      g.stroke()
    }
  })
}

/** mahogany: warm red-brown, fine straight grain */
export function mahoganyMap() {
  return tile('mahogany', 256, 256, (g, w, h) => {
    noiseTile(g, w, h, 6, 31, n => [74 + n * 26, 30 + n * 12, 18 + n * 8])
    const r = rng(13)
    for (let i = 0; i < 160; i++) {
      const y = r() * h
      g.strokeStyle = `rgba(30,10,6,${0.06 + r() * 0.16})`
      g.lineWidth = 0.5 + r()
      g.beginPath()
      g.moveTo(0, y)
      g.bezierCurveTo(w * 0.3, y + r() * 4 - 2, w * 0.6, y + r() * 4 - 2, w, y)
      g.stroke()
    }
  })
}

/** mother-of-pearl: layered swirls of white, pale pink, green and blue */
export function pearlMap() {
  return tile('pearl', 128, 128, (g, w, h) => {
    noiseTile(g, w, h, 5, 41, (n, x, y) => {
      const s = Math.sin(n * 18 + x * 0.05 + y * 0.03)
      const v = 200 + s * 40
      return [v + 10, v + 5 * Math.sin(n * 9), v + 14 * Math.cos(n * 7)]
    })
  })
}

/** stage floor: worn black-painted planks with scuffs (x along the planks) */
export function plankMap() {
  return tile('planks', 512, 512, (g, w, h) => {
    noiseTile(g, w, h, 12, 51, n => [16 + n * 10, 12 + n * 8, 10 + n * 7])
    const r = rng(17)
    const rows = 8
    for (let i = 0; i < rows; i++) {
      const y = (i / rows) * h
      g.fillStyle = `rgba(0,0,0,0.85)`
      g.fillRect(0, y, w, 1.5)
      // butt joints
      const joints = 1 + Math.floor(r() * 2)
      for (let j = 0; j < joints; j++) g.fillRect(r() * w, y, 1.5, h / rows)
      // scuffs: paint worn to the wood
      for (let k = 0; k < 16; k++) {
        g.fillStyle = `rgba(${90 + r() * 40},${60 + r() * 20},${40 + r() * 20},${0.04 + r() * 0.08})`
        g.fillRect(r() * w, y + r() * (h / rows), 10 + r() * 60, 0.6 + r() * 1.8)
      }
    }
  })
}

/** the same planks as a roughness map (worn = glossier) */
export function plankRough() {
  return tile(
    'planks-rough',
    256,
    256,
    (g, w, h) => {
      noiseTile(g, w, h, 10, 61, n => {
        const v = 200 + n * 50
        return [v, v, v]
      })
    },
    { srgb: false },
  )
}

/* ------------------------------------------------------------------ materials */

/** Nickel hardware (pickup covers, bridge, frets): warm, slightly soft chrome. */
export const nickel = (rough = 0.2) => new THREE.MeshStandardMaterial({ color: '#d8d3c8', metalness: 1, roughness: rough })
/** Chrome (footswitches, jacks, mic grilles): cooler, sharper. */
export const chrome = (rough = 0.08) => new THREE.MeshStandardMaterial({ color: '#e8eaee', metalness: 1, roughness: rough })
/** Gold hardware / amp panels. */
export const gold = (rough = 0.3) => new THREE.MeshStandardMaterial({ color: '#d9b36a', metalness: 1, roughness: rough })
/** Gloss black lacquer (headstock face, pedal enamel base). */
export const blackGloss = () =>
  new THREE.MeshPhysicalMaterial({ color: '#070606', roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04 })
/** Aged cream plastic (binding, pickup rings, the nut). */
export const cream = (rough = 0.35) => new THREE.MeshStandardMaterial({ color: '#e9dcc0', roughness: rough })
/** Amber "top hat" knobs: tinted, glossy. */
export const amberKnob = () =>
  new THREE.MeshPhysicalMaterial({ color: '#9a5a14', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 })
/** Black knurled amp / pedal knob. */
export const blackKnob = () => new THREE.MeshStandardMaterial({ color: '#0b0a0a', roughness: 0.42, metalness: 0.1 })
/** Mother-of-pearl inlay: iridescent. */
export const pearl = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#f4efe6',
    map: pearlMap(),
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    iridescence: 1,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [120, 480],
  })
/** Rosewood fingerboard (oiled, matte). `len`: units along the grain the tile spans. */
export const rosewood = () => new THREE.MeshStandardMaterial({ color: '#ffffff', map: rosewoodMap(), roughness: 0.62 })
/** Mahogany (neck, body back). */
export const mahogany = () =>
  new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: mahoganyMap(), roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.08 })
/** Black tolex (amp and cab covering). */
export const tolex = () =>
  new THREE.MeshStandardMaterial({ color: '#141212', roughness: 0.78, bumpMap: tolexBump(), bumpScale: 1.4 })
/** Grille cloth. */
export const grille = (kind: 'wheat' | 'oxblood' | 'salt' = 'wheat') =>
  new THREE.MeshStandardMaterial({ color: '#ffffff', map: grilleMap(kind), roughness: 0.9 })
/** Rubber (cables, feet). */
export const rubber = () => new THREE.MeshStandardMaterial({ color: '#0c0b0b', roughness: 0.55 })
/** Stage planks (tile the UVs for your floor size: stage.ts scaleUv). */
export const planks = () =>
  new THREE.MeshStandardMaterial({ color: '#ffffff', map: plankMap(), roughness: 1, roughnessMap: plankRough(), metalness: 0, envMapIntensity: 0.35 })

/** An emissive glow material (tube filaments, LEDs, jewel lamps): HDR colour → bloom. */
export const glow = (color: THREE.ColorRepresentation, power = 3) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), toneMapped: false })

/**
 * Wait for the RIFF faces before drawing canvas type (labels, setlists).
 * Resolves quickly if they're already loaded; never rejects.
 */
export function fontsReady(): Promise<void> {
  if (!document.fonts?.load) return Promise.resolve()
  return Promise.all([
    document.fonts.load("800 64px 'Anybody Variable'"),
    document.fonts.load("400 64px 'Yellowtail'"),
    document.fonts.load("500 32px 'Instrument Sans Variable'"),
    document.fonts.load("500 32px 'Spline Sans Mono Variable'"),
  ])
    .then(() => undefined)
    .catch(() => undefined)
}

/** The display faces as canvas font strings (Safari has no ctx.fontStretch: use scale for width). */
export const FONT = {
  display: (px: number, weight = 850) => `${weight} ${px}px 'Anybody Variable', 'Arial Black', sans-serif`,
  script: (px: number) => `400 ${px}px 'Yellowtail', 'Brush Script MT', cursive`,
  sans: (px: number, weight = 500) => `${weight} ${px}px 'Instrument Sans Variable', system-ui, sans-serif`,
  mono: (px: number, weight = 500) => `${weight} ${px}px 'Spline Sans Mono Variable', ui-monospace, monospace`,
}
