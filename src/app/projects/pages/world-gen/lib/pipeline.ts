import { WorldConfig, WorldData } from './types';
import { generateTectonicPlates, type TectonicResult } from './stages/tectonic-plates';
import { generateElevation } from './stages/elevation';
import { generateTemperature } from './stages/temperature';
import { generateWind, applyTerrainDeflection } from './stages/wind';
import { generateOceanCurrents } from './stages/ocean-currents';
import { generatePrecipitation } from './stages/precipitation';
import { applyMountainRangesAndContinentalShelves } from './stages/post-processing';
import { runHydrology } from './stages/hydrology';
import { classifyBiomes } from './stages/biomes';

export interface GeneratorResult {
  worldData: WorldData;
  tectonicResult: TectonicResult;
}

export class WorldGenerator {
  constructor(private config: WorldConfig) {}

  generate(): GeneratorResult {
    const { width, height, noise, climate, tectonic, hydrology } = this.config;

    const tectonicResult = generateTectonicPlates(width, height, noise, tectonic);
    const { faults, mountainRanges, plateMap } = tectonicResult;

    const { elevation, seaLevel } = generateElevation(width, height, tectonicResult, noise);

    // Finalize terrain before climate stages so wind, currents, and
    // precipitation all see the same mountain/shelf surface.
    applyMountainRangesAndContinentalShelves(width, height, elevation, mountainRanges, seaLevel);

    // Carve drainage into the terrain before climate stages. Erosion modifies
    // elevation in-place, so downstream stages see the eroded surface.
    const { flowAccumulation, rivers, lakes } = runHydrology(width, height, elevation, seaLevel, hydrology);

    const wind = generateWind(width, height, noise);
    applyTerrainDeflection(width, height, wind, elevation, seaLevel);

    const { tempModifier, distToOcean } = generateOceanCurrents(width, height, wind, elevation, seaLevel);

    const temperature = generateTemperature(width, height, elevation, seaLevel, noise, tempModifier, distToOcean);

    const precipitation = generatePrecipitation(width, height, wind, elevation, temperature, seaLevel, climate);

    const biomes = classifyBiomes(width, height, elevation, temperature, precipitation, seaLevel, rivers, lakes);

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
        flowAccumulation,
        rivers,
        lakes,
      },
      tectonicResult,
    };
  }
}
