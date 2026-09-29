import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { logoGeometry } from '../../logo/logo'
import { FONT, chrome, cream, nickel, rubber, tile, tolex } from '../../kit/materials'
import { scaleUv } from '../../kit/stage'

/*
 * THE HEAD — a hero-size vintage amp head for "Up to Eleven", built to hold
 * up in a macro close-up (the kit's buildAmp is a backline prop).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  (mark)      ║ 12AX7 ×3 │ EL34 ×4 — the tube window ║           │  ← tolex, cream piping
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ INPUT  PRESENCE BASS MIDDLE TREBLE  ( VOLUME 1–11 ) [VU] ◆ jewel │  ← brushed gold panel
 *   │ ◎ ◎      ◖      ◖     ◖      ◖            ◖                ╿ ╿    │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * One BIG chicken-head knob over a dial engraved 1 to 11 (a dot for 0 and an
 * oxblood "redline" between 10 and 11), a backlit VU meter, a faceted red
 * jewel pilot lamp, STANDBY / POWER toggles, two input jacks (a guitar
 * cable's 1/4" plug slides into HIGH), and — through a window above the
 * panel — three preamp tubes and four power tubes on the chassis, glowing.
 *
 * Local space: the head sits on y = 0, centred on x, the front face at
 * z = ZF (facing +Z). Units: 1 = 10 cm. Engravings are ONE canvas atlas
 * (dial, small scales, labels) drawn once; the VU face is one small tile.
 */

export const W = 8.2
export const H = 4.0
export const D = 2.8
/** the front face */
export const ZF = D / 2
/** the brushed-gold control panel */
export const PANEL = { x0: -3.8, x1: 3.8, y0: 0.33, y1: 2.23 }
export const PY = (PANEL.y0 + PANEL.y1) / 2
/** the tube window (above the panel) */
export const WIN = { x0: -1.95, x1: 3.35, y0: 2.6, y1: 3.66 }
/** the lower block's top (the chassis floor the tubes stand on) */
const LOW_H = 2.56
/** the big knob: the centre of its dial */
export const VOL = new THREE.Vector3(0.82, PY - 0.02, ZF)
/** the HIGH input jack (the plug goes in here) */
export const INPUT = new THREE.Vector3(-3.4, PY - 0.04, ZF)
export const LOW_IN = new THREE.Vector3(-2.96, PY - 0.04, ZF)
export const VU = new THREE.Vector3(2.3, PY + 0.1, ZF)
export const JEWEL = new THREE.Vector3(3.18, PY + 0.44, ZF)
/** the power tubes' row (centre of the glowing plates) */
export const TUBES = new THREE.Vector3(1.5, LOW_H + 0.52, ZF - 0.62)

/** the dial: 0 (a dot) … 11 over 300°, clockwise from 7 o'clock to 5 o'clock */
const SWEEP = (300 * Math.PI) / 180
/** detent d (0..11) → angle clockwise from 12 o'clock */
export const dialAngle = (d: number) => -SWEEP / 2 + (d / 11) * SWEEP
/** the engraved numbers' radius */
export const NUM_R = 0.695
const SMALL_SWEEP = (300 * Math.PI) / 180

/** the atlas: dial (a 1.8 × 1.8 square round VOL), a small scale, labels */
const DIAL_SPAN = 1.8
const SMALL_SPAN = 0.7
const ATLAS_W = 2048
const ATLAS_H = 1024
const LABEL_ROW = 72
const LABEL_UNITS = 0.118 // a label row's height in units (letters ~4.5 mm tall)
const LABELS = ['INPUT', 'HIGH', 'LOW', 'PRESENCE', 'BASS', 'MIDDLE', 'TREBLE', 'STANDBY', 'POWER', 'ON', 'VOLUME']
const INK = 'rgba(24, 16, 8, 0.94)'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** draw text char by char with tracking (canvas letterSpacing isn't in Safari) */
function spaced(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, track: number) {
  const widths = [...text].map(c => g.measureText(c).width)
  const total = widths.reduce((a, b) => a + b, 0) + track * (text.length - 1)
  let x = cx - total / 2
  g.textAlign = 'left'
  for (let i = 0; i < text.length; i++) {
    g.fillText(text[i], x, cy)
    x += widths[i] + track
  }
  return total
}

function buildAtlas(mobile: boolean) {
  const labelRects = new Map<string, Rect & { units: number }>()
  const scale = mobile ? 0.5 : 1
  const tex = tile(
    'sv-engraving-' + (mobile ? 'm' : 'd'),
    ATLAS_W * scale,
    ATLAS_H * scale,
    (g, cw, ch) => {
      g.clearRect(0, 0, cw, ch)
      g.save()
      g.scale(scale, scale)
      g.fillStyle = INK
      g.strokeStyle = INK
      g.lineCap = 'round'

      // ---- the VOLUME dial, centred in a 1024² square (1.8 units across)
      {
        const c = 512
        const u = 1024 / DIAL_SPAN
        const at = (d: number, r: number) => {
          const a = dialAngle(d)
          return [c + Math.sin(a) * r * u, c - Math.cos(a) * r * u] as const
        }
        // the base arc
        g.lineWidth = 0.011 * u
        g.beginPath()
        g.arc(c, c, 0.47 * u, dialAngle(0) - Math.PI / 2, dialAngle(11) - Math.PI / 2)
        g.stroke()
        // the redline: an oxblood band from 10 to 11
        g.save()
        g.strokeStyle = 'rgba(142, 42, 34, 0.96)'
        g.lineWidth = 0.05 * u
        g.lineCap = 'butt'
        g.beginPath()
        g.arc(c, c, 0.535 * u, dialAngle(10) - Math.PI / 2, dialAngle(11) - Math.PI / 2)
        g.stroke()
        g.restore()
        // ticks: long at each detent, short between
        for (let i = 0; i <= 22; i++) {
          const d = i / 2
          const major = i % 2 === 0
          const [x0, y0] = at(d, 0.47)
          const [x1, y1] = at(d, major ? 0.575 : 0.52)
          g.lineWidth = (major ? 0.02 : 0.011) * u
          g.beginPath()
          g.moveTo(x0, y0)
          g.lineTo(x1, y1)
          g.stroke()
        }
        // the numbers: heavy, upright (a dot for 0)
        g.textBaseline = 'middle'
        g.textAlign = 'center'
        for (let d = 0; d <= 11; d++) {
          const [x, y] = at(d, NUM_R)
          if (d === 0) {
            g.beginPath()
            g.arc(x, y, 0.028 * u, 0, Math.PI * 2)
            g.fill()
            continue
          }
          const px = 0.2 * u
          g.font = FONT.display(px, 880)
          const s = String(d)
          // a touch condensed so "10" and "11" sit in their slots
          g.save()
          g.translate(x, y + px * 0.04)
          g.scale(s.length > 1 ? 0.84 : 0.94, 1)
          g.fillText(s, 0, 0)
          g.restore()
        }
        // VOLUME, under the knob
        g.font = FONT.mono(0.072 * u, 700)
        g.textBaseline = 'middle'
        spaced(g, 'VOLUME', c, c + 0.8 * u, 0.02 * u)
      }

      // ---- the small knobs' scale (ticks only), a 384² square at (1024, 0)
      {
        const cx = 1024 + 192
        const cy = 192
        const u = 384 / SMALL_SPAN
        for (let k = 0; k <= 10; k++) {
          const a = -SMALL_SWEEP / 2 + (k / 10) * SMALL_SWEEP
          const major = k % 5 === 0
          const r0 = major ? 0.2 : 0.21
          const r1 = major ? 0.275 : 0.25
          g.lineWidth = (major ? 0.016 : 0.01) * u
          g.beginPath()
          g.moveTo(cx + Math.sin(a) * r0 * u, cy - Math.cos(a) * r0 * u)
          g.lineTo(cx + Math.sin(a) * r1 * u, cy - Math.cos(a) * r1 * u)
          g.stroke()
        }
        g.font = FONT.mono(0.05 * u, 700)
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        const a0 = -SMALL_SWEEP / 2
        g.fillText('0', cx + Math.sin(a0) * 0.32 * u, cy - Math.cos(a0) * 0.32 * u)
        g.fillText('10', cx - Math.sin(a0) * 0.33 * u, cy - Math.cos(a0) * 0.32 * u)
      }

      // ---- labels: two columns of rows under the small scale
      {
        g.font = FONT.mono(LABEL_ROW * 0.52, 700)
        g.textBaseline = 'middle'
        const colW = 512
        const y0 = 400
        LABELS.forEach((t, i) => {
          const col = i % 2
          const row = Math.floor(i / 2)
          const x = 1024 + col * colW
          const y = y0 + row * LABEL_ROW
          const w = spaced(g, t, x + colW / 2, y + LABEL_ROW / 2, LABEL_ROW * 0.14) + LABEL_ROW * 0.3
          const rw = Math.min(colW, Math.ceil(w))
          labelRects.set(t, { x: x + colW / 2 - rw / 2, y, w: rw, h: LABEL_ROW, units: (rw / LABEL_ROW) * LABEL_UNITS })
        })
      }
      g.restore()
    },
    { repeat: false },
  )
  tex.anisotropy = 8
  // the atlas is drawn once: remember the label rects even on a cache hit
  if (!labelRects.size) {
    LABELS.forEach((t, i) => {
      const col = i % 2
      const row = Math.floor(i / 2)
      labelRects.set(t, { x: 1024 + col * 512 + 20, y: 400 + row * LABEL_ROW, w: 472, h: LABEL_ROW, units: (472 / LABEL_ROW) * LABEL_UNITS })
    })
  }
  return { tex, labelRects }
}

/** a plane showing one rect of the atlas */
function decal(mat: THREE.Material, r: Rect, wUnits: number, hUnits: number) {
  const geo = new THREE.PlaneGeometry(wUnits, hUnits)
  const uv = geo.attributes.uv
  const u0 = r.x / ATLAS_W
  const u1 = (r.x + r.w) / ATLAS_W
  const v1 = 1 - r.y / ATLAS_H
  const v0 = 1 - (r.y + r.h) / ATLAS_H
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
  uv.needsUpdate = true
  return new THREE.Mesh(geo, mat)
}

/** brushed metal: fine horizontal streaks (a roughness tile) */
function brushedRough() {
  return tile(
    'sv-brushed',
    512,
    128,
    (g, w, h) => {
      g.fillStyle = 'rgb(128,128,128)'
      g.fillRect(0, 0, w, h)
      let s = 7
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < 2600; i++) {
        const y = r() * h
        const v = r() > 0.5 ? 200 : 70
        g.fillStyle = `rgba(${v},${v},${v},${0.05 + r() * 0.16})`
        const x = r() * w
        const len = 40 + r() * 260
        g.fillRect(x, y, len, 0.5 + r() * 0.8)
        if (x + len > w) g.fillRect(x - w, y, len, 0.5 + r() * 0.8)
      }
    },
    { srgb: false },
  )
}

/** the VU meter's face: warm paper, a dB arc with a red zone, "VU" */
function vuFace() {
  return tile(
    'sv-vu',
    512,
    370,
    (g, w, h) => {
      const bg = g.createRadialGradient(w / 2, h * 0.95, 20, w / 2, h * 0.7, w * 0.62)
      bg.addColorStop(0, '#fbeccb')
      bg.addColorStop(0.6, '#f0d8a4')
      bg.addColorStop(1, '#c79a5a')
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)
      const px = w / 0.86
      const cx = w / 2
      const cy = h + 0.05 * px
      const R = 0.44 * px
      const A = (48 * Math.PI) / 180
      const ang = (f: number) => -A + 2 * A * f
      const fdb = (db: number) => Math.pow(10, (db - 3) / 20)
      const pt = (f: number, r: number) => [cx + Math.sin(ang(f)) * r, cy - Math.cos(ang(f)) * r] as const
      // the scale arc: ink to 0 dB, a red band above
      g.strokeStyle = '#1b120a'
      g.lineWidth = 3
      g.beginPath()
      g.arc(cx, cy, R, ang(0) - Math.PI / 2, ang(fdb(0)) - Math.PI / 2)
      g.stroke()
      g.strokeStyle = '#9c2a1e'
      g.lineWidth = 12
      g.beginPath()
      g.arc(cx, cy, R + 5, ang(fdb(0)) - Math.PI / 2, ang(1) - Math.PI / 2)
      g.stroke()
      const marks = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = FONT.mono(21, 700)
      for (const db of marks) {
        const f = fdb(db)
        const [x0, y0] = pt(f, R)
        const [x1, y1] = pt(f, R + 22)
        g.strokeStyle = db > 0 ? '#9c2a1e' : '#1b120a'
        g.lineWidth = 3
        g.beginPath()
        g.moveTo(x0, y0)
        g.lineTo(x1, y1)
        g.stroke()
        const [tx, ty] = pt(f, R + 44)
        g.fillStyle = db > 0 ? '#9c2a1e' : '#1b120a'
        g.fillText(String(Math.abs(db)), tx, ty)
      }
      // minor ticks
      g.strokeStyle = '#1b120a'
      g.lineWidth = 2
      for (let f = 0.05; f < fdb(0); f += 0.05) {
        const [x0, y0] = pt(f, R)
        const [x1, y1] = pt(f, R + 11)
        g.beginPath()
        g.moveTo(x0, y0)
        g.lineTo(x1, y1)
        g.stroke()
      }
      // − and + at the ends
      g.font = FONT.mono(30, 700)
      g.fillStyle = '#1b120a'
      g.fillText('−', pt(0, R + 44)[0] - 6, pt(0, R + 80)[1])
      g.fillStyle = '#9c2a1e'
      g.fillText('+', pt(1, R + 44)[0] + 6, pt(1, R + 80)[1])
      // VU
      g.fillStyle = '#1b120a'
      g.font = FONT.display(78, 900)
      g.save()
      g.translate(cx, h * 0.72)
      g.scale(1.15, 1)
      g.fillText('VU', 0, 0)
      g.restore()
      // a soft vignette
      const v = g.createLinearGradient(0, 0, 0, h)
      v.addColorStop(0, 'rgba(60,30,10,0.25)')
      v.addColorStop(0.25, 'rgba(60,30,10,0)')
      v.addColorStop(0.85, 'rgba(60,30,10,0)')
      v.addColorStop(1, 'rgba(60,30,10,0.3)')
      g.fillStyle = v
      g.fillRect(0, 0, w, h)
    },
    { repeat: false },
  )
}

/** a soft round glow (grey on black, for additive planes) */
function haloMap() {
  return tile(
    'sv-halo',
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      gr.addColorStop(0, 'rgba(255,255,255,1)')
      gr.addColorStop(0.25, 'rgba(255,255,255,0.55)')
      gr.addColorStop(0.6, 'rgba(255,255,255,0.12)')
      gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, w, h)
    },
    { repeat: false },
  )
}

/** a rounded rectangle path */
function roundRect(s: THREE.Shape | THREE.Path, x0: number, y0: number, x1: number, y1: number, r: number) {
  s.moveTo(x0 + r, y0)
  s.lineTo(x1 - r, y0)
  s.quadraticCurveTo(x1, y0, x1, y0 + r)
  s.lineTo(x1, y1 - r)
  s.quadraticCurveTo(x1, y1, x1 - r, y1)
  s.lineTo(x0 + r, y1)
  s.quadraticCurveTo(x0, y1, x0, y1 - r)
  s.lineTo(x0, y0 + r)
  s.quadraticCurveTo(x0, y0, x0 + r, y0)
}

/** a chicken-head knob (face +Z): a fluted skirt and the pointer on top. Returns the group; rotate .rotation.z */
function chickenHead(skirtMat: THREE.Material, headMat: THREE.Material, lineMat: THREE.Material, s = 1, cast = true) {
  const k = new THREE.Group()
  // the skirt: a lathe with 48 flutes round its side
  const R = 0.34
  const h = 0.1
  const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(R, 0), new THREE.Vector2(R, h - 0.022), new THREE.Vector2(R - 0.022, h), new THREE.Vector2(0.001, h)]
  const skirt = new THREE.LatheGeometry(prof, 96)
  const p = skirt.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    const r = Math.hypot(x, z)
    if (r < 0.2) continue
    const a = Math.atan2(z, x)
    const f = 1 + 0.018 * Math.cos(a * 48)
    p.setX(i, x * f)
    p.setZ(i, z * f)
  }
  skirt.computeVertexNormals()
  skirt.rotateX(Math.PI / 2)
  const sk = new THREE.Mesh(skirt, skirtMat)
  sk.castShadow = cast
  sk.receiveShadow = true
  k.add(sk)
  // the head: the pointer toward +Y with a round tail
  const tip = new THREE.Vector2(0, 0.47)
  const c = new THREE.Vector2(0, -0.035)
  const r = 0.16
  const dd = tip.distanceTo(c)
  const beta = Math.acos(r / dd)
  const a1 = Math.PI / 2 - beta
  const a2 = Math.PI / 2 + beta
  const shape = new THREE.Shape()
  shape.moveTo(tip.x, tip.y)
  shape.quadraticCurveTo(0.035, 0.3, c.x + Math.cos(a1) * r, c.y + Math.sin(a1) * r)
  shape.absarc(c.x, c.y, r, a1, a2 - Math.PI * 2, true)
  shape.quadraticCurveTo(-0.035, 0.3, tip.x, tip.y)
  const headGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.028, bevelThickness: 0.04, bevelSegments: 4, curveSegments: 24 })
  const head = new THREE.Mesh(headGeo, headMat)
  head.position.z = h + 0.035
  head.castShadow = cast
  head.receiveShadow = true
  k.add(head)
  // the cream line along the pointer
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.36, 0.012), lineMat)
  line.position.set(0, 0.21, h + 0.035 + 0.14 + 0.04 + 0.002)
  k.add(line)
  k.scale.setScalar(s)
  return k
}

/** a vacuum tube on its base (y up, standing on y = 0). power: an EL34, else a 12AX7 */
function tube(power: boolean, mats: TubeMats) {
  const t = new THREE.Group()
  const s = power ? 1 : 0.62
  const baseH = power ? 0.2 : 0.04
  if (power) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, baseH, 28), mats.base)
    base.position.y = baseH / 2
    t.add(base)
  } else {
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, baseH, 24), mats.base)
    sock.position.y = baseH / 2
    t.add(sock)
  }
  const gh = power ? 0.92 : 0.5
  const gr = power ? 0.162 : 0.1
  const glassProf = [
    new THREE.Vector2(gr * 0.96, 0),
    new THREE.Vector2(gr, 0.06),
    new THREE.Vector2(gr, gh * 0.84),
    new THREE.Vector2(gr * 0.86, gh * 0.95),
    new THREE.Vector2(gr * 0.5, gh * 1.0),
    new THREE.Vector2(0.018, gh * 1.02),
    new THREE.Vector2(0.0, gh * 1.035),
  ]
  const glass = new THREE.Mesh(new THREE.LatheGeometry(glassProf, 32), mats.glass)
  glass.position.y = baseH
  glass.renderOrder = 2
  // the silvered getter flash at the top of the bottle
  const getter = new THREE.Mesh(new THREE.SphereGeometry(gr * 0.985, 24, 8, 0, Math.PI * 2, 0, 0.62), mats.getter)
  getter.position.y = baseH + gh * 0.8
  getter.scale.y = 0.55
  // the plate structure: two dark plates with a slit between (the heater shows through)
  const plateH = (power ? 0.44 : 0.22) * 1
  const pw = power ? 0.085 : 0.05
  const plateGeo = new THREE.BoxGeometry(pw, plateH, power ? 0.14 : 0.08)
  const py = baseH + (power ? 0.3 : 0.16) + plateH / 2
  for (const side of [-1, 1]) {
    const pl = new THREE.Mesh(plateGeo, mats.plate)
    pl.position.set(side * (pw / 2 + (power ? 0.018 : 0.012)), py, 0)
    t.add(pl)
  }
  // mica spacers
  const micaGeo = new THREE.CylinderGeometry(gr * 0.9, gr * 0.9, 0.006, 20)
  for (const y of [py - plateH / 2 - 0.02, py + plateH / 2 + 0.02]) {
    const m = new THREE.Mesh(micaGeo, mats.mica)
    m.position.y = y
    t.add(m)
  }
  // the heater: an orange line in the slit + a glow at the top of the plates
  const fil = new THREE.Mesh(new THREE.BoxGeometry(power ? 0.03 : 0.018, plateH * 0.92, 0.03), mats.filament)
  fil.position.y = py
  t.add(fil)
  const top = new THREE.Mesh(new THREE.BoxGeometry(power ? 0.14 : 0.08, 0.02, 0.05), mats.filament)
  top.position.y = py + plateH / 2 + 0.005
  t.add(top)
  t.add(getter, glass)
  void s
  return t
}

interface TubeMats {
  base: THREE.Material
  glass: THREE.Material
  getter: THREE.Material
  plate: THREE.Material
  mica: THREE.Material
  filament: THREE.MeshBasicMaterial
}

/**
 * Merge every static mesh under `root` that shares a material (and shadow
 * flags / render order) into one mesh: the head is ~120 small parts but only
 * a dozen materials. Meshes under `keep` (things that move) are left alone.
 */
function mergeStatic(root: THREE.Group, keep: THREE.Object3D[]) {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const skip = new Set<THREE.Object3D>()
  for (const k of keep) k.traverse(o => skip.add(o))
  const buckets = new Map<string, THREE.Mesh[]>()
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh || skip.has(m) || Array.isArray(m.material)) return
    const key = `${(m.material as THREE.Material).uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`
    const b = buckets.get(key)
    if (b) b.push(m)
    else buckets.set(key, [m])
  })
  const tmp = new THREE.Matrix4()
  for (const list of buckets.values()) {
    if (list.length < 2) continue
    const geos = list.map(m => {
      let g = m.geometry.clone()
      if (g.index) g = g.toNonIndexed()
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
      g.morphAttributes = {}
      g.clearGroups()
      return g.applyMatrix4(tmp.multiplyMatrices(inv, m.matrixWorld))
    })
    const merged = mergeGeometries(geos, false)
    if (!merged) continue
    const first = list[0]
    const mesh = new THREE.Mesh(merged, first.material)
    mesh.castShadow = first.castShadow
    mesh.receiveShadow = first.receiveShadow
    mesh.renderOrder = first.renderOrder
    for (const m of list) m.removeFromParent()
    root.add(mesh)
    for (const g of geos) g.dispose()
  }
}

export interface Head {
  group: THREE.Group
  /** the knob to the detent value d (0..11, continuous) */
  setDetent(d: number): void
  /** 0 cold → 1 cooking */
  setTubes(v: number): void
  /** the jewel lamp, 0 off → 1 */
  setPilot(v: number): void
  /** the VU needle 0..1 (1 = pinned at +3) and its lamp 0..1 */
  setVu(needle: number, lamp: number): void
  /** the plug: 0 out (0.9 in front) → 1 home */
  setPlug(v: number): void
  /** the number for detent d on the dial (head-local) */
  numberAt(d: number, out: THREE.Vector3): THREE.Vector3
}

export async function buildHead({ mobile, yieldFn }: { mobile: boolean; yieldFn: () => Promise<void> }): Promise<Head> {
  const group = new THREE.Group()
  group.name = 'services-head'

  // ---------------------------------------------------------------- cabinet
  const tol = tolex()
  const R = 0.12
  const lower = new THREE.Mesh(new RoundedBoxGeometry(W, LOW_H, D, 3, R), tol)
  lower.position.y = LOW_H / 2
  lower.castShadow = true
  lower.receiveShadow = true
  group.add(lower)
  // the upper band: posts either side of the tube window, a top slab, a back
  const upH = H - LOW_H
  const topH = H - WIN.y1
  const slab = new THREE.Mesh(new RoundedBoxGeometry(W, topH + 0.04, D, 3, R), tol)
  slab.position.y = H - (topH + 0.04) / 2
  slab.castShadow = true
  slab.receiveShadow = true
  group.add(slab)
  const post = (x0: number, x1: number) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(x1 - x0, upH + 0.2, D - 0.01, 3, R), tol)
    m.position.set((x0 + x1) / 2, LOW_H + upH / 2 - 0.02, -0.005)
    m.receiveShadow = true
    m.castShadow = true
    group.add(m)
  }
  post(-W / 2, WIN.x0)
  post(WIN.x1, W / 2)
  // inside: a dark back wall, the chassis plate (the tubes stand on it)
  const interior = new THREE.MeshStandardMaterial({ color: '#0d0a08', roughness: 0.75, metalness: 0.2 })
  const back = new THREE.Mesh(new THREE.PlaneGeometry(WIN.x1 - WIN.x0 + 0.4, WIN.y1 - WIN.y0 + 0.3), interior)
  back.position.set((WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, -D / 2 + 0.25)
  group.add(back)
  const chassis = new THREE.Mesh(
    new THREE.PlaneGeometry(WIN.x1 - WIN.x0 + 0.4, D - 0.3),
    new THREE.MeshStandardMaterial({ color: '#4a463f', roughness: 0.42, metalness: 0.85 }),
  )
  chassis.rotation.x = -Math.PI / 2
  chassis.position.set((WIN.x0 + WIN.x1) / 2, LOW_H + 0.005, 0)
  chassis.receiveShadow = true
  group.add(chassis)
  // dark side walls just inside the posts (the posts' tolex caught the gels)
  for (const [x, ry] of [
    [WIN.x0 + 0.012, Math.PI / 2],
    [WIN.x1 - 0.012, -Math.PI / 2],
  ] as const) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.3, WIN.y1 - WIN.y0 + 0.1), interior)
    side.rotation.y = ry
    side.position.set(x, (WIN.y0 + WIN.y1) / 2, -0.1)
    group.add(side)
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(WIN.x1 - WIN.x0 + 0.4, D - 0.3), interior)
  ceil.rotation.x = Math.PI / 2
  ceil.position.set((WIN.x0 + WIN.x1) / 2, WIN.y1 - 0.01, 0)
  group.add(ceil)

  // cream piping: round the panel and round the tube window
  const pipeMat = new THREE.MeshStandardMaterial({ color: '#b8a27a', roughness: 0.55 })
  const pipe = (len: number, vertical: boolean, x: number, y: number, z = ZF + 0.012) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, len, 10), pipeMat)
    if (!vertical) m.rotation.z = Math.PI / 2
    m.position.set(x, y, z)
    group.add(m)
  }
  const pw = PANEL.x1 - PANEL.x0
  const ph = PANEL.y1 - PANEL.y0
  pipe(pw + 0.12, false, 0, PANEL.y1 + 0.06)
  pipe(pw + 0.12, false, 0, PANEL.y0 - 0.06)
  pipe(ph + 0.12, true, PANEL.x0 - 0.06, PY)
  pipe(ph + 0.12, true, PANEL.x1 + 0.06, PY)
  const ww = WIN.x1 - WIN.x0
  const wh = WIN.y1 - WIN.y0
  pipe(W - 0.3, false, 0, WIN.y1 + 0.03)
  pipe(ww + 0.06, false, (WIN.x0 + WIN.x1) / 2, WIN.y0 + 0.01)
  pipe(wh + 0.06, true, WIN.x0 - 0.02, (WIN.y0 + WIN.y1) / 2)
  pipe(wh + 0.06, true, WIN.x1 + 0.02, (WIN.y0 + WIN.y1) / 2)
  // the mark, piped in cream on the tolex left of the window
  // the mark stays cream whatever gel hits it: a little of its own light
  const badgeMat = cream(0.32)
  badgeMat.emissive.set('#3b3226')
  const badge = new THREE.Mesh(logoGeometry({ depth: 0.035 }), badgeMat)
  badge.scale.setScalar(0.56)
  badge.position.set(-3.38, (WIN.y0 + WIN.y1) / 2 - 0.08, ZF + 0.02)
  group.add(badge)
  // handle on top
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 8, 24, Math.PI), new THREE.MeshStandardMaterial({ color: '#0e0c0b', roughness: 0.5 }))
  handle.scale.set(1, 0.42, 1)
  handle.position.set(0, H + 0.01, 0)
  group.add(handle)
  await yieldFn()

  // ---------------------------------------------------------------- the panel
  const brushed = brushedRough()
  const panelGeo = new THREE.PlaneGeometry(pw, ph)
  scaleUv(panelGeo, pw / 1.6, ph / 0.4)
  // anodized brushed gold: a dyed layer over aluminium — part metal, part
  // lacquer, so the stage light makes it GLOW gold (a pure metal would only
  // mirror the dark room), streaks stretched along the brushing
  const gold = new THREE.MeshPhysicalMaterial({
    color: '#d8b77a',
    metalness: 0.55,
    roughness: 0.42,
    roughnessMap: brushed,
    anisotropy: 0.6,
    clearcoat: 0.3,
    clearcoatRoughness: 0.25,
  })
  const panel = new THREE.Mesh(panelGeo, gold)
  panel.position.set(0, PY, ZF + 0.004)
  panel.receiveShadow = true
  group.add(panel)

  const { tex: atlas, labelRects } = buildAtlas(mobile)
  const ink = new THREE.MeshStandardMaterial({
    map: atlas,
    transparent: true,
    roughness: 0.55,
    metalness: 0.1,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const zInk = ZF + 0.008
  // the dial
  const dial = decal(ink, { x: 0, y: 0, w: 1024, h: 1024 }, DIAL_SPAN, DIAL_SPAN)
  dial.position.set(VOL.x, VOL.y, zInk)
  dial.receiveShadow = true
  group.add(dial)
  const label = (t: string, x: number, y: number) => {
    const r = labelRects.get(t)!
    const m = decal(ink, r, r.units, LABEL_UNITS)
    m.position.set(x, y, zInk)
    m.receiveShadow = true
    group.add(m)
  }
  // input
  label('INPUT', (INPUT.x + LOW_IN.x) / 2, PY + 0.5)
  label('HIGH', INPUT.x, PY - 0.42)
  label('LOW', LOW_IN.x, PY - 0.42)
  // tone controls
  const tones = ['PRESENCE', 'BASS', 'MIDDLE', 'TREBLE']
  const toneX = [-2.35, -1.7, -1.05, -0.4]
  const toneSet = [0.62, 0.5, 0.7, 0.58]
  // black bakelite: a soft satin under the clear coat so the spot shapes it
  // (a broad, low clear coat: a mirror coat blew out in the frontal spot at some angles)
  const knobMat = new THREE.MeshPhysicalMaterial({ color: '#100d0b', roughness: 0.48, clearcoat: 0.3, clearcoatRoughness: 0.36 })
  const lineMat = cream(0.28)
  for (let i = 0; i < 4; i++) {
    label(tones[i], toneX[i], PY + 0.5)
    const sc = decal(ink, { x: 1024, y: 0, w: 384, h: 384 }, SMALL_SPAN, SMALL_SPAN)
    sc.position.set(toneX[i], PY - 0.02, zInk)
    sc.receiveShadow = true
    group.add(sc)
    const k = chickenHead(knobMat, knobMat, lineMat, 0.5, false)
    k.position.set(toneX[i], PY - 0.02, ZF + 0.004)
    k.rotation.z = -(-SMALL_SWEEP / 2 + toneSet[i] * SMALL_SWEEP)
    group.add(k)
  }
  // standby / power toggles, the jewel above them
  const tog = (x: number, name: string) => {
    const sw = new THREE.Group()
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 24).rotateX(Math.PI / 2), nickel(0.25))
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.045, 6).rotateX(Math.PI / 2), chrome(0.14))
    nut.position.z = 0.025
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.28, 12), chrome(0.08))
    bat.rotation.x = -0.45
    bat.position.set(0, 0.06, 0.16)
    const tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), chrome(0.08))
    tipBall.position.set(0, 0.12, 0.29)
    sw.add(plate, nut, bat, tipBall)
    sw.position.set(x, PY - 0.3, ZF + 0.006)
    group.add(sw)
    label(name, x, PY - 0.64)
  }
  tog(3.0, 'STANDBY')
  tog(3.42, 'POWER')
  label('ON', 3.21, PY - 0.1)
  // the jewel: a faceted red dome in a knurled chrome bezel
  const jewelMat = new THREE.MeshStandardMaterial({ color: '#3a0604', emissive: '#ff2a14', emissiveIntensity: 0, roughness: 0.16, metalness: 0.1, flatShading: true })
  const jewelGeo = new THREE.LatheGeometry(
    [new THREE.Vector2(0.125, 0), new THREE.Vector2(0.125, 0.03), new THREE.Vector2(0.1, 0.085), new THREE.Vector2(0.052, 0.125), new THREE.Vector2(0.0, 0.14)],
    8,
  ).rotateX(Math.PI / 2)
  const jewel = new THREE.Mesh(jewelGeo, jewelMat)
  jewel.position.set(JEWEL.x, JEWEL.y, ZF + 0.03)
  group.add(jewel)
  const bezelGeo = new THREE.TorusGeometry(0.145, 0.035, 10, 40)
  const bezel = new THREE.Mesh(bezelGeo, chrome(0.12))
  bezel.position.set(JEWEL.x, JEWEL.y, ZF + 0.03)
  group.add(bezel)
  const jewelHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.62),
    new THREE.MeshBasicMaterial({ map: haloMap(), color: '#000000', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
  )
  jewelHalo.position.set(JEWEL.x, JEWEL.y, ZF + 0.012)
  group.add(jewelHalo)
  await yieldFn()

  // ---------------------------------------------------------------- input jacks
  const jackMat = new THREE.MeshStandardMaterial({ color: '#b3ada2', metalness: 1, roughness: 0.38 })
  const holeMat = new THREE.MeshBasicMaterial({ color: '#030202' })
  for (const p of [INPUT, LOW_IN]) {
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.01, 28).rotateX(Math.PI / 2), jackMat)
    washer.position.set(p.x, p.y, ZF + 0.009)
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.035, 6).rotateX(Math.PI / 2), jackMat)
    nut.position.set(p.x, p.y, ZF + 0.03)
    nut.rotation.z = Math.PI / 6
    const bush = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.05, 20, 1, true).rotateX(Math.PI / 2), jackMat)
    bush.position.set(p.x, p.y, ZF + 0.045)
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.046, 20), holeMat)
    hole.position.set(p.x, p.y, ZF + 0.05)
    group.add(washer, nut, bush, hole)
  }

  // ---------------------------------------------------------------- the plug + cable
  const plug = new THREE.Group()
  {
    // lathe profiles run along +Y; the plug points into the panel (−Z)
    const sleeve = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.0, -0.33),
          new THREE.Vector2(0.024, -0.325),
          new THREE.Vector2(0.03, -0.3),
          new THREE.Vector2(0.022, -0.27),
          new THREE.Vector2(0.03, -0.25),
          new THREE.Vector2(0.03, -0.23),
          new THREE.Vector2(0.032, -0.22),
          new THREE.Vector2(0.032, 0.0),
          new THREE.Vector2(0.05, 0.0),
        ],
        20,
      ),
      jackMat,
    )
    const ringMat = new THREE.MeshStandardMaterial({ color: '#0a0908', roughness: 0.4 })
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.02, 20), ringMat)
    ring.position.y = -0.26
    // a black molded barrel with a nickel collar and a grip band (no hot chrome in the spot)
    const barrelProf: THREE.Vector2[] = [new THREE.Vector2(0.05, 0), new THREE.Vector2(0.06, 0.012), new THREE.Vector2(0.062, 0.05)]
    for (let i = 0; i < 5; i++) {
      const y = 0.14 + i * 0.045
      barrelProf.push(new THREE.Vector2(0.064, y), new THREE.Vector2(0.059, y + 0.014), new THREE.Vector2(0.064, y + 0.028))
    }
    barrelProf.push(new THREE.Vector2(0.064, 0.4), new THREE.Vector2(0.06, 0.43), new THREE.Vector2(0.046, 0.45))
    const barrel = new THREE.Mesh(
      new THREE.LatheGeometry(barrelProf, 28),
      new THREE.MeshPhysicalMaterial({ color: '#0d0b0a', roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    )
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.064, 0.07, 28), jackMat)
    collar.position.y = 0.07
    const relief = new THREE.Mesh(
      new THREE.LatheGeometry(
        [new THREE.Vector2(0.045, 0.44), new THREE.Vector2(0.046, 0.52), new THREE.Vector2(0.038, 0.62), new THREE.Vector2(0.03, 0.72), new THREE.Vector2(0.026, 0.78)],
        20,
      ),
      rubber(),
    )
    const lathe = new THREE.Group()
    lathe.add(sleeve, ring, barrel, collar, relief)
    lathe.rotation.x = Math.PI / 2 // +Y → +Z
    lathe.traverse(o => {
      o.castShadow = true
      o.receiveShadow = true
    })
    plug.add(lathe)
    // the cable: out of the strain relief, down to the stage and away toward the guitar
    const floorY = -7.4 - INPUT.y
    const pts = [
      [0, 0, 0.76],
      [0, -0.02, 1.05],
      [-0.06, -0.22, 1.55],
      [-0.3, -0.9, 2.1],
      [-0.7, -2.4, 2.45],
      [-1.1, -4.6, 2.6],
      [-1.4, floorY + 0.8, 2.8],
      [-1.8, floorY + 0.06, 3.4],
      [-3.0, floorY + 0.04, 5.0],
      [-5.5, floorY + 0.04, 7.0],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z))
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    const cab = new THREE.Mesh(new THREE.TubeGeometry(curve, mobile ? 90 : 160, 0.034, 10, false), rubber())
    cab.castShadow = true
    cab.receiveShadow = true
    plug.add(cab)
  }
  plug.position.set(INPUT.x, INPUT.y, ZF + 0.05)
  group.add(plug)
  await yieldFn()

  // ---------------------------------------------------------------- the big knob
  const bigKnob = chickenHead(knobMat, knobMat, lineMat, 1, true)
  bigKnob.position.set(VOL.x, VOL.y, ZF + 0.004)
  group.add(bigKnob)
  // a nickel washer under it (a glint ring)
  const washer = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.39, 64), nickel(0.22))
  washer.position.set(VOL.x, VOL.y, ZF + 0.006)
  group.add(washer)

  // ---------------------------------------------------------------- the VU meter
  const vuW = 0.86
  const vuH = 0.62
  const bezelShape = new THREE.Shape()
  roundRect(bezelShape, -vuW / 2 - 0.07, -vuH / 2 - 0.07, vuW / 2 + 0.07, vuH / 2 + 0.07, 0.07)
  const holeP = new THREE.Path()
  roundRect(holeP, -vuW / 2, -vuH / 2, vuW / 2, vuH / 2, 0.035)
  bezelShape.holes.push(holeP)
  const vuBezel = new THREE.Mesh(
    new THREE.ExtrudeGeometry(bezelShape, { depth: 0.045, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.014, bevelSegments: 3, curveSegments: 10 }),
    new THREE.MeshStandardMaterial({ color: '#1a1714', metalness: 0.6, roughness: 0.3 }),
  )
  vuBezel.position.set(VU.x, VU.y, ZF + 0.004)
  vuBezel.castShadow = true
  vuBezel.receiveShadow = true
  group.add(vuBezel)
  const vuMat = new THREE.MeshBasicMaterial({ map: vuFace(), color: '#000000' })
  const face = new THREE.Mesh(new THREE.PlaneGeometry(vuW, vuH), vuMat)
  face.position.set(VU.x, VU.y, ZF + 0.006)
  group.add(face)
  const needleGeo = new THREE.PlaneGeometry(0.009, 0.6)
  needleGeo.translate(0, 0.3, 0)
  const needle = new THREE.Mesh(needleGeo, new THREE.MeshBasicMaterial({ color: '#150c07' }))
  needle.position.set(VU.x, VU.y - vuH / 2 - 0.05 * 1.0, ZF + 0.016)
  group.add(needle)
  // glass: specular-only (additive black + reflections)
  const vuGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(vuW, vuH),
    new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.06, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  vuGlass.position.set(VU.x, VU.y, ZF + 0.045)
  group.add(vuGlass)
  await yieldFn()

  // ---------------------------------------------------------------- tubes
  const filament = new THREE.MeshBasicMaterial({ color: '#000000', toneMapped: false })
  const mats: TubeMats = {
    base: new THREE.MeshStandardMaterial({ color: '#1c1511', roughness: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#e4ecef', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03 }),
    getter: new THREE.MeshStandardMaterial({ color: '#b8b4ae', roughness: 0.12, metalness: 1, transparent: true, opacity: 0.7, depthWrite: false }),
    plate: new THREE.MeshStandardMaterial({ color: '#3a3733', roughness: 0.55, metalness: 0.7 }),
    mica: new THREE.MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.6, transparent: true, opacity: 0.55 }),
    filament,
  }
  const tubes = new THREE.Group()
  const preX = [-1.55, -1.12, -0.69]
  const powX = [0.12, 1.02, 1.92, 2.82]
  const tz = TUBES.z
  for (const x of preX) {
    const t = tube(false, mats)
    t.position.set(x, LOW_H, tz + 0.1)
    tubes.add(t)
  }
  for (const x of powX) {
    const t = tube(true, mats)
    t.position.set(x, LOW_H, tz)
    tubes.add(t)
  }
  group.add(tubes)
  // warm halos behind the power tubes and one soft wash across the window
  const haloMat = new THREE.MeshBasicMaterial({ map: haloMap(), color: '#000000', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false })
  for (const x of powX) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.2), haloMat)
    m.position.set(x, LOW_H + 0.55, tz - 0.2)
    m.renderOrder = 1
    group.add(m)
  }
  const preHaloMat = haloMat.clone()
  for (const x of preX) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.6), preHaloMat)
    m.position.set(x, LOW_H + 0.28, tz - 0.05)
    m.renderOrder = 1
    group.add(m)
  }
  // the glow inside the cabinet (lights the plates, the chassis, the back wall)
  const tubeLight = new THREE.PointLight('#ff7a2a', 0, 5.5, 2)
  tubeLight.position.set(1.45, LOW_H + 0.6, tz + 0.05)
  group.add(tubeLight)
  // the jewel's red spill on the gold
  const jewelLight = new THREE.PointLight('#ff2a14', 0, 1.3, 2)
  jewelLight.position.set(JEWEL.x, JEWEL.y, ZF + 0.3)
  group.add(jewelLight)

  // everything but the knob, the needle and the plug stands still: merge it
  mergeStatic(group, [bigKnob, needle, plug])
  await yieldFn()

  // ---------------------------------------------------------------- drivers
  const ORANGE = new THREE.Color('#ff6a1a')
  const HALO = new THREE.Color('#ff7a26')
  const PREHALO = new THREE.Color('#ff8a3a')
  const VULAMP = new THREE.Color('#ffd9a0')
  const JHALO = new THREE.Color('#ff2a14')
  const tmp = new THREE.Vector3()
  void tmp

  return {
    group,
    setDetent(d) {
      bigKnob.rotation.z = -dialAngle(d)
    },
    setTubes(v) {
      const k = Math.max(0, v)
      filament.color.copy(ORANGE).multiplyScalar(0.15 + k * 4.2)
      if (k < 0.01) filament.color.setScalar(0.02)
      haloMat.color.copy(HALO).multiplyScalar(k * 0.5)
      preHaloMat.color.copy(PREHALO).multiplyScalar(Math.min(1, k * 1.6) * 0.22)
      tubeLight.intensity = k * 5.5
    },
    setPilot(v) {
      jewelMat.emissiveIntensity = v * 2.6
      ;(jewelHalo.material as THREE.MeshBasicMaterial).color.copy(JHALO).multiplyScalar(v * 0.16)
      jewelLight.intensity = v * 0.06
    },
    setVu(n, lamp) {
      const A = (48 * Math.PI) / 180
      needle.rotation.z = -(-A + 2 * A * Math.min(1.04, Math.max(-0.02, n)))
      vuMat.color.copy(VULAMP).multiplyScalar(0.1 + lamp * 0.95)
    },
    setPlug(v) {
      plug.position.z = ZF + 0.05 + (1 - v) * 0.95
    },
    numberAt(d, out) {
      const a = dialAngle(d)
      return out.set(VOL.x + Math.sin(a) * NUM_R, VOL.y + Math.cos(a) * NUM_R, ZF)
    },
  }
}
