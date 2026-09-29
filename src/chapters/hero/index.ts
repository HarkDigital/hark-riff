import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, reveal, rise, setRise } from '../../core/dom'
import { BRAND, MICROCOPY } from '../../content'
import { clamp, lerp, segment, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { whenRevealed } from '../../kit/images'
import { SCALE, bodyOutline, buildGuitar, type Guitar } from '../../kit/guitar'
import { Ring } from '../../kit/strings'
import { buildAmp, type Amp } from '../../kit/amp'
import { cable, gaffer, stageFloor } from '../../kit/stage'
import { chrome, nickel } from '../../kit/materials'
import { GEL } from '../../world/World'
import { buildStand } from './stand'
import './hero.css'

/*
 * HERO · "Soundcheck" — a dark stage between songs, one guitar on its stand.
 *
 *   0.00–0.17 LANDING: the follow spot on the HEADSTOCK, macro — the pearl
 *             Hark mark where a maker's logo would be, keystone tuners, the
 *             nut, the strings running down out of frame. Eyebrow, the h1
 *             (BRAND.tagline) and the scroll hint. The loader match-cuts onto
 *             the pearl mark (--hark-mark-x/-y/-size, published below).
 *   0.17–0.47 THE CRANE: the camera travels DOWN the neck like a hand
 *             changing position — it swings in close and to the treble side,
 *             so the frets and pearl inlays slide past at a grazing angle and
 *             the strings throw hairline shadows on the rosewood under the
 *             spot (which tracks the camera's point of interest). The
 *             tagline leaves as the move starts.
 *   0.47–0.56 THE FIRST CHORD: a hold over the pickups. Crossing 0.50 strums
 *             all six strings bass → treble (40 ms apart, rate-limited by
 *             TIME), their envelopes blur, one THUMP (glitch 0.35, once), a
 *             moment of rolling-shutter waves (not under reduced motion) —
 *             and the stage comes up: gel beams through the haze, amber/red
 *             rims, truss bokeh, the head's tubes warm and its jewel lamp
 *             lights. No white flash: every level is a monotone ramp on local.
 *   0.56–0.72 THE PULL-BACK to the hero shot: the whole guitar on its stand
 *             in front of the backline (a 4x12 and a head, its tubes glowing,
 *             the cable from the guitar's jack taped down across the planks
 *             and up to the head's input). The strings ring on (Ring decays).
 *   0.66–0.935 PAYOFF copy: the locale, BRAND.manifesto as the lede, the two
 *             CTAs (See the work → land('work'), Start a project → contact).
 *   0.94–1.00 OUT: a push toward the cab's grille (lit) for the cab cut.
 *
 * Framing is computed per layout: each key pose is (pivot, yaw, pitch,
 * distance, screen offset, fov, roll); distances fit the subject into the
 * screen area the copy leaves free (measured from the DOM on resize and once
 * a second), and the pivot is placed at that area's centre. Between keys the
 * pose PARAMETERS are interpolated, so the camera travels on true arcs.
 */

/** the guitar leans back on its stand (radians from vertical) */
const LEAN = 0.23
/** height of the body's bottom edge above the planks */
const BOT_Y = 1.5
/** guitar-local x where the neck rests in the stand's yoke (~ the 4th fret) */
const YOKE_X = 4.62
/** the backline: a 4x12 with a head on it, behind and right of the stand */
const STACK = { x: 7.6, z: -8.8, yaw: -0.2 }

/** the story, by local */
const B = { hold: 0.17, chord: 0.47, strum: 0.5, pull: 0.56, pay: 0.72, out: 0.94 }
/** copy windows */
const HEAD_OUT = 0.2
/** landscape copy sits left of the pull-back; portrait plates wait until it has settled */
const PAY_IN = 0.66
const PAY_IN_PORTRAIT = 0.7
const PAY_OUT = 0.935

type Pose = { p: THREE.Vector3; th: number; ph: number; d: number; nx: number; ny: number; fov: number; roll: number }
const pose = (): Pose => ({ p: new THREE.Vector3(), th: 0, ph: 0, d: 10, nx: 0, ny: 0, fov: 30, roll: 0 })
const copyPose = (o: Pose, a: Pose) => {
  o.p.copy(a.p)
  o.th = a.th
  o.ph = a.ph
  o.d = a.d
  o.nx = a.nx
  o.ny = a.ny
  o.fov = a.fov
  o.roll = a.roll
  return o
}

const easeSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t))

/** a 0..1 level that follows an on/off target over TIME (copy fades that never park half-way) */
class Fader {
  v = 0
  constructor(
    private up = 0.45,
    private down = 0.32,
  ) {}
  set(x: number) {
    this.v = x
  }
  update(on: boolean, dt: number) {
    const t = on ? 1 : 0
    const r = dt / (on ? this.up : this.down)
    this.v = t > this.v ? Math.min(t, this.v + r) : Math.max(t, this.v - r)
    return this.v * this.v * (3 - 2 * this.v)
  }
  get busy() {
    return this.v > 0.0005 && this.v < 0.9995
  }
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let g: Guitar
  let head: Amp
  let cab: Amp
  let tubeLight: THREE.PointLight
  const rig = new THREE.Group()

  // world points of interest (filled in init)
  const W = {
    mark: new THREE.Vector3(),
    headstock: new THREE.Vector3(),
    chord: new THREE.Vector3(),
    body: new THREE.Vector3(),
    whole: new THREE.Vector3(),
    grille: new THREE.Vector3(),
    tubes: new THREE.Vector3(),
  }
  const markCorners: THREE.Vector3[] = []

  // strings: one Ring per string, a strum = six strikes 40 ms apart
  const rings = Array.from({ length: 6 }, () => new Ring(2.6, 0.35))
  const STRUM_AMP = [0.021, 0.02, 0.018, 0.015, 0.013, 0.011]
  let strumAt = -1e9
  let thumpAt = -1e9

  // copy
  let stage: HTMLElement
  let land: HTMLElement
  let headBlock: HTMLElement
  let hint: HTMLElement
  let title: HTMLElement
  let pay: HTMLElement
  let payInner: HTMLElement
  const headFade = new Fader(0.45, 0.32)
  const payFade = new Fader(0.5, 0.32)
  let snapCopy = true
  let lastLocal = NaN
  let revealed = false
  let portrait: boolean | null = null
  let short = false
  let dy = 12

  /** the free screen space the copy leaves (CSS px), measured from the DOM */
  const lay = { w: 0, h: 0, at: -1, safeT: 96, safeB: 804, landR: 620, payR: 480, headB: 300, footT: 700, payT: 560 }
  const K = { land: pose(), land2: pose(), chord: pose(), chord2: pose(), pay: pose(), pay2: pose(), out: pose() }
  let posesKey = ''
  let markKey = ''
  const cur = pose()

  const UP = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const right = new THREE.Vector3()
  const camUp = new THREE.Vector3()
  const tv3 = new THREE.Vector3()
  const probe = new THREE.PerspectiveCamera(30, 1, 0.1, 400)
  const probeT = new THREE.Vector3()

  /** camera position / target for a pose (target shifted so the pivot lands at NDC (nx, ny)) */
  function place(o: Pose, aspect: number, outP: THREE.Vector3, outT: THREE.Vector3) {
    const cp = Math.cos(o.ph)
    dir.set(Math.sin(o.th) * cp, Math.sin(o.ph), Math.cos(o.th) * cp)
    fwd.copy(dir).negate()
    right.crossVectors(fwd, UP).normalize()
    camUp.crossVectors(right, fwd)
    const tv = Math.tan((o.fov * Math.PI) / 360)
    outT.copy(o.p)
      .addScaledVector(right, -o.nx * o.d * tv * aspect)
      .addScaledVector(camUp, -o.ny * o.d * tv)
    outP.copy(outT).addScaledVector(dir, o.d)
  }

  /** distance that fits a subject of world size (h × w) into a screen fraction (fh × fw) */
  function fitD(h: number, w: number, fh: number, fw: number, fov: number, aspect: number) {
    const tv = Math.tan((fov * Math.PI) / 360)
    return Math.max(h / (2 * tv * Math.max(0.05, fh)), w / (2 * tv * aspect * Math.max(0.05, fw)))
  }

  function poses(frame: Frame) {
    const w = Math.max(1, frame.width)
    const h = Math.max(1, frame.height)
    const key = `${w}x${h}:${lay.safeT}:${lay.safeB}:${lay.landR}:${lay.payR}:${lay.headB}:${lay.footT}:${lay.payT}:${portrait}:${short}`
    if (key === posesKey) return K
    posesKey = key
    const a = w / h
    const gut = Math.min(48, Math.max(16, w * 0.034))
    const set = (o: Pose, p: THREE.Vector3, th: number, ph: number, fov: number, roll = 0) => {
      o.p.copy(p)
      o.th = th
      o.ph = ph
      o.fov = fov
      o.roll = roll
      return o
    }
    // a screen box (CSS px) → its NDC centre and its share of the screen
    const box = (x0: number, x1: number, y0: number, y1: number) => ({
      nx: ((x0 + x1) / w) - 1,
      ny: 1 - (y0 + y1) / h,
      fw: Math.max(0.05, (x1 - x0) / w),
      fh: Math.max(0.05, (y1 - y0) / h),
    })
    if (!portrait) {
      // LANDING: the headstock macro, right of the copy
      const l0 = Math.min(w * 0.62, lay.landR + (short ? 20 : 40))
      const fl = box(l0, w - gut, lay.safeT, lay.safeB)
      set(K.land, W.headstock, 0.42, -0.1, 32)
      K.land.d = fitD(2.5, 1.9, fl.fh * (short ? 1.12 : 1.02), fl.fw * 0.92, 30, a)
      K.land.nx = fl.nx
      K.land.ny = fl.ny - 0.03
      // THE CHORD: over the pickups, close, the strings slanting across
      set(K.chord, W.chord, 0.62, 0.3, 32, -0.12)
      K.chord.d = fitD(2.2, 2.2, 0.9, 0.62, 32, a)
      K.chord.nx = 0.1
      K.chord.ny = 0
      // PAYOFF: the whole guitar on its stand, the stack behind, right of the copy
      const p0 = Math.min(w * 0.58, lay.payR + (short ? 16 : 36))
      const fp = box(p0, w - gut, lay.safeT, lay.safeB)
      set(K.pay, W.whole, -0.4, 0.04, 30)
      K.pay.d = fitD(11.3, 6.2, fp.fh * (short ? 1.06 : 0.98), fp.fw * 0.88, 30, a)
      K.pay.nx = fp.nx - 0.02
      K.pay.ny = fp.ny - 0.02
    } else {
      // portrait: the headstock between the title plate and the hint
      const fl = box(0, w, lay.headB + 8, lay.footT - 8)
      set(K.land, W.headstock, 0.36, -0.08, 36)
      K.land.d = fitD(2.45, 1.75, fl.fh * 1.02, 0.94, 36, a)
      K.land.nx = 0
      K.land.ny = fl.ny
      set(K.chord, W.chord, 0.5, 0.32, 38, -0.08)
      K.chord.d = fitD(2.2, 1.9, 0.62, 0.95, 38, a)
      K.chord.nx = 0
      K.chord.ny = 0.12
      // the guitar small and centred above the payoff plate
      const fp = box(0, w, lay.safeT, lay.payT - 10)
      set(K.pay, W.whole, -0.32, 0.04, 36)
      K.pay.d = fitD(11.4, 7.0, fp.fh * 0.98, 0.95, 36, a)
      K.pay.nx = 0.02
      K.pay.ny = fp.ny
    }
    copyPose(K.land2, K.land)
    K.land2.d *= 0.955
    K.land2.th += 0.05
    copyPose(K.chord2, K.chord)
    K.chord2.d *= 0.93
    K.chord2.th += 0.04
    copyPose(K.pay2, K.pay)
    K.pay2.d *= 0.965
    K.pay2.th += 0.07
    // OUT: a push toward the cab's grille, the frame full of lit cloth
    set(K.out, W.grille, -0.12, 0.04, portrait ? 40 : 34)
    K.out.d = portrait ? 9 : 7.5
    K.out.nx = 0
    K.out.ny = 0
    return K
  }

  function mixPose(a: Pose, b: Pose, k: number, out: Pose) {
    out.p.lerpVectors(a.p, b.p, k)
    out.th = lerp(a.th, b.th, k)
    out.ph = lerp(a.ph, b.ph, k)
    out.d = Math.exp(lerp(Math.log(a.d), Math.log(b.d), k))
    out.nx = lerp(a.nx, b.nx, k)
    out.ny = lerp(a.ny, b.ny, k)
    out.fov = lerp(a.fov, b.fov, k)
    out.roll = lerp(a.roll, b.roll, k)
    return out
  }

  /** the camera's pose along the story (no allocation) */
  function poseAt(local: number, P: typeof K, out: Pose) {
    if (local < B.hold) return mixPose(P.land, P.land2, segment(local, 0, B.hold), out)
    if (local < B.chord) {
      // the crane: down the neck, swinging in close and round to the treble side
      const e = easeSine(segment(local, B.hold, B.chord))
      mixPose(P.land2, P.chord, e, out)
      // mid-way the camera rides above the neck looking DOWN the board: the
      // frets and pearl inlays recede toward the body and slide up past the lens
      const bump = Math.sin(Math.PI * e)
      out.d *= 1 - 0.5 * bump
      out.th += 0.22 * bump
      out.ph += 0.62 * bump
      // a dutch angle mid-move: the board crosses the frame on a diagonal
      out.roll -= (portrait ? 0.14 : 0.36) * bump
      // the subject drifts to centre as soon as the tagline has gone
      out.nx = lerp(P.land2.nx, P.chord.nx, easeSine(segment(local, B.hold, B.hold + (B.chord - B.hold) * 0.45)))
      return out
    }
    if (local < B.pull) return mixPose(P.chord, P.chord2, segment(local, B.chord, B.pull), out)
    if (local < B.pay) {
      const e = easeSine(segment(local, B.pull, B.pay))
      mixPose(P.chord2, P.pay, e, out)
      // lift a little on the way out (a crane, not a dolly)
      out.ph += 0.1 * Math.sin(Math.PI * e)
      return out
    }
    if (local < B.out) return mixPose(P.pay, P.pay2, segment(local, B.pay, B.out), out)
    // the push: the aim swings onto the grille first (clear of the guitar), then the dolly
    const e = segment(local, B.out, 1)
    mixPose(P.pay2, P.out, e * e * (3 - 2 * e), out)
    out.p.lerpVectors(P.pay2.p, P.out.p, 1 - (1 - e) * (1 - e) * (1 - e))
    out.nx = lerp(P.pay2.nx, P.out.nx, 1 - (1 - e) * (1 - e))
    return out
  }

  function offsetBox(n: HTMLElement) {
    let x = 0
    let y = 0
    for (let e: HTMLElement | null = n; e && e !== stage && e !== document.body; e = e.offsetParent as HTMLElement | null) {
      x += e.offsetLeft
      y += e.offsetTop
    }
    return { l: x, t: y, r: x + n.offsetWidth, b: y + n.offsetHeight }
  }

  function measure(frame: Frame) {
    lay.w = frame.width
    lay.h = frame.height
    lay.at = performance.now()
    if (!land || !land.offsetParent) return
    const lb = offsetBox(land)
    if (lb.b - lb.t > 40) {
      lay.safeT = lb.t
      lay.safeB = lb.b
    }
    // the right edge of what's written (words, not column boxes)
    let r = 0
    for (const wd of title.querySelectorAll<HTMLElement>('.rise-w')) r = Math.max(r, offsetBox(wd).r)
    for (const c of Array.from(headBlock.children) as HTMLElement[]) if (c !== title) r = Math.max(r, offsetBox(c.firstElementChild as HTMLElement ?? c).r)
    r = Math.max(r, offsetBox(hint.firstElementChild as HTMLElement ?? hint).r)
    if (r > 0) lay.landR = r
    let pr = 0
    for (const c of Array.from(payInner.children) as HTMLElement[]) pr = Math.max(pr, offsetBox(c).r)
    if (pr > 0) lay.payR = pr
    lay.headB = offsetBox(headBlock).b
    lay.footT = offsetBox(hint).t
    lay.payT = offsetBox(payInner).t
  }

  /** the mark's landing-frame screen rect → CSS vars for the loader's match cut */
  function publishMark(frame: Frame) {
    const P = poses(frame)
    if (markKey === posesKey || !markCorners.length) return
    markKey = posesKey
    const w = frame.width
    const h = frame.height
    const aspect = w / Math.max(1, h)
    poseAt(0, P, cur)
    probe.fov = cur.fov
    probe.aspect = aspect
    probe.updateProjectionMatrix()
    place(cur, aspect, probe.position, probeT)
    probe.up.set(0, 1, 0)
    probe.lookAt(probeT)
    probe.updateMatrixWorld()
    const px = (v: THREE.Vector3) => {
      tv3.copy(v).project(probe)
      return [(tv3.x * 0.5 + 0.5) * w, (0.5 - tv3.y * 0.5) * h]
    }
    // markCorners: centre, then the midpoints of the viewBox's left/right/top/bottom edges
    const [cx, cy] = px(markCorners[0])
    const [lx, ly] = px(markCorners[1])
    const [rx, ry] = px(markCorners[2])
    const [tx, ty] = px(markCorners[3])
    const [bx, by] = px(markCorners[4])
    const size = (Math.hypot(rx - lx, ry - ly) + Math.hypot(bx - tx, by - ty)) / 2
    if (!Number.isFinite(cx + cy + size)) return
    const st = document.documentElement.style
    st.setProperty('--hark-mark-x', `${cx.toFixed(1)}px`)
    st.setProperty('--hark-mark-y', `${cy.toFixed(1)}px`)
    st.setProperty('--hark-mark-size', `${size.toFixed(1)}px`)
  }

  /* ------------------------------------------------------------------ build */

  function buildScene(ctx: ChapterContext) {
    // the guitar: neck up, face to the house, leaning back on its stand
    g = buildGuitar({ mobile: ctx.mobile })
    g.group.rotation.z = Math.PI / 2
    rig.rotation.x = -LEAN
    rig.add(g.group)
    group.add(rig)
    rig.updateMatrixWorld(true)
    const foot = new THREE.Vector3(-1.86, 0, -0.23).applyMatrix4(g.group.matrixWorld)
    rig.position.set(-foot.x, BOT_Y - foot.y, -foot.z)
    rig.updateMatrixWorld(true)
    const G = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x, y, z).applyMatrix4(g.group.matrixWorld)

    // points of interest
    g.parts.headstock.updateMatrixWorld(true)
    g.parts.headstock.localToWorld(W.headstock.set(0.98, 0, 0.02))
    g.parts.logo.updateMatrixWorld(true)
    g.parts.logo.getWorldPosition(W.mark)
    // the mark's viewBox (1 × 1 in the logo mesh's own space): centre + edge midpoints
    for (const [x, y] of [
      [0, 0],
      [-0.5, 0],
      [0.5, 0],
      [0, 0.5],
      [0, -0.5],
    ])
      markCorners.push(g.parts.logo.localToWorld(new THREE.Vector3(x, y, 0)))
    // the chord frame: the neck joint — the last frets and the neck pickup, where the strings swing widest
    G(2.25, 0, 0.3, W.chord)
    G(0.4, 0, -0.1, W.body)
    // the whole guitar + stand (floor to the headstock tip), a touch forward
    W.whole.set(0.35, 0, -0.9)
    W.whole.y = (0 + G(SCALE + 2.0, 0, 0).y) / 2 - 0.1

    return G
  }

  function buildStage(ctx: ChapterContext, G: (x: number, y: number, z: number, out?: THREE.Vector3) => THREE.Vector3) {
    // the planks
    const floor = stageFloor(240, 180)
    floor.position.set(0, 0, -30)
    group.add(floor)
    // the planks fall away into the dark past the backline (no horizon line)
    const fm = floor.material as THREE.MeshStandardMaterial
    fm.transparent = true
    fm.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFloorW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFloorW;')
        .replace(
          '#include <dithering_fragment>',
          `float floorR = length((vFloorW.xz - vec2(2.5, -3.5)) * vec2(0.75, 1.0));
          gl_FragColor.rgb *= 1.0 - 0.7 * smoothstep(8.0, 30.0, floorR);
          // near the horizon the planks thin into the haze: fade by the angle
          // below the eye line (a soft band in screen space at any distance)
          vec3 floorV = vFloorW - cameraPosition;
          float floorDep = -floorV.y / max(length(floorV.xz), 0.001);
          float floorKeep = 1.0 - smoothstep(9.0, 22.0, floorR);
          gl_FragColor.a *= max(floorKeep, smoothstep(0.02, 0.2, floorDep));
          #include <dithering_fragment>`,
        )
    }

    // the stand, fitted to the guitar
    const stand = buildStand(g.group.matrixWorld, { yokeX: YOKE_X })
    group.add(stand.group)

    // the backline: a 4x12 with a head on top, turned a touch toward centre
    const stack = new THREE.Group()
    stack.position.set(STACK.x, 0, STACK.z)
    stack.rotation.y = STACK.yaw
    cab = buildAmp({ kind: 'cab' })
    head = buildAmp({ kind: 'head', tubes: 4 })
    head.group.position.y = cab.size.y
    stack.add(cab.group, head.group)
    group.add(stack)
    stack.updateMatrixWorld(true)
    cab.group.localToWorld(W.grille.set(0.6, cab.size.y * 0.42, cab.size.z / 2))
    head.group.localToWorld(W.tubes.set(-head.size.x / 2 + 1.3 + 1.5 * 0.62, head.size.y + 0.6, -head.size.z / 2 + 0.6))

    // the tubes' own warm light on the head and the cab top (intensity only; never toggled)
    tubeLight = new THREE.PointLight('#ff7a2a', 0, 0, 2)
    tubeLight.position.copy(W.tubes)
    group.add(tubeLight)

    /* ---- the guitar's output jack (lower bout, treble side) with a plug in it ---- */
    const outline = bodyOutline()
    let ji = 0
    let best = Infinity
    for (let i = 0; i < outline.length; i++) {
      const d = outline[i].distanceToSquared(new THREE.Vector2(-1.25, -1.5))
      if (d < best) {
        best = d
        ji = i
      }
    }
    const a0 = outline[(ji - 2 + outline.length) % outline.length]
    const a1 = outline[(ji + 2) % outline.length]
    // outward normal of a counter-clockwise outline: (dy, -dx)
    const n2 = new THREE.Vector2(a1.y - a0.y, -(a1.x - a0.x)).normalize()
    const J = outline[ji]
    const jz = -0.23
    const nrm = new THREE.Vector3(n2.x, n2.y, 0)
    const plug = new THREE.Group()
    const nick = nickel(0.22)
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 16), chrome(0.12))
    ferrule.position.y = 0.02
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.064, 0.42, 16), nick)
    barrel.position.y = 0.26
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.05, 16), nick)
    collar.position.y = 0.46
    const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.05, 0.3, 12), new THREE.MeshStandardMaterial({ color: '#141212', roughness: 0.6 }))
    relief.position.y = 0.62
    plug.add(ferrule, barrel, collar, relief)
    plug.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm)
    plug.position.set(J.x, J.y, jz)
    barrel.castShadow = true
    g.group.add(plug)
    const out0 = G(J.x + nrm.x * 0.78, J.y + nrm.y * 0.78, jz)
    const out1 = G(J.x + nrm.x * 1.02, J.y + nrm.y * 1.02, jz)

    /* ---- the head's input jack (left end of the panel) with a plug in it ---- */
    const hp = head.size
    const inLocal = new THREE.Vector3(-hp.x / 2 + 0.44, hp.y - 0.2 - (hp.y * 0.46 - 0.12) / 2 + 0.02, hp.z / 2)
    const inPlug = new THREE.Group()
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 6), chrome(0.12))
    nut.position.y = 0.02
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.064, 0.4, 16), nick)
    b2.position.y = 0.24
    const r2 = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.05, 0.28, 12), relief.material)
    r2.position.y = 0.58
    inPlug.add(nut, b2, r2)
    inPlug.rotation.x = Math.PI / 2
    inPlug.position.copy(inLocal)
    head.group.add(inPlug)
    stack.updateMatrixWorld(true)
    const hin0 = head.group.localToWorld(inLocal.clone().add(new THREE.Vector3(0, 0, 0.72)))
    const hin1 = head.group.localToWorld(inLocal.clone().add(new THREE.Vector3(-0.1, -0.35, 1.05)))
    const cabFL = cab.group.localToWorld(new THREE.Vector3(-cab.size.x / 2 - 0.25, 0, cab.size.z / 2 + 0.2))

    /* ---- the cable: out of the jack, down to the planks, taped down, up to the head ---- */
    const F = 0.036
    const route = [
      out0,
      out1,
      new THREE.Vector3(out1.x + 0.5, out1.y * 0.45, out1.z + 0.35),
      new THREE.Vector3(out1.x + 0.9, F, out1.z + 0.9),
      new THREE.Vector3(out1.x + 2.2, F, out1.z + 0.4),
      new THREE.Vector3(out1.x + 2.3, F, out1.z - 1.8),
      new THREE.Vector3(cabFL.x + 0.2, F, cabFL.z + 1.4),
      new THREE.Vector3(cabFL.x, 0.12, cabFL.z + 0.2),
      new THREE.Vector3(cabFL.x - 0.05, 3.6, cabFL.z + 0.05),
      new THREE.Vector3(cabFL.x + 0.05, hin1.y - 1.2, hin1.z + 0.1),
      hin1,
      hin0,
    ]
    const cord = cable(route, 0.034)
    group.add(cord)
    // gaffer tape holding the cable down where it crosses the stage
    const tape = (x: number, z: number, rot: number, len = 0.9, color = '#161514') => {
      const t = gaffer(len, 0.4, color)
      t.position.set(x, 0.004, z)
      t.rotation.z = rot
      group.add(t)
      return t
    }
    // a strip laid ACROSS the cable where it crosses the planks, arched over it
    {
      const a = route[5]
      const b = route[6]
      const tp = a.clone().lerp(b, 0.35)
      const across = Math.atan2(-(b.z - a.z), b.x - a.x) + Math.PI / 2
      const over = tape(tp.x, tp.z, across)
      const geo = new THREE.PlaneGeometry(0.9, 0.4, 40, 1)
      const p = geo.attributes.position
      for (let i = 0; i < p.count; i++) p.setZ(i, (F + 0.036) * (1 - smoothstep(0.03, 0.14, Math.abs(p.getX(i)))))
      geo.computeVertexNormals()
      over.geometry.dispose()
      over.geometry = geo
    }
    // spike marks: where the stand lives (cream gaffer, a T at each foot)
    for (const [x, z, r] of [
      [-1.3, 1.25, 0.1],
      [1.35, 1.2, -0.08],
    ]) {
      tape(x, z, r, 0.62, '#8f8574')
      tape(x + 0.02, z + 0.26, r + Math.PI / 2, 0.44, '#8f8574')
    }
    void ctx
  }

  /* ------------------------------------------------------------------ DOM */

  function buildCopy(ctx: ChapterContext) {
    stage = ctx.stage
    // LANDING: eyebrow + the h1, the scroll hint at the foot of the column
    land = el('div', 'hero-land', undefined, ctx.stage)
    headBlock = el('div', 'hero-head', undefined, land)
    const eyebrow = el('p', 'hud-eyebrow hero-eyebrow', undefined, headBlock)
    const eb = el('span', 'hero-eyebrow-text', undefined, eyebrow)
    MICROCOPY.signalEyebrow.split(' · ').forEach((part, i) => {
      if (i) eb.append(' · ')
      el('span', 'hero-nowrap', part, eb)
    })
    title = rise(el('h1', 'hud-title hero-title', undefined, headBlock), BRAND.tagline.replace(/(\S+)$/, '<em>$1</em>'))
    hint = el('p', 'hud-label hero-hint', undefined, land)
    const hintInner = el('span', 'hero-hint-inner', undefined, hint)
    el('span', 'hero-hint-string', undefined, hintInner)
    el('span', 'hero-hint-text', `${MICROCOPY.scrollHint} ↓`, hintInner)

    // PAYOFF: the locale, the manifesto as the lede, the two CTAs
    pay = el('div', 'hero-pay', undefined, ctx.stage)
    payInner = el('div', 'hero-pay-inner', undefined, pay)
    const loc = el('span', 'hero-eyebrow-text', undefined, el('p', 'hud-eyebrow hero-locale', undefined, payInner))
    BRAND.locale.split(' · ').forEach((part, i) => {
      if (i) loc.append(' · ')
      el('span', 'hero-nowrap', part, loc)
    })
    el('p', 'hero-lede', BRAND.manifesto, payInner)
    const ctas = el('div', 'hero-ctas', undefined, payInner)
    const see = el('button', 'hud-btn', 'See the work', ctas)
    see.type = 'button'
    see.addEventListener('click', () => window.__hark?.land('work'))
    const start = el('a', 'hud-btn hud-btn--ghost', 'Start a project', ctas)
    start.href = '#contact'
    start.addEventListener('click', e => {
      if (!window.__hark) return
      e.preventDefault()
      window.__hark.land('contact')
    })
  }

  return {
    id: 'hero',
    group,
    // the CTAs (copy-layer item 0): the settled payoff
    anchors: [0.8],
    busy: () => headFade.busy || payFade.busy || !revealed,

    async init(ctx) {
      whenRevealed().then(() => (revealed = true))
      const G = buildScene(ctx)
      await nextFrame()
      buildStage(ctx, G)
      await nextFrame()
      buildCopy(ctx)
    },

    onEnter(ctx) {
      snapCopy = true
      lastLocal = NaN
      // the spot hangs ~22 units off whatever it lights: fit its shadow depth
      // range to that throw (0.5–80 leaves the strings' 3 mm lift inside the
      // bias — no hairline shadows); restored on leave
      const sh = ctx.world.spot.shadow
      sh.camera.near = 9
      sh.camera.far = 44
      sh.camera.updateProjectionMatrix()
      sh.bias = -0.00025
    },

    onLeave(ctx) {
      const sh = ctx.world.spot.shadow
      sh.camera.near = 0.5
      sh.camera.far = 80
      sh.camera.updateProjectionMatrix()
      sh.bias = -0.0004
    },

    update(local, frame, ctx) {
      const lc = clamp(local)
      // layout: the same test as the CSS (max-aspect-ratio: 1/1 → portrait)
      const p = frame.height >= frame.width
      const s = !p && frame.height <= 500
      if (p !== portrait || s !== short) {
        portrait = p
        short = s
        posesKey = ''
        // portrait plates sit against the chrome bands: fade in place, never slide into them
        dy = p ? 0 : 12
      }
      if (frame.width !== lay.w || frame.height !== lay.h || performance.now() - lay.at > 1000) measure(frame)
      publishMark(frame)
      poseAt(lc, poses(frame), cur)

      const calm = frame.reducedMotion || !!frame.still
      const now = frame.time
      const teleport = !Number.isFinite(lastLocal) || Math.abs(lc - lastLocal) > 0.12

      /* ---- the first chord: a strum on crossing B.strum going forward (rate-limited by TIME) ---- */
      if (revealed && !frame.still && Number.isFinite(lastLocal) && lastLocal < B.strum && lc >= B.strum && now - strumAt > 1.4) {
        strumAt = now
        for (let i = 0; i < 6; i++) rings[i].strike(now + i * 0.04, 1 - i * 0.04)
        if (!teleport) thumpAt = now
        window.dispatchEvent(new CustomEvent('hark:strum', { detail: { level: teleport ? 0.6 : 1 } }))
      }

      // the stage comes up with the chord (monotone ramps on local; the world damps them)
      const up = smoothstep(0.495, 0.6, lc)
      const tubes = smoothstep(0.5, 0.64, lc)
      const pilot = smoothstep(0.495, 0.53, lc)
      head.setTubes(tubes)
      head.setPilot(pilot)
      head.setKnob(0, 0.62)
      head.setKnob(1, 0.55)
      head.setKnob(2, 0.7)
      head.setKnob(3, 0.66)
      head.setKnob(4, 0.82)
      head.setKnob(5, 0.4)
      tubeLight.intensity = tubes * 1.4

      /* ---- strings ---- */
      const st = g.strings
      for (let i = 0; i < 6; i++) {
        let a = rings[i].value(now) * STRUM_AMP[i]
        if (frame.still) a = Math.max(a, up * 0.0022 * (1 - i * 0.08))
        else if (up > 0) a += up * (0.0007 + 0.0005 * (0.5 + 0.5 * Math.sin(now * 0.9 + i * 1.7)))
        st.amp[i] = a
      }
      // a moment of rolling-shutter waves after the attack (the strings bend
      // into travelling waves like a phone filming a guitar), then the blur again
      const ts = now - strumAt
      const wob = calm ? 0 : smoothstep(0.3, 0.6, ts) * (1 - smoothstep(1.35, 2.0, ts))
      st.wobble = wob
      // the waves read at ~2.4x the swing (a crisp line needs more travel than a blur)
      if (wob > 0) for (let i = 0; i < 6; i++) st.amp[i] *= 1 + 1.4 * wob
      st.tint.set('#e8e2d6')
      st.light.set(GEL.tungsten).multiplyScalar(lerp(0.85, 1.05, up))
      g.update(frame, ctx.camera, ctx.renderer)

      /* ---- light ---- */
      const w = ctx.world.params
      // the follow spot rides the camera's point of interest, hung high, front and to the treble side
      const focus = cur.p
      const payK = smoothstep(B.pull, B.pay, lc)
      const outK = smoothstep(B.out, 1, lc)
      // at the payoff the pool opens to take in the front of the stack too
      w.spotAt.copy(focus).add(tv3.set(1.8 * payK * (1 - outK), -0.6 * payK * (1 - outK), -1.2 * payK * (1 - outK)))
      w.spotPos.set(focus.x + 7.5, focus.y + 17, focus.z + 12)
      // footprint radius → cone (distance ~22)
      const radius = lerp(lerp(1.7, 8.6, payK), 6, outK)
      w.spotAngle = Math.atan(radius / 22)
      w.spotPenumbra = lerp(0.55, 0.45, payK)
      w.spot = lerp(1.05, 1.25, up)
      w.spotColor = GEL.tungsten
      w.rimA = lerp(0.35, 1.05, up)
      w.rimAColor = GEL.amber
      w.rimADir.set(-0.85, 0.55, -1)
      w.rimB = lerp(0.12, 0.85, up)
      w.rimBColor = GEL.red
      w.rimBDir.set(0.95, 0.35, -1)
      w.haze = lerp(0.32, 0.9, up)
      w.hazeColor = '#b0582a'
      w.hazeY = lerp(-0.1, -0.22, payK)
      w.beams = lerp(0, 0.78, up)
      w.beamA = GEL.amber
      w.beamB = GEL.red
      w.sway = 0.5
      w.bokeh = lerp(0.24, 0.62, up)
      w.bokehA = GEL.amber
      w.bokehB = GEL.red
      w.fill = lerp(0.05, 0.09, up)
      // the gloss-black headstock reads black (its clearcoat mirrors the rig overhead)
      w.env = lerp(0.72, 1, smoothstep(0.1, 0.35, lc))
      // the PAR row sweeps across the lacquer as the camera travels
      w.envTurn = lerp(-0.5, 0.7, easeSine(segment(lc, 0.05, B.pay))) + 0.2 * outK

      /* ---- post ---- */
      const pp = ctx.post.params
      pp.bloomThreshold = 0.9
      pp.bloomRadius = 0.5
      pp.bloomStrength = lerp(0.32, 0.6, up)
      pp.lift = lerp(0.012, 0.022, up)
      pp.vignette = lerp(0.62, 0.55, up)
      pp.grain = 0.035
      pp.warmth = 1
      const tk = now - thumpAt
      pp.glitch = calm || tk < 0 || tk > 0.6 ? 0 : 0.35 * Math.exp(-tk / 0.11)

      /* ---- copy: each block fades by TIME once the scroll crosses its threshold ---- */
      const snap = snapCopy || teleport
      snapCopy = false
      lastLocal = lc
      const onHead = lc < HEAD_OUT
      const onPay = lc > (portrait ? PAY_IN_PORTRAIT : PAY_IN) && lc < PAY_OUT
      if (snap) {
        headFade.set(onHead ? 1 : 0)
        payFade.set(onPay ? 1 : 0)
      }
      const hl = headFade.update(onHead, frame.dt)
      // a hard stop inside the cut window: a fling never carries the CTAs into the push
      const pl = payFade.update(onPay, frame.dt) * (1 - smoothstep(0.945, 0.965, lc))
      reveal(land, hl, dy)
      setRise(title, revealed && onHead)
      reveal(pay, pl, dy)
    },

    camera(local: number, frame: Frame, out: CameraPose) {
      const P = poses(frame)
      poseAt(clamp(local), P, cur)
      const aspect = frame.width / Math.max(1, frame.height)
      place(cur, aspect, out.position, out.target)
      out.fov = cur.fov
      out.roll = cur.roll
      out.parallax = lerp(0.06, 0.25, smoothstep(B.pull, B.pay, local))
    },
  }
}
