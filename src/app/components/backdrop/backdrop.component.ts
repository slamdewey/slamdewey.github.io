import {
  Component,
  ViewEncapsulation,
  ElementRef,
  HostListener,
  OnDestroy,
  input,
  viewChild,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { Backdrop } from './backdrop';
import { Vector2 } from 'src/app/shapes/coordinate';

@Component({
  selector: 'x-backdrop',
  templateUrl: './backdrop.component.html',
  styleUrls: ['./backdrop.component.scss'],
  encapsulation: ViewEncapsulation.Emulated,
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackdropComponent implements OnDestroy {
  backdrop = input.required<Backdrop>();
  shouldPauseAnimation = input<boolean>(false);
  fullscreen = input<boolean>(false);

  bgCanvas = viewChild.required<ElementRef>('bgCanvas');

  public isResizing = signal<boolean>(false);
  private resizeEventTimeout: any | undefined;
  private isInitialized: boolean = false;

  public static isWebGlEnabled: boolean;

  private canvasBufferSize = new Vector2();
  private canvasElement: HTMLCanvasElement;
  private ctx: RenderingContext;
  private renderInterval: number;
  private resizeObserver: ResizeObserver;

  constructor() {
    const e = document.createElement('canvas');
    BackdropComponent.isWebGlEnabled =
      !!window.WebGLRenderingContext ||
      !!e.getContext('webgl') ||
      !!e.getContext('experimental-webgl');
    e.remove();
  }

  ngAfterViewInit(): void {
    const backdrop = this.backdrop();
    const contextId = backdrop.contextId();
    this.canvasElement = this.bgCanvas().nativeElement;

    const context = this.canvasElement.getContext(contextId);
    if (!context) {
      throw new Error(`Failed to create context: ${contextId}`);
    }
    this.ctx = context;

    backdrop.initializeContext(this.ctx);

    this.resizeObserver = new ResizeObserver(this.onResize.bind(this));
    this.resizeObserver.observe(
      this.fullscreen() ? this.canvasElement : this.canvasElement.parentElement!
    );

    this.renderInterval = window.requestAnimationFrame(this.renderLoop.bind(this));
  }

  ngOnDestroy() {
    window.cancelAnimationFrame(this.renderInterval);
    this.resizeObserver?.disconnect();
    this.backdrop().onDestroy();
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(e: MouseEvent) {
    const backdrop = this.backdrop();
    const rect = this.bgCanvas().nativeElement.getBoundingClientRect();
    backdrop.mousePosition.set([e.clientX - rect.left, rect.height - (e.clientY - rect.top)]);
  }

  @HostListener('window:scroll', ['$event'])
  onScroll() {
    const backdrop = this.backdrop();
    const deltaOffset = new Vector2(
      window.scrollX - backdrop.scrollOffset.x,
      window.scrollY - backdrop.scrollOffset.y
    );
    backdrop.mousePosition = Vector2.minus(backdrop.mousePosition, deltaOffset);
    backdrop.scrollOffset.set([window.scrollX, window.scrollY]);
  }

  public renderLoop(): void {
    this.renderInterval = window.requestAnimationFrame(this.renderLoop.bind(this));
    if (this.shouldPauseAnimation() || this.isResizing()) {
      return;
    }
    this.backdrop().clear();
    this.backdrop().tick();
  }

  private updateBufferSizeAndReinitialize(newWidth: number, newHeight: number) {
    const backdrop = this.backdrop();
    const canvas = this.ctx.canvas;
    this.canvasBufferSize.set([newWidth, newHeight]);
    [canvas.width, canvas.height] = [newWidth, newHeight];

    backdrop.setSize(newWidth, newHeight);
    backdrop.initialize();
    this.isInitialized = true;
  }

  private onResize(entries: ResizeObserverEntry[]) {
    let newWidth: number, newHeight: number;

    if (this.fullscreen()) {
      newWidth = window.innerWidth;
      newHeight = window.innerHeight;
    } else {
      newWidth = entries[0].contentRect.width;
      newHeight = entries[0].contentRect.height;
    }

    /**
     * ensure we actually resized and should disable rendering
     */
    if (newWidth === this.canvasBufferSize.x && newHeight === this.canvasBufferSize.y) {
      return;
    }

    /**
     * A resize event happens upon this components creation,
     * for this first event we only want to initialize the
     * backdrop.  We don't want to stop rendering
     */
    if (this.isInitialized) {
      // reset any existing timeouts
      if (this.resizeEventTimeout) {
        clearTimeout(this.resizeEventTimeout);
      }
      this.isResizing.set(true);
      // start new timer
      this.resizeEventTimeout = setTimeout(() => {
        this.updateBufferSizeAndReinitialize(newWidth, newHeight);
        this.isResizing.set(false);
        this.resizeEventTimeout = undefined;
      }, 300);
    } else {
      this.updateBufferSizeAndReinitialize(newWidth, newHeight);
    }
  }
}
