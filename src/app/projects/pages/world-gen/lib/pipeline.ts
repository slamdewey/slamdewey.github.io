import { WorldConfig, WorldData, WorldFields } from './types';
import { generateTectonicPlates } from './stages/tectonic';
import { generateElevation } from './stages/elevation';
import { generateWind, applyTerrainDeflection, meanWind } from './stages/wind';
import { generateOceanCurrents } from './stages/ocean-currents';
import { applyMountainRangesAndContinentalShelves } from './stages/post-processing';
import { runHydrology, computeFlowAndRivers } from './stages/hydrology';
import { runClimateTemperature, runClimateHumidity } from './stages/climate';
import { classifyBiomes } from './stages/biomes';
import { buildWorldGeometry } from './world-geometry';

export class WorldGenerator {
  constructor(private config: WorldConfig) {}

  generate(): WorldData {
    const { width, height, circumferenceKm, noise, climate, tectonic, hydrology } = this.config;
    const geom = buildWorldGeometry(width, height, circumferenceKm);
    const f: WorldFields = { width, height };

    const tectonicResult = generateTectonicPlates(f, noise, tectonic);
    Object.assign(f, {
      plateMap: tectonicResult.plateMap,
      plates: tectonicResult.plates,
      boundaries: tectonicResult.boundaries,
      faultLines: tectonicResult.faults,
      mountainRanges: tectonicResult.mountainRanges,
      continentalSubRelief: tectonicResult.continentalSubRelief,
      oceanAge: tectonicResult.oceanAge,
    });

    Object.assign(f, generateElevation(f, tectonicResult, noise, tectonic));

    // Finalize terrain before climate stages so wind, currents, and
    // precipitation all see the same mountain/shelf surface.
    applyMountainRangesAndContinentalShelves(f);

    // Pass 1: erode terrain with uniform rainfall. Topology is mostly
    // insensitive to rainfall magnitude (stream-power scales A^m, m≈0.5).
    // Mutates f.elevation; we discard the pass-1 flow outputs because
    // pass 2 (computeFlowAndRivers) re-runs them with real precipitation.
    runHydrology(f, geom, hydrology);

    // Wind pass 1: latitude-only pressure field (no thermal contrast yet —
    // that needs temperatures, which need ocean currents, which need wind).
    const windPass1 = generateWind(f, noise, climate, null, 0);
    applyTerrainDeflection(f, windPass1, geom);

    const { tempModifier, distToOcean } = generateOceanCurrents(f, windPass1, geom, climate);

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

    // Wind pass 2: one field per season, pressure now includes land–sea
    // thermal contrast. Summer continents warm above the zonal mean → local
    // low → onshore inflow; winter reverses it. This is the mechanism behind
    // real monsoon seasonality.
    const windSummer = generateWind(f, noise, climate, temps.temperatureSummer, -climate.itczShift);
    applyTerrainDeflection(f, windSummer, geom);
    const windWinter = generateWind(f, noise, climate, temps.temperatureWinter, +climate.itczShift);
    applyTerrainDeflection(f, windWinter, geom);
    Object.assign(f, { wind: meanWind(windSummer, windWinter), windSummer, windWinter });

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

    // Pass 2: rerun flow/rivers/lakes weighted by real annual precipitation.
    // No erosion — topology is locked in from pass 1. Lake formation is gated
    // on a water-budget check (catchment inflow vs. basin PET demand) so dry
    // basins don't become spurious lakes.
    Object.assign(f, computeFlowAndRivers(f, geom, hydrology));

    f.biomes = classifyBiomes(f);

    return f as WorldData;
  }
}
