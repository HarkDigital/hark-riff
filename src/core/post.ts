import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { MARK_PATHS } from '../ui/mark'

/*
 * Post-processing: Scene (+ Sanitize NaN guard) → Bloom → Output → FIELD → FINAL.
 * Only the scene render is multisampled (its own target, the only one with a
 * depth buffer); the composer's ping-pong targets are single-sampled.
 *
 * Earlier concepts' final passes: Orbit glitch + zoom blur; Resonance ripple;
 * Press riso halftone; Town tilt-shift + cloud wipe; Arcade pixel + CRT;
 * Frost breath fog; Contour flood; Primetime replay stinger; Noir
 * silver-gelatin + blinds; Neon light trails + lights-out; Opal colour field.
 *
 * RIFF: a concert photograph. A warm tungsten grade (shadows fall to a brown
 * black, highlights go cream and amber, a gentle S-curve), a smoky warm lift
 * for haze, film grain, a deep vignette — and THE CAB CUT: approaching a
 * chapter boundary the frame is pushed toward you like a speaker cone on a
 * kick (a radial bulge), while basketweave GRILLE CLOTH closes in from the
 * edges. At the boundary the whole frame is the front of a 4x12 cab — the
 * cloth lit by the scene's own light (a 1/32-res copy of the frame, so its
 * brightness stays steady: never a flash), four speaker cones faintly behind
 * it and the Hark mark piped on as the badge between them. After the boundary the cloth
 * opens from the center and the next scene thumps out of it.
 * Calm (reduced motion / Motion off): the engine fades through near-black.
 *
 * The final pass runs AFTER the sRGB output pass: it sees display values.
 * Keep the Post API (params / resetParams / setSize / render / compileAsync /
 * setFadeTone) and the uTransition / uFade / uFlash / uGlitch uniforms.
 * uGlitch (params.glitch) is the THUMP here: a small speaker-cone push a
 * chapter can punch on a downbeat (zeroed under reduced motion by the engine).
 */

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** 1/32-res copy of the frame (FIELD pass), bilinear */
    tField: { value: null as THREE.Texture | null },
    uFieldTexel: { value: new THREE.Vector2(1 / 64, 1 / 36) },
    /** the Hark mark (white on transparent) for the cab badge */
    tMark: { value: null as THREE.Texture | null },
    uMarkOn: { value: 0 },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDpr: { value: 1 },
    /** 0..1, peaks exactly at a chapter boundary (engine-driven) */
    uTransition: { value: 0 },
    /** 0..1 the THUMP: a speaker-cone push (radial magnify), no cut */
    uGlitch: { value: 0 },
    uAberration: { value: 0 },
    uGrain: { value: 0.03 },
    uVignette: { value: 0.55 },
    /** 0..1 wash to white */
    uFlash: { value: 0 },
    /** 0..1 fade to uFadeColor (calm cuts) */
    uFade: { value: 0 },
    uCutColor: { value: new THREE.Color('#0b0806').convertLinearToSRGB() },
    uFadeColor: { value: new THREE.Color('#0b0806').convertLinearToSRGB() },
    /** 0..1 speed dim: the whole frame dims while the page moves fast (flash safety net) */
    uSpeedDim: { value: 0 },
    /** vibrance (1 = none) and black-point lift (toward the warm haze colour) */
    uSat: { value: 1.06 },
    uLift: { value: 0.012 },
    uHaze: { value: new THREE.Color('#5a3322').convertLinearToSRGB() },
    /** 0..1 the tungsten grade */
    uWarmth: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tField;
    uniform sampler2D tMark;
    uniform vec2 uFieldTexel;
    uniform float uMarkOn;
    uniform float uTime, uDpr, uTransition, uGlitch, uAberration, uGrain, uVignette, uFlash, uFade, uSpeedDim, uSat, uLift, uWarmth;
    uniform vec2 uResolution;
    uniform vec3 uCutColor, uFadeColor, uHaze;
    varying vec2 vUv;

    const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

    // a smooth read of the low-res field (5 bilinear taps)
    vec3 field(vec2 uv) {
      vec2 o = uFieldTexel;
      return (texture2D(tField, uv).rgb * 2.0
        + texture2D(tField, uv + vec2(o.x, o.y)).rgb
        + texture2D(tField, uv + vec2(-o.x, o.y)).rgb
        + texture2D(tField, uv + vec2(o.x, -o.y)).rgb
        + texture2D(tField, uv + vec2(-o.x, -o.y)).rgb) / 6.0;
    }
    // the frame's mean colour (16 taps of the field)
    vec3 fieldMean() {
      vec3 m = vec3(0.0);
      for (int y = 0; y < 4; y++)
        for (int x = 0; x < 4; x++)
          m += texture2D(tField, vec2(0.125 + 0.25 * float(x), 0.125 + 0.25 * float(y))).rgb;
      return m / 16.0;
    }

    // BASKETWEAVE grille cloth, woven on the diagonal: cells alternate
    // horizontal / vertical runs of three round threads that dive under at
    // the cell edges. Returns thread shading 0..1 (0 = the gap).
    float weave(vec2 px, out float tone) {
      float cellPx = max(6.0, uResolution.y / 96.0);
      vec2 p = px / cellPx;
      vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.70710678;
      vec2 id = floor(q);
      vec2 f = fract(q);
      bool h = mod(id.x + id.y, 2.0) < 1.0;
      float across = h ? f.y : f.x;
      float along = h ? f.x : f.y;
      float th = fract(across * 3.0);
      float tid = floor(across * 3.0);
      float prof = sqrt(max(sin(3.14159265 * th), 0.0));
      float dive = 0.5 + 0.5 * sin(3.14159265 * along);
      tone = 0.82 + 0.3 * hash(id * 3.7 + tid + (h ? 0.0 : 11.0));
      return prof * mix(0.45, 1.0, dive);
    }

    // four 12-inch cones behind the cloth (a 4x12 cab), aspect-corrected coords
    float speakers(vec2 a, float aspect, out float ring) {
      float r = 0.205;
      vec2 cx = vec2(min(0.24 * aspect, 0.5 * aspect - 0.25), 0.235);
      ring = 0.0;
      float cone = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 o = vec2(i == 0 || i == 2 ? -cx.x : cx.x, i < 2 ? cx.y : -cx.y);
        float d = length(a - o);
        cone = max(cone, 1.0 - smoothstep(r - 0.004, r + 0.01, d));
        ring = max(ring, (1.0 - smoothstep(0.0, 0.012, abs(d - r - 0.006))));
        // the dust cap
        cone -= 0.35 * (1.0 - smoothstep(0.05, 0.058, d));
      }
      return clamp(cone, 0.0, 1.0);
    }

    vec3 grade(vec3 col) {
      // tungsten: shadows sink to a brown black, highlights go cream-amber
      float l = dot(col, LUM);
      vec3 sh = vec3(1.0, 0.84, 0.74);
      vec3 hi = vec3(1.03, 0.98, 0.88);
      vec3 tint = mix(sh, hi, smoothstep(0.05, 0.6, l));
      col *= mix(vec3(1.0), tint, uWarmth);
      // a gentle S-curve (toe keeps the stage black, shoulder keeps the cream)
      col = clamp(col, 0.0, 1.0);
      vec3 s = col * col * (3.0 - 2.0 * col);
      return mix(col, s, 0.28 * uWarmth);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      vec2 a = c * vec2(aspect, 1.0);
      float r = length(a) / length(vec2(aspect, 1.0) * 0.5);

      float t = clamp(uTransition, 0.0, 1.0);
      // the cone push: a kick drum on the cut, a small thump on a downbeat
      float push = 0.16 * smoothstep(0.0, 1.0, t) + 0.035 * clamp(uGlitch, 0.0, 1.0);
      vec2 suv = 0.5 + c * (1.0 - push * (1.0 - 0.7 * r * r));

      vec3 col;
      if (uAberration > 0.00001) {
        col.r = texture2D(tDiffuse, suv + c * uAberration).r;
        col.g = texture2D(tDiffuse, suv).g;
        col.b = texture2D(tDiffuse, suv - c * uAberration).b;
      } else col = texture2D(tDiffuse, suv).rgb;

      col = grade(col);

      // THE CAB CUT
      if (t > 0.001) {
        // the cloth closes in from the edges (iris), soft-edged, a little uneven
        float R = 1.2 - 1.36 * smoothstep(0.04, 0.96, t);
        float edge = 0.16 + 0.06 * sin(atan(a.y, a.x) * 5.0 + uTime * 0.7);
        float cover = smoothstep(R - edge, R + edge, r + 0.04 * (hash(floor(gl_FragCoord.xy / 3.0)) - 0.5));
        cover = max(cover, smoothstep(0.9, 1.0, t));
        float tone;
        float w = weave(gl_FragCoord.xy, tone);
        // lit by the scene behind: its local light plus a steady floor from the mean
        vec3 m = fieldMean();
        vec3 lf = field(suv);
        float ml = dot(m, LUM);
        vec3 light = mix(vec3(ml), lf, 0.7);
        // hold the cloth at a steady, modest brightness whatever the scene (no flash)
        float target = clamp(ml * 1.3 + 0.07, 0.08, 0.2);
        vec3 lh = light / max(dot(light, LUM), 1e-3);
        lh = mix(vec3(1.0), lh, 0.45);
        vec3 thread = vec3(0.86, 0.66, 0.4) * lh; // gold wheat, tinted by the stage
        float ring;
        float cone = speakers(a, aspect, ring);
        float behind = 1.0 - 0.34 * cone + 0.12 * ring;
        vec3 cloth = thread * (w * tone) * behind * (target / 0.42) + vec3(0.012, 0.008, 0.006);
        // the badge: the Hark mark piped in cream at the centre of the baffle
        if (uMarkOn > 0.5) {
          vec2 bp = a / 0.13 + 0.5;
          if (bp.x > 0.0 && bp.x < 1.0 && bp.y > 0.0 && bp.y < 1.0) {
            float mk = texture2D(tMark, bp).a;
            cloth = mix(cloth, vec3(0.93, 0.88, 0.78) * (target / 0.2) * 1.4, mk * smoothstep(0.55, 0.9, t));
          }
        }
        col = mix(col, cloth, cover);
      }

      col *= 1.0 - clamp(uSpeedDim, 0.0, 0.8);
      float l = dot(col, LUM);
      col = max(mix(vec3(l), col, uSat), 0.0);
      col = uLift * uHaze * 3.0 + col * (1.0 - uLift);
      col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
      float v = 1.0 - smoothstep(0.3, 1.05, length(c * vec2(1.0, 0.92)) * 1.42);
      col *= mix(1.0, 0.42 + 0.58 * v, uVignette);
      // film grain, strongest in the mids
      vec2 gp = floor(vUv * uResolution / max(1.0, uDpr));
      float gl = dot(col, LUM);
      float gw = 0.6 + 1.6 * gl * (1.0 - gl);
      col += (hash(gp + fract(floor(uTime * 24.0) * 0.1317) * 97.0) - 0.5) * uGrain * gw;
      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

/** minimum seconds between two white-flash onsets (WCAG 2.3.1) */
const FLASH_GAP = 0.4

export type PostParams = {
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  aberration: number
  grain: number
  vignette: number
  /** the THUMP 0..1: a speaker-cone push (chapters punch it on a downbeat) */
  glitch: number
  /** white wash 0..1 */
  flash: number
  exposure: number
  /** vibrance (1 = none) */
  saturation: number
  /** black-point lift 0..0.15, toward the warm haze colour (smoke in the light) */
  lift: number
  /** 0..1 the tungsten grade */
  warmth: number
}

/**
 * Bloom on the hot stuff: tube glow, jewel lights, lamp filaments, the
 * brightest glints on nickel and lacquer. A dark stage, so the threshold
 * can sit a little lower than a white studio's.
 */
export const POST_DEFAULTS: PostParams = {
  bloomStrength: 0.55,
  bloomRadius: 0.55,
  bloomThreshold: 0.88,
  aberration: 0,
  grain: 0.03,
  vignette: 0.55,
  glitch: 0,
  flash: 0,
  exposure: 1,
  saturation: 1.06,
  lift: 0.012,
  warmth: 1,
}

/**
 * Scrubs NaN/Inf and clamps runaway HDR right after the scene render. A single
 * bad fragment would otherwise smear across the whole frame through bloom.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a);
    }
  `,
}

/**
 * Renders the scene into its OWN target — the only multisampled one and the
 * only one with depth — then sanitizes (NaN guard) into the composer's
 * single-sampled read buffer. Multisampled ping-pong targets cost 2–3x per
 * post pass (Frost's lesson), so MSAA lives here only.
 */
class ScenePass extends Pass {
  target: THREE.WebGLRenderTarget
  material: THREE.ShaderMaterial
  private quad: FullScreenQuad
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    samples: number,
  ) {
    super()
    this.needsSwap = false
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples })
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(SanitizeShader.uniforms),
      vertexShader: SanitizeShader.vertexShader,
      fragmentShader: SanitizeShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.material)
  }
  setSize(w: number, h: number) {
    this.target.setSize(w, h)
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this.target)
    renderer.clear()
    renderer.render(this.scene, this.camera)
    this.material.uniforms.tDiffuse.value = this.target.texture
    renderer.setRenderTarget(this.renderToScreen ? null : read)
    this.quad.render(renderer)
  }
}

/**
 * FIELD: a 1/32-res copy of the frame for the colour-field cut, made in two
 * box-filtered steps (1/8, then 1/32). Doesn't touch the ping-pong buffers
 * (needsSwap false); skipped entirely when no cut is on screen.
 */
const DownShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec2 o = uTexel;
      vec3 c = texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb
        + texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb + texture2D(tDiffuse, vUv + vec2(o.x, o.y)).rgb;
      gl_FragColor = vec4(c * 0.25, 1.0);
    }
  `,
}

class FieldPass extends Pass {
  a = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, depthBuffer: false })
  b = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, depthBuffer: false })
  material = new THREE.ShaderMaterial({ ...DownShader, uniforms: THREE.UniformsUtils.clone(DownShader.uniforms), depthTest: false, depthWrite: false })
  private quad = new FullScreenQuad(this.material)
  active = false
  constructor() {
    super()
    this.needsSwap = false
  }
  setSize(w: number, h: number) {
    this.a.setSize(Math.max(8, Math.round(w / 8)), Math.max(8, Math.round(h / 8)))
    this.b.setSize(Math.max(4, Math.round(w / 32)), Math.max(4, Math.round(h / 32)))
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    if (!this.active) return
    const u = this.material.uniforms
    u.tDiffuse.value = read.texture
    u.uTexel.value.set(1 / read.width, 1 / read.height).multiplyScalar(2)
    renderer.setRenderTarget(this.a)
    this.quad.render(renderer)
    u.tDiffuse.value = this.a.texture
    u.uTexel.value.set(1 / this.a.width, 1 / this.a.height).multiplyScalar(1.5)
    renderer.setRenderTarget(this.b)
    this.quad.render(renderer)
  }
}

/** The Hark mark, cream on transparent, for the cab cut's badge (drawn once). */
function markBadge(): THREE.Texture {
  const size = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')!
  const k = size / 1889.9
  g.scale(k, k)
  g.fillStyle = '#fff'
  for (const d of [...MARK_PATHS.loops, MARK_PATHS.diamond]) if (d) g.fill(new Path2D(d))
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.NoColorSpace
  tex.flipY = true
  return tex
}

export class Post {
  composer: EffectComposer
  bloom: UnrealBloomPass
  final: ShaderPass
  private scenePass: ScenePass
  /**
   * Chapters write targets here every frame (the engine resets them to
   * defaults first); values are damped so nothing pops at a cut.
   */
  params: PostParams = { ...POST_DEFAULTS }
  private current: PostParams = { ...POST_DEFAULTS }
  transition = 0
  fade = 0
  /** engine: reduced motion or the visitor's Motion switch is off */
  calm = false
  /** engine: smoothed scroll velocity in viewport heights per second (signed) */
  velocity = 0
  /** engine: +1 when the nearest boundary is ahead (leaving a chapter), -1 when behind (entering) */
  cutSide = 1
  private speedDim = 0
  private field: FieldPass
  /**
   * Run right before the scene renders each frame, at the TOP level (camera
   * already placed, its matrixWorld updated). Mirrors/reflectors render here
   * instead of from Mesh.onBeforeRender: a nested render makes every lit
   * material re-resolve its program twice a frame. Check your own group's
   * visibility inside the hook (it runs whichever chapter is active).
   */
  preRender: ((renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void)[] = []
  private lastFlashAt = -1e9
  private flashLive = false
  private flashOk = true

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    /** skip MSAA (retina / mobile: already supersampled; MSAA half-float targets are huge) */
    noMsaa: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 0,
      depthBuffer: false,
    })
    this.composer = new EffectComposer(renderer, rt)
    this.scenePass = new ScenePass(scene, camera, noMsaa ? 0 : 4)
    this.composer.addPass(this.scenePass)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), POST_DEFAULTS.bloomStrength, POST_DEFAULTS.bloomRadius, POST_DEFAULTS.bloomThreshold)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.field = new FieldPass()
    this.composer.addPass(this.field)
    this.final = new ShaderPass(FinalShader)
    this.final.uniforms.tField.value = this.field.b.texture
    this.final.uniforms.tMark.value = markBadge()
    this.final.uniforms.uMarkOn.value = 1
    this.composer.addPass(this.final)
  }

  /** The scene's render target (HDR, linear; multisampled on 1x desktops) — prewarm compiles against it. */
  get sceneTarget() {
    return this.scenePass.target
  }

  /** true when `rt` is the frame's own scene target (not a mirror / transmission pass) */
  isFrameTarget(rt: THREE.WebGLRenderTarget | null) {
    return rt === this.scenePass.target || rt === this.composer.renderTarget1 || rt === this.composer.renderTarget2
  }

  /** THEME: colour the cut and calm fade pass through. */
  setCutColor(color: THREE.ColorRepresentation) {
    // display values (the final pass runs after the sRGB output pass)
    ;(this.final.uniforms.uCutColor.value as THREE.Color).set(color).convertLinearToSRGB()
    ;(this.final.uniforms.uFadeColor.value as THREE.Color).set(color).convertLinearToSRGB()
  }

  /** Engine hook (kept for compatibility; themes may tint the fade by scene tone). */
  setFadeTone(_tone: number) {}

  resetParams() {
    Object.assign(this.params, POST_DEFAULTS)
  }

  /**
   * Compile every post-processing shader in parallel so the first composer
   * render doesn't block on synchronous links.
   */
  compileAsync(): Promise<unknown> {
    // the same attribute set as FullScreenQuad (position + uv, no normal): a
    // PlaneGeometry compiles a different program variant that's never used
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2))
    const quad = new THREE.Mesh(geo)
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const b = this.bloom as unknown as Record<string, unknown>
    const mats: THREE.Material[] = []
    const add = (m: unknown) => {
      if (m && (m as THREE.Material).isMaterial) mats.push(m as THREE.Material)
    }
    for (const pass of this.composer.passes) add((pass as unknown as { material?: unknown }).material)
    for (const m of (b.separableBlurMaterials as unknown[]) ?? []) add(m)
    add(b.compositeMaterial)
    add(b.blendMaterial)
    add(b.materialHighPassFilter)
    add(b.copyMaterial)
    return Promise.all(mats.map(m => this.renderer.compileAsync(new THREE.Mesh(quad.geometry, m), cam).catch(() => {})))
  }

  setSize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    this.bloom.resolution.set((w * dpr) / 2, (h * dpr) / 2)
    this.final.uniforms.uResolution.value.set(w * dpr, h * dpr)
    this.final.uniforms.uDpr.value = dpr
    this.final.uniforms.uFieldTexel.value.set(1 / this.field.b.width, 1 / this.field.b.height)
  }

  render(dt: number, time: number) {
    const k = 1 - Math.exp(-6 * dt)
    const c = this.current
    const p = this.params
    for (const key of Object.keys(p) as (keyof PostParams)[]) {
      // flash & glitch respond instantly so chapters can punch them
      c[key] = key === 'flash' || key === 'glitch' ? p[key] : c[key] + (p[key] - c[key]) * k
    }
    // flash budget (WCAG 2.3.1): a flash starting within FLASH_GAP of the last is dropped
    if (c.flash > 0.02) {
      if (!this.flashLive) {
        this.flashLive = true
        this.flashOk = time - this.lastFlashAt >= FLASH_GAP
        if (this.flashOk) this.lastFlashAt = time
      }
      if (!this.flashOk) c.flash = 0
    } else this.flashLive = false
    // speed dim (WCAG 2.3.1 safety net): the frame dims as the page moves fast,
    // attack ~0.2 s, release ~0.6 s — slow enough that wheel notches under
    // reduced motion (instant scroll, spiky velocity) read as one steady dim
    {
      const v = Math.abs(this.velocity)
      const x = Math.max(0, Math.min(1, (v - 1.1) / 2.4))
      const target = x * x * (3 - 2 * x) * 0.5
      const tau = target > this.speedDim ? 0.2 : 0.6
      this.speedDim += (target - this.speedDim) * (1 - Math.exp(-dt / tau))
    }
    // chapters zero bloom where nothing crosses the threshold: skip the pass entirely
    this.bloom.enabled = c.bloomStrength > 0.01
    this.bloom.strength = c.bloomStrength
    this.bloom.radius = c.bloomRadius
    this.bloom.threshold = c.bloomThreshold
    this.renderer.toneMappingExposure = c.exposure
    const u = this.final.uniforms
    u.uTime.value = time
    u.uTransition.value = this.transition
    u.uGlitch.value = c.glitch
    u.uAberration.value = c.aberration
    u.uGrain.value = c.grain
    u.uVignette.value = c.vignette
    u.uFlash.value = c.flash
    u.uFade.value = this.fade
    u.uSpeedDim.value = this.speedDim
    u.uSat.value = c.saturation
    u.uLift.value = c.lift
    u.uWarmth.value = c.warmth
    this.field.active = this.transition > 0.001 || c.glitch > 0.001
    if (this.preRender.length) {
      this.camera.updateMatrixWorld()
      for (const fn of this.preRender) fn(this.renderer, this.scene, this.camera)
    }
    this.composer.render(dt)
  }
}
