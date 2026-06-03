import { ScreenEffectBackdrop } from './backdrop';

export class PerlinNoiseBackdrop extends ScreenEffectBackdrop {
  readonly FragmentShader = `\
#version 300 es
precision mediump float;

uniform vec2 screenSize;
uniform vec2 scrollOffset;
uniform highp float totalTime;

out vec4 fragColor;

const float ZOOM = 8.;

const int OCTAVES = 3;
const float PERSISTANCE = 0.15;
const float FREQUENCY = .75;
const float LACUNARITY = 2.5;
const float OFFSET_SCALAR = 20.;

// Time evolution walks a circle in the (z,w) axes of a 4D noise volume so
// the animation loops exactly every LOOP_PERIOD seconds. LOOP_RADIUS sets
// how much of the noise field the loop traverses — larger = more morph.
const float TWO_PI = 6.28318530718;
const float LOOP_PERIOD = 30.;
const float LOOP_RADIUS = 1.;

float frac(float v) { return v - floor(v); }
vec4 frac(vec4 v) { return v - floor(v); }

float hash(float n) {
  return frac(sin(n) * 43758.5453);
}

float lerp(float a, float b, float w) {
  return a + w * (b - a);
}

// 4D value noise. Quadrilinear interpolation between 16 corner hashes:
// two trilinear samples (one per w slab) blended by f.w.
float noise(vec4 x)
{
  vec4 p = floor(x);
  vec4 f = frac(x);
  f = f*f*(3.0 - 2.0*f);

  // Distinct strides so no two lattice corners collide on the hash key.
  float a = 57.;   // y stride
  float b = 113.;  // z stride
  float c = 263.;  // w stride

  float n = p.x + p.y*a + p.z*b + p.w*c;

  #define TRI(W) lerp(lerp(lerp(hash(n+(W)),       hash(n+(W)+1.),       f.x),  \
                           lerp(hash(n+(W)+a),     hash(n+(W)+a+1.),     f.x), f.y), \
                      lerp(lerp(hash(n+(W)+b),     hash(n+(W)+b+1.),     f.x),  \
                           lerp(hash(n+(W)+a+b),   hash(n+(W)+a+b+1.),   f.x), f.y), f.z)

  return lerp(TRI(0.), TRI(c), f.w);
}

float fractal_noise(vec4 x4) {
  float val = 0.;
  float scale = 0.5;
  float magnitude = 0.;
  float f = FREQUENCY;
  for (int i = 0; i < OCTAVES; i++) {
    val += scale * noise(x4 * f);
    magnitude += scale;
    scale *= PERSISTANCE;
    f *= LACUNARITY;
  }
  return val / magnitude;
}

void main() {
  vec2 uv = gl_FragCoord.xy / screenSize.xy;
  uv.x *= screenSize.x / screenSize.y;
  uv -= scrollOffset / ${this.BACKGROUND_SHADER_SCROLL_SCALAR}.;

  uv += vec2(${Math.random()} * OFFSET_SCALAR, ${Math.random()} * OFFSET_SCALAR);

  // mod() keeps the phase bounded so trig precision stays stable across hours.
  float phase = mod(totalTime / LOOP_PERIOD, 1.0) * TWO_PI;
  vec4 q4 = vec4(
    uv.xy * ZOOM / (screenSize.x / screenSize.y),
    cos(phase) * LOOP_RADIUS,
    sin(phase) * LOOP_RADIUS
  );

  float f = fractal_noise(q4);

  f = abs(f);

  if (f < 0.45) {
    fragColor = vec4(vec3(.1), 1.);
  }
  else if (f < 0.55) {
    fragColor = vec4(vec3(.13), 1.);
  }
  else {
    fragColor = vec4(vec3(.2), 1.);
  }
}
  `;

  protected override getFragmentShader(): string {
    return this.FragmentShader;
  }
}
