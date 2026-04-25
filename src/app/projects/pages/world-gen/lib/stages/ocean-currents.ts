import { clamp, mod } from '@lib/math';
import { ClimateVariables } from '../types';

/**
 * Wind-driven ocean boundary currents transport heat along continental
 * margins. The classic Earth pattern:
 *
 *  - **Cold eastern boundary currents** (California, Peru, Canary, Humboldt,
 *    Benguela) run along the WEST coast of continents = EAST margin of the
 *    ocean basin. Trade winds drag polar water equatorward.
 *  - **Warm western boundary currents** (Gulf Stream, Kuroshio, Brazil,
 *    Agulhas, East Australian) run along the EAST coast of continents =
 *    WEST margin of the ocean basin. Westerlies push equatorial water
 *    poleward.
 *
 * The wind sign alone already gives the right cooling / warming direction
 * (`-currentY * polewardness`) — that's unchanged. What's new here is
 * localizing the effect to coastlines instead of applying it zonally: cold
 * currents only amplify near eastern ocean margins, warm currents only
 * near western margins. Open mid-ocean cells get essentially no modifier,
 * which kills the wind-aligned zonal banding we saw in the earlier model.
 *
 * The modifier is propagated onto adjacent coastal land by the same
 * chamfer pass as before, so downstream coasts inherit the boundary-
 * current temperature (= California coast stays cold even though it's
 * land, = Gulf coast of US stays warm even inland for a few cells).
 */
export interface OceanCurrentResult {
  /** Per-cell temperature modifier in roughly [-strength, +strength]. */
  tempModifier: Float32Array;
  /** Pre-computed propagation distance — nonzero on land, 0 on ocean. */
  distToOcean: Float32Array;
}

/** Boundary-current e-folding length as a fraction of map width. 1/10 gives
 *  ~51 cells on a 512-wide map, roughly the fraction of an ocean basin
 *  within which real boundary currents dominate surface heat transport. */
const BOUNDARY_EFOLD_FRAC = 1 / 10;

export function generateOceanCurrents(
  width: number,
  height: number,
  wind: Float32Array,
  elevation: Float32Array,
  seaLevel: number,
  cv: ClimateVariables
): OceanCurrentResult {
  const size = width * height;
  const tempModifier = new Float32Array(size);
  const distToOcean = new Float32Array(size);
  const INF = width + height;

  // --- 1. Per-row east/west distance-to-land scans --------------------------
  // Two passes per direction handle cylindrical X-wrap cleanly: the first
  // pass seeds the running distance from any wrap-around land; the second
  // pass records the settled values.
  const distLandE = new Float32Array(size);
  const distLandW = new Float32Array(size);

  for (let y = 0; y < height; y++) {
    const rowBase = y * width;

    // Eastward: walk right, resetting to 0 on land, incrementing over ocean.
    let dist = width; // unknown; will be corrected by the second pass
    for (let pass = 0; pass < 2; pass++) {
      for (let x = 0; x < width; x++) {
        const idx = rowBase + x;
        if (elevation[idx] <= seaLevel) dist = dist + 1;
        else dist = 0;
        if (pass === 1) distLandE[idx] = dist;
      }
    }

    // Westward: walk left. Same scheme mirrored.
    dist = width;
    for (let pass = 0; pass < 2; pass++) {
      for (let x = width - 1; x >= 0; x--) {
        const idx = rowBase + x;
        if (elevation[idx] <= seaLevel) dist = dist + 1;
        else dist = 0;
        if (pass === 1) distLandW[idx] = dist;
      }
    }
  }

  // --- 2. Build boundary-weighted temperature modifier ---------------------
  const strength = cv.boundaryCurrentStrength;
  const efold = width * BOUNDARY_EFOLD_FRAC;

  for (let y = 0; y < height; y++) {
    const lat = y / height;
    // +1 at north pole, -1 at south pole, 0 at equator.
    const polewardness = (0.5 - lat) * 2;

    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (elevation[idx] > seaLevel) {
        tempModifier[idx] = 0;
        distToOcean[idx] = INF;
        continue;
      }

      distToOcean[idx] = 0;

      // Wind-driven signed base: +ve = warming current (water carried
      // polewards), −ve = cooling current (water carried equatorward).
      const currentY = wind[idx * 2 + 1];
      const signedBase = -currentY * polewardness;

      // Match sign to the coast it should pile against.
      //   Warming (Gulf-Stream-like) → strong near WESTERN boundary
      //     of the ocean basin = land close to the WEST of this cell.
      //   Cooling (California-like) → strong near EASTERN boundary
      //     = land close to the EAST of this cell.
      const prox = signedBase > 0 ? Math.exp(-distLandW[idx] / efold) : Math.exp(-distLandE[idx] / efold);

      tempModifier[idx] = clamp(signedBase * strength * prox, -strength, strength);
    }
  }

  // Spread the local boundary-current anomaly downstream with the wind so
  // far-field continents inherit the warmth/cool of a remote gyre — e.g.
  // Gulf-Stream warmth reaching a "European" west coast 5000 km away.
  if (cv.sstIterations > 0) {
    advectSstAnomaly(
      width,
      height,
      wind,
      elevation,
      seaLevel,
      tempModifier,
      cv.sstIterations,
      cv.sstDiffusion,
      cv.sstRelaxation
    );
  }

  propagateNearestOcean(width, height, distToOcean, tempModifier);
  return { tempModifier, distToOcean };
}

/**
 * Semi-Lagrangian SST-anomaly transport. Operates in-place on the ocean
 * temperature modifier field. Architecture mirrors the humidity simulation
 * (advect → diffuse → relax) but on a single scalar tied to a persistent
 * source: the boundary-current anomaly is snapshotted on entry and re-added
 * each iteration to model continuous emission at the current's source coast.
 *
 * Known omissions:
 *  - No explicit return flow — this is wind-driven advection, not a mass-
 *    conserving gyre. Only the temperature anomaly advects, not water.
 *  - Uses the annual-mean wind. Seasonal SST differences would need two
 *    passes; downstream code currently uses one modifier for both seasons.
 */
function advectSstAnomaly(
  width: number,
  height: number,
  wind: Float32Array,
  elevation: Float32Array,
  seaLevel: number,
  tempModifier: Float32Array,
  iterations: number,
  diffusion: number,
  relaxation: number
): void {
  const size = width * height;
  const source = new Float32Array(tempModifier);
  const next = new Float32Array(size);
  const diff = clamp(diffusion, 0, 1);
  const relax = clamp(relaxation, 0, 1);
  const relaxKeep = 1 - relax;

  for (let iter = 0; iter < iterations; iter++) {
    // --- 1. Advect (semi-Lagrangian upwind, bilinear interp) ---
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (elevation[idx] > seaLevel) {
          next[idx] = 0;
          continue;
        }
        const wIdx = idx * 2;
        const wx = wind[wIdx];
        const wy = wind[wIdx + 1];
        next[idx] = bilinearSample(tempModifier, x - wx, y - wy, width, height);
      }
    }
    for (let i = 0; i < size; i++) tempModifier[i] = next[i];

    // --- 2. Diffuse — 3×3 box blur restricted to ocean neighbors ---
    // Treat land cells as no-flux boundary so warm/cold anomalies don't
    // leak into land (which is 0 in this field); averaging only over ocean
    // neighbors is equivalent to a mirror condition against the coast.
    if (diff > 0) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (elevation[idx] > seaLevel) {
            next[idx] = 0;
            continue;
          }
          let sum = 0;
          let count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= height) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nIdx = yy * width + mod(x + dx, width);
              if (elevation[nIdx] > seaLevel) continue;
              sum += tempModifier[nIdx];
              count++;
            }
          }
          const avg = count > 0 ? sum / count : tempModifier[idx];
          next[idx] = tempModifier[idx] * (1 - diff) + avg * diff;
        }
      }
      for (let i = 0; i < size; i++) tempModifier[i] = next[i];
    }

    // --- 3. Relax + 4. Reinject boundary source as a *rate*, not a reset ---
    // Balanced source term: with no advection, steady state is value = source
    // (v·(1-r) + src·r = v ⇒ v = src). With advection, the signal spreads
    // downstream and decays with e-fold length ≈ |wind| / relaxation.
    // Reinjecting at 100% per iteration would pile up to source/relaxation
    // (≈17× at defaults), which saturates the palette and looks non-physical.
    for (let i = 0; i < size; i++) {
      if (elevation[i] > seaLevel) {
        tempModifier[i] = 0;
        continue;
      }
      tempModifier[i] = tempModifier[i] * relaxKeep + source[i] * relax;
    }
  }
}

/** Bilinear sample with cylindrical X wrap and clamped Y. */
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

/**
 * Two-pass chamfer that simultaneously propagates Euclidean-approx distance
 * and copies the modifier value from whichever neighbor "won" the relaxation.
 * On exit, every land cell holds the modifier of its nearest ocean cell.
 */
function propagateNearestOcean(width: number, height: number, dist: Float32Array, modifier: Float32Array): void {
  const relax = (idx: number, srcIdx: number, cost: number): void => {
    const candidate = dist[srcIdx] + cost;
    if (candidate < dist[idx]) {
      dist[idx] = candidate;
      modifier[idx] = modifier[srcIdx];
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      relax(idx, y * width + mod(x - 1, width), 1);
      if (y > 0) {
        relax(idx, (y - 1) * width + x, 1);
        relax(idx, (y - 1) * width + mod(x - 1, width), 1.414);
        relax(idx, (y - 1) * width + mod(x + 1, width), 1.414);
      }
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = y * width + x;
      relax(idx, y * width + mod(x + 1, width), 1);
      if (y < height - 1) {
        relax(idx, (y + 1) * width + x, 1);
        relax(idx, (y + 1) * width + mod(x - 1, width), 1.414);
        relax(idx, (y + 1) * width + mod(x + 1, width), 1.414);
      }
    }
  }

  // Suppress modifier deep inland: scale by 1 - clamp(dist / maxInfluence)
  const maxInfluence = Math.round(width / 8);
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] > 0) {
      const proximity = clamp(1 - dist[i] / maxInfluence, 0, 1);
      modifier[i] *= proximity;
    }
  }
}
