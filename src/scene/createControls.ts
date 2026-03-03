//createControls.ts 
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type * as THREE from "three";

export function createControls(
  camera: THREE.Camera,
  domEl: HTMLElement
): OrbitControls {
  const controls = new OrbitControls(camera, domEl);
  
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 300;
  controls.maxPolarAngle = Math.PI * 0.49; // prevents going under ground

  controls.target.set(0, 0, 0);
  controls.update();
  return controls;
}