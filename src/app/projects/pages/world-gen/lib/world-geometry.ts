/**
 * Per-row spherical geometry for an equirectangular grid (row 0 = north pole,
 * row H−1 = south pole, lat = π/2 − (row + 0.5)/H · π).
 *
 * All climate stages take this once instead of just `cellSizeKm`, so they can
 * apply per-row cos(lat) corrections (E-W cell size shrinks toward the poles)
 * without each stage redoing the trig.
 */
export interface WorldGeometry {
  width: number;
  height: number;
  /** circumferenceKm / width — true E-W cell size at the equator. */
  cellSizeKmEquator: number;
  /** cos(lat) at row center. Scales E-W km/pixel: actual = cellSizeKmEquator · cosLatRow[y]. */
  cosLatRow: Float32Array;
  /** sin(lat) at row center. Useful for Coriolis & insolation. */
  sinLatRow: Float32Array;
  /** Per-cell area weight, normalized so Σ over all cells = 1. Equal to cos(lat) / Σcos(lat) / width. */
  cellAreaWeight: Float32Array;
}

export function buildWorldGeometry(width: number, height: number, circumferenceKm: number): WorldGeometry {
  const cosLatRow = new Float32Array(height);
  const sinLatRow = new Float32Array(height);
  let cosSum = 0;
  for (let y = 0; y < height; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
    const c = Math.cos(lat);
    cosLatRow[y] = c;
    sinLatRow[y] = Math.sin(lat);
    cosSum += c;
  }
  const cellAreaWeight = new Float32Array(height);
  const norm = cosSum > 0 ? 1 / (cosSum * width) : 0;
  for (let y = 0; y < height; y++) cellAreaWeight[y] = cosLatRow[y] * norm;
  return {
    width,
    height,
    cellSizeKmEquator: circumferenceKm / width,
    cosLatRow,
    sinLatRow,
    cellAreaWeight,
  };
}
