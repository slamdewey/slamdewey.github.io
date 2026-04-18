import { Backdrop } from '@components/backdrop/backdrop';
import { generateVoronoi, voronoiToRGBA } from '@lib/voronoi';

/**
 * A simple 2D canvas backdrop that renders a static Voronoi tessellation.
 * Used as the tile thumbnail on the projects page.
 */
export class VoronoiBackdrop extends Backdrop {
  private imageData: ImageData | null = null;

  protected update(_deltaTime: number): void {}

  public override initialize(): void {
    this.regenerate();
  }

  public override setSize(width: number, height: number): void {
    super.setSize(width, height);
    if (this.ctx) {
      this.regenerate();
    }
  }

  private regenerate(): void {
    if (!this.width || !this.height) return;

    const result = generateVoronoi({
      width: this.width,
      height: this.height,
      seedCount: 14,
      noiseSeed: 42,
      noiseAmplitude: 40,
      noiseFrequency: 0.02,
      relaxationIterations: 3,
      wrapX: false,
    });

    const rgba = voronoiToRGBA(result, this.width, this.height, true);
    this.imageData = new ImageData(new Uint8ClampedArray(rgba), this.width, this.height);
  }

  protected draw(): void {
    if (!this.imageData) return;
    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
