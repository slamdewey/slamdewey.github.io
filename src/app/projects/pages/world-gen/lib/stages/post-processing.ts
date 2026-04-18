import { map, mod } from '@lib/math';

const SHALLOW_WATER_RANGE = 0.1;
const DEEP_WATER_DIFFERENCE = 0.2;

export function applyMountainRangesAndContinentalShelves(
  width: number,
  height: number,
  elevation: Float32Array,
  mountainRanges: Float32Array,
  seaLevel: number
): void {
  const shallowWaterLevel = seaLevel - SHALLOW_WATER_RANGE;
  const deepWaterLevel = shallowWaterLevel - DEEP_WATER_DIFFERENCE;

  // Dilate mountain ranges: 3x3 max filter to widen ridges
  const dilated = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let maxVal = mountainRanges[idx];
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = mod(x + dx, width);
          const nv = mountainRanges[ny * width + nx];
          if (nv > maxVal) maxVal = nv;
        }
      }
      dilated[idx] = maxVal;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (elevation[idx] < shallowWaterLevel) {
        // Depth gradient for underwater terrain
        elevation[idx] = map(elevation[idx], -1, shallowWaterLevel, -1, deepWaterLevel);
      } else if (elevation[idx] > seaLevel) {
        // Boost elevation towards 1.0 based on dilated mountain intensity
        const boost = dilated[idx];
        if (boost > 0) {
          elevation[idx] = elevation[idx] + boost * (1 - elevation[idx]) * 0.6;
        }
      }
    }
  }
}
