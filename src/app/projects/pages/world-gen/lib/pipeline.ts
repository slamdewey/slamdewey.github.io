import { WorldConfig, WorldData } from './types';
import { generateTectonicPlates, type TectonicResult } from './stages/tectonic-plates';
import { generateElevation } from './stages/elevation';
import { generateTemperature } from './stages/temperature';
import { generateWind } from './stages/wind';
import { generatePrecipitation } from './stages/precipitation';
import { applyMountainRangesAndContinentalShelves } from './stages/post-processing';
import { classifyBiomes } from './stages/biomes';

export interface GeneratorResult {
  worldData: WorldData;
  tectonicResult: TectonicResult;
}

export class WorldGenerator {
  constructor(private config: WorldConfig) {}

  generate(): GeneratorResult {
    const { width, height, noise, climate, tectonic } = this.config;

    // Stage 1: Tectonic plates
    const tectonicResult = generateTectonicPlates(width, height, noise, tectonic);
    const { faults, mountainRanges, plateMap } = tectonicResult;

    // Stage 2: Elevation (plate-aware)
    const { elevation, seaLevel } = generateElevation(width, height, tectonicResult, noise);

    // Stage 3: Temperature
    const temperature = generateTemperature(width, height, elevation, seaLevel, noise);

    // Stage 4: Wind
    const wind = generateWind(width, height, noise);

    // Stage 5: Precipitation
    const precipitation = generatePrecipitation(width, height, wind, elevation, temperature, seaLevel, climate);

    // Stage 6: Post-processing (mountain ranges + continental shelves)
    applyMountainRangesAndContinentalShelves(width, height, elevation, mountainRanges, seaLevel);

    // Stage 7: Biome classification
    const biomes = classifyBiomes(width, height, elevation, temperature, precipitation, seaLevel);

    return {
      worldData: {
        width,
        height,
        plateMap,
        faultLines: faults,
        mountainRanges,
        elevation,
        seaLevel,
        temperature,
        wind,
        precipitation,
        biomes,
      },
      tectonicResult,
    };
  }
}
