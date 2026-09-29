import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildGuitar, fretX, type Guitar } from '../../kit/guitar'
import { buildAmp, type Amp } from '../../kit/amp'
import { cable, gaffer, stageFloor } from '../../kit/stage'
import { chrome, nickel, rubber } from '../../kit/materials'
import { nextFrame } from '../../core/yield'

/*
 * ENCORE — the set. After the last song: the guitar alone on its A-frame
 * stand on a spike-tape mark, plugged in, its cable curling across the
 * planks to a combo amp waiting in the dark with its jewel lamp on. A pick
 * someone dropped. One shaft of light comes down through the haze behind
 * the stand (Beam, below) and pools on the boards.
 *
 * World space (1 unit = 10 cm): the floor is y = 0, the guitar stands at the
 * origin facing +Z (the audience), its neck up, bass side to the left (-x).
 */

export interface EncoreSet {
  group: THREE.Group
  guitar: Guitar
  amp: Amp
  beam: Beam
  /** the subject's framing box (guitar + stand), world */
  subject: { c: THREE.Vector3; hw: number; hh: number }
  /** a point at the guitar's heart (the spot aims here) */
  heart: THREE.Vector3
}

/** black powder-coated steel */
const steel = () => new THREE.MeshStandardMaterial({ color: '#121010', metalness: 0.55, roughness: 0.42 })

/** a straight tube between two points (for merging) */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 10) {
  const len = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true)
  g.translate(0, len / 2, 0)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize()))
  g.translate(a.x, a.y, a.z)
  return g.toNonIndexed()
}

/** a bent tube through points (for merging) */
function bend(points: THREE.Vector3[], r: number, seg = 24) {
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  return new THREE.TubeGeometry(c, seg, r, 10, false).toNonIndexed()
}

/** a ball joint / end cap */
function ball(p: THREE.Vector3, r: number) {
  const g = new THREE.SphereGeometry(r, 12, 8)
  g.translate(p.x, p.y, p.z)
  return g.toNonIndexed()
}

/** strip attributes down to position + normal so every piece merges */
function clean(g: THREE.BufferGeometry) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
  return g
}

/**
 * The A-frame stand, built around the guitar's real contact points: two
 * rubber-lined cradle cups under the lower bout, a front A leaning in behind
 * the body, a rear A, and a rubber-lined yoke that holds the neck.
 */
function buildStand(g: Guitar) {
  const G = g.group
  G.updateMatrixWorld(true)
  const W = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(G.matrixWorld)
  const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).transformDirection(G.matrixWorld)
  const tubes: THREE.BufferGeometry[] = []
  const pads: THREE.BufferGeometry[] = []
  const R = 0.085

  // the neck yoke (a U around the back of the neck at the 3rd fret)
  const nx = fretX(3)
  const neckBack = W(nx, 0, -0.17)
  const face = dir(0, 0, 1) // the guitar's face normal
  const across = dir(0, 1, 0) // across the neck
  const U: THREE.Vector3[] = []
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * Math.PI
    U.push(
      neckBack
        .clone()
        .addScaledVector(across, 0.31 * Math.cos(t))
        .addScaledVector(face, 0.3 - 0.36 * Math.sin(t)),
    )
  }
  pads.push(bend(U, 0.06, 28))
  const yokeFoot = neckBack.clone().addScaledVector(face, -0.14).add(new THREE.Vector3(0, -0.1, 0))

  // the front A: feet either side, behind the body; apex under the yoke
  const apex = new THREE.Vector3(yokeFoot.x, yokeFoot.y - 1.8, yokeFoot.z - 0.24)
  const fl = new THREE.Vector3(-1.32, 0.06, -0.98)
  const fr = new THREE.Vector3(1.32, 0.06, -0.98)
  tubes.push(rod(fl, apex, R), rod(fr, apex, R), rod(apex, yokeFoot, R * 0.9))
  // the rear A (the kick-stand), hinged just under the apex
  const hinge = apex.clone().add(new THREE.Vector3(0, -0.2, -0.12))
  const rl = new THREE.Vector3(-1.02, 0.06, -3.7)
  const rr = new THREE.Vector3(1.02, 0.06, -3.7)
  tubes.push(rod(rl, hinge, R), rod(rr, hinge, R))
  // a tie bar low across the front A
  const tieY = 0.9
  const onLeg = (a: THREE.Vector3, b: THREE.Vector3, y: number) => a.clone().lerp(b, (y - a.y) / (b.y - a.y))
  tubes.push(rod(onLeg(fl, apex, tieY), onLeg(fr, apex, tieY), R * 0.8))
  // foam sleeves where the body leans on the front A
  pads.push(rod(onLeg(fl, apex, 1.5), onLeg(fl, apex, 3.1), R * 1.45), rod(onLeg(fr, apex, 1.5), onLeg(fr, apex, 3.1), R * 1.45))

  // the lower cradle: arms from the front feet, forward under the lower bout,
  // turning up into rubber cups in front of the body
  for (const s of [1, -1]) {
    const cup = W(-1.6, s * 1.1, -0.18)
    const foot = s > 0 ? fl : fr
    const lip = cup.clone().addScaledVector(face, 0.36).add(new THREE.Vector3(0, 0.1, 0))
    const under = cup.clone().add(new THREE.Vector3(0, -0.13, 0))
    tubes.push(
      bend(
        [
          foot.clone().add(new THREE.Vector3(0, 0.02, 0)),
          new THREE.Vector3(foot.x * 0.94, 0.34, foot.z + 0.42),
          under.clone().addScaledVector(face, -0.28),
        ],
        R,
        16,
      ),
    )
    pads.push(bend([under.clone().addScaledVector(face, -0.3), under, under.clone().addScaledVector(face, 0.24), lip], 0.1, 20))
    tubes.push(ball(under.clone().addScaledVector(face, -0.29), R * 1.05))
  }
  // rubber feet
  for (const f of [fl, fr, rl, rr]) pads.push(ball(new THREE.Vector3(f.x, 0.06, f.z), 0.12))
  tubes.push(ball(apex, R * 1.25), ball(hinge, R * 1.15), ball(yokeFoot, R * 1.05))

  const frame = new THREE.Mesh(mergeGeometries(tubes.map(clean)), steel())
  frame.castShadow = true
  frame.receiveShadow = true
  const rub = rubber()
  rub.roughness = 0.8
  const foam = new THREE.Mesh(mergeGeometries(pads.map(clean)), rub)
  foam.castShadow = true
  foam.receiveShadow = true
  const group = new THREE.Group()
  group.name = 'stand'
  group.add(frame, foam)
  // a chrome wing screw at the hinge
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12).rotateZ(Math.PI / 2), chrome(0.12))
  screw.position.copy(hinge).add(new THREE.Vector3(0.12, 0, 0))
  group.add(screw)
  return group
}

/** the classic rounded-triangle pick, in amber celluloid */
function pick() {
  const s = new THREE.Shape()
  const r = 0.16
  s.moveTo(0, -r * 1.25)
  s.bezierCurveTo(r * 0.55, -r * 0.7, r * 1.2, r * 0.25, r * 0.95, r * 0.72)
  s.bezierCurveTo(r * 0.7, r * 1.08, -r * 0.7, r * 1.08, -r * 0.95, r * 0.72)
  s.bezierCurveTo(-r * 1.2, r * 0.25, -r * 0.55, -r * 0.7, 0, -r * 1.25)
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false, curveSegments: 10 })
  geo.rotateX(-Math.PI / 2)
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: '#c46a1c', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }))
  m.receiveShadow = true
  return m
}

/* ------------------------------------------------------------------ the beam */

const BEAM_VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

/*
 * One shaft of light through the haze, shaded analytically (no additive
 * cone seams): the FRONT faces of a bounding cone start the view ray; the
 * ray's closest approach to the beam's axis (clipped to the floor plane)
 * gives a soft Gaussian across the shaft, brighter toward its source; slow
 * 3D noise at that point is the haze drifting through it.
 */
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uApex;
  uniform vec3 uAxis;
  uniform vec3 uColor;
  uniform float uTan;
  uniform float uLen;
  uniform float uAmount;
  uniform float uTime;
  varying vec3 vW;

  float bhash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float bnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(bhash(i + vec3(0, 0, 0)), bhash(i + vec3(1, 0, 0)), f.x),
                   mix(bhash(i + vec3(0, 1, 0)), bhash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(bhash(i + vec3(0, 0, 1)), bhash(i + vec3(1, 0, 1)), f.x),
                   mix(bhash(i + vec3(0, 1, 1)), bhash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vW - ro);
    float tIn = length(vW - ro);
    // where the ray meets the floor (y = 0)
    float tFloor = rd.y < -1e-4 ? -ro.y / rd.y : 1e6;
    // closest approach of the ray to the axis line
    vec3 w0 = ro - uApex;
    float b = dot(rd, uAxis);
    float d = dot(rd, w0);
    float e = dot(uAxis, w0);
    float den = max(1.0 - b * b, 1e-4);
    float t = (b * e - d) / den;
    t = clamp(t, tIn, max(tIn, tFloor));
    vec3 P = ro + rd * t;
    float s = dot(P - uApex, uAxis);
    float r = length(P - uApex - uAxis * s);
    float R = max(s, 0.05) * uTan;
    float q = r / R;
    float across = exp(-2.6 * q * q);
    // brighter toward the source, fading out before the floor
    float along = smoothstep(0.0, 0.18 * uLen, s) * (0.55 + 0.45 * (1.0 - smoothstep(0.1 * uLen, uLen, s)));
    float floorFade = 1.0 - smoothstep(0.86 * uLen, 1.02 * uLen, s);
    // haze drifting through it
    vec3 np = P * 0.16 + vec3(uTime * 0.05, -uTime * 0.035, uTime * 0.02);
    float n = bnoise(np) * 0.62 + bnoise(np * 2.3 + 7.0) * 0.38;
    float haze = 0.4 + 1.05 * n;
    // looking up the shaft toward its source scatters more light
    float look = max(dot(-rd, uAxis), 0.0);
    float phase = 0.75 + 0.9 * look * look * look;
    float v = uAmount * across * along * floorFade * haze * phase;
    gl_FragColor = vec4(uColor * v, 1.0);
  }
`

export interface Beam {
  mesh: THREE.Mesh
  set(amount: number, time: number): void
}

/** a shaft from `apex` down to `to` (world), half-angle `angle` */
function buildBeam(apex: THREE.Vector3, to: THREE.Vector3, angle: number, color: THREE.ColorRepresentation): Beam {
  const axis = new THREE.Vector3().subVectors(to, apex)
  const len = axis.length()
  axis.normalize()
  const tanA = Math.tan(angle)
  // a bounding cone a little wider than the shaft's glow, apex at the origin, opening down -Y
  const geo = new THREE.ConeGeometry(len * tanA * 1.9, len * 1.04, 40, 1, true)
  geo.translate(0, -len * 0.52, 0)
  const uniforms = {
    uApex: { value: apex.clone() },
    uAxis: { value: axis.clone() },
    uColor: { value: new THREE.Color(color) },
    uTan: { value: tanA },
    uLen: { value: len },
    uAmount: { value: 0 },
    uTime: { value: 0 },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    side: THREE.FrontSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.copy(apex)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis)
  mesh.frustumCulled = false
  mesh.renderOrder = 4
  return {
    mesh,
    set(amount, time) {
      uniforms.uAmount.value = amount
      uniforms.uTime.value = time
      mesh.visible = amount > 0.002
    },
  }
}

/** the beam's soft pool on the boards (additive, never fogged) */
function pool(at: THREE.Vector3, rx: number, rz: number, color: THREE.ColorRepresentation) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: new THREE.Color(color),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2, rz * 2), mat)
  m.rotation.x = -Math.PI / 2
  m.position.set(at.x, 0.006, at.z)
  m.renderOrder = 2
  return m
}

/**
 * The boards fall away into the dark: no far edge, no horizon line (the
 * house is down; only the light near the guitar reaches the floor).
 */
function fadeFloor(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFloorXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorXZ = (modelMatrix * vec4(position, 1.0)).xz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFloorXZ;')
      .replace(
        '#include <dithering_fragment>',
        `{
          vec2 fd = (vFloorXZ - vec2(-1.5, -2.5)) * vec2(1.0, 1.25);
          float keep = 1.0 - smoothstep(8.0, 30.0, length(fd));
          gl_FragColor.rgb *= 0.35 + 0.65 * keep;
          gl_FragColor.a *= keep;
        }
        #include <dithering_fragment>`,
      )
  }
  mat.customProgramCacheKey = () => 'encore-floor'
  // the far boards dissolve into the backdrop's smoke instead of ending in a line
  mat.transparent = true
}

/* ------------------------------------------------------------------ build */

export async function buildSet(mobile: boolean): Promise<EncoreSet & { beamPool: THREE.Mesh }> {
  const group = new THREE.Group()
  group.name = 'encore'

  // the guitar, standing, leaning back ~8° into its stand, turned a touch
  const guitar = buildGuitar({ mobile })
  guitar.group.rotation.set(-0.14, 0.12, Math.PI / 2 + 0.02)
  guitar.group.position.set(0, 2.42, 0)
  guitar.group.updateMatrixWorld(true)
  group.add(guitar.group)
  // this instance's headstock lacquer is a touch less mirror-like: under a
  // tight spot (and the oxblood rim) its bevelled edge threw bloom-sized
  // stars at the top of the frame, brighter than the amp's jewel
  {
    const face = guitar.parts.headstock.children[0] as THREE.Mesh
    const mats = (Array.isArray(face.material) ? face.material : [face.material]) as THREE.MeshPhysicalMaterial[]
    mats.forEach((m, i) => {
      if (!m.isMeshPhysicalMaterial) return
      // [0] the black face, [1] the bevelled edge and sides
      m.clearcoatRoughness = Math.max(m.clearcoatRoughness, i === 0 ? 0.1 : 0.32)
      if (i === 1) m.clearcoat = 0.5
    })
  }
  await nextFrame()

  group.add(buildStand(guitar))

  // the boards, and the spike-tape X that marks where the guitar lives
  const floor = stageFloor(240, 160)
  fadeFloor(floor.material as THREE.MeshStandardMaterial)
  group.add(floor)
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const t = gaffer(1.3, 0.3, '#b9ae97')
    t.rotation.z = a
    t.position.set(0.25, 0.004, 1.0)
    group.add(t)
  }
  const pk = pick()
  pk.position.set(1.95, 0.004, 2.2)
  pk.rotation.y = 0.9
  group.add(pk)
  await nextFrame()

  // the amp waiting in the dark, turned toward the guitar, lamp on
  const amp = buildAmp({ kind: 'combo', grille: 'oxblood', labels: ['Volume', 'Treble', 'Middle', 'Bass', 'Reverb'] })
  amp.group.position.set(-6.4, 0, -8.6)
  amp.group.rotation.y = 0.5
  amp.group.updateMatrixWorld(true)
  amp.setPilot(1)
  group.add(amp.group)

  // the cable: out of the jack on the lower treble rim, a lazy curl across
  // the boards, back behind the stand to the amp's input
  const G = guitar.group
  const jack = new THREE.Vector3(-1.02, -1.6, -0.23).applyMatrix4(G.matrixWorld)
  const out = new THREE.Vector3(-0.3, -0.95, 0).transformDirection(G.matrixWorld)
  const plugBody = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 14), nickel(0.2))
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.036, 0.26, 12), rubber())
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out)
  plugBody.quaternion.copy(q)
  plugBody.position.copy(jack).addScaledVector(out, 0.18)
  relief.quaternion.copy(q)
  relief.position.copy(jack).addScaledVector(out, 0.49)
  plugBody.castShadow = relief.castShadow = true
  group.add(plugBody, relief)
  const plugEnd = jack.clone().addScaledVector(out, 0.6)
  const input = new THREE.Vector3(-2.72, 4.62, amp.size.z / 2 + 0.05).applyMatrix4(amp.group.matrixWorld)
  const ampOut = new THREE.Vector3(0, 0, 1).transformDirection(amp.group.matrixWorld)
  const inPlug = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.34, 14), nickel(0.2))
  inPlug.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ampOut)
  inPlug.position.copy(input).addScaledVector(ampOut, 0.17)
  group.add(inPlug)
  const inEnd = input.clone().addScaledVector(ampOut, 0.5)
  const r = 0.04
  const fl = (x: number, z: number) => new THREE.Vector3(x, r, z)
  const path = [
    plugEnd,
    plugEnd.clone().addScaledVector(out, 0.25).add(new THREE.Vector3(0.05, -0.35, 0.1)),
    new THREE.Vector3(plugEnd.x + 0.5, 0.25, plugEnd.z + 0.55),
    fl(plugEnd.x + 0.62, plugEnd.z + 1.15),
    fl(2.6, 2.6),
    fl(1.7, 3.35),
    fl(0.9, 2.95),
    fl(1.25, 2.2),
    fl(2.35, 1.2),
    fl(2.5, -0.6),
    fl(1.4, -2.9),
    fl(-1.6, -5.2),
    fl(inEnd.x + 1.3, inEnd.z + 1.6),
    new THREE.Vector3(inEnd.x + 0.35, 0.3, inEnd.z + 0.5),
    new THREE.Vector3(inEnd.x + 0.12, 2.2, inEnd.z + 0.3),
    inEnd,
  ]
  group.add(cable(path, 0.04))
  await nextFrame()

  // the shaft of light: steep, from the rig above and behind, pooling on the
  // boards just behind the stand (the guitar stands in front of it)
  const beamTo = new THREE.Vector3(1.4, 0, -3.2)
  const beam = buildBeam(new THREE.Vector3(-5.5, 36, -18), beamTo, 0.06, '#ffcf8a')
  group.add(beam.mesh)
  const beamPool = pool(beamTo, 3.2, 2.6, '#ff9d45')
  group.add(beamPool)

  const subject = { c: new THREE.Vector3(0.05, 5.15, -0.3), hw: 2.05, hh: 5.35 }
  const heart = new THREE.Vector3(0.1, 4.3, -0.1)
  return { group, guitar, amp, beam, subject, heart, beamPool }
}
