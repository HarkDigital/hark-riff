import * as THREE from 'three'
import { FONT, tile } from '../../kit/materials'
import { MARK_PATHS } from '../../ui/mark'

/*
 * THE STAGE SCREEN — a ground-stacked LED video wall (4 × 3 cabinets, faint
 * seams) that shows each project's screenshot. When a pedal is stomped its
 * project cross-fades in (never through black) and the pedal's effect
 * treats the image as it lands, then lets go within ~0.6 s of TIME:
 *
 *   0 Overdrive  a warm push (exposure + tungsten tint)
 *   1 Delay      decaying echo copies trailing right
 *   2 Chorus     a slight RGB wobble
 *   3 Fuzz       grain + saturation crunch
 *   4 Phaser     one soft band sweeping across
 *   5 Reverb     a soft wash (blur + glow) that clears
 *
 * Settled, it is the plain screenshot, crisp. The wall is lit by itself, so
 * the output is pre-compensated for the ACES tone map in the output pass
 * (invACES): whites land at ~0.84 display, below the chapter's bloom
 * threshold (no glow veil over the text). Calm (reduced motion / Motion
 * off): a plain 0.3 s cross-fade, no effects.
 */

const FADE = 0.3
const FX_TIME = 0.62

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float uMix;
  uniform float uFx;
  uniform float uK;
  uniform float uP;
  uniform float uLevel;
  uniform float uTime;
  uniform float uExposure;
  uniform vec2 uCab;
  varying vec2 vUv;

  const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
  // three's ACESFilmicToneMapping, inverted (so the output pass lands on the screenshot's own values)
  const mat3 IOUT = mat3(vec3(0.64304, 0.05927, 0.00596), vec3(0.31119, 0.93144, 0.06393), vec3(0.04578, 0.00929, 0.93012));
  const mat3 IIN = mat3(vec3(1.76474, -0.14703, -0.03634), vec3(-0.67578, 1.16025, -0.16244), vec3(-0.08896, -0.01322, 1.19877));
  vec3 ifit(vec3 u) {
    u = clamp(u, 0.0, 0.97);
    vec3 A = 1.0 - 0.983729 * u;
    vec3 B = 0.0245786 - 0.432951 * u;
    vec3 C = -(0.000090537 + 0.238081 * u);
    return (-B + sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
  }
  vec3 invAces(vec3 y) {
    vec3 u = max(IOUT * y, 0.0);
    return max(IIN * ifit(u), 0.0) * 0.6 / max(uExposure, 0.05);
  }
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 img(sampler2D t, vec2 uv) { return texture2D(t, clamp(uv, 0.001, 0.999)).rgb; }

  vec3 treated(vec2 uv) {
    float k = uK;
    vec3 c = img(tB, uv);
    if (k < 0.001) return c;
    if (uFx < 0.5) {
      // OVERDRIVE: a warm push that settles
      vec3 hot = c * vec3(1.32, 1.04, 0.72) + vec3(0.07, 0.03, 0.0);
      c = mix(c, hot, k);
    } else if (uFx < 1.5) {
      // DELAY: evenly spaced repeats trailing right, each quieter, closing up as they die away
      float o = 0.055 * (0.35 + 0.65 * k);
      vec3 e1 = img(tB, uv - vec2(o, 0.0));
      vec3 e2 = img(tB, uv - vec2(2.0 * o, 0.0));
      vec3 e3 = img(tB, uv - vec2(3.0 * o, 0.0));
      vec3 e = (c * 0.46 + e1 * 0.27 + e2 * 0.17 + e3 * 0.1);
      c = mix(c, e, k);
    } else if (uFx < 2.5) {
      // CHORUS: the channels drift apart and back (one and a half slow swings)
      float w = sin(uP * 9.4248);
      float wav = sin(uv.y * 24.0 + uP * 7.0) * 0.0035 * k;
      vec2 d = vec2(0.008 * k * w + wav, 0.0);
      c = vec3(img(tB, uv + d).r, img(tB, uv + vec2(wav * 0.4, 0.0)).g, img(tB, uv - d).b);
    } else if (uFx < 3.5) {
      // FUZZ: saturated, crunched, grainy
      float l = dot(c, LUM);
      vec3 sat = max(mix(vec3(l), c, 1.0 + 1.3 * k), 0.0);
      vec3 crunch = smoothstep(0.06, 0.8, sat) * vec3(1.08, 0.95, 0.82);
      float n = hash(floor(uv * vec2(400.0, 250.0)) + floor(uTime * 24.0) * 1.37) - 0.5;
      c = mix(c, crunch + n * 0.2, k);
    } else if (uFx < 4.5) {
      // PHASER: one soft band sweeps across, bending the image as it passes
      float bx = mix(-0.3, 1.3, uP);
      float dx = (uv.x - bx) / 0.17;
      float band = exp(-dx * dx);
      vec2 u2 = uv + vec2(0.0, sin(uv.x * 46.0) * 0.005 * band * k);
      c = img(tB, u2);
      vec3 tint = c * vec3(1.18, 0.8, 1.06) + vec3(0.05, 0.0, 0.035);
      c = mix(c, tint, band * k);
    } else {
      // REVERB: a soft wash that clears
      float r = 0.02 * k;
      vec3 b = c;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        b += img(tB, uv + vec2(cos(a), sin(a) * 1.6) * r);
      }
      b /= 9.0;
      c = mix(c, b * 1.1 + vec3(0.045, 0.035, 0.025), k);
    }
    return c;
  }

  void main() {
    // screen-space derivatives first (never inside a branch)
    vec2 cu = vUv * uCab;
    vec2 fw = max(fwidth(cu), vec2(1e-5));
    vec2 pu = vUv * vec2(192.0, 120.0);
    float pw = fwidth(pu.x);

    vec3 col = mix(img(tA, vUv), treated(vUv), uMix);

    // an LED wall: its dot matrix shows while an image lands, then resolves
    vec2 pf = fract(pu) - 0.5;
    float dotm = 1.0 - smoothstep(0.2, 0.5, length(pf));
    float dm = 0.5 * uK * uMix * (1.0 - smoothstep(0.22, 0.4, pw));
    col *= mix(1.0, 0.5 + 0.8 * dotm, dm);
    // cabinet seams (hairlines)
    vec2 dd = abs(fract(cu + 0.5) - 0.5) / fw;
    float seam = max(1.0 - smoothstep(0.3, 1.2, dd.x), 1.0 - smoothstep(0.3, 1.2, dd.y));
    col *= 1.0 - 0.28 * seam;

    // never past ~0.86 display: a pushed highlight must not cross the bloom threshold
    gl_FragColor = vec4(invAces(min(max(col, 0.0) * uLevel, vec3(0.86))), 1.0);
  }
`

/** the wall's standby card: the Hark mark, cream on a warm black field */
export function standbyTexture(): THREE.Texture {
  return tile(
    'work-standby',
    640,
    400,
    (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h * 0.46, 10, w / 2, h / 2, w * 0.62)
      grad.addColorStop(0, '#3a2213')
      grad.addColorStop(0.55, '#170d08')
      grad.addColorStop(1, '#070403')
      g.fillStyle = grad
      g.fillRect(0, 0, w, h)
      const s = (h * 0.38) / 1889.9
      g.save()
      g.translate(w / 2 - (1889.6 * s) / 2, h * 0.43 - (1889.9 * s) / 2)
      g.scale(s, s)
      g.fillStyle = '#e9dcc0'
      for (const d of [...MARK_PATHS.loops, MARK_PATHS.diamond]) if (d) g.fill(new Path2D(d))
      g.restore()
      g.fillStyle = 'rgba(233,220,192,0.6)'
      g.font = FONT.mono(15, 600)
      g.textAlign = 'center'
      g.fillText('S T A N D B Y', w / 2, h * 0.8)
    },
    { repeat: false },
  )
}

export class StageScreen {
  mesh: THREE.Mesh
  /** the wall's own light on the stage (driven, never toggled) */
  light: THREE.PointLight
  /** soft spill round the wall (additive, under the bloom threshold) */
  halo: THREE.Mesh
  /** time-damped average colour of what's on the wall (linear) */
  glow = new THREE.Color('#3a2213')
  private mat: THREE.ShaderMaterial
  private haloMat: THREE.ShaderMaterial
  private a: THREE.Texture
  private b: THREE.Texture
  private mixT = 1
  private fxT = FX_TIME
  private fx = -1
  private calm = false
  private avg = new Map<THREE.Texture, THREE.Color>()
  private target = new THREE.Color('#3a2213')

  constructor(w: number, h: number, standby: THREE.Texture) {
    this.a = this.b = standby
    this.avg.set(standby, new THREE.Color('#2a160c'))
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: standby },
        tB: { value: standby },
        uMix: { value: 1 },
        uFx: { value: -1 },
        uK: { value: 0 },
        uP: { value: 1 },
        uLevel: { value: 0.84 },
        uTime: { value: 0 },
        uExposure: { value: 1 },
        uCab: { value: new THREE.Vector2(4, 3) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat)
    this.mesh.name = 'led-wall'

    this.haloMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uAspect: { value: w / h } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAspect;
        varying vec2 vUv;
        void main() {
          // falls off outside the wall's rectangle (the plane is 1.9x the wall)
          vec2 p = abs(vUv - 0.5) * 1.9;
          vec2 q = max(p - 0.5, 0.0) * vec2(uAspect, 1.0);
          float d = length(q);
          float a = exp(-d * 3.2) * (1.0 - smoothstep(0.35, 0.5, max(q.x / uAspect, q.y) * 0.55 + 0.2));
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.9, h * 1.9), this.haloMat)
    this.halo.renderOrder = 1

    this.light = new THREE.PointLight('#ffb070', 0, 60, 1.1)
  }

  /** remember a texture's average colour (read BEFORE its first upload frees the canvas) */
  measure(tex: THREE.Texture) {
    const src = tex.image as CanvasImageSource | undefined
    const c = document.createElement('canvas')
    c.width = c.height = 4
    const g = c.getContext('2d', { willReadFrequently: true })
    const col = new THREE.Color('#6a6a6a')
    if (g && src) {
      try {
        g.drawImage(src, 0, 0, 4, 4)
        const d = g.getImageData(0, 0, 4, 4).data
        let r = 0
        let gg = 0
        let b = 0
        for (let i = 0; i < 64; i += 4) {
          r += d[i]
          gg += d[i + 1]
          b += d[i + 2]
        }
        col.setRGB(r / 16 / 255, gg / 16 / 255, b / 16 / 255, THREE.SRGBColorSpace)
      } catch {
        /* tainted or detached: keep the neutral */
      }
    }
    this.avg.set(tex, col)
  }

  /** is this texture on the wall (or arriving)? */
  showing(tex: THREE.Texture) {
    return this.b === tex
  }

  /**
   * Put `tex` on the wall. `fx` = the pedal's effect (0..5) or -1; `instant`
   * snaps (teleports, first frame); calm = reduced motion / Motion off.
   */
  show(tex: THREE.Texture, fx: number, { instant = false, calm = false } = {}) {
    if (tex === this.b) return
    const u = this.mat.uniforms
    if (instant) {
      this.a = this.b = tex
      this.mixT = FADE
      this.fxT = FX_TIME
    } else {
      // mid-fade (a fast back-and-forth): keep whichever image dominates
      const m = this.mixT / FADE
      if (m >= 0.5) this.a = this.b
      this.b = tex
      this.mixT = 0
      this.fxT = 0
    }
    this.fx = fx
    this.calm = calm
    u.tA.value = this.a
    u.tB.value = this.b
    u.uFx.value = fx
    this.target.copy(this.avg.get(tex) ?? this.target)
    if (instant) this.glow.copy(this.target)
  }

  get busy() {
    return this.mixT < FADE || this.fxT < FX_TIME
  }

  update(dt: number, time: number, exposure: number, calm: boolean) {
    const u = this.mat.uniforms
    this.calm = calm
    this.mixT = Math.min(FADE, this.mixT + dt)
    this.fxT = Math.min(FX_TIME, this.fxT + dt)
    const m = this.mixT / FADE
    u.uMix.value = m * m * (3 - 2 * m)
    const p = this.fxT / FX_TIME
    u.uP.value = p
    // the effect holds as the image lands, then lets go (gone by FX_TIME)
    const r = Math.min(1, Math.max(0, (p - 0.12) / 0.88))
    u.uK.value = this.calm || this.fx < 0 ? 0 : 1 - r * r * (3 - 2 * r)
    u.uTime.value = time
    u.uExposure.value = exposure
    this.glow.lerp(this.target, 1 - Math.exp(-dt * 4))
  }

  setLevel(v: number) {
    this.mat.uniforms.uLevel.value = v
  }

  /** the spill round the wall and its light on the stage, from what's on it */
  setSpill(halo: number, light: number) {
    const hc = this.haloMat.uniforms.uColor.value as THREE.Color
    hc.copy(this.glow).multiplyScalar(halo)
    this.light.color.copy(this.glow).lerp(new THREE.Color('#ffc890'), 0.35)
    this.light.intensity = light
  }
}
