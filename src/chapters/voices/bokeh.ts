import * as THREE from 'three'
import { rng } from '../../core/math'

/*
 * Out-of-focus stage lamps beyond the headstock — what a long lens wide open
 * does to the backline's jewel lamps, pedal LEDs and the footlights: soft
 * discs with a faint brighter rim (a lens's bokeh), amber, tungsten and a
 * little red, world-anchored so they slide past as the camera glides. They
 * make the shot read SHALLOW without a depth-of-field pass.
 *
 * Points with world-unit sizes, additive, no depth write (the guitar still
 * hides them). Calm: they hold still (no shimmer).
 */

export interface Bokeh {
  points: THREE.Points
  update(frame: { time: number }, calm: boolean): void
  /** overall brightness 0..1 */
  level: number
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aSeed;
  uniform float uScale;
  uniform float uTime;
  varying vec3 vColor;
  varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(2.0, aSize * uScale / max(0.5, -mv.z));
    vColor = aColor * (0.9 + 0.1 * sin(uTime * 0.7 + aSeed * 40.0));
    vSeed = aSeed;
  }
`
const FRAG = /* glsl */ `
  uniform float uLevel;
  varying vec3 vColor;
  varying float vSeed;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    // a lens wide open: a round disc with the faintest trace of the blades,
    // a soft edge, a slightly brighter rim and a hint of onion-ring texture
    float a = atan(p.y, p.x) + vSeed * 6.2831;
    float d = r * (1.0 + 0.012 * cos(8.0 * a));
    float disc = 1.0 - smoothstep(0.72, 1.0, d);
    float rim = smoothstep(0.5, 0.9, d) * disc;
    float ring = 0.94 + 0.06 * sin(d * 18.0 + vSeed * 9.0);
    float body = disc * (0.5 + 0.34 * rim) * ring;
    if (body < 0.002) discard;
    gl_FragColor = vec4(vColor * body * uLevel, 1.0);
  }
`

export function buildBokeh(mobile: boolean): Bokeh {
  const r = rng(77)
  const n = mobile ? 70 : 110
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const size = new Float32Array(n)
  const seed = new Float32Array(n)
  const palette = ['#ffb45a', '#ff9a3a', '#ffd08a', '#ff5a36', '#ffc070', '#e8402a']
  const c = new THREE.Color()
  for (let i = 0; i < n; i++) {
    // a wide band beyond the headstock: low lamps near the floor, some higher
    // lamps on and just above the stage floor beyond the headstock (pedal
    // LEDs, wedge monitors, the backline's jewel lamps), a few up on the truss
    const along = 6 + Math.pow(r(), 1.15) * 30
    const across = (r() - 0.5) * (12 + along * 1.2)
    const high = r() < 0.18
    const h = high ? 2 + r() * (2 + along * 0.1) : 0.06 + Math.pow(r(), 1.8) * (0.4 + along * 0.05)
    const big = r() < 0.22
    pos[i * 3] = along
    pos[i * 3 + 1] = h
    pos[i * 3 + 2] = across
    c.set(palette[Math.floor(r() * palette.length)])
    const k = (0.12 + Math.pow(r(), 1.5) * 0.42) * (big ? 0.45 : 1)
    col[i * 3] = c.r * k
    col[i * 3 + 1] = c.g * k
    col[i * 3 + 2] = c.b * k
    // bigger the further out of focus (further away): world diameter
    size[i] = (0.12 + along * (0.01 + r() * 0.02)) * (big ? 2.2 : 1)
    seed[i] = r()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const uniforms = {
    uScale: { value: 400 },
    uTime: { value: 0 },
    uLevel: { value: 1 },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = -2
  const out: Bokeh = {
    points,
    level: 1,
    update(frame, calm) {
      if (!calm) uniforms.uTime.value = frame.time
      uniforms.uLevel.value = out.level
    },
  }
  return out
}

/** keep the point size in step with the viewport (px per world unit at distance 1) */
export function bokehScale(b: Bokeh, heightPx: number, fovDeg: number) {
  const m = b.points.material as THREE.ShaderMaterial
  m.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)))
}
