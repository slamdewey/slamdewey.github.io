import { WorldConfig, WorldData } from './types';
import { generateTectonicPlates, type TectonicResult } from './stages/tectonic-plates';
import { generateElevation } from './stages/elevation';
import { generateWind, applyTerrainDeflection, meanWind } from './stages/wind';
import { generateOceanCurrents } from './stages/ocean-currents';
import { applyMountainRangesAndContinentalShelves } from './stages/post-processing';
import { runHydrology, computeFlowAndRivers } from './stages/hydrology';
import { runClimateTemperature, runClimateHumidity } from './stages/climate';
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
    const { faults, mountainRanges, plateMap, continentalSubRelief, oceanAge } = tectonicResult;

    const { elevation, seaLevel } = generateElevation(width, height, tectonicResult, noise, tectonic);

    // Finalize terrain before climate stages so wind, currents, and
    // precipitation all see the same mountain/shelf surface.
    applyMountainRangesAndContinentalShelves(width, height, elevation, mountainRanges, seaLevel);

    // Pass 1: erode terrain with uniform rainfall. Topology is mostly
    // insensitive to rainfall magnitude (stream-power scales A^m, m≈0.5).
    runHydrology(width, height, elevation, seaLevel, hydrology);

    // Wind pass 1: latitude-only pressure field (no thermal contrast yet —
    // that needs temperatures, which need ocean currents, which need wind).
    const windPass1 = generateWind(width, height, noise, climate, null, 0);
    applyTerrainDeflection(width, height, windPass1, elevation, seaLevel);

    const { tempModifier, distToOcean } = generateOceanCurrents(width, height, windPass1, elevation, seaLevel, climate);

    // Seasonal temperatures and PET — no wind dependence beyond the current
    // advection already baked into tempModifier.
    const temps = runClimateTemperature(width, height, elevation, seaLevel, tempModifier, distToOcean, noise, climate);

    // Wind pass 2: one field per season, pressure now includes land–sea
    // thermal contrast. Summer continents warm above the zonal mean → local
    // low → onshore inflow; winter reverses it. This is the mechanism behind
    // real monsoon seasonality.
    const windSummer = generateWind(width, height, noise, climate, temps.temperatureSummer, -climate.itczShift);
    applyTerrainDeflection(width, height, windSummer, elevation, seaLevel);
    const windWinter = generateWind(width, height, noise, climate, temps.temperatureWinter, +climate.itczShift);
    applyTerrainDeflection(width, height, windWinter, elevation, seaLevel);
    const wind = meanWind(windSummer, windWinter);

    // Humidity simulation uses the matching seasonal wind per pass.
    const humidity = runClimateHumidity(width, height, elevation, seaLevel, temps, windSummer, windWinter, climate);

    // Pass 2: rerun flow/rivers/lakes weighted by real annual precipitation.
    // No erosion — topology is locked in from pass 1. Aridity gates lake
    // formation so dry rift valleys don't become spurious lakes.
    const { flowAccumulation, rivers, lakes } = computeFlowAndRivers(
      width,
      height,
      elevation,
      seaLevel,
      humidity.precipAnnual,
      humidity.aridityIndex,
      hydrology
    );

    const biomes = classifyBiomes(width, height, elevation, humidity.koppenClass, seaLevel, rivers, lakes);

    return {
      worldData: {
        width,
        height,
        plateMap,
        faultLines: faults,
        mountainRanges,
        continentalSubRelief,
        oceanAge,
        elevation,
        seaLevel,
        temperatureSummer: temps.temperatureSummer,
        temperatureWinter: temps.temperatureWinter,
        temperatureMean: temps.temperatureMean,
        wind,
        windSummer,
        windWinter,
        petSummer: temps.petSummer,
        petWinter: temps.petWinter,
        petAnnual: temps.petAnnual,
        precipSummer: humidity.precipSummer,
        precipWinter: humidity.precipWinter,
        precipAnnual: humidity.precipAnnual,
        aridityIndex: humidity.aridityIndex,
        seasonality: humidity.seasonality,
        continentality: humidity.continentality,
        growingSeason: humidity.growingSeason,
        koppenClass: humidity.koppenClass,
        biomes,
        flowAccumulation,
        rivers,
        lakes,
      },
      tectonicResult,
    };
  }
}
