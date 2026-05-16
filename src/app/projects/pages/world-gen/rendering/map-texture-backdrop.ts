import { WebGLBackdrop } from '@components/backdrop/backdrop';
import { MAP_VERTEX_SHADER, MAP_FRAGMENT_SHADER } from './shaders';

export class MapTextureBackdrop extends WebGLBackdrop {
  private dataTexture: WebGLTexture | null = null;
  private mapWidth = 0;
  private mapHeight = 0;
  private hasData = false;
  private mapSizeLocation: WebGLUniformLocation | null = null;
  private textureLocation: WebGLUniformLocation | null = null;
  private panLocation: WebGLUniformLocation | null = null;
  private pendingData: { data: Uint8Array; width: number; height: number } | null = null;

  /** Horizontal pan offset in UV space (0 = no pan, 0.5 = half the map) */
  public panOffset = 0;

  protected override getVertexShader(): string {
    return MAP_VERTEX_SHADER;
  }

  protected override getFragmentShader(): string {
    return MAP_FRAGMENT_SHADER;
  }

  protected override initializeDrawVariables(gl: WebGL2RenderingContext, shaderProgram: WebGLProgram): void {
    super.initializeDrawVariables(gl, shaderProgram);
    this.mapSizeLocation = gl.getUniformLocation(shaderProgram, 'uMapSize');
    this.textureLocation = gl.getUniformLocation(shaderProgram, 'uDataTexture');
    this.panLocation = gl.getUniformLocation(shaderProgram, 'uPanOffset');

    // Create texture
    this.dataTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // If data was queued before GL was ready, upload it now
    if (this.pendingData) {
      this.doUpload(this.pendingData.data, this.pendingData.width, this.pendingData.height);
      this.pendingData = null;
    }
    // Clear background so first frame isn't garbage
    this.gl.clearColor(0.067, 0.067, 0.067, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  /**
   * Upload pre-colored RGBA data to the texture.
   * Can be called before or after initialization.
   */
  public uploadData(data: Uint8Array, width: number, height: number): void {
    if (!this.gl || !this.dataTexture) {
      this.pendingData = { data, width, height };
      this.mapWidth = width;
      this.mapHeight = height;
      return;
    }
    this.doUpload(data, width, height);
  }

  private doUpload(data: Uint8Array, width: number, height: number): void {
    const gl = this.gl;
    this.mapWidth = width;
    this.mapHeight = height;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

    this.hasData = true;
  }

  public override tick(_deltaTime: number): void {
    if (this.hasData) {
      this.draw();
    }
  }

  protected override draw(): void {
    const gl = this.gl;
    if (!gl || !this.dataTexture || this.mapWidth === 0) return;

    if (this.mapSizeLocation) {
      gl.uniform2f(this.mapSizeLocation, this.mapWidth, this.mapHeight);
    }
    if (this.panLocation) {
      gl.uniform1f(this.panLocation, this.panOffset);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dataTexture);
    if (this.textureLocation) {
      gl.uniform1i(this.textureLocation, 0);
    }

    super.draw();
  }

  public override onDestroy(): void {
    if (this.gl && this.dataTexture) {
      this.gl.deleteTexture(this.dataTexture);
    }
    super.onDestroy();
  }
}
