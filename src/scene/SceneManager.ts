//SceneManager.ts
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as THREE from "three";
import { createRenderer } from "./createRenderer";
import { createCamera } from "./createCamera";
import { createControls } from "./createControls";
import { createLights } from "./createLights";

export class SceneManager {
  private mountEl: HTMLDivElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  //private clock: THREE.Clock;
  private _raf: number | null = null;
  private _onResize: () => void;

  constructor(mountEl: HTMLDivElement) {
    this.mountEl = mountEl;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f14);

    this.camera = createCamera(mountEl);
    this.renderer = createRenderer(mountEl);
    this.controls = createControls(this.camera, this.renderer.domElement);

    createLights(this.scene);

    this.scene.add(new THREE.GridHelper(200, 50));

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(5, 5, 5),
      new THREE.MeshStandardMaterial()
    );
    cube.position.y = 2.5;
    this.scene.add(cube);

    //this.clock = new THREE.Clock();

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);

    this.resize();
  }

  start() {
    if (this._raf) return;

    const tick = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(tick);
    };

    tick();
  }

  resize() {
    const w = this.mountEl.clientWidth;
    const h = this.mountEl.clientHeight;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  dispose() {
    if (this._raf) cancelAnimationFrame(this._raf);

    window.removeEventListener("resize", this._onResize);
    this.controls.dispose();
    this.renderer.dispose();

    while (this.mountEl.firstChild) {
      this.mountEl.removeChild(this.mountEl.firstChild);
    }
  }
}