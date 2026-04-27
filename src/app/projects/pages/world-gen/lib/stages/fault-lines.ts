import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { map, mapToUnsignedRange, sphericalEmbed3D } from '@lib/math';
import { NoiseVariables } from '../types';

export interface FaultLineResult {
  faults: Float32Array;
  mountainRanges: Float32Array;
}

/**
 * Generate tectonic fault lines and mountain range markers.
 *
 * Sampled with the spherical 3D embedding so features keep constant
 * arc-length size on the globe — no polar squash, no equator-vs-pole bias.
 */
export function generateFaultLines(width: number, height: number, nv: NoiseVariables): FaultLineResult {
  const rNoise = new OpenSimplexNoise((nv.seed ^ 0xfeefcaab) | 0);
  const fNoise = new OpenSimplexNoise((nv.seed ^ 0xfabebefa) | 0);

  const faults = new Float32Array(width * height);
  const mountainRanges = new Float32Array(width * height);

  // Base frequencies — multiplied by user's frequency parameter
  const plateFreq = nv.frequency * 0.5;
  const ridgeFreq = nv.frequency * 1.5;

  let plateMin = Infinity,
    plateMax = -Infinity;
  let ridgeMin = Infinity,
    ridgeMax = -Infinity;

  const plateRaw = new Float32Array(width * height);
  const ridgeRaw = new Float32Array(width * height);

  const np = new Float32Array(3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sphericalEmbed3D(x, y, width, height, np);

      const plateNoise = fBm3D(fNoise, np[0], np[1], np[2], 4, plateFreq, nv.persistence, nv.lacunarity);

      let ridgeNoise = fBm3D(rNoise, np[0], np[1], np[2], 6, ridgeFreq, 0.6, nv.lacunarity);
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
