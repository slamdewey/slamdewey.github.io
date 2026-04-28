import { ClimateVariables, NoiseVariables, WorldFields } from '../../types';
import { WorldGeometry } from '../../world-geometry';
import { generateTemperature } from './temperature';
import { computePET } from './pet';
import { simulateHumidity } from './humidity-sim';
import { deriveClimate } from './aridity';
import { classifyKoppen } from './koppen';

export interface ClimateTemperatureResult {
  temperatureSummer: Float32Array;
  temperatureWinter: Float32Array;
  temperatureMean: Float32Array;
  petSummer: Float32Array;
  petWinter: Float32Array;
  petAnnual: Float32Array;
}

export interface ClimateHumidityResult {
  precipSummer: Float32Array;
  precipWinter: Float32Array;
  precipAnnual: Float32Array;
  soilMoisture: Float32Array;
  aridityIndex: Float32Array;
  seasonality: Float32Array;
  continentality: Float32Array;
  growingSeason: Float32Array;
  koppenClass: Uint8Array;
}

export type ClimateResult = ClimateTemperatureResult & ClimateHumidityResult;

/**
 * Temperature + PET only. Runs before wind pass 2 because the pressure field
 * in pass 2 needs the temperature field to compute land–sea thermal contrast.
 */
export function runClimateTemperature(
  fields: WorldFields,
  oceanTempModifier: Float32Array,
  distToOcean: Float32Array,
  noise: NoiseVariables,
  cv: ClimateVariables
): ClimateTemperatureResult {
  const { width, height } = fields;
  const size = width * height;

  const temperatureSummer = generateTemperature(
    fields,
    noise,
    oceanTempModifier,
    distToOcean,
    'summer',
    cv.seasonalTilt,
    cv.continentalityStrength
  );
  const temperatureWinter = generateTemperature(
    fields,
    noise,
    oceanTempModifier,
    distToOcean,
    'winter',
    cv.seasonalTilt,
    cv.continentalityStrength
  );
  const temperatureMean = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    temperatureMean[i] = (temperatureSummer[i] + temperatureWinter[i]) * 0.5;
  }

  const petSummer = computePET(temperatureSummer, cv.frostThreshold);
  const petWinter = computePET(temperatureWinter, cv.frostThreshold);
  const petAnnual = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    petAnnual[i] = petSummer[i] + petWinter[i];
  }

  return { temperatureSummer, temperatureWinter, temperatureMean, petSummer, petWinter, petAnnual };
}

/**
 * Humidity + derived climate + Köppen. Each seasonal humidity pass is traced
 * against its own wind field, so the summer-vs-winter wind reversal over
 * continents (monsoons) shows up directly in seasonal precipitation.
 */
export function runClimateHumidity(
  fields: WorldFields,
  geom: WorldGeometry,
  temps: ClimateTemperatureResult,
  windSummer: Float32Array,
  windWinter: Float32Array,
  cv: ClimateVariables
): ClimateHumidityResult {
  const { width, height } = fields;
  const elevation = fields.elevation!;
  const seaLevel = fields.seaLevel!;
  const size = width * height;

  const summer = simulateHumidity(
    width,
    height,
    windSummer,
    elevation,
    temps.temperatureSummer,
    temps.petAnnual,
    seaLevel,
    geom,
    cv,
    -cv.itczShift
  );
  const winter = simulateHumidity(
    width,
    height,
    windWinter,
    elevation,
    temps.temperatureWinter,
    temps.petAnnual,
    seaLevel,
    geom,
    cv,
    +cv.itczShift
  );

  const precipSummer = summer.precip;
  const precipWinter = winter.precip;

  // Combined cycle precipitation. With rate-based physics the absolute scale
  // is meaningful and consistent across resolutions, so we normalize once
  // against a reference value rather than against a per-run percentile (which
  // erased absolute magnitudes between runs and between summer/winter).
  const precipAnnual = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    precipAnnual[i] = (precipSummer[i] + precipWinter[i]) * 0.5;
  }

  // Display-scale precipitation reference (raw → display = raw / REF, clamped).
  // Tuned so that wet tropics & storm-track cells saturate near 1.0, mid-latitude
  // continents land in the 0.4–0.7 range, and subtropical-high zones drop to
  // 0.1–0.25 (which is what feeds the Köppen B class via aridity). If this is
  // too low everything washes out white; too high and even the tropics look dry.
  const PRECIP_DISPLAY_REF = 2.0;
  const inv = 1 / PRECIP_DISPLAY_REF;
  const precipSummerDisplay = new Float32Array(size);
  const precipWinterDisplay = new Float32Array(size);
  const precipAnnualDisplay = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    precipSummerDisplay[i] = clampUnit(precipSummer[i] * inv);
    precipWinterDisplay[i] = clampUnit(precipWinter[i] * inv);
    precipAnnualDisplay[i] = clampUnit(precipAnnual[i] * inv);
  }

  // Soil moisture from both seasons, averaged. Normalized for display by the
  // bucket capacity scale (precip_ref · soilMoistureTimescaleDays), giving a
  // layer in [0, 1] where ~1 = saturated soil.
  const soilCap = PRECIP_DISPLAY_REF * cv.soilMoistureTimescaleDays;
  const soilMoisture = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    soilMoisture[i] = clampUnit(((summer.soilMoisture[i] + winter.soilMoisture[i]) * 0.5) / soilCap);
  }

  // Aridity and Köppen both read display-scale precip ([0, 1] per season),
  // matching the scale that PET is produced at — keeps the AI = MAP/PET ratio
  // dimensionally consistent with how the existing Köppen thresholds are tuned.
  const derived = deriveClimate(
    temps.temperatureSummer,
    temps.temperatureWinter,
    precipSummerDisplay,
    precipWinterDisplay,
    temps.petAnnual,
    cv
  );

  const koppenClass = classifyKoppen({
    temperatureSummer: temps.temperatureSummer,
    temperatureWinter: temps.temperatureWinter,
    precipSummer: precipSummerDisplay,
    precipWinter: precipWinterDisplay,
    aridityIndex: derived.aridityIndex,
    petAnnual: temps.petAnnual,
    elevation,
    seaLevel,
  });

  return {
    precipSummer: precipSummerDisplay,
    precipWinter: precipWinterDisplay,
    precipAnnual: precipAnnualDisplay,
    soilMoisture,
    aridityIndex: derived.aridityIndex,
    seasonality: derived.seasonality,
    continentality: derived.continentality,
    growingSeason: derived.growingSeason,
    koppenClass,
  };
}

function clampUnit(x: number): number {
  if (x <= 0) return 0;
  return x > 1 ? 1 : x;
}
