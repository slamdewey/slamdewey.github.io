import { Biome } from '../types';

const MOUNTAIN_LEVEL = 0.85;
const SHALLOW_WATER_RANGE = 0.1;

// 6x6 classification table: [moisture][temperature]
// moisture rows: Dryest → Wettest
// temperature cols: Coldest → Hottest
const CLASSIFICATION_TABLE: Biome[][] = [
  /*  Dryest  */ [Biome.Arctic, Biome.Arctic, Biome.Tundra, Biome.Desert, Biome.Desert, Biome.Desert],
  /*  Dryer   */ [Biome.Arctic, Biome.Tundra, Biome.BorealForest, Biome.Grassland, Biome.Savanna, Biome.Desert],
  /*  Dry     */ [
    Biome.Arctic,
    Biome.BorealForest,
    Biome.BorealForest,
    Biome.Grassland,
    Biome.TempForest,
    Biome.Savanna,
  ],
  /*  Wet     */ [
    Biome.Arctic,
    Biome.BorealForest,
    Biome.BorealForest,
    Biome.TempForest,
    Biome.TempForest,
    Biome.TempForest,
  ],
  /*  Wetter  */ [
    Biome.Arctic,
    Biome.BorealForest,
    Biome.BorealForest,
    Biome.TempForest,
    Biome.Rainforest,
    Biome.Rainforest,
  ],
  /*  Wettest */ [
    Biome.Arctic,
    Biome.BorealForest,
    Biome.TempForest,
    Biome.Rainforest,
    Biome.Rainforest,
    Biome.Rainforest,
  ],
];

export function classifyBiomes(
  width: number,
  height: number,
  elevation: Float32Array,
  temperature: Float32Array,
  precipitation: Float32Array,
  seaLevel: number
): Float32Array {
  const biomes = new Float32Array(width * height);
  const shallowWaterLevel = seaLevel - SHALLOW_WATER_RANGE;

  const moistureBuckets = CLASSIFICATION_TABLE.length; // 6
  const temperatureBuckets = CLASSIFICATION_TABLE[0].length; // 6

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Water classification
      if (elevation[idx] < seaLevel) {
        biomes[idx] = elevation[idx] < shallowWaterLevel ? Biome.Ocean : Biome.ShallowWater;
        continue;
      }

      // Mountain classification
      if (elevation[idx] > MOUNTAIN_LEVEL) {
        biomes[idx] = Biome.Mountain;
        continue;
      }

      // Terrestrial biome lookup
      let moistureIndex = Math.floor(precipitation[idx] * moistureBuckets);
      let tempIndex = Math.floor(temperature[idx] * temperatureBuckets);
      if (moistureIndex >= moistureBuckets) moistureIndex = moistureBuckets - 1;
      if (tempIndex >= temperatureBuckets) tempIndex = temperatureBuckets - 1;
      if (moistureIndex < 0) moistureIndex = 0;
      if (tempIndex < 0) tempIndex = 0;

      biomes[idx] = CLASSIFICATION_TABLE[moistureIndex][tempIndex];
    }
  }

  return biomes;
}
