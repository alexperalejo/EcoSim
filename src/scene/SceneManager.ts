import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as THREE from 'three'
import { createRenderer } from './createRenderer'
import { createCamera } from './createCamera'
import { createControls } from './createControls'
import { createLights } from './createLights'
import { createTerrain } from '../rendering/terrain'
import type { EnvironmentPreset } from '../simulation/presets'
import { createAgents, updateAgents, disposeAgents, pickAgent, updateScreenPositions } from '../simulation'
import { updateDayNight } from './dayNight'
import type { SceneLights } from './createLights'
import type { SimParams } from '../simulation'

export class SceneManager {
  private mountEl:   HTMLDivElement
  private scene:     THREE.Scene
  private camera:    THREE.PerspectiveCamera
  private renderer:  THREE.WebGLRenderer
  private controls:  OrbitControls
  private clock:     THREE.Clock
  private _raf:      number | null = null
  private _onResize: () => void
  private _onClick:  (e: MouseEvent) => void
  private _onMove:   (e: MouseEvent) => void
  private lights:    SceneLights
  private _hoverThrottle = 0
  private _terrain:   THREE.Mesh | null = null

  public params:       SimParams | null = null
  public simSpeed:     number = 1.0
  public onAgentClick: ((slot: number) => void) | null = null

  constructor(mountEl: HTMLDivElement) {
    this.mountEl = mountEl

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87ceeb)
    this.scene.fog = new THREE.Fog(0x87ceeb, 200, 400)

    this.camera   = createCamera(mountEl)
    this.renderer = createRenderer(mountEl)

    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap

    this.controls = createControls(this.camera, this.renderer.domElement)
    this.lights   = createLights(this.scene)

    this._terrain = createTerrain({ size: 256, segments: 128, maxHeight: 30 })
    this.scene.add(this._terrain)
    this.scene.add(new THREE.AxesHelper(10))

    const agentObj = createAgents()
    this.scene.add(agentObj)

    const w = window as unknown as { __ecoEngine?: { params: SimParams } }
    if (w.__ecoEngine) this.params = w.__ecoEngine.params

    this.clock = new THREE.Clock()

    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)

    // ── Click handler ─────────────────────────────────────────────
    this._onClick = (e: MouseEvent) => {
      if (!this.onAgentClick) return
      const rect = this.renderer.domElement.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const slot = pickAgent(px, py)
      if (slot !== -1) this.onAgentClick(slot)
    }
    this.mountEl.addEventListener('click', this._onClick)

    // ── Hover: cursor change ──────────────────────────────────────
    this._onMove = (e: MouseEvent) => {
      const now = performance.now()
      if (now - this._hoverThrottle < 50) return
      this._hoverThrottle = now
      const rect = this.renderer.domElement.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const slot = pickAgent(px, py)
      this.mountEl.style.cursor = slot !== -1 ? 'pointer' : 'default'
    }
    this.mountEl.addEventListener('mousemove', this._onMove)

    this.resize()
  }

  /** ES-75: Swap terrain + sim params for a preset environment */
  applyPreset(preset: EnvironmentPreset): void {
    // Swap terrain
    if (this._terrain) {
      this.scene.remove(this._terrain)
      this._terrain.geometry.dispose()
      ;(this._terrain.material as THREE.Material).dispose()
    }
    this._terrain = createTerrain(preset.terrain)
    this.scene.add(this._terrain)

    // Update sky + fog
    this.scene.background = new THREE.Color(preset.skyColor)
    this.scene.fog = new THREE.Fog(preset.fogColor, preset.fogNear, preset.fogFar)

    // Push sim params into engine — read from window.__ecoEngine in case
    // this.params was null at construction time (assigned after createAgents)
    const w = window as unknown as { __ecoEngine?: { params: Record<string, number> } }
    const engineParams = w.__ecoEngine?.params ?? this.params
    if (engineParams) {
      Object.assign(engineParams, preset.params)
      this.params = engineParams as typeof this.params
    }
  }

  start() {
    if (this._raf) return
    const tick = () => {
      const dt = this.clock.getDelta() * this.simSpeed
      updateAgents(dt)
      updateDayNight(this.clock.elapsedTime, this.lights.sun, this.lights.ambient, this.scene)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)

      // Use renderer domElement bounding rect for CSS pixel dimensions
      // This is what mouse events use, so projection will match exactly
      const rect = this.renderer.domElement.getBoundingClientRect()
      updateScreenPositions(this.camera, rect.width, rect.height)

      this._raf = requestAnimationFrame(tick)
    }
    tick()
  }

  pause() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null }
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
    this.mountEl.removeEventListener('click', this._onClick)
    this.mountEl.removeEventListener('mousemove', this._onMove)
    this.controls.dispose()
    this.renderer.dispose()
    while (this.mountEl.firstChild) this.mountEl.removeChild(this.mountEl.firstChild)
  }
}