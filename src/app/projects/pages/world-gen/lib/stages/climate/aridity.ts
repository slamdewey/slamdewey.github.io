import { ClimateVariables } from '../../types';

export interface DerivedClimate {
  /** UNEP aridity index: MAP / PET (both in mm/year). 0 = hyper-arid, > 0.65 = humid.
   *  Uncapped — Earth's wettest tropics legitimately reach AI ≈ 4. */
  aridityIndex: Float32Array;
  /** Precipitation seasonality concentration [0, 1]. 0 = uniform, 1 = all in one season. */
  seasonality: Float32Array;
  /** Annual temperature range, normalized against a 30 °C reference swing.
   *  0 = oceanic (no swing), 1 = strongly continental (≥ 30 °C amplitude). */
  continentality: Float32Array;
  /** Fraction of year above frost & wilt point [0, 1]. */
  growingSeason: Float32Array;
}

/** Reference swing for normalizing continentality to [0, 1]. 30 °C summer-to-winter
 *  amplitude approximates Earth's most extreme continental interiors (Yakutia). */
const CONTINENTALITY_REFERENCE_C = 30;

/**
 * Compute climate-derived metrics that biome classification cares about.
 *
 * Aridity drives Köppen B (desert/steppe) classification and is the single
 * most useful summary of "wet vs dry" because it captures the interaction
 * between rainfall and evaporative demand — a polar climate with low
 * precipitation isn't arid because PET is also low.
 *
 * Seasonality and continentality drive the s/w/f sub-letters in Köppen and
 * determine whether a temperate climate is Mediterranean (Csa/Csb), oceanic
 * (Cfb), or continental-feeling.
 */
export function deriveClimate(
  temperatureSummer: Float32Array,
  temperatureWinter: Float32Array,
  precipSummer: Float32Array,
  precipWinter: Float32Array,
  petAnnual: Float32Array,
  cv: ClimateVariables
): DerivedClimate {
  const size = temperatureSummer.length;
  const aridityIndex = new Float32Array(size);
  const seasonality = new Float32Array(size);
  const continentality = new Float32Array(size);
  const growingSeason = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    const map = precipSummer[i] + precipWinter[i];
    const pet = petAnnual[i];

    // Aridity: pure ratio MAP/PET, uncapped. Cells with no PET demand
    // (sub-frost) report a sentinel high humidity since they're moisture-rich
    // by definition (no evaporation drives them dry).
    aridityIndex[i] = pet > 1 ? map / pet : 100;

    // Seasonality: |Ps - Pw| / (Ps + Pw + ε)
    seasonality[i] = map > 1 ? Math.abs(precipSummer[i] - precipWinter[i]) / map : 0;

    // Continentality: |Tsummer - Twinter| in °C, normalized against the
    // reference swing of 30 °C (deep continental).
    const range = Math.abs(temperatureSummer[i] - temperatureWinter[i]);
    continentality[i] = Math.min(1, range / CONTINENTALITY_REFERENCE_C);

    // Growing season as a continuous productivity index. Per season, smoothly
    // interpolate temperature suitability (around the frost threshold) and
    // moisture suitability (around the wilt point), then multiply: growth
    // needs BOTH warmth and water. Average across the two seasons.
    const summerAi = precipSummer[i] / Math.max(1, petAnnual[i] * 0.5);
    const winterAi = precipWinter[i] / Math.max(1, petAnnual[i] * 0.5);
    const summerFav = seasonFavorability(temperatureSummer[i], summerAi, cv.frostThreshold, cv.aridityWiltPoint);
    const winterFav = seasonFavorability(temperatureWinter[i], winterAi, cv.frostThreshold, cv.aridityWiltPoint);
    growingSeason[i] = (summerFav + winterFav) * 0.5;
  }

  return { aridityIndex, seasonality, continentality, growingSeason };
}

/**
 * Per-season vegetation favorability ∈ [0, 1]. Smoothstep around each
 * threshold: just under = trace growth, just over = strong growth, well
 * past = saturated. Temperature in °C; AI is the dimensionless ratio.
 */
function seasonFavorability(tempC: number, ai: number, frostC: number, wiltAI: number): number {
  // Temperature: trace growth ~5 °C above frost, saturating ~15 °C above.
  const tFactor = smoothstep(frostC - 2, frostC + 15, tempC);
  // Moisture: AI 0.05 below wilt = no growth, AI 0.25 above wilt = saturated.
  const mFactor = smoothstep(wiltAI - 0.05, wiltAI + 0.25, ai);
  return tFactor * mFactor;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
