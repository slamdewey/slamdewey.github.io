import { WorldConfig, WorldData } from './types';
import { generateFaultLines } from './stages/fault-lines';
import { generateElevation } from './stages/elevation';
import { generateTemperature } from './stages/temperature';
import { generateWind } from './stages/wind';
import { generatePrecipitation } from './stages/precipitation';
import { applyMountainRangesAndContinentalShelves } from './stages/post-processing';
import { classifyBiomes } from './stages/biomes';

export class WorldGenerator {
  constructor(private config: WorldConfig) {}

  generate(): WorldData {
    const { width, height, noise, climate } = this.config;

    // Stage 1: Fault lines
    const { faults, mountainRanges } = generateFaultLines(width, height, noise);

    // Stage 2: Elevation
    const { elevation, seaLevel } = generateElevation(width, height, faults, noise);

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
      width,
      height,
      faultLines: faults,
      mountainRanges,
      elevation,
      seaLevel,
      temperature,
      wind,
      precipitation,
      biomes,
    };
  }
}
