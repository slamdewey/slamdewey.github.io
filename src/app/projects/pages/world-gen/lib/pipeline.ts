import { WorldConfig, WorldData, WorldFields } from './types';
import { generateTectonicPlates } from './stages/tectonic';
import { generateTerrainSynthesis } from './stages/terrain-synthesis';
import { generateWind, applyTerrainDeflection, meanWind } from './stages/wind';
import { generateOceanCurrents } from './stages/ocean-currents';
import { runHydrology, computeFlowAndRivers } from './stages/hydrology';
import { runClimateTemperature, runClimateHumidity } from './stages/climate';
import { classifyBiomes } from './stages/biomes';
import { buildWorldGeometry } from './world-geometry';

export class WorldGenerator {
  constructor(private config: WorldConfig) {}

  /**
   * Run the full pipeline. `onProgress(stage, fraction)` is invoked at the
   * start of each stage with the fraction [0, 1] completed so far, so a caller
   * (the worker → UI) can show staged progress. The two heaviest stages
   * (erosion and the humidity sim) own the widest fraction gaps.
   */
  generate(onProgress?: (stage: string, fraction: number) => void): WorldData {
    const report = onProgress ?? (() => {});
    const { width, height, circumferenceKm, noise, climate, tectonic, hydrology } = this.config;
    const geom = buildWorldGeometry(width, height, circumferenceKm);
    const f: WorldFields = { width, height };

    report('Tectonic plates', 0.0);
    const tectonicResult = generateTectonicPlates(f, noise, tectonic);
    Object.assign(f, {
      plateMap: tectonicResult.plateMap,
      plates: tectonicResult.plates,
      boundaries: tectonicResult.boundaries,
      plateAdjacency: tectonicResult.plateAdjacency,
      boundaryArcs: tectonicResult.boundaryArcs,
      faultLines: tectonicResult.faults,
      faultType: tectonicResult.faultType,
      mountainRanges: tectonicResult.mountainRanges,
      volcanicArcs: tectonicResult.volcanicArcs,
      riftFloorMask: tectonicResult.riftFloorMask,
      continentalSubRelief: tectonicResult.continentalSubRelief,
      oceanAge: tectonicResult.oceanAge,
    });

    // Terrain synthesis: dimensionless tectonic potential → physical-meters
    // elevation (sea level 0) with context-keyed multi-scale detail. Folds in
    // the former mountain-boost / shelf post-processing pass, so the surface
    // handed to hydrology and the climate stages is final here.
    report('Terrain synthesis', 0.12);
    Object.assign(f, generateTerrainSynthesis(f, tectonicResult, noise, tectonic));

    report('Eroding terrain', 0.2);
    // Pass 1: erode terrain with uniform rainfall. Topology is mostly
    // insensitive to rainfall magnitude (stream-power scales A^m, m≈0.5).
    // Mutates f.elevation; we discard the pass-1 flow outputs because
    // pass 2 (computeFlowAndRivers) re-runs them with real precipitation.
    runHydrology(f, geom, hydrology);

    report('Winds', 0.55);
    // Wind pass 1: latitude-only pressure field (no thermal contrast yet —
    // that needs temperatures, which need ocean currents, which need wind).
    const windPass1 = generateWind(f, noise, climate, null, 0);
    applyTerrainDeflection(f, windPass1, geom);

    report('Ocean currents', 0.6);
    const { tempModifier, distToOcean } = generateOceanCurrents(f, windPass1, geom, climate);

    report('Temperature', 0.66);
    // Seasonal temperatures and PET — no wind dependence beyond the current
    // advection already baked into tempModifier.
    const temps = runClimateTemperature(f, tempModifier, distToOcean, noise, climate);
    Object.assign(f, {
      temperatureSummer: temps.temperatureSummer,
      temperatureWinter: temps.temperatureWinter,
      temperatureMean: temps.temperatureMean,
      petSummer: temps.petSummer,
      petWinter: temps.petWinter,
      petAnnual: temps.petAnnual,
    });

    report('Seasonal winds', 0.7);
    // Wind pass 2: one field per season, pressure now includes land–sea
    // thermal contrast. Summer continents warm above the zonal mean → local
    // low → onshore inflow; winter reverses it. This is the mechanism behind
    // real monsoon seasonality.
    const windSummer = generateWind(f, noise, climate, temps.temperatureSummer, -climate.itczShift);
    applyTerrainDeflection(f, windSummer, geom);
    const windWinter = generateWind(f, noise, climate, temps.temperatureWinter, +climate.itczShift);
    applyTerrainDeflection(f, windWinter, geom);
    Object.assign(f, { wind: meanWind(windSummer, windWinter), windSummer, windWinter });

    report('Simulating climate', 0.74);
    // Humidity simulation uses the matching seasonal wind per pass. Passing
    // geom makes the moisture transport resolution-independent and applies
    // per-row cos(lat) corrections so x-step shrinks toward the poles.
    const humidity = runClimateHumidity(f, geom, temps, windSummer, windWinter, climate);
    Object.assign(f, {
      precipSummer: humidity.precipSummer,
      precipWinter: humidity.precipWinter,
      precipAnnual: humidity.precipAnnual,
      soilMoisture: humidity.soilMoisture,
      aridityIndex: humidity.aridityIndex,
      seasonality: humidity.seasonality,
      continentality: humidity.continentality,
      growingSeason: humidity.growingSeason,
      koppenClass: humidity.koppenClass,
    });

    report('Rivers & lakes', 0.93);
    // Pass 2: rerun flow/rivers/lakes weighted by real annual precipitation.
    // No erosion — topology is locked in from pass 1. Lake formation is gated
    // on a water-budget check (catchment inflow vs. basin PET demand) so dry
    // basins don't become spurious lakes.
    Object.assign(f, computeFlowAndRivers(f, geom, hydrology));

    report('Biomes', 0.99);
    f.biomes = classifyBiomes(f);

    return f as WorldData;
  }
}
