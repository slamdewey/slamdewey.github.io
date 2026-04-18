import { OpenSimplexNoise, fBm3D } from '../open-simplex-noise';
import { map, mapToUnsignedRange, lerp, cylindricalSx, cylindricalCx } from '../math-utils';
import { NoiseVariables } from '../types';

export interface ElevationResult {
  elevation: Float32Array;
  seaLevel: number;
}

export function generateElevation(
  width: number,
  height: number,
  faults: Float32Array,
  nv: NoiseVariables
): ElevationResult {
  const noise = new OpenSimplexNoise(nv.seed);
  const elevation = new Float32Array(width * height);

  const yScale = (2 * Math.PI) / width;
  const baseFreq = nv.frequency * 0.5;

  let min = Infinity,
    max = -Infinity;

  for (let y = 0; y < height; y++) {
    const ny = y * yScale;
    for (let x = 0; x < width; x++) {
      const sx = cylindricalSx(x, width);
      const cx = cylindricalCx(x, width);

      let n = fBm3D(noise, sx, ny, cx, nv.octaves, baseFreq, nv.persistence, nv.lacunarity);
      n = mapToUnsignedRange(n);

      const idx = y * width + x;
      elevation[idx] = lerp(n, faults[idx], 0.5);

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
