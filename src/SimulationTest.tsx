/**
 * SimulationTest.tsx
 *
 * Standalone test harness for the GPU simulation engine.
 * This creates its own minimal Three.js scene so you can verify
 * ES-50, ES-51, and ES-52 work WITHOUT needing MP's scene branch.
 *
 * Usage: Temporarily replace <WorldScene /> in App.tsx with <SimulationTest />
 *
 * DELETE THIS FILE before merging to dev — it's for testing only.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createAgents, updateAgents, getAgentStats, disposeAgents } from './simulation';

export function SimulationTest() {
  const containerRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current!;

    // ── Minimal Three.js scene (temporary, NOT MP's) ──────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x1a1a2e);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 2000
    );
    camera.position.set(0, 200, 250);
    camera.lookAt(0, 0, 0);

    // Basic lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 100);
    scene.add(dirLight);

    // Ground plane (stand-in for terrain)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(256, 256),
      new THREE.MeshLambertMaterial({ color: 0x2d5a27 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // ── Initialize simulation engine ──────────────────────────
    let agents: THREE.Object3D;
    try {
      agents = createAgents();
      scene.add(agents);
      console.log('✅ GPU Simulation Engine initialized successfully');
    } catch (err) {
      console.error('❌ Failed to initialize simulation:', err);
      if (statsRef.current) {
        statsRef.current.textContent = `ERROR: ${err}`;
        statsRef.current.style.color = '#ff4444';
      }
      return;
    }

    // ── Animation loop ────────────────────────────────────────
    const clock = new THREE.Clock();
    let frameCount = 0;
    let running = true;

    function animate() {
      if (!running) return;
      requestAnimationFrame(animate);

      const dt = clock.getDelta();
      updateAgents(dt);
      renderer.render(scene, camera);

      // Update stats display every 30 frames
      frameCount++;
      if (frameCount % 30 === 0 && statsRef.current) {
        const stats = getAgentStats();
        statsRef.current.innerHTML = [
          `<strong>GPU Simulation Running</strong>`,
          `Alive agents: ${stats.alive}`,
          `Avg energy: ${stats.avgEnergy.toFixed(1)}`,
          `Avg age: ${stats.avgAge.toFixed(1)}`,
          `Frame: ${frameCount}`,
        ].join('<br>');
      }
    }

    animate();

    // ── Resize handling ───────────────────────────────────────
    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onResize);

    // ── Simple mouse orbit ────────────────────────────────────
    let isDragging = false;
    let prevX = 0, prevY = 0;
    let rotY = 0, rotX = -0.5;
    let zoom = 300;

    function updateCamera() {
      camera.position.set(
        Math.sin(rotY) * Math.cos(rotX) * zoom,
        Math.sin(-rotX) * zoom,
        Math.cos(rotY) * Math.cos(rotX) * zoom
      );
      camera.lookAt(0, 0, 0);
    }

    container.addEventListener('mousedown', (e) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    });
    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      rotY += (e.clientX - prevX) * 0.005;
      rotX += (e.clientY - prevY) * 0.005;
      rotX = Math.max(-1.5, Math.min(-0.1, rotX));
      prevX = e.clientX;
      prevY = e.clientY;
      updateCamera();
    });
    container.addEventListener('wheel', (e) => {
      zoom += e.deltaY * 0.5;
      zoom = Math.max(50, Math.min(800, zoom));
      updateCamera();
      e.preventDefault();
    }, { passive: false });

    // ── Cleanup ───────────────────────────────────────────────
    return () => {
      running = false;
      window.removeEventListener('resize', onResize);
      disposeAgents();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <>
      <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />
      <div
        ref={statsRef}
        style={{
          position: 'fixed',
          top: 16,
          left: 16,
          background: 'rgba(0,0,0,0.75)',
          color: '#44dd88',
          padding: '12px 16px',
          borderRadius: 8,
          fontFamily: 'monospace',
          fontSize: 14,
          lineHeight: 1.6,
          zIndex: 1000,
          pointerEvents: 'none',
        }}
      >
        Initializing simulation...
      </div>
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          left: 16,
          background: 'rgba(0,0,0,0.75)',
          color: '#888',
          padding: '8px 12px',
          borderRadius: 8,
          fontFamily: 'monospace',
          fontSize: 12,
          zIndex: 1000,
          pointerEvents: 'none',
        }}
      >
        🧪 TEST HARNESS — drag to orbit, scroll to zoom — delete before merge
      </div>
    </>
  );
}
