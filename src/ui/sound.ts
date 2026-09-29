import type { Frame } from '../core/types'
import type { EngineState } from '../core/Engine'
import { storeKey } from './prefs'

/*
 * RIFF sound: a tube amp on a dark stage between songs (WebAudio only, no files).
 *
 *   hum      the amp idling: 60 Hz mains hum and its harmonics (120, 180, 240,
 *            300 Hz, the ones small speakers actually play), breathing very
 *            slowly, plus a thread of tube hiss — barely there. Each chapter
 *            sets how much the amp hums (Up to Eleven cooks a little hotter,
 *            The Workbench is almost silent); scroll speed lifts the hiss a
 *            touch, like the volume knob creeping up.
 *   strings  KARPLUS-STRONG plucked strings: a noise burst (low-passed and
 *            comb-filtered for the pick position) circulating in a tuned
 *            delay loop with a fractional-delay all-pass, decaying to -60 dB
 *            in a set time. Rendered once per note into an AudioBuffer
 *            (cached, ~1 ms each), then played through the AMP: a soft tanh
 *            waveshaper (tube warmth, not distortion), a 1x12 cab voicing
 *            (high-pass 90 Hz, a low-pass around 4.6 kHz with a little
 *            presence) and a short generated SPRING REVERB (a flutter of
 *            ~31 ms round trips in a decaying wash).
 *   blip(i)  plucks note i of E minor pentatonic from E4 (E G A B D, up the
 *            neck): nav, toggles, the menu.
 *   cut()    a soft POWER-CHORD STRUM (root, fifth, octave; low to high going
 *            forward, high to low going back) on the next chapter's root — E,
 *            G, A, B, D, A, E — and a low CAB THUMP (a sine dropping 72 → 44 Hz
 *            with a felt-soft click), rate-limited to one per ~1.1 s so a fast
 *            scroll through several chapters plays one chord, not a flam.
 *   tone()   a pure sine a chapter may ask for (also via 'hark:tone' events).
 *   Chapters may also dispatch window events: 'hark:pluck' {i?, midi?, level?},
 *   'hark:strum' {root?, level?, up?} (e.g. the hero's first chord) and
 *   'hark:sfx' {kind: 'plug' | 'detent', n?} (services: the jack, the dial).
 *
 * CPU: the beds are a handful of always-running nodes; a pluck is one
 * AudioBufferSourceNode; buffers are rendered on first use (and the common
 * ones in idle slices after the sound is switched on); update() only touches
 * gains ~8×/s. Off by default. Sound only ever starts from a real gesture:
 * the toggle's own click / tap / Enter / Space. A remembered "on"
 * (localStorage, per concept) waits for the first real activation (a click or
 * tap, or Enter / Space on a control; never Tab, arrows or scrolling). Faded
 * out and suspended while the tab is hidden. On iOS the audio session is set
 * to "playback" so the silent switch doesn't swallow it. Levels stay low,
 * behind a gentle compressor.
 *
 * Keep the API: enabled, onChange, toggle(), update(), cut(), blip(), tone().
 */

const STORE_KEY = storeKey('sound')

function stored(): boolean | null {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

const ACTIVATE_KEYS = new Set(['Enter', ' ', 'Spacebar'])
const CONTROL = 'a[href], button, [role="button"], [role="switch"], summary, input, select, textarea'

/* levels (linear gain, before the master) */
const MASTER_LEVEL = 0.55
const HUM_LEVEL = 0.0034
const HISS_LEVEL = 0.0014
const BLIP_LEVEL = 0.075
const STRUM_LEVEL = 0.07
const THUMP_LEVEL = 0.12
const SPRING_SEND = 0.2
const TONE_MAX = 0.03

/** E minor pentatonic (semitones above E) */
const PENTA = [0, 3, 5, 7, 10]
/** the power chord's root for each chapter (MIDI): E2 G2 A2 B2 D2 A2 E2 */
const ROOT: Record<string, number> = { hero: 40, work: 43, services: 45, voices: 47, shield: 38, process: 45, contact: 40 }
/** how much the amp hums in each chapter */
const HUM: Record<string, number> = { hero: 1, work: 0.9, services: 1.2, voices: 0.8, shield: 1.15, process: 0.6, contact: 0.85 }
/** a chapter must hold this long before the hum follows it */
const SETTLE_S = 0.7
const CUT_GAP_S = 1.1
const BLIP_GAP_S = 0.07
const MAX_BUFFERS = 40

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function setAudioSession(type: string) {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) nav.audioSession.type = type
  } catch {
    /* not supported */
  }
}

interface PluckOpts {
  /** seconds to -60 dB */
  t60?: number
  /** pick brightness 0..1 (the excitation's low-pass) */
  bright?: number
  pan?: number
}

export class Sound {
  enabled = false
  onChange: ((enabled: boolean) => void)[] = []

  private ctx: AudioContext | null = null
  private master!: GainNode
  private amp!: GainNode
  private hum!: GainNode
  private hiss!: GainNode
  private fx!: GainNode
  private toneOsc: OscillatorNode | null = null
  private toneGain: GainNode | null = null
  private buffers = new Map<string, AudioBuffer>()
  private click: AudioBuffer | null = null

  private chapter = 'hero'
  private slotIds: string[] = []
  private humKey = ''
  private pendingKey = 'hero'
  private pendingSince = 0
  private lastCut = -10
  private lastBlip = -10
  private lastSpeedAt = -10
  private speed = 0
  private suspendTimer = 0
  private warmTimer = 0
  private hidden = typeof document !== 'undefined' && document.hidden
  /** a remembered "on" waiting for the first real gesture */
  private armed = false
  private gestureBound = false
  private toneHz = 440
  private toneLevel = 0

  constructor() {
    this.armed = stored() === true
    if (this.armed) this.waitForGesture()
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      this.applyRunning()
    })
    window.addEventListener('hark:tone', e => {
      const d = (e as CustomEvent<{ hz?: number; level?: number }>).detail
      if (d && typeof d.hz === 'number') this.tone(d.hz, d.level ?? 0)
    })
    window.addEventListener('hark:pluck', e => {
      const d = (e as CustomEvent<{ i?: number; midi?: number; level?: number }>).detail ?? {}
      const ctx = this.live()
      if (!ctx) return
      const midi = typeof d.midi === 'number' ? d.midi : this.scaleNote(d.i ?? 0)
      this.pluck(ctx.currentTime + 0.005, midi, BLIP_LEVEL * clamp01(d.level ?? 1), { t60: 1.8, bright: 0.5, pan: rand(-0.3, 0.3) })
    })
    window.addEventListener('hark:strum', e => {
      const d = (e as CustomEvent<{ root?: number; level?: number; up?: boolean }>).detail ?? {}
      const ctx = this.live()
      if (!ctx) return
      const root = typeof d.root === 'number' ? d.root : (ROOT[this.chapter] ?? 40)
      this.strum(ctx.currentTime + 0.01, root, STRUM_LEVEL * clamp01(d.level ?? 1), !!d.up, 2.4)
    })
    // services: the jack seating ('plug') and the dial's detents ('detent', n 1..11)
    window.addEventListener('hark:sfx', e => {
      const d = (e as CustomEvent<{ kind?: string; n?: number }>).detail ?? {}
      const ctx = this.live()
      if (!ctx) return
      const now = ctx.currentTime + 0.005
      if (d.kind === 'plug') {
        this.knock(ctx, now, 0.7, 1800)
        // the hum swells as the cable seats, then settles
        this.hum.gain.cancelScheduledValues(now)
        this.hum.gain.setTargetAtTime(HUM_LEVEL * 3.2, now, 0.02)
        this.hum.gain.setTargetAtTime(HUM_LEVEL, now + 0.35, 0.4)
      } else if (d.kind === 'detent') {
        const n = Math.max(1, Math.min(11, d.n ?? 1))
        this.knock(ctx, now, 0.28, 3200)
        this.pluck(now + 0.02, this.scaleNote(n - 1), BLIP_LEVEL * 0.45, { t60: 1.1, bright: 0.45, pan: rand(-0.2, 0.2) })
      }
    })
    // the static page took over (no GPU): silence, without touching the stored choice
    window.addEventListener('hark:fallback', () => this.setEnabled(false))
  }

  /** was sound on last visit? (it still needs a gesture to start) */
  get remembered() {
    return stored() === true
  }

  /** Flip the sound on/off. Call from a user gesture (click / key). */
  toggle() {
    this.armed = false
    this.setEnabled(!this.enabled)
    try {
      localStorage.setItem(STORE_KEY, this.enabled ? '1' : '0')
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  /** Follow the story: each chapter sets the hum (once it holds); scroll speed lifts the hiss. */
  update(frame: Frame, state: EngineState) {
    const slot = state.slots[state.index]
    if (slot) this.chapter = slot.def.id
    if (this.slotIds.length !== state.slots.length) this.slotIds = state.slots.map(s => s.def.id)
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (this.chapter !== this.pendingKey) {
      this.pendingKey = this.chapter
      this.pendingSince = now
    }
    if (this.pendingKey !== this.humKey && now - this.pendingSince > SETTLE_S) this.setHum(this.pendingKey, ctx, 1.2)
    // ≈ 8×/s: a little more hiss while the stage slides past
    if (now - this.lastSpeedAt > 0.12) {
      this.lastSpeedAt = now
      const s = clamp01(Math.abs(frame.velocity || 0) / 3)
      if (Math.abs(s - this.speed) > 0.04) {
        this.speed = s
        this.hiss.gain.setTargetAtTime(HISS_LEVEL * (1 + 1.6 * s), now, s > 0.1 ? 0.15 : 0.7)
      }
    }
  }

  /** A chapter cut: a soft power-chord strum on the next chapter's root and a low cab thump. */
  cut(from: number, to: number) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    const toId = this.slotIds[to]
    if (toId) {
      this.pendingKey = toId
      this.pendingSince = now
    }
    // a fast run of cuts: one chord, then the amp waits for the story to settle
    if (now - this.lastCut < CUT_GAP_S) return
    this.lastCut = now
    const root = ROOT[toId ?? ''] ?? 40
    this.strum(now + 0.012, root, STRUM_LEVEL, to < from, 1.5)
    this.thump(ctx, now)
  }

  /** A plucked note (nav, toggles): note i of E minor pentatonic from E4. No-op while off. */
  blip(pitch = 0) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBlip < BLIP_GAP_S) return
    this.lastBlip = now
    this.pluck(now + 0.004, this.scaleNote(pitch), BLIP_LEVEL, { t60: 1.3, bright: 0.55, pan: rand(-0.25, 0.25) })
  }

  /** A pure sine a chapter may ask for: level 0..1 (0 releases it). */
  tone(hz: number, level: number) {
    if (Number.isFinite(hz) && hz > 20 && hz < 12000) this.toneHz = hz
    this.toneLevel = clamp01(Number.isFinite(level) ? level : 0)
    this.applyTone()
  }

  /* ------------------------------------------------------------ internals */

  private scaleNote(i: number) {
    const p = Math.max(0, Math.min(14, Math.round(i)))
    return 64 + PENTA[p % 5] + 12 * Math.floor(p / 5)
  }

  private live() {
    const ctx = this.ctx
    if (!ctx || !this.enabled || this.hidden || ctx.state !== 'running') return null
    return ctx
  }

  private setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    setAudioSession(on ? 'playback' : 'auto')
    if (on) {
      try {
        this.ensureGraph()
      } catch (err) {
        console.warn('[hark] audio unavailable', err)
      }
    }
    this.applyRunning(true)
    for (const fn of this.onChange) fn(on)
  }

  /** Resume + fade in, or fade out + suspend, from enabled / hidden. */
  private applyRunning(greet = false) {
    const ctx = this.ctx
    if (!ctx) return
    clearTimeout(this.suspendTimer)
    const now = ctx.currentTime
    if (this.enabled && !this.hidden) {
      ctx
        .resume()
        .then(() => {
          if (!this.enabled || this.hidden) return
          if (ctx.state !== 'running') return this.waitForGesture()
          const t = ctx.currentTime
          this.master.gain.cancelScheduledValues(t)
          this.master.gain.setValueAtTime(this.master.gain.value, t)
          this.master.gain.setTargetAtTime(MASTER_LEVEL, t, 0.35)
          this.pendingKey = this.chapter
          this.humKey = ''
          this.setHum(this.chapter, ctx, 0.8)
          this.applyTone()
          this.warmUp()
          // the amp comes on: one open note, the root of the chapter you're in
          if (greet) this.pluck(t + 0.03, (ROOT[this.chapter] ?? 40) + 12, BLIP_LEVEL, { t60: 2.2, bright: 0.45 })
        })
        .catch(() => this.waitForGesture())
    } else {
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.setTargetAtTime(0, now, this.hidden ? 0.05 : 0.25)
      this.suspendTimer = window.setTimeout(
        () => {
          if (!this.enabled || this.hidden) ctx.suspend().catch(() => {})
        },
        this.hidden ? 300 : 1400,
      )
    }
  }

  /** Start audio on the first real gesture (a remembered "on", or a blocked resume). */
  private waitForGesture() {
    if (this.gestureBound) return
    this.gestureBound = true
    let sx = 0
    let sy = 0
    const events = ['click', 'keydown', 'touchstart', 'touchend'] as const
    const handler = (e: Event) => {
      if (e.type === 'touchstart') {
        const t = (e as TouchEvent).touches[0]
        if (t) {
          sx = t.clientX
          sy = t.clientY
        }
        return
      }
      if (e.type === 'touchend') {
        // a tap, not a scroll or a swipe
        const t = (e as TouchEvent).changedTouches[0]
        if (!t || Math.hypot(t.clientX - sx, t.clientY - sy) > 12) return
      }
      // keyboard: only Enter / Space on a control is "play"; Tab and friends are just moving around
      if (e instanceof KeyboardEvent) {
        if (!ACTIVATE_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
        if (!(e.target as Element | null)?.closest?.(CONTROL)) return
      }
      for (const ev of events) window.removeEventListener(ev, handler, true)
      this.gestureBound = false
      const onToggle = (e.target as Element | null)?.closest?.('[data-sound-toggle]')
      if (this.armed) {
        this.armed = false
        // the toggle's own click decides for itself
        if (!onToggle) this.setEnabled(true)
      } else if (this.enabled) this.applyRunning()
    }
    for (const ev of events) window.addEventListener(ev, handler, { capture: true, passive: true })
  }

  /* ------------------------------------------------------------ the graph */

  private ensureGraph() {
    if (this.ctx) return
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC({ latencyHint: 'interactive' })
    this.ctx = ctx
    const sr = ctx.sampleRate

    // master → rumble guard → gentle compression → out
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 38
    hp.Q.value = 0.5
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -22
    comp.knee.value = 16
    comp.ratio.value = 3
    comp.attack.value = 0.008
    comp.release.value = 0.4
    this.master.connect(hp).connect(comp).connect(ctx.destination)

    // THE AMP: soft tube warmth → a 1x12 cab voicing → out, plus the spring
    this.amp = ctx.createGain()
    this.amp.gain.value = 1.4
    const shaper = ctx.createWaveShaper()
    const n = 1024
    const curve = new Float32Array(n)
    const k = 1.7
    const norm = Math.tanh(k)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1
      // a touch asymmetric, like a single-ended stage
      curve[i] = Math.tanh(k * (x + 0.04 * x * x)) / norm
    }
    shaper.curve = curve
    shaper.oversample = '2x'
    const cabHp = ctx.createBiquadFilter()
    cabHp.type = 'highpass'
    cabHp.frequency.value = 90
    cabHp.Q.value = 0.6
    const cabLp = ctx.createBiquadFilter()
    cabLp.type = 'lowpass'
    cabLp.frequency.value = 4600
    cabLp.Q.value = 0.8
    const presence = ctx.createBiquadFilter()
    presence.type = 'peaking'
    presence.frequency.value = 1800
    presence.Q.value = 0.9
    presence.gain.value = 2.5
    const post = ctx.createGain()
    post.gain.value = 0.72
    this.amp.connect(shaper).connect(cabHp).connect(presence).connect(cabLp).connect(post).connect(this.master)
    const spring = ctx.createConvolver()
    spring.buffer = this.springIR(ctx)
    const send = ctx.createGain()
    send.gain.value = SPRING_SEND
    post.connect(send).connect(spring).connect(this.master)

    // HUM: 60 Hz and its harmonics, low-passed, breathing slowly
    this.hum = ctx.createGain()
    this.hum.gain.value = 0
    const humLp = ctx.createBiquadFilter()
    humLp.type = 'lowpass'
    humLp.frequency.value = 420
    humLp.Q.value = 0.4
    const humAmp = ctx.createGain()
    humAmp.gain.value = 1
    humLp.connect(humAmp).connect(this.hum).connect(this.master)
    for (const [hz, a] of [
      [60, 0.7],
      [120, 1],
      [180, 0.55],
      [240, 0.3],
      [300, 0.16],
    ] as const) {
      const o = ctx.createOscillator()
      o.frequency.value = hz
      const g = ctx.createGain()
      g.gain.value = a
      o.connect(g).connect(humLp)
      o.start()
    }
    const breathe = ctx.createOscillator()
    breathe.frequency.value = 0.07
    const breatheAmt = ctx.createGain()
    breatheAmt.gain.value = 0.22
    breathe.connect(breatheAmt).connect(humAmp.gain)
    breathe.start()

    // HISS: the tubes' own noise, a thin high band
    const noise = ctx.createBuffer(1, Math.floor(sr * 2), sr)
    const nd = noise.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
    this.hiss = ctx.createGain()
    this.hiss.gain.value = HISS_LEVEL
    const hissSrc = ctx.createBufferSource()
    hissSrc.buffer = noise
    hissSrc.loop = true
    const hissHp = ctx.createBiquadFilter()
    hissHp.type = 'highpass'
    hissHp.frequency.value = 2600
    const hissLp = ctx.createBiquadFilter()
    hissLp.type = 'lowpass'
    hissLp.frequency.value = 8500
    hissSrc.connect(hissHp).connect(hissLp).connect(this.hiss).connect(this.master)
    hissSrc.start(0, rand(0, 1.5))

    // the cab's felt-soft click (a short low-passed noise burst) for the thump
    const cl = Math.floor(sr * 0.02)
    this.click = ctx.createBuffer(1, cl, sr)
    const cd = this.click.getChannelData(0)
    let lp = 0
    for (let i = 0; i < cl; i++) {
      lp += 0.18 * (Math.random() * 2 - 1 - lp)
      cd[i] = lp * Math.pow(1 - i / cl, 3) * 2.2
    }

    // thumps and tones go straight out
    this.fx = ctx.createGain()
    this.fx.gain.value = 1
    const fxLp = ctx.createBiquadFilter()
    fxLp.type = 'lowpass'
    fxLp.frequency.value = 220
    this.fx.connect(fxLp).connect(this.master)

    this.toneOsc = ctx.createOscillator()
    this.toneOsc.type = 'sine'
    this.toneOsc.frequency.value = this.toneHz
    this.toneGain = ctx.createGain()
    this.toneGain.gain.value = 0
    this.toneOsc.connect(this.toneGain).connect(this.master)
    this.toneOsc.start()
  }

  /** a short spring reverb: a flutter of ~31 ms round trips in a darkening, decaying wash (stereo) */
  private springIR(ctx: AudioContext) {
    const sr = ctx.sampleRate
    const len = Math.floor(sr * 2.1)
    const ir = ctx.createBuffer(2, len, sr)
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c)
      const period = Math.floor(sr * (0.031 + c * 0.0023))
      const burst = Math.floor(sr * 0.005)
      // the wash
      let lp = 0
      let hpPrev = 0
      let hpOut = 0
      for (let i = 0; i < len; i++) {
        const t = i / sr
        const k = 0.5 + 0.4 * Math.min(1, t / 1.6)
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k)
        // a gentle high-pass so the spring never booms
        hpOut = 0.97 * (hpOut + lp - hpPrev)
        hpPrev = lp
        d[i] = hpOut * Math.exp(-t / 0.5) * 0.7 * (i < sr * 0.004 ? i / (sr * 0.004) : 1)
      }
      // the flutter: each round trip comes back smeared and softer
      for (let r = 1; r * period < len; r++) {
        const amp = 0.5 * Math.pow(0.72, r)
        const at = r * period
        const smear = burst * (1 + r * 0.6)
        for (let j = 0; j < smear && at + j < len; j++) d[at + j] += (Math.random() * 2 - 1) * amp * (1 - j / smear)
      }
    }
    return ir
  }

  /** the hum for a chapter */
  private setHum(id: string, ctx: AudioContext, tc: number) {
    this.humKey = id
    const now = ctx.currentTime
    this.hum.gain.setTargetAtTime(HUM_LEVEL * (HUM[id] ?? 1), now, tc)
  }

  /** after the amp comes on, render the notes it will need first, in idle slices */
  private warmUp() {
    clearTimeout(this.warmTimer)
    const todo: [number, number, number][] = []
    for (let i = 0; i < 8; i++) todo.push([this.scaleNote(i), 1.3, 0.55])
    for (const id of Object.keys(ROOT)) {
      const r = ROOT[id]
      for (const m of [r, r + 7, r + 12]) todo.push([m, 1.5, 0.38])
    }
    const step = () => {
      const ctx = this.ctx
      if (!ctx || !this.enabled) return
      const next = todo.shift()
      if (!next) return
      this.buffer(ctx, next[0], next[1], next[2])
      this.warmTimer = window.setTimeout(step, 30)
    }
    this.warmTimer = window.setTimeout(step, 120)
  }

  /* ------------------------------------------------------------ voices */

  /**
   * A Karplus-Strong string, rendered once into a buffer: a pick-shaped noise
   * burst circulating in a delay loop of one period (an averaging low-pass +
   * a fractional all-pass keep it in tune), losing just enough per trip to
   * fall 60 dB in t60 seconds.
   */
  private buffer(ctx: AudioContext, midi: number, t60: number, bright: number) {
    const key = `${midi}|${t60}|${bright}`
    const hit = this.buffers.get(key)
    if (hit) return hit
    const sr = ctx.sampleRate
    const f = mtof(midi)
    const period = sr / f
    const loop = period - 0.5 // the averaging filter adds half a sample
    const ni = Math.max(2, Math.floor(loop - 0.1))
    const frac = loop - ni
    const c = (1 - frac) / (1 + frac)
    const g = Math.pow(10, -3 / (t60 * f))
    const len = Math.ceil(sr * Math.min(3.4, t60 * 1.05 + 0.15))
    const buf = ctx.createBuffer(1, len, sr)
    const y = buf.getChannelData(0)
    // the pick: a noise burst, low-passed (softer picks are darker) …
    const exc = new Float32Array(ni)
    let lp = 0
    const a = 0.12 + 0.8 * clamp01(bright)
    for (let i = 0; i < ni; i++) {
      lp += a * (Math.random() * 2 - 1 - lp)
      exc[i] = lp
    }
    // … and comb-filtered for where along the string it was picked
    const pp = Math.max(1, Math.round(ni * 0.14))
    for (let i = ni - 1; i >= pp; i--) exc[i] -= exc[i - pp]
    let mean = 0
    for (let i = 0; i < ni; i++) mean += exc[i]
    mean /= ni
    for (let i = 0; i < ni; i++) exc[i] -= mean
    let apIn = 0
    let apOut = 0
    for (let i = 0; i < len; i++) {
      const d1 = i >= ni ? y[i - ni] : 0
      const d2 = i >= ni + 1 ? y[i - ni - 1] : 0
      const v = g * 0.5 * (d1 + d2)
      const ap = c * v + apIn - c * apOut
      apIn = v
      apOut = ap
      y[i] = (i < ni ? exc[i] : 0) + ap
    }
    let peak = 0
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]))
    const norm = peak > 0 ? 0.9 / peak : 1
    const fade = Math.floor(sr * 0.04)
    for (let i = 0; i < len; i++) y[i] *= norm * (i > len - fade ? (len - i) / fade : 1)
    if (this.buffers.size >= MAX_BUFFERS) {
      const first = this.buffers.keys().next().value
      if (first !== undefined) this.buffers.delete(first)
    }
    this.buffers.set(key, buf)
    return buf
  }

  /** play one string through the amp */
  private pluck(t: number, midi: number, level: number, { t60 = 1.6, bright = 0.5, pan = 0 }: PluckOpts = {}) {
    const ctx = this.ctx
    if (!ctx) return
    const src = ctx.createBufferSource()
    src.buffer = this.buffer(ctx, midi, t60, bright)
    const g = ctx.createGain()
    g.gain.value = level
    src.connect(g)
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      g.connect(p).connect(this.amp)
    } else g.connect(this.amp)
    src.start(t)
  }

  /** a power chord (root, fifth, octave), strummed ~24 ms a string */
  private strum(t: number, root: number, level: number, up: boolean, t60: number) {
    const notes = [root, root + 7, root + 12]
    if (up) notes.reverse()
    notes.forEach((m, i) => this.pluck(t + i * 0.024, m, level * (i === 0 ? 1 : 0.85), { t60, bright: 0.38, pan: (i - 1) * 0.12 }))
  }

  /** the cab's cone pushing air: a falling low sine and a soft click */
  private thump(ctx: AudioContext, t: number) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(72, t)
    o.frequency.exponentialRampToValueAtTime(44, t + 0.16)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(THUMP_LEVEL, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    o.connect(g).connect(this.fx)
    o.start(t)
    o.stop(t + 0.36)
    if (this.click) {
      const s = ctx.createBufferSource()
      s.buffer = this.click
      const cg = ctx.createGain()
      cg.gain.value = 0.35
      s.connect(cg).connect(this.fx)
      s.start(t)
    }
  }

  /** a small mechanical click (knob detent, jack seating): the click burst, high-passed */
  private knock(ctx: AudioContext, t: number, level: number, hp: number) {
    if (!this.click) return
    const s = ctx.createBufferSource()
    s.buffer = this.click
    s.playbackRate.value = 1.6
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = hp
    const g = ctx.createGain()
    g.gain.value = level
    s.connect(f).connect(g).connect(this.master)
    s.start(t)
  }

  private applyTone() {
    const ctx = this.ctx
    if (!ctx || !this.toneOsc || !this.toneGain) return
    const now = ctx.currentTime
    this.toneOsc.frequency.setTargetAtTime(this.toneHz, now, 0.08)
    this.toneGain.gain.setTargetAtTime(this.toneLevel * TONE_MAX, now, 0.12)
  }
}
