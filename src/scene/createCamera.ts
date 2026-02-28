//createCamera.ts filler. Not the actual code yet
import * as THREE from "three";

export function createCamera(
  mountEl: HTMLElement
): THREE.PerspectiveCamera {
  const width = mountEl.clientWidth || window.innerWidth;
  const height = mountEl.clientHeight || window.innerHeight;

  const camera = new THREE.PerspectiveCamera(
    60,
    width / height,
    0.1,
    2000
  );

  camera.position.set(30, 30, 30);
  camera.lookAt(0, 0, 0);

  return camera;
}