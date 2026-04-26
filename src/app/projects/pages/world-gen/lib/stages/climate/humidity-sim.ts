import { clamp, mod } from '@lib/math';
import { ClimateVariables } from '../../types';

const SECONDS_PER_DAY = 86400;
const M_PER_KM = 1000;

/** Temperature offset above frostThreshold below which recycling is fully suppressed. */
const RECYCLING_T_COLD_CUTOFF_OFFSET = 0.05;
/** Temperature at and above which recycling reaches its ceiling (warm-temperate / tropical). */
const RECYCLING_T_WARM_SATURATE = 0.65;

/**
 * Per-cell land recycling efficiency as a function of temperature.
 *
 * Smoothstep ramp from `frostThreshold + 0.05` (zero recycling) to
 * `RECYCLING_T_WARM_SATURATE = 0.65` (ceiling). Approximates the real-Earth
 * gradient where Amazon-style tropics recycle ~30% of precipitation, temperate
 * interiors ~10–20%, and subarctic/tundra ~2–5%. The ceiling parameter is the
 * user-facing `landEvapEfficiency` — i.e. the maximum recycling, achieved in
 * tropical cells; cooler cells receive proportionally less.
 */
function landEvapAt(t: number, ceiling: number, frostT: number): number {
  const cold = frostT + RECYCLING_T_COLD_CUTOFF_OFFSET;
  if (t <= cold) return 0;
  if (t >= RECYCLING_T_WARM_SATURATE) return ceiling;
  const u = (t - cold) / (RECYCLING_T_WARM_SATURATE - cold);
  const s = u * u * (3 - 2 * u);
  return ceiling * s;
}

export interface HumidityResult {
  /** Accumulated precipitation, raw (mm-equivalent units — caller normalizes for display). */
  precip: Float32Array;
  /** Final-step soil moisture from the recycling bucket. mm-equivalent. */
  soilMoisture: Float32Array;
}

/**
 * Eulerian moisture-transport precipitation model — rate-based / resolution-independent.
 *
 * Atmospheric water `q` is advected on a 2D grid for `cv.moistureIterations`
 * sub-steps over a total simulated period of `cv.cycleDays`. All decay/source
 * terms are expressed as per-day rates and applied as `1 − exp(−rate · dt)`
 * each step, so iteration count is a discretization quality knob (more = same
 * answer with less numerical diffusion), not a physics knob.
 *
 * Per step (dt = cycleDays / iterations):
 *
 *   1. Ocean evaporation — fills the saturation deficit (qSat − q) on water
 *      cells at `oceanEvapPerDay`, scaled by surface temperature and an
 *      ITCZ-row evaporation boost.
 *   2. Land evapotranspiration (recycling) — Manabe (1969) one-bucket model.
 *      Each land cell tracks soil moisture S replenished by P, draining at
 *      S/τ. ET = min(supply S/τ, demand PET/cycle). A fraction of ET re-enters
 *      atmospheric q (`landEvapEfficiency`). This is what carries Atlantic
 *      moisture to the Urals or Pacific moisture to the Rockies on Earth — without
 *      it, our interiors are physically unreachable by ocean-source advection alone.
 *   3. Semi-Lagrangian advection — `srcX = x − wind · windReferenceMs · dt · 86.4 / cellSizeKm`.
 *      Bilinear sample. X wraps cylindrically; Y clamps at the poles.
 *   4. Diffusion — `D · dt / dx²` blend with a 3×3 box mean. D in km²/day, dx in km.
 *   5. Subsidence — subtropical highs (~±30°) impose extra exponential decay
 *      on q to reproduce the Hadley descent that creates the world's hot deserts.
 *   6. Orographic condensation — windward rise forces a one-shot fraction of q
 *      to precipitate (this is a spatial event, not time-rated).
 *   7. Föhn descent drying — leeward descent removes q without precipitating it
 *      (dry-adiabatic warming dries the air). Produces real rain shadows.
 *   8. Convective rainout — `q · convectivePrecipPerDay` per day, ITCZ- and
 *      storm-track-boosted. Linear in q (literature-standard) — earlier model
 *      used q² which created unrealistic coast-vs-interior bimodality.
 *   9. Saturation rainout — `(q − qSat) · saturationRainoutPerDay` per day where
 *      q exceeds the temperature-dependent capacity.
 *
 * Returns raw accumulated precipitation and final soil moisture. Caller is
 * responsible for normalizing for display and for downstream metrics.
 */
export function simulateHumidity(
  width: number,
  height: number,
  wind: Float32Array,
  elevation: Float32Array,
  temperature: Float32Array,
  petAnnual: Float32Array,
  seaLevel: number,
  cellSizeKm: number,
  cv: ClimateVariables,
  itczLatOffset = 0
): HumidityResult {
  const size = width * height;
  const q = new Float32Array(size);
  const qNext = new Float32Array(size);
  const precip = new Float32Array(size);
  const precipStep = new Float32Array(size); // per-iter delta, drives soil refill
  const soilMoisture = new Float32Array(size);

  const iterations = Math.max(1, cv.moistureIterations);
  const cycleDays = Math.max(1, cv.cycleDays);
  const dtDays = cycleDays / iterations;

  // Step-displacement multiplier: a wind magnitude of 1 advances a parcel
  // (windReferenceMs · dtDays · 86400 s/day) meters per step. Convert to cells.
  const stepFactor = (cv.windReferenceMs * dtDays * SECONDS_PER_DAY) / (cellSizeKm * M_PER_KM);

  // Per-step decay multipliers from per-day rates. We cache (1 − exp(−rate·dt))
  // because each is constant over the simulation.
  const evapKept = 1 - Math.exp(-cv.oceanEvapPerDay * dtDays);
  const rainoutFrac = 1 - Math.exp(-cv.saturationRainoutPerDay * dtDays);
  const convFrac = 1 - Math.exp(-cv.convectivePrecipPerDay * dtDays);
  const subsidenceFrac = 1 - Math.exp(-cv.subsidenceDecayPerDay * dtDays);
  const soilTimescale = Math.max(1, cv.soilMoistureTimescaleDays);

  // Diffusion blend factor: D · dt / dx². Clamp to 1 for safety on coarse maps.
  const diffusionBlend = clamp((cv.moistureDiffusivityKm2PerDay * dtDays) / (cellSizeKm * cellSizeKm), 0, 1);

  // Saturation capacity per cell — Clausius-Clapeyron is exponential in T,
  // but temperature is already normalized [0, 1] so a linear form is fine
  // and avoids saturating too hard at the equator.
  const qSat = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = clamp(temperature[i], 0, 1);
    qSat[i] = 0.2 + 0.8 * t;
  }

  // Steady-state soil-moisture initialization. Without this, the first ~τ days
  // of simulation are spent filling the bucket from zero, biasing total precip.
  // S₀ = (typical precip) · τ, where typical precip is approximated as 1 / cycleDays
  // in dimensionless q-units — close enough; the bucket re-equilibrates fast.
  const s0 = (1.0 / cycleDays) * soilTimescale;
  for (let i = 0; i < size; i++) {
    if (elevation[i] >= seaLevel) soilMoisture[i] = s0;
  }

  // Per-row latitude modulation:
  //   evapMod    — extra ocean evaporation under the ITCZ (rising-air zone).
  //   itczBoost  — multiplier on convective rainout at the ITCZ (uplift).
  //   subsidence — multiplicative dry decay rate under subtropical highs.
  //   stormBoost — mid-latitude (40–60°) convective + diffusion boost
  //                approximating baroclinic-eddy precipitation.
  const evapMod = new Float32Array(height);
  const itczBoost = new Float32Array(height);
  const subsidenceRow = new Float32Array(height);
  const stormBoostRow = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    const lat01 = y / height;
    const itczCenter = 0.5 + itczLatOffset;
    const distItcz = Math.abs(lat01 - itczCenter);
    const distEq = Math.abs(lat01 - 0.5);

    const itczShape = Math.exp(-Math.pow(distItcz * 6, 2));
    evapMod[y] = 0.9 + 0.6 * itczShape;
    itczBoost[y] = 1 + 1.2 * itczShape;
    // Subtropical-high band centered at lat 0.17 from equator (~30°).
    const subShape = Math.exp(-Math.pow((distEq - 0.17) * 12, 2));
    subsidenceRow[y] = subsidenceFrac * subShape;
    // Storm-track band centered at lat 0.28 from equator (~50°).
    const stormShape = Math.exp(-Math.pow((distEq - 0.28) * 9, 2));
    stormBoostRow[y] = 1 + cv.stormTrackBoost * stormShape;
  }

  // Main loop.
  for (let iter = 0; iter < iterations; iter++) {
    // --- 1. Ocean evaporation ---
    for (let y = 0; y < height; y++) {
      const rowMod = evapMod[y];
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (elevation[idx] >= seaLevel) continue;
        const t = clamp(temperature[idx], 0, 1);
        const deficit = qSat[idx] - q[idx];
        if (deficit <= 0) continue;
        // Per-step fraction of deficit filled. evapKept already integrates dt.
        q[idx] += evapKept * rowMod * t * deficit;
      }
    }

    // --- 2. Land ET (one-bucket recycling, temperature-scaled) ---
    if (cv.landEvapEfficiency > 0) {
      for (let i = 0; i < size; i++) {
        if (elevation[i] < seaLevel) continue;
        if (temperature[i] <= cv.frostThreshold) continue; // frozen ground (early-exit)
        const supply = soilMoisture[i] / soilTimescale; // mm/day
        const demand = petAnnual[i] / cycleDays; // PET expressed per cycle → per day
        const et = Math.min(supply, demand);
        const etStep = et * dtDays;
        soilMoisture[i] -= etStep;
        if (soilMoisture[i] < 0) soilMoisture[i] = 0;
        const eff = landEvapAt(temperature[i], cv.landEvapEfficiency, cv.frostThreshold);
        q[i] += eff * etStep;
      }
    }

    // --- 3. Semi-Lagrangian advection ---
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const wIdx = idx * 2;
        const srcX = x - wind[wIdx] * stepFactor;
        const srcY = y - wind[wIdx + 1] * stepFactor;
        qNext[idx] = bilinearSample(q, srcX, srcY, width, height);
      }
    }
    for (let i = 0; i < size; i++) q[i] = qNext[i];

    // --- 4. Diffusion ---
    if (diffusionBlend > 0) {
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
      const keep = 1 - diffusionBlend;
      for (let i = 0; i < size; i++) q[i] = q[i] * keep + qNext[i] * diffusionBlend;
    }

    // --- 5–9. Subsidence + orographic + Föhn + convective + saturation ---
    precipStep.fill(0);
    for (let y = 0; y < height; y++) {
      const sub = subsidenceRow[y];
      const conv = convFrac * itczBoost[y] * stormBoostRow[y];
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        if (sub > 0) q[idx] *= 1 - sub;

        if (elevation[idx] >= seaLevel) {
          const wIdx = idx * 2;
          const upX = x - wind[wIdx] * stepFactor;
          const upY = y - wind[wIdx + 1] * stepFactor;
          const upwindE = bilinearSample(elevation, upX, upY, width, height);
          const rise = elevation[idx] - upwindE;
          if (rise > 0) {
            const frac = rise * cv.orographicCondensation;
            const take = q[idx] * (frac > 0.6 ? 0.6 : frac);
            q[idx] -= take;
            precipStep[idx] += take;
          } else if (rise < 0) {
            // Föhn descent — leeward warm-and-dry without precipitation.
            const drop = q[idx] * Math.min(0.6, -rise * cv.rainShadowStrength * 0.4);
            q[idx] -= drop;
          }
        }

        // Convective: linear in q (literature-standard). Drier inland air
        // still rains less than wet coastal, but not by the q² margin that
        // crushed earlier models.
        if (conv > 0 && q[idx] > 0) {
          const rain = q[idx] * conv;
          q[idx] -= rain;
          precipStep[idx] += rain;
        }

        if (q[idx] > qSat[idx]) {
          const excess = q[idx] - qSat[idx];
          const rain = excess * rainoutFrac;
          q[idx] -= rain;
          precipStep[idx] += rain;
        }
      }
    }

    // Accumulate this step's precip into the cycle total, and replenish
    // soil moisture (land cells only). Soil refill = full precip; bucket
    // drains via ET earlier in this iteration.
    for (let i = 0; i < size; i++) {
      precip[i] += precipStep[i];
      if (elevation[i] >= seaLevel) soilMoisture[i] += precipStep[i];
    }
  }

  return { precip, soilMoisture };
}

/**
 * Bilinear sample with cylindrical X wrap and clamped Y.
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
