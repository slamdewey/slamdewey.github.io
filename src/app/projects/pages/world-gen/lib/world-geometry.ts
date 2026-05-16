/**
 * Per-row spherical geometry for an equirectangular grid (row 0 = north pole,
 * row H−1 = south pole, lat = π/2 − (row + 0.5)/H · π).
 *
 * Every stage that touches grid spacing should consume this instead of
 * `cellSizeKm` alone, so per-row cos(lat) corrections live in one place.
 *
 * Contract: any code that uses pixel distance as if it were km, or assumes
 * per-cell quantities are area-equal, should route through these helpers
 * rather than reinventing the trig inline.
 */

/**
 * Lower bound on cos(lat) used by every per-row reciprocal in this module.
 * Caps polar amplification so the last few rows can't blow up; shared across
 * all stages so clamping is consistent.
 */
export const COS_FLOOR = 0.05;

// D8 offsets, indexed 0..7 = N, NE, E, SE, S, SW, W, NW. Mirrors the
// constants in stages/hydrology.ts; kept here so d8KmDist can be derived.
const D8_DX = [0, 1, 1, 1, 0, -1, -1, -1];
const D8_DY = [-1, -1, 0, 1, 1, 1, 0, -1];

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
  /** N-S km/pixel: pole-to-pole distance ÷ height. Constant across rows
   *  (= circumferenceKm / 2 / height for a sphere). */
  kmPerYPixel: number;
  /** E-W km/pixel per row: cellSizeKmEquator · cosLatRow[y]. Shrinks toward poles. */
  kmPerXPixelRow: Float32Array;
  /** 1 / max(cosLatRow[y], COS_FLOOR). How many pixel-steps a unit-magnitude
   *  x-wind traverses per step at this latitude — equivalently, the per-row
   *  multiplier to convert an equator-scaled E-W displacement into pixels. */
  xStepFactorRow: Float32Array;
  /** D8 step distance in km, indexed `y * 8 + d` with d order matching
   *  stages/hydrology.ts (0..7 = N, NE, E, SE, S, SW, W, NW). Diagonal entries
   *  use the source row's E-W km/pixel — slight approximation across the row,
   *  consistent with the existing inline D8 pixel-distance convention. */
  d8KmDist: Float32Array;
  /** Per-row diffusion weights for an 8-neighbor weighted average, indexed
   *  `y * 3 + slot`: slot 0 = E/W neighbor, slot 1 = N/S neighbor, slot 2 =
   *  diagonal neighbor. Weights are inverse-distance-squared in km-space and
   *  normalized so 2·EW + 2·NS + 4·diag = 1 per row, which makes the
   *  per-neighbor-weighted sum equal the (km-isotropic) mean. */
  diffWeights: Float32Array;
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

  const cellSizeKmEquator = circumferenceKm / width;
  const kmPerYPixel = circumferenceKm / 2 / height;

  const kmPerXPixelRow = new Float32Array(height);
  const xStepFactorRow = new Float32Array(height);
  const d8KmDist = new Float32Array(height * 8);
  const diffWeights = new Float32Array(height * 3);
  for (let y = 0; y < height; y++) {
    const cClamped = Math.max(cosLatRow[y], COS_FLOOR);
    const dxKm = cellSizeKmEquator * cosLatRow[y];
    kmPerXPixelRow[y] = dxKm;
    xStepFactorRow[y] = 1 / cClamped;

    const dxKmClamped = cellSizeKmEquator * cClamped;
    const diagKm = Math.hypot(kmPerYPixel, dxKmClamped);
    const off = y * 8;
    for (let d = 0; d < 8; d++) {
      const dx = D8_DX[d];
      const dy = D8_DY[d];
      if (dx === 0) d8KmDist[off + d] = kmPerYPixel;
      else if (dy === 0) d8KmDist[off + d] = dxKmClamped;
      else d8KmDist[off + d] = diagKm;
    }

    // Inverse-distance-squared weights, then renormalize so a per-neighbor
    // weighted sum across all 8 neighbors equals the mean.
    const wEwRaw = 1 / (dxKmClamped * dxKmClamped);
    const wNsRaw = 1 / (kmPerYPixel * kmPerYPixel);
    const wDiagRaw = 1 / (diagKm * diagKm);
    const total = 2 * wEwRaw + 2 * wNsRaw + 4 * wDiagRaw;
    const inv = total > 0 ? 1 / total : 0;
    diffWeights[y * 3 + 0] = wEwRaw * inv;
    diffWeights[y * 3 + 1] = wNsRaw * inv;
    diffWeights[y * 3 + 2] = wDiagRaw * inv;
  }

  return {
    width,
    height,
    cellSizeKmEquator,
    cosLatRow,
    sinLatRow,
    cellAreaWeight,
    kmPerYPixel,
    kmPerXPixelRow,
    xStepFactorRow,
    d8KmDist,
    diffWeights,
  };
}
