import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext } from '../../core/types'
import { reveal, setRise } from '../../core/dom'
import { damp, ease, lerp, segment, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { Ring } from '../../kit/strings'
import { GEL } from '../../world/World'
import { buildHud, measureHud, type Hud, type Layout, type Rect } from './hud'
import { buildSet, type EncoreSet } from './scene'
import './contact.css'

/*
 * CONTACT · "Encore" — the end of the night. The house lights go down; the
 * guitar stands alone on its A-frame stand in the follow spot, plugged in,
 * its cable curling across the boards to a combo amp in the dark with its
 * jewel lamp on. One shaft of light comes down through the haze behind it.
 * As you arrive, one last chord rings out and decays (time-paced, subtle).
 *
 *   0.00–0.12  the cab cut opens (the frame stays lit: the house is still up)
 *   0.04–0.28  the camera cranes down to the guitar; the house lights (gel
 *              beams, truss bokeh) go down until only the spot, the shaft
 *              and the jewel are left; the last chord strikes on arrival
 *   0.20–0.86  settled (landing / heading stop 0.3): the panel — eyebrow,
 *              "Say hello.", body, the address on a gold INPUT plate, Copy
 *              email, THE TOUR (the other concepts, like the back of a tour
 *              tee), Back to top, colophon. Short screens split it into two
 *              beats (A, then B) at SPLIT_AT. The camera eases round a few
 *              degrees (the flame top shimmers).
 *   0.86–1.00  the sign-off: the panel goes, the camera cranes up and back
 *              over the empty stage — the guitar in its spot, the amp's lamp
 *              — over "Thanks for listening.", the address, Back to top.
 *              The last frame stays lit (there is no cut after it).
 *
 * The camera, the copy and the light levels derive from `local`; only the
 * strings (Ring) and the copy-glint run on time.
 */

const SPLIT_AT = 0.56
const STRUM_AT = 0.13

interface Shot {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
}
const shot = (): Shot => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 30 })

interface Box {
  c: THREE.Vector3
  hw: number
  hh: number
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

/**
 * Frame a box (centre c, half extents hw × hh, facing the camera) inside a
 * screen rect r (u across, v down, 0..1). The camera stands at distance d,
 * raised by `elev` degrees; the box is placed ACROSS by sliding the rig
 * sideways and UP/DOWN by pitching the view (never by dropping the camera
 * under the boards). Then the rig orbits by `yaw` about the box's vertical
 * axis (+ = the camera swings to the audience's right).
 */
function fit(out: Shot, aspect: number, fov: number, b: Box, r: { u0: number; u1: number; v0: number; v1: number }, elev: number, yaw: number) {
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2))
  const halfH = Math.max(b.hh / Math.max(0.05, r.v1 - r.v0), b.hw / Math.max(0.05, (r.u1 - r.u0) * aspect))
  const halfW = halfH * aspect
  const d = halfH / tanV
  const sx = -((r.u0 + r.u1) / 2 - 0.5) * 2 * halfW
  const ny = 1 - (r.v0 + r.v1)
  const delta = Math.atan(ny * tanV)
  const e = THREE.MathUtils.degToRad(elev)
  _b.set(sx, d * Math.sin(e), d * Math.cos(e))
  _a.set(0, -Math.sin(e + delta), -Math.cos(e + delta)).multiplyScalar(d).add(_b)
  _a.applyAxisAngle(UP, yaw)
  _b.applyAxisAngle(UP, yaw)
  out.tgt.set(b.c.x + _a.x, b.c.y + _a.y, b.c.z + _a.z)
  out.pos.set(b.c.x + _b.x, b.c.y + _b.y, b.c.z + _b.z)
  out.fov = fov
  return out
}

function mix(out: Shot, a: Shot, b: Shot, t: number) {
  out.pos.lerpVectors(a.pos, b.pos, t)
  out.tgt.lerpVectors(a.tgt, b.tgt, t)
  out.fov = lerp(a.fov, b.fov, t)
  return out
}

const toRect = (q: Rect, W: number, H: number) => ({ u0: q.x0 / W, u1: q.x1 / W, v0: q.y0 / H, v1: q.y1 / H })

export default function create(): Chapter {
  const group = new THREE.Group()
  let hud: Hud
  let set: EncoreSet & { beamPool: THREE.Mesh }
  let lay: Layout | null = null
  let lastW = 0
  let lastH = 0
  let showB = false

  // the last chord: six time-decaying rings, struck bass → treble
  const rings = Array.from({ length: 6 }, () => new Ring(3.6, 0.6))
  const PEAK = [0.032, 0.029, 0.026, 0.022, 0.018, 0.015]
  let strumAt = -1e9
  let lastStrum = -1e9
  const struck = [true, true, true, true, true, true]
  let prevLocal = NaN
  let entered = false
  // the copy glint: the jewel lamp answers, one string sings (wall clock)
  let copiedSeen = -1e9
  let pulse = 0
  let shaft = 0.7

  // camera scratch
  const A = shot()
  const S1 = shot()
  const S2 = shot()
  const F = shot()
  const OUT = shot()
  const wideBox: Box = { c: new THREE.Vector3(), hw: 0, hh: 0 }
  const endBox: Box = { c: new THREE.Vector3(), hw: 0, hh: 0 }
  const tightBox: Box = { c: new THREE.Vector3(), hw: 0, hh: 0 }
  const spotPos = new THREE.Vector3(6, 31, 9)
  const lightDir = new THREE.Vector3()

  const relayout = (W: number, H: number) => {
    lay = measureHud(hud, W, H)
    lastW = W
    lastH = H
    showB = false
  }

  return {
    id: 'contact',
    group,
    anchors: [],

    async init(ctx: ChapterContext) {
      hud = buildHud(ctx.stage)
      await nextFrame()
      set = await buildSet(ctx.mobile)
      group.add(set.group)
      lightDir.copy(spotPos).sub(set.heart).normalize()
      set.guitar.strings.lightDir.copy(lightDir)
      await nextFrame()
    },

    onEnter() {
      entered = true
      prevLocal = NaN
    },

    busy() {
      return pulse > 0.002
    },

    update(local, frame, ctx) {
      const W = frame.width
      const H = frame.height
      if (hud.dirty || W !== lastW || H !== lastH || !lay) relayout(W, H)
      const L = lay!
      const calm = ctx.reducedMotion || frame.reducedMotion || !!frame.still
      const g = set.guitar

      // ------------------------------------------------ the last chord
      const ready = document.documentElement.dataset.ready === '1'
      const crossed = local >= STRUM_AT && local <= 0.9 && (entered || !(prevLocal >= STRUM_AT))
      if (ready && !calm && crossed && frame.time - lastStrum > 4) {
        strumAt = frame.time
        lastStrum = frame.time
        struck.fill(false)
      }
      if (ready) entered = false
      prevLocal = local
      for (let i = 0; i < 6; i++) {
        if (!struck[i] && frame.time >= strumAt + i * 0.042) {
          rings[i].strike(frame.time, 1)
          struck[i] = true
        }
      }
      // copying the address: the jewel lamp answers and the high e sings once
      if (hud.copiedAt !== copiedSeen) {
        copiedSeen = hud.copiedAt
        if (!calm) rings[5].strike(frame.time, 0.9)
      }
      const since = (performance.now() - hud.copiedAt) / 1000
      pulse = since >= 0 && since < 1.6 ? Math.sin(Math.min(1, since / 0.12) * Math.PI * 0.5) * Math.exp(-since * 2.2) : 0
      for (let i = 0; i < 6; i++) g.strings.amp[i] = calm ? 0 : PEAK[i] * rings[i].value(frame.time)
      g.strings.wobble = 0

      // ------------------------------------------------ the light
      // the house goes down as we arrive; the finale narrows to the spot
      const house = 1 - smoothstep(0.04, 0.3, local)
      const fin = smoothstep(0.86, 0.98, local)
      const wp = ctx.world.params
      wp.top = '#0a0605'
      wp.bottom = '#020101'
      wp.haze = lerp(0.2, 0.5, house) * (1 - 0.25 * fin)
      wp.hazeColor = '#a8542a'
      wp.hazeY = 0.3
      wp.beams = 0.55 * house
      wp.beamA = GEL.amber
      wp.beamB = GEL.oxblood
      wp.sway = 0.35
      wp.bokeh = lerp(0.12, 0.42, house) * (1 - 0.4 * fin)
      wp.bokehA = GEL.amber
      wp.bokehB = GEL.oxblood
      // the follow spot, tight on the guitar from high out front (steep enough
      // that the lacquered headstock never mirrors it into the lens)
      wp.spot = 1.05
      wp.spotColor = GEL.tungsten
      wp.spotPos.copy(spotPos)
      wp.spotAt.copy(set.heart)
      wp.spotAngle = lerp(0.235, 0.215, fin)
      wp.spotPenumbra = 0.5
      // gel rims from behind: amber left, oxblood right
      wp.rimA = lerp(1.15, 0.8, fin)
      wp.rimAColor = GEL.amber
      wp.rimADir.set(-0.8, 0.2, -1)
      wp.rimB = lerp(0.75, 0.5, fin)
      wp.rimBColor = GEL.oxblood
      wp.rimBDir.set(0.95, 0.12, -1)
      wp.fill = 0.06
      wp.env = lerp(0.4, 0.8, house) * (1 - 0.15 * fin)
      wp.envTurn = -0.45 + 0.7 * local

      // the shaft brightens as the house goes down (damped: never a jump)
      shaft = damp(shaft, lerp(0.75, 1, 1 - house) * (1 - 0.1 * fin), 4, frame.dt)
      set.beam.set(0.42 * shaft, frame.time)
      ;(set.beamPool.material as THREE.MeshBasicMaterial).opacity = 0.22 * shaft

      set.amp.setPilot(2.5 + 0.9 * pulse)
      // the strings catch the spot
      g.strings.light.set(GEL.tungsten).multiplyScalar(1.15)
      g.update(frame, ctx.camera, ctx.renderer)

      const pp = ctx.post.params
      // only the jewel lamp crosses the threshold (the headstock lacquer is satined in scene.ts)
      pp.bloomStrength = 0.6
      pp.bloomRadius = 0.38
      pp.bloomThreshold = 1.4
      pp.vignette = lerp(0.6, 0.7, fin)
      pp.grain = 0.035
      pp.warmth = 1
      pp.lift = 0.014

      // ------------------------------------------------ copy
      let pv = smoothstep(0.17, 0.235, local) * (1 - smoothstep(0.86, 0.895, local))
      const b = L.split && local >= SPLIT_AT
      if (b !== showB) hud.root.classList.toggle('show-b', (showB = b))
      // the split: dip out for a moment while the panel changes part
      if (L.split) pv *= 1 - smoothstep(SPLIT_AT - 0.03, SPLIT_AT - 0.008, local) * (1 - smoothstep(SPLIT_AT + 0.008, SPLIT_AT + 0.03, local))
      reveal(hud.panel, pv)
      setRise(hud.title, local > 0.19 && local < (L.split ? SPLIT_AT : 0.88))
      reveal(hud.end, smoothstep(0.9, 0.945, local), 0)
    },

    camera(local, frame, out: CameraPose) {
      const W = Math.max(1, frame.width)
      const H = Math.max(1, frame.height)
      const aspect = W / H
      const L = lay
      const stack = L ? L.stack : H > W
      const fov = stack ? 36 : 30
      const s = set.subject
      const band = L ? L.band : { x0: 0.04 * W, x1: 0.96 * W, y0: 0.11 * H, y1: 0.89 * H }
      const art = L ? L.art : stack ? { x0: band.x0, x1: band.x1, y0: band.y0, y1: H * 0.45 } : { x0: W * 0.46, x1: band.x1, y0: band.y0, y1: band.y1 }
      const fr = L ? L.fin : { x0: band.x0, x1: band.x1, y0: band.y0, y1: band.y1 - 150 }

      // arrival: wider, higher and further round to the right (the stage
      // with the house still up), craning down onto the guitar
      wideBox.c.set(s.c.x - 0.8, s.c.y + 0.4, s.c.z - 1.2)
      wideBox.hw = s.hw * 2.4
      wideBox.hh = s.hh * 1.35
      tightBox.c.set(s.c.x, s.c.y + 0.12, s.c.z)
      tightBox.hw = s.hw
      tightBox.hh = s.hh * 0.97
      // the finale: the whole empty stage (landscape: the amp too)
      if (stack) {
        endBox.c.set(s.c.x - 0.4, s.c.y - 0.8, s.c.z - 0.6)
        endBox.hw = s.hw * 1.35
        endBox.hh = s.hh * 1.18
      } else {
        endBox.c.set(-2.4, s.c.y - 0.9, -3.6)
        endBox.hw = 6.2
        endBox.hh = s.hh * 1.2
      }
      fit(A, aspect, fov, wideBox, toRect(band, W, H), 15, stack ? 0.55 : 0.78)
      fit(S1, aspect, fov, s, toRect(art, W, H), 5, stack ? 0.34 : 0.44)
      fit(S2, aspect, fov, tightBox, toRect(art, W, H), 3.5, stack ? 0.22 : 0.28)
      fit(F, aspect, fov, endBox, toRect(fr, W, H), stack ? 13 : 17, stack ? 0.16 : 0.2)
      if (local < 0.28) mix(OUT, A, S1, ease.inOutCubic(segment(local, 0.02, 0.28)))
      else if (local < 0.86) mix(OUT, S1, S2, ease.inOutQuad(segment(local, 0.28, 0.86)))
      else mix(OUT, S2, F, ease.inOutCubic(segment(local, 0.86, 0.985)))
      out.position.copy(OUT.pos)
      out.target.copy(OUT.tgt)
      out.fov = OUT.fov
      out.roll = 0
      // the closing frame holds still
      out.parallax = 0.16 * (1 - smoothstep(0.86, 0.96, local))
    },
  }
}
