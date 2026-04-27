export interface NoiseVariables {
  seed: number;
  octaves: number;
  frequency: number;
  persistence: number;
  lacunarity: number;
  waterPercentage: number;
}

export interface ClimateVariables {
  /** Hemispheric tilt magnitude in normalized temperature units. Drives summer/winter ΔT. */
  seasonalTilt: number;
  /** Magnitude of seasonal thermal-equator migration as a fraction of map
   *  height. Tropical bands (ITCZ + subtropical highs) shift by ±itczShift
   *  between summer and winter; extratropical bands stay put, so the Ferrel
   *  cells widen/compress asymmetrically per season. Default 0.05 ≈ 9° on
   *  an Earth-scale map, matching real ITCZ migration. */
  itczShift: number;
  /** Orographic lift multiplier on windward slopes. */
  orographicLiftStrength: number;
  /** Föhn descent drying factor on leeward slopes. Each per-step descent
   *  removes `rainShadowStrength · |rise| · 0.4` of the parcel's q without
   *  precipitating it (dry adiabatic warming dries the air). */
  rainShadowStrength: number;
  /** Frost threshold in normalized temperature units; below this, PET ≈ 0 and no growing season. */
  frostThreshold: number;
  /** Aridity wilt point; growing-season favorability falls below this. */
  aridityWiltPoint: number;
  /** Global multiplier on pressure-gradient wind magnitude. */
  windStrength: number;
  /** Strength of land-sea thermal contrast in the pressure field, driving monsoon flips. */
  thermalContrastStrength: number;
  /** Number of advection–diffusion–precipitation iterations per seasonal humidity pass.
   *  Pure quality knob — increasing this should *not* change climate (within ~2 %),
   *  only refine it. The physics is rate-based so dt = cycleDays/iter is what changes. */
  moistureIterations: number;
  /** Simulation duration per seasonal pass, in days. ~30 days is plenty for the moisture
   *  field to reach steady state (mean atmospheric residence time is ~9 days on Earth). */
  cycleDays: number;
  /** What real-world wind speed (m/s) corresponds to a wind-field magnitude of 1.0.
   *  Together with cellSizeKm = circumferenceKm/width, this converts the dimensionless
   *  wind into per-step cell displacements: cells/step = wind · windReferenceMs · dt[d] · 86.4 / cellSizeKm. */
  windReferenceMs: number;
  /** Eddy diffusivity for atmospheric moisture, km²/day. ~8000 km²/day ≈ 10⁵ m²/s,
   *  the standard rough order for tropospheric horizontal eddy mixing. Per-step
   *  blend factor = D · dt / dx². Larger values smooth the precip field across axes. */
  moistureDiffusivityKm2PerDay: number;
  /** Ocean evaporation rate per day (fraction of saturation deficit filled per day, scaled by T). */
  oceanEvapPerDay: number;
  /** Saturation rainout rate per day — fraction of (q − qSat) that precipitates per day.
   *  Should be fast (~1/day) — supersaturated air condenses on a sub-daily timescale. */
  saturationRainoutPerDay: number;
  /** Fraction of q forced to precipitate per unit of along-wind elevation rise (one-shot per step). */
  orographicCondensation: number;
  /** Convective rainout rate per day — fraction of q that precipitates each day
   *  regardless of saturation. Sets the moisture-transport e-folding distance:
   *  reachKm ≈ windReferenceMs · 86.4 / convectivePrecipPerDay. With defaults
   *  (10 m/s, 0.3/day) reach ≈ 3000 km, matching Earth's ocean-to-interior
   *  attenuation distance. Boosted under the ITCZ and storm tracks. */
  convectivePrecipPerDay: number;
  /** Subtropical-high subsidence decay rate per day (drying under ~±30° latitude). */
  subsidenceDecayPerDay: number;
  /** Soil-moisture bucket time constant in days. The Manabe (1969) one-bucket
   *  land-surface model: stored soil moisture S evaporates at rate S/τ, replenished
   *  by P. ~45 days is climatologically typical for vegetated land. */
  soilMoistureTimescaleDays: number;
  /** Maximum land-surface recycling efficiency, applied at warm-temperate and
   *  tropical temperatures. Cold cells receive less via a smoothstep ramp from
   *  `frostThreshold + 0.05` (zero) up to T = 0.65 (ceiling). This separates
   *  hot-desert recycling (BWh) from cold-desert recycling (BWk) — a single
   *  global scalar conflates them and forces a tuning tradeoff. Earth-scale
   *  recycling ratio is ~0.30 over the Amazon, ~0.05 over Siberia. */
  landEvapEfficiency: number;
  /** Mid-latitude storm-track precipitation boost — Gaussian peak at ±50° lat,
   *  multiplier on convective rate. Approximates baroclinic-eddy precipitation
   *  that a quasi-static 2D sim cannot model directly. 0 disables the boost. */
  stormTrackBoost: number;
  /** Peak temperature modifier from wind-driven boundary currents, as a
   *  fraction of [0,1] temperature units. Applied at continental boundaries
   *  (cold eastern / warm western ocean margins), falls off exponentially
   *  into open ocean. Produces realistic east/west coastal asymmetry —
   *  California/Atacama/Namib cold west-coasts vs Gulf-Stream warm east-
   *  coasts on mid-latitude continents. */
  boundaryCurrentStrength: number;
  /** Seasonal-amplitude boost for deep-continental interiors. Interior land
   *  cells experience the seasonal tilt scaled by (1 + continentalityStrength
   *  × inlandProximity); coastal cells are unchanged. 0.5 ≈ 50% extra
   *  summer/winter swing inland — matches the Dfa/Cfb (Chicago vs Dublin)
   *  contrast. Annual mean is preserved because the per-season extras cancel. */
  continentalityStrength: number;
  /** Iterations of wind-driven sea-surface-temperature advection. Transports
   *  boundary-current anomalies downstream so e.g. Gulf-Stream warmth reaches
   *  the far side of the basin. 40 is usually enough to cross a basin at
   *  default wind magnitudes. */
  sstIterations: number;
  /** Per-iteration lateral diffusion coefficient on the SST anomaly field,
   *  [0, 1]. Represents mesoscale ocean mixing. */
  sstDiffusion: number;
  /** Per-iteration radiative relaxation toward zero anomaly. Without this,
   *  advected anomalies would accumulate indefinitely; with it, they decay
   *  on a length scale ≈ windMagnitude / relaxation ≈ basin-scale. */
  sstRelaxation: number;
}

export interface TectonicVariables {
  plateCount: number;
  cellCount: number;
  relaxationIterations: number;
  /** Global multiplier for all boundary falloff widths. Default 1.0. */
  boundaryFalloffScale: number;
  /** Domain-warp amplitude for coastline sampling, as a fraction of plate radius. Fix A. */
  coastlineWarpAmplitude: number;
  /** Domain-warp frequency, as a multiplier of the elevation base frequency. Fix A. */
  coastlineWarpFrequency: number;
  /** Ridged-fBm amplitude added to continental plate interiors. Fix B. */
  continentalSubReliefAmplitude: number;
  /** Ridged-fBm frequency, as a multiplier of nv.frequency. Fix B. */
  continentalSubReliefFrequency: number;
  /** Multiplier on the oceanic age-from-ridge elevation gradient. Fix C. */
  oceanicAgeGradientStrength: number;
  /** If true, Jacobi smoothing blends passive boundaries instead of pinning them. Fix D. */
  boundarySoftenPassive: boolean;
}

export const DEFAULT_TECTONIC: TectonicVariables = {
  plateCount: 32,
  cellCount: 1500,
  relaxationIterations: 1,
  boundaryFalloffScale: 1.0,
  coastlineWarpAmplitude: 0.25,
  coastlineWarpFrequency: 4.0,
  continentalSubReliefAmplitude: 0.35,
  continentalSubReliefFrequency: 0.3,
  oceanicAgeGradientStrength: 1.0,
  boundarySoftenPassive: true,
};

import { DEFAULT_HYDROLOGY, type HydrologyVariables } from './stages/hydrology';
export { DEFAULT_HYDROLOGY, type HydrologyVariables };

export { KoppenClass } from './stages/climate/koppen';

export interface WorldConfig {
  width: number;
  height: number;
  /** Equatorial circumference of the simulated world, in km. Default 40000 (Earth-like).
   *  Combined with width, this fixes cellSizeKm = circumferenceKm/width and makes
   *  the climate physics resolution-independent. */
  circumferenceKm: number;
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
  /** Signed intra-continental perturbation (red = swell, blue = basin). Fix B. */
  continentalSubRelief: Float32Array;
  /** Distance-to-ridge, normalized to [0, 1] where 0 is a ridge and 1 is the farthest abyssal plain. Fix C. */
  oceanAge: Float32Array;
  elevation: Float32Array;
  seaLevel: number;
  temperatureSummer: Float32Array;
  temperatureWinter: Float32Array;
  temperatureMean: Float32Array;
  wind: Float32Array; // interleaved [dx, dy, dx, dy, ...] length = width*height*2 — annual mean
  windSummer: Float32Array; // interleaved [dx, dy], NH summer season
  windWinter: Float32Array; // interleaved [dx, dy], NH winter season
  petSummer: Float32Array;
  petWinter: Float32Array;
  petAnnual: Float32Array;
  precipSummer: Float32Array;
  precipWinter: Float32Array;
  /** Mean per-cycle precipitation (avg of summer and winter sims), [0, 1]. */
  precipAnnual: Float32Array;
  /** Steady-state soil-moisture from the recycling bucket model. mm-equivalent
   *  scaled to [0, 1] for visualization; physical-units value lives inside the
   *  humidity sim. Wet-coast → dry-interior gradient when recycling is active. */
  soilMoisture: Float32Array;
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
  | 'continentalSubRelief'
  | 'oceanAge'
  | 'elevation'
  | 'temperature'
  | 'wind'
  | 'windSummer'
  | 'windWinter'
  | 'precipitation'
  | 'soilMoisture'
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
  seasonalTilt: 0.18,
  itczShift: 0.05,
  orographicLiftStrength: 3.0,
  rainShadowStrength: 1.0,
  frostThreshold: 0.35,
  aridityWiltPoint: 0.2,
  windStrength: 1.0,
  thermalContrastStrength: 0.6,
  moistureIterations: 100,
  cycleDays: 30,
  windReferenceMs: 10,
  moistureDiffusivityKm2PerDay: 8000,
  oceanEvapPerDay: 1.0,
  saturationRainoutPerDay: 1.0,
  orographicCondensation: 2.5,
  convectivePrecipPerDay: 0.3,
  subsidenceDecayPerDay: 0.4,
  soilMoistureTimescaleDays: 45,
  landEvapEfficiency: 0.5,
  stormTrackBoost: 0.5,
  boundaryCurrentStrength: 0.35,
  continentalityStrength: 0.5,
  sstIterations: 40,
  sstDiffusion: 0.08,
  sstRelaxation: 0.02,
};
