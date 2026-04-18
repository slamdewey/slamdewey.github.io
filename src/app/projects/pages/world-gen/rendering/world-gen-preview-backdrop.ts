import { WebGLBackdrop } from '@components/backdrop/backdrop';

export class WorldGenPreviewBackdrop extends WebGLBackdrop {
  private readonly FragmentShader = `\
#version 300 es
precision mediump float;

uniform vec2 screenSize;
uniform float totalTime;

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / screenSize.xy;
  uv.x *= screenSize.x / screenSize.y;

  // Slow horizontal drift
  uv.x += totalTime * 0.02;

  float e = fbm(uv * 6.0);

  // Biome color ramp (matching project BIOME_COLORS)
  vec3 ocean       = vec3(0.000, 0.000, 0.545);  // [0, 0, 139]
  vec3 shallowWater = vec3(0.000, 0.000, 1.000); // [0, 0, 255]
  vec3 desert      = vec3(0.824, 0.706, 0.549);  // [210, 180, 140]
  vec3 grassland   = vec3(0.502, 0.502, 0.000);  // [128, 128, 0]
  vec3 forest      = vec3(0.000, 0.502, 0.000);  // [0, 128, 0]
  vec3 mountain    = vec3(0.502, 0.502, 0.502);  // [128, 128, 128]
  vec3 arctic      = vec3(1.000, 1.000, 1.000);  // [255, 255, 255]

  vec3 color;
  if (e < 0.35) {
    color = mix(ocean, shallowWater, smoothstep(0.20, 0.35, e));
  } else if (e < 0.42) {
    color = mix(shallowWater, desert, smoothstep(0.35, 0.42, e));
  } else if (e < 0.52) {
    color = mix(desert, grassland, smoothstep(0.42, 0.52, e));
  } else if (e < 0.64) {
    color = mix(grassland, forest, smoothstep(0.52, 0.64, e));
  } else if (e < 0.76) {
    color = mix(forest, mountain, smoothstep(0.64, 0.76, e));
  } else {
    color = mix(mountain, arctic, smoothstep(0.76, 0.90, e));
  }

  fragColor = vec4(color, 1.0);
}
`;

  protected override getFragmentShader(): string {
    return this.FragmentShader;
  }
}
