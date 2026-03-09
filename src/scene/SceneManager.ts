/**
 * src/scene/SceneManager.ts
 *
 * Changes from previous version:
 *   1. Imports and adds terrain mesh from createTerrain()
 *   2. Removes the test cube and GridHelper (replaced by real terrain)
 *   3. Keeps AxesHelper (useful during Sprint 1/2 development)
 *   4. createLights() now returns { sun, ambient } for Sprint 2 animation
 *   5. Renderer shadow map enabled to match createLights setup
 */

import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as THREE from 'three'
import { createRenderer } from './createRenderer'
import { createCamera } from './createCamera'
import { createControls } from './createControls'
import { createLights } from './createLights'
import { createTerrain } from '../rendering/terrain'
import { createAgents, updateAgents, disposeAgents } from '../simulation'

export class SceneManager {
  private mountEl: HTMLDivElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private clock: THREE.Clock
  private _raf: number | null = null
  private _onResize: () => void

  constructor(mountEl: HTMLDivElement) {
    this.mountEl = mountEl

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87ceeb) // sky blue
    this.scene.fog = new THREE.Fog(0x87ceeb, 200, 400) // distance fog

    this.camera = createCamera(mountEl)
    this.renderer = createRenderer(mountEl)

    // Enable shadows on renderer (matches sun shadow setup in createLights)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.controls = createControls(this.camera, this.renderer.domElement)

    // Lighting (returns handles for Sprint 2 day/night animation)
    createLights(this.scene)

    // ── Terrain ──────────────────────────────────────────────────
    // Size 256 matches WORLD_SIZE in agentState.ts
    const terrain = createTerrain({ size: 256, segments: 128, maxHeight: 30 })
    this.scene.add(terrain)

    // ── Axes helper (remove in Sprint 4 polish) ───────────────────
    this.scene.add(new THREE.AxesHelper(10))

    // ── GPU Agents ────────────────────────────────────────────────
    this.scene.add(createAgents())

    this.clock = new THREE.Clock()

    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)

    this.resize()
  }

  start() {
    if (this._raf) return

    const tick = () => {
      const dt = this.clock.getDelta()
      updateAgents(dt)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
      this._raf = requestAnimationFrame(tick)
    }

    tick()
  }

  resize() {
    const w = this.mountEl.clientWidth
    const h = this.mountEl.clientHeight

    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(w, h, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }

  dispose() {
    disposeAgents()
    if (this._raf) cancelAnimationFrame(this._raf)

    window.removeEventListener('resize', this._onResize)
    this.controls.dispose()
    this.renderer.dispose()

    while (this.mountEl.firstChild) {
      this.mountEl.removeChild(this.mountEl.firstChild)
    }
  }
}