import type { ChapterDef } from '../core/types'

/**
 * The scroll story, in order. `length` is scroll distance in viewport
 * heights; `landing` is where nav jumps land (local progress, on settled
 * copy — keep it clear of the ~6% cut window at each end). Each chapter lives
 * in src/chapters/<id>/ and default-exports a factory returning a Chapter.
 *
 * RIFF: a rock stage between songs, one guitar at the heart of it —
 * Soundcheck (the mark on the headstock, the first chord), The Pedalboard
 * (work: six stompboxes, the work on the stage screen), Up to Eleven
 * (services: the amp’s dial goes to eleven), The Picks (voices: eight custom
 * picks tucked in the strings at the headstock), Feedback
 * (security: the squeal, the mute, the pilot light that never goes out),
 * The Workbench (process: the luthier's bench, a guitar built in four
 * steps), Encore (contact). Lengths follow the reading-pace lessons (~0.6 vh
 * per item). The ids are shared with src/core/srContent.ts and the chrome's
 * business names.
 */
const lab = typeof location !== 'undefined' && new URLSearchParams(location.search).has('lab')

export const CHAPTERS: ChapterDef[] = [
  { id: 'hero', label: 'Soundcheck', length: 2.4, landing: 0, intro: 0, load: () => (lab ? import('./hero/lab') : import('./hero/index')) },
  { id: 'work', label: 'The Pedalboard', length: 6.0, landing: 0.07, intro: 0.07, load: () => import('./work/index') },
  { id: 'services', label: 'Up to Eleven', length: 7.0, landing: 0.06, intro: 0.05, load: () => import('./services/index') },
  { id: 'voices', label: 'The Picks', length: 5.5, landing: 0.075, intro: 0.07, load: () => import('./voices/index') },
  { id: 'shield', label: 'Feedback', length: 1.8, landing: 0.45, intro: 0.45, load: () => import('./shield/index') },
  { id: 'process', label: 'The Workbench', length: 3.0, landing: 0.2, intro: 0.1, load: () => import('./process/index') },
  { id: 'contact', label: 'Encore', length: 1.5, landing: 0.3, intro: 0.3, load: () => import('./contact/index') },
]
