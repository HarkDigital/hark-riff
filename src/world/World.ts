import * as THREE from 'three'
import type { Frame } from '../core/types'

/*
 * The shared world for Hark RIFF: a dark rock stage between songs.
 *
 *  - BACKDROP (a camera-centred dome): warm stage black, a band of backlit
 *    HAZE (smoke lit amber from behind the backline), BEAMS fanning down
 *    from an unseen truss through the haze in gel colours (they sway slowly,
 *    like moving heads), and out-of-focus BOKEH of the truss lights (world-
 *    anchored, so they parallax as the camera moves).
 *  - THE FOLLOW SPOT (the ONLY shadow caster): warm tungsten from above and
 *    in front. Chapters aim it every frame (spotPos → spotAt, cone angle).
 *    Strings throw hairline shadows on the fretboard under it. Give props
 *    castShadow / receiveShadow yourself; keep tiny props from casting.
 *  - TWO RIM LIGHTS (gel PARs behind the subject, no shadows): directions are
 *    relative to the camera (rimADir / rimBDir: x right, y up, z toward the
 *    camera — so negative z is BEHIND the subject), colours rimA/rimB.
 *  - FILL: a very low warm hemisphere.
 *  - STAGE REFLECTIONS (PMREM, built at construction): a black room with a
 *    ROW OF PAR CANS overhead, a warm softbox (the spot) and amber / red
 *    washes at the sides — so lacquer and nickel catch a row of hot dots,
 *    the signature of a guitar photographed on stage.
 *
 * Keep what the engine calls: `object`, `params`, `resetParams()`,
 * `update(frame, camera)`, `warmEnv()`, `envMap`. Chapters set params every
 * frame they care; the engine resets them first; values are damped.
 */

export interface WorldParams {
  /** backdrop gradient (keep near black) */
  top: THREE.ColorRepresentation
  bottom: THREE.ColorRepresentation
  /** 0..1.5 backlit smoke behind the subject, its colour and screen height (-1..1) */
  haze: number
  hazeColor: THREE.ColorRepresentation
  hazeY: number
  /** 0..1.5 stage beams through the haze, their two gel colours, 0..1 sway */
  beams: number
  beamA: THREE.ColorRepresentation
  beamB: THREE.ColorRepresentation
  sway: number
  /** 0..1.5 out-of-focus truss lights (world-anchored) and their gels */
  bokeh: number
  bokehA: THREE.ColorRepresentation
  bokehB: THREE.ColorRepresentation
  /** the follow spot: intensity, colour, where it hangs, what it hits, cone (radians), penumbra 0..1 */
  spot: number
  spotColor: THREE.ColorRepresentation
  spotPos: THREE.Vector3
  spotAt: THREE.Vector3
  spotAngle: number
  spotPenumbra: number
  /** rim lights (camera-relative directions they come FROM) */
  rimA: number
  rimAColor: THREE.ColorRepresentation
  rimADir: THREE.Vector3
  rimB: number
  rimBColor: THREE.ColorRepresentation
  rimBDir: THREE.Vector3
  /** hemisphere fill */
  fill: number
  /** stage reflections strength and yaw (sweep the PAR row across lacquer) */
  env: number
  envTurn: number
}

/** The gels: the palette of stage light every chapter draws from. */
export const GEL = {
  tungsten: '#ffc88a',
  amber: '#ffa640',
  straw: '#ffd98a',
  red: '#ff3a26',
  oxblood: '#9a1f16',
  magenta: '#ff3d7a',
  steel: '#8fb0ff',
  white: '#fff4e6',
}

export const WORLD_DEFAULTS = {
  top: '#0b0706',
  bottom: '#020101',
  haze: 0.55,
  hazeColor: '#b0582a',
  hazeY: -0.15,
  beams: 0.45,
  beamA: GEL.amber,
  beamB: GEL.red,
  sway: 0.5,
  bokeh: 0.35,
  bokehA: GEL.amber,
  bokehB: GEL.red,
  spot: 0,
  spotColor: GEL.tungsten,
  spotAngle: 0.42,
  spotPenumbra: 0.55,
  rimA: 0,
  rimAColor: GEL.amber,
  rimB: 0,
  rimBColor: GEL.red,
  fill: 0.08,
  env: 1,
  envTurn: 0,
}

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uTop, uBottom, uHazeC, uBeamA, uBeamB, uBokehA, uBokehB;
  uniform float uHaze, uHazeY, uBeams, uSway, uBokeh, uTime, uMobile;
  uniform vec2 uRes;
  varying vec3 vDir;

  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float smoke(vec2 p) {
    float t = uTime * 0.035;
    float n = noise(p * 1.3 + vec2(t, -t * 0.6)) * 0.55;
    n += noise(p * 2.7 - vec2(t * 1.4, t * 0.3)) * 0.3;
    n += noise(p * 5.3 + vec2(-t, t * 2.0)) * 0.15;
    return n;
  }

  void main() {
    vec3 dir = normalize(vDir);
    // screen space (aspect-corrected, y up)
    vec2 s = gl_FragCoord.xy / uRes * 2.0 - 1.0;
    float aspect = uRes.x / uRes.y;
    s.x *= aspect;

    vec3 c = mix(uBottom, uTop, smoothstep(-1.1, 1.0, s.y));
    float sm = smoke(s * 0.9 + dir.xz * 0.6);

    // HAZE: a band of backlit smoke behind the subject
    if (uHaze > 0.001) {
      float band = exp(-(s.y - uHazeY) * (s.y - uHazeY) / 0.42);
      float side = exp(-s.x * s.x / (2.2 * aspect));
      c += uHazeC * uHaze * band * side * (0.35 + 0.9 * sm) * 0.42;
    }

    // BEAMS: fanned from sources above the frame, only visible in the smoke
    if (uBeams > 0.001) {
      float b = 0.0;
      vec3 bc = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float sx = (fi - 2.5) * 0.62 * aspect * 0.55;
        vec2 src = vec2(sx, 1.35);
        vec2 v = s - src;
        float ang = atan(v.x, -v.y);
        float aim = -sx * 0.32 + uSway * 0.22 * sin(uTime * 0.23 + fi * 1.7);
        float w = 0.055 + 0.02 * fract(fi * 0.37);
        float beam = exp(-(ang - aim) * (ang - aim) / (w * w));
        float fall = 1.0 / (1.0 + dot(v, v) * 0.55);
        float k = beam * fall * smoothstep(0.0, 0.3, -v.y);
        b += k;
        bc += k * (mod(fi, 2.0) < 1.0 ? uBeamA : uBeamB);
      }
      c += bc * uBeams * (0.25 + 0.95 * sm) * 0.34;
    }

    // BOKEH: out-of-focus truss lights, anchored to the world
    if (uBokeh > 0.001) {
      float phi = atan(dir.x, -dir.z);
      float el = asin(clamp(dir.y, -1.0, 1.0));
      vec2 g = vec2(phi * 5.0, el * 5.0 - 0.4);
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = hash(id + 7.1);
      if (id.y >= 0.0 && id.y <= 3.0 && h > 0.35) {
        vec2 o = vec2(hash(id + 1.3), hash(id + 5.9)) - 0.5;
        float r = mix(0.12, 0.26, hash(id + 3.3));
        float d = length(f - o * 0.25) / r;
        float disc = 1.0 - smoothstep(0.86, 1.0, d);
        float rim = smoothstep(0.7, 0.97, d) * disc;
        float bright = mix(0.4, 1.0, hash(id + 9.7)) * (0.85 + 0.15 * sin(uTime * 0.6 + h * 30.0));
        vec3 col = hash(id + 2.2) > 0.5 ? uBokehA : uBokehB;
        c += col * (disc * 0.55 + rim * 0.5) * bright * uBokeh * 0.5 * (1.0 - 0.25 * id.y / 3.0);
      }
    }

    c += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither: no banding
    gl_FragColor = vec4(c, 1.0);
  }
`

export class World {
  object = new THREE.Group()
  /** stage reflections (PMREM); materials may use it directly */
  envMap: THREE.Texture
  spot: THREE.SpotLight
  rimA: THREE.DirectionalLight
  rimB: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  params: WorldParams
  private dome: THREE.Mesh
  private scene: THREE.Scene
  private cur = {
    top: new THREE.Color(),
    bottom: new THREE.Color(),
    hazeColor: new THREE.Color(),
    beamA: new THREE.Color(),
    beamB: new THREE.Color(),
    bokehA: new THREE.Color(),
    bokehB: new THREE.Color(),
    spotColor: new THREE.Color(),
    rimAColor: new THREE.Color(),
    rimBColor: new THREE.Color(),
    spotPos: new THREE.Vector3(),
    spotAt: new THREE.Vector3(),
    n: {} as Record<string, number>,
  }
  private first = true
  private uniforms = {
    uTop: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uHazeC: { value: new THREE.Color() },
    uBeamA: { value: new THREE.Color() },
    uBeamB: { value: new THREE.Color() },
    uBokehA: { value: new THREE.Color() },
    uBokehB: { value: new THREE.Color() },
    uHaze: { value: 0 },
    uHazeY: { value: 0 },
    uBeams: { value: 0 },
    uSway: { value: 0 },
    uBokeh: { value: 0 },
    uTime: { value: 0 },
    uMobile: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  }
  private tmpC = new THREE.Color()
  private tmpV = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()
  private fwd = new THREE.Vector3()

  constructor(scene: THREE.Scene, mobile: boolean, renderer?: THREE.WebGLRenderer) {
    this.scene = scene
    this.params = World.defaults()
    this.uniforms.uMobile.value = mobile ? 1 : 0

    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
      }),
    )
    this.dome.frustumCulled = false
    this.dome.renderOrder = -10
    this.object.add(this.dome)

    // THE FOLLOW SPOT — the only shadow caster. Never toggle it: drive intensity.
    this.spot = new THREE.SpotLight(GEL.tungsten, 0, 0, 0.42, 0.55, 1.2)
    this.spot.castShadow = true
    this.spot.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
    this.spot.shadow.bias = -0.00025
    this.spot.shadow.normalBias = 0.012
    this.spot.shadow.radius = 2
    this.spot.shadow.camera.near = 0.5
    this.spot.shadow.camera.far = 80
    this.object.add(this.spot, this.spot.target)

    this.rimA = new THREE.DirectionalLight(GEL.amber, 0)
    this.rimB = new THREE.DirectionalLight(GEL.red, 0)
    this.object.add(this.rimA, this.rimA.target, this.rimB, this.rimB.target)
    this.hemi = new THREE.HemisphereLight(0xffd6b0, 0x1a0c08, WORLD_DEFAULTS.fill)
    this.object.add(this.hemi)

    this.envMap = renderer ? buildStageEnv(renderer) : new THREE.Texture()
    scene.environment = this.envMap
    scene.environmentIntensity = WORLD_DEFAULTS.env
  }

  static defaults(): WorldParams {
    return {
      ...WORLD_DEFAULTS,
      spotPos: new THREE.Vector3(2, 14, 10),
      spotAt: new THREE.Vector3(0, 0, 0),
      rimADir: new THREE.Vector3(-0.8, 0.7, -1),
      rimBDir: new THREE.Vector3(0.9, 0.5, -1),
    }
  }

  /** the engine calls this before prewarm: lit programs key on the environment */
  warmEnv() {
    this.scene.environment = this.envMap
  }

  resetParams() {
    const p = this.params
    const spotPos = p.spotPos.set(2, 14, 10)
    const spotAt = p.spotAt.set(0, 0, 0)
    const a = p.rimADir.set(-0.8, 0.7, -1)
    const b = p.rimBDir.set(0.9, 0.5, -1)
    Object.assign(p, WORLD_DEFAULTS)
    p.spotPos = spotPos
    p.spotAt = spotAt
    p.rimADir = a
    p.rimBDir = b
  }

  update(frame: Frame, camera: THREE.Camera) {
    const p = this.params
    const c = this.cur
    const n = c.n
    const colors = ['top', 'bottom', 'hazeColor', 'beamA', 'beamB', 'bokehA', 'bokehB', 'spotColor', 'rimAColor', 'rimBColor'] as const
    const nums = ['haze', 'hazeY', 'beams', 'sway', 'bokeh', 'spot', 'spotAngle', 'spotPenumbra', 'rimA', 'rimB', 'fill', 'env', 'envTurn'] as const
    const k = this.first ? 1 : 1 - Math.exp(-5 * frame.dt)
    for (const key of colors) c[key].lerp(this.tmpC.set(p[key]), k)
    for (const key of nums) n[key] = this.first ? p[key] : n[key] + (p[key] - n[key]) * k
    // the spot's aim follows faster (it tracks a performer)
    const ks = this.first ? 1 : 1 - Math.exp(-9 * frame.dt)
    c.spotPos.lerp(p.spotPos, ks)
    c.spotAt.lerp(p.spotAt, ks)
    this.first = false

    const u = this.uniforms
    u.uTop.value.copy(c.top)
    u.uBottom.value.copy(c.bottom)
    u.uHazeC.value.copy(c.hazeColor)
    u.uBeamA.value.copy(c.beamA)
    u.uBeamB.value.copy(c.beamB)
    u.uBokehA.value.copy(c.bokehA)
    u.uBokehB.value.copy(c.bokehB)
    u.uHaze.value = n.haze
    u.uHazeY.value = n.hazeY
    u.uBeams.value = n.beams
    u.uSway.value = frame.reducedMotion ? 0 : n.sway
    u.uBokeh.value = n.bokeh
    u.uTime.value = frame.time
    u.uRes.value.set(frame.width, frame.height)

    // the dome follows the camera; the lights live in world space
    this.dome.position.copy(camera.position)

    const s = this.spot
    s.intensity = n.spot * 120
    s.color.copy(c.spotColor)
    s.angle = n.spotAngle
    s.penumbra = n.spotPenumbra
    s.position.copy(c.spotPos)
    s.target.position.copy(c.spotAt)
    s.target.updateMatrixWorld()
    // no shadow render while the spot is dark (the program keys stay the same)
    s.shadow.autoUpdate = n.spot > 0.002
    // fit the shadow depth range to the throw: with near 0.5 / far 80 the bias
    // swallowed occluders within ~0.4 units (strings 0.035 above the board)
    {
      const d = c.spotPos.distanceTo(c.spotAt)
      const near = Math.max(0.5, Math.round((d - 13) * 4) / 4)
      const far = Math.round((d + 22) * 4) / 4
      const sc = s.shadow.camera
      if (sc.near !== near || sc.far !== far) {
        sc.near = near
        sc.far = far
        sc.updateProjectionMatrix()
      }
    }

    // rim lights: directions relative to the camera's orientation
    camera.getWorldQuaternion(this.tmpQ)
    const fwd = camera.getWorldDirection(this.fwd)
    const rim = (l: THREE.DirectionalLight, dir: THREE.Vector3, amount: number, col: THREE.Color) => {
      l.intensity = amount * 3
      l.color.copy(col)
      this.tmpV.copy(dir).normalize().applyQuaternion(this.tmpQ)
      l.target.position.copy(camera.position).addScaledVector(fwd, 10)
      l.position.copy(l.target.position).addScaledVector(this.tmpV, 30)
      l.target.updateMatrixWorld()
    }
    rim(this.rimA, p.rimADir, n.rimA, c.rimAColor)
    rim(this.rimB, p.rimBDir, n.rimB, c.rimBColor)

    this.hemi.intensity = n.fill
    this.scene.environmentIntensity = n.env
    this.scene.environmentRotation.set(0, n.envTurn, 0)
  }
}

/**
 * The stage as a reflection: black room, a row of PAR cans on the front
 * truss (hot warm dots), a second row further back, a big soft overhead
 * (the spot's glow), amber and red side washes, a faint cool back wash.
 */
function buildStageEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene()
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#070404'), side: THREE.BackSide }),
  )
  env.add(room)
  const lamp = (color: string, power: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power) })
  const disc = new THREE.CircleGeometry(1, 24)
  // front truss: a row of PAR cans above and in front of the subject
  const frontRow = lamp('#ffc07a', 14)
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(disc, frontRow)
    const x = (i - 4) * 3.2
    m.position.set(x, 13, 14)
    m.scale.setScalar(0.62)
    m.lookAt(0, 0, 0)
    env.add(m)
  }
  // back truss: gels
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(disc, lamp(i % 2 ? '#ff4a2a' : '#ffa640', 7))
    m.position.set((i - 3) * 4.4, 11, -16)
    m.scale.setScalar(0.8)
    m.lookAt(0, 0, 0)
    env.add(m)
  }
  // the spot's glow overhead
  const soft = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), lamp('#ffd9a8', 1.6))
  soft.position.set(2, 22, 6)
  soft.lookAt(0, 0, 0)
  env.add(soft)
  // side washes
  const wash = (color: string, power: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 22), lamp(color, power))
    m.position.set(x, 2, z)
    m.lookAt(0, 2, 0)
    env.add(m)
  }
  wash('#ff8a2a', 0.5, -30, 4)
  wash('#e0301c', 0.42, 30, 0)
  wash('#4a64c8', 0.12, 0, -32)
  // a warm floor bounce
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), lamp('#2a140a', 1))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -8
  env.add(floor)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(env, 0.02)
  pmrem.dispose()
  env.traverse(o => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
  })
  return rt.texture
}
