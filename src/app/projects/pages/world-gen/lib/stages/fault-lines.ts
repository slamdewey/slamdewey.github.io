import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { map, mapToUnsignedRange, cylindricalSx, cylindricalCx } from '@lib/math';
import { NoiseVariables } from '../types';

export interface FaultLineResult {
  faults: Float32Array;
  mountainRanges: Float32Array;
}

/**
 * Generate tectonic fault lines and mountain range markers.
 *
 * Coordinates: sx ∈ [-1,1], ny scaled so noise-step-per-pixel matches
 * the cylindrical mapping, cx ∈ [-1,1].  This keeps features isotropic.
 */
export function generateFaultLines(width: number, height: number, nv: NoiseVariables): FaultLineResult {
  const rNoise = new OpenSimplexNoise((nv.seed ^ 0xfeefcaab) | 0);
  const fNoise = new OpenSimplexNoise((nv.seed ^ 0xfabebefa) | 0);

  const faults = new Float32Array(width * height);
  const mountainRanges = new Float32Array(width * height);

  // Scale y so per-pixel noise step equals the cylindrical x step (2π/width)
  const yScale = (2 * Math.PI) / width;

  // Base frequencies — multiplied by user's frequency parameter
  const plateFreq = nv.frequency * 0.5;
  const ridgeFreq = nv.frequency * 1.5;

  let plateMin = Infinity,
    plateMax = -Infinity;
  let ridgeMin = Infinity,
    ridgeMax = -Infinity;

  const plateRaw = new Float32Array(width * height);
  const ridgeRaw = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const ny = y * yScale;
    for (let x = 0; x < width; x++) {
      const sx = cylindricalSx(x, width);
      const cx = cylindricalCx(x, width);

      const plateNoise = fBm3D(fNoise, sx, ny, cx, 4, plateFreq, nv.persistence, nv.lacunarity);

      let ridgeNoise = fBm3D(rNoise, sx, ny, cx, 6, ridgeFreq, 0.6, nv.lacunarity);
      ridgeNoise = 1 - Math.abs(ridgeNoise);
      ridgeNoise = Math.pow(ridgeNoise, 3);

      const idx = y * width + x;
      plateRaw[idx] = plateNoise;
      ridgeRaw[idx] = ridgeNoise;

      if (ridgeNoise < ridgeMin) ridgeMin = ridgeNoise;
      if (ridgeNoise > ridgeMax) ridgeMax = ridgeNoise;
      if (plateNoise < plateMin) plateMin = plateNoise;
      if (plateNoise > plateMax) plateMax = plateNoise;
    }
  }

  // Second pass: normalize and combine
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const plateNoise = map(plateRaw[idx], plateMin, plateMax, -1, 1);
      const ridgeNoise = map(ridgeRaw[idx], ridgeMin, ridgeMax, 0, 1);

      faults[idx] = mapToUnsignedRange(ridgeNoise * plateNoise);
      // Gradient mountain intensity instead of binary — wider, smoother ranges
      mountainRanges[idx] = Math.pow(ridgeNoise, 3) * Math.max(0, plateNoise);
    }
  }

  return { faults, mountainRanges };
}
