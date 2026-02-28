
//createRenderer.ts filler. Not the actual code yet
import * as THREE from "three";

export function createRenderer(
  mountEl: HTMLElement
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;

  mountEl.appendChild(renderer.domElement);

  return renderer;
}