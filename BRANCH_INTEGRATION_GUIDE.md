# EcoSim Branch Integration Guide

This document defines integration contracts between major feature branches to prevent conflicts and duplicate rendering logic.

---

## Scene Layer Ownership

The Scene branch exclusively owns:

- THREE.Scene initialization
- WebGLRenderer creation
- Camera setup
- OrbitControls
- requestAnimationFrame loop
- Resize handling

No other branch may create its own scene, renderer, or animation loop.

---

## Integration Contract

SceneManager exposes:

    sceneManager.addToScene(obj: THREE.Object3D)

All feature branches must return a THREE.Object3D (or subclass) for integration.

---

## Terrain Branch

Terrain must export:

    export function createTerrain(): THREE.Object3D

Scene integration example:

    const terrain = createTerrain();
    sceneManager.addToScene(terrain);

Terrain must NOT:
- Create a renderer
- Create a new scene
- Modify camera
- Modify animation loop

---

## GPU / Agents Branch

Engine must export:

    export function createAgents(): THREE.Object3D
    export function updateAgents(dt: number): void

Scene integration example:

    const agents = createAgents();
    sceneManager.addToScene(agents);

Engine update integration:

    updateAgents(deltaTime);

Engine must NOT:
- Create a new renderer
- Create a new scene
- Override requestAnimationFrame

---

## Branch Safety Rules

- Only SceneManager touches the render loop.
- All branches return objects for integration.
- SceneManager is the single source of truth for rendering.
- Major architectural changes must be discussed before merging.

---

This structure ensures modular development and prevents merge conflicts during Sprint 1 integration.