import { el, rise } from '../../core/dom'
import { BRAND, CONTACT, OTHER_CONCEPTS } from '../../content'

/*
 * ENCORE's copy. One opaque tolex panel with cream piping, in two parts:
 *   A  eyebrow, "Say hello.", body, the address on a brushed-gold INPUT
 *      plate (the big call to action), Copy email (its jewel lamp lights
 *      when the address is on the clipboard)
 *   B  THE TOUR — the other concepts set like the back of a tour T-shirt
 *      (an arched heading, names only, stars between), Back to top, and
 *      the colophon
 * plus the closing sign-off (the last frames of the site): a script
 * "Thanks for listening.", the address, Back to top, the colophon.
 *
 * Layout is MEASURED on resize / font load (never per frame):
 *   side   landscape: the panel on the left, the guitar framed to its right
 *   stack  portrait: the panel along the bottom, the guitar above it
 * Short screens step the panel down (fit-1..3); if it still doesn't fit it
 * SPLITS into two beats (A, then B) that the chapter swaps mid-way.
 */

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Hud {
  root: HTMLElement
  probe: HTMLElement
  dock: HTMLElement
  panel: HTMLElement
  title: HTMLElement
  end: HTMLElement
  copyBtn: HTMLButtonElement
  /** THE TOUR's list of names */
  list: HTMLElement
  dirty: boolean
  /** performance.now() of the last successful copy (the stage answers) */
  copiedAt: number
}

export interface Layout {
  W: number
  H: number
  stack: boolean
  split: boolean
  /** the band between the chrome's safe areas */
  band: Rect
  /** the panel (split: the taller part's box) */
  panel: Rect
  /** free space for the guitar while the panel is up */
  art: Rect
  /** free space in the closing frame (above the sign-off) */
  fin: Rect
}

/** Clipboard API first, then a hidden-textarea fallback. */
export async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* denied or unsupported: fall through */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;'
  const active = document.activeElement as HTMLElement | null
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  active?.focus?.({ preventScroll: true })
  return ok
}

/** a polite live region OUTSIDE the aria-hidden stage, so a copy is announced */
function liveRegion() {
  const id = 'contact-copy-live'
  let node = document.getElementById(id)
  if (!node) {
    node = document.createElement('p')
    node.id = id
    node.className = 'sr-only'
    node.setAttribute('role', 'status')
    node.setAttribute('aria-live', 'polite')
    document.body.appendChild(node)
  }
  return node
}

function legal(parent: HTMLElement, cls: string) {
  const p = el('p', `hud-label contact-legal ${cls}`, undefined, parent)
  // wrap only between the parts; each separator stays with the part before it
  const parts = [`© ${new Date().getFullYear()} ${BRAND.name}`, ...BRAND.locale.split(' · ')]
  parts.forEach((t, i) => {
    el('span', 'contact-nw', i < parts.length - 1 ? `${t} ·` : t, p)
    if (i < parts.length - 1) p.appendChild(document.createTextNode(' '))
  })
  return p
}

function backToTop(parent: HTMLElement, cls: string) {
  const b = el('button', `contact-top ${cls}`, undefined, parent)
  b.type = 'button'
  el('span', '', 'Back to top', b)
  el('span', 'contact-arr', '↑', b).setAttribute('aria-hidden', 'true')
  b.addEventListener('click', e => {
    const hark = window.__hark
    if (!hark) return
    hark.land('hero')
    // keyboard activation: take focus to the hero's heading as well
    if (e.detail === 0) hark.engine?.focusChapter?.('hero')
  })
  return b
}

/** the address on a brushed-gold amp plate, with an INPUT jack */
function plate(parent: HTMLElement, cls = '') {
  const a = el('a', `contact-plate ${cls}`, undefined, parent)
  a.href = CONTACT.href
  const jack = el('span', 'contact-jack', undefined, a)
  jack.setAttribute('aria-hidden', 'true')
  el('span', 'contact-addr', BRAND.email, a)
  el('span', 'contact-go', '→', a).setAttribute('aria-hidden', 'true')
  return a
}

const SVGNS = 'http://www.w3.org/2000/svg'
/** a five-point star centred at x, y (screen-print, for the tour heading) */
const STAR = (x: number, y: number, r = 7.5) => {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const k = i % 2 ? r * 0.42 : r
    pts.push(`${(x + Math.cos(a) * k).toFixed(2)},${(y + Math.sin(a) * k).toFixed(2)}`)
  }
  return `<polygon class="contact-arc-star" points="${pts.join(' ')}"/>`
}
let arcSeq = 0

/** "THE TOUR" arched over the list, screen-printed (a little ink wear) */
function tourHeading(parent: HTMLElement) {
  const id = `contact-arc-${++arcSeq}`
  const svg = document.createElementNS(SVGNS, 'svg')
  svg.setAttribute('class', 'contact-arc')
  svg.setAttribute('viewBox', '0 0 320 74')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = `
    <defs>
      <path id="${id}-p" d="M 44 64 Q 160 22 276 64" fill="none"/>
      <filter id="${id}-wear" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="7" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3 2.55" result="m"/>
        <feComposite in="SourceGraphic" in2="m" operator="in"/>
      </filter>
    </defs>
    <g filter="url(#${id}-wear)">
      <text class="contact-arc-t" text-anchor="middle"><textPath href="#${id}-p" startOffset="50%">THE TOUR</textPath></text>
      ${STAR(20, 60)}${STAR(300, 60)}
    </g>`
  // Safari < 12.1 reads only xlink:href on textPath
  svg.querySelector('textPath')?.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${id}-p`)
  parent.appendChild(svg)
  return svg
}

export function buildHud(stage: HTMLElement): Hud {
  const root = el('div', 'contact-root', undefined, stage)
  const probe = el('div', 'contact-probe', undefined, root)
  const dock = el('div', 'contact-dock', undefined, root)
  const panel = el('div', 'hud-panel contact-panel', undefined, dock)

  const partA = el('div', 'contact-part contact-a', undefined, panel)
  el('p', 'hud-eyebrow contact-eyebrow', CONTACT.eyebrow, partA)
  const title = rise(el('h2', 'hud-title contact-title', undefined, partA), 'Say <em>hello.</em>')
  el('p', 'hud-body contact-body', CONTACT.body, partA)
  const cta = el('div', 'contact-cta', undefined, partA)
  plate(cta)
  const copyBtn = el('button', 'hud-btn hud-btn--ghost contact-copy', undefined, cta)
  copyBtn.type = 'button'
  copyBtn.setAttribute('aria-label', `Copy email address ${BRAND.email}`)
  el('i', 'contact-lamp', undefined, copyBtn).setAttribute('aria-hidden', 'true')
  const copyLabel = el('span', 'contact-copy-t', 'Copy email', copyBtn)

  const partB = el('div', 'contact-part contact-b', undefined, panel)
  const tour = el('div', 'contact-tour', undefined, partB)
  tourHeading(tour)
  el('p', 'hud-label contact-tour-sub', 'Other concepts · open in a new tab', tour)
  const list = el('ul', 'contact-tour-list', undefined, tour)
  for (const c of OTHER_CONCEPTS) {
    const li = el('li', '', undefined, list)
    const a = el('a', 'contact-tour-link', c.name, li)
    a.href = c.url
    a.target = '_blank'
    a.rel = 'noopener'
  }
  const foot = el('div', 'contact-foot', undefined, partB)
  backToTop(foot, '')
  legal(foot, '')

  // the closing sign-off
  const end = el('div', 'contact-end', undefined, root)
  el('p', 'contact-thanks', 'Thanks for listening.', end)
  plate(end, 'contact-plate--end')
  const endRow = el('div', 'contact-end-row', undefined, end)
  backToTop(endRow, 'hud-btn hud-btn--ghost contact-top--end')
  legal(end, 'contact-legal--end')

  const hud: Hud = { root, probe, dock, panel, title, end, copyBtn, list, dirty: true, copiedAt: -1e9 }

  const live = liveRegion()
  let resetT = 0
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(BRAND.email)
    window.clearTimeout(resetT)
    copyLabel.textContent = ok ? 'Copied' : 'Copy failed'
    copyBtn.classList.toggle('is-copied', ok)
    copyBtn.classList.toggle('is-failed', !ok)
    if (ok) hud.copiedAt = performance.now()
    live.textContent = ok ? `Copied ${BRAND.email} to the clipboard.` : `Copy failed. The address is ${BRAND.email}.`
    window.__hark?.engine?.wake?.()
    resetT = window.setTimeout(() => {
      copyLabel.textContent = 'Copy email'
      copyBtn.classList.remove('is-copied', 'is-failed')
      live.textContent = ''
    }, 2200)
  })

  const dirty = () => (hud.dirty = true)
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(dirty).observe(probe)
  window.addEventListener('resize', dirty)
  document.fonts?.ready.then(dirty).catch(() => {})
  return hud
}

const FIT = ['contact-fit-1', 'contact-fit-2', 'contact-fit-3'] as const

/** mark the last name on each wrapped line (its star hides) */
function markLines(list: HTMLElement) {
  const items = Array.from(list.children) as HTMLElement[]
  for (let i = 0; i < items.length; i++) {
    const next = items[i + 1]
    items[i].classList.toggle('is-eol', !!next && next.offsetTop > items[i].offsetTop + 2)
  }
}

/** bottom of the chrome's brand lockup (CSS px), or -1 */
function brandBottom() {
  const b = document.querySelector<HTMLElement>('#chrome .ch-brand')
  if (!b) return -1
  const r = b.getBoundingClientRect()
  return r.height > 0 ? r.bottom : -1
}

const rectOf = (r: DOMRect): Rect => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom })

/** Measure the panel and the free areas around it (resize-time only). */
export function measureHud(hud: Hud, W: number, H: number): Layout {
  const { root, panel } = hud
  const stack = H > W * 1.05
  root.classList.toggle('is-stack', stack)
  root.classList.remove('is-split', 'show-b', ...FIT)
  const band = rectOf(hud.probe.getBoundingClientRect())
  const bandH = Math.max(1, band.y1 - band.y0)
  // portrait: the panel may take the lower ~60% of the band; the guitar lives above
  const limit = stack ? bandH * (H < 700 ? 0.7 : 0.62) : bandH
  let split = false
  const partH = [0, 0]
  // offsetHeight ignores the reveal transform (stable mid-reveal)
  const tallest = () => {
    if (!split) return panel.offsetHeight
    root.classList.remove('show-b')
    partH[0] = panel.offsetHeight
    root.classList.add('show-b')
    partH[1] = panel.offsetHeight
    root.classList.remove('show-b')
    return Math.max(partH[0], partH[1])
  }
  const fit = () => {
    for (let i = 0; i < FIT.length && tallest() > limit; i++) root.classList.add(FIT[i])
  }
  fit()
  if (panel.offsetHeight > limit) {
    split = true
    root.classList.remove(...FIT)
    root.classList.add('is-split')
    fit()
  }
  // the tour list: no star at the end of a printed line
  if (split) root.classList.add('show-b')
  markLines(hud.list)
  if (split) root.classList.remove('show-b')
  const ph = tallest()
  const dock = hud.dock.getBoundingClientRect()
  const px0 = dock.left + panel.offsetLeft
  const pw = panel.offsetWidth
  // the panel is centred (side) or bottom-aligned (stack) in the dock
  const py1 = stack ? dock.bottom : dock.top + (dock.height + ph) / 2
  const pan: Rect = { x0: px0, y0: py1 - ph, x1: px0 + pw, y1: py1 }

  let art: Rect
  if (!stack) {
    const gap = Math.max(20, W * 0.03)
    art = { x0: pan.x1 + gap, x1: band.x1, y0: band.y0, y1: band.y1 }
  } else {
    const gap = Math.max(12, H * 0.02)
    // phones: the guitar may rise into the top band, to just under the brand
    const bb = brandBottom()
    const top = W < 600 ? Math.max(bb > 0 ? bb + 10 : band.y0 * 0.8, 44) : band.y0
    art = { x0: band.x0, x1: band.x1, y0: top, y1: Math.max(top + 90, pan.y0 - gap) }
  }
  // the closing frame: the guitar over the sign-off
  const endTop = hud.end.offsetTop || band.y1 - 120
  const fin: Rect = { x0: band.x0, x1: band.x1, y0: stack && W < 600 ? art.y0 : band.y0, y1: Math.max(band.y0 + 90, endTop - Math.max(12, H * 0.02)) }
  root.classList.toggle('is-split', split)
  hud.dirty = false
  return { W, H, stack, split, band, panel: pan, art, fin }
}
