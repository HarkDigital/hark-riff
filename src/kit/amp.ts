import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { logoGeometry } from '../logo/logo'
import { FONT, blackKnob, chrome, cream, glow, grille, tile, tolex } from './materials'
import { scaleUv } from './stage'

/*
 * AMPS — the backline. Black tolex, cream piping, basketweave grille cloth,
 * a brushed-gold control panel with chicken-head knobs, a red jewel pilot
 * lamp, chrome toggles, and (for heads) a row of power TUBES you can see
 * glowing through the back. The Hark mark is piped onto the grille in cream
 * where an amp maker's script logo would be.
 *
 *   const amp = buildAmp({ kind: 'head' })
 *   amp.setKnob(i, 0..1)   // pointer sweeps 7 o'clock → 5 o'clock
 *   amp.setPilot(0..1)     // the jewel lamp (0 = off)
 *   amp.setTubes(0..1)     // tube glow (0 cold → 1 cooking)
 *   amp.knobs[i]           // Object3D at each knob (face +Z)
 *
 * Local space: the amp sits on y = 0, centred on x, the front face at
 * z = depth / 2 (facing +Z). Units: 1 = 10 cm (a 4x12 cab is ~7.6 wide).
 */

export type AmpKind = 'head' | 'combo' | 'cab'

export interface AmpOptions {
  kind?: AmpKind
  grille?: 'wheat' | 'oxblood' | 'salt'
  /** knob labels on the panel (head / combo) */
  labels?: string[]
  /** show the mark badge on the grille */
  badge?: boolean
  /** power tubes behind the panel (head only) */
  tubes?: number
}

const SIZES: Record<AmpKind, [number, number, number]> = {
  head: [7.4, 2.7, 2.6],
  combo: [6.4, 5.2, 2.7],
  cab: [7.6, 7.4, 3.6],
}

export interface Amp {
  group: THREE.Group
  size: THREE.Vector3
  knobs: THREE.Object3D[]
  pilot: THREE.Mesh
  tubes: THREE.Group
  setKnob(i: number, v: number): void
  setPilot(v: number): void
  setTubes(v: number): void
}

/** the panel's lettering: small spaced caps under each knob */
function panelMap(labels: string[], w: number) {
  return tile(
    'panel-' + labels.join('|'),
    1024,
    128,
    (g, cw, ch) => {
      // brushed gold
      const grad = g.createLinearGradient(0, 0, 0, ch)
      grad.addColorStop(0, '#e6c47c')
      grad.addColorStop(0.5, '#d4ad62')
      grad.addColorStop(1, '#b8914a')
      g.fillStyle = grad
      g.fillRect(0, 0, cw, ch)
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,240,200' : '90,60,20'},${0.04 + Math.random() * 0.05})`
        g.fillRect(0, Math.random() * ch, cw, 0.6)
      }
      g.fillStyle = '#1a1208'
      g.font = FONT.mono(15, 600)
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const n = labels.length
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * cw * 0.78 + cw * 0.04
        g.fillText(labels[i].toUpperCase().split('').join(' '), x, ch * 0.86)
      }
      void w
    },
    { repeat: false },
  )
}

export function buildAmp(opts: AmpOptions = {}): Amp {
  const kind = opts.kind ?? 'head'
  const [w, h, d] = SIZES[kind]
  const group = new THREE.Group()
  group.name = 'amp-' + kind

  const box = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, 0.14), tolex())
  box.position.y = h / 2
  box.castShadow = true
  box.receiveShadow = true
  group.add(box)

  const front = d / 2 + 0.004
  const knobs: THREE.Object3D[] = []
  const knobGroup = new THREE.Group()
  group.add(knobGroup)
  const tubes = new THREE.Group()
  let pilot: THREE.Mesh

  // grille area
  const panelH = kind === 'head' ? h * 0.46 : kind === 'combo' ? 0.9 : 0
  const gx = w - 0.5
  const gTop = h - 0.25 - panelH
  const gh = gTop - 0.25
  const clothGeo = new THREE.PlaneGeometry(gx, gh)
  scaleUv(clothGeo, gx / 1.1, gh / 1.1)
  const cloth = new THREE.Mesh(clothGeo, grille(opts.grille ?? 'wheat'))
  cloth.position.set(0, 0.25 + gh / 2, front)
  cloth.receiveShadow = true
  group.add(cloth)

  // cream piping round the grille
  const pipeMat = cream(0.45)
  const pipe = (len: number, vertical: boolean, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 8), pipeMat)
    if (!vertical) m.rotation.z = Math.PI / 2
    m.position.set(x, y, front + 0.01)
    group.add(m)
  }
  pipe(gx, false, 0, 0.25 + gh)
  pipe(gx, false, 0, 0.25)
  pipe(gh, true, -gx / 2, 0.25 + gh / 2)
  pipe(gh, true, gx / 2, 0.25 + gh / 2)

  if (opts.badge !== false) {
    const badge = new THREE.Mesh(logoGeometry({ depth: 0.04 }), cream(0.3))
    const s = Math.min(1.1, gh * 0.34)
    badge.scale.setScalar(s)
    badge.position.set(-gx / 2 + s * 0.8, 0.25 + gh - s * 0.75, front + 0.03)
    group.add(badge)
  }

  if (panelH > 0) {
    const labels = opts.labels ?? (kind === 'head' ? ['Presence', 'Bass', 'Middle', 'Treble', 'Vol I', 'Vol II'] : ['Volume', 'Treble', 'Bass', 'Reverb'])
    const pw = w - 0.4
    const ph = panelH - 0.12
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, ph),
      new THREE.MeshStandardMaterial({ color: '#ffffff', map: panelMap(labels, pw), metalness: 0.85, roughness: 0.36 }),
    )
    const py = h - 0.2 - ph / 2
    panel.position.set(0, py, front)
    panel.receiveShadow = true
    group.add(panel)
    // chicken-head knobs
    const skirt = new THREE.CylinderGeometry(0.2, 0.22, 0.12, 24).rotateX(Math.PI / 2)
    const head = new THREE.BoxGeometry(0.12, 0.44, 0.1)
    const pointer = new THREE.PlaneGeometry(0.03, 0.2)
    const kMat = blackKnob()
    const pMat = cream(0.3)
    for (let i = 0; i < labels.length; i++) {
      const k = new THREE.Group()
      const s = new THREE.Mesh(skirt, kMat)
      const hd = new THREE.Mesh(head, kMat)
      hd.position.set(0, 0.04, 0.1)
      const p = new THREE.Mesh(pointer, pMat)
      p.position.set(0, 0.12, 0.152)
      k.add(s, hd, p)
      k.position.set(-pw / 2 + ((i + 0.5) / labels.length) * pw * 0.78 + pw * 0.04, py + ph * 0.08, front + 0.06)
      k.castShadow = true
      knobs.push(k)
      knobGroup.add(k)
    }
    // jewel lamp + two toggles on the right of the panel
    const jewel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), glow('#ff2a14', 0.2))
    jewel.position.set(pw / 2 - 0.35, py + 0.06, front + 0.1)
    pilot = jewel
    group.add(jewel)
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 8, 24), chrome(0.15))
    bezel.position.copy(jewel.position).setZ(front + 0.03)
    group.add(bezel)
    for (let t = 0; t < 2; t++) {
      const sw = new THREE.Group()
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 6).rotateX(Math.PI / 2), chrome(0.15))
      const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.26, 10), chrome(0.1))
      bat.rotation.x = Math.PI / 2 - 0.5
      bat.position.set(0, 0.06, 0.12)
      sw.add(nut, bat)
      sw.position.set(pw / 2 - 0.8 - t * 0.38, py + 0.06, front + 0.03)
      group.add(sw)
    }
  } else {
    pilot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.001, 0), glow('#000000', 0))
    pilot.visible = false
  }

  // power tubes (heads): glass bottles with glowing plates, standing behind the panel
  if (kind === 'head' && (opts.tubes ?? 4) > 0) {
    const n = opts.tubes ?? 4
    const glassGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.95, 20, 1, false)
    const domeGeo = new THREE.SphereGeometry(0.22, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
    const plateGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12, 1, true)
    const glass = new THREE.MeshPhysicalMaterial({ color: '#d8e2e6', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1 })
    const plate = new THREE.MeshStandardMaterial({ color: '#2a2622', metalness: 0.6, roughness: 0.5 })
    for (let i = 0; i < n; i++) {
      const t = new THREE.Group()
      const gl = new THREE.Mesh(glassGeo, glass)
      gl.position.y = 0.475
      const dm = new THREE.Mesh(domeGeo, glass)
      dm.position.y = 0.95
      const pl = new THREE.Mesh(plateGeo, plate)
      pl.position.y = 0.5
      const fil = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 10), glow('#ff6a1a', 0))
      fil.position.y = 0.5
      fil.name = 'filament'
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 16), new THREE.MeshStandardMaterial({ color: '#1a1714', roughness: 0.6 }))
      base.position.y = 0.07
      t.add(base, pl, fil, gl, dm)
      t.position.set(-w / 2 + 1.3 + i * 0.62, h - 0.02, -d / 2 + 0.6)
      tubes.add(t)
    }
    group.add(tubes)
  }

  // carry handle
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 20, Math.PI), new THREE.MeshStandardMaterial({ color: '#0e0c0b', roughness: 0.5 }))
  handle.scale.set(1, 0.4, 1)
  handle.position.set(0, h + 0.01, 0)
  group.add(handle)

  const pilotMat = pilot.material as THREE.MeshBasicMaterial
  const filaments: THREE.MeshBasicMaterial[] = []
  tubes.traverse(o => {
    if (o.name === 'filament') filaments.push((o as THREE.Mesh).material as THREE.MeshBasicMaterial)
  })
  const RED = new THREE.Color('#ff2a14')
  const ORANGE = new THREE.Color('#ff6a1a')

  return {
    group,
    size: new THREE.Vector3(w, h, d),
    knobs,
    pilot,
    tubes,
    setKnob(i, v) {
      const k = knobs[i]
      if (k) k.rotation.z = -(v - 0.5) * (300 * Math.PI) / 180
    },
    setPilot(v) {
      pilotMat.color.copy(RED).multiplyScalar(0.12 + v * 4)
    },
    setTubes(v) {
      for (const m of filaments) m.color.copy(ORANGE).multiplyScalar(v * 5)
    },
  }
}
