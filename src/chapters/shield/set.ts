import * as THREE from 'three'
import { buildGuitar, type Guitar } from '../../kit/guitar'
import { buildAmp, type Amp } from '../../kit/amp'
import { cable, gaffer, stageFloor } from '../../kit/stage'
import { FONT, tile } from '../../kit/materials'
import { rng } from '../../core/math'
import { logoGeometry } from '../../logo/logo'
import { nextFrame } from '../../core/yield'

/*
 * FEEDBACK · the set. A half stack (a 4x12 cab with a head on top, flush
 * fronts at z = FRONT) centre stage, a second cab angled off to the right in
 * the dark, black planks with gaffer marks, and the sunburst guitar LEANING
 * against the stack — its tail on the floor, the back of its headstock
 * resting on the head's front, left of the knobs — plugged in, its cable
 * running across the floor to the stack.
 *
 * The head's three knobs are the watch (Hardening · Monitoring · Backups,
 * the chapter's accessible copy says the same), its red jewel pilot lamp is
 * the light that never goes out, and a small engraved legend sits under the
 * lamp and the two toggles: STANDBY · POWER · 24/7.
 *
 * The felt MUTE: a strip of black felt that drops onto the strings between
 * the pickups (a hand-less palm mute) and drapes over the outer strings.
 * It lives in the guitar's local space so it follows the instrument.
 *
 * Units: 1 = 10 cm. World: floor y = 0, the stack's front at z = FRONT.
 */

export const FRONT = 1.8
export const HEAD_Y = 7.4
/** the lean back from vertical (radians) and the spin toward the camera */
const LEAN = 0.56
const SPIN = 0.22
const GUITAR_X = -1.35
/** where the felt lands, guitar-local x (between the pickups) */
export const FELT_X = 0.94
const FELT = { w: 0.34, len: 1.02, t: 0.07 }

export interface ShieldSet {
  guitar: Guitar
  head: Amp
  cab: Amp
  felt: THREE.Mesh
  /** the felt's resting position (guitar local) */
  feltRest: THREE.Vector3
  /** the jewel's glow on the panel */
  jewelLight: THREE.PointLight
  /** additive halos: the jewel's, and one per power tube (read through the glass) */
  jewelHalo: THREE.Sprite
  tubeHalos: THREE.Sprite[]
  /** named world points for the camera */
  at: {
    body: THREE.Vector3
    neck: THREE.Vector3
    headstock: THREE.Vector3
    jewel: THREE.Vector3
    stack: THREE.Vector3
    amp: THREE.Vector3
    under: THREE.Vector3
    felt: THREE.Vector3
  }
}

/** a soft black felt with a fibre sheen */
function feltMaterial() {
  const fibres = tile(
    'shield-felt',
    128,
    128,
    (g, w, h) => {
      const r = rng(29)
      const img = g.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const v = 120 + (r() - 0.5) * 90
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
        img.data[i * 4 + 3] = 255
      }
      g.putImageData(img, 0, 0)
      // a few matted fibres
      for (let i = 0; i < 260; i++) {
        const x = r() * w
        const y = r() * h
        const a = r() * Math.PI
        const l = 2 + r() * 7
        g.strokeStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${0.12 + r() * 0.18})`
        g.lineWidth = 0.6
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
        g.stroke()
      }
    },
    { srgb: false },
  )
  return new THREE.MeshPhysicalMaterial({
    color: '#1c1918',
    roughness: 0.94,
    bumpMap: fibres,
    bumpScale: 1.6,
    sheen: 1,
    sheenRoughness: 0.42,
    sheenColor: new THREE.Color('#b8a08e'),
  })
}

/**
 * the felt strip: a thick pad across the strings whose ends drape down over
 * the outer strings onto the top; soft rounded edges. `drop` is how far the
 * ends fall (the strings sit ~0.09 above the top between the pickups).
 */
function feltStrip(drop: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(FELT.w, FELT.len, FELT.t, 8, 48, 2)
  const p = geo.attributes.position
  const flat = 0.27
  const hw = FELT.w / 2
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i)
    const y = p.getY(i)
    let z = p.getZ(i)
    // round the long edges (a soft pillow section)
    const e = Math.max(0, Math.abs(x) / hw - 0.5) / 0.5
    z *= Math.max(0.3, Math.sqrt(Math.max(0, 1 - e * e)))
    // drape: past the outer strings the felt falls to the top, then lies on it
    const d = Math.max(0, Math.abs(y) - flat)
    const fall = drop * (d > 0 ? 1 - Math.exp(-d * d * 60) : 0)
    z -= fall
    // the ends spread a little as they flatten
    x *= 1 + 0.12 * Math.min(1, d * 6)
    p.setXYZ(i, x, y, z)
  }
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, feltMaterial())
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** the engraved legend under the jewel and the toggles (transparent decal on the gold panel) */
function legendDecal(): THREE.Mesh {
  const W = 1.34
  const H = 0.34
  const tex = tile(
    'shield-legend',
    640,
    160,
    (g, cw, ch) => {
      g.clearRect(0, 0, cw, ch)
      g.fillStyle = '#1a1208'
      g.textAlign = 'left'
      g.textBaseline = 'middle'
      const px = (x: number) => ((x - 2.72 + W / 2) / W) * cw
      // tracked caps (canvas letterSpacing isn't in Safari): glyph by glyph
      const spaced = (text: string, cx: number, cy: number, track: number) => {
        const ws = [...text].map(c => g.measureText(c).width)
        const total = ws.reduce((a, b) => a + b, 0) + track * (text.length - 1)
        let x = cx - total / 2
        ;[...text].forEach((c, i) => {
          g.fillText(c, x, cy)
          x += ws[i] + track
        })
      }
      // the baseline of the head's own knob labels (panel y 1.535) sits at 0.69 of this decal
      const y = ch * 0.69
      g.font = FONT.mono(32, 650)
      spaced('STANDBY', px(2.32), y, 2.5)
      spaced('POWER', px(2.7), y, 2.5)
      g.font = FONT.display(74, 880)
      g.save()
      g.translate(px(3.15), y - 6)
      g.scale(1.16, 1)
      g.textAlign = 'center'
      g.fillText('24/7', 0, 0)
      g.restore()
    },
    { repeat: false },
  )
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.7,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  )
  m.receiveShadow = true
  return m
}

/**
 * A pilot jewel: flat facets (screen-space normals), a hot orange heart
 * falling off to a deep ruby rim, and a glint on facets that face the eye.
 * Kept moderate: ACES bleaches a hot pure red toward peach.
 */
export function jewelMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vP = position;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLevel;
      varying vec3 vP;
      varying vec3 vW;
      void main() {
        vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
        vec3 V = normalize(cameraPosition - vW);
        float f = abs(dot(N, V));
        float r = clamp(length(vP.xy) / 0.13, 0.0, 1.0);
        float core = 1.0 - smoothstep(0.0, 0.8, r);
        vec3 deep = vec3(0.5, 0.01, 0.005);
        vec3 hot = vec3(2.1, 0.3, 0.07);
        vec3 col = mix(deep, hot, core * core) * (0.5 + 0.5 * f);
        float g = f * f;
        g = g * g;
        g = g * g;
        col += vec3(0.9, 0.35, 0.2) * g * g * 0.5;
        gl_FragColor = vec4(col * uLevel, 1.0);
      }
    `,
  })
}

/** a soft round glow for additive halos */
function haloMap() {
  return tile(
    'shield-halo',
    64,
    64,
    (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      r.addColorStop(0, 'rgba(255,255,255,1)')
      r.addColorStop(0.18, 'rgba(255,255,255,0.55)')
      r.addColorStop(0.45, 'rgba(255,255,255,0.14)')
      r.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = r
      g.fillRect(0, 0, w, h)
    },
    { repeat: false, srgb: false },
  )
}

export function halo(size: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: haloMap(), color: '#000000', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }),
  )
  s.scale.setScalar(size)
  s.renderOrder = 4
  return s
}

export async function buildSet(group: THREE.Group, mobile: boolean, env: THREE.Texture): Promise<ShieldSet> {
  // ---- the floor and its marks (its own dim reflections: planks aren't a mirror)
  const floor = stageFloor(240, 160)
  {
    // black paint over wood: a low sheen (the gel rims mustn't turn the planks into a mirror)
    const src = floor.material as THREE.MeshStandardMaterial
    floor.material = new THREE.MeshPhysicalMaterial({
      color: '#a8a09a',
      map: src.map,
      roughness: 1,
      roughnessMap: src.roughnessMap,
      specularIntensity: 0.28,
      envMap: env,
      envMapIntensity: 0.14,
    })
    src.dispose()
  }
  group.add(floor)
  const r = rng(7)
  for (const [x, z, a, l] of [
    [-3.4, 6.2, 0.15, 1.5],
    [3.9, 5.1, -0.4, 1.2],
    [-6.5, 3.6, 1.2, 1.4],
    [1.2, 8.6, 0.05, 1.7],
  ]) {
    const t = gaffer(l, 0.46, r() > 0.5 ? '#1d1c1a' : '#26221e')
    t.position.set(x, 0.004, z)
    t.rotation.z = a
    group.add(t)
  }
  await nextFrame()

  // ---- the backline
  const cab = buildAmp({ kind: 'cab', grille: 'wheat', badge: true })
  cab.group.position.set(0, 0, FRONT - cab.size.z / 2)
  group.add(cab.group)
  const head = buildAmp({ kind: 'head', labels: ['Hardening', 'Monitoring', 'Backups'], tubes: 4, badge: true })
  head.group.position.set(0, HEAD_Y, FRONT - head.size.z / 2)
  group.add(head.group)
  // the brushed gold panel: a touch less mirror so it takes the follow spot (this head's own material)
  head.group.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial && m.map && m.metalness > 0.8) {
      m.metalness = 0.55
      m.roughness = 0.4
    }
    // the toggles and the jewel's bezel: satin chrome, so the spot's glint beside the lamp can't bloom into a haze
    if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial && !m.map && m.metalness >= 1 && m.roughness < 0.2) m.roughness = 0.3
  })
  const legend = legendDecal()
  legend.position.set(2.72, 1.6, head.size.z / 2 + 0.007)
  head.group.add(legend)
  // a second cab off to the right in the dark (depth for the wide shot)
  const cab2 = buildAmp({ kind: 'cab', grille: 'oxblood', badge: true })
  cab2.group.position.set(10.2, 0, -1.2)
  cab2.group.rotation.y = -0.42
  group.add(cab2.group)
  await nextFrame()

  // the jewel's own glow on the gold panel round it (driven by intensity only)
  const jewelLight = new THREE.PointLight('#ff3a1e', 0, 2.6, 2)
  jewelLight.position.copy(head.pilot.position).add(new THREE.Vector3(0, 0, 0.35))
  head.group.add(jewelLight)
  // the jewel: a faceted red glass dome, hot at its heart, deep ruby at the rim
  head.pilot.geometry.dispose()
  head.pilot.geometry = new THREE.IcosahedronGeometry(0.13, 1).scale(1, 1, 0.62)
  head.pilot.material = jewelMaterial()
  const jewelHalo = halo(1.5)
  jewelHalo.position.copy(head.pilot.position).add(new THREE.Vector3(0, 0, 0.14))
  head.group.add(jewelHalo)
  const tubeHalos: THREE.Sprite[] = []
  head.tubes.children.forEach(t => {
    const h = halo(1.1)
    h.position.set(t.position.x, t.position.y + 0.5, t.position.z)
    h.scale.set(0.9, 1.3, 1)
    head.group.add(h)
    tubeHalos.push(h)
  })

  // ---- the guitar, leaning back against the stack
  const guitar = buildGuitar({ mobile, burst: 'tobacco' })
  const gg = guitar.group
  gg.rotation.set(-LEAN, SPIN, Math.PI / 2)
  gg.position.set(0, 0, 0)
  gg.updateMatrixWorld(true)
  // tail on the planks, the back of the headstock on the stack's front
  const box = new THREE.Box3().setFromObject(guitar.parts.body)
  const hbox = new THREE.Box3().setFromObject(guitar.parts.headstock)
  gg.position.set(GUITAR_X, -box.min.y + 0.01, FRONT - hbox.min.z + 0.01)
  group.add(gg)
  gg.updateMatrixWorld(true)

  // the felt (guitar-local), hidden until it drops
  const sz = guitar.stringZ(FELT_X)
  const felt = feltStrip(sz - guitar.topZ(FELT_X, 0.4) - 0.004)
  const feltRest = new THREE.Vector3(FELT_X, 0, sz + FELT.t / 2 + 0.004)
  // a cream stitched mark on the felt (the mark stays cream)
  const stitch = new THREE.Mesh(logoGeometry({ depth: 0.004, bevel: false }), new THREE.MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.85 }))
  stitch.scale.setScalar(0.11)
  stitch.rotation.z = -Math.PI / 2
  stitch.position.set(0, 0.17, FELT.t / 2 + 0.002)
  felt.add(stitch)
  felt.position.copy(feltRest)
  felt.visible = false
  gg.add(felt)
  await nextFrame()

  // ---- the lead: from the jack on the lower bout's rim, down to the planks, across to the stack
  const jack = gg.localToWorld(new THREE.Vector3(-0.95, -1.64, -0.22))
  const out = gg.localToWorld(new THREE.Vector3(-1.05, -1.95, -0.2))
  const pts = [
    jack,
    out,
    new THREE.Vector3(out.x + 0.35, 0.3, out.z + 0.25),
    new THREE.Vector3(out.x + 0.9, 0.035, out.z + 0.7),
    new THREE.Vector3(out.x + 2.4, 0.035, out.z + 0.9),
    new THREE.Vector3(4.1, 0.035, FRONT + 1.6),
    new THREE.Vector3(4.7, 0.035, FRONT - 0.4),
    new THREE.Vector3(4.5, 0.035, -1.6),
  ]
  const lead = cable(pts, 0.032)
  group.add(lead)
  // the jack plate + plug barrel
  const plug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.22, 14).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#d8d3c8', metalness: 1, roughness: 0.22 }),
  )
  plug.position.copy(jack).lerp(out, 0.25)
  plug.lookAt(out)
  group.add(plug)

  // ---- named points (world)
  const W = (x: number, y: number, z: number) => gg.localToWorld(new THREE.Vector3(x, y, z))
  const jewel = head.group.localToWorld(head.pilot.position.clone())
  const at = {
    body: W(0.55, 0.05, 0.2),
    neck: W(guitar.fretX(9), 0, 0.22),
    headstock: gg.localToWorld(guitar.logoAt.clone()),
    jewel,
    stack: new THREE.Vector3(0.3, 5.7, FRONT + 1.0),
    /** the head's front (with the tubes above it) */
    amp: new THREE.Vector3(0.15, HEAD_Y + 1.62, FRONT),
    /** the bottom of the head's front under the jewel */
    under: head.group.localToWorld(new THREE.Vector3(head.pilot.position.x, 0, head.size.z / 2)),
    felt: W(FELT_X, 0, 0.26),
  }
  return { guitar, head, cab, felt, feltRest, jewelLight, jewelHalo, tubeHalos, at }
}
