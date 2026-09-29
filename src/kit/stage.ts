import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { FONT, blackKnob, chrome, glow, planks, rubber, tile } from './materials'

/*
 * STAGE props: the plank floor, patch cables, gaffer-tape marks, stompbox
 * pedals. Units: 1 = 10 cm.
 */

/** Black-painted stage planks, worn to the wood in places. Receives shadows. */
export function stageFloor(w = 60, d = 40): THREE.Mesh {
  // tile by scaling the UVs (textures are shared tiles: never clone them)
  const geo = new THREE.PlaneGeometry(w, d)
  scaleUv(geo, w / 12, d / 12)
  const m = new THREE.Mesh(geo, planks())
  m.rotation.x = -Math.PI / 2
  m.receiveShadow = true
  return m
}

/** Repeat a shared texture tile across a mesh by scaling its UVs. */
export function scaleUv(geo: THREE.BufferGeometry, sx: number, sy: number) {
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy)
  uv.needsUpdate = true
  return geo
}

/** A patch / instrument cable along a smooth curve through `points`. */
export function cable(points: THREE.Vector3[], radius = 0.035): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, points.length * 12), radius, 8, false), rubber())
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** A strip of gaffer tape lying on the floor (length along x). */
export function gaffer(len = 1.4, width = 0.48, color = '#1c1b1a'): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }))
  m.rotation.x = -Math.PI / 2
  m.receiveShadow = true
  return m
}

export interface PedalOptions {
  /** enclosure enamel colour */
  color?: THREE.ColorRepresentation
  /** the pedal's name, silkscreened on its face */
  name?: string
  /** a small line under the name */
  sub?: string
  /** ink colour of the lettering */
  ink?: string
  knobs?: number
  /** LED colour */
  led?: THREE.ColorRepresentation
}

export interface Pedal {
  group: THREE.Group
  /** 0 off → 1 on (the LED) */
  setOn(v: number): void
  /** 0..1 the footswitch pressed down */
  setStomp(v: number): void
  size: THREE.Vector3
}

/**
 * A stompbox: an enamelled die-cast enclosure (0.74 × 0.4 × 1.2, face +Y,
 * the footswitch toward +Z, the player), knobs at the back, a red LED, the
 * name silkscreened in the RIFF display face. Sits on y = 0.
 */
export function buildPedal(opts: PedalOptions = {}): Pedal {
  const w = 0.74
  const h = 0.4
  const d = 1.2
  const group = new THREE.Group()
  const color = new THREE.Color(opts.color ?? '#d8a21c')
  const ink = opts.ink ?? '#141110'
  const name = opts.name ?? 'Drive'
  const face = tile(
    `pedal-${name}-${opts.sub ?? ''}-${color.getHexString()}-${ink}`,
    256,
    416,
    (g, cw, ch) => {
      g.fillStyle = '#' + color.getHexString()
      g.fillRect(0, 0, cw, ch)
      g.fillStyle = ink
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      // name: condensed display caps — fit to width with a horizontal scale
      const px = 64
      g.font = FONT.display(px, 900)
      const tw = g.measureText(name.toUpperCase()).width
      const sx = Math.min(1, (cw * 0.84) / tw)
      g.save()
      g.translate(cw / 2, ch * 0.52)
      g.scale(sx, 1)
      g.fillText(name.toUpperCase(), 0, 0)
      g.restore()
      if (opts.sub) {
        g.font = FONT.mono(15, 600)
        g.fillText(opts.sub.toUpperCase().split('').join(' '), cw / 2, ch * 0.62)
      }
      g.lineWidth = 3
      g.strokeStyle = ink
      g.strokeRect(14, 14, cw - 28, ch - 28)
    },
    { repeat: false },
  )
  const enamel = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: face, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.12 })
  const sideMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.12 })
  const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, 0.05), [sideMat, sideMat, enamel, sideMat, sideMat, sideMat])
  body.position.y = h / 2
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // knobs along the back
  const n = opts.knobs ?? 3
  const kGeo = new THREE.CylinderGeometry(0.075, 0.085, 0.1, 20)
  const kMat = blackKnob()
  for (let i = 0; i < n; i++) {
    const k = new THREE.Mesh(kGeo, kMat)
    k.position.set((i - (n - 1) / 2) * (w * 0.3), h + 0.05, -d * 0.3)
    k.castShadow = true
    group.add(k)
  }
  // footswitch
  const sw = new THREE.Group()
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 6), chrome(0.12))
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.08, 20), chrome(0.08))
  cap.position.y = 0.06
  sw.add(nut, cap)
  sw.position.set(0, h + 0.025, d * 0.28)
  group.add(sw)
  // LED + a little glow
  const ledColor = new THREE.Color(opts.led ?? '#ff2a14')
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), glow(ledColor, 0.1))
  led.position.set(0, h + 0.012, -d * 0.08)
  group.add(led)
  // jacks on the sides
  const jack = new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12).rotateZ(Math.PI / 2)
  for (const s of [1, -1]) {
    const j = new THREE.Mesh(jack, chrome(0.2))
    j.position.set((s * w) / 2 + s * 0.02, h * 0.55, -d * 0.2)
    group.add(j)
  }
  const ledMat = led.material as THREE.MeshBasicMaterial
  return {
    group,
    size: new THREE.Vector3(w, h, d),
    setOn(v) {
      ledMat.color.copy(ledColor).multiplyScalar(0.08 + v * 6)
    },
    setStomp(v) {
      sw.position.y = h + 0.025 - v * 0.03
    },
  }
}
