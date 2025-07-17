import { WebGLBackdrop } from './backdrop';

export class UVColorCycleBackground extends WebGLBackdrop {
  readonly FragmentShader: string = `\
#version 300 es
precision mediump float;

const float TIME_SCALAR = 0.7;

uniform vec2 screenSize;
uniform float totalTime;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / screenSize.xy;
  uv.x *= screenSize.x / screenSize.y;
  
  float xOffset = 5.1 + 0.5 * sin(totalTime * TIME_SCALAR);
  
  vec3 color = 0.5 + 0.5 * cos(xOffset + uv.yyx + vec3(0., 2., 4.));
  fragColor = vec4(color.xyz, 1.);
}
  `;
  protected override getFragmentShader(): string {
    return this.FragmentShader;
  }
}
