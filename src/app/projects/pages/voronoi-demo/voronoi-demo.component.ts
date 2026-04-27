import { ChangeDetectionStrategy, Component, ElementRef, effect, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSliderModule } from '@angular/material/slider';
import { BannerComponent } from '@components/banner/banner.component';
import { CodeBlockComponent } from '@components/code-block/code-block.component';
import { SphereViewComponent, SphereViewTexture } from '@components/sphere-view/sphere-view.component';
import {
  buildVoronoiGraph,
  generateSeeds,
  generateVoronoi,
  VoronoiConfig,
  VoronoiEdge,
  VoronoiResult,
  VoronoiSeed,
  voronoiToRGBA,
} from '@lib/voronoi';
import {
  generateSphereVoronoi,
  sphereVoronoiToEquirectRGBA,
  sphereVoronoiToMercatorRGBA,
  SphereVoronoiResult,
  Vec3,
  vec3ToMercator,
  vec3ToView,
} from '@lib/voronoi-sphere';

const DEMO_W = 600;
const DEMO_H = 450;
const DEMO_SEED = 42;
const DEMO_COUNT = 12;

const S1_MIN = 2;
const S1_MAX = 30;
const S2_MIN = 0;
const S2_MAX = 10;

const S5_MIN = 8;
const S5_MAX = 32;
const S5_STEP = 4;
const S5_GRID_W = 360;
const S5_GRID_H = 180;
const S5_MERC_W = 1200;
const S5_MERC_H = 600;
const S5_EQUIRECT_W = 1200;
const S5_EQUIRECT_H = 600;
const S5_SPHERE_SIZE = 500;
const S5_RELAX = 3;

interface SphereVariant {
  result: SphereVoronoiResult;
  mercator: HTMLCanvasElement;
  equirect: SphereViewTexture;
  edges: VoronoiEdge[];
}

@Component({
  selector: 'x-voronoi-demo',
  templateUrl: './voronoi-demo.component.html',
  styleUrls: ['./voronoi-demo.component.scss'],
  imports: [
    BannerComponent,
    CodeBlockComponent,
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSliderModule,
    SphereViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoronoiDemoComponent {
  readonly s1Min = S1_MIN;
  readonly s1Max = S1_MAX;
  readonly s2Min = S2_MIN;
  readonly s2Max = S2_MAX;
  readonly s5Min = S5_MIN;
  readonly s5Max = S5_MAX;
  readonly s5Step = S5_STEP;
  readonly s5SphereSize = S5_SPHERE_SIZE;

  // --- Code snippets ---

  readonly codeSeeds = `// Deterministic xorshift32 PRNG — same seed in, same points out.
function rand(state: { s: number }): number {
  let s = state.s;
  s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
  state.s = s;
  return (s >>> 0) / 0xffffffff;
}

for (let i = 0; i < seedCount; i++) {
  seeds.push({ x: rand(rng) * width, y: rand(rng) * height });
}`;

  readonly codeAssign = `// Every pixel claims its nearest seed. O(W·H·N) — brute force is plenty
// fast at the resolutions we render here, and it generalizes trivially to
// any distance metric (cylindrical wrap, great-circle, weighted, ...).
let minDist = Infinity, closest = 0;
for (let i = 0; i < n; i++) {
  const dx = x - seeds[i].x;
  const dy = y - seeds[i].y;
  const d = dx * dx + dy * dy;
  if (d < minDist) { minDist = d; closest = i; }
}
cells[y * width + x] = closest;`;

  readonly codeRelax = `// Lloyd relaxation: lerp each seed toward its cell's centroid.
// Partial step (×0.5) gives a smooth slider feel rather than snap-to-converged.
for (let i = 0; i < seeds.length; i++) {
  if (counts[i] === 0) continue;
  const cx = sumX[i] / counts[i];
  const cy = sumY[i] / counts[i];
  seeds[i].x += (cx - seeds[i].x) * 0.5;
  seeds[i].y += (cy - seeds[i].y) * 0.5;
}`;

  readonly codeWrapCylindrical = `// Cylindrical x-distance: take the shorter route around the seam.
let dx = ax - bx;
if (dx >  width / 2) dx -= width;
else if (dx < -width / 2) dx += width;
return Math.sqrt(dx * dx + (ay - by) ** 2);

// The centroid pass also has to wrap. Plain averaging breaks at the seam,
// so we average the angles in sin/cos space instead:
const angle = (x / width) * 2 * Math.PI;
sinSum[cell] += Math.sin(angle);
cosSum[cell] += Math.cos(angle);
// ...later: centroidX = atan2(sinSum, cosSum) / (2π) · width`;

  readonly codeWrapSphere = `// Cells live on the unit sphere — distance is great-circle (arccos of dot).
// Since arccos is monotonic, max dot-product is enough; no trig in the loop.
let maxDot = -Infinity, closest = 0;
for (let i = 0; i < n; i++) {
  const d = p.x * seeds[i].x + p.y * seeds[i].y + p.z * seeds[i].z;
  if (d > maxDot) { maxDot = d; closest = i; }
}

// Spherical Lloyd: average the cell's points in 3D, then renormalize back
// to the unit sphere. Equirect rows weighted by cos(lat) to undo the
// pinching toward the poles.`;

  readonly codeGraph = `// One scan over the cell grid — any neighbor mismatch is a dual-graph edge.
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const cell = cells[y * width + x];
    const right = x < width - 1 ? cells[y * width + x + 1]
                : wrapX         ? cells[y * width]   // x-wrap to col 0
                                : cell;
    const below = y < height - 1 ? cells[(y + 1) * width + x] : cell;
    if (right !== cell) addEdge(cell, right);
    if (below !== cell) addEdge(cell, below);
  }
}`;

  // --- Playground (live-interactive) ---
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

  private pgOffscreen: HTMLCanvasElement | null = null;
  private isPanning = false;
  private panStartX = 0;
  private panBase = 0;
  private panOffset = 0;

  // --- Pre-computed sections ---
  private seedsCanvasRef = viewChild<ElementRef<HTMLCanvasElement>>('seedsCanvas');
  private s1Variants: HTMLCanvasElement[] = []; // index = count - S1_MIN
  s1Count = signal(12);

  private relaxCanvasRef = viewChild<ElementRef<HTMLCanvasElement>>('relaxCanvas');
  private s2Variants: HTMLCanvasElement[] = []; // index = iterations - S2_MIN
  s2Iterations = signal(3);

  private wrapOffCanvasRef = viewChild<ElementRef<HTMLCanvasElement>>('wrapOffCanvas');
  private wrapOnCanvasRef = viewChild<ElementRef<HTMLCanvasElement>>('wrapOnCanvas');
  private wrapOnOffscreen: HTMLCanvasElement | null = null;
  private isWrapPanning = false;
  private wrapPanStartX = 0;
  private wrapPanBase = 0;
  private wrapPanOffset = 0;

  private graphCanvasRef = viewChild<ElementRef<HTMLCanvasElement>>('graphCanvas');
  private graphOffscreen: HTMLCanvasElement | null = null;
  private isGraphPanning = false;
  private graphPanStartX = 0;
  private graphPanBase = 0;
  private graphPanOffset = 0;

  // --- Section 5: Spherical wrapping ---
  private sphereOverlayCanvasRef = viewChild<ElementRef<HTMLCanvasElement>>('sphereOverlayCanvas');
  private mercatorCanvasRef = viewChild<ElementRef<HTMLCanvasElement>>('mercatorCanvas');
  private s5Variants: SphereVariant[] = [];
  s5Count = signal(16);

  sphereTexture = signal<SphereViewTexture | null>(null);
  sphereRotLon = signal(0);
  sphereRotLat = signal(0);

  private mercatorOffscreen: HTMLCanvasElement | null = null;
  private isMercatorPanning = false;
  private mercatorPanStartX = 0;
  private mercatorPanBaseLon = 0;

  constructor() {
    setTimeout(() => {
      this.precomputeSeeds();
      this.precomputeRelaxation();
      this.precomputeWrapping();
      this.precomputeGraph();
      this.precomputeSphere();
      this.generatePlayground();
    }, 0);

    // Redraw the great-circle overlay whenever rotation or the active variant
    // changes. The sphere itself is rendered by <x-sphere-view> via WebGL.
    effect(() => {
      this.sphereRotLon();
      this.sphereRotLat();
      this.s5Count();
      this.renderSphereOverlay();
    });

    // The mercator pan is a derived projection of the sphere's longitude
    // rotation, so dragging either keeps the two views aligned.
    effect(() => {
      this.sphereRotLon();
      this.renderMercator();
    });
  }

  // --- Section 1: Seed placement (slider 2..30) ---

  private precomputeSeeds(): void {
    this.s1Variants = [];
    for (let count = S1_MIN; count <= S1_MAX; count++) {
      const seeds = generateSeeds({
        width: DEMO_W,
        height: DEMO_H,
        seedCount: count,
        seed: DEMO_SEED,
        relaxationIterations: 0,
        wrapX: false,
      });
      const canvas = document.createElement('canvas');
      canvas.width = DEMO_W;
      canvas.height = DEMO_H;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, DEMO_W, DEMO_H);
      this.drawSeedDots(ctx, seeds, 4);
      this.s1Variants.push(canvas);
    }
    this.renderS1();
  }

  setS1(count: number): void {
    this.s1Count.set(count);
    this.renderS1();
  }

  private renderS1(): void {
    const ref = this.seedsCanvasRef();
    if (!ref || !this.s1Variants.length) return;
    this.blit(ref.nativeElement, this.s1Variants[this.s1Count() - S1_MIN]);
  }

  // --- Section 2: Cells + Lloyd relaxation (slider 0..10) ---

  private precomputeRelaxation(): void {
    this.s2Variants = [];
    for (let it = S2_MIN; it <= S2_MAX; it++) {
      const result = generateVoronoi({
        width: DEMO_W,
        height: DEMO_H,
        seedCount: DEMO_COUNT,
        seed: DEMO_SEED,
        relaxationIterations: it,
        wrapX: false,
      });
      const canvas = this.cellsToCanvas(result, DEMO_W, DEMO_H);
      this.drawSeedDots(canvas.getContext('2d')!, result.seeds, 3);
      this.s2Variants.push(canvas);
    }
    this.renderS2();
  }

  setS2(iterations: number): void {
    this.s2Iterations.set(iterations);
    this.renderS2();
  }

  private renderS2(): void {
    const ref = this.relaxCanvasRef();
    if (!ref || !this.s2Variants.length) return;
    this.blit(ref.nativeElement, this.s2Variants[this.s2Iterations() - S2_MIN]);
  }

  // --- Section 3: Cylindrical wrapping (side-by-side comparison) ---

  private precomputeWrapping(): void {
    const base: VoronoiConfig = {
      width: DEMO_W,
      height: DEMO_H,
      seedCount: 8,
      seed: DEMO_SEED,
      relaxationIterations: 3,
      wrapX: false,
    };
    const offCanvas = this.cellsToCanvas(generateVoronoi(base), DEMO_W, DEMO_H);
    const onCanvas = this.cellsToCanvas(generateVoronoi({ ...base, wrapX: true }), DEMO_W, DEMO_H);

    const offRef = this.wrapOffCanvasRef();
    if (offRef) this.blit(offRef.nativeElement, offCanvas);

    this.wrapOnOffscreen = onCanvas;
    this.wrapPanOffset = 0;
    this.renderWrapOn();
  }

  private renderWrapOn(): void {
    const ref = this.wrapOnCanvasRef();
    if (!ref || !this.wrapOnOffscreen) return;
    this.blitWithPan(ref.nativeElement, this.wrapOnOffscreen, this.wrapPanOffset);
  }

  onWrapPanStart(e: PointerEvent): void {
    this.isWrapPanning = true;
    this.wrapPanStartX = e.clientX;
    this.wrapPanBase = this.wrapPanOffset;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  onWrapPanMove(e: PointerEvent): void {
    if (!this.isWrapPanning) return;
    const target = e.currentTarget as HTMLElement;
    const scale = DEMO_W / target.clientWidth;
    this.wrapPanOffset = this.wrapPanBase - (e.clientX - this.wrapPanStartX) * scale;
    this.renderWrapOn();
  }
  onWrapPanEnd(): void {
    this.isWrapPanning = false;
  }

  // --- Section 4: Adjacency graph ---

  private precomputeGraph(): void {
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
    const canvas = this.cellsToCanvas(result, DEMO_W, DEMO_H);
    const ctx = canvas.getContext('2d')!;
    this.drawGraphEdges(ctx, result.seeds, graph.edges, DEMO_W);
    this.drawSeedDots(ctx, result.seeds, 4);
    this.graphOffscreen = canvas;
    this.graphPanOffset = 0;
    this.renderGraph();
  }

  private renderGraph(): void {
    const ref = this.graphCanvasRef();
    if (!ref || !this.graphOffscreen) return;
    this.blitWithPan(ref.nativeElement, this.graphOffscreen, this.graphPanOffset);
  }

  onGraphPanStart(e: PointerEvent): void {
    this.isGraphPanning = true;
    this.graphPanStartX = e.clientX;
    this.graphPanBase = this.graphPanOffset;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  onGraphPanMove(e: PointerEvent): void {
    if (!this.isGraphPanning) return;
    const target = e.currentTarget as HTMLElement;
    const scale = DEMO_W / target.clientWidth;
    this.graphPanOffset = this.graphPanBase - (e.clientX - this.graphPanStartX) * scale;
    this.renderGraph();
  }
  onGraphPanEnd(): void {
    this.isGraphPanning = false;
  }

  // --- Section 5: Spherical wrapping (slider 8..32 step 4) ---

  private s5IndexFor(count: number): number {
    return Math.floor((count - S5_MIN) / S5_STEP);
  }

  private precomputeSphere(): void {
    this.s5Variants = [];
    for (let count = S5_MIN; count <= S5_MAX; count += S5_STEP) {
      const result = generateSphereVoronoi({
        width: S5_GRID_W,
        height: S5_GRID_H,
        seedCount: count,
        seed: DEMO_SEED,
        relaxationIterations: S5_RELAX,
      });
      const graph = buildVoronoiGraph(result.cells, S5_GRID_W, S5_GRID_H, count, true);

      const mercRgba = sphereVoronoiToMercatorRGBA(result, S5_MERC_W, S5_MERC_H, true);
      const mercator = document.createElement('canvas');
      mercator.width = S5_MERC_W;
      mercator.height = S5_MERC_H;
      const ctx = mercator.getContext('2d')!;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(mercRgba), S5_MERC_W, S5_MERC_H), 0, 0);
      this.drawSphereGraphOnMercator(ctx, result.seeds, graph.edges, S5_MERC_W, S5_MERC_H);
      this.drawSphereSeedsOnMercator(ctx, result.seeds, S5_MERC_W, S5_MERC_H, 3);

      const equirectRgba = sphereVoronoiToEquirectRGBA(result, S5_EQUIRECT_W, S5_EQUIRECT_H, true);

      this.s5Variants.push({
        result,
        mercator,
        equirect: { rgba: equirectRgba, width: S5_EQUIRECT_W, height: S5_EQUIRECT_H },
        edges: graph.edges,
      });
    }
    this.refreshS5();
  }

  setS5(count: number): void {
    this.s5Count.set(count);
    this.refreshS5();
  }

  private refreshS5(): void {
    if (!this.s5Variants.length) return;
    const variant = this.s5Variants[this.s5IndexFor(this.s5Count())];
    this.mercatorOffscreen = variant.mercator;
    this.renderMercator();
    this.sphereTexture.set(variant.equirect);
    this.renderSphereOverlay();
  }

  private mercatorPanFromLon(rotLon: number): number {
    // One full rotation of the globe = one full mercator width. The sign
    // matches both views: dragging right reduces rotLon (sphere "scrolls"
    // east) and the same delta reduces panOffset so the mercator scrolls
    // east too.
    return (rotLon / (Math.PI * 2)) * S5_MERC_W;
  }

  private renderMercator(): void {
    const ref = this.mercatorCanvasRef();
    if (!ref || !this.mercatorOffscreen) return;
    this.blitWithPan(ref.nativeElement, this.mercatorOffscreen, this.mercatorPanFromLon(this.sphereRotLon()));
  }

  private renderSphereOverlay(): void {
    const ref = this.sphereOverlayCanvasRef();
    if (!ref || !this.s5Variants.length) return;
    const el = ref.nativeElement;
    if (el.width !== S5_SPHERE_SIZE || el.height !== S5_SPHERE_SIZE) {
      el.width = S5_SPHERE_SIZE;
      el.height = S5_SPHERE_SIZE;
    }
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, S5_SPHERE_SIZE, S5_SPHERE_SIZE);
    const variant = this.s5Variants[this.s5IndexFor(this.s5Count())];
    this.drawSphereGraphOnSphere(ctx, variant.result.seeds, variant.edges);
    this.drawSphereSeedsOnSphere(ctx, variant.result.seeds);
  }

  onMercatorPanStart(e: PointerEvent): void {
    this.isMercatorPanning = true;
    this.mercatorPanStartX = e.clientX;
    this.mercatorPanBaseLon = this.sphereRotLon();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  onMercatorPanMove(e: PointerEvent): void {
    if (!this.isMercatorPanning) return;
    const target = e.currentTarget as HTMLElement;
    // Map drag distance to longitude radians so the same pixel delta would
    // translate to the same visual shift on either view.
    const lonScale = (Math.PI * 2) / target.clientWidth;
    this.sphereRotLon.set(this.mercatorPanBaseLon - (e.clientX - this.mercatorPanStartX) * lonScale);
  }
  onMercatorPanEnd(): void {
    this.isMercatorPanning = false;
  }

  private drawSphereGraphOnMercator(
    ctx: CanvasRenderingContext2D,
    seeds: Vec3[],
    edges: VoronoiEdge[],
    width: number,
    height: number
  ): void {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    for (const edge of edges) {
      const a = vec3ToMercator(seeds[edge.cellA], width, height);
      const b = vec3ToMercator(seeds[edge.cellB], width, height);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      if (dx > width / 2) dx -= width;
      else if (dx < -width / 2) dx += width;
      const bxW = a.x + dx;
      if (bxW < 0 || bxW >= width) {
        const t = bxW < 0 ? -a.x / dx : (width - a.x) / dx;
        const seam = bxW < 0 ? 0 : width;
        const midY = a.y + (b.y - a.y) * t;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(seam, midY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(width - seam, midY);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(bxW, b.y);
        ctx.stroke();
      }
    }
  }

  private drawSphereSeedsOnMercator(
    ctx: CanvasRenderingContext2D,
    seeds: Vec3[],
    width: number,
    height: number,
    radius: number
  ): void {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    for (const seed of seeds) {
      const p = vec3ToMercator(seed, width, height);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawSphereGraphOnSphere(ctx: CanvasRenderingContext2D, seeds: Vec3[], edges: VoronoiEdge[]): void {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    const segments = 16;
    const half = S5_SPHERE_SIZE / 2;
    const rotLon = this.sphereRotLon();
    const rotLat = this.sphereRotLat();

    for (const edge of edges) {
      const a = seeds[edge.cellA];
      const b = seeds[edge.cellB];
      const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
      const omega = Math.acos(dot);
      if (omega < 1e-6) continue;
      const sinO = Math.sin(omega);

      let started = false;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const k1 = Math.sin((1 - t) * omega) / sinO;
        const k2 = Math.sin(t * omega) / sinO;
        const px = k1 * a.x + k2 * b.x;
        const py = k1 * a.y + k2 * b.y;
        const pz = k1 * a.z + k2 * b.z;

        const view = vec3ToView({ x: px, y: py, z: pz }, rotLon, rotLat);
        if (!view.frontFacing) {
          if (started) {
            ctx.stroke();
            started = false;
          }
          continue;
        }
        const sx = half + view.u * half;
        const sy = half - view.vv * half;
        if (!started) {
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          started = true;
        } else {
          ctx.lineTo(sx, sy);
        }
      }
      if (started) ctx.stroke();
    }
  }

  private drawSphereSeedsOnSphere(ctx: CanvasRenderingContext2D, seeds: Vec3[]): void {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    const half = S5_SPHERE_SIZE / 2;
    const rotLon = this.sphereRotLon();
    const rotLat = this.sphereRotLat();
    for (const seed of seeds) {
      const view = vec3ToView(seed, rotLon, rotLat);
      if (!view.frontFacing) continue;
      const sx = half + view.u * half;
      const sy = half - view.vv * half;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // --- Playground ---

  randomizeSeed(): void {
    this.pgSeed.set(Math.floor(Math.random() * 2147483647));
  }

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
    const canvas = this.cellsToCanvas(result, config.width, config.height, this.pgShowBoundaries());
    const ctx = canvas.getContext('2d')!;

    if (this.pgShowGraph()) {
      const graph = buildVoronoiGraph(result.cells, config.width, config.height, config.seedCount, config.wrapX);
      this.drawGraphEdges(ctx, result.seeds, graph.edges, config.width, config.wrapX);
    }
    if (this.pgShowSeeds()) {
      this.drawSeedDots(ctx, result.seeds, 3);
    }

    this.pgOffscreen = canvas;
    this.panOffset = 0;
    this.renderPlayground();
  }

  private renderPlayground(): void {
    const ref = this.playgroundCanvas();
    if (!ref || !this.pgOffscreen) return;
    const offset = this.pgWrapX() ? this.panOffset : 0;
    this.blitWithPan(ref.nativeElement, this.pgOffscreen, offset);
  }

  onPanStart(e: PointerEvent): void {
    if (!this.pgWrapX()) return;
    this.isPanning = true;
    this.panStartX = e.clientX;
    this.panBase = this.panOffset;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  onPanMove(e: PointerEvent): void {
    if (!this.isPanning || !this.pgOffscreen) return;
    const target = e.currentTarget as HTMLElement;
    const scale = this.pgOffscreen.width / target.clientWidth;
    this.panOffset = this.panBase - (e.clientX - this.panStartX) * scale;
    this.renderPlayground();
  }
  onPanEnd(): void {
    this.isPanning = false;
  }

  // --- Helpers ---

  private cellsToCanvas(result: VoronoiResult, w: number, h: number, boundaries = true): HTMLCanvasElement {
    const rgba = voronoiToRGBA(result, w, h, boundaries);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    return canvas;
  }

  private drawSeedDots(ctx: CanvasRenderingContext2D, seeds: VoronoiSeed[], radius: number): void {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    for (const seed of seeds) {
      ctx.beginPath();
      ctx.arc(seed.x, seed.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawGraphEdges(
    ctx: CanvasRenderingContext2D,
    seeds: VoronoiSeed[],
    edges: VoronoiEdge[],
    width: number,
    wrapX = true
  ): void {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    for (const edge of edges) {
      const a = seeds[edge.cellA];
      const b = seeds[edge.cellB];
      if (!wrapX) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        continue;
      }
      let dx = b.x - a.x;
      if (dx > width / 2) dx -= width;
      else if (dx < -width / 2) dx += width;
      const bxW = a.x + dx;
      if (bxW < 0 || bxW >= width) {
        const t = bxW < 0 ? -a.x / dx : (width - a.x) / dx;
        const seam = bxW < 0 ? 0 : width;
        const midY = a.y + (b.y - a.y) * t;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(seam, midY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(width - seam, midY);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(bxW, b.y);
        ctx.stroke();
      }
    }
  }

  private blit(target: HTMLCanvasElement, src: HTMLCanvasElement): void {
    if (target.width !== src.width || target.height !== src.height) {
      target.width = src.width;
      target.height = src.height;
    }
    target.getContext('2d')!.drawImage(src, 0, 0);
  }

  private blitWithPan(target: HTMLCanvasElement, src: HTMLCanvasElement, panOffset: number): void {
    const w = src.width;
    const h = src.height;
    if (target.width !== w || target.height !== h) {
      target.width = w;
      target.height = h;
    }
    const ctx = target.getContext('2d')!;
    if (panOffset !== 0) {
      const px = ((panOffset % w) + w) % w;
      ctx.drawImage(src, px, 0, w - px, h, 0, 0, w - px, h);
      if (px > 0) {
        ctx.drawImage(src, 0, 0, px, h, w - px, 0, px, h);
      }
    } else {
      ctx.drawImage(src, 0, 0);
    }
  }
}
