import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, reveal, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { SECURITY, STATS } from '../../content'
import { fontsReady } from '../../kit/materials'
import { StoryClock } from '../../kit/pace'
import { Ring } from '../../kit/strings'
import { GEL } from '../../world/World'
import { buildSet, type ShieldSet } from './set'
import './shield.css'

/*
 * SHIELD · FEEDBACK — "Hacked? Breathe." told as a guitar left leaning on a
 * live stack.
 *
 *   0.06–0.35  FEEDBACK  the guitar starts to squeal against the cab: the
 *                        strings swell into wild envelopes and rolling-shutter
 *                        waves, the clip-LED red rises steadily into every gel
 *                        (never blinking), the power tubes flare, and the
 *                        frame thumps like a speaker cone (time-paced, ≤ 2/s,
 *                        none when calm). Eyebrow + headline arrive ~0.27.
 *   0.34–0.50  THE MUTE  a strip of black felt drops across the strings
 *                        between the pickups; the envelopes collapse, the
 *                        gate closes, the red cools to tungsten and amber.
 *                        Landing / intro / anchor 0.45: headline + body + CTA.
 *   0.53–0.76  the camera cranes up the neck, past the pearl mark on the
 *              headstock, to the head's panel …
 *   0.76–0.94  CALM      … where the red jewel pilot lamp glows steadily over
 *                        its engraved legend (STANDBY · POWER · 24/7), and the
 *                        24/7 stat hangs off it like an amp's legend plate.
 *
 * Scene + camera follow a StoryClock (a fling can't swing the red flood or
 * the crane faster than the clock); the DOM follows `local`.
 */

const STAT = STATS.find(s => s.value === '24/7') ?? STATS[3]

const T = {
  heat0: 0.06,
  heat1: 0.27,
  drop0: 0.335,
  drop1: 0.4,
  settle: 0.43,
  still0: 0.395,
  still1: 0.445,
  cool0: 0.365,
  cool1: 0.455,
  crane0: 0.53,
  crane1: 0.77,
  // DOM
  headIn: 0.255,
  bodyIn: 0.31,
  legendIn: 0.66,
  out: 0.945,
}

// ------------------------------------------------------------------ camera

interface Shot {
  /** subject point (world) placed at the anchor (ax, ay) of the free region */
  at: THREE.Vector3
  ax: number
  ay: number
  /** the world rect that must fit the free region */
  sw: number
  sh: number
  yaw: number
  pitch: number
}

interface Layout {
  w: number
  h: number
  top: number
  bottom: number
  gutter: number
  /** copy column rect (px) */
  cx0: number
  cy0: number
  cx1: number
  cy1: number
  /** legend plate size (px) */
  lw: number
  lh: number
  ok: boolean
}

const tall = (w: number, h: number) => h > w * 1.05
/** portrait and short screens hang the 24/7 plate in a band of its own under the head */
const bandLegend = (w: number, h: number) => tall(w, h) || h < 560

const _shot: Shot = { at: new THREE.Vector3(), ax: 0.5, ay: 0.5, sw: 1, sh: 1, yaw: 0, pitch: 0 }
const _a: Shot = { at: new THREE.Vector3(), ax: 0.5, ay: 0.5, sw: 1, sh: 1, yaw: 0, pitch: 0 }
const _b: Shot = { at: new THREE.Vector3(), ax: 0.5, ay: 0.5, sw: 1, sh: 1, yaw: 0, pitch: 0 }
const _dir = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _Y = new THREE.Vector3(0, 1, 0)

function lerpShot(out: Shot, a: Shot, b: Shot, t: number) {
  out.at.lerpVectors(a.at, b.at, t)
  out.ax = lerp(a.ax, b.ax, t)
  out.ay = lerp(a.ay, b.ay, t)
  out.sw = lerp(a.sw, b.sw, t)
  out.sh = lerp(a.sh, b.sh, t)
  out.yaw = lerp(a.yaw, b.yaw, t)
  out.pitch = lerp(a.pitch, b.pitch, t)
  return out
}

function setShot(out: Shot, at: THREE.Vector3, sw: number, sh: number, yaw: number, pitch: number, ax = 0.5, ay = 0.5) {
  out.at.copy(at)
  out.sw = sw
  out.sh = sh
  out.yaw = yaw
  out.pitch = pitch
  out.ax = ax
  out.ay = ay
  return out
}

/** the free region (px) the subject may use: right of / above the copy, above the legend plate */
function freeRegion(L: Layout, withCopy: number, withLegend: number) {
  const { w, h } = L
  let x0 = L.gutter
  let x1 = w - L.gutter
  const y0 = L.top + (tall(w, h) ? 0 : Math.min(14, h * 0.02))
  let y1 = h - L.bottom
  if (tall(w, h)) {
    const cy = L.ok ? L.cy0 - 14 : h * 0.52
    y1 = lerp(y1, cy, withCopy)
  } else {
    const cx = L.ok ? L.cx1 + 28 : w * 0.44
    x0 = lerp(x0, cx, withCopy)
    if (x1 - x0 < w * 0.3) x0 = x1 - w * 0.3
  }
  y1 -= withLegend * (L.lh + 30)
  if (y1 - y0 < h * 0.14) y1 = y0 + h * 0.14
  return { x0, x1, y0, y1 }
}

// ------------------------------------------------------------------ colours

const C = {
  tungsten: new THREE.Color(GEL.tungsten),
  amber: new THREE.Color(GEL.amber),
  straw: new THREE.Color(GEL.straw),
  red: new THREE.Color(GEL.red),
  clip: new THREE.Color('#ff5a44'),
  oxblood: new THREE.Color(GEL.oxblood),
  hazeCalm: new THREE.Color('#a8561f'),
  hazeHot: new THREE.Color('#c8180c'),
  stringCalm: new THREE.Color('#ffd8a8'),
  stringHot: new THREE.Color('#ff7a5c'),
  ruby: new THREE.Color('#ff1e0a'),
  tube: new THREE.Color('#ff7a26'),
}
const mix = (out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number) => out.copy(a).lerp(b, clamp(t))

// ------------------------------------------------------------------ chapter

export default function create(): Chapter {
  const group = new THREE.Group()
  const clock = new StoryClock({ rate: 0.62 })
  const ring = new Ring(0.9, 0.5)
  // the red flood follows its scroll target at ≤ 1.2 / s (≥ 0.8 s end to end): a fling can't flip it
  const heatClock = new StoryClock({ rate: 1.2, snap: 0.4 })
  let set: ShieldSet | null = null

  // time-paced thumps (never by scroll): the next one may fire at `thumpNext`
  let thumpAt = -1e9
  let thumpNext = 0
  let thumpN = 0
  let thumpAmp = 0
  let lastQ = NaN

  // colours we hand the world (it copies them each frame)
  const cSpot = new THREE.Color()
  const cRimA = new THREE.Color()
  const cRimB = new THREE.Color()
  const cHaze = new THREE.Color()
  const cBeamA = new THREE.Color()
  const cBeamB = new THREE.Color()
  const cBokA = new THREE.Color()
  const cBokB = new THREE.Color()
  const spotAt = new THREE.Vector3()

  // DOM
  let frameEl: HTMLElement
  let col: HTMLElement
  let head: HTMLElement
  let title: HTMLElement
  let panel: HTMLElement
  let legend: HTMLElement
  let plate: HTMLElement
  let leader: SVGPathElement
  let leaderDot: HTMLElement
  const layout: Layout = { w: 1, h: 1, top: 90, bottom: 90, gutter: 32, cx0: 0, cy0: 0, cx1: 0, cy1: 0, lw: 280, lh: 110, ok: false }
  const proj = new THREE.Vector3()
  const legendCache = { d: '', dot: '', plate: '' }

  // the crane's path: the felt → up the neck → past the pearl mark → the whole head
  let crane: THREE.CatmullRomCurve3 | null = null

  function measure(stage: HTMLElement) {
    const sr = stage.getBoundingClientRect()
    const cs = getComputedStyle(frameEl)
    layout.w = sr.width || window.innerWidth
    layout.h = sr.height || window.innerHeight
    layout.top = parseFloat(cs.paddingTop) || 90
    layout.bottom = parseFloat(cs.paddingBottom) || 90
    layout.gutter = parseFloat(cs.paddingLeft) || 32
    const r = col.getBoundingClientRect()
    layout.cx0 = r.left - sr.left
    layout.cy0 = r.top - sr.top
    layout.cx1 = r.right - sr.left
    layout.cy1 = r.bottom - sr.top
    layout.lw = plate.offsetWidth || 280
    layout.lh = plate.offsetHeight || 110
    layout.ok = layout.w > 0 && layout.h > 0 && r.width > 0
  }

  /** the shot at clock value q for this screen */
  function shotAt(q: number, isTall: boolean, out: Shot): Shot {
    if (!set) return setShot(out, new THREE.Vector3(0, 5, 2), 12, 11, 0.4, 0.1)
    const A = set.at
    const body = A.body
    const close = _v4.copy(body).lerp(A.felt, 0.35)
    if (!isTall) {
      // the whole stack squealing (tubes, jewel, guitar), then a push onto the strings
      if (q < 0.17) {
        setShot(_a, A.stack, 13.4, 13.2, 0.52, 0.1)
        setShot(_b, A.stack, 12.4, 12.4, 0.48, 0.11)
        return lerpShot(out, _a, _b, segment(q, 0.0, 0.17))
      }
      if (q < 0.29) {
        setShot(_a, A.stack, 12.4, 12.4, 0.48, 0.11)
        setShot(_b, _v.copy(body).lerp(A.neck, 0.45), 5.6, 6.8, 0.42, 0.12)
        return lerpShot(out, _a, _b, ease.inOutQuad(segment(q, 0.17, 0.29)))
      }
      if (q < 0.4) {
        setShot(_a, _v.copy(body).lerp(A.neck, 0.45), 5.6, 6.8, 0.42, 0.12)
        setShot(_b, close, 3.3, 3.1, 0.36, 0.14)
        return lerpShot(out, _a, _b, ease.inOutCubic(segment(q, 0.29, 0.4)))
      }
      if (q < T.crane0) {
        setShot(_a, close, 3.3, 3.1, 0.36, 0.14)
        setShot(_b, close, 3.0, 2.9, 0.32, 0.14)
        return lerpShot(out, _a, _b, segment(q, 0.4, T.crane0))
      }
      // the crane: up the neck, past the pearl mark, back to take in the whole head
      const t = ease.inOutCubic(segment(q, T.crane0, T.crane1))
      setShot(_a, close, 3.0, 2.9, 0.32, 0.14)
      setShot(_b, A.amp, 8.3, 4.3, 0.2, 0.12)
      lerpShot(out, _a, _b, t)
      // the size grows late (a pull-back once the camera is up the neck)
      const g = ease.inOutQuad(segment(t, 0.35, 1))
      out.sw = lerp(3.0, 8.3, g)
      out.sh = lerp(2.9, 4.3, g)
      if (crane) crane.getPoint(t, out.at)
      // then a slow push onto the lamp (scroll-driven, not time)
      const s = segment(q, T.crane1, 1)
      out.sw *= 1 - 0.06 * s
      out.sh *= 1 - 0.06 * s
      out.yaw -= 0.05 * s
      return out
    }
    // portrait: the subject small and centred in the free band
    if (q < 0.17) {
      setShot(_a, A.stack, 11.8, 13.4, 0.47, 0.1)
      setShot(_b, A.stack, 11.0, 12.6, 0.44, 0.11)
      return lerpShot(out, _a, _b, segment(q, 0.0, 0.17))
    }
    if (q < 0.29) {
      setShot(_a, A.stack, 11.0, 12.6, 0.44, 0.11)
      setShot(_b, _v.copy(body).lerp(A.neck, 0.45), 4.8, 5.4, 0.4, 0.12)
      return lerpShot(out, _a, _b, ease.inOutQuad(segment(q, 0.17, 0.29)))
    }
    // the body whole in the band above the copy (the subject stays small and clear of the text)
    const bodyC = _v5.copy(body).lerp(A.felt, 0.2)
    if (q < 0.4) {
      setShot(_a, _v.copy(body).lerp(A.neck, 0.45), 4.8, 5.4, 0.4, 0.12)
      setShot(_b, bodyC, 4.1, 3.7, 0.34, 0.16)
      return lerpShot(out, _a, _b, ease.inOutCubic(segment(q, 0.29, 0.4)))
    }
    if (q < T.crane0) {
      setShot(_a, bodyC, 4.1, 3.7, 0.34, 0.16)
      setShot(_b, bodyC, 3.9, 3.5, 0.31, 0.16)
      return lerpShot(out, _a, _b, segment(q, 0.4, T.crane0))
    }
    const t = ease.inOutCubic(segment(q, T.crane0, T.crane1))
    setShot(_a, bodyC, 3.9, 3.5, 0.31, 0.16)
    setShot(_b, A.amp, 7.9, 3.9, 0.16, 0.12)
    lerpShot(out, _a, _b, t)
    const g = ease.inOutQuad(segment(t, 0.35, 1))
    out.sw = lerp(3.9, 7.9, g)
    out.sh = lerp(3.5, 3.9, g)
    if (crane) crane.getPoint(t, out.at)
    const s = segment(q, T.crane1, 1)
    out.sw *= 1 - 0.05 * s
    out.sh *= 1 - 0.05 * s
    return out
  }

  function solvePose(q: number, frame: Frame, out: CameraPose) {
    const w = layout.ok ? layout.w : frame.width
    const h = layout.ok ? layout.h : frame.height
    const L = layout.ok ? layout : { ...layout, w, h }
    const isTall = tall(w, h)
    const withCopy = smoothstep(0.2, 0.3, q)
    const withLegend = bandLegend(w, h) ? smoothstep(T.crane0 + 0.05, T.crane1 - 0.04, q) : 0
    const R = freeRegion(L, withCopy, withLegend)
    const s = shotAt(q, isTall, _shot)
    const fov = isTall ? 40 : 34
    const aspect = w / Math.max(1, h)
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const tanX = tanV * aspect
    const fw = (R.x1 - R.x0) / w
    const fh = (R.y1 - R.y0) / h
    const fill = 0.94
    const D = Math.max(s.sw / (2 * tanX * fw * fill), s.sh / (2 * tanV * fh * fill))
    // where the subject point should land on screen (NDC)
    const nx = ((R.x0 + s.ax * (R.x1 - R.x0)) / w) * 2 - 1
    const ny = 1 - ((R.y0 + s.ay * (R.y1 - R.y0)) / h) * 2
    _dir.set(Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), Math.cos(s.yaw) * Math.cos(s.pitch))
    _fwd.copy(_dir).negate()
    _right.crossVectors(_fwd, _Y).normalize()
    _up.crossVectors(_right, _fwd)
    out.position
      .copy(s.at)
      .addScaledVector(_dir, D)
      .addScaledVector(_right, -nx * D * tanX)
      .addScaledVector(_up, -ny * D * tanV)
    out.target.copy(out.position).addScaledVector(_fwd, D)
    out.fov = fov
    out.roll = 0
    out.parallax = frame.reducedMotion || frame.still ? 0 : 0.12
    return R
  }

  function placeLegend(l: number, frame: Frame, ctx: ChapterContext) {
    if (!set) return
    const v = smoothstep(T.legendIn, T.legendIn + 0.03, l) * (1 - smoothstep(T.out, T.out + 0.025, l))
    const W = frame.width
    const H = frame.height
    proj.copy(set.at.jewel).project(ctx.camera)
    const jx = (proj.x * 0.5 + 0.5) * W
    const jy = (-proj.y * 0.5 + 0.5) * H
    const ok = Number.isFinite(jx) && Number.isFinite(jy) && proj.z < 1
    reveal(legend, ok ? v : 0, 0)
    if (!ok || v <= 0) return
    const L = layout
    const pw = L.lw
    let px = 0
    let py = 0
    let d = ''
    const r = 15 // the ring round the lamp: the leader starts clear of it
    if (bandLegend(W, H)) {
      const R = freeRegion(L, 1, 1)
      px = clamp(jx - pw * (tall(W, H) ? 0.5 : 0.72), Math.max(L.gutter, tall(W, H) ? 0 : R.x0), W - L.gutter - pw)
      py = R.y1 + 18
    } else {
      // hung just under the head's front, below the lamp
      proj.copy(set.at.under).project(ctx.camera)
      const uy = (-proj.y * 0.5 + 0.5) * H
      const R = freeRegion(L, 1, 0)
      px = clamp(jx - pw * 0.72, Math.max(L.gutter, R.x0), W - L.gutter - pw)
      py = clamp(uy + 22, L.top, H - L.bottom - L.lh - 10)
    }
    const lx = clamp(jx, px + 20, px + pw - 20)
    d = `M${jx.toFixed(1)},${(jy + r).toFixed(1)} L${jx.toFixed(1)},${(py - 12).toFixed(1)} L${lx.toFixed(1)},${py.toFixed(1)}`
    if (Math.abs(lx - jx) < 1) d = `M${jx.toFixed(1)},${(jy + r).toFixed(1)} L${jx.toFixed(1)},${py.toFixed(1)}`
    // write only what changed (no per-frame style churn while the camera rests)
    if (d !== legendCache.d) leader.setAttribute('d', (legendCache.d = d))
    const dot = `translate3d(${jx.toFixed(1)}px, ${jy.toFixed(1)}px, 0)`
    if (dot !== legendCache.dot) leaderDot.style.transform = legendCache.dot = dot
    const pl = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`
    if (pl !== legendCache.plate) plate.style.transform = legendCache.plate = pl
  }

  return {
    id: 'shield',
    group,
    // the CTA (the copy layer's only stop) lands on the settled copy
    anchors: [0.45],

    async init(ctx: ChapterContext) {
      const stage = ctx.stage

      // ---------------- DOM (the visual layer; the accessible copy is srContent)
      frameEl = el('div', 'shield-frame', undefined, stage)
      col = el('div', 'shield-col', undefined, frameEl)
      head = el('div', 'shield-head', undefined, col)
      el('p', 'hud-eyebrow shield-eyebrow', SECURITY.eyebrow, head)
      title = rise(el('h2', 'hud-title shield-title', undefined, head), 'Hacked? <em>Breathe.</em>')
      panel = el('div', 'hud-panel shield-panel', undefined, col)
      el('p', 'hud-body shield-body', SECURITY.body, panel)
      const cta = el('a', 'hud-btn shield-cta', SECURITY.cta, panel)
      cta.href = SECURITY.href

      legend = el('div', 'shield-legend', undefined, stage)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('class', 'shield-leader')
      leader = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      svg.appendChild(leader)
      legend.appendChild(svg)
      leaderDot = el('div', 'shield-leader-dot', undefined, legend)
      plate = el('div', 'shield-plate', undefined, legend)
      el('span', 'shield-plate-k', STAT.value, plate)
      el('p', 'shield-plate-l', STAT.label, plate)

      reveal(head, 0)
      reveal(panel, 0)
      reveal(legend, 0, 0)
      measure(stage)
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => measure(stage))
        ro.observe(stage)
        ro.observe(col)
        ro.observe(plate)
      } else window.addEventListener('resize', () => measure(stage))
      document.fonts?.ready.then(() => measure(stage))

      // ---------------- the set (canvas legends need the faces)
      await fontsReady()
      set = await buildSet(group, ctx.mobile, ctx.world.envMap)
      const A = set.at
      crane = new THREE.CatmullRomCurve3(
        [
          _v.copy(A.body).lerp(A.felt, 0.35).clone(),
          A.neck.clone(),
          A.headstock.clone().add(new THREE.Vector3(0.3, -0.1, 0)),
          A.amp.clone(),
        ],
        false,
        'centripetal',
      )
    },

    onEnter() {
      clock.reset()
      heatClock.reset()
      lastQ = NaN
    },

    busy() {
      return clock.busy || heatClock.busy
    },

    update(l: number, frame: Frame, ctx: ChapterContext) {
      if (!set) return
      const q = clock.update(l, frame.dt)
      const t = frame.time
      const calm = ctx.reducedMotion || !!frame.still
      const wp = ctx.world.params
      const pp = ctx.post.params
      const { guitar, head: amp, felt, feltRest } = set
      const pilotMat = amp.pilot.material as THREE.ShaderMaterial

      // ---------------- the story (from the paced clock)
      const cool = smoothstep(T.cool0, T.cool1, q)
      const heat = heatClock.update(smoothstep(T.heat0, T.heat1, q) * (1 - cool), frame.dt)
      const mute = smoothstep(T.still0, T.still1, q)
      const energy = smoothstep(T.heat0 - 0.03, T.heat1, q) * (1 - mute)
      const craneT = ease.inOutCubic(segment(q, T.crane0, T.crane1))

      // thumps: time-paced (0.55–0.9 s apart), only while it squeals, never when calm
      if (!calm && energy > 0.4 && q < T.drop1 && t >= thumpNext) {
        thumpAt = t
        thumpN++
        thumpNext = t + 0.55 + 0.35 * ((thumpN * 0.618) % 1)
        thumpAmp = 0.22 + 0.16 * energy
        ring.strike(t, 1)
      }
      // the felt landing is a downbeat too (rate-limited by the same clock)
      if (!calm && Number.isFinite(lastQ) && lastQ < T.drop1 && q >= T.drop1 && t - thumpAt > 0.5) {
        thumpAt = t
        thumpNext = t + 0.6
        thumpAmp = 0.26
      }
      lastQ = q
      const since = t - thumpAt
      const thump = calm || since < 0 ? 0 : thumpAmp * Math.min(1, since / 0.03) * Math.exp(-since / 0.11)

      // ---------------- the strings: a hum → a squeal → dead still under the felt
      const rv = calm ? 0 : ring.value(t)
      const hum = 0.0035 * (1 - mute)
      for (let i = 0; i < 6; i++) {
        const swell = calm ? 0.6 : 0.5 + 0.5 * Math.sin(t * (1.1 + i * 0.41) + i * 1.9)
        guitar.strings.amp[i] = hum + energy * (0.04 + 0.035 * swell + 0.02 * rv) * (1.1 - i * 0.06)
      }
      // rolling-shutter waves (crisp, bent) — none when calm
      guitar.strings.wobble = calm ? 0 : energy * 0.88
      guitar.strings.opacity = 1 + 0.25 * energy
      // the squeal runs hot: the envelopes glow (and bloom) in the clip red
      mix(guitar.strings.light, C.stringCalm, C.stringHot, heat * 0.9).multiplyScalar(1 + 0.2 * energy * heat)
      guitar.strings.lightDir.set(0.35, 1, 0.9)
      guitar.update(frame, ctx.camera, ctx.renderer)

      // ---------------- the felt drops (guitar-local): from above the neck, accelerating, then settles
      felt.visible = q > T.drop0 - 0.005
      if (felt.visible) {
        const d = segment(q, T.drop0, T.drop1)
        const fall = 1 - d * d
        const s = segment(q, T.drop1, T.settle)
        const give = Math.sin(Math.PI * s) * (1 - s) * 0.012
        felt.position.set(feltRest.x + 2.6 * fall, feltRest.y + 0.25 * fall, feltRest.z + 1.6 * fall - give)
        felt.rotation.set(0.5 * fall, -0.35 * fall, 0.28 * fall)
        felt.scale.set(1, 1, 1 - 0.18 * Math.sin(Math.PI * s) * (1 - s))
      }

      // ---------------- the amp: tubes flare with the squeal, the jewel burns steady
      const tube = lerp(0.55, 1.7, heat) * (0.85 + 0.15 * energy)
      amp.setTubes(tube)
      for (const h of set.tubeHalos) h.material.color.copy(C.tube).multiplyScalar(1.1 * tube)
      // the jewel: lit from within, steady; its halo and its glow on the panel
      pilotMat.uniforms.uLevel.value = lerp(1, 1.2, heat)
      set.jewelHalo.material.color.copy(C.ruby).multiplyScalar(lerp(0.42, 0.7, heat))
      set.jewelLight.intensity = lerp(0.4, 0.9, heat)
      // the watch's knobs: cranked in the squeal, clicked back through detents as the crane arrives
      const back = segment(q, T.crane1 - 0.08, T.crane1 + 0.04)
      const targets = [0.62, 0.7, 0.66]
      for (let i = 0; i < 3; i++) {
        const v = lerp(1, targets[i], back)
        amp.setKnob(i, Math.round(v * 20) / 20)
      }

      // ---------------- light: the clip-LED red floods the stage, then tungsten and amber
      wp.spot = lerp(1.2, 1.3, heat) * lerp(1, 0.85, craneT)
      wp.spotColor = mix(cSpot, C.tungsten, C.red, heat * 0.72)
      // from the upper left on the guitar (its lacquer mustn't mirror the spot at the camera), over to the right for the head
      wp.spotPos.set(lerp(-15, 6, craneT), lerp(17, 22, craneT), lerp(7, 12, craneT))
      spotAt.copy(set.at.body).lerp(set.at.stack, 0.4 * (1 - smoothstep(0.2, 0.36, q)))
      spotAt.lerp(_v5.copy(set.at.amp).add(_off.set(0.4, -0.5, 0)), craneT)
      wp.spotAt.copy(spotAt)
      wp.spotAngle = lerp(lerp(0.3, 0.19, smoothstep(0.2, 0.4, q)), 0.24, craneT)
      wp.spotPenumbra = 0.6
      wp.rimA = lerp(1.1, 1.5, heat)
      wp.rimAColor = mix(cRimA, C.amber, C.red, heat)
      wp.rimADir.set(-0.8, 0.6, -1)
      wp.rimB = lerp(0.8, 1.4, heat)
      wp.rimBColor = mix(cRimB, C.straw, C.clip, heat)
      wp.rimBDir.set(0.95, 0.35, -0.8)
      wp.fill = lerp(0.1, 0.07, heat)
      wp.haze = lerp(0.55, 1.05, heat) * lerp(1, 0.8, craneT)
      wp.hazeColor = mix(cHaze, C.hazeCalm, C.hazeHot, heat)
      wp.hazeY = lerp(-0.2, 0.05, craneT)
      wp.beams = lerp(0.35, 0.95, heat) * lerp(1, 0.6, craneT)
      wp.beamA = mix(cBeamA, C.amber, C.red, heat)
      wp.beamB = mix(cBeamB, C.tungsten, C.oxblood, heat)
      wp.sway = calm ? 0 : 0.4
      wp.bokeh = lerp(0.45, 0.6, heat)
      wp.bokehA = mix(cBokA, C.amber, C.red, heat)
      wp.bokehB = mix(cBokB, C.straw, C.clip, heat)
      wp.env = 1
      wp.envTurn = lerp(-0.2, 0.35, smoothstep(0.1, 0.5, q)) + 0.3 * craneT

      pp.bloomStrength = lerp(0.5, 0.75, heat)
      pp.bloomThreshold = 0.95
      pp.saturation = 1.06 + 0.12 * heat
      pp.lift = 0.012 + 0.012 * heat
      pp.warmth = 1 - 0.25 * heat
      pp.vignette = 0.58 + 0.08 * heat
      pp.glitch = thump

      // ---------------- DOM (from local)
      const out = 1 - smoothstep(T.out, T.out + 0.025, l)
      reveal(head, smoothstep(T.headIn, T.headIn + 0.03, l) * out)
      setRise(title, l > T.headIn + 0.005 && l < T.out + 0.02)
      reveal(panel, smoothstep(T.bodyIn, T.bodyIn + 0.035, l) * out)
      const hot = heat > 0.5
      if (frameEl.classList.contains('is-hot') !== hot) frameEl.classList.toggle('is-hot', hot)
      placeLegend(l, frame, ctx)
    },

    camera(l: number, frame: Frame, out: CameraPose) {
      const q = Number.isFinite(clock.value) ? clock.value : l
      solvePose(q, frame, out)
    },
  }
}

const _v = new THREE.Vector3()
const _v4 = new THREE.Vector3()
const _v5 = new THREE.Vector3()
const _off = new THREE.Vector3()
