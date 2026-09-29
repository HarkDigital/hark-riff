import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/*
 * A GUITAR STAND — the folding tubular A-frame every backline has: a
 * powder-coated black U-frame leaning back behind the guitar at its angle,
 * a rear leg hinged near the top, two lower arms that cradle the body's
 * bottom edge in rubber sleeves (with a lip in front of the top), and a
 * rubber-lined neck yoke that the back of the neck rests in.
 *
 * Built in WORLD space from the guitar's own transform (`M`: guitar-local →
 * world), so it always fits the instrument exactly: the cradles sit under the
 * lower bout, the yoke under the neck at `yokeX`, the feet on the floor
 * (y = 0). Two merged meshes (tube + rubber): two draw calls.
 */

export interface StandOptions {
  /** guitar-local x of the neck yoke (along the neck, bridge = 0) */
  yokeX: number
  /** guitar-local y of the lower cradles (± across the body) */
  cradleY?: number
  /** half-width of the U-frame (guitar-local y) */
  frameY?: number
  /** how far behind the guitar's back the frame runs (guitar-local z) */
  frameZ?: number
  /** tube radius */
  r?: number
}

export function buildStand(M: THREE.Matrix4, opts: StandOptions) {
  const group = new THREE.Group()
  group.name = 'stand'
  const r = opts.r ?? 0.075
  const cy = opts.cradleY ?? 0.8
  const fy = opts.frameY ?? 0.52
  const fz = opts.frameZ ?? -0.84
  const X = opts.yokeX
  const L = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(M)

  // the guitar-local x where a line along the neck at (y, z) reaches the floor
  const floorX = (y: number, z: number) => {
    const a = L(0, y, z).y
    const b = L(1, y, z).y
    return -a / (b - a)
  }

  const tubes: THREE.BufferGeometry[] = []
  const rubbers: THREE.BufferGeometry[] = []
  const tube = (pts: THREE.Vector3[], radius = r, into = tubes, seg = 48) => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    into.push(new THREE.TubeGeometry(c, seg, radius, 10, false))
    return c
  }
  const cap = (at: THREE.Vector3, dir: THREE.Vector3, radius: number, len: number) => {
    const g = new THREE.CylinderGeometry(radius, radius * 1.05, len, 14)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()))
    g.translate(at.x, at.y, at.z)
    rubbers.push(g)
  }

  /* ---- the front U-frame: feet on the floor, up behind the guitar, closed at the top ---- */
  const top = X - 0.62
  for (const s of [1, -1]) {
    const fx = floorX(s * fy, fz)
    const foot = L(fx, s * fy * 1.35, fz)
    foot.y = 0.06
    const pts = [foot, L(fx + 0.9, s * fy * 1.12, fz), L(-1.9, s * fy, fz), L(top - 0.55, s * fy, fz), L(top - 0.12, s * fy * 0.55, fz), L(top, 0, fz)]
    tube(pts)
    // a rubber foot
    cap(foot.clone().setY(0.05), new THREE.Vector3(0, 1, 0), r * 1.45, 0.1)
  }

  /* ---- the yoke's stem: up from the frame's crown and forward to the neck ---- */
  const crown = L(top, 0, fz)
  const yokeBase = L(X - 0.02, 0, -0.33)
  tube([crown, L(top + 0.28, 0, fz + 0.12), L(X - 0.12, 0, -0.48), yokeBase], r * 0.9)

  /* ---- the neck yoke: a U round the back of the neck, sleeved in rubber ---- */
  {
    const w = 0.3
    const pts = [
      L(X, w, 0.06),
      L(X, w, -0.14),
      L(X, w * 0.7, -0.27),
      L(X, 0, -0.31),
      L(X, -w * 0.7, -0.27),
      L(X, -w, -0.14),
      L(X, -w, 0.06),
    ]
    tube(pts, r * 0.95, rubbers, 40)
    // round caps on the fork's tips
    for (const s of [1, -1]) {
      const g = new THREE.SphereGeometry(r, 12, 10)
      const at = L(X, s * w, 0.06)
      g.translate(at.x, at.y, at.z)
      rubbers.push(g)
    }
  }

  /* ---- the rear leg: hinged under the crown, splayed back to the floor ---- */
  {
    const hingeX = top - 1.25
    for (const s of [1, -1]) {
      const h = L(hingeX, s * fy * 0.92, fz - 0.1)
      const foot = new THREE.Vector3(h.x * 1.7, 0.06, h.z - 3.6)
      const mid = h.clone().lerp(foot, 0.5)
      mid.z -= 0.12
      tube([h, mid, foot])
      cap(foot.clone().setY(0.05), new THREE.Vector3(0, 1, 0), r * 1.45, 0.1)
    }
    // a hinge bar across the frame
    tube([L(hingeX, fy * 0.98, fz - 0.05), L(hingeX, -fy * 0.98, fz - 0.05)], r * 0.8, tubes, 4)
    // the spreader: rear legs to the front frame, low
    const a = L(floorX(fy, fz) + 1.3, fy * 1.08, fz)
    const b = L(floorX(-fy, fz) + 1.3, -fy * 1.08, fz)
    const ra = L(hingeX, fy * 0.92, fz - 0.1)
    const rb = L(hingeX, -fy * 0.92, fz - 0.1)
    const fa = new THREE.Vector3(ra.x * 1.7, 0.06, ra.z - 3.6)
    const fb = new THREE.Vector3(rb.x * 1.7, 0.06, rb.z - 3.6)
    tube([a, ra.clone().lerp(fa, 0.72)], r * 0.6, tubes, 4)
    tube([b, rb.clone().lerp(fb, 0.72)], r * 0.6, tubes, 4)
  }

  /* ---- the lower arms: off the frame, forward under the bottom edge, a lip in front ---- */
  for (const s of [1, -1]) {
    const y = s * cy
    const under = -1.78 - 0.15
    const pts = [L(-2.1, s * fy, fz), L(-2.02, y * 0.96, fz + 0.3), L(under, y, -0.38), L(under, y, -0.04), L(under + 0.06, y, 0.13), L(under + 0.3, y, 0.2)]
    tube(pts, r)
    // the rubber sleeve where the body sits
    tube([L(under + 0.005, y, -0.5), L(under, y, -0.2), L(under + 0.02, y, 0.08), L(under + 0.2, y, 0.19)], r * 1.4, rubbers, 20)
  }

  const tubeMat = new THREE.MeshStandardMaterial({ color: '#141111', roughness: 0.34, metalness: 0.45 })
  const rubberMat = new THREE.MeshStandardMaterial({ color: '#1b1716', roughness: 0.78 })
  // every part is indexed with position / normal / uv: one merge each
  const tm = new THREE.Mesh(mergeGeometries(tubes), tubeMat)
  const rm = new THREE.Mesh(mergeGeometries(rubbers), rubberMat)
  for (const m of [tm, rm]) {
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
  }
  for (const g of [...tubes, ...rubbers]) g.dispose()
  return { group }
}
