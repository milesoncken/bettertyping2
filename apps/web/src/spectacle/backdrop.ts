/**
 * Results backdrop — the one WebGL surface in the product.
 *
 * Loaded by dynamic import when a run ends, so the latency-critical test route
 * never pays for it. Raw WebGL, no library: a slow spectral fog at very low
 * amplitude, sitting behind the numbers. It exists to give the results moment
 * atmosphere; if it ever competes with the trace, turn it down, not up.
 */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 res;
uniform float t;

// Cheap layered value noise. Three octaves is plenty at this amplitude.
float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v) {
  vec2 i = floor(v), f = fract(v);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / res;
  vec2 q = uv * vec2(2.4, 1.5);
  float n = noise(q + vec2(t * 0.035, t * 0.012)) * 0.6
          + noise(q * 2.3 - vec2(t * 0.02, 0.0)) * 0.28
          + noise(q * 4.7 + vec2(0.0, t * 0.015)) * 0.12;

  vec3 slow = vec3(1.0, 0.239, 0.722);
  vec3 mid  = vec3(0.478, 0.420, 1.0);
  vec3 fast = vec3(0.208, 0.910, 1.0);
  vec3 tint = mix(mix(slow, mid, smoothstep(0.25, 0.55, n)), fast, smoothstep(0.5, 0.9, n));

  // Weighted to the bottom, where the trace lands.
  float lift = smoothstep(0.0, 0.85, uv.y);
  float amount = (0.10 + 0.07 * n) * (1.0 - lift);
  gl_FragColor = vec4(tint * amount, amount);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Returns a teardown function. A no-op if WebGL is unavailable. */
export function mountBackdrop(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false });
  if (!gl) return () => {};

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return () => {};

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return () => {};
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(program, "res");
  const uTime = gl.getUniformLocation(program, "t");

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let frame = 0;
  const start = performance.now();

  const resize = (): void => {
    // Half resolution: it is a fog, nobody counts its pixels.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  };

  resize();
  window.addEventListener("resize", resize);

  const render = (now: number): void => {
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteBuffer(buffer);
  };
}
