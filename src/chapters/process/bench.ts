import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { rng } from '../../core/math'
import { FONT, chrome, glow, gold, nickel, rubber, tile } from '../../kit/materials'
import { scaleUv } from '../../kit/stage'

/*
 * THE WORKBENCH — props for the process chapter (a luthier's bench on the
 * side of the stage): a worn butcher-block maple top, a pegboard back with a
 * rack of tools, an articulated work lamp (the follow spot is its pool), and
 * the build kit: a bookmatched maple body blank + its bandsaw offcut, the
 * pencil that traces the outline, a tuning fork on its resonance box, a
 * chisel, a fret-crowning file, a steel rule, a roll of gaffer, wood
 * shavings, a neck cradle, an HVLP spray gun with its mist, a clip-on tuner
 * and the jack + plug that bring the finished guitar to life.
 *
 * Units: 1 = 10 cm. The bench top is the plane y = 0 (world); guitar-local
 * props (blank, outline, jack) use the guitar's space (kit/guitar.ts: lies in
 * XY facing +Z, neck along +X, the body's binding edge at z = 0, the back at
 * z = -0.46, the carved top's crown at z = 0.14).
 *
 * Every texture is a small cached tile() — never a big canvas.
 */

/* ------------------------------------------------------------------ tiles */

const TAU = Math.PI * 2

/** worn butcher-block maple: strips along x, oil darkened, dings and knife nicks */
function benchMap() {
  return tile('wb-bench', 512, 512, (g, w, h) => {
    const r = rng(71)
    const strips = 8
    for (let i = 0; i < strips; i++) {
      const y0 = (i * h) / strips
      const sh = h / strips
      const k = r()
      g.fillStyle = `rgb(${Math.round(118 + k * 40)},${Math.round(80 + k * 28)},${Math.round(50 + k * 18)})`
      g.fillRect(0, y0, w, sh)
      // grain: seamless along x (whole periods of the tile)
      for (let j = 0; j < 30; j++) {
        const y = y0 + r() * sh
        const n = 1 + Math.floor(r() * 3)
        const a = 0.6 + r() * 2
        const ph = r() * TAU
        g.strokeStyle = r() > 0.35 ? `rgba(90,48,18,${0.06 + r() * 0.16})` : `rgba(235,190,130,${0.05 + r() * 0.08})`
        g.lineWidth = 0.4 + r() * 1.3
        g.beginPath()
        for (let x = 0; x <= w; x += 8) {
          const yy = y + Math.sin((x / w) * TAU * n + ph) * a
          if (x === 0) g.moveTo(x, yy)
          else g.lineTo(x, yy)
        }
        g.stroke()
      }
      // the glue line between strips
      g.fillStyle = 'rgba(40,18,6,0.55)'
      g.fillRect(0, y0, w, 1.3)
      g.fillStyle = 'rgba(255,220,170,0.08)'
      g.fillRect(0, y0 + 1.3, w, 1)
    }
    // oil + grime: soft dark blotches (kept off the edges so the tile wraps)
    for (let i = 0; i < 14; i++) {
      const x = 40 + r() * (w - 80)
      const y = 40 + r() * (h - 80)
      const rad = 14 + r() * 38
      const gr = g.createRadialGradient(x, y, 0, x, y, rad)
      gr.addColorStop(0, `rgba(40,18,6,${0.12 + r() * 0.16})`)
      gr.addColorStop(1, 'rgba(40,18,6,0)')
      g.fillStyle = gr
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    // dings, knife nicks, pencil ticks
    for (let i = 0; i < 90; i++) {
      const x = r() * w
      const y = r() * h
      g.strokeStyle = r() > 0.5 ? `rgba(30,14,6,${0.2 + r() * 0.3})` : `rgba(60,58,56,${0.18 + r() * 0.25})`
      g.lineWidth = 0.6 + r() * 0.8
      g.beginPath()
      const a = r() * TAU
      const l = 3 + r() * 14
      g.moveTo(x, y)
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      g.stroke()
    }
  })
}

/**
 * The body blank: two pieces of flame maple, bookmatched (mirrored about the
 * centre seam), grain along x, the flame across it. One image spans the blank.
 */
function blankMap() {
  return tile(
    'wb-blank',
    512,
    400,
    (g, w, h) => {
      const half = h / 2
      const r = rng(5)
      // draw the top half, then mirror it
      const img = g.createImageData(w, half)
      for (let y = 0; y < half; y++)
        for (let x = 0; x < w; x++) {
          const u = x / w
          const v = y / half
          // tiger flame: wavy, unevenly spaced stripes across the grain, slanting into the seam
          const warp = Math.sin(u * 7.3 + v * 1.7) * 0.6 + Math.sin(u * 17.1 - v * 3.3 + 1.1) * 0.3 + Math.sin(u * 41 + v * 5) * 0.1
          const flame = 0.5 + 0.5 * Math.sin(u * 104 + (1 - v) * 13 + warp * 8)
          const patch = Math.max(0, 0.35 + 0.65 * Math.sin(u * 4.1 + 0.7) * Math.sin(v * 2.6 + 0.9))
          const grain = Math.sin(v * 190 + Math.sin(u * 7) * 3) * 0.5 + 0.5
          const f = 1 + (flame - 0.5) * 0.26 * patch - grain * 0.05
          const i = (y * w + x) * 4
          img.data[i] = Math.min(255, 214 * f)
          img.data[i + 1] = Math.min(255, 180 * f)
          img.data[i + 2] = Math.min(255, 132 * f)
          img.data[i + 3] = 255
        }
      g.putImageData(img, 0, 0)
      // a few darker streaks in the grain
      for (let i = 0; i < 26; i++) {
        const y = r() * half
        g.strokeStyle = `rgba(150,96,50,${0.05 + r() * 0.1})`
        g.lineWidth = 0.5 + r() * 1.5
        g.beginPath()
        g.moveTo(0, y)
        g.bezierCurveTo(w * 0.3, y + r() * 6 - 3, w * 0.7, y + r() * 6 - 3, w, y + r() * 4 - 2)
        g.stroke()
      }
      // mirror to the lower half (bookmatch)
      g.save()
      g.translate(0, h)
      g.scale(1, -1)
      g.drawImage(g.canvas, 0, 0, w, half, 0, 0, w, half)
      g.restore()
      // the glue seam
      g.fillStyle = 'rgba(120,76,36,0.5)'
      g.fillRect(0, half - 0.75, w, 1.5)
    },
    { repeat: false },
  )
}

/** pegboard: oiled brown hardboard with a grid of holes (4 x 4 per tile) */
function pegMap() {
  return tile('wb-peg', 128, 128, (g, w, h) => {
    const r = rng(19)
    g.fillStyle = '#3a2416'
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,210,160' : '0,0,0'},${0.03 + r() * 0.04})`
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1)
    }
    for (let yy = 0; yy < 4; yy++)
      for (let xx = 0; xx < 4; xx++) {
        const cx = (xx + 0.5) * (w / 4)
        const cy = (yy + 0.5) * (h / 4)
        g.fillStyle = '#060302'
        g.beginPath()
        g.arc(cx, cy, 4.2, 0, TAU)
        g.fill()
        g.strokeStyle = 'rgba(255,200,150,0.12)'
        g.lineWidth = 1
        g.beginPath()
        g.arc(cx, cy + 0.6, 4.6, 0.2, Math.PI - 0.2)
        g.stroke()
      }
  })
}

/** the steel rule: satin steel, engraved ticks every 5 mm, numbers every 5 cm */
function ruleMap() {
  return tile(
    'wb-rule',
    1024,
    48,
    (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h)
      gr.addColorStop(0, '#cfccc6')
      gr.addColorStop(0.5, '#a9a6a0')
      gr.addColorStop(1, '#8d8a85')
      g.fillStyle = gr
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#1b1917'
      const mm = w / 600
      for (let i = 0; i <= 120; i++) {
        const x = 6 + i * 5 * mm * 0.99
        const long = i % 10 === 0 ? 0.55 : i % 2 === 0 ? 0.36 : 0.22
        g.fillRect(x, 0, 1.2, h * long)
      }
      g.font = FONT.mono(13, 600)
      g.textBaseline = 'bottom'
      for (let i = 1; i < 12; i++) g.fillText(String(i * 5), 6 + i * 50 * mm * 0.99 + 3, h - 4)
    },
    { repeat: false },
  )
}

/** the clip-on tuner's display: a warm backlit LCD, a cents scale, the note (decorative) */
function tunerMap() {
  return tile(
    'wb-tuner',
    256,
    168,
    (g, w, h) => {
      g.fillStyle = '#120a05'
      g.fillRect(0, 0, w, h)
      const gr = g.createRadialGradient(w / 2, h * 0.9, 10, w / 2, h * 0.9, w * 0.7)
      gr.addColorStop(0, 'rgba(255,170,70,0.22)')
      gr.addColorStop(1, 'rgba(255,170,70,0.02)')
      g.fillStyle = gr
      g.fillRect(0, 0, w, h)
      // the scale: an arc of ticks around the pivot (bottom centre)
      const cx = w / 2
      const cy = h * 0.92
      for (let i = -10; i <= 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * 0.95
        const r0 = i % 5 === 0 ? 96 : 104
        g.strokeStyle = i === 0 ? '#ffd27a' : 'rgba(255,214,150,0.75)'
        g.lineWidth = i === 0 ? 4 : i % 5 === 0 ? 2.5 : 1.5
        g.beginPath()
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
        g.lineTo(cx + Math.cos(a) * 116, cy + Math.sin(a) * 116)
        g.stroke()
      }
      g.fillStyle = 'rgba(255,214,150,0.8)'
      g.font = FONT.mono(13, 600)
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('♭', cx - 92, 22)
      g.fillText('♯', cx + 92, 22)
      g.font = FONT.display(40, 800)
      g.fillStyle = '#ffe2a8'
      g.fillText('E', cx, h * 0.55)
    },
    { repeat: false },
  )
}

/* ------------------------------------------------------------------ small helpers */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** a straight rod between two points */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg), mat)
  m.position.lerpVectors(a, b, 0.5)
  m.quaternion.setFromUnitVectors(V(0, 1, 0), V(0, 0, 0).subVectors(b, a).normalize())
  return m
}

/** UVs from xy (for a flat slab spanning [x0,x0+w] x [y0,y0+h]) */
function planarUv(geo: THREE.BufferGeometry, x0: number, y0: number, w: number, h: number) {
  const p = geo.attributes.position
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - x0) / w
    uv[i * 2 + 1] = (p.getY(i) - y0) / h
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

/* ------------------------------------------------------------------ the bench */

export const BENCH = { x0: -11.5, x1: 12.5, z0: -5.2, z1: 5, thick: 0.85, legs: 8.4 }

/** Butcher-block top (receives the lamp's shadows), a dark apron, legs, the pegboard back + tool rack. */
export function buildBench(mobile: boolean) {
  const group = new THREE.Group()
  const w = BENCH.x1 - BENCH.x0
  const d = BENCH.z1 - BENCH.z0
  const map = benchMap()
  // the top face: its own plane (so the tile repeats at its own scale)
  const topGeo = new THREE.PlaneGeometry(w, d, 1, 1)
  scaleUv(topGeo, w / 5.2, d / 5.2)
  const topMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.62, metalness: 0, envMapIntensity: 0.35 })
  const top = new THREE.Mesh(topGeo, topMat)
  top.rotation.x = -Math.PI / 2
  top.position.set((BENCH.x0 + BENCH.x1) / 2, 0, (BENCH.z0 + BENCH.z1) / 2)
  top.receiveShadow = true
  group.add(top)
  // the slab under it (the front edge shows the strips' end grain: a darker tone)
  const edgeGeo = new THREE.BoxGeometry(w, BENCH.thick, d)
  scaleUv(edgeGeo, w / 5.2, 1)
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#8a6446', map, roughness: 0.7 })
  const slab = new THREE.Mesh(edgeGeo, edgeMat)
  slab.position.set(top.position.x, -BENCH.thick / 2 - 0.002, top.position.z)
  slab.receiveShadow = true
  group.add(slab)
  // legs + a stretcher
  const legMat = new THREE.MeshStandardMaterial({ color: '#2a1a10', roughness: 0.7 })
  const legGeo = new THREE.BoxGeometry(0.9, BENCH.legs, 0.9)
  for (const x of [BENCH.x0 + 0.9, BENCH.x1 - 0.9])
    for (const z of [BENCH.z0 + 0.9, BENCH.z1 - 0.9]) {
      const l = new THREE.Mesh(legGeo, legMat)
      l.position.set(x, -BENCH.thick - BENCH.legs / 2, z)
      group.add(l)
    }
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(w - 1.2, 0.3, d - 1.4), legMat)
  shelf.position.set(top.position.x, -BENCH.thick - BENCH.legs + 1.6, top.position.z)
  group.add(shelf)

  // the pegboard back
  const pw = w
  const ph = 7.2
  const pegGeo = new THREE.PlaneGeometry(pw, ph)
  scaleUv(pegGeo, pw / 1.6, ph / 1.6)
  const peg = new THREE.Mesh(pegGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', map: pegMap(), roughness: 0.85 }))
  peg.position.set(top.position.x, ph / 2 - 0.05, BENCH.z0 - 0.02)
  peg.receiveShadow = true
  group.add(peg)
  // a frame batten along its top + bottom
  const batten = new THREE.MeshStandardMaterial({ color: '#4a2e1a', roughness: 0.6 })
  for (const y of [0.3, ph - 0.25]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.5, 0.3), batten)
    b.position.set(top.position.x, y, BENCH.z0 + 0.12)
    group.add(b)
  }

  // the tool rack on the pegboard: a batten with chisels, a coping saw, a coil of cable, a spare neck blank
  const rack = new THREE.Group()
  {
    const shelfB = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.28, 0.9), batten)
    shelfB.position.set(0, 0, 0.45)
    rack.add(shelfB)
    const handle = new THREE.LatheGeometry(
      [
        [0, 0],
        [0.1, 0.02],
        [0.13, 0.35],
        [0.12, 0.8],
        [0.08, 0.95],
        [0, 0.97],
      ].map(p => new THREE.Vector2(p[0], p[1])),
      12,
    )
    const hMat = new THREE.MeshStandardMaterial({ color: '#8a4a22', roughness: 0.45 })
    const bladeMat = nickel(0.35)
    const blade = new THREE.BoxGeometry(0.2, 1.0, 0.04)
    for (let i = 0; i < 6; i++) {
      const x = -2.2 + i * 0.85
      const hm = new THREE.Mesh(handle, hMat)
      hm.position.set(x, 0.12, 0.5)
      rack.add(hm)
      const bm = new THREE.Mesh(blade, bladeMat)
      bm.scale.x = 0.6 + i * 0.12
      bm.position.set(x, -0.52, 0.5)
      rack.add(bm)
    }
    rack.position.set(-5.2, 4.9, BENCH.z0)
    group.add(rack)
    // a coil of instrument cable on a peg
    const coil = new THREE.Group()
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.95 - i * 0.03, 0.05, 6, 40), rubber())
      t.position.set(i * 0.02, -i * 0.03, 0.25 + i * 0.03)
      t.rotation.set(0.05 * i, 0.08, 0.1 * i)
      coil.add(t)
    }
    const pegPin = rod(V(0, 0.9, 0), V(0, 0.9, 0.5), 0.05, nickel(0.3))
    coil.add(pegPin)
    coil.position.set(5.2, 4.1, BENCH.z0)
    group.add(coil)
    // a coping saw (a steel C frame + a handle)
    const saw = new THREE.Group()
    const frameMat = new THREE.MeshStandardMaterial({ color: '#1c1b1a', metalness: 0.7, roughness: 0.4 })
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 24, Math.PI), frameMat)
    arc.scale.set(1, 0.7, 1)
    saw.add(arc)
    const sawBlade = rod(V(-0.9, 0, 0), V(0.9, 0, 0), 0.012, nickel(0.3), 4)
    saw.add(sawBlade)
    const sh = new THREE.Mesh(handle, hMat)
    sh.rotation.z = Math.PI / 2
    sh.position.set(-0.95, 0, 0)
    saw.add(sh)
    saw.rotation.z = -0.3
    saw.position.set(8.4, 5.1, BENCH.z0 + 0.3)
    group.add(saw)
    // a pair of bar clamps
    const clampMat = new THREE.MeshStandardMaterial({ color: '#a02a1c', roughness: 0.45, metalness: 0.2 })
    for (let i = 0; i < 2; i++) {
      const c = new THREE.Group()
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.2, 0.06), nickel(0.4))
      c.add(bar)
      const jawA = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.22), clampMat)
      jawA.position.set(0.3, 1.9, 0)
      const jawB = jawA.clone()
      jawB.position.set(0.3, 0.6 - i * 0.5, 0)
      c.add(jawA, jawB)
      c.position.set(10.4 + i * 1.0, 3.5, BENCH.z0 + 0.25)
      c.rotation.z = 0.04 * (i ? 1 : -1)
      group.add(c)
    }
  }
  void mobile
  return { group, top }
}

/* ------------------------------------------------------------------ the work lamp */

/**
 * An articulated work lamp clamped to the back of the bench: two arms of
 * twin steel rods, a deep black enamel shade, a tungsten bulb inside
 * (bloom). `bulb` is where the follow spot hangs.
 */
export function buildLamp(base: THREE.Vector3, elbow: THREE.Vector3, head: THREE.Vector3, aim: THREE.Vector3) {
  const group = new THREE.Group()
  const steel = new THREE.MeshStandardMaterial({ color: '#2a2724', metalness: 0.85, roughness: 0.32 })
  const enamel = new THREE.MeshPhysicalMaterial({ color: '#1c1714', roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.3, metalness: 0.2, envMapIntensity: 0.35 })
  // clamp block on the bench edge
  const clamp = new THREE.Mesh(new RoundedBoxGeometry(0.7, 1.1, 0.7, 2, 0.08), steel)
  clamp.position.copy(base).add(V(0, 0.3, 0))
  group.add(clamp)
  // twin rods per arm
  const off = V(0, 0, 0.12)
  const side = V(0.12, 0, 0)
  for (const s of [-1, 1]) {
    group.add(rod(base.clone().add(V(0, 0.8, 0)).addScaledVector(side, s), elbow.clone().addScaledVector(side, s), 0.045, steel))
    group.add(rod(elbow.clone().addScaledVector(off, s), head.clone().addScaledVector(off, s), 0.04, steel))
  }
  const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 14).rotateZ(Math.PI / 2), steel)
  knuckle.position.copy(elbow)
  group.add(knuckle)
  // the shade: a deep cone opening toward `aim`
  const shade = new THREE.Group()
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 1.05, 1.35, 28, 1, true), enamel)
  outer.position.y = -0.6
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.33, 1.03, 1.33, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: '#f1e2c4', roughness: 0.5, side: THREE.BackSide }),
  )
  inner.position.y = -0.6
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 10, 0, TAU, 0, Math.PI / 2), enamel)
  cap.position.y = 0.06
  const lip = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.035, 6, 36), nickel(0.25))
  lip.rotation.x = Math.PI / 2
  lip.position.y = -1.27
  // the bulb: hot tungsten (bloom); only seen from below
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), glow('#ffcf8a', 3.2))
  bulb.position.y = -0.72
  shade.add(outer, inner, cap, lip, bulb)
  for (const m of [outer, cap]) m.castShadow = false
  shade.position.copy(head)
  // point the shade's opening (-y) at the aim
  shade.quaternion.setFromUnitVectors(V(0, -1, 0), aim.clone().sub(head).normalize())
  group.add(shade)
  shade.updateMatrixWorld(true)
  const bulbAt = new THREE.Vector3(0, -0.5, 0).applyMatrix4(shade.matrix)
  return { group, bulbAt }
}

/* ------------------------------------------------------------------ the blank + offcut */

/** The rectangle the body is cut from (guitar-local XY). */
export const BLANK = { x0: -2.12, x1: 2.92, y0: -1.94, y1: 1.94, z0: -0.46, z1: 0.14 }

/** A flame maple body blank (step 1) and the offcut frame left by the bandsaw (step 2). */
export function buildBlank(outline: THREE.Vector2[]) {
  const map = blankMap()
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.72, envMapIntensity: 0.3 })
  const { x0, x1, y0, y1, z0, z1 } = BLANK
  const W = x1 - x0
  const H = y1 - y0
  const rect = () => {
    const s = new THREE.Shape()
    s.moveTo(x0, y0)
    s.lineTo(x1, y0)
    s.lineTo(x1, y1)
    s.lineTo(x0, y1)
    s.closePath()
    return s
  }
  const opts = { depth: z1 - z0, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 1 }
  const blankGeo = new THREE.ExtrudeGeometry(rect(), opts)
  blankGeo.translate(0, 0, z0)
  planarUv(blankGeo, x0, y0, W, H)
  const blank = new THREE.Mesh(blankGeo, mat)
  blank.castShadow = true
  blank.receiveShadow = true

  const frameShape = rect()
  const hole = new THREE.Path(outline.slice().reverse())
  frameShape.holes.push(hole)
  const frameGeo = new THREE.ExtrudeGeometry(frameShape, { ...opts, bevelEnabled: false })
  frameGeo.translate(0, 0, z0)
  planarUv(frameGeo, x0, y0, W, H)
  const frame = new THREE.Mesh(frameGeo, mat)
  frame.castShadow = true
  frame.receiveShadow = true
  return { blank, frame }
}

/**
 * The traced outline: a graphite ribbon on the blank's top, drawn
 * progressively (setDraw 0..1). `at(t)` = the pencil's point + tangent.
 */
export function buildOutline(outline: THREE.Vector2[], z: number, width = 0.022) {
  const n = outline.length
  const pos: number[] = []
  const idx: number[] = []
  const pts = [...outline, outline[0]]
  const tan = (i: number) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    return new THREE.Vector2(b.x - a.x, b.y - a.y).normalize()
  }
  for (let i = 0; i < pts.length; i++) {
    const t = tan(i)
    const nx = -t.y * (width / 2)
    const ny = t.x * (width / 2)
    // a slight wobble in the pressure: the width breathes
    const k = 0.8 + 0.2 * Math.sin(i * 0.9) * Math.sin(i * 0.23)
    pos.push(pts[i].x - nx * k, pts[i].y - ny * k, z, pts[i].x + nx * k, pts[i].y + ny * k, z)
    if (i < pts.length - 1) {
      const a = i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    color: '#1e1b19',
    roughness: 0.42,
    metalness: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true
  const segs = n
  const outP = new THREE.Vector3()
  const outT = new THREE.Vector3()
  return {
    mesh,
    setDraw(t: number) {
      const k = Math.round(Math.max(0, Math.min(1, t)) * segs)
      geo.setDrawRange(0, k * 6)
      mesh.visible = k > 0
    },
    /** the head of the line at t (guitar-local) and its travel direction */
    at(t: number) {
      const f = Math.max(0, Math.min(1, t)) * segs
      const i = Math.min(segs - 1, Math.floor(f))
      const a = pts[i]
      const b = pts[i + 1]
      const u = f - i
      outP.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, z)
      outT.set(b.x - a.x, b.y - a.y, 0).normalize()
      return { p: outP, t: outT }
    },
  }
}

/* ------------------------------------------------------------------ the pencil */

/** A yellow hex pencil, sharpened. Local: the graphite point at the origin, the pencil along +Y. */
export function buildPencil() {
  const group = new THREE.Group()
  const L = 1.55
  const R = 0.04
  const paint = new THREE.MeshPhysicalMaterial({ color: '#e3a526', roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 })
  const wood = new THREE.MeshStandardMaterial({ color: '#d9ad7c', roughness: 0.8 })
  const lead = new THREE.MeshStandardMaterial({ color: '#2a2726', roughness: 0.35, metalness: 0.5 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 6), paint)
  body.position.y = 0.24 + L / 2
  body.castShadow = true
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.97, 0.013, 0.2, 12), wood)
  cone.position.y = 0.04 + 0.1
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.002, 0.045, 8), lead)
  tip.position.y = 0.0225
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.04, R * 1.04, 0.13, 14), gold(0.35))
  ferrule.position.y = 0.24 + L + 0.065
  const eraser = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.98, R * 0.94, 0.1, 14), new THREE.MeshStandardMaterial({ color: '#c77a6a', roughness: 0.8 }))
  eraser.position.y = 0.24 + L + 0.18
  group.add(body, cone, tip, ferrule, eraser)
  return { group, length: 0.24 + L + 0.23, radius: R }
}

/* ------------------------------------------------------------------ the tuning fork */

/**
 * A tuning fork standing in its maple resonance box (sits on y = 0, the box
 * along x). `setRing(0..1)` spreads the tines into their vibration blur.
 */
export function buildFork() {
  const group = new THREE.Group()
  const boxMat = new THREE.MeshStandardMaterial({ color: '#c79660', roughness: 0.5 })
  const box = new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.7, 0.9, 2, 0.05), boxMat)
  box.position.y = 0.35
  box.castShadow = true
  box.receiveShadow = true
  group.add(box)
  // the open end
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.74), new THREE.MeshBasicMaterial({ color: '#0a0503' }))
  mouth.position.set(1.051, 0.35, 0)
  mouth.rotation.y = Math.PI / 2
  mouth.scale.set(1.4, 0.72, 1)
  group.add(mouth)
  // a little rubber mallet beside it
  const mallet = new THREE.Group()
  const mh = rod(V(0, 0.07, 0), V(1.3, 0.07, 0), 0.03, new THREE.MeshStandardMaterial({ color: '#b98a5a', roughness: 0.5 }))
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), new THREE.MeshStandardMaterial({ color: '#6a1a12', roughness: 0.7 }))
  ball.position.set(1.36, 0.14, 0)
  mallet.add(mh, ball)
  mallet.position.set(-0.6, 0, 0.9)
  mallet.rotation.y = -0.35
  group.add(mallet)

  // satin steel: rough enough that the lamp lights it, not just the dark room
  const steel = new THREE.MeshStandardMaterial({ color: '#e6e0d6', metalness: 0.8, roughness: 0.3 })
  const fork = new THREE.Group()
  fork.position.set(-0.25, 0.7, 0)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 12), steel)
  stem.position.y = 0.2
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), steel)
  knob.position.y = 0.02
  const bend = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 8, 18, Math.PI), steel)
  bend.rotation.z = Math.PI
  bend.position.y = 0.6
  fork.add(stem, knob, bend)
  const tineGeo = new THREE.BoxGeometry(0.085, 1.25, 0.1)
  tineGeo.translate(0, 0.625, 0)
  const ghostMat = new THREE.MeshStandardMaterial({ color: '#efe6d8', metalness: 0.7, roughness: 0.35, transparent: true, opacity: 0.3, depthWrite: false })
  const pivots: THREE.Group[] = []
  const ghosts: THREE.Mesh[] = []
  for (const s of [-1, 1]) {
    const p = new THREE.Group()
    p.position.set(s * 0.15, 0.6, 0)
    const t = new THREE.Mesh(tineGeo, steel)
    t.castShadow = true
    p.add(t)
    fork.add(p)
    pivots.push(p)
    // the vibration envelope: ghost tines fanned either side (brightest at the turning points)
    for (const g of [-1, -0.55, 0.55, 1]) {
      const gp = new THREE.Group()
      gp.position.copy(p.position)
      const gm = new THREE.Mesh(tineGeo, ghostMat)
      gm.userData.sign = g * s
      gp.add(gm)
      fork.add(gp)
      ghosts.push(gm)
    }
  }
  group.add(fork)
  return {
    group,
    /** world-ish local position of the tine tips (for a pinned label, a spot) */
    top: V(-0.25, 0.7 + 0.6 + 1.25, 0),
    setRing(v: number) {
      const a = Math.max(0, Math.min(1, v))
      ghostMat.opacity = 0.28 * a
      for (const gm of ghosts) {
        gm.visible = a > 0.01
        gm.parent!.rotation.z = gm.userData.sign * 0.042 * a
      }
    },
  }
}

/* ------------------------------------------------------------------ bench tools */

/** A bench chisel lying on its side (along +x, the edge at +x). */
export function buildChisel() {
  const group = new THREE.Group()
  const handle = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0, 0],
        [0.12, 0.02],
        [0.15, 0.25],
        [0.14, 0.75],
        [0.11, 1.05],
        [0.09, 1.12],
        [0, 1.13],
      ].map(p => new THREE.Vector2(p[0], p[1])),
      16,
    ),
    new THREE.MeshPhysicalMaterial({ color: '#7a3a1a', roughness: 0.35, clearcoat: 0.6 }),
  )
  handle.rotation.z = -Math.PI / 2
  handle.position.set(-1.13, 0, 0)
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.14, 14).rotateZ(Math.PI / 2), gold(0.3))
  ferrule.position.set(0.05, 0, 0)
  const bladeGeo = new THREE.BoxGeometry(1.45, 0.05, 0.3)
  // taper the bevel at the tip
  const p = bladeGeo.attributes.position
  for (let i = 0; i < p.count; i++) if (p.getX(i) > 0 && p.getY(i) > 0) p.setX(i, p.getX(i) - 0.16)
  bladeGeo.computeVertexNormals()
  const blade = new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ color: '#8f8a82', metalness: 0.7, roughness: 0.62, envMapIntensity: 0.5 }))
  blade.position.set(0.12 + 0.725, 0, 0)
  group.add(handle, ferrule, blade)
  group.traverse(o => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).isMesh))
  // rest it on the bench: handle radius lifts the back
  group.rotation.z = -0.075
  group.position.y = 0.13
  return group
}

/** A fret-crowning file: a steel bar with a concave groove, a turned handle. */
export function buildFretFile() {
  const group = new THREE.Group()
  const bar = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.1, 0.2, 2, 0.02), new THREE.MeshStandardMaterial({ color: '#5d5b58', metalness: 0.9, roughness: 0.5 }))
  bar.position.set(0.8, 0, 0)
  const groove = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.05), new THREE.MeshStandardMaterial({ color: '#b8b4ad', metalness: 1, roughness: 0.25 }))
  groove.position.set(0.8, 0.052, 0)
  const handle = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0, 0],
        [0.1, 0.02],
        [0.12, 0.3],
        [0.11, 0.8],
        [0.07, 0.95],
        [0, 0.96],
      ].map(p => new THREE.Vector2(p[0], p[1])),
      14,
    ),
    new THREE.MeshPhysicalMaterial({ color: '#b27a44', roughness: 0.4, clearcoat: 0.5 }),
  )
  handle.rotation.z = Math.PI / 2
  handle.position.set(0, 0, 0)
  group.add(bar, groove, handle)
  bar.castShadow = true
  handle.castShadow = true
  group.position.y = 0.11
  group.rotation.z = 0.02
  return group
}

/** A 60 cm steel rule, flat on the bench (along x). */
export function buildRule() {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.02, 0.34),
    [
      nickel(0.5),
      nickel(0.5),
      new THREE.MeshStandardMaterial({ color: '#a39d93', map: ruleMap(), metalness: 0.55, roughness: 0.58, envMapIntensity: 0.25 }),
      nickel(0.5),
      nickel(0.5),
      nickel(0.5),
    ],
  )
  m.position.y = 0.011
  m.receiveShadow = true
  return m
}

/** A roll of gaffer tape lying flat, a torn tail. */
export function buildGafferRoll() {
  const group = new THREE.Group()
  const tape = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0.4, 0],
        [0.6, 0],
        [0.6, 0.48],
        [0.4, 0.48],
        [0.4, 0],
      ].map(p => new THREE.Vector2(p[0], p[1])),
      40,
    ),
    new THREE.MeshStandardMaterial({ color: '#1a1918', roughness: 0.6 }),
  )
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.48, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#9a7a52', roughness: 0.9, side: THREE.BackSide }))
  core.position.y = 0.24
  tape.castShadow = true
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.48), new THREE.MeshStandardMaterial({ color: '#1c1b1a', roughness: 0.55 }))
  tail.rotation.x = -Math.PI / 2
  tail.position.set(0.95, 0.004, 0.2)
  tail.rotation.z = -0.25
  group.add(tape, core, tail)
  return group
}

/** A neck cradle: a wooden block with a leather saddle (top at `height`). */
export function buildCradle(height: number) {
  const group = new THREE.Group()
  const block = new THREE.Mesh(new RoundedBoxGeometry(0.9, height - 0.04, 1.1, 2, 0.04), new THREE.MeshStandardMaterial({ color: '#5a3520', roughness: 0.6 }))
  block.position.y = (height - 0.04) / 2
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.05, 1.15, 2, 0.02), new THREE.MeshStandardMaterial({ color: '#1e1512', roughness: 0.75 }))
  pad.position.y = height - 0.02
  block.castShadow = true
  block.receiveShadow = true
  pad.receiveShadow = true
  group.add(block, pad)
  return group
}

/* ------------------------------------------------------------------ shavings */

/** One curled maple shaving (a tightening helix ribbon). */
function curlGeometry() {
  const n = 48
  const pos: number[] = []
  const idx: number[] = []
  const wd = 0.055
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = t * TAU * 2.1
    const r = 0.1 * (1 - 0.6 * t)
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    const z = t * 0.05
    pos.push(x, y, z - wd / 2, x, y, z + wd / 2)
    if (i < n) {
      const k = i * 2
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export interface Shavings {
  mesh: THREE.InstancedMesh
  /** grow shavings [from, to) to scale s */
  set(from: number, to: number, s: number): void
}

/** Instanced curls scattered at the given bench points (world xz), sitting on y = 0. */
export function buildShavings(points: { x: number; z: number; s?: number }[], seed = 3): Shavings {
  const mat = new THREE.MeshStandardMaterial({ color: '#f0d6a8', roughness: 0.7, side: THREE.DoubleSide })
  const mesh = new THREE.InstancedMesh(curlGeometry(), mat, points.length)
  const r = rng(seed)
  const base: THREE.Matrix4[] = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const s = new THREE.Vector3()
  points.forEach((p, i) => {
    // lying on its side: the helix axis roughly horizontal
    e.set(Math.PI / 2 + (r() - 0.5) * 0.6, r() * TAU, (r() - 0.5) * 0.5)
    q.setFromEuler(e)
    const k = (p.s ?? 1) * (0.6 + r() * 0.7)
    s.set(k, k * (0.8 + r() * 0.5), k)
    m.compose(new THREE.Vector3(p.x, 0.07 * k, p.z), q, s)
    base.push(m.clone())
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.receiveShadow = true
  const cur = new Float32Array(points.length).fill(1)
  const tmp = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  return {
    mesh,
    set(from, to, sc) {
      let dirty = false
      for (let i = from; i < Math.min(to, points.length); i++) {
        const v = Math.max(0.0001, sc)
        if (Math.abs(cur[i] - v) < 1e-4) continue
        cur[i] = v
        base[i].decompose(pos, quat, scl)
        tmp.compose(pos.setY(pos.y * v), quat, scl.multiplyScalar(v))
        mesh.setMatrixAt(i, tmp)
        dirty = true
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true
    },
  }
}

/* ------------------------------------------------------------------ the spray gun + mist */

/**
 * An HVLP spray gun (gunmetal body, an aluminium cup on top, a cream air
 * hose). Local: the nozzle at the origin, spraying along -Y.
 */
export function buildSprayGun() {
  const group = new THREE.Group()
  const gun = new THREE.Group()
  const metal = new THREE.MeshStandardMaterial({ color: '#6f6c68', metalness: 0.9, roughness: 0.32 })
  const dark = new THREE.MeshStandardMaterial({ color: '#1c1a19', roughness: 0.5, metalness: 0.3 })
  const alu = new THREE.MeshStandardMaterial({ color: '#a9a59e', metalness: 0.9, roughness: 0.46 })
  // modelled spraying along +x, then turned so the spray goes down (-Y)
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.42, 0.34, 3, 0.1), metal)
  body.position.set(-0.62, 0, 0)
  const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 16).rotateZ(-Math.PI / 2), alu)
  noz.position.set(-0.03, 0, 0)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 18).rotateZ(-Math.PI / 2), alu)
  cap.position.set(0.04, 0, 0)
  const hornGeo = new THREE.BoxGeometry(0.08, 0.1, 0.07)
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(hornGeo, alu)
    h.position.set(0.1, s * 0.17, 0)
    gun.add(h)
  }
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.62, 20), alu)
  cup.position.set(-0.55, 0.52, 0)
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.06, 20), dark)
  lid.position.set(-0.55, 0.86, 0)
  const handle = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.95, 0.26, 2, 0.08), dark)
  handle.position.set(-0.95, -0.55, 0)
  handle.rotation.z = -0.28
  const trigger = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 16, Math.PI * 0.8), metal)
  trigger.position.set(-0.6, -0.3, 0)
  trigger.rotation.z = Math.PI * 1.15
  gun.add(body, noz, cap, cup, lid, handle, trigger)
  // the air hose, trailing up and out of frame
  const hose = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([V(-1.1, -1.05, 0), V(-1.3, -1.6, 0.1), V(-2.2, -1.9, 0.4), V(-4.2, -1.2, 0.8), V(-7.5, 0.5, 1.2)]),
      40,
      0.07,
      8,
      false,
    ),
    new THREE.MeshStandardMaterial({ color: '#c9b48c', roughness: 0.55 }),
  )
  gun.add(hose)
  gun.rotation.z = -Math.PI / 2 // spray along -Y
  gun.traverse(o => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
  })
  group.add(gun)
  return group
}

/** The spray: an additive cone of amber mist from the nozzle (y = 0) down to y = -1 (scale y = reach). */
export function buildMist() {
  const geo = new THREE.CylinderGeometry(0.05, 0.62, 1, 28, 6, true)
  geo.translate(0, -0.5, 0)
  const uniforms = {
    uAmt: { value: 0 },
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#d9822c') },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAmt;
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        // uv.y: 1 at the nozzle, 0 at the surface
        float along = 1.0 - vUv.y;
        float n = vnoise(vec2(vUv.x * 18.0, along * 5.0 - uTime * 3.5)) * 0.6 + vnoise(vec2(vUv.x * 41.0, along * 11.0 - uTime * 6.0)) * 0.4;
        float edge = abs(dot(normalize(vN), normalize(vV)));
        float a = uAmt * (0.2 + 0.8 * n) * edge * smoothstep(0.1, 0.45, along) * (1.0 - smoothstep(0.8, 1.0, along));
        gl_FragColor = vec4(uColor * a * 0.32, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 4
  return { mesh, uniforms }
}

/* ------------------------------------------------------------------ the clip-on tuner */

/**
 * A clip-on tuner: a rubber jaw, a short swivel stalk, a black head with a
 * warm backlit display and a needle. Local: the jaw at the origin, the
 * display facing +Z, up = +Y. `setNeedle(cents -1..1)`, `setLit(0..1)`.
 */
export function buildClipTuner() {
  const group = new THREE.Group()
  const plastic = new THREE.MeshPhysicalMaterial({ color: '#0d0c0c', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 })
  const jaw = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.2, 0.36, 2, 0.06), rubber())
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.34, 10), plastic)
  stalk.position.y = 0.26
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), plastic)
  ball.position.y = 0.44
  const head = new THREE.Group()
  head.position.y = 0.72
  const shell = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.6, 0.16, 3, 0.07), plastic)
  shell.castShadow = true
  const screenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(0.95), map: tunerMap(), toneMapped: false })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.446), screenMat)
  screen.position.z = 0.081
  // the needle pivots at the bottom centre of the scale
  const pivot = new THREE.Group()
  pivot.position.set(0, -0.19, 0.084)
  const needleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd79a').multiplyScalar(1.3), toneMapped: false })
  const needle = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.29), needleMat)
  needle.position.y = 0.145
  pivot.add(needle)
  // the "in tune" lamp over the centre tick
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb040').multiplyScalar(0.2), toneMapped: false })
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.03, 14), lampMat)
  lamp.position.set(0, 0.2, 0.085)
  head.add(shell, screen, pivot, lamp)
  group.add(jaw, stalk, ball, head)
  const HOT = new THREE.Color('#ffb040')
  return {
    group,
    head,
    setNeedle(c: number) {
      pivot.rotation.z = -Math.max(-1, Math.min(1, c)) * 0.95
    },
    setLit(v: number) {
      lampMat.color.copy(HOT).multiplyScalar(0.15 + v * 2.4)
    },
  }
}

/* ------------------------------------------------------------------ jack + plug + cable */

/** An output jack plate for the body's rim (local: centred at origin, facing +Z). */
export function buildJackPlate() {
  const group = new THREE.Group()
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.26, 0.03, 2, 0.012), chrome(0.14))
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.05, 6).rotateX(Math.PI / 2), chrome(0.12))
  nut.position.z = 0.035
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.046, 16), new THREE.MeshBasicMaterial({ color: '#050404' }))
  hole.position.z = 0.061
  group.add(plate, nut, hole)
  for (const s of [-1, 1]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.01, 10).rotateX(Math.PI / 2), nickel(0.3))
    screw.position.set(s * 0.18, 0, 0.018)
    group.add(screw)
  }
  return group
}

/**
 * A 1/4" plug + its cable. The plug points along -Z (the tip at z = 0 when
 * seated); the cable leaves along +Z then follows `path` (points in the same
 * space as the plug group, i.e. the world when the group sits in the world).
 */
export function buildPlugCable(path: THREE.Vector3[]) {
  const group = new THREE.Group()
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.34, 14).rotateX(Math.PI / 2), nickel(0.38))
  sleeve.position.z = 0.17
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16).rotateX(Math.PI / 2), nickel(0.34))
  ring.position.z = 0.37
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.55, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#141312', roughness: 0.4, metalness: 0.2 }))
  boot.position.z = 0.67
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.3, 12).rotateX(Math.PI / 2), rubber())
  relief.position.z = 1.07
  group.add(sleeve, ring, boot, relief)
  const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal')
  const cab = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(40, path.length * 14), 0.036, 8, false), rubber())
  cab.castShadow = false
  cab.receiveShadow = true
  return { group, cable: cab }
}

