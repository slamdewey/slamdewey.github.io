import { OpenSimplexNoise } from '@lib/noise';
import { mod } from '@lib/math';

export interface VoronoiSeed {
  x: number;
  y: number;
}

export interface VoronoiConfig {
  width: number;
  height: number;
  seedCount: number;
  noiseSeed: number;
  /** Amplitude of noise displacement on cell boundaries, in pixels. 0 = pure Voronoi. */
  noiseAmplitude: number;
  /** Frequency of the boundary noise. Higher = more jagged edges. */
  noiseFrequency: number;
  /** Number of Lloyd relaxation iterations. 0 = raw random placement. */
  relaxationIterations: number;
  /** Whether the x-axis wraps (cylindrical topology). */
  wrapX: boolean;
}

export interface VoronoiResult {
  /** Per-pixel cell assignment (index into seeds array). */
  cells: Int32Array;
  /** Per-pixel boundary strength [0, 1]. Higher = closer to a cell boundary. */
  boundaries: Float32Array;
  /** The final seed positions after relaxation. */
  seeds: VoronoiSeed[];
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
  const rng = { s: config.noiseSeed | 1 }; // ensure non-zero
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
    // Assign cells with current seeds (no noise during relaxation)
    assignCells(current, cells, width, height, wrapX, null, 0, 0);

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
 * Assign each pixel to its nearest seed. Optionally applies noise to the
 * distance metric to create organic, irregular cell boundaries.
 *
 * Each seed gets its own noise field (offset in noise space by seed index)
 * so every boundary between any pair of seeds is independently perturbed.
 *
 * Uses linear distance so that noiseAmplitude directly corresponds to
 * pixel displacement of boundaries.
 *
 * Also computes boundary strength: how close the nearest two seeds are
 * in distance (normalized). A pixel far from any boundary → 0, on a
 * boundary → 1.
 */
function assignCells(
  seeds: VoronoiSeed[],
  cells: Int32Array,
  width: number,
  height: number,
  wrapX: boolean,
  noise: OpenSimplexNoise | null,
  noiseAmplitude: number,
  noiseFrequency: number
): Float32Array {
  const boundaries = new Float32Array(width * height);
  const n = seeds.length;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      let minDist = Infinity;
      let secondDist = Infinity;
      let closest = 0;

      for (let i = 0; i < n; i++) {
        let d = dist(x, y, seeds[i].x, seeds[i].y, width, wrapX);

        // Per-seed noise: each seed samples a unique noise field, so every
        // boundary between any pair of seeds gets independent perturbation.
        // Uses linear distance so amplitude = pixels of displacement.
        // When wrapX is on, sample 3D noise on a cylinder so boundaries
        // wrap seamlessly at the left/right edges.
        if (noise && noiseAmplitude > 0) {
          if (wrapX) {
            const angle = (x / width) * Math.PI * 2;
            const r = (width * noiseFrequency) / (Math.PI * 2);
            d += noise.eval3D(Math.cos(angle) * r + i * 100, Math.sin(angle) * r, y * noiseFrequency) * noiseAmplitude;
          } else {
            d += noise.eval2D(x * noiseFrequency + i * 100, y * noiseFrequency) * noiseAmplitude;
          }
        }

        if (d < minDist) {
          secondDist = minDist;
          minDist = d;
          closest = i;
        } else if (d < secondDist) {
          secondDist = d;
        }
      }

      cells[idx] = closest;

      // Boundary strength: ratio of how close the two nearest seeds are
      if (secondDist > 0) {
        boundaries[idx] = 1 - (secondDist - minDist) / secondDist;
      } else {
        boundaries[idx] = 1;
      }
    }
  }

  return boundaries;
}

/**
 * Generate a Voronoi tessellation with optional noise-perturbed boundaries
 * and Lloyd relaxation for more uniform cell sizes.
 */
export function generateVoronoi(config: VoronoiConfig): VoronoiResult {
  const { width, height, wrapX, noiseAmplitude, noiseFrequency, noiseSeed } = config;
  const totalPixels = width * height;
  const cells = new Int32Array(totalPixels);

  // Generate and relax seeds
  let seeds = generateSeeds(config);
  if (config.relaxationIterations > 0) {
    seeds = lloydRelax(seeds, cells, width, height, wrapX, config.relaxationIterations);
  }

  // Final assignment with noise
  const noise = noiseAmplitude > 0 ? new OpenSimplexNoise(noiseSeed) : null;
  const boundaries = assignCells(seeds, cells, width, height, wrapX, noise, noiseAmplitude, noiseFrequency);

  return { cells, boundaries, seeds };
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
 * Render the boundary strength field as a grayscale RGBA image.
 * White = strong boundary, black = cell interior.
 */
export function voronoiBoundariesToRGBA(result: VoronoiResult, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = (result.boundaries[i] * 255) | 0;
    const out = i * 4;
    rgba[out] = v;
    rgba[out + 1] = v;
    rgba[out + 2] = v;
    rgba[out + 3] = 255;
  }
  return rgba;
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
