import { WebGLBackdrop } from './backdrop';

export class ShaderTestAnimatedBackground extends WebGLBackdrop {
  protected override start(): void {}

  readonly FragmentShader: string = `
  precision mediump float;
  
  uniform vec2 screenSize;
  uniform float totalTime;

  void main() {
    float brightness = 1.0;
    vec2 uv = gl_FragCoord.xy / screenSize.xy / ((cos(totalTime / 3.0) + 1.0) / 2.0);
    gl_FragColor = vec4(uv.xy * brightness, ((sin(totalTime) + 1.0) / 2.0) * brightness, 1.0);
  }
  `;

  protected override getFragmentShader(): string {
    return this.FragmentShader;
  }
}
