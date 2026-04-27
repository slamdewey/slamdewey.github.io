/**
 * GPU-accelerated orthographic sphere view of an equirectangular RGBA grid.
 *
 * The equirect texture is uploaded once per data update; rotation only swaps
 * two uniform floats and re-issues a fullscreen-quad draw. This is essentially
 * free per frame — drag-to-rotate stays at native refresh rate even on a
 * laptop iGPU.
 *
 * Pixels outside the unit disk are written transparent, so the canvas can sit
 * over any backdrop. Bilinear filtering on the source texture handles the
 * smooth sampling that the CPU version did manually.
 */

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uRotLon;
uniform float uRotLat;
out vec4 fragColor;

const float PI = 3.141592653589793;

void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) {
    fragColor = vec4(0.0);
    return;
  }
  float w = sqrt(1.0 - r2);

  float cl = cos(uRotLat);
  float sl = sin(uRotLat);
  float cn = cos(uRotLon);
  float sn = sin(uRotLon);

  // Camera basis: forward = view-out, right = +u, up = +v.
  vec3 forward = vec3(cl * cn, cl * sn, sl);
  vec3 right   = vec3(-sn, cn, 0.0);
  vec3 up      = vec3(-sl * cn, -sl * sn, cl);

  vec3 world = vUv.x * right + vUv.y * up + w * forward;

  float lat = asin(clamp(world.z, -1.0, 1.0));
  float lon = atan(world.y, world.x);

  // Equirect: row 0 = north pole (lat = +π/2), col 0 = lon = -π.
  vec2 uv = vec2((lon + PI) / (2.0 * PI), (PI * 0.5 - lat) / PI);
  fragColor = texture(uTexture, uv);
}
`;

export class SphereView {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private texture: WebGLTexture;
  private uRotLon: WebGLUniformLocation;
  private uRotLat: WebGLUniformLocation;
  private texW = 0;
  private texH = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;

    this.program = compileProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this.program);

    // Fullscreen quad (-1..1 in clip space).
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.uRotLon = gl.getUniformLocation(this.program, 'uRotLon')!;
    this.uRotLat = gl.getUniformLocation(this.program, 'uRotLat')!;
    const uTexture = gl.getUniformLocation(this.program, 'uTexture')!;
    gl.uniform1i(uTexture, 0);
  }

  /** Upload (or re-upload) the equirect source texture. Call on each new generation. */
  uploadEquirect(rgba: Uint8Array, width: number, height: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (width === this.texW && height === this.texH) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      this.texW = width;
      this.texH = height;
    }
  }

  /** Resize the WebGL viewport to match the canvas backing-store size. */
  setSize(size: number): void {
    if (this.canvas.width !== size || this.canvas.height !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
    }
    this.gl.viewport(0, 0, size, size);
  }

  /** Render the sphere at the given camera longitude/latitude (radians). */
  render(rotLon: number, rotLat: number): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1f(this.uRotLon, rotLon);
    gl.uniform1f(this.uRotLat, rotLat);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.texture);
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function compileProgram(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram()!;
  const vs = compileShader(gl, gl.VERTEX_SHADER, vert);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}
