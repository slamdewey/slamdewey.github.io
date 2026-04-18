import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { map, cylindricalSx, cylindricalCx } from '@lib/math';
import { NoiseVariables } from '../types';
import { TectonicResult, PlateType } from './tectonic-plates';

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

      // Base elevation from plate type
      const plate = tectonic.plates[tectonic.plateMap[idx]];
      const isContinental = plate.type === PlateType.Continental;
      const base = isContinental ? 0.25 : -0.35;

      // Boundary contribution — scale by plate type so oceanic boundaries
      // create subtle underwater ridges rather than surface mountains
      const boundaryScale = isContinental ? 0.5 : 0.1;
      const boundaryContrib = tectonic.faults[idx] * boundaryScale;

      // Noise variation — oceanic floors are smoother than continental terrain
      const n = fBm3D(noise, sx, ny, cx, nv.octaves, baseFreq, nv.persistence, nv.lacunarity);
      const noiseScale = isContinental ? 0.3 : 0.15;
      const noiseContrib = n * noiseScale;

      elevation[idx] = base + boundaryContrib + noiseContrib;

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
