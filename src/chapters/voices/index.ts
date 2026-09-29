import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { SECTIONS, TESTIMONIALS } from '../../content'
import { clamp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { StoryClock } from '../../kit/pace'
import { buildGuitar, type Guitar } from '../../kit/guitar'
import { Ring } from '../../kit/strings'
import { stageFloor, gaffer } from '../../kit/stage'
import { fontsReady } from '../../kit/materials'
import { GEL } from '../../world/World'
import { CELLULOID_CSS, PICK_H, drawAtlas, pickGeometry, pickMaterial, type PickDesign } from './picks'
import { buildBokeh, bokehScale, type Bokeh } from './bokeh'
import './voices.css'

/*
 * VOICES · "The Picks". Between songs the guitar lies on its back on the
 * stage planks. Eight custom picks are woven into its strings — four
 * standing up in the first frets, four in the fan of strings between the
 * nut and the tuners — each printed with a client's name like a band's
 * custom picks (picks.ts). The camera is LOW, a few centimetres over the
 * strings on a long lens, looking up the neck on a diagonal from the treble
 * side (so the picks before the one in focus stand clear to the left and
 * the ones after it step away to the right). It glides up the neck from
 * pick to pick like a hand changing position, the follow spot tracking the
 * pick in focus, and the string that pick is tucked in rings softly as the
 * camera arrives. Beyond the headstock the stage melts into out-of-focus
 * lamps (bokeh.ts) and backlit haze; the far planks dissolve into it.
 *
 *   0.00–0.113 intro: the whole row of picks up the neck; eyebrow +
 *              "We listen. They talk." held clear of the cut (landing
 *              0.075, intro 0.07)
 *   0.113–0.955 eight voices, one at a time (anchors = slot centres), each
 *              ~0.58 vh (~2.5 s at a gentle wheel); the quote card swaps in
 *              ~0.5 s and carries the pick's own miniature and NN / 08
 *   0.955–1.00 out: a slow push onto the last pick for the cab cut (the
 *              spot stays on: a lit frame)
 *
 * PACING (WCAG 2.3.1): the voice, the spot and the camera follow a
 * StoryClock in slot units (≤ 1.1 voice changes a second); the camera then
 * glides between picks on a critically damped spring (~0.9 s), so every
 * move takes well over 0.5 s of TIME; everything snaps on teleports.
 * Reduced motion / Motion off: no idle drift, no parallax, no ringing.
 */

const N = TESTIMONIALS.length
const A0 = 0.113
const A1 = 0.955
const SPAN = (A1 - A0) / N
const HYST = 0.06
const INTRO_Q = 0.7
const OUT_Q = 0.45
const PACE = 1.1
const toQ = (local: number) =>
  local < A0 ? -INTRO_Q * (1 - local / A0) : local <= A1 ? (local - A0) / SPAN : N + (OUT_Q * (local - A1)) / (1 - A1)

/* ---------------------------------------------------------------- the picks */

/** print designs, in TESTIMONIALS order (company names verbatim, set like custom band picks) */
const DESIGNS: PickDesign[] = [
  {
    celluloid: 'tortoise',
    ink: '#f2cf86',
    foil: true,
    border: true,
    lines: [
      { text: 'Fabbri', face: 'script', size: 0.2, y: 0.018 },
      { text: 'BUILDERS', face: 'display', size: 0.07, y: -0.042, track: 0.12 },
    ],
    ornament: 'star',
  },
  {
    celluloid: 'cream',
    ink: '#8a2218',
    foil: false,
    lines: [
      { text: 'Shriver’s', face: 'script', size: 0.16, y: 0.04 },
      { text: 'SALT WATER', face: 'display', size: 0.066, y: -0.012, track: 0.06 },
      { text: 'TAFFY', face: 'display', size: 0.1, y: -0.058, track: 0.08 },
    ],
  },
  {
    celluloid: 'black',
    ink: '#f2cf86',
    foil: true,
    border: true,
    lines: [
      { text: 'CROSSFIT', face: 'display', size: 0.09, y: 0.038, track: 0.04 },
      { text: 'Off The Grid', face: 'script', size: 0.13, y: -0.02 },
    ],
    ornament: 'rule',
  },
  {
    celluloid: 'oxblood',
    ink: '#f2cf86',
    foil: true,
    lines: [
      { text: 'Bellview', face: 'script', size: 0.18, y: 0.022 },
      { text: 'WINERY', face: 'display', size: 0.075, y: -0.038, track: 0.2 },
    ],
    ornament: 'dots',
  },
  {
    celluloid: 'pearl',
    ink: '#16110f',
    foil: false,
    border: true,
    lines: [
      { text: 'PEG', face: 'display', size: 0.19, y: 0.03, track: 0.04 },
      { text: 'GLASS', face: 'display', size: 0.066, y: -0.03, track: 0.34 },
    ],
  },
  {
    celluloid: 'amber',
    ink: '#2a1206',
    foil: false,
    lines: [
      { text: 'OUR LADY OF', face: 'display', size: 0.058, y: 0.058, track: 0.08 },
      { text: 'Mercy', face: 'script', size: 0.17, y: 0.0 },
      { text: 'ACADEMY', face: 'display', size: 0.066, y: -0.05, track: 0.14 },
    ],
  },
  {
    celluloid: 'tobacco',
    ink: '#f3e6cc',
    foil: false,
    lines: [
      { text: 'The', face: 'script', size: 0.1, y: 0.062 },
      { text: 'HOME', face: 'display', size: 0.1, y: 0.012, track: 0.06 },
      { text: 'HERO', face: 'display', size: 0.1, y: -0.043, track: 0.06 },
    ],
  },
  {
    celluloid: 'slate',
    ink: '#f1e4c8',
    foil: false,
    border: true,
    lines: [
      { text: 'PROVIDER', face: 'display', size: 0.08, y: 0.035, track: 0.03 },
      { text: 'Soft', face: 'script', size: 0.16, y: -0.024 },
    ],
  },
]

/**
 * Where each pick is woven in. `on` = the fretboard (guitar local: x along
 * the neck from the bridge, y toward the bass side, the tip resting on the
 * board) or the headstock (its own frame: u from the nut, v bass side, the
 * tip on the face). `lean` tips the pick back toward the headstock, `yaw`
 * turns it about the board normal, `spin` twists it in its own plane.
 * `string` is the string it's tucked in (0 low E … 5 high e).
 */
interface Place {
  on: 'board' | 'head'
  x: number
  y: number
  lean: number
  yaw: number
  spin: number
  string: number
}
const PLACES: Place[] = [
  { on: 'board', x: 4.32, y: 0.06, lean: 0.42, yaw: 0.56, spin: 0.06, string: 1 },
  { on: 'board', x: 4.86, y: 0.0, lean: 0.46, yaw: 0.7, spin: -0.08, string: 2 },
  { on: 'board', x: 5.42, y: -0.03, lean: 0.38, yaw: 0.58, spin: 0.05, string: 3 },
  { on: 'board', x: 6.02, y: 0.02, lean: 0.44, yaw: 0.66, spin: -0.06, string: 2 },
  { on: 'head', x: 0.28, y: 0.2, lean: 0.5, yaw: 0.56, spin: 0.07, string: 1 },
  { on: 'head', x: 0.63, y: 0.01, lean: 0.54, yaw: 0.68, spin: -0.08, string: 2 },
  { on: 'head', x: 0.98, y: -0.19, lean: 0.48, yaw: 0.58, spin: 0.06, string: 3 },
  { on: 'head', x: 1.34, y: -0.31, lean: 0.52, yaw: 0.66, spin: -0.05, string: 5 },
]
/** the tip's height above the surface it stands on (board top / headstock face) */
const BOARD_TIP_Z = 0.204
/**
 * The camera over each pick: its elevation above the board and how far round
 * to the treble side it looks from (radians). Looking up the neck on a
 * diagonal, the picks before the one in focus stand clear to the left and
 * the ones after it step away to the right — a row receding up the neck.
 */
const EL = 0.2
const AZ = -0.74
const HEAD_TIP_W = 0.016

/* ---------------------------------------------------------------- helpers */

/** a critically damped follower (time-based; snaps on demand) */
class Spring {
  x = NaN
  v = 0
  constructor(public omega = 4.2) {}
  update(target: number, dt: number, snap = false) {
    if (snap || !Number.isFinite(this.x)) {
      this.x = target
      this.v = 0
      return this.x
    }
    const w = this.omega
    const f = 1 + 2 * dt * w
    const hoo = dt * w * w
    const hhoo = dt * hoo
    const det = 1 / (f + hhoo)
    const x = (f * this.x + dt * this.v + hhoo * target) * det
    this.v = (this.v + hoo * (target - this.x)) * det
    this.x = x
    return x
  }
  settled(target: number) {
    return Math.abs(this.x - target) < 1e-3 && Math.abs(this.v) < 1e-3
  }
}

/** uniform Catmull-Rom through a list of vectors at parameter s (0..n-1, clamped ends) */
function catmull(pts: THREE.Vector3[], s: number, out: THREE.Vector3) {
  const n = pts.length
  const x = clamp(s, 0, n - 1)
  const i = Math.min(n - 2, Math.floor(x))
  const t = x - i
  const p0 = pts[Math.max(0, i - 1)]
  const p1 = pts[i]
  const p2 = pts[i + 1]
  const p3 = pts[Math.min(n - 1, i + 2)]
  const t2 = t * t
  const t3 = t2 * t
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z))
}

type Mode = 'wide' | 'tall' | 'short'

/**
 * The planks dissolve into the dark with distance (alpha), so the far floor
 * never draws a hard horizon against the backdrop's haze: a long lens's
 * background just melts into smoke and lamps.
 */
function fadeFloor(floor: THREE.Mesh) {
  const m = floor.material as THREE.MeshStandardMaterial
  m.transparent = true
  m.depthWrite = true
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloorW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFloorW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloorW;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(12.0, 34.0, distance(vFloorW, cameraPosition));',
      )
  }
  m.customProgramCacheKey = () => 'riff-voices-floor'
}

/* ---------------------------------------------------------------- chapter */

export default function create(): Chapter {
  const group = new THREE.Group()
  let g: Guitar
  let bokeh: Bokeh
  const picks: THREE.Mesh[] = []
  const clock = new StoryClock({ rate: PACE, snap: 1 })
  const cam = new Spring(4.2)
  const rings = Array.from({ length: 6 }, () => new Ring(2.4, 0.4))
  let state = -1
  let lastQ = NaN
  let entering = true
  let settled = true
  let camT = -1

  // each pick's centre in world space (after init)
  const centre: THREE.Vector3[] = []
  // the guitar's frame in world space
  const AX = new THREE.Vector3() // along the neck, toward the headstock
  const NRM = new THREE.Vector3() // the board's normal (up, off the face)
  const BASS = new THREE.Vector3() // across, toward the bass side

  // DOM
  let probe: HTMLElement
  let copy: HTMLElement
  let intro: HTMLElement
  let introTitle: HTMLElement
  let card: HTMLElement
  const figs: HTMLElement[] = []
  const badges: HTMLImageElement[] = []
  let shown = -99

  const lay = { W: 0, H: 0, mode: 'wide' as Mode, cx: 0, cy: 0, pickPx: 200, fov: 24, left: 0, right: 0, top: 0, bottom: 0 }
  const probeCam = new THREE.PerspectiveCamera()
  let dirty = true
  // the camera path: pose 0 = intro, 1..N = picks, N + 1 = the out push
  const camPos: THREE.Vector3[] = []
  const camTgt: THREE.Vector3[] = []
  const spotAt: THREE.Vector3[] = []
  const pos = new THREE.Vector3()
  const tgt = new THREE.Vector3()
  const spot = new THREE.Vector3()
  let fov = 24
  const buf = new THREE.Vector2()

  /* ---------------------------------------------------------------- build */

  function place(p: Place) {
    // pick space: face +Z, top +Y → stand it up off the surface (+Z local),
    // its face toward the bridge (-X), then lean it back, turn and twist it
    const q = new THREE.Quaternion()
    const e = (x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order))
    q.multiply(e(0, 0, p.yaw))
      .multiply(e(0, p.lean, 0))
      .multiply(e(0, 0, -Math.PI / 2))
      .multiply(e(Math.PI / 2, 0, 0))
      .multiply(e(0, 0, p.spin))
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
    const tipZ = p.on === 'board' ? BOARD_TIP_Z : HEAD_TIP_W
    const c = new THREE.Vector3(p.x, p.y, tipZ).addScaledVector(up, PICK_H * 0.5 - 0.004)
    return { q, c }
  }

  async function buildPicks(mobile: boolean) {
    await fontsReady()
    const atlas = await drawAtlas(DESIGNS, mobile ? 256 : 512, nextFrame)
    for (let i = 0; i < N; i++) {
      const p = PLACES[i]
      const mesh = new THREE.Mesh(pickGeometry(atlas.cell(i)), pickMaterial(atlas, DESIGNS[i].celluloid))
      const { q, c } = place(p)
      mesh.quaternion.copy(q)
      mesh.position.copy(c)
      mesh.castShadow = true
      mesh.receiveShadow = true
      ;(p.on === 'board' ? g.group : g.parts.headstock).add(mesh)
      picks.push(mesh)
    }
    // each quote card carries a miniature of its own pick
    atlas.minis.forEach((src, i) => {
      if (!src) return
      badges[i].src = src
      badges[i].parentElement?.classList.add('has-mini')
    })
  }

  /* ---------------------------------------------------------------- layout */

  function measure(W0: number, H0: number) {
    // before the first real frame (prewarm) the size can still be zero
    const W = W0 > 1 ? W0 : window.innerWidth || 1280
    const H = H0 > 1 ? H0 : window.innerHeight || 720
    lay.W = W
    lay.H = H
    const portrait = W / Math.max(1, H) <= 1
    const short = !portrait && H <= 500
    lay.mode = portrait ? 'tall' : short ? 'short' : 'wide'
    const band = probe.getBoundingClientRect()
    const top = band.height > 0 ? band.top : H * 0.105
    const bottom = band.height > 0 ? band.bottom : H * 0.895
    const c = copy.getBoundingClientRect()
    if (lay.mode === 'tall') {
      const regionB = c.height > 0 ? c.top - 12 : H * 0.6
      const rh = Math.max(120, regionB - top)
      lay.fov = 30
      lay.cx = W / 2
      lay.cy = top + rh * 0.52
      lay.pickPx = Math.min(rh * 0.44, W * 0.42)
      lay.left = 8
      lay.right = W - 8
      lay.top = top
      lay.bottom = regionB
    } else {
      const left = c.width > 0 ? c.right + W * 0.02 : W * 0.46
      const right = W - Math.max(20, W * 0.03)
      const rw = Math.max(160, right - left)
      const rh = Math.max(120, bottom - top)
      lay.fov = short ? 26 : 24
      lay.cx = (left + right) / 2
      lay.cy = top + rh * 0.5
      lay.pickPx = Math.min(rh * (short ? 0.5 : 0.4), rw * 0.44)
      lay.left = left
      lay.right = right
      lay.top = top
      lay.bottom = bottom
    }
    buildPath()
    dirty = false
  }

  /** a camera at `from` (unit direction from the subject) placing world point `at` at (cx, cy) px, `px` = pick height */
  function framing(at: THREE.Vector3, from: THREE.Vector3, pickPx: number, outP: THREE.Vector3, outT: THREE.Vector3) {
    const tanV = Math.tan(THREE.MathUtils.degToRad(lay.fov / 2))
    const D = (PICK_H * lay.H) / (2 * tanV * Math.max(40, pickPx))
    outP.copy(at).addScaledVector(from, D)
    // shift the aim so the subject sits at (cx, cy) instead of dead centre
    const f = new THREE.Vector3().subVectors(at, outP).normalize()
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize()
    const up = new THREE.Vector3().crossVectors(right, f)
    const nx = (lay.cx / lay.W) * 2 - 1
    const ny = 1 - (lay.cy / lay.H) * 2
    outT.copy(at)
      .addScaledVector(right, -nx * D * tanV * (lay.W / lay.H))
      .addScaledVector(up, -ny * D * tanV)
  }

  /** is world point `p` (with a margin of `r` world units round it) inside the free area, seen from pos → tgt? */
  function inRegion(p: THREE.Vector3, from: THREE.Vector3, at: THREE.Vector3, r: number) {
    const c = probeCam
    c.fov = lay.fov
    c.aspect = lay.W / Math.max(1, lay.H)
    c.updateProjectionMatrix()
    c.position.copy(from)
    c.up.set(0, 1, 0)
    c.lookAt(at)
    c.updateMatrixWorld(true)
    const v = p.clone().project(c)
    const x = (v.x * 0.5 + 0.5) * lay.W
    const y = (0.5 - v.y * 0.5) * lay.H
    const rpx = (r * lay.H) / (2 * Math.tan(THREE.MathUtils.degToRad(lay.fov / 2)) * from.distanceTo(p))
    return v.z < 1 && x - rpx > lay.left && x + rpx < lay.right && y - rpx > lay.top && y + rpx < lay.bottom
  }

  /** direction from a subject to the camera: `el` above the board, `az` toward the bass side (the guitar's frame) */
  function dirFrom(el: number, az: number) {
    return new THREE.Vector3()
      .addScaledVector(AX, -Math.cos(el) * Math.cos(az))
      .addScaledVector(BASS, Math.cos(el) * Math.sin(az))
      .addScaledVector(NRM, Math.sin(el))
      .normalize()
  }

  function buildPath() {
    if (!centre.length) return
    camPos.length = camTgt.length = spotAt.length = 0
    // intro: the whole row up the neck, from further back and a little higher,
    // fitted into the free area (clear of the headline): aim nearer the first
    // pick and pull back until the first and last picks are both in frame
    const mid = new THREE.Vector3()
    const pi = new THREE.Vector3()
    const ti = new THREE.Vector3()
    const introDir = dirFrom(0.22, AZ + 0.1)
    const first = lay.mode === 'tall' ? 1 : 0
    const lastIn = lay.mode === 'tall' ? N - 3 : N - 2
    fit: for (const k of [0.62, 0.56, 0.5, 0.44, 0.38, 0.33, 0.29])
      for (const t of [0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2]) {
        mid.lerpVectors(centre[0], centre[N - 1], t)
        framing(mid, introDir, lay.pickPx * k, pi, ti)
        if (inRegion(centre[first], pi, ti, PICK_H * 0.5) && inRegion(centre[lastIn], pi, ti, PICK_H * 0.5)) break fit
      }
    camPos.push(pi)
    camTgt.push(ti)
    spotAt.push(mid.clone())
    for (let i = 0; i < N; i++) {
      const P = new THREE.Vector3()
      const T = new THREE.Vector3()
      framing(centre[i], dirFrom(EL, AZ), lay.pickPx, P, T)
      camPos.push(P)
      camTgt.push(T)
      spotAt.push(centre[i].clone())
    }
    // out: push onto the last pick
    const last = centre[N - 1]
    const po = new THREE.Vector3()
    const to = new THREE.Vector3()
    framing(last, dirFrom(EL + 0.04, AZ - 0.06), lay.pickPx * 1.4, po, to)
    camPos.push(po)
    camTgt.push(to)
    spotAt.push(last.clone())
  }

  /* ---------------------------------------------------------------- DOM */

  function buildDom(stage: HTMLElement) {
    probe = el('div', 'pk-probe', undefined, stage)
    copy = el('div', 'pk-copy', undefined, stage)
    intro = el('div', 'pk-intro', undefined, copy)
    el('p', 'hud-eyebrow pk-eyebrow', SECTIONS.voices.eyebrow, intro)
    introTitle = rise(el('h2', 'hud-h2 pk-title', undefined, intro), 'We listen. They <em>talk.</em>')
    card = el('div', 'pk-card hud-panel', undefined, copy)
    const stack = el('div', 'pk-stack', undefined, card)
    TESTIMONIALS.forEach((t, i) => {
      const f = el('figure', 'pk-fig', undefined, stack)
      if (t.quote.length > 170) f.classList.add('pk-fig--long')
      const head = el('div', 'pk-head', undefined, f)
      const badge = el('span', 'pk-badge', undefined, head)
      const cs = CELLULOID_CSS[DESIGNS[i].celluloid]
      badge.style.setProperty('--pk-bg', cs.bg)
      const img = el('img', 'pk-mini', undefined, badge)
      img.alt = ''
      img.decoding = 'async'
      badges.push(img)
      const idx = el('p', 'hud-label pk-idx', undefined, head)
      el('span', 'pk-n', String(i + 1).padStart(2, '0'), idx)
      idx.append(` / ${String(N).padStart(2, '0')}`)
      el('blockquote', 'hud-quote pk-q', `“${t.quote}”`, f)
      const who = el('figcaption', 'pk-who', undefined, f)
      el('span', 'pk-name', t.name, who)
      el('span', 'pk-co', t.company, who)
      figs.push(f)
    })
    const mark = () => (dirty = true)
    window.addEventListener('resize', mark)
    document.fonts?.ready.then(mark)
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(mark).observe(copy)
  }

  function show(next: number, local: number) {
    setRise(introTitle, next === 0 && local > 0.012)
    if (next === shown) return
    shown = next
    intro.classList.toggle('is-on', next === 0)
    card.classList.toggle('is-on', next >= 1)
    figs.forEach((f, i) => f.classList.toggle('is-on', i === next - 1))
  }

  /** 0 = intro, 1..N = voice i - 1, from the clock (slot units); hysteresis round the previous state */
  function stateFor(x: number, prev: number, snap: boolean) {
    const raw = x < 0 ? 0 : Math.min(N, Math.floor(x) + 1)
    if (snap || prev < 0 || raw === prev) return raw
    const lo = prev === 0 ? -Infinity : prev - 1
    const hi = prev === 0 ? 0 : prev >= N ? Infinity : prev
    return x > lo - HYST && x < hi + HYST ? prev : raw
  }

  /* ---------------------------------------------------------------- chapter */

  return {
    id: 'voices',
    group,
    anchors: TESTIMONIALS.map((_, i) => A0 + SPAN * (i + 0.5)),

    async init(ctx: ChapterContext) {
      buildDom(ctx.stage)
      // the stage: planks, a strip of gaffer, and the guitar on its back
      const floor = stageFloor(220, 160)
      fadeFloor(floor)
      group.add(floor)
      g = buildGuitar({ mobile: ctx.mobile })
      // lying on its back (the body's back on the floor), the neck along +X, turned a little
      g.group.rotation.set(-Math.PI / 2, 0, 0)
      g.group.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), 0.16)
      g.group.position.set(-3.2, 0.462, 0.4)
      g.group.updateMatrixWorld(true)
      // satin the frets a little: under a tight spot, mirror-bright wire reads as LED strips
      ;(g.parts.frets.material as THREE.MeshStandardMaterial).roughness = 0.3
      group.add(g.group)
      const tape = gaffer(2.4, 0.46, '#1d1b19')
      tape.position.set(4.2, 0.003, 1.6)
      tape.rotation.z = 0.5
      group.add(tape)
      await nextFrame()
      bokeh = buildBokeh(ctx.mobile)
      group.add(bokeh.points)
      await nextFrame()
      await buildPicks(ctx.mobile)
      g.group.updateMatrixWorld(true)
      const m = g.group.matrixWorld
      AX.set(1, 0, 0).transformDirection(m)
      NRM.set(0, 0, 1).transformDirection(m)
      BASS.set(0, 1, 0).transformDirection(m)
      for (const p of picks) centre.push(p.getWorldPosition(new THREE.Vector3()))
      dirty = true
    },

    onEnter() {
      clock.reset()
      entering = true
      shown = -99
    },

    onLeave() {
      entering = true
    },

    busy() {
      return !settled
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      if (!g) return
      if (dirty || (frame.width > 1 && (lay.W !== frame.width || lay.H !== frame.height))) {
        measure(frame.width, frame.height)
        ctx.renderer.getDrawingBufferSize(buf)
        bokehScale(bokeh, buf.y, lay.fov)
      }
      const dt = frame.dt
      const calm = frame.reducedMotion || !!frame.still
      const q0 = toQ(local)
      const snap = entering || !Number.isFinite(lastQ) || Math.abs(q0 - lastQ) > clock.snap
      lastQ = q0
      const x = clock.update(q0, dt)
      const prev = state
      state = stateFor(x, state, snap)
      entering = false

      /* ---- the camera index: intro -1 … picks 0..N-1 … out N ---- */
      if (state === 0) camT = -1 + 0.18 * smoothstep(-INTRO_Q, 0, x)
      else if (x > N) camT = N - 1 + clamp((x - N) / OUT_Q)
      else camT = state - 1 + (calm ? 0 : 0.05 * (clamp(x - (state - 1), 0, 1) - 0.5))
      const c = cam.update(camT, dt, snap)
      const s = c + 1
      catmull(camPos, s, pos)
      catmull(camTgt, s, tgt)
      catmull(spotAt, s, spot)
      fov = lay.fov
      if (!calm) {
        // a breath of handheld life (idle, tiny)
        pos.x += Math.sin(frame.time * 0.21) * 0.006
        pos.y += Math.sin(frame.time * 0.17 + 1.1) * 0.004
      }

      /* ---- the string rings as the camera arrives ---- */
      if (state !== prev && state >= 1 && !calm) rings[PLACES[state - 1].string].strike(frame.time, 1)
      for (let i = 0; i < 6; i++) g.strings.amp[i] = calm ? 0 : 0.011 * rings[i].value(frame.time)
      g.strings.wobble = 0
      g.strings.lightDir.set(-0.4, 1, -0.3)
      g.update(frame, ctx.camera, ctx.renderer)

      /* ---- light: one tight spot on the pick in focus, amber rims, low haze ---- */
      const w = ctx.world.params
      const introK = clamp(-c) // 1 at the intro pose
      w.spot = 0.48
      w.spotColor = '#ffe2bc'
      w.spotPos.copy(spot).addScaledVector(AX, -5).addScaledVector(NRM, 11).addScaledVector(BASS, -5)
      w.spotAt.copy(spot)
      w.spotAngle = lerp(0.042, 0.15, introK)
      w.spotPenumbra = 0.75
      w.rimA = 0.55
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.7, 0.55, -1)
      w.rimB = 0.35
      w.rimBColor = GEL.oxblood
      w.rimBDir.set(0.9, 0.35, -1)
      w.fill = 0.05
      w.env = 0.75
      w.envTurn = c * 0.22
      // backlit smoke sits on the horizon, behind the lamps (the camera looks down a little)
      const pitch = Math.atan2(tgt.y - pos.y, Math.hypot(tgt.x - pos.x, tgt.z - pos.z))
      const horizon = -Math.tan(pitch) / Math.tan(THREE.MathUtils.degToRad(fov / 2))
      w.haze = 0.55
      w.hazeY = horizon + 0.12
      w.hazeColor = '#9a4a22'
      w.beams = 0.12
      w.bokeh = 0.25
      bokeh.update(frame, calm)

      const post = ctx.post.params
      post.bloomStrength = 0.1
      post.bloomThreshold = 1
      post.vignette = 0.62
      post.warmth = 1

      /* ---- copy ---- */
      show(state, local)
      settled = !clock.busy && cam.settled(camT)
    },

    camera(_local: number, frame: Frame, out: CameraPose) {
      out.position.copy(pos)
      out.target.copy(tgt)
      out.fov = fov
      out.roll = 0
      out.parallax = frame.reducedMotion || frame.still ? 0 : 0.02
    },
  }
}
