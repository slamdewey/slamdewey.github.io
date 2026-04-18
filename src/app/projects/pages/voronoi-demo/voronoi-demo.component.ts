import { ChangeDetectionStrategy, Component, ElementRef, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatSliderModule } from '@angular/material/slider';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { BannerComponent } from '@components/banner/banner.component';
import { CodeBlockComponent } from '@components/code-block/code-block.component';
import { generateVoronoi, voronoiToRGBA, buildVoronoiGraph, VoronoiConfig } from '@lib/voronoi';

/** Shared dimensions for section demos. */
const DEMO_W = 600;
const DEMO_H = 450;
const DEMO_SEED = 42;
const DEMO_COUNT = 12;

@Component({
  selector: 'x-voronoi-demo',
  templateUrl: './voronoi-demo.component.html',
  styleUrls: ['./voronoi-demo.component.scss'],
  imports: [
    BannerComponent,
    CodeBlockComponent,
    FormsModule,
    MatSliderModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatCheckboxModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoronoiDemoComponent {
  // --- Code snippets (real code from @lib/voronoi.ts) ---

  readonly codeXorshift = `function xorshift32(state: { s: number }): number {
  let s = state.s;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  state.s = s;
  return (s >>> 0) / 0xffffffff;
}`;

  readonly codeGenerateSeeds = `function generateSeeds(config: VoronoiConfig): VoronoiSeed[] {
  const rng = { s: config.seed | 1 };
  const seeds: VoronoiSeed[] = [];
  for (let i = 0; i < config.seedCount; i++) {
    seeds.push({
      x: xorshift32(rng) * config.width,
      y: xorshift32(rng) * config.height,
    });
  }
  return seeds;
}`;

  readonly codeDist = `function dist(
  ax: number, ay: number,
  bx: number, by: number,
  width: number, wrapX: boolean
): number {
  let dx = ax - bx;
  if (wrapX) {
    if (dx > width / 2) dx -= width;
    else if (dx < -width / 2) dx += width;
  }
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}`;

  readonly codeAssignLoop = `for (let i = 0; i < n; i++) {
  const d = dist(x, y, seeds[i].x, seeds[i].y, width, wrapX);
  if (d < minDist) {
    minDist = d;
    closest = i;
  }
}
cells[idx] = closest;`;

  readonly codeCentroid = `const RELAXATION_FACTOR = 0.5;

// Compute centroids
const sumX = new Float64Array(current.length);
const sumY = new Float64Array(current.length);
const counts = new Int32Array(current.length);

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const cell = cells[y * width + x];
    counts[cell]++;
    sumX[cell] += x;
    sumY[cell] += y;
  }
}

// Partial relaxation: lerp toward centroid
for (let i = 0; i < current.length; i++) {
  if (counts[i] === 0) continue;
  const cx = sumX[i] / counts[i];
  const cy = sumY[i] / counts[i];
  current[i].x += (cx - current[i].x) * RELAXATION_FACTOR;
  current[i].y += (cy - current[i].y) * RELAXATION_FACTOR;
}`;

  readonly codeWrapDist = `let dx = ax - bx;
if (wrapX) {
  if (dx > width / 2) dx -= width;
  else if (dx < -width / 2) dx += width;
}`;

  readonly codeWrapCentroid = `// Circular averaging for wrapped x-axis
const angle = (x / width) * TWO_PI;
sinSum[cell] += Math.sin(angle);
cosSum[cell] += Math.cos(angle);

// Reconstruct x from averaged angle
const avgAngle = Math.atan2(sinSum[i], cosSum[i]);
current[i].x = mod((avgAngle / TWO_PI) * width, width);`;

  readonly codeGraph = `interface VoronoiEdge {
  cellA: number;
  cellB: number;
  length: number;  // shared boundary pixels
}

interface VoronoiGraph {
  neighbors: number[][];  // per-cell neighbor list
  edges: VoronoiEdge[];
}`;

  readonly codeGraphBuild = `for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const cell = cells[y * width + x];

    // Check right neighbor (with wrap support)
    const right = x < width - 1
      ? cells[y * width + x + 1]
      : wrapX ? cells[y * width] : cell;
    if (right !== cell) addEdge(cell, right);

    // Check bottom neighbor
    if (y < height - 1) {
      const below = cells[(y + 1) * width + x];
      if (below !== cell) addEdge(cell, below);
    }
  }
}`;

  // --- Full playground ---
  private playgroundCanvas = viewChild<ElementRef<HTMLCanvasElement>>('playgroundCanvas');
  pgWidth = signal(1024);
  pgHeight = signal(512);
  pgSeedCount = signal(12);
  pgSeed = signal(42);
  pgRelaxation = signal(3);
  pgWrapX = signal(true);
  pgShowBoundaries = signal(true);
  pgShowSeeds = signal(true);
  pgShowGraph = signal(false);

  // Pan state for playground (only active when wrapX is on)
  private pgOffscreen: HTMLCanvasElement | null = null;
  private isPanning = false;
  private panStartX = 0;
  private panBase = 0;
  private panOffset = 0;

  // --- Section 1: Seeds ---
  private seedsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('seedsCanvas');
  s1Count = signal(DEMO_COUNT);

  // --- Section 2: Nearest-neighbor ---
  private nnCanvas = viewChild<ElementRef<HTMLCanvasElement>>('nnCanvas');

  // --- Section 3: Lloyd relaxation ---
  private relaxCanvas = viewChild<ElementRef<HTMLCanvasElement>>('relaxCanvas');
  s3Iterations = signal(0);

  private wrapOnCanvas = viewChild<ElementRef<HTMLCanvasElement>>('wrapOnCanvas');
  private wrapOffCanvas = viewChild<ElementRef<HTMLCanvasElement>>('wrapOffCanvas');
  private wrapOffscreen: HTMLCanvasElement | null = null;
  private isWrapPanning = false;
  private wrapPanStartX = 0;
  private wrapPanBase = 0;
  private wrapPanOffset = 0;

  // --- Section 5: Cell adjacency graph ---
  private graphCanvas = viewChild<ElementRef<HTMLCanvasElement>>('graphCanvas');
  private graphOffscreen: HTMLCanvasElement | null = null;
  private isGraphPanning = false;
  private graphPanStartX = 0;
  private graphPanBase = 0;
  private graphPanOffset = 0;

  constructor() {
    setTimeout(() => this.generateAll(), 0);
  }

  randomizeSeed(): void {
    this.pgSeed.set(Math.floor(Math.random() * 2147483647));
  }

  generateAll(): void {
    this.generatePlayground();
    this.generateSeeds();
    this.generateNearestNeighbor();
    this.generateRelaxation();
    this.generateWrapping();
    this.generateGraph();
  }

  // --- Full playground ---

  generatePlayground(): void {
    const ref = this.playgroundCanvas();
    if (!ref) return;

    const config: VoronoiConfig = {
      width: this.pgWidth(),
      height: this.pgHeight(),
      seedCount: this.pgSeedCount(),
      seed: this.pgSeed(),
      relaxationIterations: this.pgRelaxation(),
      wrapX: this.pgWrapX(),
    };

    const result = generateVoronoi(config);
    const rgba = voronoiToRGBA(result, config.width, config.height, this.pgShowBoundaries());

    // Render to an offscreen canvas first (for pan support)
    const offscreen = document.createElement('canvas');
    offscreen.width = config.width;
    offscreen.height = config.height;
    const offCtx = offscreen.getContext('2d')!;
    offCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), config.width, config.height), 0, 0);

    if (this.pgShowGraph()) {
      const graph = buildVoronoiGraph(result.cells, config.width, config.height, config.seedCount, config.wrapX);
      offCtx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      offCtx.lineWidth = 1.5;
      for (const edge of graph.edges) {
        const a = result.seeds[edge.cellA];
        const b = result.seeds[edge.cellB];
        if (config.wrapX) {
          let dx = b.x - a.x;
          if (dx > config.width / 2) dx -= config.width;
          else if (dx < -config.width / 2) dx += config.width;
          const bxW = a.x + dx;
          if (bxW < 0 || bxW >= config.width) {
            const t = bxW < 0 ? -a.x / dx : (config.width - a.x) / dx;
            const seam = bxW < 0 ? 0 : config.width;
            const midY = a.y + (b.y - a.y) * t;
            offCtx.beginPath();
            offCtx.moveTo(a.x, a.y);
            offCtx.lineTo(seam, midY);
            offCtx.stroke();
            offCtx.beginPath();
            offCtx.moveTo(config.width - seam, midY);
            offCtx.lineTo(b.x, b.y);
            offCtx.stroke();
          } else {
            offCtx.beginPath();
            offCtx.moveTo(a.x, a.y);
            offCtx.lineTo(bxW, b.y);
            offCtx.stroke();
          }
        } else {
          offCtx.beginPath();
          offCtx.moveTo(a.x, a.y);
          offCtx.lineTo(b.x, b.y);
          offCtx.stroke();
        }
      }
    }

    if (this.pgShowSeeds()) {
      offCtx.fillStyle = '#fff';
      offCtx.strokeStyle = '#000';
      offCtx.lineWidth = 1.5;
      for (const seed of result.seeds) {
        offCtx.beginPath();
        offCtx.arc(seed.x, seed.y, 3, 0, Math.PI * 2);
        offCtx.fill();
        offCtx.stroke();
      }
    }

    this.pgOffscreen = offscreen;
    this.panOffset = 0;
    this.renderPlayground();
  }

  private renderPlayground(): void {
    const ref = this.playgroundCanvas();
    if (!ref || !this.pgOffscreen) return;

    const el = ref.nativeElement;
    const w = this.pgOffscreen.width;
    const h = this.pgOffscreen.height;
    // Only resize canvas when dimensions change — resizing on every frame
    // clears the buffer and forces reallocation, which causes lag.
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    const ctx = el.getContext('2d')!;

    if (this.pgWrapX() && this.panOffset !== 0) {
      // Draw with horizontal wrapping: two drawImage calls
      const px = ((this.panOffset % w) + w) % w;
      ctx.drawImage(this.pgOffscreen, px, 0, w - px, h, 0, 0, w - px, h);
      if (px > 0) {
        ctx.drawImage(this.pgOffscreen, 0, 0, px, h, w - px, 0, px, h);
      }
    } else {
      ctx.drawImage(this.pgOffscreen, 0, 0);
    }
  }

  // --- Pan controls for playground ---

  onPanStart(event: PointerEvent): void {
    if (!this.pgWrapX()) return;
    this.isPanning = true;
    this.panStartX = event.clientX;
    this.panBase = this.panOffset;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPanMove(event: PointerEvent): void {
    if (!this.isPanning || !this.pgOffscreen) return;
    const target = event.currentTarget as HTMLElement;
    const scale = this.pgOffscreen.width / target.clientWidth;
    this.panOffset = this.panBase - (event.clientX - this.panStartX) * scale;
    this.renderPlayground();
  }

  onPanEnd(): void {
    this.isPanning = false;
  }

  // --- Section 1: Seed placement ---

  generateSeeds(): void {
    const ref = this.seedsCanvas();
    if (!ref) return;

    const el = ref.nativeElement;
    el.width = DEMO_W;
    el.height = DEMO_H;
    const ctx = el.getContext('2d')!;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, DEMO_W, DEMO_H);

    const result = generateVoronoi({
      width: DEMO_W,
      height: DEMO_H,
      seedCount: this.s1Count(),
      seed: DEMO_SEED,
      relaxationIterations: 0,
      wrapX: false,
    });

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    for (const seed of result.seeds) {
      ctx.beginPath();
      ctx.arc(seed.x, seed.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // --- Section 2: Nearest-neighbor assignment ---

  generateNearestNeighbor(): void {
    const ref = this.nnCanvas();
    if (!ref) return;

    const result = generateVoronoi({
      width: DEMO_W,
      height: DEMO_H,
      seedCount: DEMO_COUNT,
      seed: DEMO_SEED,
      relaxationIterations: 0,
      wrapX: false,
    });

    const rgba = voronoiToRGBA(result, DEMO_W, DEMO_H, true);
    this.renderToCanvas(ref, rgba, DEMO_W, DEMO_H);
    this.drawSeeds(ref, result.seeds);
  }

  // --- Section 3: Lloyd relaxation ---

  generateRelaxation(): void {
    const ref = this.relaxCanvas();
    if (!ref) return;

    const result = generateVoronoi({
      width: DEMO_W,
      height: DEMO_H,
      seedCount: DEMO_COUNT,
      seed: DEMO_SEED,
      relaxationIterations: this.s3Iterations(),
      wrapX: false,
    });

    const rgba = voronoiToRGBA(result, DEMO_W, DEMO_H, true);
    this.renderToCanvas(ref, rgba, DEMO_W, DEMO_H);
    this.drawSeeds(ref, result.seeds);
  }

  // --- Section 4: Wrapping ---

  generateWrapping(): void {
    const configBase: VoronoiConfig = {
      width: DEMO_W,
      height: DEMO_H,
      seedCount: 8,
      seed: DEMO_SEED,
      relaxationIterations: 3,
      wrapX: false,
    };

    const offRef = this.wrapOffCanvas();
    if (offRef) {
      const result = generateVoronoi(configBase);
      const rgba = voronoiToRGBA(result, DEMO_W, DEMO_H, true);
      this.renderToCanvas(offRef, rgba, DEMO_W, DEMO_H);
    }

    const onRef = this.wrapOnCanvas();
    if (onRef) {
      const result = generateVoronoi({ ...configBase, wrapX: true });
      const rgba = voronoiToRGBA(result, DEMO_W, DEMO_H, true);

      // Render to offscreen canvas for pan support
      const offscreen = document.createElement('canvas');
      offscreen.width = DEMO_W;
      offscreen.height = DEMO_H;
      const offCtx = offscreen.getContext('2d')!;
      offCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), DEMO_W, DEMO_H), 0, 0);
      this.wrapOffscreen = offscreen;
      this.wrapPanOffset = 0;
      this.renderWrapOn();
    }
  }

  private renderWrapOn(): void {
    const ref = this.wrapOnCanvas();
    if (!ref || !this.wrapOffscreen) return;

    const el = ref.nativeElement;
    const w = this.wrapOffscreen.width;
    const h = this.wrapOffscreen.height;
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    const ctx = el.getContext('2d')!;

    if (this.wrapPanOffset !== 0) {
      const px = ((this.wrapPanOffset % w) + w) % w;
      ctx.drawImage(this.wrapOffscreen, px, 0, w - px, h, 0, 0, w - px, h);
      if (px > 0) {
        ctx.drawImage(this.wrapOffscreen, 0, 0, px, h, w - px, 0, px, h);
      }
    } else {
      ctx.drawImage(this.wrapOffscreen, 0, 0);
    }
  }

  onWrapPanStart(event: PointerEvent): void {
    this.isWrapPanning = true;
    this.wrapPanStartX = event.clientX;
    this.wrapPanBase = this.wrapPanOffset;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onWrapPanMove(event: PointerEvent): void {
    if (!this.isWrapPanning || !this.wrapOffscreen) return;
    const target = event.currentTarget as HTMLElement;
    const scale = this.wrapOffscreen.width / target.clientWidth;
    this.wrapPanOffset = this.wrapPanBase - (event.clientX - this.wrapPanStartX) * scale;
    this.renderWrapOn();
  }

  onWrapPanEnd(): void {
    this.isWrapPanning = false;
  }

  // --- Section 5: Cell adjacency graph ---

  generateGraph(): void {
    const ref = this.graphCanvas();
    if (!ref) return;

    const config: VoronoiConfig = {
      width: DEMO_W,
      height: DEMO_H,
      seedCount: DEMO_COUNT,
      seed: DEMO_SEED,
      relaxationIterations: 3,
      wrapX: true,
    };

    const result = generateVoronoi(config);
    const graph = buildVoronoiGraph(result.cells, DEMO_W, DEMO_H, DEMO_COUNT, true);

    // Render cells to offscreen canvas, then overlay graph
    const rgba = voronoiToRGBA(result, DEMO_W, DEMO_H, true);
    const offscreen = document.createElement('canvas');
    offscreen.width = DEMO_W;
    offscreen.height = DEMO_H;
    const ctx = offscreen.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), DEMO_W, DEMO_H), 0, 0);

    // Draw edges — wrap-aware: if the shortest path crosses the seam,
    // draw two line segments (one at each edge of the canvas).
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    for (const edge of graph.edges) {
      const a = result.seeds[edge.cellA];
      const b = result.seeds[edge.cellB];
      let dx = b.x - a.x;
      if (dx > DEMO_W / 2) dx -= DEMO_W;
      else if (dx < -DEMO_W / 2) dx += DEMO_W;
      const bxWrapped = a.x + dx;

      if (bxWrapped < 0 || bxWrapped >= DEMO_W) {
        // Edge crosses the seam — draw two segments
        const t =
          bxWrapped < 0
            ? -a.x / dx // fraction where line hits x=0
            : (DEMO_W - a.x) / dx; // fraction where line hits x=width
        const seam = bxWrapped < 0 ? 0 : DEMO_W;
        const midY = a.y + (b.y - a.y) * t;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(seam, midY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(DEMO_W - seam, midY);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(bxWrapped, b.y);
        ctx.stroke();
      }
    }

    // Draw seed nodes
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    for (const seed of result.seeds) {
      ctx.beginPath();
      ctx.arc(seed.x, seed.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    this.graphOffscreen = offscreen;
    this.graphPanOffset = 0;
    this.renderGraph();
  }

  private renderGraph(): void {
    const ref = this.graphCanvas();
    if (!ref || !this.graphOffscreen) return;

    const el = ref.nativeElement;
    const w = this.graphOffscreen.width;
    const h = this.graphOffscreen.height;
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    const ctx = el.getContext('2d')!;

    if (this.graphPanOffset !== 0) {
      const px = ((this.graphPanOffset % w) + w) % w;
      ctx.drawImage(this.graphOffscreen, px, 0, w - px, h, 0, 0, w - px, h);
      if (px > 0) {
        ctx.drawImage(this.graphOffscreen, 0, 0, px, h, w - px, 0, px, h);
      }
    } else {
      ctx.drawImage(this.graphOffscreen, 0, 0);
    }
  }

  onGraphPanStart(event: PointerEvent): void {
    this.isGraphPanning = true;
    this.graphPanStartX = event.clientX;
    this.graphPanBase = this.graphPanOffset;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onGraphPanMove(event: PointerEvent): void {
    if (!this.isGraphPanning || !this.graphOffscreen) return;
    const target = event.currentTarget as HTMLElement;
    const scale = this.graphOffscreen.width / target.clientWidth;
    this.graphPanOffset = this.graphPanBase - (event.clientX - this.graphPanStartX) * scale;
    this.renderGraph();
  }

  onGraphPanEnd(): void {
    this.isGraphPanning = false;
  }

  // --- Shared rendering helpers ---

  private renderToCanvas(ref: ElementRef<HTMLCanvasElement>, rgba: Uint8Array, w: number, h: number): void {
    const el = ref.nativeElement;
    el.width = w;
    el.height = h;
    const ctx = el.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  }

  private drawSeeds(ref: ElementRef<HTMLCanvasElement>, seeds: { x: number; y: number }[]): void {
    const ctx = ref.nativeElement.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    for (const seed of seeds) {
      ctx.beginPath();
      ctx.arc(seed.x, seed.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
