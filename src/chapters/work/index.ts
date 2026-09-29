import * as THREE from 'three'
import type { CameraPose, Chapter, Frame } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECTIONS, WORK, workImage } from '../../content'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { fontsReady } from '../../kit/materials'
import { loadScreenshot, whenRevealed } from '../../kit/images'
import { StoryClock } from '../../kit/pace'
import { GEL } from '../../world/World'
import { buildBoard, PEDALS, pedalX, SCREEN_H, SCREEN_W, SCREEN_Y, SCREEN_Z, SHEET, type BoardSet } from './board'
import { StageScreen, standbyTexture } from './screen'
import './work.css'

/*
 * WORK · THE PEDALBOARD. A pedalboard on the stage planks: six stompboxes,
 * one per featured project, each labelled with the client's name on a strip
 * of white gaffer tape, chained by patch cables (the guitar's cable in at
 * the left, the amp cable out at the right), a power brick, gaffer, spike
 * marks. Upstage, a ground-stacked LED wall between two 4x12s.
 *
 *  - intro: looking down at the board, the headline on the left
 *  - the camera cranes down to the floor and glides along the board, pedal
 *    to pedal (a low shot from the deck: the pedal and its tape label in the
 *    foreground, the LED wall above it). As it arrives the footswitch
 *    stomps (a small thump), the LED lights, and the project's screenshot
 *    comes up on the wall with the pedal's effect treating it for a moment
 *    before it settles crisp. Pedals you've passed stay on (the chain
 *    builds); scrolling back switches them off again.
 *  - "Nine more, all live.": the setlist gaffer-taped to the floor at the
 *    board's right end, the nine names in marker (+ the real-text list)
 *  - out: a crane up off the setlist, lit, for the cab cut
 *
 * PACING (WCAG 2.3.1): the camera, the active pedal, the wall and the card
 * follow a StoryClock on a warped copy of `local` (a walk = 1 unit, a hold
 * HOLD_W) at ≤ RATE units/s: a walk takes ≥ 0.55 s of time and a new
 * project lands at most ~1.15 times a second. The wall never goes dark
 * between projects (a cross-fade). Stomps, thumps and wall effects are paced
 * by TIME (dt), rate-limited, and off under reduced motion / Motion off.
 */
const FEATURED = WORK.filter(w => w.featured)
const REST = WORK.filter(w => !w.featured)
const N = FEATURED.length
const isPreview = (url: string) => /harktest\.com/i.test(url)
const pad2 = (n: number) => String(n).padStart(2, '0')

// ---- the story schedule, in viewport heights (LEN = this chapter's length)
const LEN = 6.0
const V = (vh: number) => vh / LEN
/** the headline rises as the cut clears (the cut covers 0.18 vh) */
const RISE = V(0.19)
/** …holds settled to here */
const INTRO_OUT = V(0.8)
/** pedal 1 settled */
const A = V(1.06)
/** half a walk between two pedals */
const T = V(0.1)
/** the walk from the last pedal to the setlist is centred here */
const E = V(5.12)
const SPAN = (E - A) / N
const TRAVEL: [number, number][] = [[INTRO_OUT, A]]
for (let i = 1; i < N; i++) TRAVEL.push([A + SPAN * i - T, A + SPAN * i + T])
TRAVEL.push([E - T, E + T])
const SET = N + 1
/** the crane up off the setlist starts here */
const OUTRO = V(5.74)
const holdMid = (i: number) => ((i === 0 ? A : TRAVEL[i][1]) + TRAVEL[i + 1][0]) / 2
const SET_MID = (TRAVEL[N][1] + OUTRO) / 2

// the clock's warp: a walk weighs 1 (the crane down a little more), a hold HOLD_W
const HOLD_W = 0.55
const RATE = 1.8
const WB: number[] = [0]
const WW: number[] = []
TRAVEL.forEach(([s, e], k) => {
  WB.push(s, e)
  WW.push(k === 0 ? 0.45 : HOLD_W, k === 0 ? 1.25 : 1)
})
WB.push(OUTRO, 1)
WW.push(0.6, 0.8)
const WU = WW.reduce((acc, w) => (acc.push(acc[acc.length - 1] + w), acc), [0])
function warp(local: number) {
  const l = clamp(local)
  let i = 0
  while (i < WW.length - 1 && l >= WB[i + 1]) i++
  return WU[i] + (WW[i] * (l - WB[i])) / Math.max(1e-6, WB[i + 1] - WB[i])
}
function unwarp(u: number) {
  const v = clamp(u, 0, WU[WU.length - 1])
  let i = 0
  while (i < WW.length - 1 && v >= WU[i + 1]) i++
  return WB[i] + ((WB[i + 1] - WB[i]) * (v - WU[i])) / WW[i]
}

/** where the story is: station k (0 intro, 1..N pedals, N+1 setlist), travel t toward k+1, hold h */
function where(local: number) {
  for (let k = 0; k < TRAVEL.length; k++) {
    const [s, e] = TRAVEL[k]
    if (local < s) {
      const hs = k === 0 ? 0 : TRAVEL[k - 1][1]
      return { k, t: 0, h: clamp((local - hs) / (s - hs)) }
    }
    if (local < e) return { k, t: (local - s) / (e - s), h: 1 }
  }
  const hs = TRAVEL[TRAVEL.length - 1][1]
  return { k: SET, t: 0, h: clamp((local - hs) / (OUTRO - hs)) }
}
/** the station that has "arrived" (the stomp lands late in the walk in) */
function arrived(local: number) {
  const w = where(local)
  return w.t >= 0.62 ? w.k + 1 : w.k
}
/** 0..1 visibility of station k's copy: up once the camera reads as arrived, gone early in the walk away */
function holdVis(local: number, k: number) {
  const inT = TRAVEL[k - 1]
  const outT = TRAVEL[k] as [number, number] | undefined
  const tin = clamp((local - inT[0]) / (inT[1] - inT[0]))
  const tout = outT ? clamp((local - outT[0]) / (outT[1] - outT[0])) : clamp((local - OUTRO) / V(0.12))
  return smoothstep(0.62, 0.8, tin) * (1 - smoothstep(0.16, 0.4, tout))
}

// ---- camera poses: a position, a heading (yaw 0 looks toward -z) and pitch
type Pose = { p: THREE.Vector3; yaw: number; pitch: number; fov: number }
const pose = (): Pose => ({ p: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 36 })
const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
const _d = new THREE.Vector3()
function basis(yaw: number, pitch: number) {
  _f.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  _r.set(Math.cos(yaw), 0, Math.sin(yaw))
  _u.crossVectors(_r, _f)
}
/** NDC of world point q seen from (p, yaw, pitch) */
function project(p: THREE.Vector3, yaw: number, pitch: number, fov: number, aspect: number, q: THREE.Vector3): [number, number] {
  basis(yaw, pitch)
  _d.subVectors(q, p)
  const z = Math.max(1e-4, _d.dot(_f))
  const t = Math.tan((fov * Math.PI) / 360)
  return [_d.dot(_r) / (z * t * aspect), _d.dot(_u) / (z * t)]
}
/** the heading from p that puts world point s at NDC (nx, ny) */
function aim(p: THREE.Vector3, s: THREE.Vector3, nx: number, ny: number, fov: number, aspect: number) {
  _d.subVectors(s, p)
  let yaw = Math.atan2(_d.x, -_d.z)
  let pitch = Math.atan2(_d.y, Math.hypot(_d.x, _d.z))
  for (let it = 0; it < 8; it++) {
    const [x0, y0] = project(p, yaw, pitch, fov, aspect, s)
    const e = 1e-4
    const [x1, y1] = project(p, yaw + e, pitch, fov, aspect, s)
    const [x2, y2] = project(p, yaw, pitch + e, fov, aspect, s)
    const a = (x1 - x0) / e
    const b = (x2 - x0) / e
    const c = (y1 - y0) / e
    const d = (y2 - y0) / e
    const det = a * d - b * c
    if (Math.abs(det) < 1e-9) break
    const ex = nx - x0
    const ey = ny - y0
    yaw += (d * ex - b * ey) / det
    pitch += (-c * ex + a * ey) / det
  }
  return { yaw, pitch }
}

/**
 * Place a camera at depth z = cz so that world point `f` lands at NDC `ft`
 * while the heading keeps world point `lock` at NDC `lt` (solves the
 * camera's x, y; the heading follows from `aim`).
 */
function solve2(out: Pose, f: THREE.Vector3, ft: [number, number], lock: THREE.Vector3, lt: [number, number], cz: number, fov: number, aspect: number, guess: [number, number], yMin: number) {
  let cx = guess[0]
  let cy = guess[1]
  const evalAt = (x: number, y: number) => {
    out.p.set(x, y, cz)
    const o = aim(out.p, lock, lt[0], lt[1], fov, aspect)
    return project(out.p, o.yaw, o.pitch, fov, aspect, f)
  }
  for (let it = 0; it < 12; it++) {
    const [x0, y0] = evalAt(cx, cy)
    const e = 1e-3
    const [x1, y1] = evalAt(cx + e, cy)
    const [x2, y2] = evalAt(cx, cy + e)
    const a = (x1 - x0) / e
    const b = (x2 - x0) / e
    const c = (y1 - y0) / e
    const d = (y2 - y0) / e
    const det = a * d - b * c
    if (Math.abs(det) < 1e-9) break
    const ex = ft[0] - x0
    const ey = ft[1] - y0
    cx += clamp((d * ex - b * ey) / det, -1.5, 1.5)
    cy += clamp((-c * ex + a * ey) / det, -1.5, 1.5)
    cy = clamp(cy, yMin, 20)
  }
  out.p.set(cx, cy, cz)
  const o = aim(out.p, lock, lt[0], lt[1], fov, aspect)
  out.yaw = o.yaw
  out.pitch = o.pitch
  out.fov = fov
}

const _q = new THREE.Vector3()

export default function create(): Chapter {
  const group = new THREE.Group()
  let set: BoardSet | null = null
  let screen: StageScreen | null = null
  let standby: THREE.Texture | null = null
  const shots: (THREE.Texture | null)[] = new Array(N).fill(null)
  /** where each pedal's tape label is (world), the camera's point of interest */
  const focus: THREE.Vector3[] = []
  const screenC = new THREE.Vector3(0, SCREEN_Y, SCREEN_Z)
  const sheetC = new THREE.Vector3(SHEET.x, 0.02, SHEET.z)

  // DOM
  let intro: HTMLElement, introTitle: HTMLElement
  let card: HTMLElement, chip: HTMLElement, chipName: HTMLElement, meta: HTMLElement, name: HTMLElement, blurb: HTMLElement, tags: HTMLElement, visit: HTMLAnchorElement
  let rest: HTMLElement, restTitle: HTMLElement
  let cardW = 400
  let cardH = 360
  let restW = 420
  let restH = 300

  // story state
  const clock = new StoryClock({ rate: RATE, snap: 1.5 })
  let q = NaN
  let snap = true
  let shown = -1
  /** the arrived station last frame (-1 = unknown: snap) */
  let station = -1
  /** time (dt-accumulated: runs with Motion off) */
  let now = 0
  const pressAt = new Array<number>(N).fill(-10)
  const led = new Array<number>(N).fill(0)
  let thumpAt = -10
  let busyFx = false

  const poses = {
    key: '',
    intro: pose(),
    introB: pose(),
    items: Array.from({ length: N }, pose),
    set: pose(),
    outro: pose(),
  }

  function buildPoses(frame: Frame) {
    const W = frame.width || 1440
    const H = frame.height || 900
    const key = `${W}x${H}:${cardW},${cardH},${restW},${restH}`
    if (key === poses.key || !set) return
    poses.key = key
    const aspect = W / H
    const portrait = H > W * 1.05
    const short = !portrait && H <= 500
    const gutter = clamp(W * 0.034, 16, 48)
    const safeTop = short ? 52 : clamp(H * 0.105, 80, 112)
    const safeBot = short ? 52 : portrait && W <= 560 ? 96 : clamp(H * 0.105, 82, 110)
    const nx = (px: number) => (px / W) * 2 - 1
    const ny = (py: number) => 1 - (py / H) * 2
    // the free region beside / above the copy, in px [x0, y0, x1, y1] (y down)
    const region = (cw: number, ch: number) =>
      portrait
        ? [gutter, safeTop + 6, W - gutter, H - safeBot - ch - 14]
        : [gutter + cw + (short ? 24 : 56), safeTop + (short ? 2 : 10), W - gutter - (short ? 8 : 40), H - safeBot - (short ? 2 : 14)]

    // ---- items: the wall fills the top of the region, the pedal sits under it
    const R = region(cardW, cardH)
    const rw = R[2] - R[0]
    const rh = R[3] - R[1]
    // wall size on screen (px): as wide as the region allows, 16:10, at most ~58% of its height
    let sw = rw * (portrait ? 1 : 0.9)
    let sh = sw / 1.6
    const maxSh = rh * (portrait ? 0.56 : 0.6)
    if (sh > maxSh) {
      sh = maxSh
      sw = sh * 1.6
    }
    const scx = (R[0] + R[2]) / 2
    const scy = R[1] + sh / 2 + (portrait ? 8 : 4)
    // the pedal (its label) sits in the band under the wall
    const pcx = portrait ? W / 2 : scx + sw * 0.12
    const pcy = Math.min(R[3] - rh * (portrait ? 0.14 : 0.13), scy + sh / 2 + (R[3] - (scy + sh / 2)) * 0.62)
    // fov so the wall reads sw px wide; refined against the solved poses
    // (the camera's real distance and angle) in a few passes
    const pedalPx = clamp(portrait ? Math.min(W * 0.34, rh * 0.5) : W * 0.125, 96, 220)
    let tf = SCREEN_W / 2 / ((4.6 - SCREEN_Z) * aspect * (sw / W))
    for (let pass = 0; pass < 4; pass++) {
      const fov = clamp((Math.atan(tf) * 360) / Math.PI, 22, 80)
      const t = Math.tan((fov * Math.PI) / 360)
      const dPed = 0.74 / ((pedalPx / W) * 2 * t * aspect)
      for (let i = 0; i < N; i++) {
        const fc = focus[i]
        solve2(poses.items[i], fc, [nx(pcx), ny(pcy)], screenC, [nx(scx), ny(scy)], fc.z + dPed * 0.94, fov, aspect, [fc.x + 0.25, fc.y + dPed * 0.3], 0.55)
      }
      const P = poses.items[2]
      const [xl] = project(P.p, P.yaw, P.pitch, fov, aspect, _q.set(-SCREEN_W / 2, SCREEN_Y, SCREEN_Z))
      const [xr] = project(P.p, P.yaw, P.pitch, fov, aspect, _q.set(SCREEN_W / 2, SCREEN_Y, SCREEN_Z))
      const actual = ((xr - xl) / 2) * W
      if (!(actual > 1)) break
      tf = t * (actual / sw)
    }

    // ---- intro: the board across the lower half from the front right, the
    // backline and the wall (on standby, the mark on it) rising behind it
    {
      const bc = new THREE.Vector3(0.1, 0.35, -0.1)
      // board centre and wall centre on screen (px), and how wide the board reads
      const bx = portrait ? W * 0.5 : Math.max(W * 0.44, gutter + Math.min(560, W * 0.4) * 0.72)
      const by = portrait ? H - safeBot - H * 0.12 : H - safeBot - (H - safeBot - safeTop) * 0.15
      const wx = portrait ? W * 0.5 : W * 0.7
      const wy = portrait ? safeTop + H * 0.33 : safeTop + (H - safeTop - safeBot) * 0.24
      const boardFrac = portrait ? 1.12 : 0.56
      const cz = portrait ? 9.5 : 11.5
      const t0 = 6.9 / (boardFrac * 2 * cz * aspect)
      const f0 = clamp((Math.atan(t0) * 360) / Math.PI, 26, 76)
      solve2(poses.intro, bc, [nx(bx), ny(by)], screenC, [nx(wx), ny(wy)], cz, f0, aspect, [4, 2.4], 0.8)
      solve2(poses.introB, bc, [nx(bx), ny(by)], screenC, [nx(wx), ny(wy)], cz - 0.7, f0, aspect, [poses.intro.p.x - 0.2, poses.intro.p.y], 0.8)
    }

    // ---- the setlist: looking down at the sheet, the board's end at the left
    {
      const Rs = region(restW, restH)
      const f0 = portrait ? 46 : 34
      const t0 = Math.tan((f0 * Math.PI) / 360)
      const frH = (Rs[3] - Rs[1]) / H
      const frW = (Rs[2] - Rs[0]) / W
      const dist = clamp(Math.max(3.4 / (frH * 2 * t0), 2.6 / (frW * 2 * t0 * aspect)), 4, 24)
      const el = 1.02
      const az = -0.18
      const P = poses.set
      P.p.set(sheetC.x + Math.sin(az) * Math.cos(el) * dist, sheetC.y + Math.sin(el) * dist, sheetC.z + Math.cos(az) * Math.cos(el) * dist)
      const o = aim(P.p, sheetC, nx((Rs[0] + Rs[2]) / 2), ny((Rs[1] + Rs[3]) / 2), f0, aspect)
      P.yaw = o.yaw
      P.pitch = o.pitch
      P.fov = f0
      // out: crane up and back over the whole set (still lit for the cut)
      const O = poses.outro
      O.p.copy(P.p).add(new THREE.Vector3(-2.6, 3.4, 4.2))
      const c = new THREE.Vector3(2.2, 0.3, -0.4)
      const oo = aim(O.p, c, portrait ? 0 : 0.2, portrait ? 0 : -0.05, f0 + 4, aspect)
      O.yaw = oo.yaw
      O.pitch = oo.pitch
      O.fov = f0 + 4
    }
  }

  const tmpA = pose()
  const tmpB = pose()
  function lerpPose(out: Pose, a: Pose, b: Pose, t: number, tr = t) {
    out.p.lerpVectors(a.p, b.p, t)
    let dy = b.yaw - a.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    out.yaw = a.yaw + dy * tr
    out.pitch = lerp(a.pitch, b.pitch, tr)
    out.fov = lerp(a.fov, b.fov, t)
  }
  /** the pose held at station k, hold progress h (a slow glide + a touch of push) */
  function holdPose(out: Pose, k: number, h: number) {
    if (k === 0) return lerpPose(out, poses.intro, poses.introB, h)
    const P = k === SET ? poses.set : poses.items[k - 1]
    out.p.copy(P.p)
    out.yaw = P.yaw
    out.pitch = P.pitch
    out.fov = P.fov
    const s = h - 0.5
    if (k === SET) {
      out.p.y -= 0.35 * h
      out.p.x += s * 0.2
    } else {
      out.p.x += s * 0.16
      out.yaw -= s * 0.004
    }
  }

  return {
    id: 'work',
    group,
    // featured first (mid-hold), then the nine others, all on the setlist frame
    anchors: [...FEATURED.map((_, i) => holdMid(i)), ...REST.map(() => SET_MID)],
    busy: () => clock.busy || busyFx,
    async init(ctx) {
      await fontsReady()
      set = await buildBoard({
        mobile: ctx.mobile,
        restNames: REST.map(w => w.name),
        clients: FEATURED.map(w => w.name),
        envMap: ctx.world.envMap,
        yieldFn: nextFrame,
      })
      group.add(set.root)
      for (let i = 0; i < N; i++) focus.push(set.pedals[i].group.localToWorld(new THREE.Vector3(0, 0.24, 0.52)))
      standby = standbyTexture()
      screen = new StageScreen(SCREEN_W, SCREEN_H, standby)
      screen.mesh.position.set(0, SCREEN_Y, SCREEN_Z + 0.02)
      screen.halo.position.set(0, SCREEN_Y, SCREEN_Z - 0.7)
      screen.light.position.set(0, SCREEN_Y - 1.5, SCREEN_Z + 7)
      group.add(screen.mesh, screen.halo, screen.light)
      await nextFrame()

      // ---- copy
      intro = el('div', 'pb-intro', undefined, ctx.stage)
      el('p', 'hud-eyebrow', SECTIONS.work.eyebrow, intro)
      introTitle = rise(el('h2', 'hud-h2 pb-title', undefined, intro), 'Built to be <em>heard.</em>')

      card = el('div', 'pb-card hud-panel', undefined, ctx.stage)
      chip = el('p', 'pb-chip', undefined, card)
      el('i', 'pb-chip-led', undefined, chip)
      chipName = el('span', '', '', chip)
      meta = el('p', 'hud-label pb-meta', '', card)
      name = el('h3', 'pb-name', '', card)
      blurb = el('p', 'hud-body pb-blurb', '', card)
      tags = el('ul', 'hud-tags pb-tags', undefined, card)
      visit = el('a', 'hud-btn hud-btn--ghost pb-visit', '', card)
      visit.target = '_blank'
      visit.rel = 'noopener'

      rest = el('div', 'pb-card pb-rest hud-panel', undefined, ctx.stage)
      restTitle = el('h3', 'pb-rest-title', undefined, rest)
      restTitle.innerHTML = 'Nine more, all <em>live.</em>'
      const list = el('ol', 'pb-list', undefined, rest)
      REST.forEach((w, j) => {
        const li = el('li', '', undefined, list)
        el('span', 'pb-num', pad2(N + j + 1), li).setAttribute('aria-hidden', 'true')
        const a = el('a', '', w.name, li)
        el('span', 'pb-arrow', ' ↗', a).setAttribute('aria-hidden', 'true')
        a.href = w.url
        a.target = '_blank'
        a.rel = 'noopener'
      })
      const hello = el('button', 'hud-btn pb-hello', 'Say hello', rest)
      hello.type = 'button'
      hello.addEventListener('click', () => window.__hark?.land('contact'))
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
          cardW = card.offsetWidth || cardW
          cardH = card.offsetHeight || cardH
        }).observe(card)
        new ResizeObserver(() => {
          restW = rest.offsetWidth || restW
          restH = rest.offsetHeight || restH
        }).observe(rest)
      }

      // ---- screenshots: the first right away, the rest after the reveal (never blocking init)
      const shotW = 1024
      const load = (i: number) =>
        loadScreenshot(workImage(FEATURED[i].id), { width: shotW })
          .then(t => {
            screen?.measure(t)
            shots[i] = t
          })
          .catch(() => {})
      load(0)
      whenRevealed().then(async () => {
        for (let i = 1; i < N; i++) await load(i)
      })
      // canvas type drawn with the real faces (fontsReady already waited; redraw on ready anyway)
      document.fonts?.ready.then(() => set?.redraw())
    },
    onEnter() {
      clock.reset()
      snap = true
    },
    update(local, frame, ctx) {
      if (!set || !screen) return
      const dt = frame.dt
      now += dt
      const calm = frame.reducedMotion || !!frame.still
      const uT = warp(local)
      const uC = clock.update(uT, dt)
      q = unwarp(uC)
      const w = where(q)
      const track = w.k + ease.inOutCubic(w.t)
      const st = arrived(q)
      const wasSnap = snap || station < 0
      snap = false

      // ---- stomps: a pedal switches as the camera arrives at it (forward on, back off)
      if (!wasSnap && st !== station) {
        const lo = Math.min(st, station)
        const hi = Math.max(st, station)
        for (let s = lo; s < hi; s++) {
          if (s >= N) continue
          pressAt[s] = now
        }
        if (now - thumpAt > 0.6 && hi - lo === 1 && lo < N) {
          thumpAt = now
        }
      }
      station = st
      const onUpTo = Math.min(st, N) // pedals [0, onUpTo) are on
      busyFx = false
      for (let j = 0; j < N; j++) {
        const tgt = j < onUpTo ? 1 : 0
        if (wasSnap) led[j] = tgt
        else led[j] += (tgt - led[j]) * (1 - Math.exp(-dt / 0.07))
        if (Math.abs(tgt - led[j]) > 0.003) busyFx = true
        // the pedal you're on burns a little hotter than the ones already on (steady: no blink)
        const onMe = j === st - 1 ? 1 : 0
        set.pedals[j].setOn(led[j] * (0.24 + 0.36 * onMe))
        const pt = now - pressAt[j]
        const press = pt < 0 || pt > 0.26 ? 0 : pt < 0.05 ? pt / 0.05 : 1 - (pt - 0.05) / 0.21
        if (press > 0) busyFx = true
        set.pedals[j].setStomp(Math.max(0, press))
      }
      // the thump: a speaker-cone push on the downbeat (the engine zeroes it when calm)
      const tt = now - thumpAt
      if (tt >= 0 && tt < 0.2 && !calm) ctx.post.params.glitch = 0.32 * (1 - tt / 0.2) * (1 - tt / 0.2)

      // ---- the wall: standby before the first stomp, then the project on the pedal you're on
      const item = st <= 0 ? -1 : Math.min(st, N) - 1
      const want = item < 0 ? standby! : (shots[item] ?? standby!)
      if (!screen.showing(want)) screen.show(want, item < 0 || want === standby ? -1 : item, { instant: wasSnap, calm })
      screen.update(dt, frame.time, ctx.post.params.exposure, calm)
      if (screen.busy) busyFx = true

      // ---- light: the follow spot tracks the pedal you're on; the wall lights the haze
      const p = ctx.world.params
      const setK = clamp(track - N) // 0 on the board → 1 at the setlist
      const introK = 1 - clamp(track)
      // the spot follows the camera along the board (between two pedals mid-glide)
      const tb = clamp(track - 1, 0, N - 1)
      const i0 = Math.floor(tb)
      const pedalTop = _v.lerpVectors(set.tops[i0], set.tops[Math.min(N - 1, i0 + 1)], tb - i0)
      if (introK > 0.5) {
        p.spotAt.set(0.2, 0.3, 0)
        p.spotPos.set(3, 17, 11)
        p.spotAngle = 0.26
      } else if (setK > 0.5) {
        p.spotAt.set(sheetC.x - 0.4, 0, sheetC.z - 0.1)
        p.spotPos.set(sheetC.x + 1.5, 17, sheetC.z + 9)
        p.spotAngle = q > OUTRO ? 0.2 : 0.13
      } else {
        p.spotAt.copy(pedalTop)
        p.spotPos.set(pedalTop.x + 1.4, 16, pedalTop.z + 8.5)
        p.spotAngle = 0.085
      }
      p.spot = 0.95
      p.spotPenumbra = 0.6
      const g = screen.glow
      const onBoard = (1 - introK) * (1 - setK)
      p.haze = 0.55 + 0.35 * onBoard
      p.hazeColor = _c.copy(g).lerp(_c2.set('#b0582a'), 0.78).getHex()
      p.hazeY = lerp(-0.1, 0.35, onBoard)
      p.beams = 0.5 + 0.2 * onBoard
      p.beamA = GEL.amber
      p.beamB = GEL.straw
      p.bokeh = 0.3 + 0.15 * onBoard
      // rims from behind and low: they edge the pedals without washing the planks
      p.rimA = 0.75
      p.rimAColor = GEL.amber
      p.rimADir.set(-0.8, 0.22, -1)
      p.rimB = 0.55
      p.rimBColor = GEL.oxblood
      p.rimBDir.set(0.9, 0.18, -1)
      p.fill = 0.1
      p.env = 0.5
      p.envTurn = 0.3 + track * 0.06
      screen.setLevel(0.84)
      screen.setSpill(0.16 * (0.4 + 0.6 * onBoard), 22 * (0.3 + 0.7 * onBoard))
      const post = ctx.post.params
      post.bloomThreshold = 1.75
      post.bloomStrength = 0.45
      post.bloomRadius = 0.35
      post.vignette = 0.36
      post.warmth = 0.85

      // ---- copy
      reveal(intro, 1 - smoothstep(INTRO_OUT + V(0.01), INTRO_OUT + V(0.08), q), 0)
      setRise(introTitle, q > RISE && q < INTRO_OUT + V(0.08))
      const idx = clamp(Math.round(clamp(track - 1, 0, N - 1)), 0, N - 1)
      const cv = holdVis(q, idx + 1)
      reveal(card, cv, 0)
      if (idx !== shown) {
        shown = idx
        const it = FEATURED[shown]
        const pd = PEDALS[shown]
        chipName.textContent = pd.fx
        card.style.setProperty('--pb-enamel', pd.color)
        card.style.setProperty('--pb-ink', pd.ink)
        meta.textContent = `${pad2(shown + 1)} / ${pad2(N)} · ${it.industry}`
        name.textContent = it.name
        blurb.textContent = it.blurb
        tags.replaceChildren(...it.tags.map(t => Object.assign(document.createElement('li'), { className: 'hud-tag', textContent: t })))
        visit.href = it.url
        visit.textContent = isPreview(it.url) ? 'Preview site ↗' : 'Visit site ↗'
      }
      card.classList.toggle('is-on', cv > 0.5)
      const rv = holdVis(q, SET) * (q > OUTRO ? 1 - smoothstep(OUTRO, OUTRO + V(0.12), q) : 1)
      reveal(rest, rv, 0)
    },
    camera(local, frame, out: CameraPose) {
      buildPoses(frame)
      const at = Number.isFinite(q) ? q : local
      const w = where(at)
      const P = tmpA
      if (w.t > 0) {
        holdPose(tmpA, w.k, 1)
        holdPose(tmpB, w.k + 1, 0)
        const e = ease.inOutCubic(w.t)
        if (w.k === 0) {
          // the crane down: drop and swing round onto the first pedal, the eye leading
          lerpPose(P, tmpA, tmpB, e, ease.inOutCubic(clamp(w.t * 1.08)))
          P.p.z += Math.sin(Math.PI * w.t) * 1.2
        } else if (w.k === N) {
          // up off the last pedal and down onto the setlist
          lerpPose(P, tmpA, tmpB, e, ease.inOutCubic(clamp(w.t * 1.1 - 0.05)))
          P.p.y += Math.sin(Math.PI * w.t) * 0.8
        } else {
          // along the board, pedal to pedal: a little lift mid-glide
          lerpPose(P, tmpA, tmpB, e)
          P.p.y += Math.sin(Math.PI * w.t) * 0.14
          P.p.z += Math.sin(Math.PI * w.t) * 0.25
        }
      } else holdPose(P, w.k, w.h)
      if (at > OUTRO) {
        const o = ease.inOutCubic(clamp((at - OUTRO) / (1 - OUTRO)))
        lerpPose(P, P, poses.outro, o)
      }
      basis(P.yaw, P.pitch)
      out.position.copy(P.p)
      out.target.copy(P.p).addScaledVector(_f, 10)
      out.fov = P.fov
      out.parallax = 0.12
    },
  }
}

const _c = new THREE.Color()
const _v = new THREE.Vector3()
const _c2 = new THREE.Color()
