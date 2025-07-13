import { Vector2 } from 'src/app/lib/coordinate';

export abstract class Backdrop {
  public contextId(): string {
    return '2d';
  }

  protected width: number;
  protected height: number;
  protected ctx: CanvasRenderingContext2D;
  public mousePosition: Vector2 = new Vector2(-1000, -1000);
  public scrollOffset: Vector2 = new Vector2(0, 0);
  protected lastUpdate: number = Date.now();

  protected abstract update(deltaTime: number): void;
  protected abstract draw(deltaTime: number): void;

  public setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.clear();
  }

  /**
   * T
   * @param ctx
   */
  public setContext(ctx: RenderingContext) {
    this.ctx = ctx as CanvasRenderingContext2D;
  }

  public initialize(): void {
    this.start();
    this.clear();
  }
  /**
   * Final Init Step
   *
   * This function is also called as part of the re-initialization process after
   * the user updates the viewport.
   */
  protected start(): void {}

  public clear(): void {
    (this.ctx as CanvasRenderingContext2D).clearRect(0, 0, this.width, this.height);
  }

  public tick(): void {
    const now = Date.now();
    const deltaTime = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;

    this.update(deltaTime);
    this.clear();
    this.draw(deltaTime);
  }

  public onDestroy(): void {}
}

type glUniform = {
  name: string;
  value: () => [number] | [number, number];
  location: WebGLUniformLocation | null;
};

export abstract class WebGLBackdrop extends Backdrop {
  protected readonly BACKGROUND_SHADER_SCROLL_SCALAR = 5000;
  // vertices for a quad (two triangles)
  private readonly vertices: number[] = [-1, 1, -1, -1, 1, -1, -1, 1, 1, -1, 1, 1];

  protected gl: WebGLRenderingContext;
  protected shaderProgram: WebGLProgram;
  private vert: WebGLProgram;
  private frag: WebGLProgram;

  public totalTime = 0;

  private standardUniforms: glUniform[] = [
    {
      name: 'screenSize',
      value: () => [this.width, this.height],
      location: null,
    },
    {
      name: 'totalTime',
      value: () => [this.totalTime],
      location: null,
    },
    {
      name: 'mousePosition',
      value: () => [this.mousePosition.x, this.mousePosition.y],
      location: null,
    },
    {
      name: 'scrollOffset',
      value: () => [this.scrollOffset.x, this.scrollOffset.y],
      location: null,
    },
  ];

  public override contextId(): string {
    return 'webgl2';
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

  protected initializeDrawVariables(gl: WebGLRenderingContext, shaderProgram: WebGLProgram): void {
    const coord = gl.getAttribLocation(shaderProgram, 'coordinates');
    gl.vertexAttribPointer(coord, 2, gl.FLOAT, false, 2 * Float32Array.BYTES_PER_ELEMENT, 0);
    gl.enableVertexAttribArray(coord);
    gl.uniform2f(gl.getUniformLocation(shaderProgram, 'screenSize'), this.width, this.height);

    this.standardUniforms = this.standardUniforms.map((uniform) => {
      return {
        ...uniform,
        location: gl.getUniformLocation(shaderProgram, uniform.name),
      };
    });
  }

  protected update(deltaTime: number): void {
    this.totalTime += deltaTime;
  }

  protected prepareDrawVariables(gl: WebGLRenderingContext): void {
    this.standardUniforms.forEach((uniform) => {
      const value = uniform.value();
      if (!value || !uniform.location) {
        return;
      }
      switch (value.length) {
        case 1:
          gl.uniform1f(uniform.location!, ...value);
          break;
        case 2:
          gl.uniform2f(uniform.location!, ...value);
          break;
      }
    });
  }

  public override setContext(ctx: WebGLRenderingContext): void {
    this.gl = ctx;
  }

  public override initialize(): void {
    this.initWebGL(this.gl);
    this.clear();
  }

  public override setSize(width: number, height: number): void {
    super.setSize(width, height);
    if (this.gl) {
      this.gl.viewport(0, 0, this.width, this.height);
    }
  }

  protected override draw(): void {
    this.prepareDrawVariables(this.gl);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertices.length / 2);
  }

  public override clear(): void {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }

  private initWebGL(gl: WebGLRenderingContext): void {
    // Create a new buffer object
    const vertex_buffer = gl.createBuffer();
    if (vertex_buffer === null) throw new Error("Couldn't create vertex buffer!");

    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    if (this.vert) {
      gl.deleteShader(this.vert);
    }
    if (this.frag) {
      gl.deleteShader(this.frag);
    }
    [this.vert, this.frag] = this.compileWebGLShaders(
      gl,
      this.getVertexShader(),
      this.getFragmentShader()
    );

    this.createAndBindShaderProgram(gl, this.vert, this.frag);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    this.initializeDrawVariables(gl, this.shaderProgram);

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.DEPTH_TEST);
  }

  public compileWebGLShaders(
    gl: WebGLRenderingContext,
    vertCode: string,
    fragCode: string
  ): [vertexShader: WebGLShader, fragmentShader: WebGLShader] {
    const vertShader = gl.createShader(gl.VERTEX_SHADER);
    const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (vertShader === null) {
      throw new Error('Failed To Create Vertex Shader!');
    }
    if (fragShader === null) {
      throw new Error('Failed To Create Fragment Shader!');
    }
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

  private createAndBindShaderProgram(
    gl: WebGLRenderingContext,
    vert: WebGLShader,
    frag: WebGLShader
  ) {
    const shaderProgram = gl.createProgram();
    if (shaderProgram === null) {
      throw new Error('Failed To Create Shader Program!');
    }
    gl.attachShader(shaderProgram, vert);
    gl.attachShader(shaderProgram, frag);
    gl.linkProgram(shaderProgram);
    gl.useProgram(shaderProgram);

    if (this.shaderProgram) {
      gl.deleteProgram(this.shaderProgram);
    }
    this.shaderProgram = shaderProgram;
  }

  public override onDestroy(): void {
    const gl = this.gl;
    if (this.shaderProgram) {
      gl.deleteProgram(this.shaderProgram);
    }
    if (this.vert) {
      gl.deleteShader(this.vert);
    }
    if (this.frag) {
      gl.deleteShader(this.frag);
    }
  }
}
