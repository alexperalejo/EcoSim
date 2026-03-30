/**
 * src/scene/dayNight.ts
 *
 * ES-8: Day/Night Cycle
 *
 * Animates the sun position, light colours, and sky/fog colour
 * to simulate a day/night cycle. Called each frame from SceneManager.
 *
 * Cycle phases (by normalised time 0→1):
 *   0.0  – midnight  (dark navy sky, no sun)
 *   0.25 – sunrise   (orange horizon)
 *   0.5  – noon      (bright blue sky, sun overhead)
 *   0.75 – sunset    (deep orange/red)
 *   1.0  – midnight  (loops)
 */

import * as THREE from 'three'

// ── Tuneable constants ────────────────────────────────────────────────
const DAY_DURATION = 240.0  // seconds for one full day/night cycle

// Key sky colours at each phase
const SKY_NIGHT   = new THREE.Color(0x0a1628)  // near black-blue
const SKY_SUNRISE = new THREE.Color(0xff6a2a)  // warm orange
const SKY_DAY     = new THREE.Color(0x87ceeb)  // the original sky blue
const SKY_SUNSET  = new THREE.Color(0xff4500)  // deep red-orange

// Sun light colours
const SUN_DAY     = new THREE.Color(0xfff4e0)  // warm white (original)
const SUN_SUNRISE = new THREE.Color(0xff9944)  // orange
const SUN_SUNSET  = new THREE.Color(0xff5522)  // deep orange-red
const SUN_NIGHT   = new THREE.Color(0x101828)  // near black

// Ambient intensities
const AMBIENT_DAY   = 0.8
const AMBIENT_NIGHT = 0.45  // Never fully dark to keep some visibility at night (moonlight)

// Sun orbit radius
const SUN_RADIUS = 140.0

// ── Helper: lerp between 4 colour stops around a 0→1 cycle ───────────
function cyclicColorLerp(
  t: number,
  c0: THREE.Color,  // t = 0.0 (midnight)
  c1: THREE.Color,  // t = 0.25 (sunrise)
  c2: THREE.Color,  // t = 0.5 (noon)
  c3: THREE.Color,  // t = 0.75 (sunset)
): THREE.Color {
  const out = new THREE.Color()

  if (t < 0.25) {
    return out.lerpColors(c0, c1, t / 0.25)
  } else if (t < 0.5) {
    return out.lerpColors(c1, c2, (t - 0.25) / 0.25)
  } else if (t < 0.75) {
    return out.lerpColors(c2, c3, (t - 0.5) / 0.25)
  } else {
    return out.lerpColors(c3, c0, (t - 0.75) / 0.25)
  }
}

// ── Main update function ──────────────────────────────────────────────

export function updateDayNight(
  elapsed: number,
  sun: THREE.DirectionalLight,
  ambient: THREE.AmbientLight,
  scene: THREE.Scene,
): void {
  // Normalised time: 0 = midnight, 0.5 = noon, 1 = midnight again
  const t = (elapsed % DAY_DURATION) / DAY_DURATION

  // ── Sun position ────────────────────────────────────────────────
  // Orbit in the XY plane (rises east = +X, sets west = -X)
  // Angle: -π at midnight (below horizon), 0 at noon (overhead)
  const angle = t * Math.PI * 2 - Math.PI  // -π → +π
  sun.position.set(
    Math.cos(angle) * SUN_RADIUS,          // X: east/west
    Math.sin(angle) * SUN_RADIUS,          // Y: height
    60,                                     // Z: slight offset for shadow angle
  )

  // ── Sun intensity ────────────────────────────────────────────────
  // Dim when below horizon (sin(angle) < 0)
  const sunHeight = Math.sin(angle)          // -1 (midnight) → 1 (noon)
  const sunIntensity = Math.max(sunHeight, 0.0) * 1.2
  sun.intensity = sunIntensity

  // ── Sun colour ──────────────────────────────────────────────────
  sun.color.copy(cyclicColorLerp(t, SUN_NIGHT, SUN_SUNRISE, SUN_DAY, SUN_SUNSET))

  // ── Ambient light ───────────────────────────────────────────────
  // Never fully dark — moonlight fills the night
  const ambientIntensity = AMBIENT_NIGHT + (AMBIENT_DAY - AMBIENT_NIGHT) *
    Math.max(sunHeight * 1.2, 0.0)
  ambient.intensity = Math.max(ambientIntensity, AMBIENT_NIGHT)

  // ── Sky / fog colour ────────────────────────────────────────────
  const skyColor = cyclicColorLerp(t, SKY_NIGHT, SKY_SUNRISE, SKY_DAY, SKY_SUNSET)
  ;(scene.background as THREE.Color).copy(skyColor)
  ;(scene.fog as THREE.Fog).color.copy(skyColor)
}