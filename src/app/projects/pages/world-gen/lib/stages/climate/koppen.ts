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
 * Classify each cell. Ocean cells get a sentinel value (overridden by the
 * biome stage anyway).
 */
export function classifyKoppen(inputs: KoppenInputs): Uint8Array {
  const { temperatureSummer, temperatureWinter, precipSummer, precipWinter, petAnnual, elevation, seaLevel } = inputs;
  const size = elevation.length;
  const out = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    if (elevation[i] < seaLevel) {
      out[i] = KoppenClass.EF; // sentinel, ignored downstream
      continue;
    }

    const tSummer = temperatureSummer[i];
    const tWinter = temperatureWinter[i];
    const tColdest = Math.min(tSummer, tWinter);
    const tWarmest = Math.max(tSummer, tWinter);
    const tAnnualMean = (tSummer + tWinter) * 0.5;
    const pSummer = precipSummer[i];
    const pWinter = precipWinter[i];
    const totalP = pSummer + pWinter;

    // True monsoonal seasonality: dry season < 1/10 of wet season.
    // No absolute floor needed when precip is in mm — the ratio test
    // is meaningful even at low magnitudes (winter <1 mm vs summer 50 mm
    // is genuine seasonality, not the model floundering near zero).
    const wetSeason = Math.max(pSummer, pWinter);
    const isDryWinter = wetSeason > 1 && pWinter < SEASONAL_RATIO * pSummer;
    const isDrySummer = wetSeason > 1 && pSummer < SEASONAL_RATIO * pWinter;

    // E — Polar (warmest "month" too cold)
    if (tWarmest < T_POLAR_WARMEST) {
      out[i] = tWarmest < T_ICECAP_WARMEST ? KoppenClass.EF : KoppenClass.ET;
      continue;
    }

    // B — Arid via Köppen-Geiger P_threshold formula:
    //   P_threshold_mm = 20 · T_annual_C + α
    //   α = 280 if 70 %+ of rain falls in summer (warm half)
    //   α = 140 if rainfall is balanced
    //   α = 0   if 70 %+ falls in winter (cool half)
    //   BW (desert) when MAP < 0.5 × P_threshold
    //   BS (steppe) when MAP < 1.0 × P_threshold
    if (petAnnual[i] >= PET_B_FLOOR_MM) {
      const summerShare = totalP > 0 ? pSummer / totalP : 0.5;
      let alpha = 140;
      if (summerShare >= SEASONAL_DOMINANCE) alpha = 280;
      else if (summerShare <= 1 - SEASONAL_DOMINANCE) alpha = 0;
      const pThresh = 20 * tAnnualMean + alpha;
      if (totalP < pThresh) {
        const isDesert = totalP < 0.5 * pThresh;
        const isHot = tAnnualMean >= T_TROPICAL_COLDEST;
        if (isDesert) {
          out[i] = isHot ? KoppenClass.BWh : KoppenClass.BWk;
        } else {
          out[i] = isHot ? KoppenClass.BSh : KoppenClass.BSk;
        }
        continue;
      }
    }

    // A — Tropical (no cold winters)
    if (tColdest > T_TROPICAL_COLDEST) {
      // Driest-month proxy: minimum of summer/winter precip averaged across
      // the season. Köppen's textbook cutoff is 60 mm for the driest month;
      // we use seasonal totals so scale up by a 6-month season → ~360 mm
      // separates Af/Am, ~150 mm separates Am/Aw.
      const driestSeason = Math.min(pSummer, pWinter);
      if (driestSeason >= 360) {
        out[i] = KoppenClass.Af;
      } else if (driestSeason >= 150) {
        out[i] = KoppenClass.Am;
      } else {
        out[i] = KoppenClass.Aw;
      }
      continue;
    }

    // D — Continental (cold winters)
    if (tColdest <= T_NO_FROST) {
      const isHotSummer = tWarmest >= T_HOT_SUMMER;
      const isCoolSummer = tWarmest < T_COOL_SUMMER;
      if (isDrySummer) {
        out[i] = isHotSummer ? KoppenClass.Dsa : KoppenClass.Dsb;
      } else if (isDryWinter) {
        out[i] = isHotSummer ? KoppenClass.Dwa : KoppenClass.Dwb;
      } else {
        if (isCoolSummer) out[i] = KoppenClass.Dfc;
        else if (isHotSummer) out[i] = KoppenClass.Dfa;
        else out[i] = KoppenClass.Dfb;
      }
      continue;
    }

    // C — Temperate (mild winters)
    const isHotSummer = tWarmest >= T_HOT_SUMMER;
    if (isDrySummer) {
      out[i] = isHotSummer ? KoppenClass.Csa : KoppenClass.Csb;
    } else if (isDryWinter) {
      out[i] = isHotSummer ? KoppenClass.Cwa : KoppenClass.Cwb;
    } else {
      out[i] = isHotSummer ? KoppenClass.Cfa : KoppenClass.Cfb;
    }
  }

  return out;
}
