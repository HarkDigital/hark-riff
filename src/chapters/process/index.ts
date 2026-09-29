import * as THREE from 'three'
import type { Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { BRAND, PROCESS, SECTIONS, STATS } from '../../content'
import { clamp, ease, lerp, segment, smoothstep, window01 } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { StoryClock } from '../../kit/pace'
import { bodyOutline, buildGuitar, type Guitar } from '../../kit/guitar'
import { Ring } from '../../kit/strings'
import { buildAmp, type Amp } from '../../kit/amp'
import { stageFloor } from '../../kit/stage'
import { fontsReady } from '../../kit/materials'
import { GEL } from '../../world/World'
import {
  BENCH,
  BLANK,
  buildBench,
  buildBlank,
  buildChisel,
  buildClipTuner,
  buildCradle,
  buildFork,
  buildFretFile,
  buildGafferRoll,
  buildJackPlate,
  buildLamp,
  buildMist,
  buildOutline,
  buildPencil,
  buildPlugCable,
  buildRule,
  buildShavings,
  buildSprayGun,
  type Shavings,
} from './bench'
import './process.css'

/*
 * PROCESS · THE WORKBENCH — "We listen first. Then we build."
 *
 * A luthier's bench at the side of the stage: worn butcher-block maple, a
 * pegboard of tools, an articulated work lamp (the follow spot is its pool).
 * ONE guitar is built on it in Hark's four steps, all derived from `local`
 * (through a StoryClock so a flick of the wheel can't whip the camera):
 *
 *   0.00–0.075  the cab cut opens on the bench under the lamp
 *   0.08–0.30   the headline (SECTIONS.process), held through step 01;
 *               the landing (0.2) shows it with card 01 and the pencil tracing
 *   01 Listen    0.155–0.31  a tuning fork rings on its box; a pencil traces
 *                the body outline onto a bookmatched flame-maple blank
 *   02 Prototype 0.31–0.465  the bandsaw offcut lifts away, the top carves
 *                down into its arch (shavings curl up), the neck slides in dry
 *   03 Build     0.465–0.62  an HVLP gun passes over the body: the sunburst
 *                sprays on behind it (a wipe front in the top's own shader);
 *                the hardware drops into place — pickups, bridge, tailpiece,
 *                knobs, toggle, tuners
 *   04 Support   0.62–0.775  strung up (the strings run out from the bridge),
 *                a clip-on tuner hops onto the headstock and its needle
 *                settles; the cable plugs in, the practice amp's jewel lights,
 *                the strings ring (a time-decaying Ring, rate-limited)
 *   0.775–0.93  the stats (10 years · $1M+ · 15, verbatim) on the guitar's
 *               HANG TAG — real DOM text on a cream tag, its thread tied to a
 *               tuner button
 *   0.93–1.00   the finished guitar stays lit for the cut into the encore
 */

const SHOW = [STATS[0], STATS[2], STATS[1]] // 10 years, $1M+, 15 (srContent order)
const A0 = 0.155
const A1 = 0.775
const SLOT = (A1 - A0) / PROCESS.length
const S = (i: number) => A0 + i * SLOT
const HEAD: [number, number] = [0.08, 0.3]
const TAG: [number, number] = [0.775, 0.93]
/** the clock: local units per second (~1.4 steps a second at most) */
const RATE = 0.22

/* the build's beats (clock-local) */
const B = {
  pickUp: [0.112, 0.162],
  draw: [0.162, 0.292],
  putDown: [0.296, 0.334],
  lift: [0.31, 0.356],
  carve: [0.316, 0.372],
  neck: [0.342, 0.392],
  gunIn: [0.452, 0.482],
  sweep: [0.482, 0.556],
  gunOut: [0.556, 0.588],
  hw: [0.552, 0.612],
  strings: [0.612, 0.646],
  hop: [0.618, 0.646],
  needle: [0.64, 0.676],
  plug: [0.684, 0.704],
} as const
const sg = (q: number, r: readonly [number, number]) => segment(q, r[0], r[1])
/** shavings by the chisel from the start (the rest curl up as the top is carved) */
const EARLY_SHAVINGS = 9

/* ---------------------------------------------------------------- placement */

/** the guitar lies on the bench, neck to the right and a touch toward the back */
const GUITAR = { x: -1.6, z: 0.95, yaw: 0.1 }
const FORK_AT = new THREE.Vector3(-4.9, 0, -1.6)
const AMP_AT = new THREE.Vector3(-8.2, 0, -2.9)
const LAMP = {
  base: new THREE.Vector3(3.4, 0, -4.9),
  elbow: new THREE.Vector3(4.2, 5.4, -4.3),
  head: new THREE.Vector3(1.0, 5.9, -1.9),
}

/* ---------------------------------------------------------------- camera keys */

type Mode = 'head' | 'card' | 'tag'
interface Key {
  /** a named world point (resolved in init) + offset */
  at: keyof Points
  off?: [number, number, number]
  yaw: number
  pitch: number
  w: number
  h: number
  mode: Mode
  /** portrait overrides */
  p?: { at?: keyof Points; off?: [number, number, number]; yaw?: number; pitch?: number; w?: number; h?: number }
}
interface Points {
  est: THREE.Vector3
  blank: THREE.Vector3
  body: THREE.Vector3
  mid: THREE.Vector3
  head: THREE.Vector3
}
const K: Record<string, Key> = {
  est0: { at: 'est', yaw: -22, pitch: 33, w: 13, h: 7.2, mode: 'head', p: { yaw: -66, pitch: 50, w: 7.2, h: 8.2 } },
  est1: { at: 'est', yaw: -17, pitch: 37, w: 11.6, h: 6.6, mode: 'head', p: { yaw: -70, pitch: 54, w: 6.8, h: 7.6 } },
  l1: { at: 'blank', off: [-0.9, 0, -0.5], yaw: -20, pitch: 46, w: 9.0, h: 6.0, mode: 'head', p: { yaw: -74, pitch: 58, w: 5.6, h: 6.6 } },
  l2: { at: 'blank', off: [-0.7, 0, -0.4], yaw: -13, pitch: 49, w: 8.6, h: 5.8, mode: 'head', p: { yaw: -80, pitch: 60, w: 5.4, h: 6.4 } },
  p1: { at: 'mid', off: [-0.6, 0, 0], yaw: -14, pitch: 42, w: 12.6, h: 5.4, mode: 'card', p: { yaw: -84, pitch: 56, w: 5.2, h: 10.4 } },
  p2: { at: 'mid', off: [-0.6, 0, 0], yaw: -7, pitch: 44, w: 12.2, h: 5.2, mode: 'card', p: { yaw: -88, pitch: 58, w: 5.2, h: 10.2 } },
  b1: { at: 'body', off: [0.3, 0, 0], yaw: 6, pitch: 42, w: 8.2, h: 5.8, mode: 'card', p: { yaw: -58, pitch: 50, w: 5.6, h: 6.4 } },
  b2: { at: 'body', off: [0.3, 0, 0], yaw: 14, pitch: 38, w: 8.0, h: 5.6, mode: 'card', p: { yaw: -50, pitch: 47, w: 5.6, h: 6.2 } },
  s1: { at: 'mid', off: [0.3, 0, -0.1], yaw: -3, pitch: 40, w: 13.4, h: 5.4, mode: 'card', p: { yaw: -92, pitch: 56, w: 5.2, h: 10.8 } },
  s2: { at: 'body', off: [1.1, 0, 0.1], yaw: 17, pitch: 35, w: 7.8, h: 4.8, mode: 'card', p: { yaw: -84, pitch: 52, w: 5.0, h: 6.4 } },
  t1: { at: 'head', yaw: -36, pitch: 42, w: 5.6, h: 3.8, mode: 'tag', p: { yaw: -70, pitch: 50, w: 3.8, h: 4.6 } },
  t2: { at: 'head', yaw: -29, pitch: 40, w: 5.4, h: 3.7, mode: 'tag', p: { yaw: -62, pitch: 48, w: 3.8, h: 4.5 } },
}
/** [q, key]: holds (slow linear drifts) alternate with eased moves between steps */
const TRACK: [number, Key][] = [
  [0.0, K.est0],
  [0.1, K.est1],
  [0.175, K.l1],
  [S(1) - 0.045, K.l2],
  [S(1) + 0.05, K.p1],
  [S(2) - 0.045, K.p2],
  [S(2) + 0.05, K.b1],
  [S(3) - 0.045, K.b2],
  [S(3) + 0.045, K.s1],
  [S(4) - 0.03, K.s2],
  [S(4) + 0.05, K.t1],
  [1.0, K.t2],
]
const HOLDS = new Set([0, 2, 4, 6, 8, 10])

interface Resolved {
  t: THREE.Vector3
  yaw: number
  pitch: number
  w: number
  h: number
  cx: number
  cy: number
  fx: number
  fy: number
}
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const DOWN = V(0, -1, 0)
/** where the spray gun parks, out of frame (added to the nozzle) */
const GUN_AWAY = V(-2.6, 5.5, 1.8)
const resolved = (): Resolved => ({ t: V(), yaw: 0, pitch: 0, w: 1, h: 1, cx: 0, cy: 0, fx: 1, fy: 1 })

/**
 * Re-point a guitar material's finish at a spatial SWEEP (the spray gun's
 * wipe front, in body-local x): colour, clearcoat and sheen follow the front.
 * (The kit's clearcoat hook targets a chunk this three.js doesn't have, so
 * the lacquer is scaled here after lights_physical_fragment.) Raw maple is
 * matte and a touch deeper than the kit's so it doesn't clip under the lamp.
 */
function sweepable(mat: THREE.Material, kind: 'top' | 'side', uSweep: { value: number }) {
  const orig = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    orig.call(mat, sh, r)
    sh.uniforms.uSweep = uSweep
    const LIGHTS = '#include <lights_physical_fragment>'
    const ROUGH = '#include <roughnessmap_fragment>'
    if (kind === 'top') {
      const a = 'vec3 base = mix(raw, burst, uFinish);'
      const raw = 'vec3 raw = vec3(0.86, 0.74, 0.56);'
      if (!sh.fragmentShader.includes(a) || !sh.fragmentShader.includes(LIGHTS)) return
      sh.fragmentShader = sh.fragmentShader
        .replace(
          'void main() {',
          `uniform float uSweep;
          float wbSweep() {
            float n = fnoise(vObj.xy * vec2(2.2, 3.1) + 7.0) * 0.42 + fnoise(vObj.xy * vec2(9.0, 7.0)) * 0.16;
            return smoothstep(-0.12, 0.12, uSweep - vObj.x - n + 0.29);
          }
          void main() {`,
        )
        .replace(raw, 'vec3 raw = vec3(0.6, 0.46, 0.3);')
        .replace(a, 'vec3 base = mix(raw, burst, wbSweep());')
        .replace(ROUGH, `${ROUGH}\nroughnessFactor = mix(0.74, roughnessFactor, wbSweep());`)
        .replace(LIGHTS, `${LIGHTS}\nmaterial.clearcoat *= wbSweep();`)
    } else {
      const a = 'diffuseColor.rgb *= mix(mix(raw, uEdgeC, uFinish), uBinding, bind * uFinish);'
      if (!sh.fragmentShader.includes(a) || !sh.fragmentShader.includes(LIGHTS) || !sh.vertexShader.includes('vZ = position.z;')) return
      const S = 'smoothstep(-0.2, 0.2, uSweep - vWbX + 0.2)'
      sh.vertexShader = sh.vertexShader.replace('varying float vZ;', 'varying float vZ;\nvarying float vWbX;').replace('vZ = position.z;', 'vZ = position.z;\nvWbX = position.x;')
      sh.fragmentShader = sh.fragmentShader
        .replace('varying float vZ;', 'varying float vZ;\nvarying float vWbX;\nuniform float uSweep;')
        .replace(a, `float wbS = ${S};\ndiffuseColor.rgb *= mix(mix(raw, uEdgeC, wbS), uBinding, bind * wbS);`)
        .replace(ROUGH, `${ROUGH}\nroughnessFactor = mix(0.72, roughnessFactor, ${S});`)
        .replace(LIGHTS, `${LIGHTS}\nmaterial.clearcoat *= ${S};`)
    }
  }
  mat.customProgramCacheKey = () => `wb-sweep-${kind}`
  mat.needsUpdate = true
}

export default function create(): Chapter {
  const group = new THREE.Group()
  const clock = new StoryClock({ rate: RATE })
  const ring = new Ring(2.2, 0.6)

  // DOM
  let head: HTMLElement
  let title: HTMLElement
  let card: HTMLElement
  let meter: HTMLElement
  const pages: HTMLElement[] = []
  const pageTitles: HTMLElement[] = []
  let tag: HTMLElement
  let svg: SVGSVGElement
  let thread: SVGPathElement
  let shownStep = -1

  // scene
  let g: Guitar
  const pivot = new THREE.Group()
  let blank: THREE.Mesh
  let offcut: THREE.Mesh
  let outline: ReturnType<typeof buildOutline>
  let pencil: ReturnType<typeof buildPencil>
  let fork: ReturnType<typeof buildFork>
  let shavings: Shavings
  let gun: THREE.Group
  let mist: ReturnType<typeof buildMist>
  let tuner: ReturnType<typeof buildClipTuner>
  let amp: Amp
  let plug: THREE.Group
  let cable: THREE.Mesh
  let lampShade: THREE.Object3D | null = null
  let spill: THREE.PointLight
  let runs: THREE.Object3D | null = null
  /** the body's back + side wall (below the carved top): stretched up to the blank's height before the carve */
  const shell: THREE.Mesh[] = []
  const uSweep = { value: -9 }
  const hw: { obj: THREE.Object3D; base: THREE.Vector3; a: number; b: number; h: number }[] = []
  const neckBase = V()
  const headBase = V()
  const pts: Points = { est: V(), blank: V(), body: V(), mid: V(), head: V() }
  const lampBulb = V()
  const tagAnchor = V()
  const plugPose = { seated: new THREE.Matrix4(), rest: new THREE.Matrix4(), n: V() }
  const tunerPose = { on: new THREE.Matrix4(), rest: new THREE.Matrix4(), onP: V(), onQ: new THREE.Quaternion(), restP: V(), restQ: new THREE.Quaternion() }
  const nozzleV = V()
  const targetV = V()
  const cablePath: THREE.Vector3[] = []
  let cableKey = -1

  // pencil poses (guitar-local)
  const pencilRest = { p: V(), q: new THREE.Quaternion() }
  const penP = V()
  const penQ = new THREE.Quaternion()
  const tmpQ = new THREE.Quaternion()
  const tmpV = V()
  const tmpV2 = V()
  const tmpM = new THREE.Matrix4()
  const tmpS = V()
  const Y = V(0, 1, 0)

  // camera
  const pose = { position: V(0, 6, 12), target: V(0, 0, 0), fov: 32, parallax: 0.12 }
  const rA = resolved()
  const rB = resolved()
  const dir = V()
  const fwd = V()
  const vR = V()
  const vU = V()
  const regions = { key: '', headR: 0, headB: 0, cardR: 0, cardT: 0, tagR: 0, tagT: 0, eyeX: 0, eyeY: 0 }

  // time-based: the thump when the plug seats, the ring
  let lastThump = -1e9
  let thumpAt = -1e9
  let plugged = false
  let fresh = true
  let lastLocal = 0

  const gutter = (W: number) => clamp(W * 0.034, 16, 48)
  const bands = (W: number, H: number) =>
    W > H && H <= 500 ? { top: 52, bot: 52 } : { top: clamp(H * 0.105, 80, 112), bot: W <= 560 && H > W ? 96 : clamp(H * 0.105, 82, 110) }

  function measure(frame: Frame) {
    const key = `${frame.width}x${frame.height}`
    if (regions.key === key) return
    regions.key = key
    const hb = head.getBoundingClientRect()
    const cb = card.getBoundingClientRect()
    const tb = tag.getBoundingClientRect()
    regions.headR = hb.right
    regions.headB = hb.bottom
    regions.cardR = cb.right
    regions.cardT = cb.top
    regions.tagR = tb.right
    regions.tagT = tb.top
    regions.eyeX = tb.left + tb.width / 2
    regions.eyeY = tb.top + 17
  }

  function resolve(k: Key, portrait: boolean, frame: Frame, out: Resolved) {
    const W = Math.max(1, frame.width)
    const H = Math.max(1, frame.height)
    const p = portrait && k.p ? k.p : {}
    const at = pts[p.at ?? k.at]
    const off = p.off ?? k.off
    out.t.copy(at)
    if (off) out.t.add(tmpV.set(off[0], off[1], off[2]))
    out.yaw = p.yaw ?? k.yaw
    out.pitch = p.pitch ?? k.pitch
    out.w = p.w ?? k.w
    out.h = p.h ?? k.h
    const gt = gutter(W)
    const b = bands(W, H)
    let x0 = gt * 0.5
    let x1 = W - gt * 0.5
    let y0 = b.top * 0.75
    let y1 = H - b.bot * 0.75
    if (!portrait) {
      const col = k.mode === 'head' ? Math.max(regions.headR, regions.cardR) : k.mode === 'card' ? regions.cardR : regions.tagR
      x0 = col + 28
    } else {
      if (k.mode === 'head') y0 = regions.headB + 6
      y1 = (k.mode === 'tag' ? regions.tagT : regions.cardT) - 8
    }
    if (x1 - x0 < W * 0.3) x0 = x1 - W * 0.3
    if (y1 - y0 < H * 0.18) y0 = y1 - H * 0.18
    out.cx = (x0 + x1) / W - 1
    out.cy = 1 - (y0 + y1) / H
    out.fx = (x1 - x0) / W
    out.fy = (y1 - y0) / H
  }

  function computePose(q: number, frame: Frame) {
    const portrait = frame.height > frame.width
    let i = 0
    while (i < TRACK.length - 2 && q > TRACK[i + 1][0]) i++
    const [a0, ka] = TRACK[i]
    const [a1, kb] = TRACK[i + 1]
    let f = clamp((q - a0) / Math.max(1e-6, a1 - a0))
    f = HOLDS.has(i) ? f : ease.inOutCubic(f)
    resolve(ka, portrait, frame, rA)
    resolve(kb, portrait, frame, rB)
    const L = (a: number, b: number) => a + (b - a) * f
    const yaw = THREE.MathUtils.degToRad(L(rA.yaw, rB.yaw))
    const pitch = THREE.MathUtils.degToRad(L(rA.pitch, rB.pitch))
    const w = L(rA.w, rB.w)
    const h = L(rA.h, rB.h)
    const cx = L(rA.cx, rB.cx)
    const cy = L(rA.cy, rB.cy)
    const fx = L(rA.fx, rB.fx)
    const fy = L(rA.fy, rB.fy)
    const fov = portrait ? 38 : 30
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const tanH = tanV * Math.max(0.2, frame.width / Math.max(1, frame.height))
    const dist = Math.max(w / 2 / (tanH * fx), h / 2 / (tanV * fy))
    dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    fwd.copy(dir).negate()
    vR.crossVectors(fwd, Y).normalize()
    vU.crossVectors(vR, fwd)
    const hw = dist * tanH
    const hh = dist * tanV
    pose.target.lerpVectors(rA.t, rB.t, f).addScaledVector(vR, -cx * hw).addScaledVector(vU, -cy * hh)
    pose.position.copy(pose.target).addScaledVector(dir, dist)
    pose.fov = fov
    pose.parallax = 0.1
  }

  /** local → world for the guitar's space */
  const gw = (x: number, y: number, z: number, out = V()) => g.group.localToWorld(out.set(x, y, z))

  function placePencil(q: number) {
    const pick = ease.inOutCubic(sg(q, B.pickUp))
    const down = ease.inOutCubic(sg(q, B.putDown))
    const draw = sg(q, B.draw)
    // drawing pose at the line's head
    const head = outline.at(draw)
    // leaning back (away from the player) and trailing the stroke, so the lamp catches its paint
    const lean = tmpV.set(-head.t.x * 0.34 + 0.1, -head.t.y * 0.34 + 0.5, 0.66)
    lean.normalize()
    tmpQ.setFromUnitVectors(Y, lean)
    const drawP = tmpV2.copy(head.p)
    const w = down > 0 ? 1 - down : pick
    penP.lerpVectors(pencilRest.p, drawP, w)
    // a small arc while it travels (lifted off the bench / off the blank)
    const hop = Math.sin(Math.PI * (down > 0 ? down : pick)) * 0.9
    penP.z += hop
    penQ.slerpQuaternions(pencilRest.q, tmpQ, w)
    pencil.group.position.copy(penP)
    pencil.group.quaternion.copy(penQ)
  }

  function updateCable(t: number) {
    // quantized so the tube is rebuilt only while the plug actually moves
    const k = Math.round(t * 40)
    if (k === cableKey) return
    cableKey = k
    const e = ease.inOutCubic(t)
    // pose: rest (lying on the bench, 0.75 out) → seated
    const m = tmpM
    const pr = V()
    const qr = new THREE.Quaternion()
    const sr = V()
    const ps = V()
    const qs = new THREE.Quaternion()
    plugPose.rest.decompose(pr, qr, sr)
    plugPose.seated.decompose(ps, qs, sr)
    const lift = smoothstep(0, 0.55, e)
    const push = smoothstep(0.45, 1, e)
    const p = V().copy(pr)
    p.y = lerp(pr.y, ps.y, lift)
    p.x = lerp(pr.x, ps.x, push)
    p.z = lerp(pr.z, ps.z, push)
    const qq = new THREE.Quaternion().slerpQuaternions(qr, qs, lift)
    m.compose(p, qq, V(1, 1, 1))
    plug.matrix.copy(m)
    plug.matrixWorldNeedsUpdate = true
    // the cable leaves the boot, drops to the bench and runs to the amp
    const outDir = V(0, 0, 1).applyQuaternion(qq)
    const a = V(0, 0, 1.22).applyMatrix4(m)
    const b = a.clone().addScaledVector(outDir, 0.55)
    b.y = Math.max(0.05, b.y - 0.12)
    const c = a.clone().addScaledVector(outDir, 1.2)
    c.y = 0.04
    const path = [a, b, c, ...cablePath]
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, false, 'centripetal'), 64, 0.036, 8, false)
    cable.geometry.dispose()
    cable.geometry = geo
  }

  return {
    id: 'process',
    group,
    // the four steps, then the stats (srContent makes the first stat a keyboard stop)
    anchors: [...PROCESS.map((_, i) => S(i) + SLOT * 0.55), 0.855],
    busy: () => clock.busy,
    onEnter() {
      clock.reset()
      fresh = true
      cableKey = -1
    },

    async init(ctx: ChapterContext) {
      const mobile = ctx.mobile

      /* ---------------- the bench, the lamp, the floor below */
      const bench = buildBench(mobile)
      group.add(bench.group)
      const floor = stageFloor(90, 60)
      floor.position.set(0, -BENCH.thick - BENCH.legs, 6)
      group.add(floor)
      await nextFrame()

      /* ---------------- the guitar (built in steps) */
      g = buildGuitar({ mobile })
      g.group.rotation.x = -Math.PI / 2
      g.group.position.y = 0.46
      pivot.position.set(GUITAR.x, 0, GUITAR.z)
      pivot.rotation.y = GUITAR.yaw
      pivot.add(g.group)
      group.add(pivot)
      group.updateMatrixWorld(true)
      const parts = g.parts
      sweepable(parts.top.material as THREE.Material, 'top', uSweep)
      // a hair more satin on the lacquer: the work lamp is close, and a mirror
      // coat turns its reflection into a blown-out glint on the carved top
      ;(parts.top.material as THREE.MeshPhysicalMaterial).clearcoatRoughness = 0.06
      // find the back + side wall by what they are (the kit may split or merge them):
      // the body's direct child meshes hanging from the back (z = -0.46), not the top
      {
        let sideMat: THREE.Material | null = null
        for (const c of parts.body.children) {
          const m = c as THREE.Mesh
          if (!m.isMesh || m === parts.top || Math.abs(m.position.z + 0.46) > 1e-3) continue
          shell.push(m)
          const mat = m.material
          if (Array.isArray(mat)) sideMat = mat[1] ?? sideMat
          else if (!(mat as THREE.MeshStandardMaterial).map) sideMat = mat
        }
        if (sideMat) sweepable(sideMat, 'side', uSweep)
      }
      runs = g.group.children[g.group.children.indexOf(g.strings.group) + 1] ?? null
      neckBase.copy(parts.neck.position)
      headBase.copy(parts.headstock.position)
      // hardware that drops into place in step 03 (base positions in their parents' space)
      const [h0, h1] = B.hw
      const span = h1 - h0
      const add = (obj: THREE.Object3D, a: number, h = 1.5) => hw.push({ obj, base: obj.position.clone(), a: h0 + a * span, b: h0 + a * span + span * 0.5, h })
      parts.pickups.forEach((p, i) => add(p, i * 0.08))
      add(parts.bridge, 0.18)
      add(parts.tailpiece, 0.24)
      parts.knobs.forEach((k, i) => add(k, 0.3 + i * 0.05, 1.2))
      add(parts.toggle, 0.46, 1.2)
      parts.tuners.children.forEach((t, i) => add(t, 0.38 + i * 0.02, 1.0))

      // the jack on the lower treble bout's rim
      const outlinePts = bodyOutline()
      {
        const d = new THREE.Vector2(-0.42, -1).normalize()
        let best = 0
        let bi = 0
        outlinePts.forEach((p, i) => {
          const v = p.x * d.x + p.y * d.y
          if (v > best) {
            best = v
            bi = i
          }
        })
        const p = outlinePts[bi]
        const a = outlinePts[(bi + outlinePts.length - 2) % outlinePts.length]
        const b = outlinePts[(bi + 2) % outlinePts.length]
        const tn = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize()
        // outward normal of a CCW outline: (t.y, -t.x)
        const n = new THREE.Vector3(tn.y, -tn.x, 0).normalize()
        const jack = buildJackPlate()
        jack.position.set(p.x + n.x * 0.004, p.y + n.y * 0.004, -0.22)
        jack.quaternion.setFromUnitVectors(V(0, 0, 1), n)
        parts.body.add(jack)
        group.updateMatrixWorld(true)
        // the plug's seated pose (world): tip in the hole, pointing inward
        const hole = gw(p.x + n.x * 0.06, p.y + n.y * 0.06, -0.22)
        const nW = gw(p.x + n.x, p.y + n.y, -0.22).sub(gw(p.x, p.y, -0.22)).normalize()
        plugPose.n.copy(nW)
        const qs = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), nW)
        plugPose.seated.compose(hole, qs, V(1, 1, 1))
        // resting on the bench 0.75 out, turned a little, boot on the planks
        const restP = hole.clone().addScaledVector(nW, 0.75)
        restP.y = 0.08
        const qr = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), nW.clone().applyAxisAngle(Y, 0.35))
        plugPose.rest.compose(restP, qr, V(1, 1, 1))
      }
      await nextFrame()

      /* ---------------- the blank, its offcut, the outline, the pencil */
      const bf = buildBlank(outlinePts)
      blank = bf.blank
      offcut = bf.frame
      g.group.add(blank, offcut)
      outline = buildOutline(outlinePts, BLANK.z1 + 0.013, 0.03)
      g.group.add(outline.mesh)
      pencil = buildPencil()
      g.group.add(pencil.group)
      {
        // at rest: lying on the bench in front of the blank (guitar-local z = the bench)
        const p = V(1.6, -2.55, -0.46 + pencil.radius)
        pencilRest.p.copy(p)
        pencilRest.q.setFromUnitVectors(Y, V(0.94, 0.34, 0).normalize())
      }
      await nextFrame()

      /* ---------------- bench props */
      fork = buildFork()
      fork.group.position.copy(FORK_AT)
      fork.group.rotation.y = 0.5
      fork.group.scale.setScalar(1.25)
      group.add(fork.group)
      const chisel = buildChisel()
      chisel.position.set(-5.7, chisel.position.y, 2.9)
      chisel.rotation.y = 0.5
      group.add(chisel)
      const file = buildFretFile()
      file.position.set(6.6, file.position.y, 3.1)
      file.rotation.y = -0.22
      group.add(file)
      const rule = buildRule()
      rule.position.set(1.4, rule.position.y, 4.1)
      rule.rotation.y = 0.03
      group.add(rule)
      const roll = buildGafferRoll()
      roll.position.set(9.6, 0, -2.2)
      group.add(roll)
      // the neck cradle under the first frets
      {
        const at = gw(5.3, 0, 0)
        const cradle = buildCradle(0.31)
        cradle.position.set(at.x, 0, at.z)
        cradle.rotation.y = GUITAR.yaw
        group.add(cradle)
      }
      // shavings: a few by the chisel from the start, a drift of them round the body after the carve
      {
        const list: { x: number; z: number; s?: number }[] = []
        const r = (a: number) => (Math.sin(a * 12.9898) * 43758.5453) % 1
        for (let i = 0; i < EARLY_SHAVINGS; i++) list.push({ x: -4.4 + Math.abs(r(i)) * 2.4, z: 2.2 + Math.abs(r(i + 40)) * 1.6, s: 0.8 })
        // carving debris: drifted along the near (treble) side and the tail, a few behind
        const around = mobile ? 16 : 24
        for (let i = 0; i < around; i++) {
          const u = Math.abs(r(i + 7))
          const a = -Math.PI * 0.95 + u * Math.PI * 1.25 + (i % 5 === 0 ? Math.PI : 0)
          const rad = 1.9 + Math.abs(r(i + 90)) * 0.9
          const c = gw(0.2 + Math.cos(a) * rad * 1.15, Math.sin(a) * rad, -0.46)
          if (c.z < BENCH.z0 + 0.6) continue
          list.push({ x: c.x, z: c.z, s: 0.55 + Math.abs(r(i + 3)) * 0.5 })
        }
        shavings = buildShavings(list)
        group.add(shavings.mesh)
      }
      await nextFrame()

      /* ---------------- the work lamp */
      {
        const aim = gw(0.4, 0, 0)
        const lamp = buildLamp(LAMP.base, LAMP.elbow, LAMP.head, aim)
        group.add(lamp.group)
        lampBulb.copy(lamp.bulbAt)
        lampShade = lamp.group.children[lamp.group.children.length - 1]
      }

      /* ---------------- the practice amp + the cable to the guitar */
      amp = buildAmp({ kind: 'combo', labels: ['Volume', 'Treble', 'Bass', 'Reverb'] })
      amp.group.scale.setScalar(0.42)
      amp.group.position.copy(AMP_AT)
      amp.group.rotation.y = 0.42
      group.add(amp.group)
      amp.setKnob(0, 0.55)
      amp.setKnob(1, 0.6)
      amp.setKnob(2, 0.45)
      amp.setKnob(3, 0.3)
      amp.setPilot(0)
      group.updateMatrixWorld(true)
      {
        // into the amp's input (front panel, left)
        const s = amp.size
        const input = amp.group.localToWorld(V(-s.x / 2 + 0.55, s.y - 0.5, s.z / 2 + 0.05))
        const out = amp.group.localToWorld(V(-s.x / 2 + 0.55, s.y - 0.5, s.z / 2 + 1.6))
        const seatedEnd = V(0, 0, 1.22).applyMatrix4(plugPose.seated)
        const mid1 = seatedEnd.clone().addScaledVector(plugPose.n, 2.6)
        mid1.y = 0.04
        const mid2 = V(lerp(mid1.x, out.x, 0.5) - 0.8, 0.04, lerp(mid1.z, out.z, 0.5) + 1.1)
        const nearAmp = out.clone()
        nearAmp.y = 0.04
        cablePath.push(mid1, mid2, nearAmp, V(out.x, input.y * 0.6, out.z), input)
        const pc = buildPlugCable([seatedEnd, mid1, mid2, nearAmp, input])
        plug = pc.group
        plug.matrixAutoUpdate = false
        cable = pc.cable
        group.add(plug, cable)
        // a jack at the amp end too
        const tail = buildPlugCable([V(0, 0, 1), V(0, 0, 2)]).group
        tail.position.copy(input)
        tail.quaternion.setFromUnitVectors(V(0, 0, 1), amp.group.localToWorld(V(-s.x / 2 + 0.55, s.y - 0.5, s.z / 2 + 1)).sub(input).normalize())
        group.add(tail)
        updateCable(0)
      }
      await nextFrame()

      /* ---------------- spray gun + mist */
      gun = buildSprayGun()
      gun.scale.setScalar(0.78)
      group.add(gun)
      // the lamp's warm spill on the pegboard and the rack (the pool itself is the follow spot)
      spill = new THREE.PointLight(0xffb070, 0, 16, 2)
      spill.position.copy(LAMP.head).add(V(0.4, 1.2, -1.4))
      group.add(spill)
      mist = buildMist()
      group.add(mist.mesh)

      /* ---------------- the clip-on tuner: on the bench, then on the headstock */
      await fontsReady()
      tuner = buildClipTuner()
      tuner.group.matrixAutoUpdate = false
      group.add(tuner.group)
      {
        // on: clipped to the headstock tip, the display turned toward the player (body side)
        const hs = parts.headstock
        hs.updateMatrixWorld(true)
        const up = V(0, 0, 1)
        const face = V(-0.72, -0.7, 0.18).normalize()
        const xAxis = V().crossVectors(up, face).normalize()
        const zAxis = V().crossVectors(xAxis, up).normalize()
        const basis = new THREE.Matrix4().makeBasis(xAxis, up, zAxis)
        const local = new THREE.Matrix4().copy(basis).setPosition(1.86, -0.05, -0.02)
        tunerPose.on.multiplyMatrices(hs.matrixWorld, local)
        // rest: lying on its back on the bench, display up
        const restAt = gw(7.4, -2.5, -0.46 + 0.18)
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.25, 0, 0.5))
        tunerPose.rest.compose(restAt, q, V(1, 1, 1))
        tunerPose.on.decompose(tunerPose.onP, tunerPose.onQ, V())
        tunerPose.rest.decompose(tunerPose.restP, tunerPose.restQ, V())
        // the hang tag's thread: tied round the tip-most treble tuner button
        tagAnchor.copy(hs.localToWorld(V(1.45, -0.74, -0.19)))
      }

      /* ---------------- world points for the camera */
      pts.blank.copy(gw(0.4, 0, 0))
      pts.body.copy(gw(0.35, 0, 0))
      pts.mid.copy(gw(3.2, 0, 0))
      pts.head.copy(gw(7.2, 0, 0))
      pts.est.copy(pts.blank).lerp(FORK_AT, 0.28)
      pts.est.y = 0.4

      /* ---------------- DOM */
      head = el('div', 'wb-head', undefined, ctx.stage)
      el('p', 'hud-eyebrow', SECTIONS.process.eyebrow, head)
      title = rise(el('h2', 'hud-h2 wb-h2', undefined, head), 'We listen first.<br>Then we <em>build.</em>')

      card = el('div', 'wb-card hud-panel', undefined, ctx.stage)
      const top = el('div', 'wb-card-top', undefined, card)
      el('span', 'wb-card-k', 'Build sheet', top)
      meter = el('span', 'wb-meter', undefined, top)
      for (let i = 0; i < PROCESS.length; i++) el('i', '', undefined, meter)
      const book = el('div', 'wb-pages', undefined, card)
      PROCESS.forEach((p, i) => {
        const pg = el('div', 'wb-page', undefined, book)
        const num = el('p', 'wb-num', undefined, pg)
        el('span', 'wb-n', `Step ${String(i + 1).padStart(2, '0')}`, num)
        el('span', 'wb-of', `/ ${String(PROCESS.length).padStart(2, '0')}`, num)
        const t = rise(el('h3', 'wb-title', undefined, pg), p.title)
        el('p', 'hud-body wb-text', p.text, pg)
        pages.push(pg)
        pageTitles.push(t)
      })
      reveal(card, 0, 0)

      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('class', 'wb-thread')
      thread = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      svg.appendChild(thread)
      ctx.stage.appendChild(svg)
      tag = el('div', 'wb-tag', undefined, ctx.stage)
      el('span', 'wb-eyelet', undefined, tag)
      const tk = el('p', 'wb-tag-k', undefined, tag)
      el('span', 'wb-tag-brand', BRAND.short, tk)
      el('span', 'wb-tag-kind', 'Spec', tk)
      const list = el('div', 'wb-stats', undefined, tag)
      for (const s of SHOW) {
        const d = el('div', 'wb-stat', undefined, list)
        el('p', 'wb-stat-v', s.value, d)
        el('p', 'wb-stat-l', s.label, d)
      }
      el('p', 'wb-tag-foot', BRAND.locale, tag)
      reveal(tag, 0, 0)
      svg.style.opacity = '0'
      reveal(head, 0, 0)
      document.fonts?.ready.then(() => (regions.key = ''))
    },

    update(local, frame, ctx) {
      const dt = frame.dt
      const q = clock.update(local, dt)
      const calm = frame.reducedMotion || !!frame.still
      measure(frame)
      const parts = g.parts

      /* ---------------- 01 Listen: the blank, the fork, the pencil */
      const lift = ease.inOutCubic(sg(q, B.lift))
      const swapped = q >= B.lift[0]
      blank.visible = !swapped
      // the offcut: lifted clear of the body, slid back and set down behind it
      offcut.visible = swapped
      {
        const up = smoothstep(0, 0.32, lift)
        const back = ease.inOutCubic(segment(lift, 0.28, 1))
        offcut.position.set(1.1 * back, 3.9 * back, 0.74 * up * (1 - back) + 0.004)
        offcut.rotation.set(0, 0, 0.12 * back)
      }
      outline.setDraw(sg(q, B.draw))
      outline.mesh.visible = outline.mesh.visible && !swapped
      placePencil(q)
      const ringAmt = smoothstep(A0 - 0.004, A0 + 0.01, q) * (1 - smoothstep(0.24, 0.33, q))
      fork.setRing(calm ? Math.min(ringAmt, 0.5) : ringAmt)

      /* ---------------- 02 Prototype: carve, shavings, the neck */
      const carve = swapped ? ease.inOutQuad(sg(q, B.carve)) : 0
      parts.body.visible = swapped
      parts.top.scale.z = Math.max(0.001, carve)
      parts.top.position.z = 0.14 * (1 - carve)
      for (const m of shell) m.scale.z = (0.46 + 0.14 * (1 - carve)) / 0.46
      shavings.set(EARLY_SHAVINGS, 1e6, smoothstep(0.1, 0.9, carve))
      const nk = ease.outCubic(sg(q, B.neck))
      const nOn = nk > 0.001
      parts.neck.visible = nOn
      parts.headstock.visible = nOn
      const dx = 3.4 * (1 - nk)
      const dz = 0.5 * Math.sin(Math.PI * clamp(1 - nk)) * 0.6
      parts.neck.position.set(neckBase.x + dx, neckBase.y, neckBase.z + dz)
      parts.headstock.position.set(headBase.x + dx, headBase.y, headBase.z + dz)

      /* ---------------- 03 Build: the spray pass, then the hardware */
      const gi = ease.inOutCubic(sg(q, B.gunIn))
      const go = ease.inOutCubic(sg(q, B.gunOut))
      const sw = sg(q, B.sweep)
      const sweepX = lerp(-2.5, 3.05, ease.inOutQuad(sw))
      uSweep.value = q < B.sweep[0] ? -9 : q > B.sweep[1] ? 9 : sweepX
      g.finish = smoothstep(B.sweep[0], B.sweep[1], q)
      const gunVis = gi > 0.001 && go < 0.999
      gun.visible = gunVis
      const spraying = gunVis ? smoothstep(0, 0.2, sw) * (1 - smoothstep(0.9, 1, sw)) * (q < B.sweep[1] + 0.004 ? 1 : 0) : 0
      mist.mesh.visible = spraying > 0.01
      if (gunVis) {
        // the nozzle travels with the wipe front, 1.8 above the top, a little toward the player
        const nx = q < B.sweep[0] ? -2.5 : q > B.sweep[1] ? 3.05 : sweepX
        const nozzle = gw(nx + 0.15, -0.5, 1.3, nozzleV)
        const target = gw(nx - 0.05, 0, 0.1, targetV)
        gun.position.copy(nozzle).addScaledVector(GUN_AWAY, 1 - gi + go)
        const aimDir = tmpV2.copy(target).sub(nozzle).normalize()
        gun.quaternion.setFromUnitVectors(DOWN, aimDir)
        if (mist.mesh.visible) {
          mist.mesh.position.copy(nozzle)
          mist.mesh.quaternion.setFromUnitVectors(DOWN, aimDir)
          mist.mesh.scale.set(1, nozzle.distanceTo(target), 1)
          mist.uniforms.uAmt.value = spraying
          mist.uniforms.uTime.value = calm ? 0 : frame.time
        }
      }
      for (const h of hw) {
        const t = segment(q, h.a, h.b)
        h.obj.visible = t > 0.001
        const e = 1 - Math.pow(1 - t, 3)
        h.obj.position.copy(h.base)
        h.obj.position.z += (1 - e) * h.h
      }

      /* ---------------- 04 Support: strings, tuner, plug, ring */
      const st = ease.inOutCubic(sg(q, B.strings))
      g.strings.group.visible = st > 0.002
      g.strings.group.scale.x = Math.max(0.002, st)
      if (runs) runs.visible = st > 0.985
      const hop = ease.inOutCubic(sg(q, B.hop))
      {
        const t = tunerPose
        tmpV.lerpVectors(t.restP, t.onP, hop)
        tmpV.y += Math.sin(Math.PI * hop) * 1.4
        tmpQ.slerpQuaternions(t.restQ, t.onQ, hop)
        tuner.group.matrix.compose(tmpV, tmpQ, tmpS.set(1, 1, 1))
        tuner.group.matrixWorldNeedsUpdate = true
      }
      const nd = sg(q, B.needle)
      const needle = q < B.needle[0] ? -0.85 : 0.85 * -Math.exp(-4.2 * nd) * Math.cos(nd * 11.5)
      tuner.setNeedle(needle)
      tuner.setLit(smoothstep(0.75, 1, nd))
      const pl = sg(q, B.plug)
      plug.visible = cable.visible = swapped
      updateCable(pl)
      const on = smoothstep(B.plug[1] - 0.004, B.plug[1] + 0.02, q)
      amp.setPilot(on)
      // the ring: a sustain derived from local (screenshot-safe) + a time-paced strike on arrival
      // (never on arrival: a jump into the chapter or a teleport just syncs the state)
      const nowPlugged = pl >= 1
      const teleport = fresh || Math.abs(local - lastLocal) > 0.05
      if (nowPlugged && !plugged && !teleport) {
        const struck = ring.strike(frame.time, 1)
        if (struck && !calm && frame.time - lastThump > 1.4) {
          lastThump = frame.time
          thumpAt = frame.time
        }
      }
      plugged = nowPlugged
      fresh = false
      lastLocal = local
      const sustain = on * (1 - smoothstep(0.9, 0.99, q)) * 0.0045
      const r = ring.value(frame.time) * 0.011
      for (let i = 0; i < 6; i++) g.strings.amp[i] = st > 0.98 ? (sustain + r) * (1 - i * 0.09) : 0
      g.strings.wobble = 0
      g.strings.light.set(GEL.tungsten)
      g.strings.lightDir.copy(lampBulb).sub(pts.body).normalize()
      g.update(frame, ctx.camera, ctx.renderer)

      /* ---------------- the lamp, the stage, the grade */
      const W = ctx.world.params
      const aimT = smoothstep(S(1) - 0.02, S(1) + 0.06, q) * (1 - smoothstep(S(2) + 0.02, S(2) + 0.08, q)) + smoothstep(S(3) - 0.02, S(3) + 0.06, q)
      W.spotAt.copy(pts.blank).lerp(tmpV.copy(pts.mid).lerp(pts.body, 0.35), clamp(aimT))
      // the stats: the lamp swings to the headstock and its hang tag
      W.spotAt.lerp(pts.head, smoothstep(TAG[0] - 0.01, TAG[0] + 0.05, q) * 0.75)
      W.spotPos.copy(lampBulb)
      W.spot = 0.24
      W.spotColor = '#ffd6a0'
      W.spotAngle = lerp(0.6, 0.76, clamp(aimT))
      W.spotPenumbra = 0.9
      spill.intensity = 14
      if (lampShade) lampShade.quaternion.setFromUnitVectors(DOWN, tmpV.copy(W.spotAt).sub(LAMP.head).normalize())
      W.rimA = 0.55
      W.rimAColor = GEL.amber
      W.rimADir.set(-0.8, 0.6, -1)
      W.rimB = 0.35 + 0.25 * on
      W.rimBColor = GEL.oxblood
      W.rimBDir.set(0.9, 0.45, -1)
      W.fill = 0.07
      W.haze = 0.32 + 0.12 * on
      W.hazeColor = '#7a3a1a'
      W.hazeY = 0.55
      W.beams = 0.1 + 0.25 * on
      W.beamA = GEL.amber
      W.beamB = GEL.oxblood
      W.sway = 0.4
      W.bokeh = 0.3
      W.bokehA = GEL.amber
      W.bokehB = GEL.red
      W.env = 0.75
      // the PAR row sweeps across the fresh lacquer as the gun passes and after
      W.envTurn = lerp(-0.5, 0.6, smoothstep(B.sweep[0], S(3) + 0.05, q))
      const P = ctx.post.params
      P.bloomStrength = 0.36
      P.bloomThreshold = 0.9
      P.vignette = 0.62
      P.warmth = 0.8
      P.saturation = 1.0
      const th = frame.time - thumpAt
      P.glitch = !calm && th >= 0 && th < 0.45 ? 0.24 * Math.exp(-th / 0.09) : 0

      /* ---------------- camera (written in camera()) */
      computePose(q, frame)

      /* ---------------- DOM */
      reveal(head, window01(q, HEAD[0], HEAD[1], 0.014), 0)
      setRise(title, q > HEAD[0] + 0.004 && q < HEAD[1])
      reveal(card, window01(q, A0 - 0.006, A1 + 0.006, 0.012), 0)
      const step = clamp(Math.floor((q - A0) / SLOT), 0, PROCESS.length - 1)
      // one page at a time: the switch happens at the step boundary and the
      // swap itself is a short TIME-based fade (CSS), so the card is never
      // empty or double-printed wherever the scroll comes to rest
      if (step !== shownStep) {
        shownStep = step
        card.dataset.step = String(step)
        meter.querySelectorAll('i').forEach((m, i) => m.classList.toggle('is-on', i <= step))
        pages.forEach((pg, i) => pg.classList.toggle('is-on', i === step))
      }
      const cardOn = q > A0 - 0.006 && q < A1 + 0.006
      pageTitles.forEach((t, i) => setRise(t, cardOn && i === step))
      const tv = window01(q, TAG[0], TAG[1], 0.014)
      reveal(tag, tv, 0)
      if (tv > 0.001) {
        // the thread: from the tag's eyelet up to the tuner button, a gentle sag
        tmpV.copy(tagAnchor).project(ctx.camera)
        const ax = (tmpV.x * 0.5 + 0.5) * frame.width
        const ay = (0.5 - tmpV.y * 0.5) * frame.height
        const ex = regions.eyeX
        const ey = regions.eyeY
        const mx = (ax + ex) / 2
        const my = Math.max(ay, ey) + Math.abs(ax - ex) * 0.08 + 12
        if (Number.isFinite(ax + ay) && tmpV.z < 1) {
          thread.setAttribute('d', `M${ex.toFixed(1)},${ey.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)}`)
          svg.style.opacity = tv.toFixed(3)
        } else svg.style.opacity = '0'
      } else if (svg.style.opacity !== '0') svg.style.opacity = '0'
    },

    camera(_local, _frame, out) {
      out.position.copy(pose.position)
      out.target.copy(pose.target)
      out.fov = pose.fov
      out.parallax = pose.parallax
    },
  }
}

