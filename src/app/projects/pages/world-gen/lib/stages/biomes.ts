import { Biome, KoppenClass } from '../types';

const MOUNTAIN_LEVEL = 0.85;
const SHALLOW_WATER_RANGE = 0.1;
const RIVER_THRESHOLD = 0.5;

/**
 * Map a Köppen-Geiger class to one of our visualization biomes.
 * Multiple Köppen classes can collapse to one biome where the visual
 * distinction isn't worth a separate color (e.g. Dfa and Dfb both feel
 * like "boreal forest" at world-map zoom).
 */
function koppenToBiome(k: KoppenClass): Biome {
  switch (k) {
    // Tropical
    case KoppenClass.Af:
      return Biome.Rainforest;
    case KoppenClass.Am:
      return Biome.MonsoonForest;
    case KoppenClass.Aw:
      return Biome.Savanna;
    // Arid
    case KoppenClass.BWh:
      return Biome.Desert;
    case KoppenClass.BWk:
      return Biome.ColdDesert;
    case KoppenClass.BSh:
      return Biome.Savanna;
    case KoppenClass.BSk:
      return Biome.Grassland;
    // Temperate
    case KoppenClass.Cfa:
      return Biome.TempForest;
    case KoppenClass.Cfb:
      return Biome.TempForest;
    case KoppenClass.Csa:
      return Biome.MediterraneanShrub;
    case KoppenClass.Csb:
      return Biome.MediterraneanShrub;
    case KoppenClass.Cwa:
      return Biome.MonsoonForest;
    case KoppenClass.Cwb:
      return Biome.TempForest;
    // Continental
    case KoppenClass.Dfa:
      return Biome.TempForest;
    case KoppenClass.Dfb:
      return Biome.BorealForest;
    case KoppenClass.Dfc:
      return Biome.BorealForest;
    case KoppenClass.Dwa:
      return Biome.Grassland;
    case KoppenClass.Dwb:
      return Biome.BorealForest;
    case KoppenClass.Dsa:
      return Biome.Grassland;
    case KoppenClass.Dsb:
      return Biome.BorealForest;
    // Polar
    case KoppenClass.ET:
      return Biome.Tundra;
    case KoppenClass.EF:
      return Biome.Arctic;
  }
}

export function classifyBiomes(
  width: number,
  height: number,
  elevation: Float32Array,
  koppenClass: Uint8Array,
  seaLevel: number,
  rivers?: Float32Array,
  lakes?: Uint8Array
): Float32Array {
  const biomes = new Float32Array(width * height);
  const shallowWaterLevel = seaLevel - SHALLOW_WATER_RANGE;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Water: depth-based ocean classification.
      if (elevation[idx] < seaLevel) {
        biomes[idx] = elevation[idx] < shallowWaterLevel ? Biome.Ocean : Biome.ShallowWater;
        continue;
      }

      // Inland water — rivers and lakes override terrestrial biomes.
      if (lakes?.[idx] === 1 || (rivers && rivers[idx] > RIVER_THRESHOLD)) {
        biomes[idx] = Biome.ShallowWater;
        continue;
      }

      // Mountain override above all terrestrial classification.
      if (elevation[idx] > MOUNTAIN_LEVEL) {
        biomes[idx] = Biome.Mountain;
        continue;
      }

      biomes[idx] = koppenToBiome(koppenClass[idx] as KoppenClass);
    }
  }

  return biomes;
}
