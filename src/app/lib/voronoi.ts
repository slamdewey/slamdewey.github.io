import { mod } from '@lib/math';

export interface VoronoiSeed {
  x: number;
  y: number;
}

export interface VoronoiConfig {
  width: number;
  height: number;
  seedCount: number;
  seed: number;
  /** Number of Lloyd relaxation iterations. 0 = raw random placement. */
  relaxationIterations: number;
  /** Whether the x-axis wraps (cylindrical topology). */
  wrapX: boolean;
}

export interface VoronoiResult {
  /** Per-pixel cell assignment (index into seeds array). */
  cells: Int32Array;
  /** The final seed positions after relaxation. */
  seeds: VoronoiSeed[];
}

export interface VoronoiEdge {
  /** Index of the first cell. */
  cellA: number;
  /** Index of the second cell. */
  cellB: number;
  /** Length of the shared boundary in pixels. */
  length: number;
}

export interface VoronoiGraph {
  /** For each cell, the indices of its neighbors. */
  neighbors: number[][];
  /** All edges between adjacent cells. */
  edges: VoronoiEdge[];
}

/**
 * Simple seeded PRNG (xorshift32) for deterministic seed placement.
 */
function xorshift32(state: { s: number }): number {
  let s = state.s;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  state.s = s;
  return (s >>> 0) / 0xffffffff;
}

/**
 * Distance between two points, with optional x-axis wrapping.
 */
function dist(ax: number, ay: number, bx: number, by: number, width: number, wrapX: boolean): number {
  let dx = ax - bx;
  if (wrapX) {
    if (dx > width / 2) dx -= width;
    else if (dx < -width / 2) dx += width;
  }
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Generate initial seed points with deterministic random placement.
 */
function generateSeeds(config: VoronoiConfig): VoronoiSeed[] {
  const rng = { s: config.seed | 1 }; // ensure non-zero
  const seeds: VoronoiSeed[] = [];
  for (let i = 0; i < config.seedCount; i++) {
    seeds.push({
      x: xorshift32(rng) * config.width,
      y: xorshift32(rng) * config.height,
    });
  }
  return seeds;
}

/** Relaxation factor: each iteration moves seeds this fraction toward the centroid. */
const RELAXATION_FACTOR = 0.5;

/**
 * Lloyd relaxation: move each seed toward the centroid of its cell.
 * Uses partial relaxation (lerp by RELAXATION_FACTOR) so convergence
 * is gradual over many iterations rather than snapping after one.
 */
function lloydRelax(
  seeds: VoronoiSeed[],
  cells: Int32Array,
  width: number,
  height: number,
  wrapX: boolean,
  iterations: number
): VoronoiSeed[] {
  const current = seeds.map((s) => ({ ...s }));

  for (let iter = 0; iter < iterations; iter++) {
    assignCells(current, cells, width, height, wrapX);

    // Compute centroids using circular averaging for wrapped x
    const sumX = new Float64Array(current.length);
    const sumY = new Float64Array(current.length);
    const counts = new Int32Array(current.length);

    // For wrapped x, use angular averaging
    const sinSum = wrapX ? new Float64Array(current.length) : null;
    const cosSum = wrapX ? new Float64Array(current.length) : null;
    const TWO_PI = Math.PI * 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = cells[y * width + x];
        counts[cell]++;
        sumY[cell] += y;
        if (wrapX) {
          const angle = (x / width) * TWO_PI;
          sinSum![cell] += Math.sin(angle);
          cosSum![cell] += Math.cos(angle);
        } else {
          sumX[cell] += x;
        }
      }
    }

    for (let i = 0; i < current.length; i++) {
      if (counts[i] === 0) continue;

      let centroidX: number;
      if (wrapX) {
        const avgAngle = Math.atan2(sinSum![i], cosSum![i]);
        centroidX = mod((avgAngle / TWO_PI) * width, width);
      } else {
        centroidX = sumX[i] / counts[i];
      }
      const centroidY = sumY[i] / counts[i];

      // Partial relaxation: lerp toward centroid instead of jumping
      if (wrapX) {
        // Wrap-aware lerp for x
        let dx = centroidX - current[i].x;
        if (dx > width / 2) dx -= width;
        else if (dx < -width / 2) dx += width;
        current[i].x = mod(current[i].x + dx * RELAXATION_FACTOR, width);
      } else {
        current[i].x += (centroidX - current[i].x) * RELAXATION_FACTOR;
      }
      current[i].y += (centroidY - current[i].y) * RELAXATION_FACTOR;
    }
  }

  return current;
}

/**
 * Assign each pixel to its nearest seed.
 */
function assignCells(seeds: VoronoiSeed[], cells: Int32Array, width: number, height: number, wrapX: boolean): void {
  const n = seeds.length;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let minDist = Infinity;
      let closest = 0;

      for (let i = 0; i < n; i++) {
        const d = dist(x, y, seeds[i].x, seeds[i].y, width, wrapX);
        if (d < minDist) {
          minDist = d;
          closest = i;
        }
      }

      cells[idx] = closest;
    }
  }
}

/**
 * Generate a Voronoi tessellation with Lloyd relaxation
 * for more uniform cell sizes.
 */
export function generateVoronoi(config: VoronoiConfig): VoronoiResult {
  const { width, height, wrapX } = config;
  const cells = new Int32Array(width * height);

  let seeds = generateSeeds(config);
  if (config.relaxationIterations > 0) {
    seeds = lloydRelax(seeds, cells, width, height, wrapX, config.relaxationIterations);
  }

  assignCells(seeds, cells, width, height, wrapX);

  return { cells, seeds };
}

/**
 * Convert a VoronoiResult to an RGBA image for visualization.
 * Each cell gets a deterministic color derived from its index.
 * Boundaries are detected via edge detection (neighbor cell mismatch)
 * for clean, uniform 1px borders.
 */
export function voronoiToRGBA(
  result: VoronoiResult,
  width: number,
  height: number,
  showBoundaries: boolean
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);

  // Generate distinct colors for each cell using golden ratio hue spacing
  const cellColors = result.seeds.map((_, i) => {
    const hue = (i * 137.508) % 360; // golden angle
    return hslToRgb(hue / 360, 0.55, 0.55);
  });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = result.cells[idx];
      const [r, g, b] = cellColors[cell];
      const out = idx * 4;

      let isBorder = false;
      if (showBoundaries) {
        // Edge detection: check if any cardinal neighbor has a different cell
        if (x > 0 && result.cells[idx - 1] !== cell) isBorder = true;
        else if (x < width - 1 && result.cells[idx + 1] !== cell) isBorder = true;
        else if (y > 0 && result.cells[idx - width] !== cell) isBorder = true;
        else if (y < height - 1 && result.cells[idx + width] !== cell) isBorder = true;
      }

      if (isBorder) {
        rgba[out] = 20;
        rgba[out + 1] = 20;
        rgba[out + 2] = 20;
      } else {
        rgba[out] = r;
        rgba[out + 1] = g;
        rgba[out + 2] = b;
      }
      rgba[out + 3] = 255;
    }
  }

  return rgba;
}

/**
 * Build a cell adjacency graph from a Voronoi result.
 * Scans the cell map for neighboring pixels that belong to different cells,
 * producing an edge list and per-cell neighbor lists. When wrapX is true,
 * the left and right edges of the map are treated as adjacent.
 */
export function buildVoronoiGraph(
  cells: Int32Array,
  width: number,
  height: number,
  seedCount: number,
  wrapX: boolean
): VoronoiGraph {
  const edgeMap = new Map<number, number>(); // packed key -> edge index
  const edges: VoronoiEdge[] = [];
  const neighbors: number[][] = Array.from({ length: seedCount }, () => []);

  const addEdge = (a: number, b: number): void => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * seedCount + hi;
    const idx = edgeMap.get(key);
    if (idx !== undefined) {
      edges[idx].length++;
    } else {
      edgeMap.set(key, edges.length);
      neighbors[lo].push(hi);
      neighbors[hi].push(lo);
      edges.push({ cellA: lo, cellB: hi, length: 1 });
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = cells[idx];

      // Right neighbor
      if (x < width - 1) {
        const right = cells[idx + 1];
        if (right !== cell) addEdge(cell, right);
      } else if (wrapX) {
        const wrapped = cells[y * width];
        if (wrapped !== cell) addEdge(cell, wrapped);
      }

      // Bottom neighbor
      if (y < height - 1) {
        const below = cells[idx + width];
        if (below !== cell) addEdge(cell, below);
      }
    }
  }

  return { neighbors, edges };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;
  const sector = (h * 6) | 0;
  switch (sector % 6) {
    case 0:
      r = c;
      g = x;
      break;
    case 1:
      r = x;
      g = c;
      break;
    case 2:
      g = c;
      b = x;
      break;
    case 3:
      g = x;
      b = c;
      break;
    case 4:
      r = x;
      b = c;
      break;
    case 5:
      r = c;
      b = x;
      break;
  }

  return [((r + m) * 255) | 0, ((g + m) * 255) | 0, ((b + m) * 255) | 0];
}
