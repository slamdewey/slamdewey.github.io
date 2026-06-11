import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { generateSeeds } from '@lib/voronoi';
import {
  lloydPlanar,
  lloydSphere,
  PlanarEdge,
  PlanarVoronoi,
  SphereEdge,
  SphereVoronoi,
  voronoiCylindrical,
  voronoiPlanar,
  voronoiSphere,
} from '@lib/voronoi-edges';
import { buildVoronoiPalette, VoronoiRenderer, VoronoiSeedVec, VoronoiTopology } from '@lib/voronoi-renderer';
import { generateSphereSeeds, Vec3, vec3ToView } from '@lib/voronoi-sphere';

/** Cylindrical world width in seed units (height-normalized aspect ratio). */
const FLAT_ASPECT = 2;

interface GenResult {
  topology: VoronoiTopology;
  seeds: VoronoiSeedVec[];
  colors: [number, number, number][];
  /** World-space aspect (width / height) — 1.0 for sphere. */
  aspect: number;
  /** Planar / cylindrical tessellation (null when topology is spherical). */
  planar: PlanarVoronoi | null;
  /** Spherical tessellation (null otherwise). */
  sphere: SphereVoronoi | null;
}

@Component({
  selector: 'x-voronoi-playground',
  templateUrl: './voronoi-playground.component.html',
  styleUrls: ['./voronoi-playground.component.scss'],
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSliderModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoronoiPlaygroundComponent implements AfterViewInit, OnDestroy {
  // --- Generation params ---
  seed = signal(42);
  seedCount = signal(24);
  relaxation = signal(3);
  topology = signal<VoronoiTopology>('cylindrical');

  // --- Display params ---
  showBoundaries = signal(true);
  borderThickness = signal(1.25);
  showSeeds = signal(true);
  showGraph = signal(false);

  // --- View state ---
  rotLon = signal(0);
  rotLat = signal(0);
  /** World-space pan (only meaningful in cylindrical mode). */
  panX = signal(0);

  private genResult = signal<GenResult | null>(null);
  private viewReady = signal(false);
  private dpr = signal(1);

  topologyName = computed(() => {
    switch (this.topology()) {
      case 'flat':
        return 'non-wrapping';
      case 'cylindrical':
        return 'cylindrical';
      case 'spherical':
        return 'spherical';
    }
  });
  isSphere = computed(() => this.topology() === 'spherical');
  isCylinder = computed(() => this.topology() === 'cylindrical');
  ariaLabel = computed(
    () =>
      `Voronoi diagram, ${this.seedCount()} cells, ${this.topologyName()} topology, ${this.relaxation()} Lloyd iterations`
  );

  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('glCanvas');
  private overlayRef = viewChild.required<ElementRef<HTMLCanvasElement>>('overlayCanvas');
  private wrapRef = viewChild.required<ElementRef<HTMLDivElement>>('canvasWrap');

  private renderer: VoronoiRenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private dragging: 'pan' | 'rotate' | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragBaseX = 0;
  private dragBaseY = 0;

  constructor() {
    // Generation effect: rebuilds the seed set and analytical Voronoi
    // tessellation whenever a generation-flavor signal changes.
    effect(() => {
      const topo = this.topology();
      const seed = this.seed();
      const seedCount = this.seedCount();
      const relax = this.relaxation();
      this.genResult.set(this.regenerate(topo, seed, seedCount, relax));
    });

    // GPU upload + render effect.
    effect(() => {
      if (!this.viewReady()) return;
      const r = this.genResult();
      const renderer = this.renderer;
      if (!r || !renderer) return;

      renderer.setTopology(r.topology);
      renderer.setAspect(r.aspect);
      renderer.setSeeds(r.seeds, r.colors);
      renderer.setPan(r.topology === 'cylindrical' ? this.panX() : 0, 0);
      renderer.setRotation(this.rotLon(), this.rotLat());
      renderer.render();
    });

    // Overlay (edges + seed dots + graph) effect.
    effect(() => {
      if (!this.viewReady()) return;
      this.genResult();
      this.showBoundaries();
      this.borderThickness();
      this.showSeeds();
      this.showGraph();
      this.panX();
      this.rotLon();
      this.rotLat();
      this.topology();
      this.dpr();
      this.drawOverlay();
    });
  }

  ngAfterViewInit(): void {
    try {
      this.renderer = new VoronoiRenderer(this.canvasRef().nativeElement);
    } catch {
      this.renderer = null;
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.wrapRef().nativeElement);
    this.handleResize();
    this.viewReady.set(true);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer?.dispose();
    this.renderer = null;
  }

  randomize(): void {
    this.seed.set(Math.floor(Math.random() * 2147483647));
  }

  setTopology(t: VoronoiTopology): void {
    if (this.topology() === t) return;
    this.topology.set(t);
    this.panX.set(0);
    queueMicrotask(() => this.handleResize());
  }

  // --- Pointer drag (pan for cylindrical, rotate for spherical) ---

  onPointerDown(e: PointerEvent): void {
    const topo = this.topology();
    if (topo === 'cylindrical') {
      this.dragging = 'pan';
      this.dragBaseX = this.panX();
    } else if (topo === 'spherical') {
      this.dragging = 'rotate';
      this.dragBaseX = this.rotLon();
      this.dragBaseY = this.rotLat();
    } else {
      return;
    }
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const wrap = this.wrapRef().nativeElement;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    if (this.dragging === 'pan') {
      const scale = FLAT_ASPECT / Math.max(1, wrap.clientWidth);
      this.panX.set(this.dragBaseX - dx * scale);
    } else {
      const scale = Math.PI / Math.max(1, wrap.clientWidth);
      this.rotLon.set(this.dragBaseX - dx * scale);
      const limit = Math.PI / 2 - 0.001;
      const lat = Math.max(-limit, Math.min(limit, this.dragBaseY + dy * scale));
      this.rotLat.set(lat);
    }
  }

  onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = null;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  onKeyDown(e: KeyboardEvent): void {
    const topo = this.topology();
    if (topo === 'cylindrical') {
      if (e.key === 'ArrowLeft') {
        this.panX.update((x) => x - FLAT_ASPECT * 0.05);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        this.panX.update((x) => x + FLAT_ASPECT * 0.05);
        e.preventDefault();
      }
    } else if (topo === 'spherical') {
      const step = Math.PI * 0.05;
      const limit = Math.PI / 2 - 0.001;
      if (e.key === 'ArrowLeft') {
        this.rotLon.update((x) => x - step);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        this.rotLon.update((x) => x + step);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        this.rotLat.update((y) => Math.min(limit, y + step));
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        this.rotLat.update((y) => Math.max(-limit, y - step));
        e.preventDefault();
      }
    }
  }

  // --- Internals ---

  private regenerate(topo: VoronoiTopology, seed: number, seedCount: number, relax: number): GenResult {
    const colors = buildVoronoiPalette(seedCount);

    if (topo === 'spherical') {
      // Random unit-vector seeds, then analytical spherical Lloyd.
      const initial = generateSphereSeeds(seedCount, seed);
      const relaxed = lloydSphere(initial, relax);
      const sphereTess = voronoiSphere(relaxed);
      const seeds: VoronoiSeedVec[] = relaxed.map((s) => ({ x: s.x, y: s.y, z: s.z }));
      return { topology: topo, seeds, colors, aspect: 1.0, planar: null, sphere: sphereTess };
    }

    // Random seeds in world coords (height-normalized: x ∈ [0, aspect), y ∈ [0, 1)).
    // generateSeeds() returns pixel-space [0, width)×[0, height); we feed it
    // a 1×aspect "virtual canvas" so its output is already normalized.
    const wrap = topo === 'cylindrical';
    const pixelSeeds = generateSeeds({
      width: FLAT_ASPECT,
      height: 1,
      seedCount,
      seed,
      relaxationIterations: 0,
      wrapX: wrap,
    });
    const initial = pixelSeeds.map((s) => ({ x: s.x, y: s.y }));
    const relaxed = lloydPlanar(initial, FLAT_ASPECT, 1, wrap, relax);
    const planar = wrap
      ? voronoiCylindrical(relaxed, FLAT_ASPECT, 1)
      : voronoiPlanar(relaxed, { minX: 0, minY: 0, maxX: FLAT_ASPECT, maxY: 1 });
    const seeds: VoronoiSeedVec[] = relaxed.map((s) => ({ x: s.x, y: s.y, z: 0 }));
    return { topology: topo, seeds, colors, aspect: FLAT_ASPECT, planar, sphere: null };
  }

  private handleResize(): void {
    if (!this.renderer) return;
    const wrap = this.wrapRef().nativeElement;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setBackingSize(cssW, cssH, dpr);

    const overlay = this.overlayRef().nativeElement;
    const oW = Math.max(1, Math.round(cssW * dpr));
    const oH = Math.max(1, Math.round(cssH * dpr));
    if (overlay.width !== oW || overlay.height !== oH) {
      overlay.width = oW;
      overlay.height = oH;
    }
    this.dpr.set(dpr);
    // Backing-store resize wipes the framebuffer; the display effect won't
    // fire if no other signal changed (e.g. topology swap with the same DPR).
    // Render explicitly to guarantee the new size has content.
    this.renderer.render();
    this.drawOverlay();
  }

  // ---------------- Overlay drawing ----------------

  private drawOverlay(): void {
    const overlay = this.overlayRef().nativeElement;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const r = this.genResult();
    if (!r) return;

    const wrap = this.wrapRef().nativeElement;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const dpr = this.dpr();

    if (r.topology === 'spherical') {
      this.drawSphereOverlay(ctx, r, cssW, cssH, dpr);
    } else {
      this.drawPlanarOverlay(ctx, r, cssW, cssH, dpr);
    }
  }

  private drawPlanarOverlay(
    ctx: CanvasRenderingContext2D,
    r: GenResult,
    cssW: number,
    cssH: number,
    dpr: number
  ): void {
    if (!r.planar) return;
    const aspect = r.aspect;
    const wrapped = r.topology === 'cylindrical';
    // Mod pan into [0, aspect) so axNorm stays in roughly [-eps, 1+eps] and
    // the ±1 wrap copies cover the entire visible window regardless of how
    // far the user has dragged.
    const rawPan = wrapped ? this.panX() : 0;
    const pan = wrapped ? ((rawPan % aspect) + aspect) % aspect : 0;
    const W = cssW * dpr;
    const H = cssH * dpr;

    const wrapCopies = wrapped ? [-1, 0, 1] : [0];

    if (this.showBoundaries()) {
      ctx.strokeStyle = 'rgba(20, 20, 20, 0.95)';
      ctx.lineWidth = this.borderThickness() * dpr;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.drawPlanarSegments(ctx, r.planar.edges, aspect, pan, W, H, wrapCopies);
    }

    if (this.showGraph()) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1.5 * dpr;
      this.drawPlanarGraph(ctx, r, aspect, pan, W, H, wrapCopies);
    }

    if (this.showSeeds()) {
      this.drawPlanarSeedDots(ctx, r, aspect, pan, W, H, dpr, wrapCopies);
    }
  }

  private drawPlanarSegments(
    ctx: CanvasRenderingContext2D,
    edges: PlanarEdge[],
    aspect: number,
    pan: number,
    W: number,
    H: number,
    wrapCopies: number[]
  ): void {
    for (const edge of edges) {
      const ay = edge.a.y * H;
      const by = edge.b.y * H;
      const axNorm = (edge.a.x - pan) / aspect;
      const bxNorm = (edge.b.x - pan) / aspect;
      for (const k of wrapCopies) {
        const x0 = (axNorm + k) * W;
        const x1 = (bxNorm + k) * W;
        if (Math.max(x0, x1) < 0 || Math.min(x0, x1) > W) continue;
        ctx.beginPath();
        ctx.moveTo(x0, ay);
        ctx.lineTo(x1, by);
        ctx.stroke();
      }
    }
  }

  private drawPlanarGraph(
    ctx: CanvasRenderingContext2D,
    r: GenResult,
    aspect: number,
    pan: number,
    W: number,
    H: number,
    wrapCopies: number[]
  ): void {
    // Render the dual graph as a zig-zag: seedA → boundary midpoint → seedB.
    // For cylindrical wrap, a cell pair can share two boundaries (in-window
    // and seam); pick the SHORTER edge per pair so the graph line follows
    // the more direct route and doesn't visually criss-cross.
    const edges = r.planar?.edges ?? [];
    const shortestPerPair = new Map<string, PlanarEdge>();
    for (const edge of edges) {
      const key = `${edge.cellA}_${edge.cellB}`;
      const existing = shortestPerPair.get(key);
      if (!existing || planarEdgeLengthSq(edge) < planarEdgeLengthSq(existing)) {
        shortestPerPair.set(key, edge);
      }
    }

    // Every edge from the adapter is a real visible boundary segment with
    // endpoints inside the canvas (adapter classifies adjacency by polygon-
    // walk on the clipped cells, not by Delaunay triangle incidence). So the
    // midpoint is always inside the canvas and the zig-zag is always valid —
    // no infinity-adjacency check or direct-line fallback needed.
    const wrapped = r.topology === 'cylindrical';
    for (const edge of shortestPerPair.values()) {
      const seedA = r.seeds[edge.cellA];
      const seedB = r.seeds[edge.cellB];
      this.drawPlanarSegment(ctx, seedA, edge.midpoint, aspect, pan, W, H, wrapCopies, wrapped);
      this.drawPlanarSegment(ctx, edge.midpoint, seedB, aspect, pan, W, H, wrapCopies, wrapped);
    }
  }

  /** Stroke one planar segment from world-coords `p1` to `p2`, wrap-aware. */
  private drawPlanarSegment(
    ctx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    aspect: number,
    pan: number,
    W: number,
    H: number,
    wrapCopies: number[],
    wrapped: boolean
  ): void {
    let p2x = p2.x;
    if (wrapped) {
      const dx = p2x - p1.x;
      if (dx > aspect / 2) p2x -= aspect;
      else if (dx < -aspect / 2) p2x += aspect;
    }
    const y1 = p1.y * H;
    const y2 = p2.y * H;
    const x1Norm = (p1.x - pan) / aspect;
    const x2Norm = (p2x - pan) / aspect;
    for (const k of wrapCopies) {
      const x0 = (x1Norm + k) * W;
      const x1 = (x2Norm + k) * W;
      if (Math.max(x0, x1) < 0 || Math.min(x0, x1) > W) continue;
      ctx.beginPath();
      ctx.moveTo(x0, y1);
      ctx.lineTo(x1, y2);
      ctx.stroke();
    }
  }

  private drawPlanarSeedDots(
    ctx: CanvasRenderingContext2D,
    r: GenResult,
    aspect: number,
    pan: number,
    W: number,
    H: number,
    dpr: number,
    wrapCopies: number[]
  ): void {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.25 * dpr;
    const radius = 3.5 * dpr;
    for (const s of r.seeds) {
      const sy = s.y * H;
      const xNorm = (s.x - pan) / aspect;
      for (const k of wrapCopies) {
        const sx = (xNorm + k) * W;
        if (sx < -radius || sx > W + radius) continue;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  private drawSphereOverlay(
    ctx: CanvasRenderingContext2D,
    r: GenResult,
    cssW: number,
    cssH: number,
    dpr: number
  ): void {
    if (!r.sphere) return;
    const W = cssW * dpr;
    const H = cssH * dpr;
    const halfW = W / 2;
    const halfH = H / 2;
    const rotLon = this.rotLon();
    const rotLat = this.rotLat();

    if (this.showBoundaries()) {
      ctx.strokeStyle = 'rgba(20, 20, 20, 0.95)';
      ctx.lineWidth = this.borderThickness() * dpr;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.drawSphereEdges(ctx, r.sphere.edges, rotLon, rotLat, halfW, halfH);
    }

    if (this.showGraph()) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1.5 * dpr;
      this.drawSphereGraphArcs(ctx, r.sphere.edges, r.seeds, rotLon, rotLat, halfW, halfH);
    }

    if (this.showSeeds()) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.25 * dpr;
      const radius = 3.5 * dpr;
      for (const s of r.seeds) {
        const view = vec3ToView(s, rotLon, rotLat);
        if (!view.frontFacing) continue;
        const sx = halfW + view.u * halfW;
        const sy = halfH - view.vv * halfH;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  private drawSphereEdges(
    ctx: CanvasRenderingContext2D,
    edges: SphereEdge[],
    rotLon: number,
    rotLat: number,
    halfW: number,
    halfH: number
  ): void {
    for (const edge of edges) {
      // Near-antipodal endpoints (always at N=3, occasionally at higher N)
      // make a single great-circle slerp ambiguous. Subdivide via the
      // adapter-supplied midpoint, which lives on the bisector great circle
      // on the side facing the cells.
      const dotAB = edge.a.x * edge.b.x + edge.a.y * edge.b.y + edge.a.z * edge.b.z;
      if (dotAB < -0.9) {
        this.strokeGreatCircle(ctx, edge.a, edge.midpoint, rotLon, rotLat, halfW, halfH, 12);
        this.strokeGreatCircle(ctx, edge.midpoint, edge.b, rotLon, rotLat, halfW, halfH, 12);
      } else {
        this.strokeGreatCircle(ctx, edge.a, edge.b, rotLon, rotLat, halfW, halfH, 12);
      }
    }
  }

  private drawSphereGraphArcs(
    ctx: CanvasRenderingContext2D,
    edges: SphereEdge[],
    seeds: VoronoiSeedVec[],
    rotLon: number,
    rotLat: number,
    halfW: number,
    halfH: number
  ): void {
    // Zig-zag through each shared-edge midpoint instead of straight seed-to-
    // seed lines. For low N on a sphere, a direct great-circle arc between
    // two seeds can pass through a third cell (visually misleading); routing
    // via the boundary midpoint shows the actual adjacency. If a pair has
    // multiple edges (rare on a sphere), use the shortest one's midpoint.
    const shortestPerPair = new Map<string, SphereEdge>();
    for (const edge of edges) {
      const key = `${edge.cellA}_${edge.cellB}`;
      const existing = shortestPerPair.get(key);
      if (!existing || sphereEdgeLengthSq(edge) < sphereEdgeLengthSq(existing)) {
        shortestPerPair.set(key, edge);
      }
    }
    for (const edge of shortestPerPair.values()) {
      const seedA = seeds[edge.cellA];
      const seedB = seeds[edge.cellB];
      this.strokeGreatCircle(ctx, seedA, edge.midpoint, rotLon, rotLat, halfW, halfH, 12);
      this.strokeGreatCircle(ctx, edge.midpoint, seedB, rotLon, rotLat, halfW, halfH, 12);
    }
  }

  /**
   * Stroke the shorter great-circle arc between two unit vectors, splitting
   * at the horizon so back-hemisphere parts don't draw.
   */
  private strokeGreatCircle(
    ctx: CanvasRenderingContext2D,
    a: Vec3,
    b: Vec3,
    rotLon: number,
    rotLat: number,
    halfW: number,
    halfH: number,
    segments: number
  ): void {
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    const omega = Math.acos(dot);
    // Skip zero-length arcs (a == b) and near-antipodal arcs (a ≈ -b) where
    // the slerp formula divides by sin(omega) ≈ 0 and the great circle
    // through the two points isn't unique anyway.
    if (omega < 1e-6 || omega > Math.PI - 1e-4) return;
    const sinO = Math.sin(omega);

    let started = false;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const k1 = Math.sin((1 - t) * omega) / sinO;
      const k2 = Math.sin(t * omega) / sinO;
      const p: Vec3 = { x: k1 * a.x + k2 * b.x, y: k1 * a.y + k2 * b.y, z: k1 * a.z + k2 * b.z };
      const view = vec3ToView(p, rotLon, rotLat);
      if (!view.frontFacing) {
        if (started) {
          ctx.stroke();
          started = false;
        }
        continue;
      }
      const sx = halfW + view.u * halfW;
      const sy = halfH - view.vv * halfH;
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

function planarEdgeLengthSq(e: PlanarEdge): number {
  const dx = e.a.x - e.b.x;
  const dy = e.a.y - e.b.y;
  return dx * dx + dy * dy;
}

function sphereEdgeLengthSq(e: SphereEdge): number {
  // Proxy for arc length: 1 - cos(arc) is monotonic in arc length on [0, π].
  return 1 - (e.a.x * e.b.x + e.a.y * e.b.y + e.a.z * e.b.z);
}
