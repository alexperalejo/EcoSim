//createLights.ts filler. Not the actual code yet
import * as THREE from "three";

export function createLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(50, 80, 20);
  scene.add(sun);
}