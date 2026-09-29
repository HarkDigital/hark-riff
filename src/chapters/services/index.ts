import * as THREE from 'three'
import type { Chapter, Frame } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECTIONS, SERVICES } from '../../content'
import { clamp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { StoryClock } from '../../kit/pace'
import { buildAmp } from '../../kit/amp'
import { stageFloor } from '../../kit/stage'
import { fontsReady } from '../../kit/materials'
import { GEL } from '../../world/World'
import { buildHead, INPUT, VOL, ZF, type Head } from './head'
import './services.css'

/*
 * SERVICES · "Up to Eleven". A big close-up of a vintage amp head's
 * brushed-gold control panel (head.ts): a guitar cable's plug slides into
 * INPUT (a click; the jewel lamp lights, the tubes start to warm), then the
 * camera glides along the panel — past PRESENCE, BASS, MIDDLE, TREBLE — to
 * ONE big chicken-head knob over a dial engraved 1 to 11. Scrolling turns
 * it: each detent is one service (the number is the service's index). Each
 * click: the pointer lands on the number (the follow spot tracks it), the
 * power tubes behind the window glow a notch hotter, the VU needle swings,
 * the jewel brightens, and the card names the service. At 11 everything is
 * cooking — a warm, steady glow, never a flash.
 *
 * Laid out in vh (the chapter is LEN = 7.0 vh long):
 *   0–0.22     under the cut: the plug hangs in front of INPUT
 *   0.22–0.62  the plug slides home (click at 0.62: jewel on, tubes warming)
 *              "What we do" / Eleven ways to be heard. — held ~0.5 vh
 *              clear of the cut (landing 0.06 = 0.42 vh, intro 0.05)
 *   0.66–0.92  the glide along the panel to VOLUME; the card fades in and
 *              the knob clicks from the dot to 1
 *   0.9–6.62   eleven detents of 0.52 vh each (~2 s at a comfortable wheel)
 *   6.62–7.0   the pull-back: the whole head at 11, glowing, HELD into the cut
 *
 * PACING (WCAG 2.3.1): nothing reads `local` directly. A StoryClock turns it
 * into `q` (≤ 1.1 detents a second; each sweep between detents takes ≥ 0.5 s
 * of TIME). On a fling the chapter TRAVELS: the card fades, the knob spins
 * through, the spot opens up, the clock chases. Glow levels (tubes, jewel,
 * VU lamp) follow their targets at a capped rate, so a scrub up and down
 * the dial can never pump the light faster than ~1 swing a second.
 */

const LEN = 7.0
const vh = (x: number) => x / LEN
const N = SERVICES.length
/** each service: 0.52 vh of scroll */
const SLOT = vh(0.52)
const A = vh(0.9)
const B = A + N * SLOT
/**
 * share of a slot spent sweeping between detents (straddling the boundary):
 * at the clock's top rate (READ_RATE) a sweep takes GLIDE / READ_RATE ≈ 0.51 s
 */
const GLIDE = 0.56
/** the plug: slides home PLUG_A → PLUG_B (the click) */
const PLUG_A = vh(0.22)
const PLUG_B = vh(0.62)
/** the headline holds until INTRO_OUT, then the camera glides INTRO_OUT → ARRIVE */
const INTRO_OUT = vh(0.7)
const ARRIVE = vh(0.95)
const CARD_IN = [vh(0.84), vh(0.92)] as const
const CARD_OUT = [B - vh(0.0), B + vh(0.06)] as const
/** the pull-back to the whole head */
const OUT_A = B + vh(0.02)
const OUT_B = B + vh(0.26)
/** reading pace, detents per second (≤ 1.2 item changes/s) */
const READ_RATE = 1.1
const CHASE_K = 2.2
const CHASE_MIN = 2.2
const CHASE_MAX = 10
const FOV = 36
const TAN = Math.tan(((FOV / 2) * Math.PI) / 180)

const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const approach = (x: number, to: number, step: number) => (x < to ? Math.min(to, x + step) : Math.max(to, x - step))

/** the knob's detent value for story position q: plateaus at each number, eased sweeps between */
function detentOf(q: number) {
  const u = (q - A) / SLOT + GLIDE / 2
  const n = Math.floor(u)
  const t = clamp((u - n) / GLIDE)
  return clamp(n + smoother(t), 0, N)
}
/** the same, a steady turn (traveling) */
const detentLinear = (q: number) => clamp((q - A) / SLOT + 0.5, 0, N)

/** glow levels per detent */
const tubeLevel = (d: number) => 0.2 + 0.8 * Math.pow(clamp(d / N), 1.25)
const pilotLevel = (d: number) => 0.5 + 0.5 * clamp(d / N)
const vuRest = (d: number) => 0.05 + 0.85 * Math.pow(clamp(d / N), 1.1)

export default function create(): Chapter {
  const group = new THREE.Group()
  let head: Head
  const anchors = Array.from({ length: N }, (_, i) => A + (i + 0.55) * SLOT)

  let stage: HTMLElement
  let intro: HTMLElement, introTitle: HTMLElement
  let card: HTMLElement
  let clip: HTMLElement
  let bodies: HTMLElement[] = []
  let heights: number[] = []

  // ---- pacing
  const clock = new StoryClock({ rate: READ_RATE * SLOT })
  let now = 0
  let prevLocal = -1
  let prevQ = -1
  let traveling = false
  let travK = 0
  let cardK = 1
  let shown = 0
  let bodyK = 1
  let settling = false
  // levels (time-damped)
  let tubes = 0
  let pilot = 0
  let vuLamp = 0
  let needle = 0
  let kickAt = -1e9
  let thumpAt = -1e9
  let thump = 0
  let lastDetent = -1
  // what camera() needs from update()
  let camD = 0
  let camQ = 0
  let cardTop = -1
  let cardW = 440
  /** seconds the scroll has been fast (a single reduced-motion wheel notch spikes the velocity) */
  let fastFor = 0

  const pA = new THREE.Vector3()
  const tA = new THREE.Vector3()
  const pB = new THREE.Vector3()
  const tB = new THREE.Vector3()
  const pC = new THREE.Vector3()
  const tC = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const focus = new THREE.Vector3()
  const aDir = new THREE.Vector3()
  const aUp = new THREE.Vector3()
  const right = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  const fit = (instant = false) => {
    const hh = heights[shown]
    if (!(hh > 0)) return
    if (instant) clip.style.transition = 'none'
    clip.style.height = `${hh}px`
    if (instant) {
      void clip.offsetHeight
      clip.style.transition = ''
    }
  }
  const swap = (i: number, instant = false) => {
    reveal(bodies[shown], 0, 0)
    shown = i
    fit(instant)
  }
  const measure = () => {
    if (!card) return
    card.style.top = ''
    card.style.bottom = ''
    clip.style.height = ''
    cardTop = card.offsetTop
    cardW = card.offsetWidth
    heights = bodies.map(b => b.offsetHeight)
    card.style.top = `${cardTop}px`
    card.style.bottom = 'auto'
    fit(true)
  }

  const sfx = (kind: string, n?: number) => {
    try {
      window.dispatchEvent(new CustomEvent('hark:sfx', { detail: { kind, n } }))
    } catch {
      /* old browsers */
    }
  }

  /**
   * Place the camera so the world point `focus` lands at screen fraction
   * (fx, fy) (0..1, y down), looking along yaw/elevation from `dist` away.
   */
  const aim = (frame: Frame, focus: THREE.Vector3, yaw: number, el: number, dist: number, fx: number, fy: number, pos: THREE.Vector3, tgt: THREE.Vector3) => {
    const aspect = frame.width / frame.height
    const dir = aDir.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el))
    right.crossVectors(UP, dir).normalize()
    const up = aUp.crossVectors(dir, right).normalize()
    const hgt = 2 * dist * TAN
    // shift the target opposite to where the focus should appear
    tgt.copy(focus)
      .addScaledVector(right, -(fx - 0.5) * hgt * aspect)
      .addScaledVector(up, (fy - 0.5) * hgt)
    pos.copy(tgt).addScaledVector(dir, dist)
  }

  /** the pose on the knob at detent d (continuous) */
  const knobPose = (d: number, frame: Frame, pos: THREE.Vector3, tgt: THREE.Vector3) => {
    const w = frame.width
    const h = frame.height
    const aspect = w / h
    const t = clamp((d - 1) / (N - 1))
    const ts = t * t * (3 - 2 * t)
    const yaw = lerp(-0.2, 0.05, ts)
    const el = lerp(-0.1, 0.02, ts)
    // the subject: the knob, the VU to its right, the tubes above
    const f = focus.set(VOL.x + 1.0, VOL.y + 0.62, ZF)
    if (h > w) {
      // portrait: the knob + VU in the band between the chrome and the card
      const top = clamp(0.105 * h, 80, 112)
      const bottom = cardTop > 0 ? cardTop - 10 : h * 0.55
      const band = Math.max(140, bottom - top)
      // the subject is ~3.3 units wide, 3.2 tall: fit whichever is tighter
      const need = Math.max((3.0 * h) / band, 3.75 / aspect)
      const dist = need / 2 / TAN
      f.set(VOL.x + 0.78, VOL.y + 0.62, ZF)
      aim(frame, f, yaw * 0.6, el, dist * lerp(1.02, 0.94, ts), 0.5, (top + bottom) / 2 / h, pos, tgt)
      return
    }
    const short = h < 500
    const cardFrac = (clamp(0.034 * w, 16, 48) + cardW) / w
    const fx = clamp(0.5 + 0.5 * cardFrac + (short ? 0.02 : 0.035), 0.55, 0.72)
    // visible height: tighter as it goes up; wider when the screen is narrow
    const base = lerp(4.2, 3.8, ts) * (aspect < 1.45 ? 1.18 : 1) * (short ? 1.08 : 1)
    const dist = base / 2 / TAN
    aim(frame, f, yaw, el, dist, fx, 0.47, pos, tgt)
  }

  /**
   * The intro: low and oblique from the left, down the length of the panel —
   * the plug big in the foreground at INPUT, every knob receding to the VU
   * and the jewel lamp at the far end (it lights on the click). Returns the fov.
   */
  const introPose = (frame: Frame, pos: THREE.Vector3, tgt: THREE.Vector3) => {
    const w = frame.width
    const h = frame.height
    const aspect = w / h
    if (h > w) {
      // portrait: square-on to the input end, the panel running off to the right
      const f = focus.set(INPUT.x + 1.25, INPUT.y + 0.2, ZF + 0.2)
      const need = Math.max(3.1 / aspect, 4.2)
      aim(frame, f, -0.62, 0.1, need / 2 / TAN, 0.5, 0.6, pos, tgt)
      return FOV
    }
    // the look: from (-7.2, 2.0, 4.4) at (-0.6, 1.55, 0.9), a 32° lens; pulled
    // back on narrower screens so the jewel stays in frame
    // (and a touch further back on screens wider than 16:10, so the mark stays whole)
    const back = clamp((1.62 - aspect) * 3.2, 0, 2.2) + clamp((aspect - 1.6) * 3, 0, 1.2) + (h < 500 ? 0.4 : 0)
    tgt.set(-0.6 + back * 0.12, 1.8 + clamp((aspect - 1.6) * 0.6, 0, 0.25), 0.9)
    const yaw = -1.083
    const el = 0.06
    pos.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).multiplyScalar(7.48 + back).add(tgt)
    return 32
  }

  /** the pull-back: the whole head at 11, glowing */
  const outPose = (frame: Frame, pos: THREE.Vector3, tgt: THREE.Vector3) => {
    const w = frame.width
    const h = frame.height
    const aspect = w / h
    const f = focus.set(0.6, 2.1, ZF - 0.4)
    if (h > w) {
      aim(frame, f, 0.3, 0.16, 9.8 / aspect / 2 / TAN, 0.5, 0.48, pos, tgt)
      return
    }
    aim(frame, f, 0.34, 0.16, 7.4 / 2 / TAN * (aspect < 1.45 ? 1.2 : 1), 0.56, 0.5, pos, tgt)
  }

  return {
    id: 'services',
    group,
    anchors,
    async init(ctx) {
      stage = ctx.stage
      await fontsReady()
      head = await buildHead({ mobile: ctx.mobile, yieldFn: nextFrame })
      group.add(head.group)
      // the head sits on a 4x12 on the stage planks
      const cab = buildAmp({ kind: 'cab', badge: true })
      cab.group.position.set(0, -7.4, -0.3)
      group.add(cab.group)
      const floor = stageFloor(90, 70)
      floor.position.y = -7.4
      group.add(floor)
      await nextFrame()

      // ---- DOM
      intro = el('div', 'sv-intro', undefined, stage)
      el('p', 'hud-eyebrow', SECTIONS.services.eyebrow, intro)
      introTitle = rise(el('h2', 'hud-h2 sv-head', undefined, intro), 'Eleven ways to be <em>heard.</em>')

      card = el('div', 'hud-panel sv-card', undefined, stage)
      clip = el('div', 'sv-clip', undefined, card)
      bodies = SERVICES.map((s, i) => {
        const b = el('div', 'sv-body', undefined, clip)
        const row = el('div', 'sv-row', undefined, b)
        el('span', 'sv-num', s.num, row)
        el('span', 'hud-label sv-of', `/ ${String(N).padStart(2, '0')}`, row)
        const ladder = el('span', 'sv-ladder', undefined, row)
        for (let k = 0; k < N; k++) el('i', k <= i ? 'is-on' : '', undefined, ladder)
        el('h3', 'sv-title', s.title, b)
        el('p', 'hud-body sv-blurb', s.blurb, b)
        const tg = el('ul', 'hud-tags sv-tags', undefined, b)
        for (const t of s.tags) el('li', 'hud-tag', t, tg)
        reveal(b, i === shown ? 1 : 0, 0)
        return b
      })
      reveal(card, 0, 0)
      reveal(intro, 0)
      measure()
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => measure()).observe(stage)
      document.fonts?.ready.then(measure, () => {})
    },

    update(local, frame, ctx) {
      const calm = ctx.reducedMotion || !!frame.still
      const dt = frame.dt
      now += dt
      const vel = Math.abs(frame.velocity)

      // ---- pacing: q, the story clock's view of local
      const teleport = prevLocal < 0 || Math.abs(local - prevLocal) > 0.12
      prevLocal = local
      const behind = teleport || !Number.isFinite(clock.value) ? 0 : Math.abs(local - clock.value) / SLOT
      fastFor = vel > 0.9 ? fastFor + dt : 0
      if (traveling ? vel < 0.5 && behind < 0.25 : fastFor > 0.12 || behind > 1.6) traveling = !traveling
      clock.rate = SLOT * (traveling ? clamp(CHASE_K * behind, CHASE_MIN, CHASE_MAX) : READ_RATE)
      const q = clock.update(local, dt)
      const tk = traveling ? 1 : 0
      travK = teleport ? tk : approach(travK, tk, dt / 0.35)
      const tks = travK * travK * (3 - 2 * travK)
      const d = lerp(detentOf(q), detentLinear(q), tks)
      camD = d
      camQ = q

      // ---- the plug and the click
      const plugK = smoothstep(PLUG_A, PLUG_B, q)
      head.setPlug(plugK)
      const plugged = q >= PLUG_B - 1e-4
      if (!teleport && prevQ >= 0 && prevQ < PLUG_B && plugged) {
        if (!calm && now - thumpAt > 0.7) {
          thump = 0.26
          thumpAt = now
        }
        sfx('plug')
      }
      prevQ = q

      // ---- detents: the knob, and the click when it lands on a number
      head.setDetent(d)
      const nearest = Math.round(d)
      const onDetent = Math.abs(d - nearest) < 0.02
      if (teleport || lastDetent < 0) lastDetent = nearest
      else if (onDetent && nearest !== lastDetent && !traveling) {
        if (nearest > 0) {
          kickAt = now
          if (!calm && now - thumpAt > 0.75) {
            thump = nearest === N ? 0.2 : 0.12
            thumpAt = now
          }
          sfx('detent', nearest)
        }
        lastDetent = nearest
      } else if (traveling) lastDetent = nearest

      // ---- glow levels: follow their targets at a capped rate (no pumping)
      const dl = clamp(d, 0, N)
      const tubeT = plugged ? tubeLevel(dl) : 0
      const pilotT = plugged ? pilotLevel(dl) : 0
      const lampT = plugged ? 0.3 + 0.7 * clamp(dl / N) : 0.04
      if (teleport) {
        tubes = tubeT
        pilot = pilotT
        vuLamp = lampT
      } else {
        // tubes warm slowly; the jewel is a lamp (fast on, but capped)
        tubes = approach(tubes, tubeT, dt * (tubes < 0.2 && tubeT > tubes ? 0.35 : 0.9))
        pilot = approach(pilot, pilotT, dt * 2.2)
        vuLamp = approach(vuLamp, lampT, dt * 1.4)
      }
      head.setTubes(tubes)
      head.setPilot(pilot)
      // the VU needle: rests on the level, kicks on each click, a gentle flutter
      const rest = plugged ? vuRest(dl) : 0
      const kt = now - kickAt
      const kick = calm || kt < 0 ? 0 : 0.16 * (kt < 0.09 ? kt / 0.09 : Math.exp(-(kt - 0.09) / 0.32))
      const flutter = calm || !plugged ? 0 : 0.012 * (Math.sin(frame.time * 2.3) + 0.6 * Math.sin(frame.time * 3.7 + 1.3)) * (0.4 + tubes)
      const needleT = rest + kick + flutter
      needle = teleport ? needleT : needle + (needleT - needle) * (1 - Math.exp(-dt * 14))
      head.setVu(needle, vuLamp)

      // ---- light
      const w = ctx.world.params
      const wide = Math.max(1 - smoothstep(INTRO_OUT, ARRIVE, q), 0) // 1 in the intro
      const outK = smoothstep(OUT_A, OUT_B, q)
      w.top = '#0c0806'
      w.bottom = '#020101'
      w.haze = 0.4 + 0.5 * tubes
      w.hazeColor = '#b0582a'
      w.hazeY = 0.15
      w.beams = lerp(0.35, 0.55, outK)
      w.beamA = GEL.amber
      w.beamB = GEL.oxblood
      w.bokeh = lerp(0.35, 0.55, outK)
      w.bokehA = GEL.amber
      w.bokehB = GEL.red
      // the follow spot: on the plug in the intro, then on the number the pointer is on
      const spotOn = v1
      if (wide > 0.001) {
        const onKnob = head.numberAt(Math.max(d, 1), v2).lerp(VOL, 0.35)
        spotOn.set(INPUT.x + 0.6, INPUT.y + 0.1, ZF).lerp(onKnob, 1 - wide)
      } else head.numberAt(Math.max(d, 1), spotOn).lerp(VOL, 0.35)
      spotOn.lerp(v2.set(0.6, 2.0, ZF), outK)
      w.spotAt.copy(spotOn)
      // from high and in front (in the close-ups nearly along the lens, so the
      // bakelite and the brushed gold catch a soft sheen round the dial)
      const frontal = 1 - Math.max(wide, outK)
      w.spotPos.set(spotOn.x + lerp(2.5, 1.2, frontal), spotOn.y + lerp(12, 6.5, frontal), spotOn.z + 12)
      w.spot = lerp(1.25, 1.05, outK)
      w.spotColor = GEL.tungsten
      w.spotAngle = lerp(lerp(0.12, 0.2, tks), 0.3, Math.max(wide, outK))
      w.spotPenumbra = 0.85
      w.rimA = 0.9
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.8, 0.65, -0.55)
      w.rimB = 0.35 + 0.2 * tubes
      w.rimBColor = GEL.red
      w.rimBDir.set(0.9, 0.35, -0.5)
      w.fill = 0.14
      w.env = 0.9
      w.envTurn = 0.35 + (calm ? 0 : Math.sin(frame.time * 0.18) * 0.12)
      const pp = ctx.post.params
      pp.bloomThreshold = 1.05
      pp.bloomStrength = 0.34 + 0.18 * tubes
      pp.bloomRadius = 0.5
      pp.warmth = 1
      pp.lift = 0.014
      pp.vignette = 0.6
      // the thump: a short speaker-cone push after a click
      const th = now - thumpAt
      pp.glitch = calm ? 0 : thump * (th < 0.05 ? th / 0.05 : Math.exp(-(th - 0.05) / 0.12))
      if (th > 0.8) thump = 0

      // ---- copy (from q, so the words and the camera agree)
      reveal(intro, 1 - smoothstep(INTRO_OUT, INTRO_OUT + vh(0.06), q))
      setRise(introTitle, q > vh(0.05) && q < INTRO_OUT + vh(0.06))
      const cardVis = smoothstep(CARD_IN[0], CARD_IN[1], q) * (1 - smoothstep(CARD_OUT[0], CARD_OUT[1], q))
      const ck = traveling ? 0 : 1
      // (a fade, not motion: it runs under reduced motion too, so the plate never blinks)
      cardK = teleport ? ck : approach(cardK, ck, dt / (traveling ? 0.2 : 0.3))
      const vis = cardVis * cardK
      // the card names the number the pointer is on
      const cur = clamp(Math.round(d) - 1, 0, N - 1)
      if (cur !== shown) {
        if (calm || teleport || vis < 0.02) {
          swap(cur, true)
          bodyK = 1
        } else {
          bodyK = Math.max(0, bodyK - dt / 0.12)
          if (bodyK <= 0) swap(cur)
        }
      } else bodyK = Math.min(1, bodyK + dt / 0.2)
      reveal(bodies[shown], bodyK, 0)
      reveal(card, vis, 0)

      const levelsBusy = Math.abs(tubes - tubeT) > 1e-3 || Math.abs(pilot - pilotT) > 1e-3 || Math.abs(vuLamp - lampT) > 1e-3 || Math.abs(needle - needleT) > 1e-3
      settling = clock.busy || levelsBusy || travK !== tk || cardK !== ck || bodyK < 1 || cur !== shown || now - kickAt < 1.2 || thump > 0
    },

    camera(_local, frame, out) {
      const q = camQ
      knobPose(Math.max(camD, 1), frame, pA, tA)
      const introFov = introPose(frame, pB, tB)
      outPose(frame, pC, tC)
      // intro → knob: a dolly along the panel that eases off it a little mid-way
      const k = smoothstep(INTRO_OUT, ARRIVE, q)
      const ks = smoother(k)
      out.position.copy(pB).lerp(pA, ks)
      out.target.copy(tB).lerp(tA, ks)
      out.position.z += Math.sin(Math.PI * ks) * 0.9
      // knob → the whole head
      const o = smoother(smoothstep(OUT_A, OUT_B, q))
      out.position.lerp(pC, o)
      out.target.lerp(tC, o)
      out.fov = lerp(introFov, FOV, ks)
      out.parallax = 0.12
    },

    onEnter() {
      clock.reset()
      fastFor = 0
      prevLocal = -1
      prevQ = -1
      lastDetent = -1
      thump = 0
    },

    busy: () => settling,
  }
}
