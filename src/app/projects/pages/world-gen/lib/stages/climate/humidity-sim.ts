import { clamp, mod } from '@lib/math';
import { ClimateVariables } from '../../types';

/**
 * One-pass streamline precipitation model.
 *
 * For each land cell, trace backward along the wind until the trace either
 * reaches an ocean (the moisture source) or runs out of steps. Compute
 * precipitation directly from the trace's properties:
 *
 *   precip = latitudeBaseline
 *          × oceanReach        (exp decay with overland distance from source)
 *          × orographic        (boost where wind climbs into higher terrain)
 *          × rainShadow        (damp where the trace crossed taller terrain)
 *          × tempBias          (warm cells: more evaporation upstream)
 *
 * The latitude baseline encodes the ITCZ wet band, the subtropical-high dry
 * bands at ~30° N/S, the mid-latitude westerly wet bands at ~50°, and the
 * polar dry caps. The ITCZ shifts north/south between summer and winter
 * (`itczLatOffset`), so monsoon-prone latitudes show real seasonality.
 *
 * Why not iterate? Iterative cloud sims need many cycles to push moisture
 * across a continent, and even then they leave diffusion artifacts and depend
 * sensitively on per-cycle normalization. A trace-back gives one well-defined
 * value per cell with crisp edges and known asymptotic behavior, and runs in
 * O(N · maxSteps) time — comparable to one cycle of the iterative model.
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
  const precipitation = new Float32Array(size);

  // Trace controls. STEP=1 keeps the trace aligned with the grid; MAX_STEPS
  // caps how far inland we'll look — beyond ~25% of map width, more trace
  // doesn't help (everything's been precipitated out).
  const STEP = 1.0;
  const MAX_STEPS = Math.floor(width / 4);
  // Inland decay length: the e-folding distance for moisture flux over land.
  // ~12% of map width gives Earth-like coast-to-interior gradients.
  const INLAND_DECAY = width * 0.12;

  // Precompute latitude baselines (one row at a time — they don't depend on x).
  const latBaselineRow = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    const lat01 = y / height;
    const itczCenter = 0.5 + itczLatOffset;
    const distFromItcz = Math.abs(lat01 - itczCenter);
    const distFromEq = Math.abs(lat01 - 0.5);

    // Three Earth-like wet/dry bands per hemisphere.
    const itczBoost = Math.exp(-Math.pow(distFromItcz * 9, 2));
    const westerlyBoost = Math.exp(-Math.pow((distFromEq - 0.3) * 9, 2)) * 0.85;
    const subtropicalDip = 1 - 0.55 * Math.exp(-Math.pow((distFromEq - 0.17) * 12, 2));
    const polarDip = 1 - 0.55 * Math.exp(-Math.pow((distFromEq - 0.5) * 7, 2));
    // Baseline 0.35 ensures even "dry" zones get some rain; band peaks add up to ~1.
    latBaselineRow[y] = 0.35 + (itczBoost + westerlyBoost) * subtropicalDip * polarDip * 0.85;
  }

  for (let y = 0; y < height; y++) {
    const latBase = latBaselineRow[y];
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const e = elevation[idx];

      // Ocean cells: precipitation = latitudeBaseline modulated by temperature.
      // Tropical oceans are wetter than polar oceans even with no terrain.
      if (e < seaLevel) {
        const tBias = 0.6 + 0.7 * temperature[idx];
        precipitation[idx] = Math.min(1, latBase * tBias);
        continue;
      }

      // Trace backward along wind from this cell.
      let tx = x;
      let ty = y;
      let landSteps = 0;
      let foundOcean = false;
      let maxAltOnTrace = e;
      let upwindElev = e;

      for (let step = 0; step < MAX_STEPS; step++) {
        // Wind sample at current trace position (nearest-neighbor is fine here).
        const sx = mod(Math.round(tx), width);
        const sy = clamp(Math.round(ty), 0, height - 1);
        const wIdx = (sy * width + sx) * 2;
        const wx = wind[wIdx];
        const wy = wind[wIdx + 1];
        if (wx === 0 && wy === 0) break;

        // Step backward (against wind direction).
        const newTx = tx - wx * STEP;
        const newTy = ty - wy * STEP;
        const wrappedTx = mod(newTx, width);
        const clampedTy = clamp(newTy, 0, height - 1);

        // Sample elevation at new position (bilinear for smoother orographic
        // detection at sub-cell trace positions).
        const newE = bilinearElev(elevation, wrappedTx, clampedTy, width, height);
        if (newE < seaLevel) {
          foundOcean = true;
          upwindElev = newE;
          break;
        }

        landSteps += STEP;
        if (newE > maxAltOnTrace) maxAltOnTrace = newE;
        upwindElev = newE;
        tx = wrappedTx;
        ty = clampedTy;
      }

      // Distance-to-ocean attenuation. If we never reached ocean, we're deep
      // continental — give a small residual but no source.
      const oceanReach = foundOcean ? Math.exp(-landSteps / INLAND_DECAY) : 0.05;

      // Orographic lift: cell is higher than its immediate upwind sample.
      const localGain = e - upwindElev;
      const orographic = localGain > 0 ? 1 + localGain * cv.orographicLiftStrength : 1;

      // Rain shadow: trace crossed terrain higher than this cell.
      const shadowDrop = Math.max(0, maxAltOnTrace - e);
      const rainShadow = Math.max(0.05, 1 - shadowDrop * cv.rainShadowStrength);

      // Temperature bias: warm air carries more moisture upstream. Mild factor
      // — the dominant temperature effect (capacity vs saturation) is captured
      // structurally by the latitude baseline already.
      const tBias = 0.6 + 0.7 * temperature[idx];

      const precip = latBase * oceanReach * orographic * rainShadow * tBias;
      precipitation[idx] = Math.min(1, Math.max(0, precip));
    }
  }

  return precipitation;
}

/** Bilinear elevation sample. X wraps cylindrically, Y clamps at the poles. */
function bilinearElev(elev: Float32Array, x: number, y: number, width: number, height: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x0w = mod(x0, width);
  const x1w = mod(x0 + 1, width);
  const y1 = Math.min(y0 + 1, height - 1);
  const v00 = elev[y0 * width + x0w];
  const v10 = elev[y0 * width + x1w];
  const v01 = elev[y1 * width + x0w];
  const v11 = elev[y1 * width + x1w];
  const top = v00 * (1 - fx) + v10 * fx;
  const bot = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bot * fy;
}
