import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { map, mod, cylindricalSx, cylindricalCx } from '@lib/math';
import { NoiseVariables } from '../types';

/**
 * Two-pass chamfer distance from ocean pixels.
 * Returns approximate Euclidean distance to the nearest ocean pixel.
 * Wraps on the x-axis.
 */
function oceanDistance(elevation: Float32Array, seaLevel: number, width: number, height: number): Float32Array {
  const size = width * height;
  const dist = new Float32Array(size);
  const INF = width + height;

  for (let i = 0; i < size; i++) {
    dist[i] = elevation[i] <= seaLevel ? 0 : INF;
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

export function generateTemperature(
  width: number,
  height: number,
  elevation: Float32Array,
  seaLevel: number,
  nv: NoiseVariables
): Float32Array {
  const noise = new OpenSimplexNoise((nv.seed ^ 0xf88f88f8) | 0);
  const temperature = new Float32Array(width * height);

  const yScale = (2 * Math.PI) / width;
  const jitterFreq = nv.frequency * 1.5;

  // Compute distance-to-ocean for continentality moderation
  const distToOcean = oceanDistance(elevation, seaLevel, width, height);

  // Max influence distance: pixels beyond this are fully "inland"
  const maxOceanInfluence = Math.round(width / 8);

  for (let y = 0; y < height; y++) {
    const ny = y * yScale;
    // Inverse parabola: T(y) = 1 - (2y/height - 1)^2
    // Use raw y/height for latitude (geographic, not noise-space)
    const latitudeTemp = 1 - Math.pow((2 * y) / height - 1, 2);

    // Ocean temperature at this latitude (moderate baseline)
    const oceanTemp = latitudeTemp * 0.8;

    for (let x = 0; x < width; x++) {
      const sx = cylindricalSx(x, width);
      const cx = cylindricalCx(x, width);

      const idx = y * width + x;
      let temp = latitudeTemp;

      // Add noise jitter
      const n = fBm3D(noise, sx, ny, cx, 1, jitterFreq, 1, 1);
      temp *= map(n, -1, 1, 0.75, 1);

      // Elevation effects
      if (elevation[idx] > seaLevel) {
        // Lapse rate: temperature decreases with elevation
        temp *= 1 - elevation[idx] * 0.3;

        // Ocean proximity moderation: coastal areas have moderated temperatures
        // (less extreme than inland). Blend toward ocean temp based on proximity.
        const proximity = Math.min(distToOcean[idx] / maxOceanInfluence, 1);
        // proximity 0 = coast (full moderation), 1 = deep inland (no moderation)
        const moderationStrength = (1 - proximity) * 0.3;
        temp = temp * (1 - moderationStrength) + oceanTemp * moderationStrength;
      } else {
        // Water is cooler
        temp *= 4 / 5;
      }

      temperature[idx] = temp;
    }
  }

  return temperature;
}
