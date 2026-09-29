import * as THREE from 'three'
import type { Frame } from '../core/types'

/*
 * Six guitar strings that VIBRATE. Each string is a camera-facing ribbon
 * whose width is the string's radius at rest (never thinner than ~1 device
 * pixel: a coverage floor keeps a 0.25 mm string visible and anti-aliased at
 * any distance) and spreads into the vibration ENVELOPE when it rings — the
 * lens-shaped blur a camera sees, brighter at its two edges (a sine spends
 * most of its time at the turning points), fading as the energy spreads.
 *
 * Two looks:
 *  - blur (default): the envelope, like a photograph at a normal shutter
 *  - wobble 0..1: the ROLLING-SHUTTER look of a phone filming a guitar —
 *    the string is crisp but bent into slow travelling waves
 *
 * Amplitudes are units (1 unit = 10 cm): 0.01–0.03 is a hard strum. Drive them
 * from `local` (screenshot-safe) or with a time-decaying Ring (below) for a
 * pluck that keeps ringing — but keep strums rate-limited by TIME.
 *
 * Wound strings (E A D) show their winding when crisp. The strings are lit by
 * `tint` × `light` (set them to the stage light hitting them) plus a hot
 * specular glint from `lightDir` (world space). They cast hairline shadows
 * from the world's follow spot through invisible shadow-caster cylinders.
 */

export interface StringsOptions {
  /** bridge-end anchor of each string (object space), low E first */
  from: THREE.Vector3[]
  /** nut-end anchor */
  to: THREE.Vector3[]
  /** radius per string (units) */
  radius?: number[]
  wound?: boolean[]
  /** object-space direction the strings swing in (default: across the board, +y) */
  swing?: THREE.Vector3
  segments?: number
}

const VERT = /* glsl */ `
  attribute float aU;
  attribute float aSide;
  attribute float aStr;
  uniform vec3 uA[6];
  uniform vec3 uB[6];
  uniform float uR[6];
  uniform float uAmp[6];
  uniform float uWound[6];
  uniform vec3 uSwing;
  uniform float uPx;
  uniform float uTime;
  uniform float uWobble;
  varying float vS;
  varying float vPx;
  varying float vCov;
  varying float vBlur;
  varying float vU;
  varying float vWound;
  varying vec3 vN;
  varying vec3 vV;

  void main() {
    int i = int(aStr + 0.5);
    vec3 A = uA[i];
    vec3 B = uB[i];
    float r = uR[i];
    float amp = uAmp[i];
    vec3 P = mix(A, B, aU);
    vec4 wp = modelMatrix * vec4(P, 1.0);
    vec3 T = normalize(mat3(modelMatrix) * (B - A));
    vec3 V = normalize(cameraPosition - wp.xyz);
    vec3 side = cross(T, V);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(0.0, 0.0, 1.0);
    vec3 swingW = normalize(mat3(modelMatrix) * uSwing);
    // the envelope: fundamental plus a slowly beating second partial
    float fi = float(i);
    float shape = sin(3.14159265 * aU) * (1.0 + 0.16 * sin(6.2831853 * aU) * sin(uTime * 1.7 + fi * 1.3));
    float env = amp * abs(shape) * max(0.3, abs(dot(swingW, side)));
    // rolling shutter: crisp, bent into a travelling wave
    float wob = clamp(uWobble, 0.0, 1.0);
    float centre = wob * env * sin(3.14159265 * aU * (3.0 + fi * 0.6) - uTime * (2.6 + fi * 0.35));
    float hw0 = r + env * (1.0 - wob);
    float px = uPx * distance(cameraPosition, wp.xyz);
    float halfW = max(hw0, 0.6 * px);
    float ext = halfW + px;
    vec3 pos = wp.xyz + side * (centre + aSide * ext);
    vS = aSide * ext / halfW;
    vPx = px / halfW;
    // coverage: a string thinner than a pixel, or spread by vibration, is fainter
    vCov = clamp(r / halfW + (hw0 < 0.6 * px ? 0.3 : 0.0), 0.0, 1.0);
    vBlur = (1.0 - wob) * smoothstep(0.5 * r, 3.0 * r + 0.3 * px, env);
    vU = aU * distance(A, B);
    vWound = uWound[i];
    vN = side;
    vV = V;
    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLight;
  uniform vec3 uLightDir;
  uniform float uOpacity;
  varying float vS;
  varying float vPx;
  varying float vCov;
  varying float vBlur;
  varying float vU;
  varying float vWound;
  varying vec3 vN;
  varying vec3 vV;

  void main() {
    float s = abs(vS);
    float inside = 1.0 - smoothstep(1.0 - vPx, 1.0 + vPx, s);
    if (inside <= 0.0) discard;
    // crisp: a lit metal cylinder (normal swings across the ribbon)
    float x = clamp(vS, -1.0, 1.0);
    vec3 N = normalize(vN * x + vV * sqrt(max(1.0 - x * x, 0.0)));
    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + vV);
    float spec = pow(max(dot(N, H), 0.0), 48.0);
    float diff = 0.35 + 0.65 * max(dot(N, L), 0.0);
    // a stage full of lights: a bright sheen band along the string
    float sheen = pow(1.0 - abs(x + 0.25), 3.0);
    float wind = mix(1.0, 0.72 + 0.28 * abs(sin(vU * 420.0)), vWound);
    vec3 crisp = uColor * uLight * (diff * 0.55 + sheen * 0.7) * wind + uLight * spec * 2.2;
    // blurred: the time-average of a swinging string — brighter at its edges
    float dens = 0.64 / sqrt(max(1.0 - s * s, 0.06));
    vec3 blur = uColor * uLight * 0.95 * dens;
    vec3 col = mix(crisp, blur, vBlur);
    float a = inside * vCov * mix(1.0, min(dens, 2.5), vBlur) * uOpacity;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`

export class Strings {
  group = new THREE.Group()
  mesh: THREE.Mesh
  /** vibration amplitude per string (units); write every frame */
  amp = new Float32Array(6)
  /** 0..1 rolling-shutter look */
  wobble = 0
  /** colour of the string metal and the light on it */
  tint = new THREE.Color('#e6e1d6')
  light = new THREE.Color('#ffd8a8')
  /** world-space direction the key light comes FROM (for the glint) */
  lightDir = new THREE.Vector3(0.3, 1, 0.6)
  opacity = 1
  private uniforms: Record<string, THREE.IUniform>
  private shadowCasters: THREE.Mesh[] = []
  private from: THREE.Vector3[]
  private to: THREE.Vector3[]
  private radius: number[]
  private size = new THREE.Vector2()

  constructor(opts: StringsOptions) {
    const n = 6
    const seg = opts.segments ?? 96
    this.from = opts.from.map(v => v.clone())
    this.to = opts.to.map(v => v.clone())
    this.radius = opts.radius ?? [0.0058, 0.0046, 0.0034, 0.0024, 0.0017, 0.0013]
    const wound = opts.wound ?? [true, true, true, false, false, false]

    const verts = n * (seg + 1) * 2
    const aU = new Float32Array(verts)
    const aSide = new Float32Array(verts)
    const aStr = new Float32Array(verts)
    const pos = new Float32Array(verts * 3)
    const index: number[] = []
    let v = 0
    for (let s = 0; s < n; s++) {
      const base = v
      for (let k = 0; k <= seg; k++) {
        const u = k / seg
        for (const side of [-1, 1]) {
          aU[v] = u
          aSide[v] = side
          aStr[v] = s
          const p = new THREE.Vector3().lerpVectors(this.from[s], this.to[s], u)
          pos.set([p.x, p.y, p.z], v * 3)
          v++
        }
        if (k < seg) {
          const a = base + k * 2
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aU', new THREE.BufferAttribute(aU, 1))
    geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1))
    geo.setAttribute('aStr', new THREE.BufferAttribute(aStr, 1))
    geo.setIndex(index)

    this.uniforms = {
      uA: { value: this.from },
      uB: { value: this.to },
      uR: { value: this.radius },
      uAmp: { value: Array.from(this.amp) },
      uWound: { value: wound.map(w => (w ? 1 : 0)) },
      uSwing: { value: (opts.swing ?? new THREE.Vector3(0, 1, 0.35)).clone().normalize() },
      uPx: { value: 0.001 },
      uTime: { value: 0 },
      uWobble: { value: 0 },
      uColor: { value: this.tint },
      uLight: { value: this.light },
      uLightDir: { value: this.lightDir },
      uOpacity: { value: 1 },
    }
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.group.add(this.mesh)

    // invisible cylinders that throw the strings' hairline shadows
    const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true)
    for (let s = 0; s < n; s++) {
      const m = new THREE.Mesh(cyl, shadowMat)
      const a = this.from[s]
      const b = this.to[s]
      m.position.lerpVectors(a, b, 0.5)
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize())
      const r = this.radius[s] * 1.3
      m.scale.set(r, a.distanceTo(b), r)
      m.castShadow = true
      m.renderOrder = -1
      this.shadowCasters.push(m)
      this.group.add(m)
    }
  }

  /** Call every frame the strings are visible. */
  update(frame: Frame, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    renderer.getDrawingBufferSize(this.size)
    const u = this.uniforms
    // world size of one device pixel at distance 1
    u.uPx.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, this.size.y)
    u.uTime.value = frame.time
    u.uWobble.value = frame.reducedMotion ? 0 : this.wobble
    u.uOpacity.value = this.opacity
    const amp = u.uAmp.value as number[]
    for (let i = 0; i < 6; i++) {
      amp[i] = frame.reducedMotion ? Math.min(this.amp[i], this.radius[i] * 1.5) : this.amp[i]
      const r = this.radius[i] * 1.3 + amp[i] * 0.5
      this.shadowCasters[i].scale.x = this.shadowCasters[i].scale.z = r
    }
  }

  /** world position of a point on string `i` at `u` (0 = bridge, 1 = nut) */
  point(i: number, u: number, out = new THREE.Vector3()) {
    return out.lerpVectors(this.from[i], this.to[i], u).applyMatrix4(this.group.matrixWorld)
  }
}

/**
 * A pluck that rings and decays over TIME (seconds), with a minimum gap
 * between strikes so a fast scroll can't machine-gun it. `value(time)` is
 * the current amplitude envelope 0..1.
 */
export class Ring {
  private at = -1e9
  private peak = 0
  constructor(
    public decay = 1.6,
    public minGap = 0.35,
  ) {}
  strike(time: number, strength = 1) {
    if (time - this.at < this.minGap) return false
    this.peak = Math.max(strength, this.value(time))
    this.at = time
    return true
  }
  value(time: number) {
    const t = time - this.at
    if (t < 0) return 0
    // a fast attack (30 ms) then an exponential ring-out
    return this.peak * Math.min(1, t / 0.03) * Math.exp(-t / this.decay)
  }
}
