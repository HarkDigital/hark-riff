import type { Engine, EngineState } from '../core/Engine'
import type { Frame } from '../core/types'
import type { Sound } from './sound'
import { BRAND, CONTACT, MICROCOPY, SITE } from '../content'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { holdInert, releaseInert } from './inert'
import { mountRotateGate } from './rotate'
import { bindScene, calmUi, holdScene, readMotion, releaseScene, rememberMotion } from './prefs'
import { publishTextures } from './texture'

/*
 * Persistent chrome — RIFF: the gear at the edge of the stage. Everything
 * sits on small OPAQUE PLATES of black tolex with a cream piping line (never
 * a blur over the canvas: backdrop-filter costs 15–25% of the frame), so the
 * 11px caps hold >= 4.5:1 over hot beams and black stage alike. Warm dark
 * scrims at the top and bottom edges settle the bands.
 *
 *   top-left      the Hark mark (cream, never tinted) + "Hark.Digital" (Anybody,
 *                 heavy and a touch wide, like an amp nameplate; the dot is an
 *                 amber JEWEL LAMP) + the tag "Concept · Riff" (Riff in the
 *                 Yellowtail headstock script) on its own plate (→ the start)
 *   top-right     Work · Services · Contact on one plate, like an amp's channel
 *                 strip: the channel on screen lights its amber jewel LED —
 *                 + "Start a project" (the cream-gold hud-btn). ≤ 820px: "Menu"
 *                 (a strings glyph) opens a full-screen SETLIST dialog (focus
 *                 moves in, Tab is trapped, Escape closes, the page behind is
 *                 inert and the scene pauses once covered; focus returns to Menu).
 *   bottom-left   Amp and Motion: two chrome BAT-HANDLE TOGGLE SWITCHES with a
 *                 jewel pilot lamp each (aria-pressed buttons). The lever flips
 *                 up for On (a quick click through the nut), the jewel lights
 *                 amber. Amp: On / Standby (the sound, off by default). Motion
 *                 off sets engine.motion = false + html.motion-off, is
 *                 remembered (localStorage via prefs.ts) and starts off under
 *                 prefers-reduced-motion.
 *   bottom-right  "03 / 07  UP TO ELEVEN · Services" over a little FRETBOARD:
 *                 rosewood between cream binding, a bone nut, nickel fret
 *                 wires, and one 24x24 cell per chapter (a button, named) with
 *                 a mother-of-pearl dot inlay — the chapter on screen lights
 *                 its dot amber (like a side-marker LED), the ones behind you
 *                 stay pearl, the ones ahead are dim.
 *   The bottom band is one landmark (<aside> "Preferences and chapters"), so
 *   landmark navigation reaches Amp / Motion. The readout is NOT a live
 *   region (scrolling, a reader's cursor and each Tab into a chapter would
 *   queue "04 / 07 …" on top of the heading just reached); a quiet sr-only
 *   status names the chapter only after a pip / link was activated without
 *   moving focus to its heading (a tap, a click).
 *
 * API used by main.ts: createChrome(root, engine, sound) → { update(frame, state) }.
 * Navigation always uses engine.land(id) (lands on settled copy; long jumps cut).
 */

/** Plain business names beside each chapter's poetic label. */
const BUSINESS: Record<string, string> = {
  hero: 'Home',
  work: 'Work',
  services: 'Services',
  voices: 'Clients',
  shield: 'Security',
  process: 'Process',
  contact: 'Contact',
}
const NAV = ['work', 'services', 'contact']
const MENU_QUERY = '(max-width: 820px)'
const pad = (n: number) => String(n).padStart(2, '0')
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/* glyphs (decorative): three strings, wound to plain (heavy → light gauge) / a crossed pair */
const MENU_IC = `<svg class="ch-ic" viewBox="0 0 22 14" aria-hidden="true" focusable="false"><path d="M1 2.5h20" stroke-width="2.1"/><path d="M1 7h20" stroke-width="1.5"/><path d="M1 11.5h20" stroke-width="1"/></svg>`
const CLOSE_IC = `<svg class="ch-ic" viewBox="0 0 22 14" aria-hidden="true" focusable="false"><path d="M6 1.5l10 11M16 1.5l-10 11" stroke-width="1.6"/></svg>`

export function createChrome(root: HTMLElement, engine: Engine, sound: Sound) {
  const slots = engine.slots
  const total = slots.length
  const indexOf = (id: string) => slots.findIndex(s => s.def.id === id)
  const biz = (id: string, fallback = '') => BUSINESS[id] ?? fallback
  const first = slots[0]?.def.id ?? 'hero'

  // the rotate card (and the opaque menu) cover the picture: pause it
  // (engine.paused) while either is up — a counted hold, so both can overlap
  bindScene(engine)
  mountRotateGate(shown => (shown ? holdScene('rotate') : releaseScene('rotate')))

  // the tolex grain on the plates and the grille cloth behind the setlist menu
  publishTextures(['tolex', 'wheat'])

  // ---------------------------------------------------------------- markup

  const brandInner = `<span class="ch-mark" aria-hidden="true">${markSvg('ch-mark-svg')}</span>
      <span class="ch-brand-text" aria-hidden="true">${WORDMARK}${CONCEPT_TAG}</span>`

  const links = NAV.filter(id => indexOf(id) >= 0)
    .map(id => `<li><a class="ch-link" href="#${id}" data-go="${id}"><i class="ch-led" aria-hidden="true"></i><span>${biz(id)}</span></a></li>`)
    .join('')

  const pips = slots
    .map(
      (s, i) =>
        `<li><button type="button" class="ch-pip" data-go="${s.def.id}" aria-label="${pad(i + 1)}: ${esc(s.def.label)} (${esc(biz(s.def.id, s.def.label))})"><i class="ch-dot" aria-hidden="true"></i></button></li>`,
    )
    .join('')

  const rows = slots
    .map(
      (s, i) =>
        `<li><a class="ch-ml" href="#${s.def.id}" data-go="${s.def.id}" aria-label="${esc(biz(s.def.id, s.def.label))}, ${i + 1} of ${total}: ${esc(s.def.label)}">
          <span class="ch-ml-n" aria-hidden="true">${pad(i + 1)}</span>
          <i class="ch-led ch-ml-led" aria-hidden="true"></i>
          <span class="ch-ml-name" aria-hidden="true">${esc(biz(s.def.id, s.def.label))}</span>
          <span class="ch-ml-lab" aria-hidden="true">${esc(s.def.label)}</span>
        </a></li>`,
    )
    .join('')

  let motionOn = readMotion()
  // an amp-panel toggle: the jewel, the name, the bat-handle switch and its
  // two engraved legends (On above, Standby / Off below) — the lever points
  // at the one that's lit; the button's name is the label, its state aria-pressed
  const tgl = (kind: 'sound' | 'motion', extra = '') => {
    const on = kind === 'sound' ? sound.enabled : motionOn
    const k = kind === 'sound' ? MICROCOPY.audio : MICROCOPY.motion
    const up = kind === 'sound' ? MICROCOPY.audioOn : MICROCOPY.motionOn
    const down = kind === 'sound' ? MICROCOPY.audioOff : MICROCOPY.motionOff
    return `<button class="ch-tgl ch-tgl--${kind}${extra}" type="button" data-${kind}-toggle aria-pressed="${on}"><i class="ch-jewel" aria-hidden="true"></i><span class="ch-tgl-k">${k}</span><i class="ch-sw" aria-hidden="true"><i class="ch-sw-bat"></i></i><span class="ch-tgl-lg" aria-hidden="true"><span class="ch-tgl-up">${up}</span><span class="ch-tgl-dn">${down}</span></span></button>`
  }

  root.innerHTML = `
  <div class="ch">
    <div class="ch-scrim ch-scrim--top" aria-hidden="true"></div>
    <div class="ch-scrim ch-scrim--bot" aria-hidden="true"></div>
    <header class="ch-top">
      <a class="ch-brand" href="#${first}" data-go="${first}" aria-label="${esc(BRAND.name)}, ${esc(SITE.name)} concept, back to the start">${brandInner}</a>
      <nav class="ch-nav" aria-label="Primary">
        <ul class="ch-links">${links}</ul>
        <a class="hud-btn ch-cta" href="#contact" data-go="contact" data-focus>Start a project</a>
      </nav>
      <button class="ch-menu-btn" type="button" aria-expanded="false" aria-controls="ch-menu" aria-haspopup="dialog"><span>Menu</span>${MENU_IC}</button>
    </header>

    <aside class="ch-bottom" aria-label="Preferences and chapters">
      <div class="ch-prefs" role="group" aria-label="Preferences">${tgl('sound')}${tgl('motion')}</div>
      <div class="ch-read">
        <p class="ch-read-line"><span class="ch-read-n"><b>01</b> / ${pad(total)}</span><span class="ch-read-sep" aria-hidden="true"> — </span><span class="ch-read-l"></span><span class="ch-read-b"></span></p>
        <nav class="ch-pips" aria-label="Chapters"><ol class="ch-neck">${pips}</ol></nav>
        <p class="sr-only" role="status" data-ch-status></p>
      </div>
    </aside>

    <div class="ch-menu" id="ch-menu" role="dialog" aria-modal="true" aria-label="Menu" data-lenis-prevent hidden>
      <div class="ch-menu-cloth" aria-hidden="true"></div>
      <div class="ch-menu-top">
        <span class="ch-brand ch-menu-brand" aria-hidden="true">${brandInner}</span>
        <button class="ch-menu-btn ch-menu-close" type="button"><span>Close</span>${CLOSE_IC}</button>
      </div>
      <div class="ch-menu-body">
        <p class="ch-menu-k" aria-hidden="true">${esc(MICROCOPY.signalEyebrow)}</p>
        <nav class="ch-menu-nav" aria-label="Chapters"><ol class="ch-ml-list">${rows}</ol></nav>
        <div class="ch-menu-foot">
          <a class="hud-btn ch-menu-cta" href="${CONTACT.href}">Email us</a>
          <a class="ch-menu-mail" href="${CONTACT.href}">${esc(BRAND.email)}</a>
        </div>
        <div class="ch-menu-prefs" role="group" aria-label="Preferences">${tgl('sound', ' ch-menu-tgl')}${tgl('motion', ' ch-menu-tgl')}</div>
      </div>
    </div>
  </div>`

  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!
  const ch = $('.ch')
  const top = $('.ch-top')
  const bottom = $('.ch-bottom')
  const menu = $('.ch-menu')
  const menuBtn = $<HTMLButtonElement>('.ch-top .ch-menu-btn')
  const menuClose = $<HTMLButtonElement>('.ch-menu-close')
  const navEls = [...root.querySelectorAll<HTMLAnchorElement>('.ch-link')]
  const pipEls = [...root.querySelectorAll<HTMLButtonElement>('.ch-pip')]
  const menuLinks = [...root.querySelectorAll<HTMLAnchorElement>('.ch-ml')]
  const soundBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-sound-toggle]')]
  const motionBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]')]
  const readN = $('.ch-read-n b')
  const readL = $('.ch-read-l')
  const readB = $('.ch-read-b')
  const status = $('[data-ch-status]')
  /** the room to name once we arrive (set by a pointer activation only) */
  let announceFor: string | null = null
  const say = (i: number) => {
    const d = slots[i]?.def
    if (d) status.textContent = `${pad(i + 1)} of ${pad(total)}: ${d.label}, ${biz(d.id, d.label)}`
  }

  // ---------------------------------------------------------------- navigation

  root.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLElement>('[data-go]')
    if (!a || !root.contains(a)) return
    e.preventDefault()
    const id = a.dataset.go!
    const fromMenu = menuOpen && menu.contains(a)
    if (menuOpen) closeMenu(false)
    sound.blip(a.matches('.ch-cta') ? 7 : Math.max(0, indexOf(id)))
    if (indexOf(id) >= 0) engine.land(id)
    // keyboard activation (detail 0) hands focus on to the chapter's heading
    // so the next Tab continues in the story; a tap in the menu returns focus
    // to Menu, the control that opened it
    const keyboard = e.detail === 0
    const toHeading = keyboard && indexOf(id) >= 0 && (fromMenu || a.matches('.ch-link, .ch-pip, .ch-brand') || a.hasAttribute('data-focus'))
    if (toHeading) engine.focusChapter(id)
    else if (fromMenu) menuBtn.focus({ preventScroll: true })
    // focus stayed on the control: name the room once the story gets there
    // (the heading announces itself when it takes focus)
    status.textContent = ''
    announceFor = null
    if (!toHeading && indexOf(id) >= 0) {
      if (indexOf(id) === lastIndex) window.setTimeout(() => say(lastIndex), 120)
      else announceFor = id
    }
  })

  // ---------------------------------------------------------------- sound

  const syncSound = (on: boolean) => {
    for (const b of soundBtns) b.setAttribute('aria-pressed', String(on))
  }
  for (const b of soundBtns) b.addEventListener('click', () => sound.toggle())
  sound.onChange.push(syncSound)
  syncSound(sound.enabled)

  // -------------------------------------------------------------------- motion

  const syncMotion = () => {
    document.documentElement.classList.toggle('motion-off', !motionOn)
    engine.motion = motionOn
    for (const b of motionBtns) b.setAttribute('aria-pressed', String(motionOn))
    window.dispatchEvent(new CustomEvent('hark:motion', { detail: { on: motionOn } }))
  }
  for (const b of motionBtns)
    b.addEventListener('click', () => {
      motionOn = !motionOn
      rememberMotion(motionOn)
      sound.blip(motionOn ? 4 : 2)
      syncMotion()
    })
  syncMotion()

  // ---------------------------------------------------------------- the menu

  let menuOpen = false
  let menuTimer = 0
  const focusables = () =>
    [...menu.querySelectorAll<HTMLElement>('a[href], button')].filter(el => !el.hidden && el.getClientRects().length > 0)
  const openMenu = () => {
    if (menuOpen) return
    menuOpen = true
    clearTimeout(menuTimer)
    menu.hidden = false
    // flush the closed state so the dialog fades up
    void menu.offsetWidth
    ch.classList.add('is-menu')
    menuBtn.setAttribute('aria-expanded', 'true')
    holdInert('menu', [
      document.getElementById('stages'),
      document.getElementById('track'),
      document.querySelector<HTMLElement>('.skip-link'),
      top,
      bottom,
    ])
    engine.lenis?.stop()
    // the menu is opaque: hold the frame once it has covered the picture
    menuTimer = window.setTimeout(() => menuOpen && holdScene('menu'), calmUi() ? 0 : 300)
    menu.scrollTop = 0
    const now = menuLinks[lastIndex] ?? menuLinks[0]
    now?.focus({ preventScroll: true })
    sound.blip(2)
  }
  const closeMenu = (restoreFocus = true) => {
    if (!menuOpen) return
    menuOpen = false
    clearTimeout(menuTimer)
    ch.classList.remove('is-menu')
    menuBtn.setAttribute('aria-expanded', 'false')
    releaseInert('menu')
    releaseScene('menu')
    engine.lenis?.start()
    menuTimer = window.setTimeout(
      () => {
        if (!menuOpen) menu.hidden = true
      },
      calmUi() ? 0 : 260,
    )
    if (restoreFocus) menuBtn.focus({ preventScroll: true })
  }
  menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()))
  menuClose.addEventListener('click', () => closeMenu())
  // capture: the dialog's own trap runs ahead of the no-`inert` fallback in inert.ts
  window.addEventListener(
    'keydown',
    e => {
      if (!menuOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1
        e.preventDefault()
        f[next].focus()
      }
    },
    true,
  )
  // widening past the menu breakpoint closes the menu (the full nav is back)
  const narrow = matchMedia(MENU_QUERY)
  const onNarrow = (e: MediaQueryListEvent) => {
    if (!e.matches) closeMenu(false)
  }
  if (typeof narrow.addEventListener === 'function') narrow.addEventListener('change', onNarrow)
  else narrow.addListener?.(onNarrow)
  // the static page took over (no GPU): let go of everything the menu held
  window.addEventListener('hark:fallback', () => closeMenu(false))

  // -------------------------------------------------------------------- update

  let lastIndex = -1
  return {
    update(_frame: Frame, state: EngineState) {
      if (state.index === lastIndex) return
      const slot = state.slots[state.index]
      if (!slot) return
      lastIndex = state.index
      const id = slot.def.id
      if (announceFor === id) {
        announceFor = null
        say(state.index)
      }
      readN.textContent = pad(state.index + 1)
      readL.textContent = slot.def.label
      readB.textContent = ` · ${biz(id, slot.def.label)}`
      pipEls.forEach((b, i) => {
        b.classList.toggle('is-on', i === state.index)
        b.classList.toggle('is-past', i < state.index)
        if (i === state.index) b.setAttribute('aria-current', 'step')
        else b.removeAttribute('aria-current')
      })
      navEls.forEach(a => {
        const on = a.dataset.go === id
        a.classList.toggle('is-on', on)
        if (on) a.setAttribute('aria-current', 'location')
        else a.removeAttribute('aria-current')
      })
      menuLinks.forEach((a, i) => {
        a.classList.toggle('is-on', i === state.index)
        if (i === state.index) a.setAttribute('aria-current', 'location')
        else a.removeAttribute('aria-current')
      })
      ch.dataset.chapter = id
    },
  }
}
