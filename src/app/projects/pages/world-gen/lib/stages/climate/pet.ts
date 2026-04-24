/**
 * Potential evapotranspiration (PET) — the upper bound on water that could
 * leave a cell as vapor given its temperature, regardless of moisture supply.
 *
 * Uses a Thornthwaite-style monotonic curve in normalized temperature space
 * (T ∈ [0, 1]). The point isn't physical accuracy in mm/year — it's that PET
 * grows superlinearly with temperature so the aridity index `MAP / PET`
 * correctly identifies "warm enough to dry out" vs "cold so water sits".
 *
 * Cells below freezing produce ~0 PET (frozen ground evaporates negligibly).
 */
export function computePET(temperature: Float32Array, frostThreshold: number): Float32Array {
  const out = new Float32Array(temperature.length);
  for (let i = 0; i < temperature.length; i++) {
    const t = temperature[i];
    if (t <= frostThreshold) {
      out[i] = 0;
      continue;
    }
    const aboveFrost = (t - frostThreshold) / (1 - frostThreshold);
    // Thornthwaite-ish: PET ~ T^1.5 with a small floor so warm-dry zones
    // don't get classified as humid by accident.
    out[i] = Math.pow(aboveFrost, 1.5);
  }
  return out;
}
