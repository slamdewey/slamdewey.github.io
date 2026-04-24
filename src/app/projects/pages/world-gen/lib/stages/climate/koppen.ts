/**
 * Köppen-Geiger climate classification adapted to our normalized [0, 1]
 * temperature and precipitation fields.
 *
 * Standard Köppen uses absolute °C and mm — we use thresholds tuned to give
 * Earth-like distributions when temperature and precipitation are produced
 * by our seasonal sim. The five top-level groups (A/B/C/D/E) and their
 * precipitation/temperature subdivisions match the textbook taxonomy.
 */
export enum KoppenClass {
  // A — Tropical (T_coldest > tropical threshold)
  Af, // tropical rainforest
  Am, // tropical monsoon
  Aw, // tropical savanna (winter-dry)
  // B — Arid (aridity-index based)
  BWh, // hot desert
  BWk, // cold desert
  BSh, // hot steppe
  BSk, // cold steppe
  // C — Temperate (T_coldest in temperate range, no severe cold winters)
  Cfa, // humid subtropical
  Cfb, // oceanic
  Csa, // hot mediterranean
  Csb, // warm mediterranean
  Cwa, // monsoon-influenced subtropical
  Cwb, // subtropical highland
  // D — Continental (cold winters)
  Dfa, // hot continental
  Dfb, // warm continental
  Dfc, // subarctic
  Dwa, // dry winter continental
  Dwb, // dry winter continental cool
  Dsa, // dry summer continental hot
  Dsb, // dry summer continental warm
  // E — Polar
  ET, // tundra
  EF, // ice cap
}

// Normalized-temperature thresholds. These map roughly to Köppen's °C cutoffs
// when temperature is produced by our [0, 1] latitude parabola. Adjust if
// the climate sim is retuned.
const T_TROPICAL_COLDEST = 0.65; // ~18°C coldest-month for A class
const T_NO_FROST = 0.5; // ~0°C coldest-month for C vs D
const T_POLAR_WARMEST = 0.3; // ~10°C warmest-month for E class
const T_ICECAP_WARMEST = 0.15; // ~0°C warmest-month for EF
const T_HOT_SUMMER = 0.75; // ~22°C warmest-month for a (vs b/c)
const T_COOL_SUMMER = 0.55; // ~10°C threshold for c (subarctic)

// Aridity thresholds for B class. AI = MAP / PET.
const AI_DESERT = 0.2;
const AI_STEPPE = 0.5;

// Seasonality thresholds for w/s/f sub-letters
const SEASONAL_RATIO_DRY = 0.35;

export interface KoppenInputs {
  temperatureSummer: Float32Array;
  temperatureWinter: Float32Array;
  precipSummer: Float32Array;
  precipWinter: Float32Array;
  aridityIndex: Float32Array;
  elevation: Float32Array;
  seaLevel: number;
}

/**
 * Classify each cell. Ocean cells get an "arbitrary" value (we pick `EF` as
 * a sentinel — biome stage overrides water cells anyway).
 */
export function classifyKoppen(inputs: KoppenInputs): Uint8Array {
  const { temperatureSummer, temperatureWinter, precipSummer, precipWinter, aridityIndex, elevation, seaLevel } =
    inputs;
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
    const pSummer = precipSummer[i];
    const pWinter = precipWinter[i];
    const totalP = pSummer + pWinter;
    const summerShare = totalP > 0 ? pSummer / totalP : 0.5;
    const ai = aridityIndex[i];

    // E — Polar (warmest "month" too cold)
    if (tWarmest < T_POLAR_WARMEST) {
      out[i] = tWarmest < T_ICECAP_WARMEST ? KoppenClass.EF : KoppenClass.ET;
      continue;
    }

    // B — Arid (aridity index dominant)
    if (ai < AI_STEPPE) {
      const isDesert = ai < AI_DESERT;
      const isHot = tWarmest >= T_HOT_SUMMER;
      if (isDesert) {
        out[i] = isHot ? KoppenClass.BWh : KoppenClass.BWk;
      } else {
        out[i] = isHot ? KoppenClass.BSh : KoppenClass.BSk;
      }
      continue;
    }

    // A — Tropical (no cold winters)
    if (tColdest > T_TROPICAL_COLDEST) {
      // Driest-season precipitation determines Af/Am/Aw
      const driestShare = Math.min(summerShare, 1 - summerShare);
      const driestPrecip = totalP * driestShare;
      if (driestPrecip > 0.25) {
        out[i] = KoppenClass.Af;
      } else if (driestPrecip > 0.1) {
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
      // Sub-letter for seasonality
      if (summerShare < SEASONAL_RATIO_DRY) {
        // Dry summer (s): rare in continental but possible
        out[i] = isHotSummer ? KoppenClass.Dsa : KoppenClass.Dsb;
      } else if (summerShare > 1 - SEASONAL_RATIO_DRY) {
        // Dry winter (w)
        out[i] = isHotSummer ? KoppenClass.Dwa : KoppenClass.Dwb;
      } else {
        // No dry season (f)
        if (isCoolSummer) out[i] = KoppenClass.Dfc;
        else if (isHotSummer) out[i] = KoppenClass.Dfa;
        else out[i] = KoppenClass.Dfb;
      }
      continue;
    }

    // C — Temperate (mild winters)
    const isHotSummer = tWarmest >= T_HOT_SUMMER;
    if (summerShare < SEASONAL_RATIO_DRY) {
      // Mediterranean — dry summer
      out[i] = isHotSummer ? KoppenClass.Csa : KoppenClass.Csb;
    } else if (summerShare > 1 - SEASONAL_RATIO_DRY) {
      // Dry winter (w) — subtropical monsoon influenced
      out[i] = isHotSummer ? KoppenClass.Cwa : KoppenClass.Cwb;
    } else {
      // No dry season — humid subtropical / oceanic
      out[i] = isHotSummer ? KoppenClass.Cfa : KoppenClass.Cfb;
    }
  }

  return out;
}
