// heightmap geometry + biome coloring logic
/**
 * src/rendering/terrain.ts
 *
 * Procedural terrain generation using simplex noise.
 * Creates a Three.js mesh with:
 *   - Heightmap displacement via simplex noise (no npm install needed)
 *   - Biome-based vertex coloring by elevation
 *     (deep water → shallow water → sand → grass → rock → snow)
 *
 * Usage:
 *   import { createTerrain } from './terrain'
 *   const terrain = createTerrain()
 *   scene.add(terrain)
 */

import * as THREE from 'three'

// ── Simplex Noise (self-contained, no dependencies) ──────────────────
// Adapted from Stefan Gustavson's public domain implementation.

const F2 = 0.5 * (Math.sqrt(3.0) - 1.0)
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0

const grad2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
]

function buildPermTable(): Uint8Array {
  const p = new Uint8Array(512)
  const src = new Uint8Array(256)
  for (let i = 0; i < 256; i++) src[i] = i
  // Fisher-Yates shuffle with a fixed seed for determinism
  let seed = 42
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff
    const j = ((seed >>> 0) % (i + 1))
    ;[src[i], src[j]] = [src[j], src[i]]
  }
  for (let i = 0; i < 512; i++) p[i] = src[i & 255]
  return p
}

const perm = buildPermTable()

function simplex2(xin: number, yin: number): number {
  const s = (xin + yin) * F2
  const i = Math.floor(xin + s)
  const j = Math.floor(yin + s)
  const t = (i + j) * G2
  const X0 = i - t
  const Y0 = j - t
  const x0 = xin - X0
  const y0 = yin - Y0

  let i1: number, j1: number
  if (x0 > y0) { i1 = 1; j1 = 0 } else { i1 = 0; j1 = 1 }

  const x1 = x0 - i1 + G2
  const y1 = y0 - j1 + G2
  const x2 = x0 - 1.0 + 2.0 * G2
  const y2 = y0 - 1.0 + 2.0 * G2

  const ii = i & 255
  const jj = j & 255

  const gi0 = perm[ii + perm[jj]] % 8
  const gi1 = perm[ii + i1 + perm[jj + j1]] % 8
  const gi2 = perm[ii + 1 + perm[jj + 1]] % 8

  function contribution(gIdx: number, x: number, y: number): number {
    let t = 0.5 - x * x - y * y
    if (t < 0) return 0
    t *= t
    return t * t * (grad2[gIdx][0] * x + grad2[gIdx][1] * y)
  }

  return 70.0 * (
    contribution(gi0, x0, y0) +
    contribution(gi1, x1, y1) +
    contribution(gi2, x2, y2)
  )
}

/**
 * Layered (fractal) noise — combines multiple octaves for natural terrain.
 */
function fbm(x: number, y: number, octaves = 6): number {
  let value = 0
  let amplitude = 0.5
  let frequency = 1.0
  let max = 0
  for (let i = 0; i < octaves; i++) {
    value += simplex2(x * frequency, y * frequency) * amplitude
    max += amplitude
    amplitude *= 0.5
    frequency *= 2.0
  }
  return value / max // normalize to [-1, 1]
}

// ── Active Terrain Config ────────────────────────────────────────────
// Stores the parameters of the most recently created terrain so that
// sampleTerrainHeight() always matches the visible terrain, even after
// a preset swap changes size / maxHeight / noiseScale.

export interface TerrainConfig {
  size:      number
  maxHeight: number
  noiseScale: number
}

export const activeTerrainConfig: TerrainConfig = {
  size:      256,
  maxHeight: 30,
  noiseScale: 0.008,
}

// ── Biome Color ──────────────────────────────────────────────────────

/**
 * Returns an RGB color based on normalized height (0–1) and a color scheme.
 * Default biomes: Deep water → Shallow water → Sand → Grass → Forest → Rock → Snow
 * Additional schemes: savanna, rainforest, tundra, island
 */
function biomeColor(t: number, scheme = 'default'): THREE.Color {
  switch (scheme) {
    case 'savanna':
      if (t < 0.18) return new THREE.Color(0x6b5230)   // dark earth
      if (t < 0.25) return new THREE.Color(0x9c7a40)   // dusty soil
      if (t < 0.30) return new THREE.Color(0xc8a84b)   // dry sand
      if (t < 0.50) return new THREE.Color(0xd4b040)   // dry yellow grass
      if (t < 0.65) return new THREE.Color(0xb08a20)   // ochre scrub
      if (t < 0.78) return new THREE.Color(0x8a6e30)   // rocky tan
      return new THREE.Color(0xd4c080)                  // pale hilltop

    case 'rainforest':
      if (t < 0.18) return new THREE.Color(0x1a6b3a)   // low water (dark teal-green)
      if (t < 0.25) return new THREE.Color(0x1a6b3a)   // shallow water
      if (t < 0.30) return new THREE.Color(0x2d8a4e)   // riverbank / low ground
      if (t < 0.50) return new THREE.Color(0x2d8a4e)   // mid-elevation green
      if (t < 0.65) return new THREE.Color(0x1f6b35)   // high forest green
      if (t < 0.78) return new THREE.Color(0x4a6741)   // mossy rock
      return new THREE.Color(0x1f6b35)                  // cloud forest peak

    case 'tundra':
      if (t < 0.18) return new THREE.Color(0x1a2a3a)   // dark icy water
      if (t < 0.25) return new THREE.Color(0x2a3d4e)   // shallow frozen water
      if (t < 0.30) return new THREE.Color(0x7a8e98)   // icy grey shore
      if (t < 0.50) return new THREE.Color(0xa8b8c0)   // grey-white tundra
      if (t < 0.65) return new THREE.Color(0xc4d0d8)   // snow-dusted plain
      if (t < 0.78) return new THREE.Color(0xd8e2e8)   // light snow
      return new THREE.Color(0xeef4f8)                  // deep ice / glacier

    case 'island':
      if (t < 0.18) return new THREE.Color(0x00318a)   // deep ocean
      if (t < 0.25) return new THREE.Color(0x0088c8)   // bright tropical sea
      if (t < 0.30) return new THREE.Color(0xf5e8b0)   // white sand beach
      if (t < 0.50) return new THREE.Color(0x38b848)   // tropical grass
      if (t < 0.65) return new THREE.Color(0x187820)   // lush jungle
      if (t < 0.78) return new THREE.Color(0x4a6a50)   // mossy volcanic rock
      return new THREE.Color(0x2a5030)                  // high jungle peak

    default:
      if (t < 0.18) return new THREE.Color(0x0a2a6e)   // deep water
      if (t < 0.25) return new THREE.Color(0x1a4fa0)   // shallow water
      if (t < 0.30) return new THREE.Color(0xc2b280)   // sand / beach
      if (t < 0.50) return new THREE.Color(0x4a7c3f)   // grass
      if (t < 0.65) return new THREE.Color(0x2d5a1b)   // forest
      if (t < 0.78) return new THREE.Color(0x7a6a5a)   // rock
      return new THREE.Color(0xe8e8ec)                  // snow
  }
}

// ── Terrain Creation ─────────────────────────────────────────────────

export interface TerrainOptions {
  /** Number of world units across (should match WORLD_SIZE in agentState.ts) */
  size?: number
  /** Grid resolution — higher = more detail, more vertices */
  segments?: number
  /** Maximum height of terrain peaks */
  maxHeight?: number
  /** Noise scale — lower = broader features */
  noiseScale?: number
  /** Color scheme — 'default' | 'savanna' | 'rainforest' | 'tundra' | 'island' */
  colorScheme?: string
}

/**
 * Creates a procedural terrain mesh and returns it.
 * The terrain is centered at world origin (0,0,0).
 *
 * @example
 *   const terrain = createTerrain({ size: 256, segments: 128 })
 *   scene.add(terrain)
 */
export function createTerrain(options: TerrainOptions = {}): THREE.Mesh {
  const {
    size = 256,
    segments = 128,
    maxHeight = 30,
    noiseScale = 0.008,
    colorScheme = 'default',
  } = options

  // Keep activeTerrainConfig in sync so sampleTerrainHeight always matches
  activeTerrainConfig.size      = size
  activeTerrainConfig.maxHeight = maxHeight
  activeTerrainConfig.noiseScale = noiseScale

  // PlaneGeometry in XZ plane — we'll displace Y for height
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments)

  // PlaneGeometry is in XY by default — rotate to lie flat in XZ
  geometry.rotateX(-Math.PI / 2)

  const positions = geometry.attributes.position
  const vertexCount = positions.count

  // Add vertex color attribute
  const colors = new Float32Array(vertexCount * 3)

  // Store height values for normal recalculation
  for (let i = 0; i < vertexCount; i++) {
    const x = positions.getX(i)
    const z = positions.getZ(i)

    // Sample noise — offset so terrain isn't symmetric
    const nx = (x + size / 2) * noiseScale
    const nz = (z + size / 2) * noiseScale

    // Use fbm for natural-looking terrain
    const raw = fbm(nx, nz)           // -1 to 1
    const normalized = (raw + 1) / 2  // 0 to 1

    // Apply height curve — flatten valleys, exaggerate peaks
    const heightCurve = Math.pow(normalized, 1.4)
    const height = heightCurve * maxHeight

    // Set Y position (height)
    positions.setY(i, height)

    // Set vertex color based on height and active color scheme
    const color = biomeColor(heightCurve, colorScheme)
    colors[i * 3 + 0] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }

  // Attach vertex colors
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  // Recalculate normals for correct lighting after displacement
  geometry.computeVertexNormals()

  // Material that uses vertex colors
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'Terrain'
  mesh.receiveShadow = true

  return mesh
}

/**
 * Samples terrain height at a given world XZ position.
 * Reads parameters from activeTerrainConfig so it always matches
 * the most recently created terrain (including preset swaps).
 *
 * @param x - world X coordinate
 * @param z - world Z coordinate
 */
export function sampleTerrainHeight(x: number, z: number): number {
  const { size, maxHeight, noiseScale } = activeTerrainConfig
  const nx = (x + size / 2) * noiseScale
  const nz = (z + size / 2) * noiseScale
  const raw = fbm(nx, nz)
  const normalized = (raw + 1) / 2
  const heightCurve = Math.pow(normalized, 1.4)
  return heightCurve * maxHeight
}