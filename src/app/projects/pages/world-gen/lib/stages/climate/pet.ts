import { PET_K_PER_SEASON, PET_TEMP_EXPONENT } from '../../physics';

/**
 * Potential evapotranspiration (PET) — the upper bound on water that could
 * leave a cell as vapor given its temperature, regardless of moisture supply.
 *
 * Hamon-style formula in physical units: per-season PET (mm) ≈ K · T_C^p
 * for T_C > frostThreshold, else 0. Each cycle of the climate sim represents
 * a 6-month season, so the per-cell return value is the half-year PET in mm.
 * Caller sums summer + winter for annual PET (mm/yr).
 */
export function computePET(temperature: Float32Array, frostThresholdC: number): Float32Array {
  const out = new Float32Array(temperature.length);
  for (let i = 0; i < temperature.length; i++) {
    const t = temperature[i];
    if (t <= frostThresholdC) {
      out[i] = 0;
      continue;
    }
    out[i] = PET_K_PER_SEASON * Math.pow(t - frostThresholdC, PET_TEMP_EXPONENT);
  }
  return out;
}
