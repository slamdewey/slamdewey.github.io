import { clamp, mod } from '@lib/math';
import { ClimateVariables } from '../../types';
import { WorldGeometry } from '../../world-geometry';

const SECONDS_PER_DAY = 86400;
const M_PER_KM = 1000;

/** °C above frostThreshold below which recycling is fully suppressed. */
const RECYCLING_T_COLD_CUTOFF_OFFSET = 5;
/** °C at and above which recycling reaches its ceiling (warm-temperate / tropical). */
const RECYCLING_T_WARM_SATURATE = 25;

/** Temperature endpoints used to map °C → dimensionless [0, 1] for the qSat
 *  and ocean-evaporation curves. Below T_QSAT_MIN qSat saturates at its
 *  floor; above T_QSAT_MAX it saturates at its ceiling. */
const T_QSAT_MIN_C = -10;
const T_QSAT_MAX_C = 30;

/**
 * Per-cell land recycling efficiency as a function of temperature.
 *
 * Smoothstep ramp from `frostThreshold + 5°C` (zero recycling) to
 * `RECYCLING_T_WARM_SATURATE = 25°C` (ceiling). Approximates the real-Earth
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
  geom: WorldGeometry,
  cv: ClimateVariables,
  itczLatOffset = 0
): HumidityResult {
  const cellSizeKm = geom.cellSizeKmEquator;
  const cosLatRow = geom.cosLatRow;
  const size = width * height;
  const q = new Float32Array(size);
  const qNext = new Float32Array(size);
  const precip = new Float32Array(size);
  const precipStep = new Float32Array(size); // per-iter delta, drives soil refill
  const soilMoisture = new Float32Array(size);

  const iterations = Math.max(1, cv.moistureIterations);
  const cycleDays = Math.max(1, cv.cycleDays);
  const dtDays = cycleDays / iterations;

  // Step-displacement multiplier: a wind magnitude of 1 at the equator advances
  // a parcel (windReferenceMs · dtDays · 86400 s/day) meters per step. The per-row
  // east-step shrinks toward the poles because longitude pixels cover less km
  // there — `cellsPerStepX[y] = stepFactor / cosLat[y]` (same wind sweeps more
  // pixels per second at high lat). Y-step is lat-invariant.
  const stepFactor = (cv.windReferenceMs * dtDays * SECONDS_PER_DAY) / (cellSizeKm * M_PER_KM);

  // Per-step decay multipliers from per-day rates. We cache (1 − exp(−rate·dt))
  // because each is constant over the simulation.
  const evapKept = 1 - Math.exp(-cv.oceanEvapPerDay * dtDays);
  const rainoutFrac = 1 - Math.exp(-cv.saturationRainoutPerDay * dtDays);
  const convFrac = 1 - Math.exp(-cv.convectivePrecipPerDay * dtDays);
  const subsidenceFrac = 1 - Math.exp(-cv.subsidenceDecayPerDay * dtDays);
  const soilTimescale = Math.max(1, cv.soilMoistureTimescaleDays);

  // Diffusion blend factors. y-direction is lat-invariant. x-direction needs
  // 1/cos²(lat) scaling because dx in km shrinks with cos(lat); we cap each
  // per-row blend at 1 for CFL safety so polar rows don't go unstable.
  const yDiffBlend = clamp((cv.moistureDiffusivityKm2PerDay * dtDays) / (cellSizeKm * cellSizeKm), 0, 1);
  const xDiffBlendRow = new Float32Array(height);
  const xStepFactorRow = new Float32Array(height);
  const COS_FLOOR = 0.05; // cap polar amplification so the very last few rows don't blow up
  for (let y = 0; y < height; y++) {
    const c = Math.max(cosLatRow[y], COS_FLOOR);
    xStepFactorRow[y] = stepFactor / c;
    xDiffBlendRow[y] = clamp(yDiffBlend / (c * c), 0, 1);
  }

  // Saturation capacity per cell — Clausius-Clapeyron is exponential in T,
  // but our internal q field is dimensionless so a linear form is fine
  // and avoids saturating too hard at the equator. Temperature comes in as
  // °C; map to [0, 1] across the qSat operating range.
  const qSatRangeInv = 1 / (T_QSAT_MAX_C - T_QSAT_MIN_C);
  const qSat = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const tNorm = clamp((temperature[i] - T_QSAT_MIN_C) * qSatRangeInv, 0, 1);
    qSat[i] = 0.2 + 0.8 * tNorm;
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
        const tNorm = clamp((temperature[idx] - T_QSAT_MIN_C) * qSatRangeInv, 0, 1);
        const deficit = qSat[idx] - q[idx];
        if (deficit <= 0) continue;
        // Per-step fraction of deficit filled. evapKept already integrates dt.
        q[idx] += evapKept * rowMod * tNorm * deficit;
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
      const xStep = xStepFactorRow[y];
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const wIdx = idx * 2;
        const srcX = x - wind[wIdx] * xStep;
        const srcY = y - wind[wIdx + 1] * stepFactor;
        qNext[idx] = bilinearSample(q, srcX, srcY, width, height);
      }
    }
    for (let i = 0; i < size; i++) q[i] = qNext[i];

    // --- 4. Diffusion (separable: x-pass, then y-pass) ---
    if (yDiffBlend > 0) {
      // x-pass: per-row blend with the 3-cell longitudinal mean.
      for (let y = 0; y < height; y++) {
        const blend = xDiffBlendRow[y];
        if (blend <= 0) continue;
        const keep = 1 - blend;
        const rowOff = y * width;
        for (let x = 0; x < width; x++) {
          const xW = mod(x - 1, width);
          const xE = mod(x + 1, width);
          const mean = (q[rowOff + xW] + q[rowOff + x] + q[rowOff + xE]) / 3;
          qNext[rowOff + x] = q[rowOff + x] * keep + mean * blend;
        }
      }
      for (let i = 0; i < size; i++) q[i] = qNext[i];

      // y-pass: lat-invariant blend with the 3-cell meridional mean.
      const yKeep = 1 - yDiffBlend;
      for (let y = 0; y < height; y++) {
        const yN = y > 0 ? y - 1 : 0;
        const yS = y < height - 1 ? y + 1 : height - 1;
        for (let x = 0; x < width; x++) {
          const mean = (q[yN * width + x] + q[y * width + x] + q[yS * width + x]) / 3;
          qNext[y * width + x] = q[y * width + x] * yKeep + mean * yDiffBlend;
        }
      }
      for (let i = 0; i < size; i++) q[i] = qNext[i];
    }

    // --- 5–9. Subsidence + orographic + Föhn + convective + saturation ---
    precipStep.fill(0);
    for (let y = 0; y < height; y++) {
      const sub = subsidenceRow[y];
      const conv = convFrac * itczBoost[y] * stormBoostRow[y];
      const xStep = xStepFactorRow[y];
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        if (sub > 0) q[idx] *= 1 - sub;

        if (elevation[idx] >= seaLevel) {
          const wIdx = idx * 2;
          const upX = x - wind[wIdx] * xStep;
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
 * Bilinear sample with cylindrical X wrap and pole wrap on Y. A parcel
 * advected past a pole continues over the pole onto the antipodal longitude:
 * y < 0 becomes y' = −y − 1 with x shifted by W/2; y ≥ H becomes y' = 2H − y − 1
 * with the same x shift. This is the equirectangular projection of a great-
 * circle path crossing the pole.
 */
function bilinearSample(field: Float32Array, x: number, y: number, width: number, height: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const halfW = width >> 1;

  let y0i = y0;
  let xShiftA = 0;
  if (y0i < 0) {
    y0i = -y0i - 1;
    xShiftA = halfW;
  } else if (y0i >= height) {
    y0i = 2 * height - y0i - 1;
    xShiftA = halfW;
  }

  let y1i = y0 + 1;
  let xShiftB = 0;
  if (y1i < 0) {
    y1i = -y1i - 1;
    xShiftB = halfW;
  } else if (y1i >= height) {
    y1i = 2 * height - y1i - 1;
    xShiftB = halfW;
  }

  const v00 = field[y0i * width + mod(x0 + xShiftA, width)];
  const v10 = field[y0i * width + mod(x0 + 1 + xShiftA, width)];
  const v01 = field[y1i * width + mod(x0 + xShiftB, width)];
  const v11 = field[y1i * width + mod(x0 + 1 + xShiftB, width)];
  const top = v00 * (1 - fx) + v10 * fx;
  const bot = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bot * fy;
}
