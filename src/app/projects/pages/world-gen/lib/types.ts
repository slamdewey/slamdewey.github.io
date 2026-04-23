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
  /** Hemispheric tilt magnitude in normalized temperature units. Drives summer/winter ΔT. */
  seasonalTilt: number;
  /** ITCZ migration between summer and winter, as a fraction of map height. */
  itczShift: number;
  /** Orographic lift multiplier on windward slopes. */
  orographicLiftStrength: number;
  /** Foehn-style descent drying factor on leeward slopes. */
  rainShadowStrength: number;
  /** Fraction of advected cloud per cycle (semi-Lagrangian step length). */
  cloudAdvectionRate: number;
  /** Clausius-Clapeyron exponent for cloud carrying capacity (~0.07 ≈ 7% per °C). */
  precipTemperatureScale: number;
  /** Frost threshold in normalized temperature units; below this, no growing season. */
  frostThreshold: number;
  /** Aridity wilt point; aridity below this kills growing season regardless of temperature. */
  aridityWiltPoint: number;
}

export interface TectonicVariables {
  plateCount: number;
  cellCount: number;
  relaxationIterations: number;
  /** Global multiplier for all boundary falloff widths. Default 1.0. */
  boundaryFalloffScale: number;
}

export const DEFAULT_TECTONIC: TectonicVariables = {
  plateCount: 32,
  cellCount: 750,
  relaxationIterations: 1,
  boundaryFalloffScale: 1.0,
};

import { DEFAULT_HYDROLOGY, type HydrologyVariables } from './stages/hydrology';
export { DEFAULT_HYDROLOGY, type HydrologyVariables };

export { KoppenClass } from './stages/climate/koppen';

export interface WorldConfig {
  width: number;
  height: number;
  noise: NoiseVariables;
  climate: ClimateVariables;
  tectonic: TectonicVariables;
  hydrology: HydrologyVariables;
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
  // Köppen-driven additions
  ColdDesert,
  MediterraneanShrub,
  MonsoonForest,
}

export interface WorldData {
  width: number;
  height: number;
  plateMap: Int32Array;
  faultLines: Float32Array;
  mountainRanges: Float32Array;
  elevation: Float32Array;
  seaLevel: number;
  temperatureSummer: Float32Array;
  temperatureWinter: Float32Array;
  temperatureMean: Float32Array;
  wind: Float32Array; // interleaved [dx, dy, dx, dy, ...] length = width*height*2
  petSummer: Float32Array;
  petWinter: Float32Array;
  petAnnual: Float32Array;
  precipSummer: Float32Array;
  precipWinter: Float32Array;
  /** Mean per-cycle precipitation (avg of summer and winter sims), [0, 1]. */
  precipAnnual: Float32Array;
  aridityIndex: Float32Array;
  seasonality: Float32Array;
  continentality: Float32Array;
  growingSeason: Float32Array;
  koppenClass: Uint8Array;
  biomes: Float32Array; // biome index as float
  flowAccumulation: Float32Array;
  rivers: Float32Array; // [0, 1] river intensity on land, 0 on ocean
  lakes: Uint8Array; // 0/1 lake mask
}

export type LayerName =
  | 'plates'
  | 'faultLines'
  | 'elevation'
  | 'temperature'
  | 'wind'
  | 'precipitation'
  | 'biomes'
  | 'flowAccumulation'
  | 'rivers'
  | 'lakes'
  | 'aridity'
  | 'seasonality'
  | 'growingSeason'
  | 'koppen';

// XNA Color equivalents as [r, g, b] 0-255
export const BIOME_COLORS: Record<Biome, [number, number, number]> = {
  [Biome.Ocean]: [0, 0, 139], // DarkBlue
  [Biome.ShallowWater]: [0, 0, 255], // Blue
  [Biome.Mountain]: [128, 128, 128], // Gray
  [Biome.Desert]: [210, 180, 140], // Tan (hot desert)
  [Biome.Grassland]: [128, 128, 0], // Olive
  [Biome.Arctic]: [255, 255, 255], // White
  [Biome.Tundra]: [169, 169, 169], // DarkGray
  [Biome.Savanna]: [244, 164, 96], // SandyBrown
  [Biome.TempForest]: [0, 128, 0], // Green
  [Biome.BorealForest]: [46, 139, 87], // SeaGreen
  [Biome.Rainforest]: [0, 100, 0], // DarkGreen
  [Biome.ColdDesert]: [188, 170, 140], // pale tan-gray
  [Biome.MediterraneanShrub]: [154, 168, 90], // dry olive-green
  [Biome.MonsoonForest]: [60, 140, 60], // wet medium green
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
  seasonalTilt: 0.18,
  itczShift: 0.05,
  orographicLiftStrength: 3.0,
  rainShadowStrength: 4.0,
  cloudAdvectionRate: 1.0,
  precipTemperatureScale: 1.5,
  frostThreshold: 0.35,
  aridityWiltPoint: 0.2,
};
