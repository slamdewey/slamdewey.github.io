import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { map, cylindricalSx, cylindricalCx } from '@lib/math';
import { NoiseVariables } from '../types';

export function generateTemperature(
  width: number,
  height: number,
  elevation: Float32Array,
  seaLevel: number,
  nv: NoiseVariables,
  oceanTempModifier: Float32Array,
  distToOcean: Float32Array
): Float32Array {
  const noise = new OpenSimplexNoise((nv.seed ^ 0xf88f88f8) | 0);
  const temperature = new Float32Array(width * height);

  const yScale = (2 * Math.PI) / width;
  const jitterFreq = nv.frequency * 1.5;

  // Max influence distance: pixels beyond this are fully "inland"
  const maxOceanInfluence = Math.round(width / 8);

  for (let y = 0; y < height; y++) {
    const ny = y * yScale;
    // Inverse parabola: T(y) = 1 - (2y/height - 1)^2
    // Use raw y/height for latitude (geographic, not noise-space)
    const latitudeTemp = 1 - Math.pow((2 * y) / height - 1, 2);

    // Ocean baseline at this latitude — gets per-cell adjustment from currents.
    const baseOceanTemp = latitudeTemp * 0.8;

    for (let x = 0; x < width; x++) {
      const sx = cylindricalSx(x, width);
      const cx = cylindricalCx(x, width);

      const idx = y * width + x;
      let temp = latitudeTemp;

      // Add noise jitter
      const n = fBm3D(noise, sx, ny, cx, 1, jitterFreq, 1, 1);
      temp *= map(n, -1, 1, 0.75, 1);

      if (elevation[idx] > seaLevel) {
        // Lapse rate: temperature decreases with elevation
        temp *= 1 - elevation[idx] * 0.3;

        // Coastal moderation: blend toward the (current-adjusted) ocean
        // temperature of the nearest ocean cell. The modifier is already
        // scaled by proximity in the propagation pass.
        const proximity = Math.min(distToOcean[idx] / maxOceanInfluence, 1);
        const moderationStrength = (1 - proximity) * 0.3;
        const localOceanTemp = baseOceanTemp + oceanTempModifier[idx];
        temp = temp * (1 - moderationStrength) + localOceanTemp * moderationStrength;
      } else {
        // Water is cooler; apply current-driven heat advection directly.
        temp = temp * (4 / 5) + oceanTempModifier[idx];
      }

      temperature[idx] = temp;
    }
  }

  return temperature;
}
