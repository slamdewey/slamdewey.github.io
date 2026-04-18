export interface NoiseVariables {
  seed: number;
  octaves: number;
  frequency: number;
  persistence: number;
  lacunarity: number;
  waterPercentage: number;
}

export interface ClimateVariables {
  initialMoisture: number;
  evaporationFactor: number;
  precipitationFactor: number;
  runoffFactor: number;
  climateCycles: number;
}

export interface WorldConfig {
  width: number;
  height: number;
  noise: NoiseVariables;
  climate: ClimateVariables;
}

export enum Biome {
  Ocean,
  ShallowWater,
  Mountain,
  Desert,
  Grassland,
  Arctic,
  Tundra,
  Savanna,
  TempForest,
  BorealForest,
  Rainforest,
}

export interface WorldData {
  width: number;
  height: number;
  faultLines: Float32Array;
  mountainRanges: Float32Array;
  elevation: Float32Array;
  seaLevel: number;
  temperature: Float32Array;
  wind: Float32Array; // interleaved [dx, dy, dx, dy, ...] length = width*height*2
  precipitation: Float32Array;
  biomes: Float32Array; // biome index as float
}

export type LayerName = 'faultLines' | 'elevation' | 'temperature' | 'wind' | 'precipitation' | 'biomes';

// XNA Color equivalents as [r, g, b] 0-255
export const BIOME_COLORS: Record<Biome, [number, number, number]> = {
  [Biome.Ocean]: [0, 0, 139], // DarkBlue
  [Biome.ShallowWater]: [0, 0, 255], // Blue
  [Biome.Mountain]: [128, 128, 128], // Gray
  [Biome.Desert]: [210, 180, 140], // Tan
  [Biome.Grassland]: [128, 128, 0], // Olive
  [Biome.Arctic]: [255, 255, 255], // White
  [Biome.Tundra]: [169, 169, 169], // DarkGray
  [Biome.Savanna]: [244, 164, 96], // SandyBrown
  [Biome.TempForest]: [0, 128, 0], // Green
  [Biome.BorealForest]: [46, 139, 87], // SeaGreen
  [Biome.Rainforest]: [0, 100, 0], // DarkGreen
};

export const DEFAULT_NOISE: NoiseVariables = {
  seed: 42,
  octaves: 6,
  frequency: 1.0,
  persistence: 0.5,
  lacunarity: 2.0,
  waterPercentage: 0.55,
};

export const DEFAULT_CLIMATE: ClimateVariables = {
  initialMoisture: 0.5,
  evaporationFactor: 0.3,
  precipitationFactor: 0.5,
  runoffFactor: 0.2,
  climateCycles: 5,
};
