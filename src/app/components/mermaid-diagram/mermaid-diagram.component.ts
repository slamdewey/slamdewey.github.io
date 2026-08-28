import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  signal,
  viewChild,
} from '@angular/core';

// Module-level so mermaid is imported (and initialized) once, no matter how
// many diagrams a page renders. The dynamic import keeps the heavy library in
// its own async chunk and off any page that never shows a diagram.
let mermaidInitialized = false;
let diagramSeq = 0;

async function loadMermaid() {
  const { default: mermaid } = await import('mermaid');
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      fontFamily: 'inherit',
      themeVariables: {
        background: '#12162a',
        primaryColor: '#1a1a2e',
        primaryTextColor: '#e6e6e6',
        primaryBorderColor: '#8be9fd',
        secondaryColor: '#12213a',
        tertiaryColor: '#0b0e18',
        lineColor: '#8be9fd',
        textColor: '#e6e6e6',
        fontSize: '14px',
        // flowchart
        nodeBorder: '#8be9fd',
        mainBkg: '#1a1a2e',
        clusterBkg: 'rgba(139, 233, 253, 0.03)',
        clusterBorder: '#2a2f4a',
        edgeLabelBackground: '#12162a',
        titleColor: '#9aa0c0',
        // sequence
        actorBkg: '#1a1a2e',
        actorBorder: '#8be9fd',
        actorTextColor: '#e6e6e6',
        actorLineColor: '#2a2f4a',
        signalColor: '#c9cbe0',
        signalTextColor: '#c9cbe0',
        labelBoxBkgColor: '#1a1a2e',
        labelBoxBorderColor: '#8be9fd',
        labelTextColor: '#e6e6e6',
        loopTextColor: '#e6e6e6',
        noteBkgColor: '#12213a',
        noteTextColor: '#e6e6e6',
        noteBorderColor: '#50fa7b',
        activationBkgColor: '#2a2f4a',
        activationBorderColor: '#8be9fd',
        sequenceNumberColor: '#0b0e18',
      },
    });
    mermaidInitialized = true;
  }
  return mermaid;
}

/**
 * Renders a Mermaid diagram from a text `definition` and wraps it in a
 * draw.io-style pannable / zoomable viewport (drag to pan, wheel or buttons to
 * zoom). Mermaid is loaded lazily and rendered browser-side only.
 *
 * Zoom re-sizes the SVG (`width`/`height`) so it stays vector-crisp at any
 * scale; panning is a CSS translate. Using `transform: scale()` for zoom would
 * rasterize the SVG once and stretch the bitmap — blurry — so we avoid it.
 */
@Component({
  selector: 'x-mermaid-diagram',
  templateUrl: './mermaid-diagram.component.html',
  styleUrls: ['./mermaid-diagram.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MermaidDiagramComponent {
  readonly definition = input.required<string>();
  readonly caption = input<string>('');

  private readonly viewport = viewChild.required<ElementRef<HTMLDivElement>>('viewport');
  private readonly canvas = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

  readonly errored = signal(false);

  private static readonly MIN_SCALE = 0.2;
  private static readonly MAX_SCALE = 5;
  private static readonly FIT_PADDING_PX = 32;

  private svg: SVGSVGElement | null = null;
  private naturalWidth = 0;
  private naturalHeight = 0;

  private scale = 1;
  private tx = 0;
  private ty = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor() {
    afterNextRender(() => this.render());
  }

  private async render(): Promise<void> {
    try {
      const mermaid = await loadMermaid();
      const { svg } = await mermaid.render(`mmd-${diagramSeq++}`, this.definition());
      const host = this.canvas().nativeElement;
      host.innerHTML = svg;

      const el = host.querySelector('svg');
      if (!el) return;

      // Take the intrinsic size from the viewBox, then drop mermaid's own
      // width/height/max-width so our zoom sizing is the only thing driving it.
      const box = el.viewBox.baseVal;
      this.naturalWidth = box && box.width ? box.width : el.getBoundingClientRect().width;
      this.naturalHeight = box && box.height ? box.height : el.getBoundingClientRect().height;
      el.removeAttribute('style');
      el.style.display = 'block';
      el.style.maxWidth = 'none';
      this.svg = el;

      this.fitToViewport();
    } catch (err) {
      console.error('Mermaid render failed', err);
      this.errored.set(true);
    }
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomAround(e.clientX - rect.left, e.clientY - rect.top, factor);
  }

  onPointerDown(e: PointerEvent): void {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.viewport().nativeElement.setPointerCapture(e.pointerId);
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    this.tx += e.clientX - this.lastX;
    this.ty += e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.applyTransform();
  }

  onPointerUp(): void {
    this.dragging = false;
  }

  zoomByButton(factor: number): void {
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    this.zoomAround(rect.width / 2, rect.height / 2, factor);
  }

  reset(): void {
    this.fitToViewport();
  }

  /** Scale the diagram to fit the viewport and center it. */
  private fitToViewport(): void {
    if (!this.naturalWidth || !this.naturalHeight) return;
    const rect = this.viewport().nativeElement.getBoundingClientRect();
    const fit = Math.min(
      (rect.width - MermaidDiagramComponent.FIT_PADDING_PX) / this.naturalWidth,
      (rect.height - MermaidDiagramComponent.FIT_PADDING_PX) / this.naturalHeight
    );
    this.scale = this.clampScale(fit);
    this.tx = (rect.width - this.naturalWidth * this.scale) / 2;
    this.ty = (rect.height - this.naturalHeight * this.scale) / 2;
    this.applyTransform();
  }

  private zoomAround(px: number, py: number, factor: number): void {
    const next = this.clampScale(this.scale * factor);
    const k = next / this.scale;
    // Keep the point under the cursor visually fixed while scaling.
    this.tx = px - k * (px - this.tx);
    this.ty = py - k * (py - this.ty);
    this.scale = next;
    this.applyTransform();
  }

  private clampScale(s: number): number {
    return Math.min(MermaidDiagramComponent.MAX_SCALE, Math.max(MermaidDiagramComponent.MIN_SCALE, s));
  }

  private applyTransform(): void {
    if (this.svg) {
      // Re-size the SVG itself so it re-rasterizes crisply at the new scale.
      this.svg.style.width = `${this.naturalWidth * this.scale}px`;
      this.svg.style.height = `${this.naturalHeight * this.scale}px`;
    }
    // Panning only — translate never blurs.
    this.canvas().nativeElement.style.transform = `translate(${this.tx}px, ${this.ty}px)`;
  }
}
