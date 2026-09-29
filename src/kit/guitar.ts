import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { logoGeometry } from '../logo/logo'
import type { Frame } from '../core/types'
import { Strings } from './strings'
import { amberKnob, blackGloss, cream, mahogany, nickel, pearl, rosewood } from './materials'

/*
 * THE GUITAR — a single-cut electric with a carved, flame-maple top in a
 * tobacco sunburst, cream binding, a rosewood board with pearl trapezoid
 * inlays, two nickel-covered humbuckers, a tune-o-matic bridge and stop
 * tailpiece, four amber top-hat knobs, and a black headstock with the Hark
 * mark inlaid in mother-of-pearl where a maker's logo would be.
 *
 * Local space (1 unit = 10 cm): the guitar lies in the XY plane, face toward
 * +Z. The neck runs along +X: the BRIDGE saddles are at x = 0, the NUT at
 * x = SCALE (6.29), the headstock beyond. +Y is the bass side (low E on top
 * when the neck points right), the cutaway is on -Y. The body's binding edge
 * is at z = 0; the carved top rises to ~0.14; the board's top is at z = 0.2.
 *
 * The flame is CHATOYANT: its stripes shift light↔dark with the viewing
 * angle, like real figured maple under lacquer, so any camera move makes the
 * top shimmer. The clearcoat picks up the world's row of PAR cans.
 *
 *   const g = buildGuitar()
 *   group.add(g.group)
 *   g.update(frame, ctx.camera, ctx.renderer)   // every frame (strings)
 *   g.strings.amp[i] = 0.02                     // ring a string
 *   g.fretX(12), g.stringY(i, x), g.topZ(x, y)  // where things are
 *   g.finish = 0..1                             // raw maple → lacquered burst
 *
 * Parts are exposed on g.parts for chapters that build or take apart the
 * instrument (process), and every mesh casts / receives shadows sensibly.
 */

export const SCALE = 6.29
export const FRETS = 22
const BOARD_TOP = 0.2
const NUT_W = 0.43
const END_W = 0.56
const BODY_DEPTH = 0.46
const ARCH = 0.14

/** distance of fret n from the bridge (n = 0 is the nut) */
export const fretX = (n: number) => SCALE * Math.pow(2, -n / 12)
const BOARD_END = fretX(FRETS) - 0.09

export interface GuitarOptions {
  /** 'tobacco' (default), 'cherry', 'honey', 'ebony' */
  burst?: keyof typeof BURSTS
  /** lower-detail parts for phones */
  mobile?: boolean
}

const BURSTS = {
  tobacco: { center: '#e8a23e', mid: '#9c3f12', edge: '#140703' },
  cherry: { center: '#f0a64a', mid: '#b3190f', edge: '#2a0403' },
  honey: { center: '#f2c070', mid: '#c77a22', edge: '#5a2a0c' },
  ebony: { center: '#1a1614', mid: '#0e0c0b', edge: '#060505' },
}

/* ---------------------------------------------------------------- outline */

/** The body outline (single-cut), dense and counter-clockwise, in local XY. */
export function bodyOutline(): THREE.Vector2[] {
  const P = (x: number, y: number) => new THREE.Vector3(x, y, 0)
  const pts = [
    P(-1.86, 0),
    P(-1.78, -0.78),
    P(-1.4, -1.42),
    P(-0.62, -1.7),
    P(0.18, -1.58),
    P(0.82, -1.26),
    P(1.22, -1.26),
    P(1.72, -1.36),
    P(2.08, -1.12),
    // the cutaway horn, then the scoop back toward the neck
    P(2.14, -0.82),
    P(1.9, -0.62),
    P(1.86, -0.4),
    P(2.12, -0.28),
    // the neck joint
    P(2.62, -0.27),
    P(2.66, 0.28),
    // upper bass bout (no horn)
    P(2.5, 0.72),
    P(2.12, 1.24),
    P(1.5, 1.38),
    P(0.86, 1.26),
    P(0.2, 1.56),
    P(-0.62, 1.7),
    P(-1.4, 1.42),
    P(-1.78, 0.78),
  ]
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal')
  return curve.getSpacedPoints(220).slice(0, -1).map(p => new THREE.Vector2(p.x, p.y))
}

function distToPolyline(x: number, y: number, poly: THREE.Vector2[]) {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / (abx * abx + aby * aby)))
    const dx = a.x + abx * t - x
    const dy = a.y + aby * t - y
    best = Math.min(best, dx * dx + dy * dy)
  }
  return Math.sqrt(best)
}

/** 1-to-4 midpoint subdivision of an indexed triangle mesh (positions only). */
function subdivide(geo: THREE.BufferGeometry, levels: number) {
  let pos = Array.from(geo.attributes.position.array as ArrayLike<number>)
  let idx = Array.from(geo.index!.array as ArrayLike<number>)
  for (let l = 0; l < levels; l++) {
    const mids = new Map<string, number>()
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      let m = mids.get(key)
      if (m === undefined) {
        m = pos.length / 3
        pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2)
        mids.set(key, m)
      }
      return m
    }
    const next: number[] = []
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]]
      const ab = mid(a, b)
      const bc = mid(b, c)
      const ca = mid(c, a)
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
    }
    idx = next
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setIndex(idx)
  return out
}

/** height of the carved top above the binding edge, from the distance to the edge */
function archAt(d: number) {
  // a flat binding ledge, then the recurve rising into the dome
  const t = Math.max(0, Math.min(1, (d - 0.08) / 1.25))
  return 0.002 + ARCH * t * t * (3 - 2 * t)
}

/* ---------------------------------------------------------------- shaders */

/** The sunburst flame top: a MeshPhysicalMaterial with a procedural finish. */
function topMaterial(burst: (typeof BURSTS)[keyof typeof BURSTS]) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.42,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
  })
  const uniforms = {
    uCenter: { value: new THREE.Color(burst.center) },
    uMid: { value: new THREE.Color(burst.mid) },
    uEdge: { value: new THREE.Color(burst.edge) },
    uBinding: { value: new THREE.Color('#e9dcc0') },
    uFlame: { value: 1 },
    uFinish: { value: 1 },
  }
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aEdge;
        varying float vEdge;
        varying vec3 vObj;
        varying vec3 vWPos;
        varying vec3 vGrainW;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vEdge = aEdge;
        vObj = position;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vGrainW = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uCenter, uMid, uEdge, uBinding;
        uniform float uFlame, uFinish;
        varying float vEdge;
        varying vec3 vObj;
        varying vec3 vWPos;
        varying vec3 vGrainW;
        float fhash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float fnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fhash(i), fhash(i + vec2(1, 0)), f.x), mix(fhash(i + vec2(0, 1)), fhash(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float e = clamp(vEdge / 1.55, 0.0, 1.0);
          // the burst: dark edge → red-brown → amber heart
          vec3 burst = mix(uEdge, uMid, smoothstep(0.03, 0.34, e));
          burst = mix(burst, uCenter, smoothstep(0.24, 0.66, e));
          // raw maple (unfinished) for builds
          vec3 raw = vec3(0.86, 0.74, 0.56);
          vec3 base = mix(raw, burst, uFinish);
          // FLAME: bookmatched chevrons across the grain — fine, wavy, uneven —
          // chatoyant: the stripes swap light and dark as the view angle changes
          vec2 q = vObj.xy;
          float warp = 0.34 * fnoise(q * vec2(1.6, 4.5)) + 0.12 * fnoise(q * vec2(4.0, 13.0));
          float s = q.x * 5.2 + abs(q.y) * 3.1 + warp * 5.2;
          vec3 V = normalize(cameraPosition - vWPos);
          float chat = dot(V, vGrainW);
          float fl = sin(s * 6.2831853 + chat * 5.0);
          fl = smoothstep(-0.55, 0.95, fl);
          // the figure comes and goes across the top (bookmatched: mirrored in y)
          float figPatch = smoothstep(0.25, 0.75, fnoise(vec2(q.x * 0.9, abs(q.y) * 1.3) + 3.0));
          float strength = uFlame * mix(0.35, 1.0, uFinish) * (0.45 + 0.55 * figPatch) * (1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.35, e)));
          float fig = 1.0 + strength * (fl - 0.5) * 0.4;
          // fine grain along the length
          float grain = 1.0 + 0.05 * (fnoise(vec2(q.x * 3.0, q.y * 160.0)) - 0.5);
          vec3 wood = base * fig * grain;
          // the binding, seen from above
          float bind = 1.0 - smoothstep(0.03, 0.037, vEdge);
          diffuseColor.rgb *= mix(wood, uBinding, bind);
        }`,
      )
      .replace(
        '#include <clearcoat_fragment_maps>',
        `#include <clearcoat_fragment_maps>
        material.clearcoat *= uFinish;`,
      )
  }
  ;(mat as unknown as { finishUniforms: typeof uniforms }).finishUniforms = uniforms
  return { mat, uniforms }
}

/** Body sides: the burst's darkest colour, a cream binding band along the top edge. */
function sideMaterial(edge: string) {
  const mat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.04 })
  const uniforms = { uEdgeC: { value: new THREE.Color(edge) }, uBinding: { value: new THREE.Color('#e9dcc0') }, uFinish: { value: 1 } }
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying float vZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvZ = position.z;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uEdgeC, uBinding;\nuniform float uFinish;\nvarying float vZ;`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float bind = smoothstep(${(BODY_DEPTH - 0.042).toFixed(3)}, ${(BODY_DEPTH - 0.037).toFixed(3)}, vZ);
        vec3 raw = vec3(0.62, 0.36, 0.22);
        diffuseColor.rgb *= mix(mix(raw, uEdgeC, uFinish), uBinding, bind * uFinish);`,
      )
      .replace('#include <clearcoat_fragment_maps>', `#include <clearcoat_fragment_maps>\nmaterial.clearcoat *= uFinish;`)
  }
  return { mat, uniforms }
}

/* ---------------------------------------------------------------- build */

export interface Guitar {
  group: THREE.Group
  strings: Strings
  parts: {
    body: THREE.Group
    top: THREE.Mesh
    neck: THREE.Group
    headstock: THREE.Group
    logo: THREE.Mesh
    pickups: THREE.Group[]
    bridge: THREE.Group
    tailpiece: THREE.Group
    knobs: THREE.Object3D[]
    toggle: THREE.Group
    frets: THREE.InstancedMesh
    inlays: THREE.Mesh
    tuners: THREE.Group
  }
  /** 0 raw maple, matte → 1 lacquered sunburst */
  finish: number
  /** fret n's x (0 = nut) */
  fretX: (n: number) => number
  /** string i's y at x (i = 0 low E) */
  stringY: (i: number, x: number) => number
  /** the strings' height (z) at x */
  stringZ: (x: number) => number
  /** carved-top height at (x, y) on the body */
  topZ: (x: number, y: number) => number
  /** headstock logo centre in local space */
  logoAt: THREE.Vector3
  update(frame: Frame, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): void
}

const STRING_NUT = 0.175
const STRING_BRIDGE = 0.255
const Z_NUT = BOARD_TOP + 0.036
const Z_BRIDGE = BOARD_TOP + 0.029

export function buildGuitar(opts: GuitarOptions = {}): Guitar {
  const burst = BURSTS[opts.burst ?? 'tobacco']
  const mobile = !!opts.mobile
  const group = new THREE.Group()
  group.name = 'guitar'

  const stringY = (i: number, x: number) => {
    const t = x / SCALE
    const spread = STRING_BRIDGE + (STRING_NUT - STRING_BRIDGE) * t
    return spread * (1 - (2 * i) / 5)
  }
  const stringZ = (x: number) => Z_BRIDGE + (Z_NUT - Z_BRIDGE) * (x / SCALE)
  const boardW = (x: number) => END_W + (NUT_W - END_W) * ((x - BOARD_END) / (SCALE - BOARD_END))

  /* ---- body ---- */
  const outline = bodyOutline()
  const body = new THREE.Group()
  body.name = 'body'
  const shape = new THREE.Shape(outline)
  const sides = new THREE.ExtrudeGeometry(shape, { depth: BODY_DEPTH, bevelEnabled: false, curveSegments: 1 })
  // drop the extruded FRONT cap: the carved top replaces it
  {
    const g0 = sides.groups[0]
    const half = g0.count / 2
    const keep = (arr: THREE.BufferAttribute) => {
      const n = arr.itemSize
      const src = arr.array as Float32Array
      const out = new Float32Array(src.length - half * n)
      out.set(src.subarray(0, half * n), 0)
      out.set(src.subarray((g0.start + g0.count) * n), half * n)
      return new THREE.BufferAttribute(out, n)
    }
    for (const name of ['position', 'normal', 'uv']) sides.setAttribute(name, keep(sides.getAttribute(name) as THREE.BufferAttribute))
    sides.clearGroups()
    sides.addGroup(0, half, 0)
    sides.addGroup(half, sides.attributes.position.count - half, 1)
  }
  const back = mahogany()
  back.color.set('#6a4030')
  const side = sideMaterial(burst.edge)
  const bodyMesh = new THREE.Mesh(sides, [back, side.mat])
  bodyMesh.position.z = -BODY_DEPTH
  bodyMesh.castShadow = true
  bodyMesh.receiveShadow = true
  body.add(bodyMesh)

  // the carved top: the outline, subdivided, lifted by distance to the edge
  const flat = new THREE.ShapeGeometry(new THREE.Shape(outline), 1)
  const topGeo = subdivide(flat, mobile ? 3 : 4)
  {
    const p = topGeo.attributes.position
    const edge = new Float32Array(p.count)
    for (let i = 0; i < p.count; i++) {
      const d = distToPolyline(p.getX(i), p.getY(i), outline)
      edge[i] = d
      p.setZ(i, archAt(d))
    }
    topGeo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1))
    topGeo.computeVertexNormals()
  }
  const top = topMaterial(burst)
  const topMesh = new THREE.Mesh(topGeo, top.mat)
  topMesh.receiveShadow = true
  topMesh.castShadow = true
  body.add(topMesh)
  group.add(body)
  const topZ = (x: number, y: number) => archAt(distToPolyline(x, y, outline))

  /* ---- neck + fingerboard ---- */
  const neck = new THREE.Group()
  neck.name = 'neck'
  // the mahogany neck: a half-ellipse section under the board, heel into the body
  {
    const nx = 28
    const na = 12
    const x0 = 2.1
    const x1 = SCALE + 0.06
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx
      const w = boardW(Math.max(x, BOARD_END)) * 0.5
      const dep = 0.3 - 0.06 * ((x - x0) / (x1 - x0))
      for (let j = 0; j <= na; j++) {
        const a = Math.PI + (Math.PI * j) / na
        pos.push(x, Math.cos(a) * w, BOARD_TOP - 0.065 + Math.sin(a) * dep)
      }
    }
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < na; j++) {
        const a = i * (na + 1) + j
        const b = a + na + 1
        idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, mahogany())
    m.castShadow = true
    m.receiveShadow = true
    neck.add(m)
  }
  // the fingerboard: a tapered slab of rosewood
  {
    const g = new THREE.BoxGeometry(1, 1, 0.065, 1, 1, 1)
    const p = g.attributes.position
    const uv = g.attributes.uv
    for (let i = 0; i < p.count; i++) {
      const x = BOARD_END + (p.getX(i) + 0.5) * (SCALE - BOARD_END)
      const w = boardW(x)
      p.setXYZ(i, x, p.getY(i) * w, BOARD_TOP - 0.0325 + p.getZ(i))
    }
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.0, uv.getY(i))
    g.computeVertexNormals()
    const mat = rosewood()
    mat.roughness = 0.74
    mat.envMapIntensity = 0.45
    const m = new THREE.Mesh(g, mat)
    m.receiveShadow = true
    neck.add(m)
    // cream binding along both edges
    const bind = cream(0.4)
    for (const s of [1, -1]) {
      const a = new THREE.Vector3(BOARD_END, (s * boardW(BOARD_END)) / 2, BOARD_TOP - 0.032)
      const b = new THREE.Vector3(SCALE, (s * boardW(SCALE)) / 2, BOARD_TOP - 0.032)
      const len = a.distanceTo(b)
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.014, 0.066), bind)
      strip.position.lerpVectors(a, b, 0.5)
      strip.rotation.z = Math.atan2(b.y - a.y, b.x - a.x)
      neck.add(strip)
    }
  }
  // frets: nickel half-rounds, one instanced mesh
  const fretGeo = new THREE.CylinderGeometry(0.013, 0.013, 1, 10, 1, false, 0, Math.PI)
  fretGeo.rotateY(-Math.PI / 2)
  const frets = new THREE.InstancedMesh(fretGeo, nickel(0.16), FRETS)
  {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    for (let n = 1; n <= FRETS; n++) {
      const x = fretX(n)
      s.set(1, boardW(x) + 0.012, 1)
      m.compose(new THREE.Vector3(x, 0, BOARD_TOP), q, s)
      frets.setMatrixAt(n - 1, m)
    }
    frets.instanceMatrix.needsUpdate = true
  }
  neck.add(frets)
  // pearl trapezoid inlays
  const inlayGeos: THREE.BufferGeometry[] = []
  for (const n of [3, 5, 7, 9, 12, 15, 17, 19, 21]) {
    const xa = fretX(n)
    const xb = fretX(n - 1)
    const span = xb - xa
    const cx = (xa + xb) / 2
    const w0 = boardW(xa) * 0.62
    const w1 = boardW(xb) * 0.52
    const l = span * 0.58
    const sh = new THREE.Shape()
    sh.moveTo(cx - l / 2, -w0 / 2)
    sh.lineTo(cx + l / 2, -w1 / 2)
    sh.lineTo(cx + l / 2, w1 / 2)
    sh.lineTo(cx - l / 2, w0 / 2)
    sh.closePath()
    const g = new THREE.ShapeGeometry(sh)
    g.translate(0, 0, BOARD_TOP + 0.0012)
    inlayGeos.push(g)
  }
  const inlays = new THREE.Mesh(mergeGeometries(inlayGeos), pearl())
  inlays.receiveShadow = true
  neck.add(inlays)
  // the nut
  const nut = new THREE.Mesh(new THREE.BoxGeometry(0.05, NUT_W, 0.075), cream(0.3))
  nut.position.set(SCALE + 0.025, 0, BOARD_TOP)
  neck.add(nut)
  group.add(neck)

  /* ---- headstock ---- */
  const headstock = new THREE.Group()
  headstock.name = 'headstock'
  headstock.position.set(SCALE + 0.05, 0, BOARD_TOP - 0.05)
  headstock.rotation.y = 0.24 // tilted back ~14°
  const tuners = new THREE.Group()
  let logo: THREE.Mesh
  {
    const hs = new THREE.Shape()
    const pts: [number, number][] = [
      [0, -0.235],
      [0.3, -0.33],
      [0.9, -0.44],
      [1.62, -0.49],
      [1.84, -0.44],
      [1.94, -0.24],
      [1.9, 0],
      [1.94, 0.24],
      [1.84, 0.44],
      [1.62, 0.49],
      [0.9, 0.44],
      [0.3, 0.33],
      [0, 0.235],
    ]
    const c = new THREE.SplineCurve(pts.map(p => new THREE.Vector2(p[0], p[1])))
    hs.setFromPoints(c.getPoints(80))
    const g = new THREE.ExtrudeGeometry(hs, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 1 })
    g.translate(0, 0, -0.13)
    const face = new THREE.Mesh(g, [blackGloss(), mahogany()])
    face.castShadow = true
    face.receiveShadow = true
    headstock.add(face)
    // truss-rod cover (a black bell with a cream edge)
    const bell = new THREE.Shape()
    bell.moveTo(0.14, -0.1)
    bell.quadraticCurveTo(0.5, -0.13, 0.52, 0)
    bell.quadraticCurveTo(0.5, 0.13, 0.14, 0.1)
    bell.closePath()
    const bg = new THREE.ExtrudeGeometry(bell, { depth: 0.008, bevelEnabled: false })
    const bm = new THREE.Mesh(bg, cream(0.3))
    bm.position.z = 0.012
    headstock.add(bm)
    const bi = new THREE.Mesh(new THREE.ExtrudeGeometry(bell, { depth: 0.008, bevelEnabled: false }), blackGloss())
    bi.scale.set(0.9, 0.82, 1)
    bi.position.set(0.02, 0, 0.016)
    headstock.add(bi)
    // the mark, inlaid in pearl
    logo = new THREE.Mesh(logoGeometry({ depth: 0.006 }), pearl())
    logo.scale.setScalar(0.42)
    logo.rotation.z = -Math.PI / 2
    logo.position.set(1.36, 0, 0.012)
    headstock.add(logo)
    // tuners: posts + bushings on the face, keystone buttons out the sides
    const post = new THREE.CylinderGeometry(0.032, 0.036, 0.12, 12)
    post.rotateX(Math.PI / 2)
    const bush = new THREE.CylinderGeometry(0.055, 0.055, 0.02, 16)
    bush.rotateX(Math.PI / 2)
    const btn = new THREE.CylinderGeometry(0.1, 0.1, 0.035, 18)
    btn.scale(1, 1, 0.7)
    const shaft = new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8)
    const housing = new RoundedBoxGeometry(0.2, 0.12, 0.1, 2, 0.02)
    const nick = nickel(0.18)
    const keyMat = cream(0.28)
    for (let k = 0; k < 6; k++) {
      const sideSign = k < 3 ? 1 : -1
      const u = [0.55, 1.0, 1.45][k % 3]
      const v = sideSign * (0.33 + 0.07 * (u / 1.45))
      const t = new THREE.Group()
      const p = new THREE.Mesh(post, nick)
      p.position.set(u, v, 0.06)
      const b = new THREE.Mesh(bush, nick)
      b.position.set(u, v, 0.005)
      const h = new THREE.Mesh(housing, nick)
      h.position.set(u, v + sideSign * 0.06, -0.19)
      const s = new THREE.Mesh(shaft, nick)
      s.position.set(u, v + sideSign * 0.2, -0.19)
      const k2 = new THREE.Mesh(btn, keyMat)
      k2.rotation.x = Math.PI / 2
      k2.position.set(u, v + sideSign * 0.32, -0.19)
      k2.castShadow = true
      t.add(p, b, h, s, k2)
      tuners.add(t)
    }
    headstock.add(tuners)
  }
  group.add(headstock)

  /* ---- pickups ---- */
  const pickups: THREE.Group[] = []
  {
    const cover = new RoundedBoxGeometry(0.38, 0.7, 0.1, 3, 0.03)
    const ring = new RoundedBoxGeometry(0.5, 0.86, 0.05, 2, 0.05)
    const pole = new THREE.CylinderGeometry(0.026, 0.026, 0.012, 12)
    pole.rotateX(Math.PI / 2)
    const nick = nickel(0.24)
    const poleMat = nickel(0.35)
    const ringMat = cream(0.32)
    for (const [x, h] of [
      [0.42, 0.13],
      [1.46, 0.11],
    ]) {
      const g = new THREE.Group()
      const z0 = topZ(x, 0)
      const r = new THREE.Mesh(ring, ringMat)
      r.position.set(0, 0, 0.02)
      r.receiveShadow = true
      const c = new THREE.Mesh(cover, nick)
      c.position.set(0, 0, h - 0.05)
      c.castShadow = true
      c.receiveShadow = true
      g.add(r, c)
      for (let i = 0; i < 6; i++) {
        const pm = new THREE.Mesh(pole, poleMat)
        pm.position.set(-0.09, stringY(i, x), h + 0.001)
        g.add(pm)
      }
      g.position.set(x, 0, z0)
      pickups.push(g)
      body.add(g)
    }
  }

  /* ---- bridge + tailpiece ---- */
  const bridge = new THREE.Group()
  const tailpiece = new THREE.Group()
  {
    const nick = nickel(0.2)
    const zTop = Z_BRIDGE - 0.006
    const bar = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.66, 0.05, 2, 0.015), nick)
    bar.position.set(0, 0, zTop - 0.035)
    bar.castShadow = true
    bridge.add(bar)
    const saddle = new RoundedBoxGeometry(0.07, 0.07, 0.035, 2, 0.01)
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(saddle, nick)
      s.position.set(0.005 * (i - 2.5), stringY(i, 0), zTop - 0.01)
      bridge.add(s)
    }
    const post = new THREE.CylinderGeometry(0.035, 0.04, 0.2, 12)
    post.rotateX(Math.PI / 2)
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(post, nick)
      p.position.set(0, s * 0.36, zTop - 0.1)
      bridge.add(p)
    }
    body.add(bridge)
    const tp = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.72, 0.08, 3, 0.035), nick)
    tp.castShadow = true
    tailpiece.add(tp)
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(post, nick)
      p.position.set(0, s * 0.4, -0.06)
      tailpiece.add(p)
    }
    tailpiece.position.set(-0.52, 0, topZ(-0.52, 0) + 0.075)
    body.add(tailpiece)
  }

  /* ---- knobs + toggle ---- */
  const knobs: THREE.Object3D[] = []
  {
    const prof = [
      [0, 0],
      [0.165, 0],
      [0.165, 0.03],
      [0.155, 0.04],
      [0.122, 0.046],
      [0.118, 0.15],
      [0.105, 0.168],
      [0, 0.17],
    ].map(p => new THREE.Vector2(p[0], p[1]))
    const lathe = new THREE.LatheGeometry(prof, 32)
    lathe.rotateX(Math.PI / 2)
    const mat = amberKnob()
    const capMat = new THREE.MeshStandardMaterial({ color: '#e8cf96', metalness: 0.55, roughness: 0.32 })
    const cap = new THREE.CircleGeometry(0.075, 24)
    for (const [x, y] of [
      [-0.28, -0.98],
      [-0.86, -0.82],
      [-0.52, -1.36],
      [-1.1, -1.18],
    ]) {
      const k = new THREE.Group()
      const m = new THREE.Mesh(lathe, mat)
      m.castShadow = true
      const c = new THREE.Mesh(cap, capMat)
      c.position.z = 0.171
      // a pointer line on the cap
      const ptr = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.06), new THREE.MeshBasicMaterial({ color: '#2a1a08' }))
      ptr.position.set(0, 0.035, 0.172)
      k.add(m, c, ptr)
      k.position.set(x, y, topZ(x, y) - 0.005)
      knobs.push(k)
      body.add(k)
    }
  }
  const toggle = new THREE.Group()
  {
    const tx = 1.72
    const ty = 1.0
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.008, 24).rotateX(Math.PI / 2), cream(0.3))
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.05, 16).rotateX(Math.PI / 2), nickel(0.2))
    collar.position.z = 0.03
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.22, 8), nickel(0.2))
    lever.position.set(0, 0, 0.14)
    lever.rotation.x = Math.PI / 2 - 0.35
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10).scale(1, 1, 1.4), cream(0.3))
    tip.position.set(0, 0.04, 0.245)
    toggle.add(washer, collar, lever, tip)
    toggle.position.set(tx, ty, topZ(tx, ty))
    body.add(toggle)
  }

  /* ---- strings ---- */
  const from: THREE.Vector3[] = []
  const to: THREE.Vector3[] = []
  for (let i = 0; i < 6; i++) {
    from.push(new THREE.Vector3(0, stringY(i, 0), Z_BRIDGE))
    to.push(new THREE.Vector3(SCALE + 0.02, stringY(i, SCALE), Z_NUT))
  }
  const strings = new Strings({ from, to, swing: new THREE.Vector3(0, 1, 0.3) })
  group.add(strings.group)
  // the short runs behind the bridge and the nut (static)
  {
    const g: THREE.BufferGeometry[] = []
    const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const c = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 5, 1, true)
      c.rotateZ(Math.PI / 2)
      const m = new THREE.Matrix4().makeRotationFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3().subVectors(b, a).normalize()),
      )
      c.applyMatrix4(m)
      const mid = new THREE.Vector3().lerpVectors(a, b, 0.5)
      c.translate(mid.x, mid.y, mid.z)
      g.push(c)
    }
    const hsM = new THREE.Matrix4().compose(headstock.position, new THREE.Quaternion().setFromEuler(headstock.rotation), new THREE.Vector3(1, 1, 1))
    const radius = [0.0058, 0.0046, 0.0034, 0.0024, 0.0017, 0.0013]
    for (let i = 0; i < 6; i++) {
      const r = Math.max(0.004, radius[i])
      // bridge → tailpiece
      seg(from[i], new THREE.Vector3(-0.47, stringY(i, 0) * 0.92, tailpiece.position.z + 0.03), r)
      // nut → tuner post
      const u = [0.55, 1.0, 1.45][i % 3]
      const sideSign = i < 3 ? 1 : -1
      const v = sideSign * (0.33 + 0.07 * (u / 1.45))
      const postTop = new THREE.Vector3(u, v, 0.09).applyMatrix4(hsM)
      seg(to[i], postTop, r)
    }
    const runs = new THREE.Mesh(mergeGeometries(g), nickel(0.25))
    group.add(runs)
  }

  const logoAt = new THREE.Vector3(1.36, 0, 0.02).applyMatrix4(
    new THREE.Matrix4().compose(headstock.position, new THREE.Quaternion().setFromEuler(headstock.rotation), new THREE.Vector3(1, 1, 1)),
  )

  const guitar: Guitar = {
    group,
    strings,
    parts: { body, top: topMesh, neck, headstock, logo: logo!, pickups, bridge, tailpiece, knobs, toggle, frets, inlays, tuners },
    finish: 1,
    fretX,
    stringY,
    stringZ,
    topZ,
    logoAt,
    update(frame, camera, renderer) {
      top.uniforms.uFinish.value = guitar.finish
      side.uniforms.uFinish.value = guitar.finish
      strings.update(frame, camera, renderer)
    },
  }
  return guitar
}
