#version 300 es
// fullscreen shader, each fragment = one agent

out vec2 vUv;

void main() {
  // creates a fullscreen triangle from vertex ID (0, 1, 2)
  // positions computed from gl_VertexID
  float x = float((gl_VertexID & 1) << 2);  // 0, 4, 0
  float y = float((gl_VertexID & 2) << 1);  // 0, 0, 4

  vUv = vec2(x * 0.5, y * 0.5);             // UV: (0,0), (2,0), (0,2)
  gl_Position = vec4(x - 1.0, y - 1.0, 0.0, 1.0);
}
