import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  model,
  viewChild,
} from '@angular/core';
import { SphereView } from '@lib/sphere-view';

export interface SphereViewTexture {
  rgba: Uint8Array;
  width: number;
  height: number;
}

@Component({
  selector: 'x-sphere-view',
  templateUrl: './sphere-view.component.html',
  styleUrl: './sphere-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SphereViewComponent implements AfterViewInit, OnDestroy {
  texture = input<SphereViewTexture | null>(null);
  size = input<number>(512);
  rotLon = model<number>(0);
  rotLat = model<number>(0);
  /**
   * When `true`, the component skips its built-in drag-to-rotate handlers and
   * the parent is expected to drive `rotLon` / `rotLat` directly. Useful when
   * the parent ties the sphere's rotation to other shared state (e.g. a pan
   * offset shared with cylindrical panels).
   */
  manualDrag = input<boolean>(false);

  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('glCanvas');
  private view: SphereView | null = null;

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragBaseLon = 0;
  private dragBaseLat = 0;

  constructor() {
    effect(() => {
      const tex = this.texture();
      if (!tex || !this.view) return;
      this.view.uploadEquirect(tex.rgba, tex.width, tex.height);
      this.view.render(this.rotLon(), this.rotLat());
    });
    effect(() => {
      this.rotLon();
      this.rotLat();
      if (!this.view || !this.texture()) return;
      this.view.render(this.rotLon(), this.rotLat());
    });
    effect(() => {
      const s = this.size();
      this.view?.setSize(s);
      const tex = this.texture();
      if (this.view && tex) this.view.render(this.rotLon(), this.rotLat());
    });
  }

  ngAfterViewInit(): void {
    try {
      this.view = new SphereView(this.canvasRef().nativeElement);
      this.view.setSize(this.size());
      const tex = this.texture();
      if (tex) {
        this.view.uploadEquirect(tex.rgba, tex.width, tex.height);
        this.view.render(this.rotLon(), this.rotLat());
      }
    } catch {
      this.view = null;
    }
  }

  ngOnDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  onRotateStart(e: PointerEvent): void {
    if (this.manualDrag()) return;
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragBaseLon = this.rotLon();
    this.dragBaseLat = this.rotLat();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  onRotateMove(e: PointerEvent): void {
    if (this.manualDrag() || !this.dragging) return;
    const target = e.currentTarget as HTMLElement;
    const scale = Math.PI / target.clientWidth;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    this.rotLon.set(this.dragBaseLon - dx * scale);
    const limit = Math.PI / 2 - 0.001;
    let lat = this.dragBaseLat + dy * scale;
    if (lat > limit) lat = limit;
    else if (lat < -limit) lat = -limit;
    this.rotLat.set(lat);
  }

  onRotateEnd(e: PointerEvent): void {
    if (this.manualDrag()) return;
    this.dragging = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }
}
