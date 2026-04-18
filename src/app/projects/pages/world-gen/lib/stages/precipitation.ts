import { clamp, map, mod, sign } from '@lib/math';
import { ClimateVariables } from '../types';

export function generatePrecipitation(
  width: number,
  height: number,
  wind: Float32Array,
  elevation: Float32Array,
  temperature: Float32Array,
  seaLevel: number,
  cv: ClimateVariables
): Float32Array {
  const precipitation = new Float32Array(width * height);

  // Setup pass: compute PET (Potential EvapoTranspiration)
  for (let y = 0; y < height; y++) {
    const yPercent = y / height;
    let pet = (-2 * Math.cos(3 * Math.PI * 2 * yPercent)) / 3;
    pet = map(-pet, -1, 1, 0.7, 1);

    for (let x = 0; x < width; x++) {
      precipitation[y * width + x] = pet;
    }
  }

  simulatePrecipitation(width, height, precipitation, wind, elevation, temperature, seaLevel, cv);
  return precipitation;
}

function simulatePrecipitation(
  width: number,
  height: number,
  precipitation: Float32Array,
  wind: Float32Array,
  elevation: Float32Array,
  temperature: Float32Array,
  seaLevel: number,
  cv: ClimateVariables
): void {
  const size = width * height;
  const curMoisture = new Float32Array(size);
  const curClouds = new Float32Array(size);
  const nextMoisture = new Float32Array(size);
  const nextClouds = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    if (elevation[i] < seaLevel) {
      curMoisture[i] = 1;
      curClouds[i] = 1;
    } else {
      curMoisture[i] = cv.initialMoisture;
      curClouds[i] = cv.initialMoisture;
    }
  }

  for (let s = 0; s < cv.climateCycles; s++) {
    nextMoisture.fill(0);
    nextClouds.fill(0);

    for (let y = 0; y < height; y++) {
      // Find starting ocean cell for this row (process in wind direction)
      let xStart = 0;
      for (let x = 0; x < width; x++) {
        if (elevation[y * width + x] < seaLevel) {
          xStart = x;
          break;
        }
      }

      for (let xPosOff = 0; xPosOff < width; xPosOff++) {
        const x = mod(xStart + xPosOff, width);
        const idx = y * width + x;

        let cMoisture = curMoisture[idx];
        let cClouds = curClouds[idx];
        let nMoisture = nextMoisture[idx];

        // Evaporation
        if (elevation[idx] < seaLevel) {
          cMoisture = 1;
          cClouds += cv.evaporationFactor * precipitation[idx];
        } else {
          const evaporation = cMoisture * cv.evaporationFactor * precipitation[idx];
          cClouds += evaporation;
          cMoisture -= evaporation;
        }

        // Orographic lift: wind blowing into higher terrain increases precipitation
        const windIdx = idx * 2;
        const windX = wind[windIdx];
        const windY = wind[windIdx + 1];
        let orographicBoost = 1;
        {
          const downwindX = mod(x + sign(windX), width);
          const downwindY = clamp(y + sign(windY), 0, height - 1);
          const downwindElev = elevation[downwindY * width + downwindX];
          const elevDelta = downwindElev - elevation[idx];
          if (elevDelta > 0 && elevation[idx] > seaLevel) {
            // Wind is pushing into higher terrain — force extra precipitation
            orographicBoost = 1 + elevDelta * 3;
          }
        }

        // Precipitation
        const precip = cClouds * cv.precipitationFactor * temperature[idx] * orographicBoost;
        cClouds -= precip;
        cMoisture += precip;

        // Cloud ceiling
        const cloudMaximum = 1 - elevation[idx] / 2;
        if (cClouds > cloudMaximum) {
          cMoisture += cClouds - cloudMaximum;
          cClouds = cloudMaximum;
        }

        // Runoff to lower neighbors
        if (elevation[idx] > seaLevel) {
          const runoff = cMoisture * cv.runoffFactor * (1 / 18);
          for (let yOff = -1; yOff <= 1; yOff++) {
            for (let xOff = -1; xOff <= 1; xOff++) {
              const nX = mod(x + xOff, width);
              const nY = clamp(y + yOff, 0, height - 1);
              const nIdx = nY * width + nX;
              const elevationDif = elevation[nIdx] - elevation[idx];
              if (elevationDif < 0) {
                cMoisture -= runoff;
                nextMoisture[nIdx] += runoff;
              }
            }
          }
        }

        // Wind advection: push clouds to downwind neighbors
        // Distribute proportionally so total ≤ 100% of clouds
        const totalWind = Math.abs(windX) + Math.abs(windY);
        if (totalWind > 0) {
          const transfer = cClouds * Math.min(totalWind, 1);
          const xWindIndex = mod(x + sign(windX), width);
          const yWindIndex = clamp(y + sign(windY), 0, height - 1);
          nextClouds[y * width + xWindIndex] += transfer * (Math.abs(windX) / totalWind);
          nextClouds[yWindIndex * width + x] += transfer * (Math.abs(windY) / totalWind);
        }

        // Carry over moisture
        nMoisture += cMoisture;
        nMoisture = clamp(nMoisture, 0, 1);

        // Apply changes: current state = accumulated next state
        curMoisture[idx] = nMoisture;
        curClouds[idx] = nextClouds[idx]; // FIX: preserve wind-advected clouds from neighbors
        nextMoisture[idx] = 0;
        nextClouds[idx] = 0;
      }
    }
  }

  // Output final moisture values
  for (let i = 0; i < size; i++) {
    precipitation[i] = curMoisture[i];
  }
}
