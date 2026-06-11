/**
 * GPU Voronoi fill rendered by a fragment shader.
 *
 * The same program handles three topologies via `uTopology`:
 *   0 — flat (no wrap)
 *   1 — cylindrical (x wraps)
 *   2 — spherical (orthographic globe)
 *
 * Seeds live in "world" coordinates that are normalized to the canvas height,
 * so a 2:1 cylindrical canvas has x ∈ [0, 2). The aspect uniform keeps the
 * distance metric isotropic regardless of how the canvas is stretched. For
 * spherical mode, seeds are unit vectors and aspect is ignored.
 *
 * This renderer is responsible for cell **fills only** — every pixel claims
 * the color of its nearest seed. Borders and seed-dot rendering are handled
 * analytically in Canvas2D using {@link ./voronoi-edges}, since the shader
 * has no notion of actual polygon geometry.
 */

export type VoronoiTopology = 'flat' | 'cylindrical' | 'spherical';

export const MAX_VORONOI_SEEDS = 128;

export interface VoronoiSeedVec {
  x: number;
  y: number;
  z: number;
}

export function topologyIndex(t: VoronoiTopology): number {
  return t === 'flat' ? 0 : t === 'cylindrical' ? 1 : 2;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // vUv.y is flipped so y=0 matches "top of canvas" — the same convention
  // used by raster pixel coords and the Canvas2D overlay that draws on top
  // of this canvas. Without the flip, seed dots and overlay graph nodes
  // land on opposite sides of the canvas.
  vUv = vec2(aPos.x * 0.5 + 0.5, 1.0 - (aPos.y * 0.5 + 0.5));
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
#define MAX_SEEDS ${MAX_VORONOI_SEEDS}

in vec2 vUv;
out vec4 fragColor;

uniform int uTopology;
uniform int uSeedCount;
uniform vec3 uSeeds[MAX_SEEDS];
uniform vec3 uSeedColors[MAX_SEEDS];
uniform float uAspect;
uniform vec2 uPan;
uniform float uRotLon;
uniform float uRotLat;

float wrapMod(float x, float m) {
  return x - m * floor(x / m);
}

void main() {
  vec3 world;

  if (uTopology == 2) {
    // Un-flip y for spherical so +up world direction projects to the top of
    // the canvas — matching the convention used by vec3ToView in the Canvas2D
    // overlay. (For planar/cylindrical, the global y-flip in the vertex
    // shader is correct: world.y=0 maps to canvas top, matching pixel space.)
    vec2 nd = vec2(vUv.x * 2.0 - 1.0, 1.0 - vUv.y * 2.0);
    float r2 = dot(nd, nd);
    if (r2 > 1.0) {
      fragColor = vec4(0.0);
      return;
    }
    float w = sqrt(1.0 - r2);
    float cl = cos(uRotLat);
    float sl = sin(uRotLat);
    float cn = cos(uRotLon);
    float sn = sin(uRotLon);
    vec3 forward = vec3(cl * cn, cl * sn, sl);
    vec3 right   = vec3(-sn, cn, 0.0);
    vec3 up      = vec3(-sl * cn, -sl * sn, cl);
    world = nd.x * right + nd.y * up + w * forward;
  } else {
    float wx = vUv.x * uAspect + uPan.x;
    float wy = vUv.y + uPan.y;
    if (uTopology == 1) {
      wx = wrapMod(wx, uAspect);
    }
    world = vec3(wx, wy, 0.0);
  }

  float bestD = 1e9;
  int best = 0;
  for (int i = 0; i < uSeedCount; i++) {
    vec3 s = uSeeds[i];
    float d;
    if (uTopology == 2) {
      d = 1.0 - dot(world, s);
    } else {
      vec2 diff = vec2(world.x - s.x, world.y - s.y);
      if (uTopology == 1) {
        if (diff.x > uAspect * 0.5) diff.x -= uAspect;
        else if (diff.x < -uAspect * 0.5) diff.x += uAspect;
      }
      d = dot(diff, diff);
    }
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }

  fragColor = vec4(uSeedColors[best], 1.0);
}
`;

export class VoronoiRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private uTopology: WebGLUniformLocation;
  private uSeedCount: WebGLUniformLocation;
  private uSeeds: WebGLUniformLocation;
  private uSeedColors: WebGLUniformLocation;
  private uAspect: WebGLUniformLocation;
  private uPan: WebGLUniformLocation;
  private uRotLon: WebGLUniformLocation;
  private uRotLat: WebGLUniformLocation;

  private seedBuffer = new Float32Array(MAX_VORONOI_SEEDS * 3);
  private colorBuffer = new Float32Array(MAX_VORONOI_SEEDS * 3);

  private backingW = 0;
  private backingH = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;

    this.program = compileProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this.program);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.uTopology = gl.getUniformLocation(this.program, 'uTopology')!;
    this.uSeedCount = gl.getUniformLocation(this.program, 'uSeedCount')!;
    this.uSeeds = gl.getUniformLocation(this.program, 'uSeeds')!;
    this.uSeedColors = gl.getUniformLocation(this.program, 'uSeedColors')!;
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect')!;
    this.uPan = gl.getUniformLocation(this.program, 'uPan')!;
    this.uRotLon = gl.getUniformLocation(this.program, 'uRotLon')!;
    this.uRotLat = gl.getUniformLocation(this.program, 'uRotLat')!;

    gl.uniform1i(this.uTopology, 0);
    gl.uniform1i(this.uSeedCount, 0);
    gl.uniform1f(this.uAspect, 1.0);
    gl.uniform2f(this.uPan, 0, 0);
    gl.uniform1f(this.uRotLon, 0);
    gl.uniform1f(this.uRotLat, 0);
  }

  setSeeds(seeds: VoronoiSeedVec[], colors: readonly (readonly [number, number, number])[]): void {
    const n = Math.min(seeds.length, MAX_VORONOI_SEEDS);
    for (let i = 0; i < n; i++) {
      this.seedBuffer[i * 3] = seeds[i].x;
      this.seedBuffer[i * 3 + 1] = seeds[i].y;
      this.seedBuffer[i * 3 + 2] = seeds[i].z;
      this.colorBuffer[i * 3] = colors[i][0];
      this.colorBuffer[i * 3 + 1] = colors[i][1];
      this.colorBuffer[i * 3 + 2] = colors[i][2];
    }
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform3fv(this.uSeeds, this.seedBuffer);
    gl.uniform3fv(this.uSeedColors, this.colorBuffer);
    gl.uniform1i(this.uSeedCount, n);
  }

  setTopology(t: VoronoiTopology): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1i(this.uTopology, topologyIndex(t));
  }

  setAspect(aspect: number): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.uAspect, aspect);
  }

  setPan(x: number, y: number): void {
    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.uPan, x, y);
  }

  setRotation(lon: number, lat: number): void {
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.uRotLon, lon);
    this.gl.uniform1f(this.uRotLat, lat);
  }

  setBackingSize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (w === this.backingW && h === this.backingH) return;
    this.backingW = w;
    this.backingH = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  render(): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
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

/**
 * Golden-angle HSL palette in [0, 1] floats. Matches the per-cell colors used
 * by the CPU `voronoiToRGBA` / sphere variants so all canvases agree on hue.
 */
export function buildVoronoiPalette(count: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const hue = ((i * 137.508) % 360) / 360;
    out.push(hslToRgbF(hue, 0.55, 0.55));
  }
  return out;
}

function hslToRgbF(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  switch ((h * 6) | 0) {
    case 0:
      r = c;
      g = x;
      break;
    case 1:
      r = x;
      g = c;
      break;
    case 2:
      g = c;
      b = x;
      break;
    case 3:
      g = x;
      b = c;
      break;
    case 4:
      r = x;
      b = c;
      break;
    case 5:
      r = c;
      b = x;
      break;
  }
  return [r + m, g + m, b + m];
}
