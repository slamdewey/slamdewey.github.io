import { ClimateVariables, NoiseVariables } from '../../types';
import { generateTemperature } from '../temperature';
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
  width: number,
  height: number,
  elevation: Float32Array,
  seaLevel: number,
  oceanTempModifier: Float32Array,
  distToOcean: Float32Array,
  noise: NoiseVariables,
  cv: ClimateVariables
): ClimateTemperatureResult {
  const size = width * height;

  const temperatureSummer = generateTemperature(
    width,
    height,
    elevation,
    seaLevel,
    noise,
    oceanTempModifier,
    distToOcean,
    'summer',
    cv.seasonalTilt,
    cv.continentalityStrength
  );
  const temperatureWinter = generateTemperature(
    width,
    height,
    elevation,
    seaLevel,
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
  width: number,
  height: number,
  elevation: Float32Array,
  seaLevel: number,
  temps: ClimateTemperatureResult,
  windSummer: Float32Array,
  windWinter: Float32Array,
  cv: ClimateVariables
): ClimateHumidityResult {
  const size = width * height;

  const precipSummer = simulateHumidity(
    width,
    height,
    windSummer,
    elevation,
    temps.temperatureSummer,
    seaLevel,
    cv,
    -cv.itczShift
  );
  const precipWinter = simulateHumidity(
    width,
    height,
    windWinter,
    elevation,
    temps.temperatureWinter,
    seaLevel,
    cv,
    +cv.itczShift
  );
  const precipAnnual = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    precipAnnual[i] = (precipSummer[i] + precipWinter[i]) * 0.5;
  }

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
    elevation,
    seaLevel,
  });

  return {
    precipSummer,
    precipWinter,
    precipAnnual,
    aridityIndex: derived.aridityIndex,
    seasonality: derived.seasonality,
    continentality: derived.continentality,
    growingSeason: derived.growingSeason,
    koppenClass,
  };
}
