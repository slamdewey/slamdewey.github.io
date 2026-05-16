import { ChangeDetectionStrategy, Component, ElementRef, effect, input, model, viewChild } from '@angular/core';
import { SkeletonLoaderComponent } from '@components/skeleton-loader/skeleton-loader.component';

export interface StageImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

@Component({
  selector: 'x-stage-demo',
  templateUrl: './stage-demo.component.html',
  styleUrls: ['./stage-demo.component.scss'],
  imports: [SkeletonLoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageDemoComponent {
  imageData = input<StageImage | null>(null);
  caption = input<string>('');
  loading = input<boolean>(false);
  /** Two-way model so multiple demos can share a single pan offset. */
  panOffset = model<number>(0);

  private canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private bitmap: ImageBitmap | null = null;
  private imgWidth = 0;
  private imgHeight = 0;
  private isPanning = false;
  private panStartX = 0;
  private panBase = 0;

  constructor() {
    effect(() => {
      const data = this.imageData();
      const ref = this.canvas();
      if (!data || !ref) return;

      const el = ref.nativeElement;
      el.width = data.width;
      el.height = data.height;
      this.imgWidth = data.width;
      this.imgHeight = data.height;

      const img = new ImageData(new Uint8ClampedArray(data.rgba), data.width, data.height);
      createImageBitmap(img).then((bmp) => {
        this.bitmap?.close();
        this.bitmap = bmp;
        this.draw();
      });
    });

    // Redraw whenever the shared pan offset changes (from this demo or another).
    effect(() => {
      this.panOffset();
      this.draw();
    });
  }

  private draw(): void {
    const ref = this.canvas();
    if (!ref || !this.bitmap) return;
    const ctx = ref.nativeElement.getContext('2d');
    if (!ctx) return;

    const w = this.imgWidth;
    // Snap to integer pixels: a fractional drawImage offset anti-aliases the
    // bitmap edges, which shows up as a 1px seam at the wrap boundary.
    const ox = Math.floor(((this.panOffset() % w) + w) % w);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, this.imgHeight);
    ctx.drawImage(this.bitmap, -ox, 0);
    ctx.drawImage(this.bitmap, w - ox, 0);
  }

  onPanStart(event: PointerEvent): void {
    this.isPanning = true;
    this.panStartX = event.clientX;
    this.panBase = this.panOffset();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPanMove(event: PointerEvent): void {
    if (!this.isPanning) return;
    const el = this.canvas()?.nativeElement;
    if (!el) return;
    const dx = event.clientX - this.panStartX;
    const scale = this.imgWidth / el.clientWidth;
    this.panOffset.set(this.panBase - dx * scale);
  }

  onPanEnd(): void {
    this.isPanning = false;
  }
}
