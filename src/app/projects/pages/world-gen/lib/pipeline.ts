import { WorldConfig, WorldData } from './types';
import { generateTectonicPlates, type TectonicResult } from './stages/tectonic-plates';
import { generateElevation } from './stages/elevation';
import { generateWind, applyTerrainDeflection } from './stages/wind';
import { generateOceanCurrents } from './stages/ocean-currents';
import { applyMountainRangesAndContinentalShelves } from './stages/post-processing';
import { runHydrology, computeFlowAndRivers } from './stages/hydrology';
import { runClimate } from './stages/climate';
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

    // Pass 1: erode terrain with uniform rainfall. Topology is mostly
    // insensitive to rainfall magnitude (stream-power scales A^m, m≈0.5).
    runHydrology(width, height, elevation, seaLevel, hydrology);

    const wind = generateWind(width, height, noise);
    applyTerrainDeflection(width, height, wind, elevation, seaLevel);

    const { tempModifier, distToOcean } = generateOceanCurrents(width, height, wind, elevation, seaLevel);

    // Climate sub-pipeline: seasonal temps, PET, two-pass humidity sim,
    // aridity/seasonality/continentality/growing-season, Köppen classes.
    const climateResult = runClimate(
      width,
      height,
      elevation,
      seaLevel,
      wind,
      tempModifier,
      distToOcean,
      noise,
      climate
    );

    // Pass 2: rerun flow/rivers/lakes weighted by real annual precipitation.
    // No erosion — topology is locked in from pass 1. Aridity gates lake
    // formation so dry rift valleys don't become spurious lakes.
    const { flowAccumulation, rivers, lakes } = computeFlowAndRivers(
      width,
      height,
      elevation,
      seaLevel,
      climateResult.precipAnnual,
      climateResult.aridityIndex,
      hydrology
    );

    const biomes = classifyBiomes(width, height, elevation, climateResult.koppenClass, seaLevel, rivers, lakes);

    return {
      worldData: {
        width,
        height,
        plateMap,
        faultLines: faults,
        mountainRanges,
        elevation,
        seaLevel,
        temperatureSummer: climateResult.temperatureSummer,
        temperatureWinter: climateResult.temperatureWinter,
        temperatureMean: climateResult.temperatureMean,
        wind,
        petSummer: climateResult.petSummer,
        petWinter: climateResult.petWinter,
        petAnnual: climateResult.petAnnual,
        precipSummer: climateResult.precipSummer,
        precipWinter: climateResult.precipWinter,
        precipAnnual: climateResult.precipAnnual,
        aridityIndex: climateResult.aridityIndex,
        seasonality: climateResult.seasonality,
        continentality: climateResult.continentality,
        growingSeason: climateResult.growingSeason,
        koppenClass: climateResult.koppenClass,
        biomes,
        flowAccumulation,
        rivers,
        lakes,
      },
      tectonicResult,
    };
  }
}
