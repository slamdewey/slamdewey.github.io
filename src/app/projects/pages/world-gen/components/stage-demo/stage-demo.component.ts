import { ChangeDetectionStrategy, Component, ElementRef, effect, input, viewChild } from '@angular/core';

export interface StageImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

@Component({
  selector: 'x-stage-demo',
  templateUrl: './stage-demo.component.html',
  styleUrls: ['./stage-demo.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageDemoComponent {
  imageData = input<StageImage | null>(null);
  caption = input<string>('');

  private canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    effect(() => {
      const data = this.imageData();
      const ref = this.canvas();
      if (!data || !ref) return;

      const el = ref.nativeElement;
      el.width = data.width;
      el.height = data.height;
      const ctx = el.getContext('2d');
      if (!ctx) return;

      const img = new ImageData(new Uint8ClampedArray(data.rgba), data.width, data.height);
      ctx.putImageData(img, 0, 0);
    });
  }
}
