import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { map, mod, cylindricalSx, cylindricalCx } from '@lib/math';
import { NoiseVariables, TectonicVariables } from '../types';
import { TectonicResult } from './tectonic-plates';

export interface ElevationResult {
  elevation: Float32Array;
  seaLevel: number;
}

export function generateElevation(
  width: number,
  height: number,
  tectonic: TectonicResult,
  nv: NoiseVariables,
  tv: TectonicVariables
): ElevationResult {
  const noise = new OpenSimplexNoise(nv.seed);
  const warpNoiseX = new OpenSimplexNoise((nv.seed ^ 0x5eeda7a1) | 0);
  const warpNoiseY = new OpenSimplexNoise((nv.seed ^ 0x7a7f1337) | 0);
  const elevation = new Float32Array(width * height);

  const yScale = (2 * Math.PI) / width;
  const baseFreq = nv.frequency * 0.5;
  // Warp frequency is expressed directly in unit-circle cycles-per-map (not
  // multiplied by baseFreq), so a single slider setting produces a predictable
  // pixel-scale feature size regardless of the elevation detail frequency.
  // Feature size ≈ width / (2π · warpFreq) — default 4.0 gives ~40 px at
  // width=1024, which is small enough to zigzag a continental margin without
  // disintegrating it.
  const warpFreq = nv.frequency * tv.coastlineWarpFrequency;

  // Fix A: domain-warped sample of tectonic.baseElevation. Straight Voronoi
  // edges become dendritic because each pixel reads the plate field at a
  // noise-offset position. Warp magnitude scales with the characteristic plate
  // radius so warping can reach across a cell without over-smearing.
  const plateRadius = Math.sqrt((width * height) / Math.max(1, tectonic.plates.length));
  const warpAmp = tv.coastlineWarpAmplitude * plateRadius;

  let min = Infinity,
    max = -Infinity;

  for (let y = 0; y < height; y++) {
    const ny = y * yScale;
    for (let x = 0; x < width; x++) {
      const sx = cylindricalSx(x, width);
      const cx = cylindricalCx(x, width);

      const idx = y * width + x;

      const wx = warpNoiseX.eval3D(sx * warpFreq, ny * warpFreq, cx * warpFreq) * warpAmp;
      const wy = warpNoiseY.eval3D(sx * warpFreq, ny * warpFreq, cx * warpFreq) * warpAmp;
      const base = sampleBaseElevationBilinear(tectonic.baseElevation, width, height, x + wx, y + wy);

      // Layer noise for terrain detail
      const n = fBm3D(noise, sx, ny, cx, nv.octaves, baseFreq, nv.persistence, nv.lacunarity);
      elevation[idx] = base + n * 0.8;

      if (elevation[idx] > max) max = elevation[idx];
      if (elevation[idx] < min) min = elevation[idx];
    }
  }

  // Normalize to [-1, 1]
  for (let i = 0; i < elevation.length; i++) {
    elevation[i] = map(elevation[i], min, max, -1, 1);
  }

  const seaLevel = getSeaLevel(elevation, nv.waterPercentage);
  return { elevation, seaLevel };
}

function getSeaLevel(data: Float32Array, percentile: number): number {
  const sorted = Float32Array.from(data).sort();
  return sorted[Math.floor(percentile * (sorted.length - 1))];
}

/** Bilinear sample of baseElevation at a (possibly fractional) image position.
 *  Wraps in X (cylindrical) and clamps in Y. */
function sampleBaseElevationBilinear(base: Float32Array, width: number, height: number, x: number, y: number): number {
  const yc = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(x);
  const y0 = Math.floor(yc);
  const fx = x - x0;
  const fy = yc - y0;
  const x0w = mod(x0, width);
  const x1w = mod(x0 + 1, width);
  const y0c = Math.max(0, Math.min(height - 1, y0));
  const y1c = Math.max(0, Math.min(height - 1, y0 + 1));
  const a = base[y0c * width + x0w];
  const b = base[y0c * width + x1w];
  const c = base[y1c * width + x0w];
  const d = base[y1c * width + x1w];
  const ab = a * (1 - fx) + b * fx;
  const cd = c * (1 - fx) + d * fx;
  return ab * (1 - fy) + cd * fy;
}
