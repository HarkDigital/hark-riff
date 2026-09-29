import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { buildGuitar } from '../../kit/guitar'
import { buildAmp } from '../../kit/amp'
import { stageFloor, cable, buildPedal } from '../../kit/stage'
import { GEL } from '../../world/World'

/* LOOK LAB — foundation check only (the hero agent replaces this chapter). */
export default function create(): Chapter {
  const group = new THREE.Group()
  let g: ReturnType<typeof buildGuitar>
  let head: ReturnType<typeof buildAmp>
  const q = new URLSearchParams(location.search)
  const view = q.get('view') ?? 'stand'
  return {
    id: 'hero',
    group,
    init(ctx) {
      g = buildGuitar({ mobile: ctx.mobile })
      group.add(g.group)
      if (view === 'stand') {
        g.group.rotation.set(-0.14, 0.18, Math.PI / 2 + 0.05)
        g.group.position.set(0.4, 2.45, 0)
        g.group.updateMatrixWorld(true)
      } else {
        g.group.rotation.set(-Math.PI / 2, 0, 0.35)
        g.group.position.set(0, 0.55, 0)
      }
      const floor = stageFloor(80, 60)
      group.add(floor)
      const cab = buildAmp({ kind: 'cab' })
      cab.group.position.set(-1.5, 0, -6)
      head = buildAmp({ kind: 'head' })
      head.group.position.set(-1.5, 7.4, -6)
      const cab2 = buildAmp({ kind: 'cab', grille: 'oxblood' })
      cab2.group.position.set(7, 0, -7)
      cab2.group.rotation.y = -0.3
      group.add(cab.group, head.group, cab2.group)
      const pedal = buildPedal({ name: 'Overdrive', sub: 'Hark', color: '#d8a21c' })
      pedal.group.position.set(2.8, 0, 3)
      pedal.group.rotation.y = -0.4
      pedal.setOn(1)
      group.add(pedal.group)
      group.add(cable([new THREE.Vector3(2.5, 0.03, 3.2), new THREE.Vector3(1.5, 0.03, 2.6), new THREE.Vector3(0.6, 0.03, 1.2), new THREE.Vector3(0.3, 0.3, 0.3)]))
    },
    update(local, frame, ctx) {
      const w = ctx.world.params
      w.spot = 1
      w.spotPos.set(4, 18, 12)
      w.spotAt.set(0.3, view === 'stand' ? 3.4 : 0.5, 0)
      w.spotAngle = 0.22
      w.rimA = 1.1
      w.rimAColor = GEL.amber
      w.rimB = 0.9
      w.rimBColor = GEL.red
      w.haze = 0.8
      w.beams = 0.7
      w.bokeh = 0.5
      for (let i = 0; i < 6; i++) g.strings.amp[i] = local > 0.5 ? 0.012 * (1 - i * 0.1) : 0
      g.strings.wobble = q.has('wobble') ? 1 : 0
      g.strings.lightDir.set(0.3, 1, 0.8)
      head.setPilot(1)
      head.setTubes(0.8)
      head.setKnob(0, 0.7)
      g.update(frame, ctx.camera, ctx.renderer)
    },
    camera(local, frame, out) {
      const portrait = frame.height > frame.width
      if (view === 'stand') {
        out.position.set(portrait ? 0.5 : 2.8, 4.2, portrait ? 17 : 12.5)
        out.target.set(portrait ? 0.2 : -0.6, 3.6, 0)
        out.fov = 36
      } else if (view === 'head') {
        const at = g.group.localToWorld(g.logoAt.clone())
        out.position.set(at.x + 1.6, at.y - 0.4, at.z + 3.2)
        out.target.copy(at)
        out.fov = 34
      } else if (view === 'macro') {
        out.position.set(3.2, 1.5, 1.2)
        out.target.set(1.4, 0.6, -0.2)
        out.fov = 30
      } else {
        out.position.set(0.5, 6, 6)
        out.target.set(0, 0.5, 0)
        out.fov = 40
      }
      out.parallax = 0.2
      void local
    },
  }
}
