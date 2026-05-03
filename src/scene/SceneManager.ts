import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as THREE from 'three'
import { createRenderer } from './createRenderer'
import { createCamera } from './createCamera'
import { createControls } from './createControls'
import { createLights } from './createLights'
import { createTerrain } from '../rendering/terrain'
import type { EnvironmentPreset } from '../simulation/presets'
import { createAgents, updateAgents, disposeAgents, pickAgent, updateScreenPositions, getWorldPositions } from '../simulation'
import { updateDayNight } from './dayNight'
import type { SceneLights } from './createLights'
import type { SimParams } from '../simulation'

// ── ES-38: Minimap constants ──────────────────────────────────────────
const MINIMAP_PX  = 180    // minimap DOM canvas size in CSS pixels
const HEATMAP_RES = 64
const WORLD_SIZE  = 256
const MAX_AGENTS  = 4096

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

  // ES-38: Minimap — rendered into a separate WebGLRenderTarget, displayed on a DOM canvas
  private _minimapRenderer:  THREE.WebGLRenderer | null = null
  private _minimapCam:       THREE.OrthographicCamera
  private _minimapCanvas:    HTMLCanvasElement | null = null
  private _minimapHeatMesh:  THREE.Mesh | null = null
  private _minimapTex:       THREE.DataTexture | null = null
  private _minimapData:      Uint8Array = new Uint8Array(HEATMAP_RES * HEATMAP_RES * 4)
  private _minimapVisible:   boolean = false

  public params:       SimParams | null = null
  public simSpeed:     number = 1.0
  public onAgentClick: ((slot: number) => void) | null = null

  /**
   * Simulation seconds since the last reset, scaled by simSpeed and frozen
   * while paused. Single source of truth for the day/night cycle AND the
   * HUD clock — both must read this so they can never drift apart.
   */
  public elapsedSimSeconds: number = 0

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

    // Orthographic top-down camera — looks straight down at world center
    const half = WORLD_SIZE / 2
    this._minimapCam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 1000)
    this._minimapCam.position.set(0, 500, 0)
    this._minimapCam.lookAt(0, 0, 0)
    this._minimapCam.up.set(0, 0, -1)

    this._initMinimap()

    this.clock = new THREE.Clock()

    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)

    this._onClick = (e: MouseEvent) => {
      if (!this.onAgentClick) return
      const rect = this.renderer.domElement.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const slot = pickAgent(px, py)
      if (slot !== -1) this.onAgentClick(slot)
    }
    this.mountEl.addEventListener('click', this._onClick)

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

  // ── ES-38: Minimap ────────────────────────────────────────────────

  private _initMinimap(): void {
    // Separate canvas + renderer for the minimap — completely isolated from
    // the main renderer so it cannot affect the main camera or controls
    const canvas = document.createElement('canvas')
    canvas.width  = MINIMAP_PX
    canvas.height = MINIMAP_PX
    canvas.style.cssText = [
      'position:absolute',
      'bottom:12px',
      'right:12px',
      `width:${MINIMAP_PX}px`,
      `height:${MINIMAP_PX}px`,
      'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:4px',
      'pointer-events:none',
      'display:none',
    ].join(';')
    this.mountEl.appendChild(canvas)
    this._minimapCanvas = canvas

    const rdr = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false })
    rdr.setSize(MINIMAP_PX, MINIMAP_PX)
    rdr.setPixelRatio(1)
    this._minimapRenderer = rdr

    // Heat overlay — flat plane at y=50, visible only during minimap render
    const tex = new THREE.DataTexture(
      this._minimapData, HEATMAP_RES, HEATMAP_RES,
      THREE.RGBAFormat, THREE.UnsignedByteType,
    )
    tex.needsUpdate = true
    this._minimapTex = tex

    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE)
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = 50
    mesh.renderOrder = 2
    mesh.visible = false
    this._minimapHeatMesh = mesh
    this.scene.add(mesh)
  }

  private _updateMinimapHeat(): void {
    if (!this._minimapTex) return

    const data    = this._minimapData
    const density = new Float32Array(HEATMAP_RES * HEATMAP_RES)
    let   maxDensity = 0
    data.fill(0)

    const positions = getWorldPositions()
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (positions[i * 3 + 1] < -9999) continue
      const tx = Math.floor(((positions[i * 3 + 0] + 128) / WORLD_SIZE) * HEATMAP_RES)
      // DataTexture row 0 = bottom of image, but world +Z = south visually.
      // Flip ty so north is up on the minimap.
      const tyRaw = Math.floor(((positions[i * 3 + 2] + 128) / WORLD_SIZE) * HEATMAP_RES)
      const ty = (HEATMAP_RES - 1) - tyRaw
      if (tx < 0 || tx >= HEATMAP_RES || ty < 0 || ty >= HEATMAP_RES) continue
      const idx = ty * HEATMAP_RES + tx
      density[idx]++
      if (density[idx] > maxDensity) maxDensity = density[idx]
    }

    if (maxDensity > 0) {
      for (let i = 0; i < HEATMAP_RES * HEATMAP_RES; i++) {
        const t = density[i] / maxDensity
        const b = i * 4
        if (t === 0) { data[b] = data[b+1] = data[b+2] = data[b+3] = 0; continue }
        let r = 0, g = 0, bl = 0
        if (t < 0.25)      { bl = Math.round(128 + (t / 0.25) * 127) }
        else if (t < 0.5)  { g = Math.round(((t - 0.25) / 0.25) * 255); bl = 255 }
        else if (t < 0.75) { const s = (t - 0.5) / 0.25; r = Math.round(s * 255); g = 255; bl = Math.round(255 - s * 255) }
        else               { r = 255; g = Math.round(255 - ((t - 0.75) / 0.25) * 255) }
        data[b]   = r
        data[b+1] = g
        data[b+2] = bl
        data[b+3] = Math.round(80 + t * 175)
      }
    }
    this._minimapTex.needsUpdate = true
  }

  /**
   * Render the minimap. The ortho cam rotates around Y to match the main
   * camera's horizontal facing direction — "up" on the minimap = forward.
   */
  private _renderMinimap(): void {
    if (!this._minimapRenderer || !this._minimapCanvas) return

    // Sync orientation: extract main camera yaw, apply to ortho cam up vector
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    dir.y = 0
    if (dir.lengthSq() > 0.0001) {
      dir.normalize()
      // ortho cam looks straight down; its "up" controls the minimap rotation
      this._minimapCam.up.set(dir.x, 0, dir.z)
      this._minimapCam.lookAt(0, 0, 0)
    }

    // Show heat mesh only for this render
    if (this._minimapHeatMesh) this._minimapHeatMesh.visible = this._minimapVisible

    // No fog on minimap — want crisp terrain colors
    const savedFog = this.scene.fog
    this.scene.fog = null

    this._minimapRenderer.render(this.scene, this._minimapCam)

    this.scene.fog = savedFog
    if (this._minimapHeatMesh) this._minimapHeatMesh.visible = false
  }

  toggleHeatmap(): void {
    this._minimapVisible = !this._minimapVisible
    // Canvas is always shown; toggle just controls whether heat overlay appears
  }

  get heatmapVisible(): boolean { return this._minimapVisible }

  setMinimapVisible(visible: boolean): void {
    if (this._minimapCanvas) {
      this._minimapCanvas.style.display = visible ? 'block' : 'none'
    }
  }

  // ── ES-75: Environment preset ─────────────────────────────────────

  applyPreset(preset: EnvironmentPreset): void {
    if (this._terrain) {
      this.scene.remove(this._terrain)
      this._terrain.geometry.dispose()
      ;(this._terrain.material as THREE.Material).dispose()
    }
    this._terrain = createTerrain(preset.terrain)
    this.scene.add(this._terrain)

    this.scene.background = new THREE.Color(preset.skyColor)
    this.scene.fog = new THREE.Fog(preset.fogColor, preset.fogNear, preset.fogFar)

    if (this.params) {
      Object.assign(this.params, preset.params)
    }
  }

  // ── Tick loop ─────────────────────────────────────────────────────

  start() {
    if (this._raf) return
    this.clock.getDelta()

    // Show minimap canvas when running
    this.setMinimapVisible(true)

    const tick = () => {
      const dt = this.clock.getDelta() * this.simSpeed
      this.elapsedSimSeconds += dt

      updateAgents(dt)
      this._updateMinimapHeat()
      updateDayNight(this.elapsedSimSeconds, this.lights.sun, this.lights.ambient, this.scene)
      this.controls.update()

      // Main render — untouched, exactly as original
      this.renderer.render(this.scene, this.camera)

      // Minimap — separate renderer, separate canvas, zero interference
      this._renderMinimap()

      const rect = this.renderer.domElement.getBoundingClientRect()
      updateScreenPositions(this.camera, rect.width, rect.height)

      this._raf = requestAnimationFrame(tick)
    }
    tick()
  }

  pause() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null }
  }

  resetClock() {
    this.elapsedSimSeconds = 0
    this.clock.getDelta()
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
    if (this._minimapHeatMesh) {
      this._minimapHeatMesh.geometry.dispose()
      ;(this._minimapHeatMesh.material as THREE.Material).dispose()
    }
    if (this._minimapTex) this._minimapTex.dispose()
    if (this._minimapRenderer) this._minimapRenderer.dispose()
    while (this.mountEl.firstChild) this.mountEl.removeChild(this.mountEl.firstChild)
  }
}