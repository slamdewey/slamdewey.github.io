import { clamp, mod } from '@lib/math';
import { ClimateVariables } from '../../types';

/**
 * Eulerian moisture-transport precipitation model.
 *
 * Simulates atmospheric water on a 2D grid over N iterations. Per step:
 *
 *   1. Evaporation — ocean cells add moisture proportional to (qSat − q),
 *      scaled by temperature and a latitude factor (ITCZ boost).
 *   2. Advection  — semi-Lagrangian upwind: each cell's next q is sampled
 *      from one wind-step upstream with bilinear interpolation. X wraps
 *      cylindrically; Y clamps at the poles.
 *   3. Diffusion  — 3×3 box blur blended by `moistureDiffusion`. This is
 *      what breaks the streakiness of the old single-trace model: lateral
 *      mixing is built into the physics, not bolted on afterward.
 *   4. Subsidence — subtropical high bands (~±30°) impose a mild per-step
 *      decay on q to reproduce the Hadley descent that creates the world's
 *      hot deserts.
 *   5. Orographic condensation — where the wind blows a parcel into higher
 *      terrain, force a fraction of its q to precipitate in that cell.
 *   6. Convective rainout — a fraction of q rains out every iteration
 *      regardless of saturation, boosted under the ITCZ. This represents
 *      the bulk vertical mixing / cumulus activity that a 2D grid can't
 *      model directly. Without this, saturation-only rainout is too rare
 *      over warm land (advected q stays below local qSat), and only
 *      mountains produce measurable precipitation.
 *   7. Saturation rainout — where q exceeds qSat (capacity set by local
 *      temperature), precipitate the excess at `rainoutRate`. Dominates
 *      in cold climates where qSat is low.
 *
 * `precip` accumulates across all iterations and is normalized by its 95th
 * percentile (clamped to [0, 1]), so orographic spikes on a few mountain
 * cells don't flatten the rest of the field.
 *
 * Mass conservation is approximate — the convective term leaks q without a
 * corresponding source — but the model is mass-aware: moisture must be
 * transported inland before it can rain, so continentality emerges from
 * the ratio of wind advection length to the map, not from an
 * `exp(-distance)` fudge factor.
 */
export function simulateHumidity(
  width: number,
  height: number,
  wind: Float32Array,
  elevation: Float32Array,
  temperature: Float32Array,
  seaLevel: number,
  cv: ClimateVariables,
  itczLatOffset = 0
): Float32Array {
  const size = width * height;
  const q = new Float32Array(size);
  const qNext = new Float32Array(size);
  const precip = new Float32Array(size);

  const iterations = Math.max(1, cv.moistureIterations);
  const diffusion = clamp(cv.moistureDiffusion, 0, 1);
  const evapRate = cv.evaporationRate;
  const rainoutRate = clamp(cv.rainoutRate, 0, 1);
  const orographicStrength = cv.orographicCondensation;
  const convectiveRate = clamp(cv.convectiveRainRate, 0, 1);

  // Saturation capacity per cell — Clausius-Clapeyron is exponential in T,
  // but temperature is already normalized [0, 1] so a linear form is fine
  // and avoids saturating too hard at the equator.
  const qSat = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = temperature[i] < 0 ? 0 : temperature[i] > 1 ? 1 : temperature[i];
    qSat[i] = 0.2 + 0.8 * t;
  }

  // Per-row latitude modulation.
  //   evapMod    — extra evaporation rate under the ITCZ (rising-air zone).
  //   itczBoost  — multiplier on convective rainout at the ITCZ (up-lift zone).
  //   subsidence — multiplicative dry factor under subtropical highs
  //                (descending air at ~±30° latitude).
  const evapMod = new Float32Array(height);
  const itczBoost = new Float32Array(height);
  const subsidence = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    const lat01 = y / height;
    const itczCenter = 0.5 + itczLatOffset;
    const distItcz = Math.abs(lat01 - itczCenter);
    const distEq = Math.abs(lat01 - 0.5);

    const itczShape = Math.exp(-Math.pow(distItcz * 6, 2));
    evapMod[y] = 0.9 + 0.6 * itczShape;
    itczBoost[y] = 1 + 1.2 * itczShape;
    subsidence[y] = 0.012 * Math.exp(-Math.pow((distEq - 0.17) * 12, 2));
  }

  // Main loop.
  for (let iter = 0; iter < iterations; iter++) {
    // --- 1. Evaporation source on ocean cells ---
    for (let y = 0; y < height; y++) {
      const rowMod = evapMod[y];
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (elevation[idx] >= seaLevel) continue;
        const t = temperature[idx] < 0 ? 0 : temperature[idx] > 1 ? 1 : temperature[idx];
        const deficit = qSat[idx] - q[idx];
        if (deficit <= 0) continue;
        q[idx] += evapRate * rowMod * t * deficit;
      }
    }

    // --- 2. Semi-Lagrangian advection ---
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const wIdx = idx * 2;
        const wx = wind[wIdx];
        const wy = wind[wIdx + 1];
        const srcX = x - wx;
        const srcY = y - wy;
        qNext[idx] = bilinearSample(q, srcX, srcY, width, height);
      }
    }
    // Swap q <- qNext.
    for (let i = 0; i < size; i++) q[i] = qNext[i];

    // --- 3. Diffusion (3×3 box blur blended by `diffusion`) ---
    if (diffusion > 0) {
      for (let y = 0; y < height; y++) {
        const yN = y > 0 ? y - 1 : 0;
        const yS = y < height - 1 ? y + 1 : height - 1;
        for (let x = 0; x < width; x++) {
          const xW = mod(x - 1, width);
          const xE = mod(x + 1, width);
          const sum =
            q[yN * width + xW] +
            q[yN * width + x] +
            q[yN * width + xE] +
            q[y * width + xW] +
            q[y * width + x] +
            q[y * width + xE] +
            q[yS * width + xW] +
            q[yS * width + x] +
            q[yS * width + xE];
          qNext[y * width + x] = sum / 9;
        }
      }
      const keep = 1 - diffusion;
      for (let i = 0; i < size; i++) q[i] = q[i] * keep + qNext[i] * diffusion;
    }

    // --- 4. Subsidence + 5. Orographic + 6. Convective + 7. Saturation ---
    for (let y = 0; y < height; y++) {
      const sub = subsidence[y];
      const conv = convectiveRate * itczBoost[y];
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        if (sub > 0) q[idx] *= 1 - sub;

        if (elevation[idx] >= seaLevel) {
          const wIdx = idx * 2;
          const wx = wind[wIdx];
          const wy = wind[wIdx + 1];
          const upwindE = bilinearSample(elevation, x - wx, y - wy, width, height);
          const rise = elevation[idx] - upwindE;
          if (rise > 0) {
            const frac = rise * orographicStrength;
            const take = q[idx] * (frac > 0.6 ? 0.6 : frac);
            q[idx] -= take;
            precip[idx] += take;
          }
        }

        // Convective rainout — scales linearly with saturation fraction
        // (q / qSat). Dry advected air barely rains, so moisture can cross
        // continents; near-saturated air rains readily. Ocean q is capped
        // near qSat by saturation rainout below, so the effective ocean
        // rain rate is ~conv × 1.0, while freshly-advected inland air with
        // satFrac ≈ 0.6 rains at ~0.6 × conv. The difference in residence
        // time is what delivers precipitation deep inland.
        if (conv > 0 && q[idx] > 0) {
          const cap = qSat[idx];
          const satFrac = cap > 0 ? q[idx] / cap : 0;
          const rain = q[idx] * conv * satFrac;
          q[idx] -= rain;
          precip[idx] += rain;
        }

        if (q[idx] > qSat[idx]) {
          const excess = q[idx] - qSat[idx];
          const rain = excess * rainoutRate;
          q[idx] -= rain;
          precip[idx] += rain;
        }
      }
    }
  }

  // Normalize using the 85th-percentile of LAND precipitation as the anchor
  // for 1.0. Ocean cells under the ITCZ are ~3–5× wetter than coastal land;
  // anchoring on all cells would push land to the bottom 20% of display
  // range AND feed low MAP values into aridity.ts, biasing the classifier
  // toward desert. Anchoring on land keeps coastal/interior contrast intact
  // while letting ocean cells saturate at 1.0.
  const anchor = percentileLand(precip, elevation, seaLevel, 0.85);
  if (anchor > 0) {
    const inv = 1 / anchor;
    for (let i = 0; i < size; i++) {
      const v = precip[i] * inv;
      precip[i] = v > 1 ? 1 : v;
    }
  }

  return precip;
}

/** Returns the given quantile (0..1) of `field` among LAND cells only. */
function percentileLand(field: Float32Array, elevation: Float32Array, seaLevel: number, q: number): number {
  const n = field.length;
  // Sample up to 4096 land cells for the histogram; exact sort isn't needed.
  const samples: number[] = [];
  const stride = n <= 4096 ? 1 : Math.floor(n / 4096);
  for (let i = 0; i < n; i += stride) {
    if (elevation[i] >= seaLevel && field[i] > 0) samples.push(field[i]);
  }
  if (samples.length === 0) {
    // Fallback — no land precipitation at all; anchor on whole field.
    for (let i = 0; i < n; i += stride) if (field[i] > 0) samples.push(field[i]);
    if (samples.length === 0) return 0;
  }
  samples.sort((a, b) => a - b);
  const idx = Math.min(samples.length - 1, Math.floor(samples.length * q));
  return samples[idx];
}

/**
 * Bilinear sample with cylindrical X wrap and clamped Y. Used for both
 * the moisture field during advection and the elevation field during
 * orographic probing.
 */
function bilinearSample(field: Float32Array, x: number, y: number, width: number, height: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x0w = mod(x0, width);
  const x1w = mod(x0 + 1, width);
  const y0c = y0 < 0 ? 0 : y0 >= height ? height - 1 : y0;
  const y1c = y0 + 1 < 0 ? 0 : y0 + 1 >= height ? height - 1 : y0 + 1;
  const v00 = field[y0c * width + x0w];
  const v10 = field[y0c * width + x1w];
  const v01 = field[y1c * width + x0w];
  const v11 = field[y1c * width + x1w];
  const top = v00 * (1 - fx) + v10 * fx;
  const bot = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bot * fy;
}
