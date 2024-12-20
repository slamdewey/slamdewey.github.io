import { WebGLBackdrop } from 'src/app/components/backdrop/backdrop';
import { DEFAULT_SHADER_PROGRAMS, SHADER_HEADER, ShaderProgramData, UNIFORM_DEFS } from './shader-programs';

export class ReactiveWebGLBackground extends WebGLBackdrop {
  public shaderProgramData: ShaderProgramData = DEFAULT_SHADER_PROGRAMS[0];
  public fragmentShaderOverride: string | undefined = undefined;

  constructor(defaultShader?: ShaderProgramData) {
    super();
    if (defaultShader) this.shaderProgramData = defaultShader;
  }

  public attemptRecompileAndReinitialize(): void {
    const [vert, frag] = this.compileWebGLShaders(this.gl, this.getVertexShader(), this.getFragmentShader());

    if (vert && frag) {
      this.totalTime = 0;
      super.reInitialize();
    }
  }

  public override getVertexShader(): string {
    return this.shaderProgramData.vertexShader;
  }
  public override getFragmentShader(): string {
    return this.fragmentShaderOverride ?? SHADER_HEADER + UNIFORM_DEFS + this.shaderProgramData.fragmentShader;
  }
}
