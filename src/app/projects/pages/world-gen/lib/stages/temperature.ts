import { OpenSimplexNoise, fBm3D } from '../open-simplex-noise';
import { map, cylindricalSx, cylindricalCx } from '../math-utils';
import { NoiseVariables } from '../types';

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

  for (let y = 0; y < height; y++) {
    const ny = y * yScale;
    // Inverse parabola: T(y) = 1 - (2y/height - 1)^2
    // Use raw y/height for latitude (geographic, not noise-space)
    const latitudeTemp = 1 - Math.pow((2 * y) / height - 1, 2);

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
      } else {
        // Water is cooler
        temp *= 4 / 5;
      }

      temperature[idx] = temp;
    }
  }

  return temperature;
}
