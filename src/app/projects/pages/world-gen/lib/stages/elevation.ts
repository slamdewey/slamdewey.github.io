import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { map, cylindricalSx, cylindricalCx } from '@lib/math';
import { NoiseVariables } from '../types';
import { TectonicResult } from './tectonic-plates';

export interface ElevationResult {
  elevation: Float32Array;
  seaLevel: number;
}

export function generateElevation(
  width: number,
  height: number,
  tectonic: TectonicResult,
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

      const idx = y * width + x;

      // Tectonic base elevation already encodes plate type and interaction profiles
      const base = tectonic.baseElevation[idx];

      // Layer noise for terrain detail
      const n = fBm3D(noise, sx, ny, cx, nv.octaves, baseFreq, nv.persistence, nv.lacunarity);
      elevation[idx] = base + n * 0.2;

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
