import { Vector2 } from '@lib/coordinate';

/**
 * Abstract, context-agnostic base for any backdrop. Owns lifecycle (size,
 * tick, destroy) and input state (mouse, scroll) only. Concrete rendering
 * contexts (2D canvas, WebGL2, etc.) live in subclasses.
 */
export abstract class Backdrop {
  protected width = 0;
  protected height = 0;

  public mousePosition: Vector2 = new Vector2(-1000, -1000);
  public scrollOffset: Vector2 = new Vector2(0, 0);

  public abstract contextId(): string;
  public abstract setContext(ctx: RenderingContext): void;

  protected abstract update(deltaTime: number): void;
  protected abstract draw(): void;

  public setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  public initialize(): void {}

  public tick(deltaTime: number): void {
    this.update(deltaTime);
    this.draw();
  }

  public onDestroy(): void {}
}

/**
 * Backdrop rendered through a 2D canvas context. Owns the typed ctx field
 * and the standard clear() helper.
 */
export abstract class Canvas2dBackdrop extends Backdrop {
  protected ctx!: CanvasRenderingContext2D;

  public override contextId(): string {
    return '2d';
  }

  public override setContext(ctx: RenderingContext): void {
    this.ctx = ctx as CanvasRenderingContext2D;
  }

  protected clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}

type UniformArity = 1 | 2 | 3 | 4;

interface UniformSlot {
  arity: UniformArity;
  values: Float32Array;
  location: WebGLUniformLocation | null;
  dirty: boolean;
}

/**
 * Tracks a set of named float uniforms with in-place storage and dirty
 * detection. set() only marks dirty when the value actually changes;
 * flush() only uploads dirty slots whose location resolved.
 */
export class UniformRegistry {
  private readonly slots = new Map<string, UniformSlot>();

  declare(name: string, arity: UniformArity): void {
    this.slots.set(name, {
      arity,
      values: new Float32Array(arity),
      location: null,
      dirty: true,
    });
  }

  bind(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    for (const [name, slot] of this.slots) {
      slot.location = gl.getUniformLocation(program, name);
      slot.dirty = true;
    }
  }

  set(name: string, ...next: number[]): void {
    const slot = this.slots.get(name);
    if (!slot) return;
    const v = slot.values;
    let changed = false;
    for (let i = 0; i < slot.arity; i++) {
      if (v[i] !== next[i]) {
        v[i] = next[i];
        changed = true;
      }
    }
    if (changed) slot.dirty = true;
  }

  flush(gl: WebGL2RenderingContext): void {
    for (const slot of this.slots.values()) {
      if (!slot.dirty || !slot.location) continue;
      const v = slot.values;
      switch (slot.arity) {
        case 1:
          gl.uniform1f(slot.location, v[0]);
          break;
        case 2:
          gl.uniform2f(slot.location, v[0], v[1]);
          break;
        case 3:
          gl.uniform3f(slot.location, v[0], v[1], v[2]);
          break;
        case 4:
          gl.uniform4f(slot.location, v[0], v[1], v[2], v[3]);
          break;
      }
      slot.dirty = false;
    }
  }
}

/**
 * Lean WebGL2 backdrop. Owns the gl context, the fullscreen quad, shader
 * compile/link plumbing, and a UniformRegistry. Declares no uniforms by
 * default — subclasses opt in by overriding declareUniforms/updateUniforms.
 */
export abstract class WebGLBackdrop extends Backdrop {
  private readonly vertices: number[] = [-1, 1, -1, -1, 1, -1, -1, 1, 1, -1, 1, 1];

  protected gl!: WebGL2RenderingContext;
  protected shaderProgram!: WebGLProgram;
  protected readonly uniforms = new UniformRegistry();

  private vert!: WebGLShader;
  private frag!: WebGLShader;

  public override contextId(): string {
    return 'webgl2';
  }

  public override setContext(ctx: RenderingContext): void {
    this.gl = ctx as WebGL2RenderingContext;
  }

  public override setSize(width: number, height: number): void {
    super.setSize(width, height);
    if (this.gl) {
      this.gl.viewport(0, 0, this.width, this.height);
    }
  }

  public override initialize(): void {
    this.initWebGL(this.gl);
    this.clear();
  }

  protected override draw(): void {
    this.updateUniforms(this.uniforms);
    this.uniforms.flush(this.gl);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertices.length / 2);
  }

  protected clear(): void {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  protected getVertexShader(): string {
    return `\
#version 300 es
precision mediump float;

in vec2 coordinates;

void main() {
  gl_Position = vec4(coordinates.xy, 0.0, 1.0);
}
`;
  }

  protected abstract getFragmentShader(): string;

  /**
   * Called once after the shader program is linked and bound. Override to
   * declare uniforms on this.uniforms, look up custom uniform locations,
   * create textures, etc.
   */
  protected onProgramReady(_gl: WebGL2RenderingContext, _program: WebGLProgram): void {}

  /**
   * Override to push current state into the registry each frame. The
   * registry's compare-on-set means unchanged values do not re-upload.
   */
  protected updateUniforms(_registry: UniformRegistry): void {}

  /**
   * Override to enable/disable GL pipeline state (depth, blend, cull...).
   * Default leaves everything disabled — appropriate for a fullscreen quad.
   */
  protected configureGLState(_gl: WebGL2RenderingContext): void {}

  public override onDestroy(): void {
    const gl = this.gl;
    if (this.shaderProgram) gl.deleteProgram(this.shaderProgram);
    if (this.vert) gl.deleteShader(this.vert);
    if (this.frag) gl.deleteShader(this.frag);
  }

  private initWebGL(gl: WebGL2RenderingContext): void {
    const vertexBuffer = gl.createBuffer();
    if (vertexBuffer === null) throw new Error("Couldn't create vertex buffer!");

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.STATIC_DRAW);

    if (this.vert) gl.deleteShader(this.vert);
    if (this.frag) gl.deleteShader(this.frag);
    [this.vert, this.frag] = this.compileWebGLShaders(gl, this.getVertexShader(), this.getFragmentShader());

    this.createAndBindShaderProgram(gl, this.vert, this.frag);

    const coord = gl.getAttribLocation(this.shaderProgram, 'coordinates');
    gl.vertexAttribPointer(coord, 2, gl.FLOAT, false, 2 * Float32Array.BYTES_PER_ELEMENT, 0);
    gl.enableVertexAttribArray(coord);

    this.onProgramReady(gl, this.shaderProgram);
    this.uniforms.bind(gl, this.shaderProgram);

    this.configureGLState(gl);
    gl.clearColor(0, 0, 0, 0);
  }

  public compileWebGLShaders(
    gl: WebGL2RenderingContext,
    vertCode: string,
    fragCode: string
  ): [vertexShader: WebGLShader, fragmentShader: WebGLShader] {
    const vertShader = gl.createShader(gl.VERTEX_SHADER);
    const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (vertShader === null) throw new Error('Failed To Create Vertex Shader!');
    if (fragShader === null) throw new Error('Failed To Create Fragment Shader!');

    gl.shaderSource(vertShader, vertCode);
    gl.shaderSource(fragShader, fragCode);

    gl.compileShader(vertShader);
    if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
      console.log(vertCode);
      throw new Error('Error compiling vertex shader\n' + gl.getShaderInfoLog(vertShader));
    }
    gl.compileShader(fragShader);
    if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
      throw new Error('Error compiling fragment shader\n' + gl.getShaderInfoLog(fragShader));
    }
    return [vertShader, fragShader];
  }

  private createAndBindShaderProgram(gl: WebGL2RenderingContext, vert: WebGLShader, frag: WebGLShader): void {
    const shaderProgram = gl.createProgram();
    if (shaderProgram === null) throw new Error('Failed To Create Shader Program!');
    gl.attachShader(shaderProgram, vert);
    gl.attachShader(shaderProgram, frag);
    gl.linkProgram(shaderProgram);
    gl.useProgram(shaderProgram);

    if (this.shaderProgram) gl.deleteProgram(this.shaderProgram);
    this.shaderProgram = shaderProgram;
  }
}

/**
 * Fullscreen screen-space effect backdrop. Adds the common uniforms shared
 * across all post-style shaders: screenSize, totalTime, mousePosition,
 * scrollOffset. Subclasses that don't reference a uniform in their shader
 * pay nothing — the registry skips upload when getUniformLocation returns
 * null.
 */
export abstract class ScreenEffectBackdrop extends WebGLBackdrop {
  protected readonly BACKGROUND_SHADER_SCROLL_SCALAR = 5000;

  public totalTime = 0;

  protected override update(deltaTime: number): void {
    this.totalTime += deltaTime;
  }

  protected override onProgramReady(_gl: WebGL2RenderingContext, _program: WebGLProgram): void {
    this.uniforms.declare('screenSize', 2);
    this.uniforms.declare('totalTime', 1);
    this.uniforms.declare('mousePosition', 2);
    this.uniforms.declare('scrollOffset', 2);
  }

  protected override updateUniforms(registry: UniformRegistry): void {
    registry.set('screenSize', this.width, this.height);
    registry.set('totalTime', this.totalTime);
    registry.set('mousePosition', this.mousePosition.x, this.mousePosition.y);
    registry.set('scrollOffset', this.scrollOffset.x, this.scrollOffset.y);
  }
}
