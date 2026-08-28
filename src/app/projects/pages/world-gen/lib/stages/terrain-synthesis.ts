import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { mod, sphericalEmbed3D } from '@lib/math';
import { NoiseVariables, TectonicVariables, WorldFields } from '../types';
import { TectonicResult } from './tectonic';
import { LAND_PLATFORM_M, LAND_GAMMA, OCEAN_M_PER_UNIT, ELEV_MIN_M, ELEV_MAX_M, SEA_LEVEL_M } from './terrain-levels';

/**
 * Terrain synthesis — the physical-elevation stage (replaces the old
 * `elevation.ts` + `post-processing.ts`).
 *
 * Takes the dimensionless tectonic `baseElevation` plus its context masks and
 * produces the final pre-erosion surface in **real meters**:
 *
 *   1. One domain-warped bilinear read of `baseElevation` → a dimensionless
 *      "tectonic potential" per pixel. (The tectonic stage already warps the
 *      stamping; this is the single late read-warp that makes coastlines
 *      dendritic — we no longer warp a second time.)
 *   2. The `waterPercentage` percentile of that potential is the sea-level
 *      crossing (`seaPotential`). Computing the partition in potential space,
 *      before the transfer, keeps the `waterPercentage` control honest and
 *      pins the coastline independently of the meters scale.
 *   3. The transfer to meters, sea level at 0: the ocean side is a linear
 *      `OCEAN_M_PER_UNIT` drop; the land side is a LOW hypsometric platform
 *      (`pow(t, LAND_GAMMA) · LAND_PLATFORM_M`) so the smooth continental
 *      swells stay gentle hills. Tall, detailed relief is added separately on
 *      the tectonic mountain belts (step 4), so white peaks track plate
 *      boundaries instead of being smooth potential blobs.
 *   4. Context-keyed multi-scale detail **in meters**, with amplitude and
 *      character driven by the tectonic masks rather than a single global fBm:
 *      smooth swells on cratons, ridged uplift sharpening active mountain
 *      belts, rough young-ocean abyssal hills smoothing onto old crust, extra
 *      roughness on volcanic arcs. This folds in the old post-processing
 *      mountain boost.
 *
 * Erosion (hydrology) is the primary texture source downstream; this stage's
 * job is to hand it a good, physically-scaled uneroded surface.
 */

export interface ElevationResult {
  elevation: Float32Array;
  seaLevel: number;
}

// ── Context-detail amplitudes, in meters ────────────────────────────────────
/** Signed low-frequency continental swell (cratons, intracratonic basins). */
const CONT_SWELL_M = 400;
/** Signed higher-frequency detail dissecting plains so they aren't smooth
 *  domes. Mean-zero, so it adds texture without raising the land mean. */
const CONT_FINE_M = 220;
/** Peak ridged uplift where the mountain mask saturates. This — not the smooth
 *  continental platform — is the source of tall, white, *detailed* relief, and
 *  it sits on the tectonic belts (convergent boundaries), so mountains track
 *  plate tectonics and the erosion network then dissects them. */
const OROGEN_UPLIFT_M = 5000;
/** Signed slope roughness scaled by the mountain mask. */
const OROGEN_ROUGH_M = 900;
/** Abyssal-hill roughness on the youngest (ridge-crest) oceanic crust… */
const YOUNG_OCEAN_AMP_M = 400;
/** …decaying to this on the oldest, sediment-blanketed abyssal plains. */
const OLD_OCEAN_AMP_M = 80;
/** Extra signed roughness stamped along volcanic island arcs. */
const VOLCANIC_ROUGH_M = 300;

export function generateTerrainSynthesis(
  fields: WorldFields,
  tectonic: TectonicResult,
  nv: NoiseVariables,
  tv: TectonicVariables
): ElevationResult {
  const { width, height } = fields;
  const { baseElevation, mountainRanges, oceanAge, volcanicArcs, plateMap, plates } = tectonic;

  const warpNoiseX = new OpenSimplexNoise((nv.seed ^ 0x5eeda7a1) | 0);
  const warpNoiseY = new OpenSimplexNoise((nv.seed ^ 0x7a7f1337) | 0);
  // Detail noises: a smooth fBm field, a decorrelated roughness field, and a
  // ridged accumulator instance for belt sharpening.
  const smoothNoise = new OpenSimplexNoise(nv.seed);
  const roughNoise = new OpenSimplexNoise((nv.seed ^ 0x3c6ef35f) | 0);
  const ridgeNoise = new OpenSimplexNoise((nv.seed ^ 0x9e3779b1) | 0);

  const detailFreq = nv.frequency * 0.5;
  const roughFreq = nv.frequency * 4.0;
  const ridgeFreq = nv.frequency * 2.5;

  // Domain warp (single late read-warp). Magnitude scales with characteristic
  // plate radius so the offset can reach across a cell without over-smearing.
  const warpFreq = nv.frequency * tv.coastlineWarpFrequency;
  const plateRadius = Math.sqrt((width * height) / Math.max(1, plates.length));
  const warpAmp = tv.coastlineWarpAmplitude * plateRadius;

  // ── Pass 1: dimensionless tectonic potential (warp + bilinear read) ───────
  const potential = new Float32Array(width * height);
  const np = new Float32Array(3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      sphericalEmbed3D(x, y, width, height, np);
      const wx = warpNoiseX.eval3D(np[0] * warpFreq, np[1] * warpFreq, np[2] * warpFreq) * warpAmp;
      const wy = warpNoiseY.eval3D(np[0] * warpFreq, np[1] * warpFreq, np[2] * warpFreq) * warpAmp;
      potential[idx] = sampleBilinear(baseElevation, width, height, x + wx, y + wy);
    }
  }

  // ── Pass 2: sea-level crossing + land span in potential space ─────────────
  // One sort serves both: the waterPercentage percentile is the coastline, and
  // a high land percentile anchors the hypsometric span (robust to a few
  // extreme collision-peak cells, which would otherwise squash all normal land
  // toward sea level). Land cells above the anchor overshoot t>1 and clamp.
  const sorted = Float32Array.from(potential).sort();
  const lastIdx = sorted.length - 1;
  const seaPotential = sorted[Math.floor(nv.waterPercentage * lastIdx)];
  const landAnchor = sorted[Math.floor((nv.waterPercentage + 0.95 * (1 - nv.waterPercentage)) * lastIdx)];
  const landSpan = Math.max(1e-6, landAnchor - seaPotential);

  // Dilate the mountain mask (3×3 max) so orogen uplift keeps the belt width
  // the old post-processing boost gave it before erosion dissects the ranges.
  const mrDilated = dilateMask(mountainRanges, width, height);

  // ── Pass 3 + 4: transfer to meters, then add context-keyed detail ─────────
  const elevation = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pot = potential[idx] - seaPotential;

      sphericalEmbed3D(x, y, width, height, np);
      const nx = np[0];
      const ny = np[1];
      const nz = np[2];
      const smooth = fBm3D(smoothNoise, nx, ny, nz, nv.octaves, detailFreq, nv.persistence, nv.lacunarity);

      let m: number;
      if (pot >= 0) {
        // Low continental platform: normalize above-sea potential to [0, 1]
        // (clamped, so high swells don't overshoot into tall white blobs),
        // raise to LAND_GAMMA so the bulk sits low, scale to LAND_PLATFORM_M.
        const t = pot >= landSpan ? 1 : pot / landSpan;
        m = Math.pow(t, LAND_GAMMA) * LAND_PLATFORM_M;
        // Signed multi-scale detail dissects plains (mean-zero → mean preserved).
        const fine = roughNoise.eval3D(nx * roughFreq, ny * roughFreq, nz * roughFreq);
        m += smooth * CONT_SWELL_M + fine * CONT_FINE_M;
        // Tall, detailed relief lives on the tectonic mountain belts, not the
        // smooth platform — so white peaks track plate boundaries.
        const act = mrDilated[idx]; // [0, 1]
        if (act > 0) {
          const ridge = ridged(ridgeNoise, nx, ny, nz, ridgeFreq);
          m += ridge * OROGEN_UPLIFT_M * act; // positive uplift, sharpens belts
          m += fine * OROGEN_ROUGH_M * act; // extra slope roughness on ranges
        }
      } else {
        // Ocean side: straight linear transfer (deeper slope, shelf reads well).
        m = pot * OCEAN_M_PER_UNIT;
        const age = oceanAge[idx]; // 0 young (ridge) … 1 old (abyssal)
        const amp = YOUNG_OCEAN_AMP_M * (1 - age) + OLD_OCEAN_AMP_M * age;
        m += smooth * amp;
        const va = volcanicArcs[idx];
        if (va > 0) {
          const rough = roughNoise.eval3D(nx * roughFreq, ny * roughFreq, nz * roughFreq);
          m += rough * VOLCANIC_ROUGH_M * va;
        }
      }

      elevation[idx] = m < ELEV_MIN_M ? ELEV_MIN_M : m > ELEV_MAX_M ? ELEV_MAX_M : m;
    }
  }

  return { elevation, seaLevel: SEA_LEVEL_M };
}

/** Ridged-multifractal accumulator in [0, 1]: `1 - |fBm|`, sharpened into
 *  belts. Non-integer lacunarity keeps octaves from re-aligning into a grid. */
function ridged(noise: OpenSimplexNoise, nx: number, ny: number, nz: number, freq: number): number {
  let sum = 0;
  let range = 0;
  let f = freq;
  let a = 1;
  for (let o = 0; o < 4; o++) {
    const off = o * 13.0;
    let rn = noise.eval3D(nx * f + off, ny * f + off, nz * f - off);
    rn = 1 - Math.abs(rn);
    sum += rn * a;
    range += a;
    f *= 2.13;
    a *= 0.5;
  }
  const r = sum / Math.max(range, 1);
  return r * r * r; // suppress plains, keep belts
}

/** 3×3 max-filter dilation of a mask. Wraps in X (cylindrical), clamps in Y. */
function dilateMask(src: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = src[y * width + x];
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = mod(x + dx, width);
          const v = src[ny * width + nx];
          if (v > maxVal) maxVal = v;
        }
      }
      out[y * width + x] = maxVal;
    }
  }
  return out;
}

/** Bilinear sample at a (possibly fractional) image position. Wraps in X
 *  (cylindrical) and clamps in Y. */
function sampleBilinear(field: Float32Array, width: number, height: number, x: number, y: number): number {
  const yc = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(x);
  const y0 = Math.floor(yc);
  const fx = x - x0;
  const fy = yc - y0;
  const x0w = mod(x0, width);
  const x1w = mod(x0 + 1, width);
  const y0c = Math.max(0, Math.min(height - 1, y0));
  const y1c = Math.max(0, Math.min(height - 1, y0 + 1));
  const a = field[y0c * width + x0w];
  const b = field[y0c * width + x1w];
  const c = field[y1c * width + x0w];
  const d = field[y1c * width + x1w];
  const ab = a * (1 - fx) + b * fx;
  const cd = c * (1 - fx) + d * fx;
  return ab * (1 - fy) + cd * fy;
}
