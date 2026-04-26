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
// Tightened from 0.65 → 0.68 — the previous value let Af/Am classes extend
// into the 30–45° warm-temperate band where Earth has Cfa/Cfb. With our default
// seasonal tilt (0.18) cells at ~35° latitude had tColdest ≈ 0.67, just above
// the old A threshold; bumping it 0.03 keeps tropical classes confined to the
// equatorial / subtropical bands they belong in.
const T_TROPICAL_COLDEST = 0.68;
// Pulled back from 0.55 → 0.52 — the 0.55 bump made D-class explode to 34 %
// of land (Earth: 22 %), starving C-class. 0.52 splits the difference and
// gives roughly the right C/D balance against the rest of the calibration.
const T_NO_FROST = 0.52;
const T_POLAR_WARMEST = 0.3; // ~10°C warmest-month for E class
const T_ICECAP_WARMEST = 0.18; // ~0°C warmest-month for EF (widened from 0.15 — was producing essentially no ice caps)
const T_HOT_SUMMER = 0.75; // ~22°C warmest-month for a (vs b/c)
// Widened from 0.55 → 0.60 so the boreal/subarctic forest belt (Dfc) actually
// emerges. With the old threshold only deeply polar cells qualified for the
// "cool-summer" sub-letter, leaving Earth's 9 % Dfc share at 0.6 % in the sim.
const T_COOL_SUMMER = 0.6;

// Aridity thresholds for B class. AI = MAP / PET.
// Tuned against the rate-based humidity model's natural distribution. The
// recycling bucket keeps interior AI from going as low as Earth's, so we
// tighten the steppe boundary to land near Earth's ~28 % B-class land share
// (Sahara/Sahel + Asian steppes + Australian outback + Patagonia ≈ this).
const AI_DESERT = 0.2;
const AI_STEPPE = 0.3;

// Seasonality cutoff for w/s/f sub-letters. Set to match real Köppen's
// 1/10 rule (driest month < 10 % of wettest): w fires when summerShare > 0.90,
// s when summerShare < 0.10. With only two "months" (summer/winter), that's
// genuinely-monsoonal cells only. Anything looser produced massive Dwb/Dsb
// overflow because precip-display clipping inflates summerShare on cells where
// summer hits the saturation cap but winter doesn't.
const SEASONAL_RATIO_DRY = 0.1;

export interface KoppenInputs {
  temperatureSummer: Float32Array;
  temperatureWinter: Float32Array;
  precipSummer: Float32Array;
  precipWinter: Float32Array;
  aridityIndex: Float32Array;
  petAnnual: Float32Array;
  elevation: Float32Array;
  seaLevel: number;
}

/** Cells with annual PET below this floor have no meaningful evaporative
 *  demand and are excluded from the B (arid) classification regardless of
 *  their AI. Approximates the Köppen rule that real cold/polar regions are
 *  classified by temperature (E or D), not by aridity. Lowered to 0.08 so
 *  only deeply-polar cells skip B; the previous 0.15 was killing legitimate
 *  hot deserts that happened to have moderate PET. */
const PET_B_FLOOR = 0.08;

/**
 * Classify each cell. Ocean cells get an "arbitrary" value (we pick `EF` as
 * a sentinel — biome stage overrides water cells anyway).
 */
export function classifyKoppen(inputs: KoppenInputs): Uint8Array {
  const {
    temperatureSummer,
    temperatureWinter,
    precipSummer,
    precipWinter,
    aridityIndex,
    petAnnual,
    elevation,
    seaLevel,
  } = inputs;
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

    // B — Arid, with temperature-scaled thresholds. Real Köppen-Geiger uses
    // P_threshold ≈ 2·(T_C + 14) — warm cells need MORE precip to escape arid
    // (because PET is high), cold cells need less. Linear scale-with-tMean
    // captures this: warm cells get a more permissive B threshold, cold cells
    // a tighter one. Floored so coldest cells aren't fully exempt; gated by
    // PET_B_FLOOR so cells with effectively no atmospheric demand (deep polar)
    // skip B entirely and fall to E/D.
    const tMean = (tColdest + tWarmest) * 0.5;
    const aiScale = Math.max(0.1, tMean / 0.6);
    if (petAnnual[i] >= PET_B_FLOOR && ai < AI_STEPPE * aiScale) {
      const isDesert = ai < AI_DESERT * aiScale;
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
      // Driest-season precipitation determines Af/Am/Aw. Bumped both cutoffs
      // because the rate-based humidity model produces high absolute precip in
      // the tropics — under the old 0.25/0.10 cutoffs, almost every tropical
      // cell qualified as Af, and Aw (savanna) was effectively missing. Earth
      // has Aw ≈ 8 % of land vs Af ≈ 7 %; the new cutoffs (0.40/0.20) restore
      // that balance.
      const driestShare = Math.min(summerShare, 1 - summerShare);
      const driestPrecip = totalP * driestShare;
      if (driestPrecip > 0.4) {
        out[i] = KoppenClass.Af;
      } else if (driestPrecip > 0.2) {
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
