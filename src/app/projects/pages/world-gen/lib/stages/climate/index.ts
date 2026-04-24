import { ClimateVariables, NoiseVariables } from '../../types';
import { generateTemperature } from '../temperature';
import { computePET } from './pet';
import { simulateHumidity } from './humidity-sim';
import { deriveClimate } from './aridity';
import { classifyKoppen } from './koppen';

export interface ClimateResult {
  temperatureSummer: Float32Array;
  temperatureWinter: Float32Array;
  temperatureMean: Float32Array;
  petSummer: Float32Array;
  petWinter: Float32Array;
  petAnnual: Float32Array;
  precipSummer: Float32Array;
  precipWinter: Float32Array;
  precipAnnual: Float32Array;
  aridityIndex: Float32Array;
  seasonality: Float32Array;
  continentality: Float32Array;
  growingSeason: Float32Array;
  koppenClass: Uint8Array;
}

/**
 * Run the full climate sub-pipeline: two seasonal temperature passes, two
 * seasonal precipitation passes, then derived metrics and Köppen
 * classification. Hydrology pass-2 reads `precipAnnual` from the result.
 */
export function runClimate(
  width: number,
  height: number,
  elevation: Float32Array,
  seaLevel: number,
  wind: Float32Array,
  oceanTempModifier: Float32Array,
  distToOcean: Float32Array,
  noise: NoiseVariables,
  cv: ClimateVariables
): ClimateResult {
  const size = width * height;

  // 1. Seasonal temperatures with hemispheric tilt.
  const temperatureSummer = generateTemperature(
    width,
    height,
    elevation,
    seaLevel,
    noise,
    oceanTempModifier,
    distToOcean,
    'summer',
    cv.seasonalTilt
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
    cv.seasonalTilt
  );
  const temperatureMean = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    temperatureMean[i] = (temperatureSummer[i] + temperatureWinter[i]) * 0.5;
  }

  // 2. Seasonal PET from seasonal temperature.
  const petSummer = computePET(temperatureSummer, cv.frostThreshold);
  const petWinter = computePET(temperatureWinter, cv.frostThreshold);
  const petAnnual = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    petAnnual[i] = petSummer[i] + petWinter[i];
  }

  // 3. Seasonal precipitation via one-pass streamline trace. ITCZ shifts
  // toward the warm hemisphere each season — north in NH summer, south in
  // SH summer (which is "winter" from the NH-centric perspective). The
  // shift amount comes from cv.itczShift; the sign flips between passes.
  const precipSummer = simulateHumidity(
    width,
    height,
    wind,
    elevation,
    temperatureSummer,
    seaLevel,
    cv,
    -cv.itczShift // ITCZ shifts toward NH in NH summer
  );
  const precipWinter = simulateHumidity(
    width,
    height,
    wind,
    elevation,
    temperatureWinter,
    seaLevel,
    cv,
    +cv.itczShift // ITCZ shifts toward SH in NH winter
  );
  const precipAnnual = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    precipAnnual[i] = (precipSummer[i] + precipWinter[i]) * 0.5;
  }

  // 4. Derived metrics.
  const derived = deriveClimate(temperatureSummer, temperatureWinter, precipSummer, precipWinter, petAnnual, cv);

  // 5. Köppen classification.
  const koppenClass = classifyKoppen({
    temperatureSummer,
    temperatureWinter,
    precipSummer,
    precipWinter,
    aridityIndex: derived.aridityIndex,
    elevation,
    seaLevel,
  });

  return {
    temperatureSummer,
    temperatureWinter,
    temperatureMean,
    petSummer,
    petWinter,
    petAnnual,
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
