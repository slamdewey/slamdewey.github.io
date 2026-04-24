import { ClimateVariables } from '../../types';

export interface DerivedClimate {
  /** UNEP aridity index: MAP / PET. 0 = hyper-arid, > 0.65 = humid. */
  aridityIndex: Float32Array;
  /** Precipitation seasonality concentration [0, 1]. 0 = uniform, 1 = all in one season. */
  seasonality: Float32Array;
  /** Annual temperature range [0, 1]. 0 = oceanic, 1 = continental. */
  continentality: Float32Array;
  /** Fraction of year above frost & wilt point [0, 1]. */
  growingSeason: Float32Array;
}

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

    // Aridity: cap at 1.5 so very humid cells don't dominate the color scale.
    const ai = pet > 1e-4 ? Math.min(1.5, map / pet) : 1.5;
    aridityIndex[i] = ai;

    // Seasonality: |Ps - Pw| / (Ps + Pw + ε)
    seasonality[i] = map > 1e-4 ? Math.abs(precipSummer[i] - precipWinter[i]) / map : 0;

    // Continentality: |Tsummer - Twinter|, clamped to [0, 1]
    const range = Math.abs(temperatureSummer[i] - temperatureWinter[i]);
    continentality[i] = Math.min(1, range * 2);

    // Growing season as a continuous productivity index. Per season, smoothly
    // interpolate temperature suitability (around the frost threshold) and
    // moisture suitability (around the wilt point), then multiply: growth
    // needs BOTH warmth and water. Average across the two seasons.
    //
    // Output is a smooth [0, 1] gradient — not a Köppen-style discrete
    // months-above-threshold count. The Köppen classifier doesn't read this
    // field, so smoothing it is purely a visualization improvement.
    const summerAi = precipSummer[i] / Math.max(1e-4, pet * 0.5);
    const winterAi = precipWinter[i] / Math.max(1e-4, pet * 0.5);
    const summerFav = seasonFavorability(temperatureSummer[i], summerAi, cv.frostThreshold, cv.aridityWiltPoint);
    const winterFav = seasonFavorability(temperatureWinter[i], winterAi, cv.frostThreshold, cv.aridityWiltPoint);
    growingSeason[i] = (summerFav + winterFav) * 0.5;
  }

  return { aridityIndex, seasonality, continentality, growingSeason };
}

/**
 * Per-season vegetation favorability ∈ [0, 1]. Smoothstep around each
 * threshold: just under = trace growth, just over = strong growth, well
 * past = saturated.
 */
function seasonFavorability(temp: number, ai: number, frostT: number, wiltAI: number): number {
  const tFactor = smoothstep(frostT - 0.05, frostT + 0.2, temp);
  const mFactor = smoothstep(wiltAI - 0.05, wiltAI + 0.25, ai);
  return tFactor * mFactor;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
