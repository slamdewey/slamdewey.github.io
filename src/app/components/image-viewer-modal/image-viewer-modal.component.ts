import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  input,
  output,
  signal,
} from '@angular/core';
import { SpinnerComponent } from '../spinner/spinner.component';

export interface ZoomOptions {
  scale: number;
  panning: boolean;
  pointX: number;
  pointY: number;
  start: { x: number; y: number };
}

const DEFAULT_ZOOM: ZoomOptions = {
  scale: 1,
  panning: false,
  pointX: 0,
  pointY: 0,
  start: { x: 0, y: 0 },
};

const ZoomScalar = 1.2;

@Component({
  selector: 'x-image-viewer-modal',
  templateUrl: './image-viewer-modal.component.html',
  styleUrls: ['./image-viewer-modal.component.scss'],
  imports: [SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageViewerModalComponent {
  public imageSource = input<string>();
  public onOpen = output<void>();
  public onClose = output<void>();

  public isModalOpen = signal<boolean>(false);
  public shouldDisplaySpinner = signal<boolean>(false);
  public zoomOptions = signal<ZoomOptions>(DEFAULT_ZOOM);

  private resetZoomOptions() {
    this.zoomOptions.set(DEFAULT_ZOOM);
  }

  public zoomOptionsViewTransform = computed<string>(() => {
    const z = this.zoomOptions();
    return `translate(${z.pointX}px, ${z.pointY}px) scale(${z.scale}`;
  });

  public checkIfImageLoadingComplete(event: Event) {
    const element = event.target;
    if (!element || !(element instanceof HTMLImageElement)) {
      return;
    }
    const imgElement: HTMLImageElement = element;
    if (imgElement.complete && imgElement.naturalWidth !== 0) {
      this.onImageLoad();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydownHandler(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.closeModal();
    }
  }

  public onImageLoad() {
    this.shouldDisplaySpinner.set(false);
  }

  public openModal(): void {
    this.resetZoomOptions();
    this.isModalOpen.set(true);
    this.shouldDisplaySpinner.set(true);
    this.onOpen.emit();
  }

  public closeModal(): void {
    this.isModalOpen.set(false);
    this.shouldDisplaySpinner.set(false);
    this.resetZoomOptions();
    this.onClose.emit();
  }

  public zoomIn(): void {
    this.zoomOptions.update((current) => ({
      ...current,
      scale: (current.scale *= ZoomScalar),
      pointX: (current.pointX *= ZoomScalar),
      pointY: (current.pointY *= ZoomScalar),
    }));
  }

  public zoomOut(): void {
    this.zoomOptions.update((current) => ({
      ...current,
      scale: (current.scale /= ZoomScalar),
      pointX: (current.pointX /= ZoomScalar),
      pointY: (current.pointY /= ZoomScalar),
    }));
  }

  public onModalWheel(e: WheelEvent): void {
    e.preventDefault();

    if (e.deltaY < 0) {
      this.zoomIn();
    } else {
      this.zoomOut();
    }
  }

  public onModalMouseDown(e: MouseEvent): void {
    e.preventDefault();

    this.zoomOptions.update((current) => ({
      ...current,
      start: {
        x: e.clientX - current.pointX,
        y: e.clientY - current.pointY,
      },
      panning: true,
    }));
  }

  public onModalMouseUp(e: MouseEvent): void {
    e.preventDefault();

    this.zoomOptions.update((current) => ({
      ...current,
      panning: false,
    }));
  }

  public onModalMouseMove(e: MouseEvent): void {
    e.preventDefault();

    if (!this.zoomOptions().panning) {
      return;
    }

    this.zoomOptions.update((current) => ({
      ...current,
      pointX: e.clientX - current.start.x,
      pointY: e.clientY - current.start.y,
    }));
  }
}
