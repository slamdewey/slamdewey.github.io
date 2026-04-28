import { ClimateVariables, NoiseVariables, WorldFields } from '../../types';
import { WorldGeometry } from '../../world-geometry';
import { PRECIP_MM_PER_UNIT } from '../../physics';
import { generateTemperature } from './temperature';
import { computePET } from './pet';
import { simulateHumidity } from './humidity-sim';
import { deriveClimate } from './aridity';
import { classifyKoppen } from './koppen';

export interface ClimateTemperatureResult {
  /** Summer mean temperature in °C. */
  temperatureSummer: Float32Array;
  /** Winter mean temperature in °C. */
  temperatureWinter: Float32Array;
  /** Annual mean temperature in °C. */
  temperatureMean: Float32Array;
  /** Per-season PET in mm. */
  petSummer: Float32Array;
  petWinter: Float32Array;
  /** Annual PET in mm/year (= petSummer + petWinter). */
  petAnnual: Float32Array;
}

export interface ClimateHumidityResult {
  /** Per-season precipitation in mm (≈ half-year accumulation). */
  precipSummer: Float32Array;
  precipWinter: Float32Array;
  /** Annual precipitation in mm/year (= precipSummer + precipWinter). */
  precipAnnual: Float32Array;
  /** Soil moisture (display-normalized [0, 1]; raw bucket level lives inside the sim). */
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

  // The humidity sim's bucket model expects PET as a dimensionless budget in
  // q-unit space (sim's internal moisture currency). Annual PET in mm divided
  // by PRECIP_MM_PER_UNIT puts it on the same scale as the q field.
  const petBudgetQ = new Float32Array(size);
  const invMmPerUnit = 1 / PRECIP_MM_PER_UNIT;
  for (let i = 0; i < size; i++) {
    petBudgetQ[i] = temps.petAnnual[i] * invMmPerUnit;
  }

  const summer = simulateHumidity(
    width,
    height,
    windSummer,
    elevation,
    temps.temperatureSummer,
    petBudgetQ,
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
    petBudgetQ,
    seaLevel,
    geom,
    cv,
    +cv.itczShift
  );

  // Convert sim q-unit precipitation to mm. Each season's raw output represents
  // a half-year of climatology, so summing summer + winter yields annual mm.
  const precipSummer = new Float32Array(size);
  const precipWinter = new Float32Array(size);
  const precipAnnual = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    precipSummer[i] = summer.precip[i] * PRECIP_MM_PER_UNIT;
    precipWinter[i] = winter.precip[i] * PRECIP_MM_PER_UNIT;
    precipAnnual[i] = precipSummer[i] + precipWinter[i];
  }

  // Soil-moisture for visualization, [0, 1] normalized against the bucket's
  // steady-state capacity (precip-rate × τ in q-units).
  const soilCap = cv.soilMoistureTimescaleDays;
  const soilMoisture = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const avg = (summer.soilMoisture[i] + winter.soilMoisture[i]) * 0.5;
    soilMoisture[i] = clampUnit(avg / soilCap);
  }

  // Aridity, seasonality, continentality, growing-season favorability — all
  // computed in physical units (°C, mm, dimensionless ratios).
  const derived = deriveClimate(
    temps.temperatureSummer,
    temps.temperatureWinter,
    precipSummer,
    precipWinter,
    temps.petAnnual,
    cv
  );

  const koppenClass = classifyKoppen({
    temperatureSummer: temps.temperatureSummer,
    temperatureWinter: temps.temperatureWinter,
    precipSummer,
    precipWinter,
    aridityIndex: derived.aridityIndex,
    petAnnual: temps.petAnnual,
    elevation,
    seaLevel,
  });

  return {
    precipSummer,
    precipWinter,
    precipAnnual,
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
