/**
 * src/scene/createLights.ts
 *
 * Sets up scene lighting suited for terrain rendering.
 *   - Ambient light: soft fill so shadows aren't pitch black
 *   - Directional "sun" light: angled to cast shadows across terrain
 *
 * In Sprint 2, the sun position will be animated for the day/night cycle.
 * The sunLight is returned so SceneManager can animate it later.
 */

import * as THREE from 'three'

export interface SceneLights {
  ambient: THREE.AmbientLight
  sun: THREE.DirectionalLight
}

export function createLights(scene: THREE.Scene): SceneLights {
  // Soft ambient — prevents completely dark undersides
  const ambient = new THREE.AmbientLight(0xd0e8ff, 0.45)
  scene.add(ambient)

  // Directional sun light — angled to show terrain contours clearly
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.2)
  sun.position.set(80, 120, 60)
  sun.target.position.set(0, 0, 0)

  // Shadow setup (optional but looks great on terrain)
  sun.castShadow = true
  sun.shadow.mapSize.width = 2048
  sun.shadow.mapSize.height = 2048
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 500
  sun.shadow.camera.left = -150
  sun.shadow.camera.right = 150
  sun.shadow.camera.top = 150
  sun.shadow.camera.bottom = -150

  scene.add(sun)
  scene.add(sun.target)

  return { ambient, sun }
}