import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { clamp, sphericalEmbed3D, mod } from '@lib/math';
import { ClimateVariables, NoiseVariables, WorldFields } from '../types';
import { HADLEY_EXTENT, POLAR_EXTENT, FERREL_WIDTH, EKMAN_DEG } from '../physics';

/**
 * Pressure-field → geostrophic-wind → Ekman-surface-friction wind model.
 *
 * Wind emerges from the gradient of a latitudinal pressure field rather than
 * from a fixed direction profile. The Coriolis parameter turns pressure
 * gradients into along-isobar flow (westerlies, trades, polar easterlies),
 * and Ekman surface friction rotates the geostrophic vector ~25° toward the
 * low-pressure side to produce the familiar crossing-isobar flow seen on
 * synoptic charts.
 *
 * In Pass 2 (thermal-contrast mode), the pressure field also responds to
 * land–sea temperature anomalies, which is what drives monsoon wind reversal
 * between seasons.
 */

// Image coordinate convention: x = eastward, y = southward. lat = y / height,
// so lat = 0 is the north pole and lat = 1 is the south pole.

/** Coriolis scale. Tuned together with gradient scaling so typical trade/westerly magnitudes end up near 1. */
const F0 = 8.0;
/** Floor on |f| used to regularize 1/f near the equator. */
const F_MIN = 0.8;

// Atmospheric three-cell structure (HADLEY_EXTENT, POLAR_EXTENT, FERREL_WIDTH)
// and the Ekman friction angle (EKMAN_DEG) are imported from `lib/physics.ts`
// — they're Earth-like physical parameters shared with other stages.

/** Gaussian sigma of each pressure band as a fraction of its parent cell
 *  half-width. 0.5 means 1σ covers half the cell — smooth but clear. */
const SIGMA_OF_CELL = 0.5;

/** ITCZ is tighter than the full Hadley cell — real convergence zones are
 *  narrow bands, not broad lows. */
const ITCZ_TIGHTNESS = 0.8;
/** Polar high extends slightly past the nominal cell — cold dense air pools
 *  over a broader polar dome than the strict 60°–pole arc. */
const POLAR_BROADENING = 1.2;

const ITCZ_SIGMA = HADLEY_EXTENT * SIGMA_OF_CELL * ITCZ_TIGHTNESS;
const SUBTROP_SIGMA = HADLEY_EXTENT * SIGMA_OF_CELL;
const SUBPOLAR_SIGMA = FERREL_WIDTH * SIGMA_OF_CELL;
const POLAR_SIGMA = POLAR_EXTENT * SIGMA_OF_CELL * POLAR_BROADENING;

/** Relative pressure anomalies at each zonal-mean band center. Sign follows
 *  the physical picture: rising air = low pressure, descending air = high.
 *  Magnitudes encode the Earth-observed strength ordering: the ITCZ low is
 *  deepest (strongest rising branch), subtropical high next, subpolar low
 *  next (baroclinic convergence), polar high weakest (cold-dense but
 *  shallow). Not derived from first principles — energy balance isn't in
 *  this model — so they remain documented dimensionless tuning ratios. */
const P_EQ_MIN = -1.0;
const P_SUBTROP = 0.85;
const P_SUBPOLAR = -0.6;
const P_POLAR = 0.45;

function gauss(x: number, center: number, sigma: number): number {
  const d = (x - center) / sigma;
  return Math.exp(-d * d);
}

/**
 * Zonal-mean pressure pattern following the three-cell circulation model.
 *
 * Per-band seasonal coupling to the thermal equator reflects the physics:
 *
 *  - **ITCZ** is the thermal equator (coupling = 1).
 *  - **Subtropical highs** are the Hadley cell's descending branch, anchored
 *    at fixed angular distance HADLEY_EXTENT from the ITCZ (coupling = 1).
 *  - **Subpolar lows** are baroclinically driven by the pole-to-mid-latitude
 *    temperature gradient, not by solar heating; they anchor geographically
 *    at POLAR_EXTENT from the pole (coupling = 0). This lets the Ferrel
 *    cells expand in the winter hemisphere and compress in the summer
 *    hemisphere — the main realism gain vs the prior uniform-shift model.
 *  - **Polar highs** anchor to the geographic pole (coupling = 0).
 *
 * `itczOffset` is the thermal-equator displacement; positive = southward.
 */
function latitudePressure(lat: number, itczOffset: number): number {
  const thermalEq = 0.5 + itczOffset;

  // Tropical bands — follow the thermal equator.
  const eq = P_EQ_MIN * gauss(lat, thermalEq, ITCZ_SIGMA);
  const hiN = P_SUBTROP * gauss(lat, thermalEq - HADLEY_EXTENT, SUBTROP_SIGMA);
  const hiS = P_SUBTROP * gauss(lat, thermalEq + HADLEY_EXTENT, SUBTROP_SIGMA);

  // Extratropical bands — geographically anchored.
  const loN = P_SUBPOLAR * gauss(lat, POLAR_EXTENT, SUBPOLAR_SIGMA);
  const loS = P_SUBPOLAR * gauss(lat, 1 - POLAR_EXTENT, SUBPOLAR_SIGMA);
  const polN = P_POLAR * gauss(lat, 0, POLAR_SIGMA);
  const polS = P_POLAR * gauss(lat, 1, POLAR_SIGMA);

  return eq + hiN + hiS + loN + loS + polN + polS;
}

/**
 * Build a 2D pressure field. Combines the zonal-mean latitude baseline, an
 * optional thermal-contrast term (warmer-than-zonal-mean → lower pressure,
 * which pulls monsoon inflow onto hot summer continents), and a small
 * synoptic-scale Perlin perturbation.
 */
function buildPressureField(
  width: number,
  height: number,
  itczLatOffset: number,
  thermalField: Float32Array | null,
  thermalContrastStrength: number,
  noise: OpenSimplexNoise,
  nv: NoiseVariables
): Float32Array {
  const size = width * height;
  const P = new Float32Array(size);
  const noiseFreq = nv.frequency * 0.5;

  const rowP = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    rowP[y] = latitudePressure(y / height, itczLatOffset);
  }

  // Zonal-mean temperature per row (so thermal contrast keeps the zonal baseline untouched).
  let zonalMeanT: Float32Array | null = null;
  if (thermalField) {
    zonalMeanT = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) sum += thermalField[y * width + x];
      zonalMeanT[y] = sum / width;
    }
  }

  const np = new Float32Array(3);
  for (let y = 0; y < height; y++) {
    const baseP = rowP[y];
    for (let x = 0; x < width; x++) {
      sphericalEmbed3D(x, y, width, height, np);
      const nPerturb = fBm3D(noise, np[0], np[1], np[2], 2, noiseFreq, 0.5, 2) * 0.15;
      let thermalP = 0;
      if (thermalField && zonalMeanT) {
        const dT = thermalField[y * width + x] - zonalMeanT[y];
        thermalP = -dT * thermalContrastStrength;
      }
      P[y * width + x] = baseP + nPerturb + thermalP;
    }
  }
  return P;
}

/**
 * Geostrophic wind from ∇P, with smooth ageostrophic (down-gradient) blending
 * across the equator where |f| → 0.
 *
 * Derivation (image coords: x east, y south):
 *   v_x = (1/f) · ∂P/∂y      // f signed
 *   v_y = -(1/f) · ∂P/∂x
 */
function geostrophicWind(width: number, height: number, P: Float32Array, windStrength: number): Float32Array {
  const wind = new Float32Array(width * height * 2);
  const gradScale = width; // derivatives are per-cell; scaling by width normalizes for grid size.

  for (let y = 0; y < height; y++) {
    const lat = y / height;
    const f = F0 * Math.sin(Math.PI * (0.5 - lat));
    const absF = Math.abs(f);
    const fReg = Math.max(absF, F_MIN);
    const signF = f >= 0 ? 1 : -1;
    const fSafe = signF * fReg;
    // Weight for geostrophic vs pure-ageostrophic; 0 at equator, ~1 past the tropics.
    const w = absF / (absF + F_MIN);

    const yT = clamp(y - 1, 0, height - 1);
    const yB = clamp(y + 1, 0, height - 1);

    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const xL = mod(x - 1, width);
      const xR = mod(x + 1, width);
      const dPx = (P[y * width + xR] - P[y * width + xL]) * 0.5 * gradScale;
      const dPy = (P[yB * width + x] - P[yT * width + x]) * 0.5 * gradScale;

      const vGx = dPy / fSafe;
      const vGy = -dPx / fSafe;

      // Pure down-gradient flow (toward low pressure) as the equatorial limit.
      const gradMag = Math.sqrt(dPx * dPx + dPy * dPy) + 1e-6;
      const vAx = (-dPx / gradMag) * 0.6;
      const vAy = (-dPy / gradMag) * 0.6;

      wind[idx * 2] = (vGx * w + vAx * (1 - w)) * windStrength;
      wind[idx * 2 + 1] = (vGy * w + vAy * (1 - w)) * windStrength;
    }
  }
  return wind;
}

/**
 * Surface friction rotates wind by ~25° toward the low-pressure side. In
 * image coords this is a clockwise rotation in NH (f>0), counter-clockwise
 * in SH. Attenuates near the equator where geostrophic balance breaks down.
 */
function applyEkmanFriction(width: number, height: number, wind: Float32Array): void {
  const aRad = (EKMAN_DEG * Math.PI) / 180;
  for (let y = 0; y < height; y++) {
    const lat = y / height;
    const fNorm = Math.sin(Math.PI * (0.5 - lat));
    const signF = fNorm >= 0 ? 1 : -1;
    const attenuation = Math.min(1, Math.abs(fNorm) * 3);
    const theta = signF * aRad * attenuation;
    const cT = Math.cos(theta);
    const sT = Math.sin(theta);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 2;
      const wx = wind[idx];
      const wy = wind[idx + 1];
      wind[idx] = wx * cT + wy * sT;
      wind[idx + 1] = -wx * sT + wy * cT;
    }
  }
}

/** Cap wind magnitude so extreme pressure gradients don't explode downstream consumers. */
function clampMagnitude(wind: Float32Array, maxMag: number): void {
  const maxSq = maxMag * maxMag;
  for (let i = 0; i < wind.length; i += 2) {
    const wx = wind[i];
    const wy = wind[i + 1];
    const m2 = wx * wx + wy * wy;
    if (m2 > maxSq) {
      const s = maxMag / Math.sqrt(m2);
      wind[i] = wx * s;
      wind[i + 1] = wy * s;
    }
  }
}

/**
 * Generate a wind field from a pressure-field model.
 *
 * Pass 1 (first-pass): call with `thermalField = null` and `itczLatOffset = 0`.
 * Pass 2 (seasonal): supply the season's temperature field and a matching
 * `itczLatOffset` (negative for NH summer, positive for NH winter) — thermal
 * contrast over continents drives monsoon reversal between the two seasons.
 *
 * The returned wind has non-unit magnitude; the strongest bands (trades,
 * mid-latitude westerlies) sit near |w| ≈ 1 and the doldrums sit closer to
 * zero. Consumers should expect this and clamp when appropriate.
 */
export function generateWind(
  fields: WorldFields,
  nv: NoiseVariables,
  cv: ClimateVariables,
  thermalField: Float32Array | null,
  itczLatOffset: number
): Float32Array {
  const { width, height } = fields;
  const noise = new OpenSimplexNoise((nv.seed ^ 0xfae69060) | 0);
  const P = buildPressureField(width, height, itczLatOffset, thermalField, cv.thermalContrastStrength, noise, nv);
  const wind = geostrophicWind(width, height, P, cv.windStrength);
  applyEkmanFriction(width, height, wind);
  clampMagnitude(wind, 1.5);
  return wind;
}

/**
 * Deflect wind away from steep terrain. Where wind blows uphill, the upslope
 * component is dampened proportionally to the slope; the tangential
 * (along-contour) component is preserved, so flow routes around ridges
 * instead of charging straight into them. Magnitude is NOT renormalized —
 * wind slowing into a range is physically correct.
 *
 * Mutates: `wind` (in place).
 */
export function applyTerrainDeflection(fields: WorldFields, wind: Float32Array): void {
  const { width, height } = fields;
  const elevation = fields.elevation!;
  const seaLevel = fields.seaLevel!;
  const slopeScale = 8;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (elevation[idx] <= seaLevel) continue;

      const wIdx = idx * 2;
      let wx = wind[wIdx];
      let wy = wind[wIdx + 1];

      const xL = mod(x - 1, width);
      const xR = mod(x + 1, width);
      const yT = clamp(y - 1, 0, height - 1);
      const yB = clamp(y + 1, 0, height - 1);
      const gx = (elevation[y * width + xR] - elevation[y * width + xL]) * 0.5;
      const gy = (elevation[yB * width + x] - elevation[yT * width + x]) * 0.5;
      const gMag = Math.sqrt(gx * gx + gy * gy);
      if (gMag < 1e-3) continue;

      const nx = gx / gMag;
      const ny = gy / gMag;
      const along = wx * nx + wy * ny;
      if (along <= 0) continue;

      const slope = Math.min(gMag * slopeScale, 1);
      const reduction = along * slope;
      wx -= nx * reduction;
      wy -= ny * reduction;

      wind[wIdx] = wx;
      wind[wIdx + 1] = wy;
    }
  }
}

/** Compute the cell-wise mean of two wind fields (for the back-compat annual-mean layer). */
export function meanWind(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) * 0.5;
  return out;
}
