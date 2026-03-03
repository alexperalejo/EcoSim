import * as THREE from 'three'

export function createAgents(scene: THREE.Scene) {
	
	const geometry = new THREE.SphereGeometry(0.5, 4, 4)
	const material = new THREE.MeshLambertMaterial({ color: 0x00ff88 })
	const agentCount = 1000
	const mesh = new THREE.InstancedMesh(geometry, material, agentCount)
	const dummy = new THREE.Object3D()

	scene.add(mesh)
	
	for (let i = 0; i < agentCount; i++) {
		dummy.position.set((Math.random() - 0.5) * 100, 0, (Math.random() - 0.5) * 100)
		dummy.updateMatrix()
		mesh.setMatrixAt(i, dummy.matrix)
	}

	mesh.instanceMatrix.needsUpdate = true
	return mesh

}