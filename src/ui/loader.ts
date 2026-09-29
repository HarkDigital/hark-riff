import { holdInert, releaseInert } from './inert'
import { BRAND, SITE } from '../content'
import { MARK_PATHS, MARK_VIEWBOX } from './mark'
import { calmUi } from './prefs'
import { publishTextures } from './texture'

/*
 * The boot screen — RIFF: WARMING UP THE TUBES. A small cab front in a dark
 * room: black tolex, a cream piping line, and the same basketweave GRILLE
 * CLOTH the chapter cut closes over the frame (texture.ts weave(), the
 * kit's weave) — at first cold, the threads barely there. As the site loads
 * the tubes behind the cloth warm up: a glow rises from below, rust to
 * amber, lighting the weave thread by thread (the cloth is a multiply layer
 * over the glow), while the Hark mark is PIPED onto the cloth in cream — a
 * cord laid along its outline, all its loops at once. When the load lands
 * the badge fills pearl, the little jewel pilot lamp under the cab comes on
 * and the readout says 100%: "Warming up the tubes · 100%" in Spline Sans
 * Mono. All DOM + one inline SVG; the cloth is a 128px canvas tile.
 *
 * Exit: the MATCH-CUT. The hero publishes where its own pearl mark sits on
 * its landing frame (on <html>, CSS px: --hark-mark-x/-y = the center of the
 * mark's square SVG viewBox, --hark-mark-size = its side — the viewBox this
 * loader's badge is drawn in). The badge glides onto that spot while the
 * cab dissolves around it (the cloth opening, like the cut) and the black
 * lifts late in the glide; then finish() resolves ('hark:reveal') and the
 * badge lets go over the hero's own mark as the stage comes up — a
 * crossfade: the loader lingers for that last fade, click-through and
 * hidden from assistive tech, then removes itself. Without those properties
 * (or when the story opens anywhere but the hero's landing frame), or under
 * reduced motion / Motion off, it's a clean fade: the cab goes first, then
 * the black. Every change is a single monotone fade or glide: no strike, no
 * dip, no flicker.
 *
 * The warm-up never outruns time: it takes at least MIN_MS even on a warm
 * cache, so the tubes always visibly warm.
 *
 * API used by main.ts: createLoader(root, { skip }) → { progress(0..1), finish() }.
 * Rules: shows at least ~1.2s, never hangs (finish() always resolves; every
 * wait is a bounded timer, never a rAF), the page behind — the skip link
 * too — is inert while it's up, skip removes it at once (?nointro).
 */
const MIN_MS = 1200
/** the warm-up eases toward its target on this ticker (a timer: it runs in hidden tabs too) */
const TICK_MS = 33
/** longest we wait for the warm-up to finish after the load lands */
const FILL_MAX_MS = 420
/** pilot on, badge filled: a beat before the exit */
const HOLD_MS = 220
/** the match-cut: the badge's glide onto the hero's mark, then its let-go */
const FLIGHT_MS = 720
const LETGO_MS = 700
/** no match-cut: the cab goes first, then the black */
const TILE_OUT_MS = 260
const FADE_MS = 380

/** the badge's shadow on the cloth (matches .ld-badge in ui.css) and its let-go */
const BADGE_SHADOW = 'drop-shadow(0px 1.5px 1.5px rgba(0, 0, 0, 0.75)) drop-shadow(0px 4px 10px rgba(0, 0, 0, 0.45))'
const NO_SHADOW = 'drop-shadow(0px 0px 0px rgba(0, 0, 0, 0)) drop-shadow(0px 0px 0px rgba(0, 0, 0, 0))'
/** piping cord width, in mark units (the mark's viewBox is ~1890 wide: ~1.5px at the loader's size) */
const PIPE_W = 34

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)))
const f1 = (n: number) => n.toFixed(1)
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** WAAPI when it's there (it ignores the reduced-motion CSS that zeroes transitions; a fade is not motion) */
function play(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions) {
  if (!el) return
  try {
    el.animate(frames, { fill: 'forwards', ...opts })
  } catch {
    const last = frames[frames.length - 1]
    if (el instanceof HTMLElement || el instanceof SVGElement)
      for (const [k, v] of Object.entries(last)) if (k !== 'offset' && k !== 'easing') el.style.setProperty(k, String(v))
  }
}

/**
 * The hero's mark on screen, as the hero chapter publishes it: CSS custom
 * properties on <html>, in px — --hark-mark-x/-y (the center of the mark's
 * square SVG viewBox) and --hark-mark-size (its side). Null when they're
 * missing, off screen, or the story isn't on the hero's landing frame.
 */
function heroMark(): { cx: number; cy: number; size: number } | null {
  try {
    // the rect is the hero's landing frame: only when that's what's on screen
    // (a deep link to #work, ?c=…, or a scroll during the load lands elsewhere)
    const st = window.__hark?.engine?.state
    const slot = st?.slots[st.index]
    if (!st || !slot || slot.def.id !== 'hero' || st.local > 0.02) return null
    const cs = getComputedStyle(document.documentElement)
    const num = (k: string) => parseFloat(cs.getPropertyValue(k))
    const cx = num('--hark-mark-x')
    const cy = num('--hark-mark-y')
    const size = num('--hark-mark-size')
    if (![cx, cy, size].every(Number.isFinite) || size < 12) return null
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight || size > Math.max(innerWidth, innerHeight)) return null
    return { cx, cy, size }
  } catch {
    return null
  }
}

export function createLoader(root: HTMLElement, { skip = false } = {}) {
  const start = performance.now()
  let target = 0
  let shown = 0
  let painted = -1
  let shownPct = -1
  let ticker = 0
  let pipes: { el: SVGPathElement; len: number }[] = []
  let fill: SVGGElement | null = null
  let glow: HTMLElement | null = null
  let lit: HTMLElement | null = null
  let room: HTMLElement[] = []
  let pct: HTMLElement | null = null

  if (skip) root.remove()
  else {
    // the cloth and the tolex, as tiny canvas tiles (CSS custom properties)
    publishTextures(['lit', 'tolex'])
    const paths = [...MARK_PATHS.loops, MARK_PATHS.diamond].filter(Boolean)
    const pathEls = paths.map(d => `<path d="${d}"/>`).join('')
    const [vx, vy, vw, vh] = MARK_VIEWBOX.split(/\s+/).map(Number)
    root.innerHTML = `
      <div class="ld">
        <div class="ld-bg" aria-hidden="true"><div class="ld-bg-glow"></div></div>
        <p class="sr-only" role="status">Loading ${BRAND.name}, ${SITE.name} concept</p>
        <div class="ld-stage" aria-hidden="true">
          <div class="ld-pool"></div>
          <div class="ld-tile">
            <div class="ld-cab">
              <div class="ld-cloth">
                <div class="ld-glow"></div>
                <div class="ld-weave"></div>
                <div class="ld-shade"></div>
              </div>
            </div>
            <svg class="ld-badge" viewBox="${MARK_VIEWBOX}" focusable="false">
              <defs>
                <linearGradient id="ld-pearl" gradientUnits="userSpaceOnUse" x1="${f1(vx)}" y1="${f1(vy)}" x2="${f1(vx + vw)}" y2="${f1(vy + vh)}">
                  <stop offset="0" stop-color="#fffaf0"/><stop offset="0.3" stop-color="#f5e9d2"/><stop offset="0.52" stop-color="#efe3e6"/>
                  <stop offset="0.7" stop-color="#f7ecd8"/><stop offset="1" stop-color="#fff6e6"/>
                </linearGradient>
              </defs>
              <g class="ld-fill" fill="url(#ld-pearl)" opacity="0">${pathEls}</g>
              <g class="ld-pipe" fill="none" stroke="#ecdcb9" stroke-width="${PIPE_W}" stroke-linejoin="round" stroke-linecap="round">${pathEls}</g>
            </svg>
          </div>
          <p class="ld-read"><i class="ld-jewel"><i class="ld-jewel-lit"></i></i><span>Warming up the tubes</span><i class="ld-rule"></i><b><span data-pct>000</span>%</b></p>
        </div>
      </div>`
    // the whole page sleeps under the loader, the skip link too (it would take
    // focus unseen, under the black)
    holdInert('loader', [
      document.querySelector<HTMLElement>('.skip-link'),
      document.getElementById('track'),
      document.getElementById('stages'),
      document.getElementById('chrome'),
    ])
    pipes = [...root.querySelectorAll<SVGPathElement>('.ld-pipe path')].map(el => {
      let len = 0
      try {
        len = el.getTotalLength()
      } catch {
        len = 0
      }
      if (!(len > 0)) len = 8000
      el.style.strokeDasharray = `${f1(len)} ${f1(len + 40)}`
      el.style.strokeDashoffset = f1(len)
      return { el, len }
    })
    fill = root.querySelector<SVGGElement>('.ld-fill')
    glow = root.querySelector<HTMLElement>('.ld-glow')
    lit = root.querySelector<HTMLElement>('.ld-jewel-lit')
    room = [...root.querySelectorAll<HTMLElement>('.ld-pool, .ld-bg-glow')]
    pct = root.querySelector<HTMLElement>('[data-pct]')
    paint(0)
    ticker = window.setInterval(tick, TICK_MS)
  }

  /** the tubes have warmed `v` (0..1) of the way */
  function paint(v: number) {
    if (Math.abs(v - painted) < 0.0005) return
    painted = v
    // the glow rises behind the cloth and dims up (a filament, never a flicker)
    if (glow) {
      glow.style.opacity = (0.12 + 0.88 * smooth(0, 1, v)).toFixed(3)
      glow.style.transform = `translate3d(0, ${f1(26 * (1 - v))}%, 0)`
    }
    // the cord is laid along the mark's outline
    for (const p of pipes) p.el.style.strokeDashoffset = f1(p.len * (1 - v))
    // the pearl goes in as the piping closes
    fill?.setAttribute('opacity', smooth(0.8, 1, v).toFixed(3))
    if (lit) lit.style.opacity = (v * v * v).toFixed(3)
    for (const el of room) el.style.opacity = (v * v).toFixed(3)
    const n = Math.round(v * 100)
    if (pct && n !== shownPct) {
      shownPct = n
      pct.textContent = String(n).padStart(3, '0')
    }
  }

  function tick() {
    // never ahead of the real load, never faster than MIN_MS end to end
    const time = Math.min(1, (performance.now() - start) / MIN_MS)
    const goal = Math.min(target, time)
    const next = shown + (goal - shown) * 0.22
    shown = goal - next < 0.002 ? goal : next
    paint(shown)
  }

  return {
    progress(p: number) {
      const v = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
      if (v > target) target = v
    },
    async finish(): Promise<void> {
      if (skip) return
      const ld = root.querySelector<HTMLElement>('.ld')
      const bg = root.querySelector<HTMLElement>('.ld-bg')
      const cab = root.querySelector<HTMLElement>('.ld-cab')
      const badge = root.querySelector<SVGSVGElement>('.ld-badge')
      /** the last fade runs on after finish() resolves (the loader lingers, click-through) */
      let linger = 0
      try {
        await wait(MIN_MS - (performance.now() - start))
        target = 1
        // let the warm-up finish (bounded)
        const t0 = performance.now()
        while (shown < 0.999 && performance.now() - t0 < FILL_MAX_MS) await wait(TICK_MS)
        clearInterval(ticker)
        shown = 1
        paint(1)
        ld?.classList.add('is-lit')
        await wait(HOLD_MS)
        // the page wakes as the loader lifts, so the first Tab lands in it
        releaseInert('loader')
        const extras = [...root.querySelectorAll('.ld-read, .ld-pool, .ld-bg-glow')]
        const to = calmUi() ? null : heroMark()
        const from = badge?.getBoundingClientRect()
        if (to && badge && from && from.width > 4 && from.height > 4) {
          // the match-cut: the badge glides onto the hero's mark while the cab
          // opens around it; the black lifts late in the glide
          const fx = from.left + from.width / 2
          const fy = from.top + from.height / 2
          const k = to.size / from.width
          badge.style.transformOrigin = '50% 50%'
          for (const x of extras) play(x, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out' })
          play(cab, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.06)' }], {
            duration: FLIGHT_MS * 0.55,
            easing: 'cubic-bezier(0.3, 0, 0.4, 1)',
          })
          // (its shadow on the cloth lets go on the way: the inlay is flush with the headstock)
          play(
            badge,
            [
              { transform: 'none', filter: BADGE_SHADOW },
              { transform: `translate(${f1(to.cx - fx)}px, ${f1(to.cy - fy)}px) scale(${k.toFixed(4)})`, filter: NO_SHADOW },
            ],
            { duration: FLIGHT_MS, easing: 'cubic-bezier(0.6, 0, 0.22, 1)' },
          )
          play(bg, [{ opacity: 1 }, { opacity: 0 }], { duration: FLIGHT_MS * 0.58, delay: FLIGHT_MS * 0.42, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' })
          await wait(FLIGHT_MS)
          // the let-go crossfades with the hero's own light coming up: finish()
          // resolves now ('hark:reveal') while the badge fades into the inlay
          play(badge, [{ opacity: 1 }, { opacity: 0 }], { duration: LETGO_MS, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' })
          linger = LETGO_MS
        } else {
          // no match-cut (or calm): a clean fade — the cab goes first, then the
          // black lifts while the story's own light comes up
          const tile = root.querySelector<HTMLElement>('.ld-tile')
          play(tile, [{ opacity: 1 }, { opacity: 0 }], { duration: TILE_OUT_MS, easing: 'ease-out' })
          for (const x of extras) play(x, [{ opacity: 1 }, { opacity: 0 }], { duration: TILE_OUT_MS, easing: 'ease-out' })
          await wait(TILE_OUT_MS * 0.7)
          play(bg, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-in-out' })
          linger = FADE_MS
        }
      } catch {
        /* never hold the page hostage */
        linger = 0
      } finally {
        clearInterval(ticker)
        releaseInert('loader')
        if (linger > 0) {
          root.style.pointerEvents = 'none'
          root.setAttribute('aria-hidden', 'true')
          window.setTimeout(() => root.remove(), linger + 40)
        } else root.remove()
      }
    },
  }
}
