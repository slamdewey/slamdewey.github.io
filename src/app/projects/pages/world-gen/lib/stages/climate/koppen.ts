/**
 * Köppen-Geiger climate classification in physical units (°C and mm/year).
 *
 * Thresholds are the textbook values from Kottek et al. (2006) / Peel et al.
 * (2007), not tuned percentiles. The B-class precipitation threshold uses the
 * canonical formula `P_threshold_mm = 20 · T_annual_C + α` where α depends on
 * the seasonal distribution of rainfall.
 */
export enum KoppenClass {
  // A — Tropical (T_coldest > 18 °C)
  Af, // tropical rainforest
  Am, // tropical monsoon
  Aw, // tropical savanna (winter-dry)
  // B — Arid (precipitation below temperature-dependent threshold)
  BWh, // hot desert
  BWk, // cold desert
  BSh, // hot steppe
  BSk, // cold steppe
  // C — Temperate (mild winters, no severe cold)
  Cfa, // humid subtropical
  Cfb, // oceanic
  Csa, // hot mediterranean
  Csb, // warm mediterranean
  Cwa, // monsoon-influenced subtropical
  Cwb, // subtropical highland
  // D — Continental (cold winters, T_coldest ≤ 0 °C)
  Dfa, // hot continental
  Dfb, // warm continental
  Dfc, // subarctic
  Dwa, // dry winter continental
  Dwb, // dry winter continental cool
  Dsa, // dry summer continental hot
  Dsb, // dry summer continental warm
  // E — Polar (T_warmest < 10 °C)
  ET, // tundra
  EF, // ice cap
}

// Köppen-Geiger temperature thresholds in °C.
const T_TROPICAL_COLDEST = 18; // A class: coldest month > 18 °C
const T_NO_FROST = 0; // D class: coldest month ≤ 0 °C
const T_POLAR_WARMEST = 10; // E class: warmest month < 10 °C
const T_ICECAP_WARMEST = 0; // EF: warmest month < 0 °C
const T_HOT_SUMMER = 22; // a sub-letter: warmest month ≥ 22 °C
const T_COOL_SUMMER = 18; // approximate b/c boundary without monthly data

// 70 %-of-rainfall threshold for the Köppen seasonality offset (α).
const SEASONAL_DOMINANCE = 0.7;

// 1/10 rule for s/w sub-letters: driest month (or season) must be < 1/10 of wettest.
const SEASONAL_RATIO = 0.1;

export interface KoppenInputs {
  /** Summer mean temperature in °C. */
  temperatureSummer: Float32Array;
  /** Winter mean temperature in °C. */
  temperatureWinter: Float32Array;
  /** Per-season precipitation in mm. */
  precipSummer: Float32Array;
  precipWinter: Float32Array;
  /** Aridity index MAP/PET, dimensionless. */
  aridityIndex: Float32Array;
  /** Annual PET in mm/year — used to gate the B class away from polar deserts. */
  petAnnual: Float32Array;
  elevation: Float32Array;
  seaLevel: number;
}

/** Cells with annual PET below this floor (mm/year) have no meaningful
 *  evaporative demand and skip the B class regardless of MAP — the cell
 *  goes to E or D instead. */
const PET_B_FLOOR_MM = 100;

/**
 * Per-cell Köppen classification — pure function over scalar inputs.
 * Extracted from `classifyKoppen` so the same logic can be evaluated at
 * arbitrary render resolution via the WorldSampler (Phase A5).
 *
 * Ocean cells (elevation < seaLevel) return `KoppenClass.EF` as a sentinel
 * that the biome stage / colorizer treats as "ignore."
 */
export function classifyKoppenAt(
  tSummer: number,
  tWinter: number,
  pSummer: number,
  pWinter: number,
  petAnnual: number,
  elevation: number,
  seaLevel: number
): KoppenClass {
  if (elevation < seaLevel) return KoppenClass.EF;

  const tColdest = Math.min(tSummer, tWinter);
  const tWarmest = Math.max(tSummer, tWinter);
  const tAnnualMean = (tSummer + tWinter) * 0.5;
  const totalP = pSummer + pWinter;

  // True monsoonal seasonality: dry season < 1/10 of wet season.
  const wetSeason = Math.max(pSummer, pWinter);
  const isDryWinter = wetSeason > 1 && pWinter < SEASONAL_RATIO * pSummer;
  const isDrySummer = wetSeason > 1 && pSummer < SEASONAL_RATIO * pWinter;

  // E — Polar (warmest "month" too cold)
  if (tWarmest < T_POLAR_WARMEST) {
    return tWarmest < T_ICECAP_WARMEST ? KoppenClass.EF : KoppenClass.ET;
  }

  // B — Arid via Köppen-Geiger P_threshold formula.
  if (petAnnual >= PET_B_FLOOR_MM) {
    const summerShare = totalP > 0 ? pSummer / totalP : 0.5;
    let alpha = 140;
    if (summerShare >= SEASONAL_DOMINANCE) alpha = 280;
    else if (summerShare <= 1 - SEASONAL_DOMINANCE) alpha = 0;
    const pThresh = 20 * tAnnualMean + alpha;
    if (totalP < pThresh) {
      const isDesert = totalP < 0.5 * pThresh;
      const isHot = tAnnualMean >= T_TROPICAL_COLDEST;
      if (isDesert) return isHot ? KoppenClass.BWh : KoppenClass.BWk;
      return isHot ? KoppenClass.BSh : KoppenClass.BSk;
    }
  }

  // A — Tropical (no cold winters)
  if (tColdest > T_TROPICAL_COLDEST) {
    const driestSeason = Math.min(pSummer, pWinter);
    if (driestSeason >= 360) return KoppenClass.Af;
    if (driestSeason >= 150) return KoppenClass.Am;
    return KoppenClass.Aw;
  }

  // D — Continental (cold winters)
  if (tColdest <= T_NO_FROST) {
    const isHotSummer = tWarmest >= T_HOT_SUMMER;
    const isCoolSummer = tWarmest < T_COOL_SUMMER;
    if (isDrySummer) return isHotSummer ? KoppenClass.Dsa : KoppenClass.Dsb;
    if (isDryWinter) return isHotSummer ? KoppenClass.Dwa : KoppenClass.Dwb;
    if (isCoolSummer) return KoppenClass.Dfc;
    if (isHotSummer) return KoppenClass.Dfa;
    return KoppenClass.Dfb;
  }

  // C — Temperate (mild winters)
  const isHotSummer = tWarmest >= T_HOT_SUMMER;
  if (isDrySummer) return isHotSummer ? KoppenClass.Csa : KoppenClass.Csb;
  if (isDryWinter) return isHotSummer ? KoppenClass.Cwa : KoppenClass.Cwb;
  return isHotSummer ? KoppenClass.Cfa : KoppenClass.Cfb;
}

/**
 * Classify every cell of the physics grid. Ocean cells get the EF sentinel
 * (the biome stage ignores them and uses elevation-based water classes
 * instead). Loop body delegates to `classifyKoppenAt` so render-resolution
 * callers (color-maps.ts) reuse identical logic.
 */
export function classifyKoppen(inputs: KoppenInputs): Uint8Array {
  const { temperatureSummer, temperatureWinter, precipSummer, precipWinter, petAnnual, elevation, seaLevel } = inputs;
  const size = elevation.length;
  const out = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    out[i] = classifyKoppenAt(
      temperatureSummer[i],
      temperatureWinter[i],
      precipSummer[i],
      precipWinter[i],
      petAnnual[i],
      elevation[i],
      seaLevel
    );
  }

  return out;
}
