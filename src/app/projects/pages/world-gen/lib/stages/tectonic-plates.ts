import { generateVoronoi, buildVoronoiGraph, type VoronoiEdge } from '@lib/voronoi';
import { OpenSimplexNoise } from '@lib/noise';
import { mod, cylindricalSx, cylindricalCx } from '@lib/math';
import { NoiseVariables, TectonicVariables } from '../types';

export enum PlateType {
  Continental,
  Oceanic,
}

export enum BoundaryType {
  Convergent,
  Divergent,
  Transform,
}

export enum InteractionType {
  Collision, // cont-cont convergent (Himalayas)
  Subduction, // ocean-cont convergent (Andes)
  OceanicConvergence, // ocean-ocean convergent (Mariana Trench)
  ContinentalRift, // cont divergent (East Africa)
  OceanicRidge, // ocean-ocean divergent (Mid-Atlantic Ridge)
  Transform, // any transform (San Andreas)
}

export interface PlateProperties {
  index: number;
  type: PlateType;
  dx: number;
  dy: number;
  /** Normalized lithospheric thickness [0, 1]. Continental ~0.55–0.85, Oceanic ~0.1–0.35. */
  thickness: number;
  /** Normalized crustal density [0, 1]. Continental ~0.2–0.4, Oceanic ~0.55–0.85 (higher = older). */
  density: number;
  /** Isostatic equilibrium base elevation, derived from thickness & density. */
  baseElevation: number;
}

export interface BoundaryInfo {
  plateA: number;
  plateB: number;
  type: BoundaryType;
  interactionType: InteractionType;
  /** Relative velocity magnitude, normalized to [0, 1] across all edges. */
  intensity: number;
  /** Shared boundary length in pixels. */
  length: number;
  typeA: PlateType;
  typeB: PlateType;
  /** Index of the plate that subducts (-1 if not applicable). */
  subductingPlate: number;
}

export interface TectonicResult {
  baseElevation: Float32Array;
  faults: Float32Array;
  mountainRanges: Float32Array;
  plateMap: Int32Array;
  plates: PlateProperties[];
  boundaries: BoundaryInfo[];
}

/** Simple seeded PRNG (xorshift32). */
function xorshift32(state: { s: number }): number {
  let s = state.s;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  state.s = s;
  return (s >>> 0) / 0xffffffff;
}

// ── Cell grouping ────────────────────────────────────────────────────────

/** Update minDist array with distances from a newly placed seed. */
function updateMinDist(
  seeds: { x: number; y: number }[],
  minDist: Float32Array,
  newSeed: number,
  cellCount: number,
  width: number
): void {
  const sx = seeds[newSeed].x;
  const sy = seeds[newSeed].y;
  for (let i = 0; i < cellCount; i++) {
    let dx = seeds[i].x - sx;
    if (dx > width / 2) dx -= width;
    else if (dx < -width / 2) dx += width;
    const dy = seeds[i].y - sy;
    const d = dx * dx + dy * dy;
    if (d < minDist[i]) minDist[i] = d;
  }
}

/**
 * Two-phase seed placement:
 *
 * Phase 1 — Major plates (largest ~40%) are placed via farthest-point sampling,
 * ensuring they're well-spaced across the map.
 *
 * Phase 2 — A preview Dijkstra partitions the cell graph using only the major
 * plates. The actual computed boundaries from this partition are identified.
 * Minor plate seeds are then placed at these boundary cells via farthest-point
 * sampling. This guarantees minor plates always spawn at the margins between
 * major plates, never as islands inside them.
 */
function selectPlateSeeds(
  seeds: { x: number; y: number }[],
  cellCount: number,
  plateCount: number,
  width: number,
  targetFractions: number[],
  neighbors: number[][],
  rng: { s: number }
): number[] {
  const plateSeeds = new Array<number>(plateCount);
  const placed = new Uint8Array(cellCount);

  // Sort plates by target fraction descending → major plates first
  const order = targetFractions.map((f, i) => ({ fraction: f, plate: i })).sort((a, b) => b.fraction - a.fraction);

  const majorCount = Math.max(3, Math.ceil(plateCount * 0.4));

  // --- Phase 1: Major plates via farthest-point sampling ---
  const minDist = new Float32Array(cellCount).fill(Infinity);

  const first = Math.floor(xorshift32(rng) * cellCount);
  plateSeeds[order[0].plate] = first;
  placed[first] = 1;

  for (let m = 1; m < majorCount; m++) {
    updateMinDist(seeds, minDist, plateSeeds[order[m - 1].plate], cellCount, width);

    let best = -1;
    let bestD = -1;
    for (let i = 0; i < cellCount; i++) {
      if (!placed[i] && minDist[i] > bestD) {
        bestD = minDist[i];
        best = i;
      }
    }
    plateSeeds[order[m].plate] = best;
    placed[best] = 1;
  }
  updateMinDist(seeds, minDist, plateSeeds[order[majorCount - 1].plate], cellCount, width);

  // --- Phase 2: Preview Dijkstra with major plates to find real boundaries ---
  const previewSeeds: number[] = [];
  const previewFractions: number[] = [];
  for (let m = 0; m < majorCount; m++) {
    previewSeeds.push(plateSeeds[order[m].plate]);
    previewFractions.push(order[m].fraction);
  }
  const previewAssignment = groupCellsIntoPlates(neighbors, cellCount, majorCount, previewSeeds, previewFractions);

  // Mark cells at boundaries of the preview partition
  const isBoundaryCell = new Uint8Array(cellCount);
  for (let c = 0; c < cellCount; c++) {
    for (const n of neighbors[c]) {
      if (previewAssignment[n] !== previewAssignment[c]) {
        isBoundaryCell[c] = 1;
        break;
      }
    }
  }

  // --- Phase 3: Minor seeds at boundary cells via farthest-point sampling ---
  for (let m = majorCount; m < plateCount; m++) {
    let best = -1;
    let bestD = -1;

    // Pick the boundary cell farthest from all placed seeds
    for (let i = 0; i < cellCount; i++) {
      if (!placed[i] && isBoundaryCell[i] && minDist[i] > bestD) {
        bestD = minDist[i];
        best = i;
      }
    }

    if (best === -1) {
      // Fallback: any unplaced cell (boundary cells exhausted)
      for (let i = 0; i < cellCount; i++) {
        if (!placed[i] && minDist[i] > bestD) {
          bestD = minDist[i];
          best = i;
        }
      }
    }

    plateSeeds[order[m].plate] = best;
    placed[best] = 1;
    updateMinDist(seeds, minDist, best, cellCount, width);
  }

  return plateSeeds;
}

/**
 * Generate target area fractions using a power-law distribution.
 * A few large plates cover most of the globe, many small plates fill the rest.
 * The fractions are shuffled so large plates aren't always the first seeds.
 */
function generateSizeDistribution(plateCount: number, rng: { s: number }): number[] {
  const ALPHA = 1.2;
  const raw: number[] = [];
  for (let i = 0; i < plateCount; i++) {
    raw.push(1 / Math.pow(i + 1, ALPHA));
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  const fractions = raw.map((v) => v / sum);

  // Fisher-Yates shuffle so large plates aren't always the first seeds
  for (let i = fractions.length - 1; i > 0; i--) {
    const j = Math.floor(xorshift32(rng) * (i + 1));
    [fractions[i], fractions[j]] = [fractions[j], fractions[i]];
  }

  return fractions;
}

/**
 * Group voronoi cells into plates using cost-scaled multi-source Dijkstra.
 *
 * All plates start growing simultaneously from their seeds, but each plate
 * has a per-hop cost derived from its target area fraction. Large plates
 * have low cost (grow fast / expand far), small plates have high cost
 * (grow slow / stay small). The competitive growth naturally partitions
 * the cell graph with sizes matching the target distribution.
 */
function groupCellsIntoPlates(
  neighbors: number[][],
  cellCount: number,
  plateCount: number,
  plateSeeds: number[],
  targetFractions: number[]
): Int32Array {
  const cellToPlate = new Int32Array(cellCount).fill(-1);

  // Compute per-plate growth cost: cost ∝ 1/sqrt(fraction).
  // Large plates have low cost (grow far), small plates have high cost (grow short).
  // In competitive 2D growth, area ∝ radius² and radius ∝ 1/cost,
  // so area ∝ 1/cost² ∝ fraction. Cap to avoid extreme ratios.
  const maxFraction = Math.max(...targetFractions);
  const costs = targetFractions.map((f) => Math.min(Math.sqrt(maxFraction / f), 10));

  // Min-heap priority queue
  const heap: { priority: number; cell: number; plate: number }[] = [];

  const push = (priority: number, cell: number, plate: number) => {
    heap.push({ priority, cell, plate });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[i].priority >= heap[parent].priority) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  };

  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < heap.length && heap[l].priority < heap[smallest].priority) smallest = l;
        if (r < heap.length && heap[r].priority < heap[smallest].priority) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };

  // Pre-claim all seed cells
  for (let p = 0; p < plateCount; p++) {
    cellToPlate[plateSeeds[p]] = p;
  }

  // Seed the queue with neighbors of all plate seeds (all start simultaneously)
  for (let p = 0; p < plateCount; p++) {
    for (const n of neighbors[plateSeeds[p]]) {
      if (cellToPlate[n] === -1) {
        push(costs[p], n, p);
      }
    }
  }

  // Dijkstra: claim cells in priority order, each hop costs costs[plate]
  while (heap.length > 0) {
    const { priority, cell, plate } = pop();
    if (cellToPlate[cell] !== -1) continue; // already claimed

    cellToPlate[cell] = plate;

    for (const n of neighbors[cell]) {
      if (cellToPlate[n] === -1) {
        push(priority + costs[plate], n, plate);
      }
    }
  }

  // Safety: assign any remaining unclaimed cells to a neighbor's plate
  for (let i = 0; i < cellCount; i++) {
    if (cellToPlate[i] === -1) {
      for (const n of neighbors[i]) {
        if (cellToPlate[n] !== -1) {
          cellToPlate[i] = cellToPlate[n];
          break;
        }
      }
    }
  }

  return cellToPlate;
}

// ── Plate properties ─────────────────────────────────────────────────────

interface PlateCentroid {
  x: number;
  y: number;
}

/**
 * Compute plate centroids by averaging the seed positions of all cells in each plate.
 * Uses circular averaging for the wrapped x-axis.
 */
function computePlateCentroids(
  seeds: { x: number; y: number }[],
  cellToPlate: Int32Array,
  cellCount: number,
  plateCount: number,
  width: number
): PlateCentroid[] {
  const TWO_PI = Math.PI * 2;
  const sinSum = new Float64Array(plateCount);
  const cosSum = new Float64Array(plateCount);
  const sumY = new Float64Array(plateCount);
  const counts = new Int32Array(plateCount);

  for (let i = 0; i < cellCount; i++) {
    const p = cellToPlate[i];
    if (p < 0) continue;
    counts[p]++;
    sumY[p] += seeds[i].y;
    const angle = (seeds[i].x / width) * TWO_PI;
    sinSum[p] += Math.sin(angle);
    cosSum[p] += Math.cos(angle);
  }

  const centroids: PlateCentroid[] = [];
  for (let p = 0; p < plateCount; p++) {
    if (counts[p] === 0) {
      centroids.push({ x: 0, y: 0 });
      continue;
    }
    const avgAngle = Math.atan2(sinSum[p], cosSum[p]);
    centroids.push({
      x: mod((avgAngle / TWO_PI) * width, width),
      y: sumY[p] / counts[p],
    });
  }

  return centroids;
}

/**
 * Compute isostatic equilibrium base elevation from thickness and density.
 *
 * Thicker, less-dense crust floats higher on the mantle (continental highlands).
 * Thinner, denser crust sits lower (oceanic basins).
 * Calibrated so average continental ≈ 0.25, average oceanic ≈ -0.35.
 */
export function computeIsostasy(thickness: number, density: number): number {
  return 1.5 * thickness * (1 - density) - 0.5;
}

/**
 * Assign plate type and drift using a low-frequency noise field.
 * Sampling noise at each plate's centroid creates spatial coherence.
 * Thickness and density are derived from plate type with random variation,
 * representing geological age and composition differences.
 */
function assignPlateProperties(
  centroids: PlateCentroid[],
  plateCount: number,
  width: number,
  seed: number
): PlateProperties[] {
  const rng = { s: (seed ^ 0xdeadbeef) | 1 };
  const continentNoise = new OpenSimplexNoise((seed ^ 0xcafebeef) | 0);
  const CONTINENT_FREQ = 0.4;
  const yScale = (2 * Math.PI) / width;

  const plates: PlateProperties[] = [];
  for (let i = 0; i < plateCount; i++) {
    const sx = cylindricalSx(centroids[i].x, width);
    const cx = cylindricalCx(centroids[i].x, width);
    const ny = centroids[i].y * yScale;
    const sample = continentNoise.eval3D(sx * CONTINENT_FREQ, ny * CONTINENT_FREQ, cx * CONTINENT_FREQ);

    const angle = xorshift32(rng) * Math.PI * 2;
    const magnitude = 0.3 + xorshift32(rng) * 0.7;

    const type = sample > 0 ? PlateType.Continental : PlateType.Oceanic;

    // Thickness & density vary by plate type with random spread
    let thickness: number;
    let density: number;
    if (type === PlateType.Continental) {
      // Continental: thick (0.55–0.85), low density (0.2–0.4)
      thickness = 0.55 + xorshift32(rng) * 0.3;
      density = 0.2 + xorshift32(rng) * 0.2;
    } else {
      // Oceanic: thin (0.1–0.35), higher density (0.55–0.85)
      // Higher density represents older, cooler oceanic lithosphere
      thickness = 0.1 + xorshift32(rng) * 0.25;
      density = 0.55 + xorshift32(rng) * 0.3;
    }

    plates.push({
      index: i,
      type,
      dx: Math.cos(angle) * magnitude,
      dy: Math.sin(angle) * magnitude,
      thickness,
      density,
      baseElevation: computeIsostasy(thickness, density),
    });
  }

  return plates;
}

// ── Boundary aggregation & classification ─────────────────────────────────

/**
 * Aggregate cell-level voronoi edges into plate-level boundaries.
 * Only edges between cells belonging to different plates are included.
 */
function aggregatePlateBoundaries(
  cellEdges: VoronoiEdge[],
  cellToPlate: Int32Array,
  plateCount: number
): { plateA: number; plateB: number; length: number }[] {
  const edgeMap = new Map<number, number>(); // packed key -> index
  const plateBoundaries: { plateA: number; plateB: number; length: number }[] = [];

  for (const edge of cellEdges) {
    const pA = cellToPlate[edge.cellA];
    const pB = cellToPlate[edge.cellB];
    if (pA === pB) continue; // intra-plate edge

    const lo = Math.min(pA, pB);
    const hi = Math.max(pA, pB);
    const key = lo * plateCount + hi;

    const idx = edgeMap.get(key);
    if (idx !== undefined) {
      plateBoundaries[idx].length += edge.length;
    } else {
      edgeMap.set(key, plateBoundaries.length);
      plateBoundaries.push({ plateA: lo, plateB: hi, length: edge.length });
    }
  }

  return plateBoundaries;
}

function deriveInteractionType(type: BoundaryType, typeA: PlateType, typeB: PlateType): InteractionType {
  const bothContinental = typeA === PlateType.Continental && typeB === PlateType.Continental;
  const bothOceanic = typeA === PlateType.Oceanic && typeB === PlateType.Oceanic;

  switch (type) {
    case BoundaryType.Convergent:
      if (bothContinental) return InteractionType.Collision;
      if (bothOceanic) return InteractionType.OceanicConvergence;
      return InteractionType.Subduction;
    case BoundaryType.Divergent:
      if (bothOceanic) return InteractionType.OceanicRidge;
      return InteractionType.ContinentalRift;
    case BoundaryType.Transform:
      return InteractionType.Transform;
  }
}

function classifyBoundaries(
  rawBoundaries: { plateA: number; plateB: number; length: number }[],
  plates: PlateProperties[],
  centroids: PlateCentroid[],
  width: number
): BoundaryInfo[] {
  const classified: { boundary: (typeof rawBoundaries)[0]; type: BoundaryType; rawIntensity: number }[] = [];
  let maxIntensity = 0;

  for (const boundary of rawBoundaries) {
    const pA = plates[boundary.plateA];
    const pB = plates[boundary.plateB];
    const cA = centroids[boundary.plateA];
    const cB = centroids[boundary.plateB];

    // Wrap-aware vector from A to B
    let nx = cB.x - cA.x;
    if (nx > width / 2) nx -= width;
    else if (nx < -width / 2) nx += width;
    const ny = cB.y - cA.y;
    const nLen = Math.sqrt(nx * nx + ny * ny);
    if (nLen === 0) continue;
    const ux = nx / nLen;
    const uy = ny / nLen;

    // Relative drift of A toward B
    const relDx = pA.dx - pB.dx;
    const relDy = pA.dy - pB.dy;

    // Project onto normal (positive = convergent)
    const vNormal = relDx * ux + relDy * uy;
    const vTanX = relDx - vNormal * ux;
    const vTanY = relDy - vNormal * uy;
    const vTangent = Math.sqrt(vTanX * vTanX + vTanY * vTanY);

    let type: BoundaryType;
    if (Math.abs(vNormal) > vTangent) {
      type = vNormal > 0 ? BoundaryType.Convergent : BoundaryType.Divergent;
    } else {
      type = BoundaryType.Transform;
    }

    const rawIntensity = Math.sqrt(relDx * relDx + relDy * relDy);
    if (rawIntensity > maxIntensity) maxIntensity = rawIntensity;

    classified.push({ boundary, type, rawIntensity });
  }

  const invMax = maxIntensity > 0 ? 1 / maxIntensity : 1;
  return classified.map(({ boundary, type, rawIntensity }) => {
    const pA = plates[boundary.plateA];
    const pB = plates[boundary.plateB];
    const interactionType = deriveInteractionType(type, pA.type, pB.type);

    // Determine which plate subducts based on density
    let subductingPlate = -1;
    if (interactionType === InteractionType.Subduction) {
      // In ocean-continent convergence, the oceanic plate always subducts
      subductingPlate = pA.type === PlateType.Oceanic ? boundary.plateA : boundary.plateB;
    } else if (interactionType === InteractionType.OceanicConvergence) {
      // In ocean-ocean convergence, the denser (older) plate subducts
      subductingPlate = pA.density >= pB.density ? boundary.plateA : boundary.plateB;
    }

    return {
      plateA: boundary.plateA,
      plateB: boundary.plateB,
      type,
      interactionType,
      intensity: rawIntensity * invMax,
      length: boundary.length,
      typeA: pA.type,
      typeB: pB.type,
      subductingPlate,
    };
  });
}

// ── Interaction-based elevation profiles ──────────────────────────────────

/**
 * Compute the elevation delta and mountain range intensity for a pixel
 * near a plate boundary, based on the physical interaction type.
 *
 * `t` is the normalized falloff (1.0 at the boundary, 0.0 at falloff edge).
 * `pixelPlateType` is the plate type of the pixel being evaluated —
 * this matters for asymmetric interactions like subduction.
 * `isSubductingSide` indicates whether this pixel belongs to the subducting plate —
 * used for asymmetric elevation in convergent boundaries.
 */
export function interactionElevation(
  interaction: InteractionType,
  pixelPlateType: PlateType,
  intensity: number,
  t: number,
  isSubductingSide = false
): { elevDelta: number; mountainRange: number } {
  const f = intensity * t;
  switch (interaction) {
    case InteractionType.Collision:
      return { elevDelta: 0.4 * f, mountainRange: 0.8 * t };
    case InteractionType.Subduction:
      if (pixelPlateType === PlateType.Continental) {
        return { elevDelta: 0.35 * f, mountainRange: 0.6 * t };
      }
      return { elevDelta: -0.15 * f, mountainRange: 0 };
    case InteractionType.OceanicConvergence:
      // Denser plate subducts → trench; lighter plate gets volcanic island arc
      if (isSubductingSide) {
        return { elevDelta: -0.12 * f, mountainRange: 0 };
      }
      return { elevDelta: 0.1 * f, mountainRange: 0.3 * t };
    case InteractionType.ContinentalRift:
      return { elevDelta: -0.1 * f, mountainRange: 0 };
    case InteractionType.OceanicRidge:
      return { elevDelta: 0.03 * f, mountainRange: 0 };
    case InteractionType.Transform:
      return { elevDelta: 0, mountainRange: 0 };
  }
}

// ── Per-interaction falloff width multipliers ────────────────────────────

/**
 * Falloff width multiplier per interaction type.
 * Collision zones (Himalayas) are wide; transform faults (San Andreas) are narrow.
 * For subduction, the overriding plate side is wider than the trench side.
 */
const FALLOFF_MULTIPLIER: Record<InteractionType, number> = {
  [InteractionType.Collision]: 1.8,
  [InteractionType.Subduction]: 1.4, // overriding (continental) side
  [InteractionType.OceanicConvergence]: 0.7,
  [InteractionType.ContinentalRift]: 1.2,
  [InteractionType.OceanicRidge]: 0.8,
  [InteractionType.Transform]: 0.35,
};

/** Subducting-side falloff is narrower (trench). */
const SUBDUCTION_TRENCH_MULTIPLIER = 0.4;

// ── Rasterization ─────────────────────────────────────────────────────────

function rasterizePlateInteractions(
  plateMap: Int32Array,
  boundaries: BoundaryInfo[],
  plates: PlateProperties[],
  width: number,
  height: number,
  falloffScale: number
): { baseElevation: Float32Array; faults: Float32Array; mountainRanges: Float32Array } {
  const size = width * height;
  const baseElevation = new Float32Array(size);
  const faults = new Float32Array(size);
  const mountainRanges = new Float32Array(size);

  const plateCount = plates.length;

  // Build boundary lookup: packed key -> boundary array index
  const boundaryMap = new Map<number, number>();
  for (let bi = 0; bi < boundaries.length; bi++) {
    const b = boundaries[bi];
    const lo = Math.min(b.plateA, b.plateB);
    const hi = Math.max(b.plateA, b.plateB);
    boundaryMap.set(lo * plateCount + hi, bi);
  }

  // Pass 1: Detect plate-boundary pixels, record highest-intensity boundary index
  const isBoundary = new Uint8Array(size);
  const nearestBoundary = new Int16Array(size).fill(-1);
  const pinnedElevation = new Float32Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const plate = plateMap[idx];

      const neighbors = [
        x > 0 ? plateMap[idx - 1] : plateMap[y * width + width - 1],
        x < width - 1 ? plateMap[idx + 1] : plateMap[y * width],
        y > 0 ? plateMap[idx - width] : -1,
        y < height - 1 ? plateMap[idx + width] : -1,
      ];

      let bestIntensity = -1;
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && neighbor !== plate) {
          const lo = Math.min(plate, neighbor);
          const hi = Math.max(plate, neighbor);
          const bi = boundaryMap.get(lo * plateCount + hi);
          if (bi !== undefined && boundaries[bi].intensity > bestIntensity) {
            bestIntensity = boundaries[bi].intensity;
            nearestBoundary[idx] = bi;
          }
        }
      }
      if (bestIntensity >= 0) {
        isBoundary[idx] = 1;

        // Pin boundary pixel elevation
        const b = boundaries[nearestBoundary[idx]];
        const plateType = plates[plate].type;
        const plateBase = plates[plate].baseElevation;
        const isSubducting = b.subductingPlate === plate;
        const { elevDelta } = interactionElevation(b.interactionType, plateType, b.intensity, 1.0, isSubducting);
        pinnedElevation[idx] = plateBase + elevDelta;
      }
    }
  }

  // Pass 2: Chamfer distance transform
  const dist = chamferDistance(isBoundary, width, height);

  // Pass 3: BFS from boundary pixels to propagate boundary index outward
  // Use the maximum possible falloff width for BFS reach, then per-pixel widths in Pass 5
  const baseFalloff = Math.max(4, Math.round(width / 64));
  const maxFalloffWidth = Math.ceil(baseFalloff * 1.8 * falloffScale); // 1.8 = largest multiplier (Collision)
  propagateBoundaryIndex(nearestBoundary, isBoundary, dist, maxFalloffWidth, width, height);

  // Pass 4: Jacobi relaxation for smooth interior elevation gradients
  // Initialize: boundary pixels pinned, interior pixels at isostatic base
  for (let i = 0; i < size; i++) {
    if (isBoundary[i]) {
      baseElevation[i] = pinnedElevation[i];
    } else {
      baseElevation[i] = plates[plateMap[i]].baseElevation;
    }
  }

  // Jacobi iterations: smooth interior while keeping boundaries pinned
  const JACOBI_ITERATIONS = 8;
  const GRAVITY_ALPHA = 0.1; // pull toward plate base — higher = flatter interiors
  const temp = new Float32Array(size);

  for (let iter = 0; iter < JACOBI_ITERATIONS; iter++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (isBoundary[idx]) {
          temp[idx] = baseElevation[idx]; // pinned
          continue;
        }

        // Average of 4 neighbors (wrap x, clamp y)
        const left = baseElevation[y * width + mod(x - 1, width)];
        const right = baseElevation[y * width + mod(x + 1, width)];
        const up = y > 0 ? baseElevation[(y - 1) * width + x] : baseElevation[idx];
        const down = y < height - 1 ? baseElevation[(y + 1) * width + x] : baseElevation[idx];
        const avg = (left + right + up + down) / 4;

        const plateBase = plates[plateMap[idx]].baseElevation;
        temp[idx] = (1 - GRAVITY_ALPHA) * avg + GRAVITY_ALPHA * plateBase;
      }
    }
    // Swap
    baseElevation.set(temp);
  }

  // Pass 5: Add interaction falloff for faults and mountainRanges,
  // and overlay interaction elevation delta on top of the gradient base.
  // Each interaction type has its own falloff width; subduction is asymmetric.
  for (let i = 0; i < size; i++) {
    const bi = nearestBoundary[i];
    if (bi < 0) continue;

    const b = boundaries[bi];
    const pixelPlate = plateMap[i];
    const isSubducting = b.subductingPlate === pixelPlate;

    // Compute per-pixel falloff width based on interaction type and side
    let multiplier = FALLOFF_MULTIPLIER[b.interactionType];
    if (b.interactionType === InteractionType.Subduction && isSubducting) {
      multiplier = SUBDUCTION_TRENCH_MULTIPLIER;
    } else if (b.interactionType === InteractionType.OceanicConvergence && isSubducting) {
      multiplier = SUBDUCTION_TRENCH_MULTIPLIER;
    }
    const effectiveFalloff = baseFalloff * multiplier * falloffScale;

    if (dist[i] >= effectiveFalloff) continue;

    const t = 1 - dist[i] / effectiveFalloff;
    const falloff = t * t; // quadratic for smoother edges

    const plateType = plates[pixelPlate].type;
    const { elevDelta, mountainRange } = interactionElevation(
      b.interactionType,
      plateType,
      b.intensity,
      falloff,
      isSubducting
    );

    // For non-boundary pixels, blend interaction delta on top of gradient base
    if (!isBoundary[i]) {
      baseElevation[i] += elevDelta;
    }
    mountainRanges[i] = mountainRange;
    faults[i] = b.intensity * falloff;
  }

  return { baseElevation, faults, mountainRanges };
}

/**
 * BFS from boundary pixels to propagate the nearest boundary index
 * outward to all pixels within falloff range.
 */
function propagateBoundaryIndex(
  nearestBoundary: Int16Array,
  isBoundary: Uint8Array,
  dist: Float32Array,
  falloffWidth: number,
  width: number,
  height: number
): void {
  const queue: number[] = [];
  const visited = new Uint8Array(width * height);

  // Seed BFS with boundary pixels
  for (let i = 0; i < isBoundary.length; i++) {
    if (isBoundary[i]) {
      visited[i] = 1;
      queue.push(i);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx - x) / width;

    const neighborOffsets = [
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
      x > 0 ? idx - 1 : y * width + width - 1,
      x < width - 1 ? idx + 1 : y * width,
    ];

    for (const nIdx of neighborOffsets) {
      if (nIdx < 0 || visited[nIdx]) continue;
      if (dist[nIdx] >= falloffWidth) continue;

      visited[nIdx] = 1;
      nearestBoundary[nIdx] = nearestBoundary[idx];
      queue.push(nIdx);
    }
  }
}

/**
 * Two-pass Chamfer distance transform.
 * Returns approximate Euclidean distance to nearest boundary pixel.
 */
function chamferDistance(isBoundary: Uint8Array, width: number, height: number): Float32Array {
  const size = width * height;
  const dist = new Float32Array(size);
  const INF = width + height;

  for (let i = 0; i < size; i++) {
    dist[i] = isBoundary[i] ? 0 : INF;
  }

  // Forward pass (top-left to bottom-right)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const left = y * width + mod(x - 1, width);
      if (dist[left] + 1 < dist[idx]) dist[idx] = dist[left] + 1;
      if (y > 0) {
        const top = (y - 1) * width + x;
        if (dist[top] + 1 < dist[idx]) dist[idx] = dist[top] + 1;
        const topLeft = (y - 1) * width + mod(x - 1, width);
        if (dist[topLeft] + 1.414 < dist[idx]) dist[idx] = dist[topLeft] + 1.414;
        const topRight = (y - 1) * width + mod(x + 1, width);
        if (dist[topRight] + 1.414 < dist[idx]) dist[idx] = dist[topRight] + 1.414;
      }
    }
  }

  // Backward pass (bottom-right to top-left)
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = y * width + x;
      const right = y * width + mod(x + 1, width);
      if (dist[right] + 1 < dist[idx]) dist[idx] = dist[right] + 1;
      if (y < height - 1) {
        const bottom = (y + 1) * width + x;
        if (dist[bottom] + 1 < dist[idx]) dist[idx] = dist[bottom] + 1;
        const bottomLeft = (y + 1) * width + mod(x - 1, width);
        if (dist[bottomLeft] + 1.414 < dist[idx]) dist[idx] = dist[bottomLeft] + 1.414;
        const bottomRight = (y + 1) * width + mod(x + 1, width);
        if (dist[bottomRight] + 1.414 < dist[idx]) dist[idx] = dist[bottomRight] + 1.414;
      }
    }
  }

  return dist;
}

// ── Main entry point ─────────────────────────────────────────────────────

export function generateTectonicPlates(
  width: number,
  height: number,
  nv: NoiseVariables,
  tv: TectonicVariables
): TectonicResult {
  const { plateCount, cellCount, relaxationIterations } = tv;
  const rng = { s: (nv.seed ^ 0xabcdef01) | 1 };

  // Step 1: Fine-grained Voronoi tessellation
  const voronoi = generateVoronoi({
    width,
    height,
    seedCount: cellCount,
    seed: nv.seed,
    relaxationIterations,
    wrapX: true,
  });
  const { cells: cellMap, seeds } = voronoi;

  // Step 2: Build cell adjacency graph
  const graph = buildVoronoiGraph(cellMap, width, height, cellCount, true);

  // Step 3: Group cells into plates
  const targetFractions = generateSizeDistribution(plateCount, rng);
  const plateSeeds = selectPlateSeeds(seeds, cellCount, plateCount, width, targetFractions, graph.neighbors, rng);
  const cellToPlate = groupCellsIntoPlates(graph.neighbors, cellCount, plateCount, plateSeeds, targetFractions);

  // Step 4: Build pixel-level plate map
  const plateMap = new Int32Array(width * height);
  for (let i = 0; i < plateMap.length; i++) {
    plateMap[i] = cellToPlate[cellMap[i]];
  }

  // Step 5: Compute plate centroids and assign properties
  const centroids = computePlateCentroids(seeds, cellToPlate, cellCount, plateCount, width);
  const plates = assignPlateProperties(centroids, plateCount, width, nv.seed);

  // Step 6: Aggregate and classify plate-level boundaries
  const rawBoundaries = aggregatePlateBoundaries(graph.edges, cellToPlate, plateCount);
  const boundaries = classifyBoundaries(rawBoundaries, plates, centroids, width);

  // Step 7: Rasterize interactions into baseElevation, faults, and mountainRanges
  const { baseElevation, faults, mountainRanges } = rasterizePlateInteractions(
    plateMap,
    boundaries,
    plates,
    width,
    height,
    tv.boundaryFalloffScale
  );

  return { baseElevation, faults, mountainRanges, plateMap, plates, boundaries };
}
