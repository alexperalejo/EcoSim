// Three.js scene, renderer, OrbitControls

// green box to check if works
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export function WorldScene() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    ref.current!.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.set(0, 50, 100)
    camera.lookAt(0, 0, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 1))
    scene.add(new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 10),
      new THREE.MeshLambertMaterial({ color: 0x00ff88 })
    ))

    const loop = () => { requestAnimationFrame(loop); renderer.render(scene, camera) }
    loop()

    return () => { renderer.dispose(); ref.current?.removeChild(renderer.domElement) }
  }, [])

  return <div ref={ref} />
}