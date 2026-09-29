import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng } from '../../core/math'
import { buildAmp, type Amp } from '../../kit/amp'
import { FONT, chrome, glow, nickel, rubber, tolex } from '../../kit/materials'
import { buildPedal, cable, gaffer, stageFloor, type Pedal } from '../../kit/stage'

/*
 * THE PEDALBOARD SET (work). Units: 1 = 10 cm.
 *
 *  - a Pedaltrain-style board: black aluminium slats under hook-and-loop
 *    carpet, tilted toward the player (front low), on two side rails
 *  - SIX stompboxes left → right (the signal runs that way: the guitar's
 *    cable comes in at the left, the amp cable leaves at the right), each
 *    with the client's name on a strip of white gaffer tape stuck to its
 *    front face, chained by short patch cables with right-angle plugs
 *  - a power brick on the deck behind the pedals, daisy-chained DC leads
 *  - black gaffer holding the cables to the planks, cream spike marks
 *  - the SETLIST: a sheet of paper gaffer-taped to the floor right of the
 *    board with the nine other sites in marker caps
 *  - upstage: a ground-stacked LED video wall between two 4x12 cabs (the
 *    screen material lives in screen.ts)
 *
 * World layout: the board is centred on x = 0, its front edge toward +z
 * (the player, and the camera). The LED wall faces +z at z = SCREEN_Z.
 */

export interface PedalDef {
  fx: string
  sub: string
  color: string
  ink: string
  knobs: number
}

/** one stompbox per featured project, in WORK order (enamels: mustard, cream, oxblood, silver, orange, black) */
export const PEDALS: PedalDef[] = [
  { fx: 'Overdrive', sub: 'Tube drive', color: '#d29d1c', ink: '#17110a', knobs: 3 },
  { fx: 'Delay', sub: 'Tape echo', color: '#e6d8b8', ink: '#1a120c', knobs: 3 },
  { fx: 'Chorus', sub: 'Stereo', color: '#86261e', ink: '#f3e6cc', knobs: 2 },
  { fx: 'Fuzz', sub: 'Germanium', color: '#b4b0a8', ink: '#141110', knobs: 2 },
  { fx: 'Phaser', sub: 'Four stage', color: '#dc6418', ink: '#140c06', knobs: 1 },
  { fx: 'Reverb', sub: 'Spring · hall', color: '#171413', ink: '#f0e2c4', knobs: 3 },
]

/** stompbox pitch along the board */
export const PITCH = 1.15
export const pedalX = (i: number) => (i - (PEDALS.length - 1) / 2) * PITCH
/** the deck's tilt toward the player (radians) and its height at z = 0 */
export const TILT = 0.24
export const DECK_Y = 0.36
/** where the pedals sit on the deck (deck-local z) */
const PEDAL_Z = 0.02

/** the setlist sheet: centre on the floor and its yaw */
export const SHEET = { x: 5.75, z: 0.75, yaw: -0.2, w: 2.1, h: 2.97 }

/** the LED wall: centre, size (16:10) */
export const SCREEN_Z = -30
export const SCREEN_W = 17.6
export const SCREEN_H = 11
export const SCREEN_Y = 2.7 + SCREEN_H / 2

const LED = '#ffae42'

export interface BoardSet {
  root: THREE.Group
  pedals: Pedal[]
  /** world position of each pedal's top-face centre */
  tops: THREE.Vector3[]
  /** a pedal's footswitch world position */
  switches: THREE.Vector3[]
  screenAnchor: THREE.Object3D
  amps: Amp[]
  setlist: THREE.Mesh
  /** redraw canvas type once the faces are in (setlist + tape labels) */
  redraw(): void
}

/* ------------------------------------------------------------------ canvas art */

/** a torn strip of white cloth gaffer tape with a name in marker caps */
function tapeLabel(name: string, seed: number, w: number, h: number) {
  const draw = (g: CanvasRenderingContext2D, cw: number, ch: number) => {
    const r = rng(seed)
    g.clearRect(0, 0, cw, ch)
    // torn ends (jagged left/right), gently wavy long edges
    g.beginPath()
    const tear = cw * 0.03
    g.moveTo(tear, 1)
    for (let x = tear; x <= cw - tear; x += cw / 12) g.lineTo(x, 1 + r() * 2)
    for (let y = 0; y <= ch; y += ch / 9) g.lineTo(cw - tear * (0.2 + r() * 0.9), y)
    for (let x = cw - tear; x >= tear; x -= cw / 12) g.lineTo(x, ch - 1 - r() * 2)
    for (let y = ch; y >= 0; y -= ch / 9) g.lineTo(tear * (0.1 + r() * 0.9), y)
    g.closePath()
    const grad = g.createLinearGradient(0, 0, 0, ch)
    grad.addColorStop(0, '#f4efe3')
    grad.addColorStop(1, '#e4dccb')
    g.fillStyle = grad
    g.fill()
    g.save()
    g.clip()
    // cloth weave + a scuff or two
    for (let y = 0; y < ch; y += 3) {
      g.fillStyle = `rgba(120,100,70,${0.035 + r() * 0.03})`
      g.fillRect(0, y, cw, 1)
    }
    for (let x = 0; x < cw; x += 4) {
      g.fillStyle = `rgba(120,100,70,${0.02 + r() * 0.02})`
      g.fillRect(x, 0, 1, ch)
    }
    for (let i = 0; i < 3; i++) {
      g.fillStyle = `rgba(60,44,30,${0.04 + r() * 0.05})`
      g.beginPath()
      g.ellipse(r() * cw, r() * ch, 8 + r() * 26, 3 + r() * 6, r() * 3, 0, Math.PI * 2)
      g.fill()
    }
    // the name: condensed marker caps, one or two lines, a little crooked
    const words = name.toUpperCase().split(' ')
    let lines = [words.join(' ')]
    if (words.length > 1 && name.length > 12) {
      let best = 1
      let score = Infinity
      for (let k = 1; k < words.length; k++) {
        const a = words.slice(0, k).join(' ').length
        const b = words.slice(k).join(' ').length
        if (Math.abs(a - b) < score) {
          score = Math.abs(a - b)
          best = k
        }
      }
      lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')]
    }
    const n = lines.length
    const px = n === 1 ? ch * 0.52 : ch * 0.38
    g.fillStyle = '#16110d'
    g.strokeStyle = '#16110d'
    g.lineJoin = 'round'
    g.lineWidth = px * 0.05
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = FONT.display(px, 780)
    lines.forEach((ln, i) => {
      const tw = g.measureText(ln).width
      const sx = Math.min(0.8, (cw * 0.84) / tw)
      g.save()
      g.translate(cw / 2 + (r() - 0.5) * 6, ch / 2 + (i - (n - 1) / 2) * px * 1.02 + (r() - 0.5) * 3)
      g.rotate((r() - 0.5) * 0.035)
      g.scale(sx, 1)
      g.fillText(ln, 0, 0)
      g.strokeText(ln, 0, 0)
      g.restore()
    })
    g.restore()
  }
  return { draw, w, h }
}

/** the setlist: marker on paper, the nine other sites numbered 07 → 15 */
function setlistArt(names: string[]) {
  return (g: CanvasRenderingContext2D, cw: number, ch: number) => {
    const r = rng(77)
    const k = cw / 512
    // paper
    const grad = g.createLinearGradient(0, 0, cw, ch)
    grad.addColorStop(0, '#f2ecdf')
    grad.addColorStop(1, '#e2d9c6')
    g.fillStyle = grad
    g.fillRect(0, 0, cw, ch)
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(110,90,60,${r() * 0.05})`
      g.fillRect(r() * cw, r() * ch, 1 + r() * 2, 1)
    }
    // a fold across the middle and a faint cup ring
    g.fillStyle = 'rgba(80,60,40,0.07)'
    g.fillRect(0, ch * 0.5, cw, 2 * k)
    g.strokeStyle = 'rgba(120,70,30,0.13)'
    g.lineWidth = 6 * k
    g.beginPath()
    g.arc(cw * 0.8, ch * 0.83, 46 * k, 0.4, Math.PI * 1.85)
    g.stroke()

    const ink = '#15110e'
    g.fillStyle = ink
    g.strokeStyle = ink
    g.lineJoin = 'round'
    g.textBaseline = 'alphabetic'
    // header: marker caps + the script
    g.textAlign = 'left'
    g.font = FONT.display(56 * k, 820)
    g.save()
    g.translate(40 * k, 92 * k)
    g.rotate(-0.025)
    g.scale(0.74, 1)
    g.lineWidth = 2.4 * k
    g.fillText('NINE MORE', 0, 0)
    g.strokeText('NINE MORE', 0, 0)
    g.restore()
    g.fillStyle = '#9a3a12'
    g.font = FONT.script(50 * k)
    g.save()
    g.translate(300 * k, 96 * k)
    g.rotate(-0.08)
    g.fillText('all live', 0, 0)
    g.restore()
    // underline
    g.strokeStyle = ink
    g.lineWidth = 3.2 * k
    g.beginPath()
    g.moveTo(38 * k, 116 * k)
    g.bezierCurveTo(170 * k, 110 * k, 330 * k, 122 * k, 470 * k, 112 * k)
    g.stroke()
    // the names
    g.fillStyle = ink
    const top = 176 * k
    const step = (ch - top - 40 * k) / names.length
    names.forEach((nm, i) => {
      const y = top + i * step
      const x = 40 * k + (r() - 0.5) * 8 * k
      g.save()
      g.translate(x, y)
      g.rotate((r() - 0.5) * 0.03)
      g.font = FONT.mono(22 * k, 600)
      g.fillStyle = '#6a5a48'
      g.fillText(String(i + 7).padStart(2, '0'), 0, 0)
      g.fillStyle = ink
      const label = nm.toUpperCase()
      g.font = FONT.display(40 * k, 760)
      const tw = g.measureText(label).width
      const sx = Math.min(0.66, (cw - 110 * k) / tw)
      g.translate(48 * k, 0)
      g.scale(sx, 1)
      g.lineWidth = 1.6 * k
      g.fillText(label, 0, 0)
      g.strokeText(label, 0, 0)
      g.restore()
    })
  }
}

/** a drawn canvas that can be redrawn on fonts.ready (not a shared tile: it's ours alone) */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return {
    tex: t,
    redraw() {
      if (c.width < 2) return
      draw(g, w, h)
      t.needsUpdate = true
    },
    free() {
      // after the final upload the canvas is dead weight
      t.onUpdate = () => {
        c.width = c.height = 1
        t.onUpdate = null
      }
    },
  }
}

/**
 * Merge a container's static meshes that share a material into one mesh per
 * material (draw calls: the set was ~350 a frame with its shadow pass). The
 * materials are kept, so anything driven through a material (an amp's pilot
 * lamp, tube glow) still works. `skip` keeps a subtree (animated parts) as is.
 */
function mergeStatic(container: THREE.Object3D, cast: boolean, skip: (o: THREE.Object3D) => boolean = () => false) {
  container.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(container.matrixWorld).invert()
  const groups = new Map<THREE.Material, THREE.Mesh[]>()
  const walk = (o: THREE.Object3D) => {
    if (o !== container && skip(o)) return
    const m = o as THREE.Mesh
    if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && m.visible) {
      const list = groups.get(m.material) ?? []
      list.push(m)
      groups.set(m.material, list)
    }
    for (const c of o.children) walk(c)
  }
  walk(container)
  const mtx = new THREE.Matrix4()
  for (const [mat, meshes] of groups) {
    if (meshes.length < 2) {
      if (!cast) for (const m of meshes) m.castShadow = false
      continue
    }
    const geos = meshes.map(m => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
      g.morphAttributes = {}
      g.clearGroups()
      return g.applyMatrix4(mtx.multiplyMatrices(inv, m.matrixWorld))
    })
    let merged: THREE.BufferGeometry | null = null
    try {
      merged = mergeGeometries(geos)
    } catch {
      merged = null
    }
    geos.forEach(g => g.dispose())
    if (!merged) continue
    const one = new THREE.Mesh(merged, mat)
    one.castShadow = cast && meshes.some(m => m.castShadow)
    one.receiveShadow = true
    one.renderOrder = meshes[0].renderOrder
    for (const m of meshes) m.removeFromParent()
    container.add(one)
  }
}

/* ------------------------------------------------------------------ builders */

function boardFrame(): THREE.Group {
  const g = new THREE.Group()
  const W = 7.3
  const D = 1.95
  const carpet = new THREE.MeshStandardMaterial({ color: '#100e0d', roughness: 0.96 })
  const alu = new THREE.MeshStandardMaterial({ color: '#1c1a19', roughness: 0.42, metalness: 0.7 })
  // slats (deck-local: the deck top at y = 0, front toward +z)
  const slats = 4
  const gap = 0.12
  const sd = (D - gap * (slats - 1)) / slats
  const slatGeo = new RoundedBoxGeometry(W, 0.07, sd, 2, 0.02)
  for (let i = 0; i < slats; i++) {
    const s = new THREE.Mesh(slatGeo, carpet)
    s.position.set(0, -0.035, -D / 2 + sd / 2 + i * (sd + gap))
    s.receiveShadow = true
    g.add(s)
    // the aluminium lip under each slat's front edge
    const lip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.02), alu)
    lip.position.set(0, -0.08, s.position.z + sd / 2 - 0.01)
    g.add(lip)
  }
  // side rails: trapezoids down to the floor (world y = 0 is at deck-local
  // y = -(DECK_Y + z sin) / cos… close enough: build them tall and let the floor hide the rest)
  const shape = new THREE.Shape()
  const zf = D / 2
  const zb = -D / 2
  const yf = -(DECK_Y - zf * Math.sin(TILT)) / Math.cos(TILT) - 0.02
  const yb = -(DECK_Y - zb * Math.sin(TILT)) / Math.cos(TILT) - 0.02
  shape.moveTo(zf, 0)
  shape.lineTo(zf, yf)
  shape.lineTo(zb, yb)
  shape.lineTo(zb, 0)
  shape.closePath()
  const railGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 })
  // the shape is in (z, y) → rotate so shape-x runs along -z… map: shape.x → z, shape.y → y, extrude → x
  // shape x → +z, shape y → y, the extrusion → -x (0 … -0.1)
  railGeo.rotateY(-Math.PI / 2)
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, alu)
    rail.position.x = s > 0 ? W / 2 + 0.12 : -(W / 2 + 0.02)
    rail.castShadow = true
    rail.receiveShadow = true
    g.add(rail)
  }
  // a rubber foot strip along the front (it sits on the planks)
  return g
}

/** a right-angle jack plug: nickel sleeve + black boot, pointing along +x from a jack */
function plug(mat: THREE.Material, boot: THREE.Material): THREE.Group {
  const p = new THREE.Group()
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 12).rotateZ(Math.PI / 2), mat)
  sleeve.position.x = 0.025
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.13, 14), boot)
  body.position.set(0.075, 0.03, 0)
  p.add(sleeve, body)
  return p
}

function powerBrick(): THREE.Group {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.26, 0.42, 2, 0.04), new THREE.MeshStandardMaterial({ color: '#0e0d0d', roughness: 0.5, metalness: 0.3 }))
  box.position.y = 0.13
  box.castShadow = true
  box.receiveShadow = true
  g.add(box)
  // the output row: small barrel jacks + one amber power LED
  const jackGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10).rotateX(Math.PI / 2)
  const jm = nickel(0.3)
  for (let i = 0; i < 8; i++) {
    const j = new THREE.Mesh(jackGeo, jm)
    j.position.set(-1.05 + i * 0.26, 0.13, 0.215)
    g.add(j)
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), glow(LED, 3.2))
  led.position.set(1.12, 0.16, 0.215)
  g.add(led)
  return g
}

export async function buildBoard(opts: { mobile: boolean; restNames: string[]; clients: string[]; envMap: THREE.Texture; yieldFn: () => Promise<void> }): Promise<BoardSet> {
  const { mobile, restNames, clients, envMap, yieldFn } = opts
  const root = new THREE.Group()
  root.name = 'work-set'

  // ---- the stage floor
  // big: a small floor's far edge reads as a horizon band
  const floor = stageFloor(260, 200)
  floor.position.set(0, 0, -40)
  {
    // black planks: darker, and their own (weaker) stage reflections so a low
    // camera doesn't see the whole deck glare orange
    const fm = floor.material as THREE.MeshStandardMaterial
    fm.color.setScalar(0.7)
    fm.envMap = envMap
    fm.envMapIntensity = 0.28
  }
  root.add(floor)

  // ---- the deck
  const deck = new THREE.Group()
  deck.position.set(0, DECK_Y, 0)
  deck.rotation.x = TILT
  root.add(deck)
  deck.add(boardFrame())

  const bezelGeo = new THREE.TorusGeometry(0.042, 0.012, 6, 18).rotateX(Math.PI / 2)
  const bezelMat = chrome(0.2)
  const switchMat = new THREE.MeshStandardMaterial({ color: '#b9b2a4', metalness: 1, roughness: 0.38 })
  const jackMat = new THREE.MeshStandardMaterial({ color: '#8f887c', metalness: 1, roughness: 0.45 })
  const knobMat = new THREE.MeshStandardMaterial({ color: '#0b0a0a', roughness: 0.42, metalness: 0.1 })
  /** the footswitch sub-groups (they move: never merged) */
  const switchGroups = new Set<THREE.Object3D>()
  const pedals: Pedal[] = []
  const tapes: ReturnType<typeof canvasTex>[] = []
  for (let i = 0; i < PEDALS.length; i++) {
    const d = PEDALS[i]
    const p = buildPedal({ color: d.color, name: d.fx, sub: d.sub, ink: d.ink, knobs: d.knobs, led: LED })
    p.group.position.set(pedalX(i), 0, PEDAL_Z)
    // players never line them up perfectly
    p.group.rotation.y = [0.02, -0.03, 0.015, -0.02, 0.03, -0.012][i]
    // silver: hammered metal, not enamel
    if (d.fx === 'Fuzz') {
      const body = p.group.children[0] as THREE.Mesh
      const mats = body.material as THREE.MeshPhysicalMaterial[]
      for (const m of new Set(mats)) {
        m.metalness = 0.75
        m.roughness = 0.34
        m.clearcoat = 0.4
      }
    }
    p.setOn(0)
    // warmer, softer hardware: nickel footswitches, satin jacks (mirror chrome
    // throws hot red/white glints from a camera on the deck)
    p.group.traverse(o => {
      const m = o as THREE.Mesh
      const g = m.geometry as THREE.CylinderGeometry
      if (!m.isMesh || g.type !== 'CylinderGeometry') return
      const { radiusTop: r, radiusBottom: rb } = g.parameters
      if ((r === 0.075 && rb === 0.08) || r === 0.1) {
        m.material = switchMat
        switchGroups.add(m.parent!)
      } else if (r === 0.05) m.material = jackMat
      else if (r === 0.075 && rb === 0.085) m.material = knobMat
    })
    // the LED moves to the front of the face, beside the footswitch (where a
    // player looks — and where a camera on the deck can see it), in a bezel
    p.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh && (m.geometry as THREE.SphereGeometry).type === 'SphereGeometry') {
        m.position.set(-0.2, 0.4 + 0.022, 0.34)
        m.scale.setScalar(1.15)
      }
    })
    const bezel = new THREE.Mesh(bezelGeo, bezelMat)
    bezel.position.set(-0.2, 0.4 + 0.008, 0.34)
    p.group.add(bezel)
    // the client's name on white gaffer tape across the front face
    const art = tapeLabel(clients[i], 11 + i * 7, 448, 154)
    const ct = canvasTex(art.w, art.h, art.draw)
    tapes.push(ct)
    const tape = new THREE.Mesh(
      new THREE.PlaneGeometry(0.64, 0.22),
      new THREE.MeshStandardMaterial({ map: ct.tex, roughness: 0.82, alphaTest: 0.5, color: '#ffffff' }),
    )
    tape.position.set(0.004 * (i % 2 ? 1 : -1), 0.205, 0.6 + 0.004)
    tape.rotation.z = [0.03, -0.045, 0.02, -0.025, 0.04, -0.03][i]
    tape.receiveShadow = true
    p.group.add(tape)
    deck.add(p.group)
    pedals.push(p)
    if (i % 2) await yieldFn()
  }

  // ---- patch cables between neighbours (right jack of i → left jack of i+1)
  const plugMat = new THREE.MeshStandardMaterial({ color: '#8f887c', metalness: 1, roughness: 0.42 })
  const boot = rubber()
  const patchColors = ['#0d0c0c', '#6e1f18', '#0d0c0c', '#cdbf9f', '#0d0c0c']
  const jackY = 0.4 * 0.55
  const jackZ = PEDAL_Z - 1.2 * 0.2
  const edge = 0.37 + 0.05
  for (let i = 0; i < PEDALS.length - 1; i++) {
    const xa = pedalX(i) + edge
    const xb = pedalX(i + 1) - edge
    const pa = plug(plugMat, boot)
    pa.position.set(xa, jackY, jackZ)
    const pb = plug(plugMat, boot)
    pb.position.set(xb, jackY, jackZ)
    pb.rotation.y = Math.PI
    deck.add(pa, pb)
    const mid = (xa + xb) / 2
    const pts = [
      new THREE.Vector3(xa + 0.075, jackY + 0.09, jackZ),
      new THREE.Vector3(xa + 0.08, jackY + 0.2, jackZ - 0.06),
      new THREE.Vector3(mid, jackY + 0.3, jackZ - 0.2),
      new THREE.Vector3(xb - 0.08, jackY + 0.2, jackZ - 0.06),
      new THREE.Vector3(xb - 0.075, jackY + 0.09, jackZ),
    ]
    const c = cable(pts, 0.026)
    c.castShadow = false
    if (patchColors[i] !== '#0d0c0c') c.material = new THREE.MeshStandardMaterial({ color: patchColors[i], roughness: 0.6 })
    deck.add(c)
  }

  // ---- the power brick on the deck behind the pedals + DC leads
  const brick = powerBrick()
  brick.position.set(-0.4, 0, -0.86)
  deck.add(brick)
  const dcMat = new THREE.MeshStandardMaterial({ color: '#0b0a0a', roughness: 0.5 })
  for (let i = 0; i < PEDALS.length; i++) {
    const jx = -1.45 + i * 0.26
    const px = pedalX(i) + 0.18
    const pts = [
      new THREE.Vector3(jx, 0.13, -0.64),
      new THREE.Vector3(jx + (px - jx) * 0.3, 0.3, -0.62),
      new THREE.Vector3(px, 0.34, -0.6),
      new THREE.Vector3(px, 0.3, PEDAL_Z - 0.6),
    ]
    const c = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012, 5), dcMat)
    deck.add(c)
  }
  await yieldFn()

  // world positions (after the deck's matrix is known)
  root.updateMatrixWorld(true)
  const tops = pedals.map(p => p.group.localToWorld(new THREE.Vector3(0, 0.4, 0)))
  const switches = pedals.map(p => p.group.localToWorld(new THREE.Vector3(0, 0.45, 0.34)))
  const jackIn = pedals[0].group.localToWorld(new THREE.Vector3(-edge, jackY, jackZ - PEDAL_Z))
  const jackOut = pedals[PEDALS.length - 1].group.localToWorld(new THREE.Vector3(edge, jackY, jackZ - PEDAL_Z))

  // ---- the guitar cable coming in at the left, the amp cable leaving at the right
  const pin = plug(plugMat, boot)
  pin.position.set(pedalX(0) - edge, jackY, jackZ)
  pin.rotation.y = Math.PI
  deck.add(pin)
  const pout = plug(plugMat, boot)
  pout.position.set(pedalX(PEDALS.length - 1) + edge, jackY, jackZ)
  deck.add(pout)
  const props = new THREE.Group()
  root.add(props)
  const y0 = 0.04
  const guitarCable = cable(
    [
      new THREE.Vector3(-16, y0, 4.2),
      new THREE.Vector3(-10, y0, 3.1),
      new THREE.Vector3(-6.2, y0, 1.8),
      new THREE.Vector3(-4.6, y0, 0.5),
      new THREE.Vector3(jackIn.x - 0.35, jackIn.y - 0.1, jackIn.z + 0.05),
      new THREE.Vector3(jackIn.x - 0.14, jackIn.y + 0.08, jackIn.z),
    ],
    0.042,
  )
  guitarCable.castShadow = false
  props.add(guitarCable)
  const ampCable = cable(
    [
      new THREE.Vector3(jackOut.x + 0.14, jackOut.y + 0.08, jackOut.z),
      new THREE.Vector3(jackOut.x + 0.4, jackOut.y - 0.1, jackOut.z - 0.2),
      new THREE.Vector3(4.3, y0, -1.6),
      new THREE.Vector3(5.2, y0, -5),
      new THREE.Vector3(8.5, y0, -14),
      new THREE.Vector3(12.4, y0, -24.5),
      new THREE.Vector3(13.2, 0.8, -27),
    ],
    0.042,
  )
  ampCable.castShadow = false
  props.add(ampCable)
  // gaffer over the cables, cream spike marks where the player stands
  const g1 = gaffer(1.6, 0.46, '#1d1b19')
  g1.position.set(-7.6, 0.012, 2.35)
  g1.rotation.z = -0.62
  const g2 = gaffer(1.5, 0.46, '#1d1b19')
  g2.position.set(5.9, 0.012, -9)
  g2.rotation.z = 1.2
  props.add(g1, g2)
  const spike = (x: number, z: number, rot: number) => {
    const a = gaffer(0.6, 0.14, '#8f7f5e')
    const b = gaffer(0.36, 0.14, '#8f7f5e')
    a.position.set(x, 0.01, z)
    a.rotation.z = rot
    b.position.set(x + Math.cos(rot + Math.PI / 2) * 0.14, 0.011, z - Math.sin(rot + Math.PI / 2) * 0.14)
    b.rotation.z = rot + Math.PI / 2
    props.add(a, b)
  }
  spike(0.6, 3.2, 0.05)

  // ---- the setlist taped to the floor
  const sheetArt = canvasTex(mobile ? 384 : 512, mobile ? 543 : 724, setlistArt(restNames))
  const sheetGeo = new THREE.PlaneGeometry(SHEET.w, SHEET.h, 6, 8)
  {
    // a corner that doesn't lie flat
    const pos = sheetGeo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / (SHEET.w / 2)
      const y = pos.getY(i) / (SHEET.h / 2)
      const lift = Math.max(0, x + -y - 1.2)
      pos.setZ(i, lift * lift * 0.09)
    }
    sheetGeo.computeVertexNormals()
  }
  const setlist = new THREE.Mesh(sheetGeo, new THREE.MeshStandardMaterial({ map: sheetArt.tex, roughness: 0.88 }))
  setlist.rotation.set(-Math.PI / 2, 0, SHEET.yaw)
  setlist.position.set(SHEET.x, 0.012, SHEET.z)
  setlist.receiveShadow = true
  root.add(setlist)
  for (const [u, v, rot, len] of [
    [-0.46, 0.47, 0.7, 0.62],
    [0.46, 0.47, -0.6, 0.62],
    [-0.44, -0.48, -0.5, 0.56],
  ] as const) {
    const t = gaffer(len, 0.2, '#b9ae96')
    const c = Math.cos(SHEET.yaw)
    const s = Math.sin(SHEET.yaw)
    const lx = u * SHEET.w
    const lz = -v * SHEET.h
    t.position.set(SHEET.x + lx * c + lz * s, 0.02, SHEET.z - lx * s + lz * c)
    t.rotation.z = SHEET.yaw + rot
    props.add(t)
  }
  await yieldFn()

  // ---- upstage: the LED wall on a black riser, ground-support truss, two cabs
  const upstage = new THREE.Group()
  root.add(upstage)
  const riserMat = tolex()
  const riser = new THREE.Mesh(new RoundedBoxGeometry(SCREEN_W + 1.6, 2.7, 2.4, 2, 0.06), riserMat)
  riser.position.set(0, 1.35, SCREEN_Z - 0.6)
  riser.receiveShadow = true
  upstage.add(riser)
  const frameMat = new THREE.MeshStandardMaterial({ color: '#0c0b0b', roughness: 0.55, metalness: 0.4 })
  const back = new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 0.5, SCREEN_H + 0.5, 0.5), frameMat)
  back.position.set(0, SCREEN_Y, SCREEN_Z - 0.28)
  upstage.add(back)
  // truss towers + header (square box truss, read as silhouettes against the haze)
  const trussMat = new THREE.MeshStandardMaterial({ color: '#1a1817', roughness: 0.35, metalness: 0.85 })
  const chordGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6)
  const truss = (len: number, horizontal: boolean, x: number, y: number) => {
    const t = new THREE.Group()
    for (const [a, b] of [
      [-0.28, -0.28],
      [0.28, -0.28],
      [-0.28, 0.28],
      [0.28, 0.28],
    ]) {
      const c = new THREE.Mesh(chordGeo, trussMat)
      c.scale.y = len
      c.position.set(a, 0, b)
      t.add(c)
    }
    const rungs = Math.round(len / 1.1)
    for (let i = 0; i < rungs; i++) {
      const r = new THREE.Mesh(chordGeo, trussMat)
      r.scale.y = 0.78
      r.rotation.z = Math.PI / 4
      r.position.set(0, -len / 2 + (i + 0.5) * (len / rungs), 0.28)
      t.add(r)
    }
    if (horizontal) t.rotation.z = Math.PI / 2
    t.position.set(x, y, SCREEN_Z - 0.9)
    upstage.add(t)
  }
  const towerX = SCREEN_W / 2 + 1.2
  truss(SCREEN_Y + SCREEN_H / 2 + 1.6, false, -towerX, (SCREEN_Y + SCREEN_H / 2 + 1.6) / 2)
  truss(SCREEN_Y + SCREEN_H / 2 + 1.6, false, towerX, (SCREEN_Y + SCREEN_H / 2 + 1.6) / 2)
  truss(towerX * 2 + 0.6, true, 0, SCREEN_Y + SCREEN_H / 2 + 1.3)
  const screenAnchor = new THREE.Object3D()
  screenAnchor.position.set(0, SCREEN_Y, SCREEN_Z + 0.02)
  root.add(screenAnchor)
  await yieldFn()

  const amps: Amp[] = []
  for (const s of [-1, 1]) {
    const cab = buildAmp({ kind: 'cab', grille: s < 0 ? 'wheat' : 'oxblood' })
    cab.group.position.set(s * 16.2, 0, SCREEN_Z + 2.2)
    cab.group.rotation.y = -s * 0.16
    upstage.add(cab.group)
    amps.push(cab)
  }
  const head = buildAmp({ kind: 'head', tubes: 4 })
  head.group.position.set(-16.2, 7.4, SCREEN_Z + 2.2)
  head.group.rotation.y = 0.16
  upstage.add(head.group)
  amps.push(head)
  head.setPilot(1)
  head.setTubes(0.75)
  // small props must not cast (a busy shadow map); the big ones may
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    if (m.geometry.boundingSphere == null) m.geometry.computeBoundingSphere()
    const r = m.geometry.boundingSphere!.radius * Math.max(m.scale.x, m.scale.y, m.scale.z)
    if (r < 0.06) m.castShadow = false
  })
  // one draw per material: the deck's static hardware (not the pedals: they
  // stomp), the floor props, and the whole upstage (far outside the spot: no shadows)
  // (the pedals themselves never move — only their footswitches and LEDs)
  mergeStatic(deck, true, o => switchGroups.has(o))
  mergeStatic(props, false)
  mergeStatic(upstage, false)
  upstage.traverse(o => ((o as THREE.Mesh).castShadow = false))

  const redraw = () => {
    for (const t of tapes) t.redraw()
    sheetArt.redraw()
    for (const t of tapes) t.free()
    sheetArt.free()
  }

  return { root, pedals, tops, switches, screenAnchor, amps, setlist, redraw }
}
