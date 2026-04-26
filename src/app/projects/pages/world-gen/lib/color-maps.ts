import { KoppenClass, type LayerName, type WorldData } from './types';
import { mapToUnsignedRange, mod } from '@lib/math';
import { PlateType, BoundaryType, type TectonicResult } from './stages/tectonic-plates';

/**
 * Convert a layer's Float32Array data to an RGBA Uint8Array for GPU upload.
 * Biome layer uses hillshading from elevation for a 3D effect.
 */
export function layerToRGBA(
  data: Float32Array | Uint8Array,
  width: number,
  height: number,
  layer: LayerName,
  seaLevel: number,
  worldData?: WorldData
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);

  switch (layer) {
    case 'plates':
      // Handled separately via platesToRGBA — should not reach here
      break;
    case 'faultLines':
      colorFaultLines(data as Float32Array, rgba);
      break;
    case 'continentalSubRelief':
      colorDivergingRedBlue(data as Float32Array, rgba, 1 / 0.35);
      break;
    case 'oceanAge':
      colorScalarRaw(data as Float32Array, rgba, [180, 220, 255], [5, 15, 40]);
      break;
    case 'elevation':
      colorElevation(data as Float32Array, rgba, seaLevel);
      break;
    case 'temperature':
      colorTemperature(data as Float32Array, rgba);
      break;
    case 'wind':
    case 'windSummer':
    case 'windWinter':
      colorWind(data as Float32Array, rgba, width, height);
      break;
    case 'precipitation':
      colorPrecipitation(data as Float32Array, rgba);
      break;
    case 'soilMoisture':
      colorSoilMoisture(data as Float32Array, rgba, seaLevel, worldData);
      break;
    case 'biomes':
      colorBiomes(data as Float32Array, rgba, width, height, worldData);
      break;
    case 'flowAccumulation':
      colorFlowAccumulation(data as Float32Array, rgba, seaLevel, worldData);
      break;
    case 'rivers':
      colorRivers(data as Float32Array, rgba, seaLevel, worldData);
      break;
    case 'lakes':
      colorLakes(data as Uint8Array, rgba, seaLevel, worldData);
      break;
    case 'aridity':
      colorAridity(data as Float32Array, rgba, seaLevel, worldData);
      break;
    case 'seasonality':
      colorScalar(data as Float32Array, rgba, [50, 50, 80], [240, 200, 80], 1, seaLevel, worldData);
      break;
    case 'growingSeason':
      colorScalar(data as Float32Array, rgba, [120, 80, 40], [40, 180, 60], 1, seaLevel, worldData);
      break;
    case 'koppen':
      colorKoppen(data as Uint8Array, rgba, seaLevel, worldData);
      break;
  }

  return rgba;
}

/**
 * Render tectonic plates as colored Voronoi cells.
 * Continental plates get warm tints, oceanic get cool tints.
 * Boundary pixels are colored by type: red=convergent, blue=divergent, yellow=transform.
 */
export function platesToRGBA(tectonic: TectonicResult, width: number, height: number): Uint8Array {
  const { plateMap, plates, boundaries } = tectonic;
  const size = width * height;
  const rgba = new Uint8Array(size * 4);
  const plateCount = plates.length;

  // Build boundary lookup for coloring boundary pixels
  const boundaryMap = new Map<number, BoundaryType>();
  for (const b of boundaries) {
    const lo = Math.min(b.plateA, b.plateB);
    const hi = Math.max(b.plateA, b.plateB);
    boundaryMap.set(lo * plateCount + hi, b.type);
  }

  // Generate plate colors — warm hues for continental, cool for oceanic
  const plateColors: [number, number, number][] = plates.map((p, i) => {
    const hue = (i * 137.508) % 360; // golden angle spacing
    if (p.type === PlateType.Continental) {
      return hslToRgb(((hue % 120) + 20) / 360, 0.5, 0.5); // warm: 20-140 range
    } else {
      return hslToRgb(((hue % 120) + 180) / 360, 0.5, 0.45); // cool: 180-300 range
    }
  });

  // Boundary type colors
  const BOUNDARY_COLORS: Record<BoundaryType, [number, number, number]> = {
    [BoundaryType.Convergent]: [200, 40, 40],
    [BoundaryType.Divergent]: [40, 80, 200],
    [BoundaryType.Transform]: [200, 180, 40],
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = plateMap[idx];
      const out = idx * 4;

      // Check if this is a boundary pixel
      let boundaryType: BoundaryType | null = null;
      const neighbors = [
        x > 0 ? plateMap[idx - 1] : plateMap[y * width + width - 1],
        x < width - 1 ? plateMap[idx + 1] : plateMap[y * width],
        y > 0 ? plateMap[idx - width] : -1,
        y < height - 1 ? plateMap[idx + width] : -1,
      ];

      for (const n of neighbors) {
        if (n >= 0 && n !== cell) {
          const lo = Math.min(cell, n);
          const hi = Math.max(cell, n);
          const bt = boundaryMap.get(lo * plateCount + hi);
          if (bt !== undefined) {
            boundaryType = bt;
            break;
          }
        }
      }

      if (boundaryType !== null) {
        const [r, g, b] = BOUNDARY_COLORS[boundaryType];
        rgba[out] = r;
        rgba[out + 1] = g;
        rgba[out + 2] = b;
      } else {
        const [r, g, b] = plateColors[cell];
        rgba[out] = r;
        rgba[out + 1] = g;
        rgba[out + 2] = b;
      }
      rgba[out + 3] = 255;
    }
  }

  return rgba;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  const sector = (h * 6) | 0;
  switch (sector % 6) {
    case 0:
      r = c;
      g = x;
      break;
    case 1:
      r = x;
      g = c;
      break;
    case 2:
      g = c;
      b = x;
      break;
    case 3:
      g = x;
      b = c;
      break;
    case 4:
      r = x;
      b = c;
      break;
    case 5:
      r = c;
      b = x;
      break;
  }
  return [((r + m) * 255) | 0, ((g + m) * 255) | 0, ((b + m) * 255) | 0];
}

/** Diverging red-blue ramp centered on zero. `scale` maps input → [-1, 1]. */
function colorDivergingRedBlue(data: Float32Array, rgba: Uint8Array, scale: number): void {
  for (let i = 0; i < data.length; i++) {
    const t = Math.max(-1, Math.min(1, data[i] * scale));
    const o = i * 4;
    if (t >= 0) {
      // 0 → neutral gray (200, 200, 200); +1 → warm red (220, 60, 60).
      rgba[o] = Math.round(200 + t * 20);
      rgba[o + 1] = Math.round(200 + t * -140);
      rgba[o + 2] = Math.round(200 + t * -140);
    } else {
      // 0 → neutral gray; -1 → cool blue (60, 90, 220).
      const k = -t;
      rgba[o] = Math.round(200 - k * 140);
      rgba[o + 1] = Math.round(200 - k * 110);
      rgba[o + 2] = Math.round(200 + k * 20);
    }
    rgba[o + 3] = 255;
  }
}

/** Direct [0, 1] scalar colorizer that ignores elevation/seaLevel masking —
 *  needed because the ocean-age field is defined globally, not just on water. */
function colorScalarRaw(
  data: Float32Array,
  rgba: Uint8Array,
  low: [number, number, number],
  high: [number, number, number]
): void {
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    const t = Math.max(0, Math.min(1, data[i]));
    rgba[o] = Math.round(low[0] * (1 - t) + high[0] * t);
    rgba[o + 1] = Math.round(low[1] * (1 - t) + high[1] * t);
    rgba[o + 2] = Math.round(low[2] * (1 - t) + high[2] * t);
    rgba[o + 3] = 255;
  }
}

function colorFaultLines(data: Float32Array, rgba: Uint8Array): void {
  for (let i = 0; i < data.length; i++) {
    const v = Math.round(data[i] * 255);
    const o = i * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }
}

function colorElevation(data: Float32Array, rgba: Uint8Array, seaLevel: number): void {
  for (let i = 0; i < data.length; i++) {
    const raw = data[i]; // [-1, 1]
    const o = i * 4;
    if (raw < seaLevel) {
      // Water: blue tint, darker for deeper
      const depth = mapToUnsignedRange(raw);
      rgba[o] = 0;
      rgba[o + 1] = Math.round(depth * 80);
      rgba[o + 2] = Math.round(100 + depth * 155);
    } else {
      // Land: grayscale
      const v = Math.round(mapToUnsignedRange(raw) * 255);
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
    }
    rgba[o + 3] = 255;
  }
}

// Stops placed (not evenly spaced) so hue variation concentrates where most
// land sits (~0.6–0.95). Aligns with biome temperature regimes: polar →
// cold-temperate → cool → mild → warm → hot → extreme.
const TEMP_STOPS: { t: number; rgb: [number, number, number] }[] = [
  { t: 0.0, rgb: [40, 40, 120] },
  { t: 0.25, rgb: [70, 150, 220] },
  { t: 0.45, rgb: [140, 210, 220] },
  { t: 0.6, rgb: [200, 230, 150] },
  { t: 0.75, rgb: [230, 180, 80] },
  { t: 0.9, rgb: [220, 90, 50] },
  { t: 1.0, rgb: [140, 20, 20] },
];

function colorTemperature(data: Float32Array, rgba: Uint8Array): void {
  for (let i = 0; i < data.length; i++) {
    const t = Math.max(0, Math.min(1, data[i]));
    const o = i * 4;
    let hi = 1;
    while (hi < TEMP_STOPS.length - 1 && TEMP_STOPS[hi].t < t) hi++;
    const a = TEMP_STOPS[hi - 1];
    const b = TEMP_STOPS[hi];
    const span = b.t - a.t;
    const k = span > 0 ? (t - a.t) / span : 0;
    rgba[o] = Math.round(a.rgb[0] * (1 - k) + b.rgb[0] * k);
    rgba[o + 1] = Math.round(a.rgb[1] * (1 - k) + b.rgb[1] * k);
    rgba[o + 2] = Math.round(a.rgb[2] * (1 - k) + b.rgb[2] * k);
    rgba[o + 3] = 255;
  }
}

function colorWind(data: Float32Array, rgba: Uint8Array, width: number, height: number): void {
  // Wind is interleaved [dx, dy, ...] and non-unit (magnitude up to ~1.5).
  // Clamp components to [-1, 1] for the display mapping so strong winds
  // saturate predictably rather than wrap.
  const cellCount = width * height;
  for (let i = 0; i < cellCount; i++) {
    const dx = Math.max(-1, Math.min(1, data[i * 2]));
    const dy = Math.max(-1, Math.min(1, data[i * 2 + 1]));
    const o = i * 4;
    rgba[o] = Math.round(mapToUnsignedRange(dx) * 255);
    rgba[o + 1] = Math.round(mapToUnsignedRange(dy) * 255);
    rgba[o + 2] = 0;
    rgba[o + 3] = 255;
  }
}

function colorPrecipitation(data: Float32Array, rgba: Uint8Array): void {
  for (let i = 0; i < data.length; i++) {
    const v = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
    const o = i * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }
}

/** Soil moisture: dry tan → wet teal ramp on land, ocean masked. */
function colorSoilMoisture(data: Float32Array, rgba: Uint8Array, seaLevel: number, worldData?: WorldData): void {
  const elevation = worldData?.elevation;
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    if (elevation && elevation[i] < seaLevel) {
      rgba[o] = 0;
      rgba[o + 1] = 30;
      rgba[o + 2] = 80;
      rgba[o + 3] = 255;
      continue;
    }
    const t = Math.max(0, Math.min(1, data[i]));
    // dry: tan (190, 165, 110); wet: deep teal (30, 110, 130)
    rgba[o] = Math.round(190 * (1 - t) + 30 * t);
    rgba[o + 1] = Math.round(165 * (1 - t) + 110 * t);
    rgba[o + 2] = Math.round(110 * (1 - t) + 130 * t);
    rgba[o + 3] = 255;
  }
}

// Satellite-realistic palette indexed by Köppen class. Colors picked to
// resemble Blue Marble at global scale rather than the high-saturation
// political-map Köppen palette used in the dedicated Köppen layer.
const KOPPEN_NATURAL: Record<KoppenClass, [number, number, number]> = {
  [KoppenClass.Af]: [30, 80, 35], // tropical rainforest — deep green
  [KoppenClass.Am]: [45, 100, 45], // monsoon — slightly lighter
  [KoppenClass.Aw]: [165, 145, 80], // savanna — yellow-green
  [KoppenClass.BWh]: [225, 200, 145], // hot desert — pale tan
  [KoppenClass.BWk]: [180, 165, 130], // cold desert — gray-tan
  [KoppenClass.BSh]: [195, 170, 110], // hot steppe — straw
  [KoppenClass.BSk]: [170, 160, 110], // cold steppe — drab khaki
  [KoppenClass.Cfa]: [80, 130, 65], // humid subtropical — medium green
  [KoppenClass.Cfb]: [95, 145, 75], // oceanic — fresh green
  [KoppenClass.Csa]: [150, 145, 85], // mediterranean hot — olive
  [KoppenClass.Csb]: [135, 140, 95], // mediterranean warm — gray-olive
  [KoppenClass.Cwa]: [90, 135, 70], // subtropical monsoon
  [KoppenClass.Cwb]: [100, 145, 80], // subtropical highland
  [KoppenClass.Dfa]: [80, 115, 60], // hot continental
  [KoppenClass.Dfb]: [70, 105, 60], // warm continental
  [KoppenClass.Dfc]: [70, 95, 65], // subarctic — darker olive
  [KoppenClass.Dwa]: [110, 130, 80],
  [KoppenClass.Dwb]: [85, 110, 70],
  [KoppenClass.Dsa]: [135, 130, 80],
  [KoppenClass.Dsb]: [115, 125, 85],
  [KoppenClass.ET]: [155, 155, 140], // tundra — pale olive-gray
  [KoppenClass.EF]: [240, 242, 245], // ice cap — bright white
};

const SHALLOW_OCEAN: [number, number, number] = [60, 110, 165];
const DEEP_OCEAN: [number, number, number] = [10, 30, 75];
const COASTAL_SHELF: [number, number, number] = [80, 140, 180];
const LAKE_COLOR: [number, number, number] = [50, 95, 150];
const RIVER_COLOR: [number, number, number] = [70, 115, 165];
const ROCK_COLOR: [number, number, number] = [120, 110, 95];
const SNOW_COLOR: [number, number, number] = [248, 250, 252];

const MOUNTAIN_LEVEL = 0.85;
const SNOW_TEMPERATURE = 0.32; // mean temperature below this gets snow
const SNOW_ELEVATION = 0.7; // and elevation above this gets snow

function colorBiomes(
  _data: Float32Array,
  rgba: Uint8Array,
  width: number,
  height: number,
  worldData?: WorldData
): void {
  if (!worldData) return;
  const { elevation, koppenClass, temperatureMean, rivers, lakes, seaLevel } = worldData;
  const hillshade = computeHillshade(elevation, width, height);

  for (let i = 0; i < elevation.length; i++) {
    const o = i * 4;
    const e = elevation[i];

    // --- Water cells ------------------------------------------------------
    if (e < seaLevel) {
      // Ocean depth shading: depth measured below sea level, normalized.
      const depth = (seaLevel - e) / Math.max(0.01, seaLevel + 1); // 0 at coast, 1 at -1
      const t = Math.min(1, depth * 2);
      // Blend coastal shelf → shallow → deep
      let r: number, g: number, b: number;
      if (t < 0.15) {
        const k = t / 0.15;
        r = COASTAL_SHELF[0] * (1 - k) + SHALLOW_OCEAN[0] * k;
        g = COASTAL_SHELF[1] * (1 - k) + SHALLOW_OCEAN[1] * k;
        b = COASTAL_SHELF[2] * (1 - k) + SHALLOW_OCEAN[2] * k;
      } else {
        const k = (t - 0.15) / 0.85;
        r = SHALLOW_OCEAN[0] * (1 - k) + DEEP_OCEAN[0] * k;
        g = SHALLOW_OCEAN[1] * (1 - k) + DEEP_OCEAN[1] * k;
        b = SHALLOW_OCEAN[2] * (1 - k) + DEEP_OCEAN[2] * k;
      }
      rgba[o] = Math.round(r);
      rgba[o + 1] = Math.round(g);
      rgba[o + 2] = Math.round(b);
      rgba[o + 3] = 255;
      continue;
    }

    // --- Inland water: lakes & rivers -------------------------------------
    if (lakes[i] === 1) {
      // Cold lakes ice over. Blend toward snow as the mean temp drops past
      // the same threshold land uses for snow cover.
      const iceK = Math.min(1, Math.max(0, (SNOW_TEMPERATURE - temperatureMean[i]) / SNOW_TEMPERATURE));
      rgba[o] = Math.round(LAKE_COLOR[0] * (1 - iceK) + SNOW_COLOR[0] * iceK);
      rgba[o + 1] = Math.round(LAKE_COLOR[1] * (1 - iceK) + SNOW_COLOR[1] * iceK);
      rgba[o + 2] = Math.round(LAKE_COLOR[2] * (1 - iceK) + SNOW_COLOR[2] * iceK);
      rgba[o + 3] = 255;
      continue;
    }
    const riverIntensity = rivers[i];
    if (riverIntensity > 0.5) {
      // Rivers blend over the underlying terrain so they don't look painted on.
      const baseColor = baseTerrainColor(koppenClass[i] as KoppenClass);
      const t = Math.min(1, (riverIntensity - 0.5) * 2);
      const r = baseColor[0] * (1 - t) + RIVER_COLOR[0] * t;
      const g = baseColor[1] * (1 - t) + RIVER_COLOR[1] * t;
      const b = baseColor[2] * (1 - t) + RIVER_COLOR[2] * t;
      const shade = hillshade[i];
      rgba[o] = Math.min(255, Math.round(r * shade));
      rgba[o + 1] = Math.min(255, Math.round(g * shade));
      rgba[o + 2] = Math.min(255, Math.round(b * shade));
      rgba[o + 3] = 255;
      continue;
    }

    // --- Land: Köppen → natural color, optional snow cap, hillshade -------
    let color = baseTerrainColor(koppenClass[i] as KoppenClass);

    // Bare-rock blend on very high terrain even before snow takes over.
    if (e > MOUNTAIN_LEVEL) {
      const k = Math.min(1, (e - MOUNTAIN_LEVEL) / (1 - MOUNTAIN_LEVEL));
      color = [
        color[0] * (1 - k) + ROCK_COLOR[0] * k,
        color[1] * (1 - k) + ROCK_COLOR[1] * k,
        color[2] * (1 - k) + ROCK_COLOR[2] * k,
      ];
    }

    // Snow cap: cold + high. Polar regions get snow at lower elevation.
    const tMean = temperatureMean[i];
    const snowChance =
      Math.max(0, (SNOW_TEMPERATURE - tMean) / SNOW_TEMPERATURE) +
      Math.max(0, (e - SNOW_ELEVATION) / (1 - SNOW_ELEVATION)) * 0.6;
    if (snowChance > 0) {
      const k = Math.min(1, snowChance);
      color = [
        color[0] * (1 - k) + SNOW_COLOR[0] * k,
        color[1] * (1 - k) + SNOW_COLOR[1] * k,
        color[2] * (1 - k) + SNOW_COLOR[2] * k,
      ];
    }

    const shade = hillshade[i];
    rgba[o] = Math.min(255, Math.round(color[0] * shade));
    rgba[o + 1] = Math.min(255, Math.round(color[1] * shade));
    rgba[o + 2] = Math.min(255, Math.round(color[2] * shade));
    rgba[o + 3] = 255;
  }
}

function baseTerrainColor(k: KoppenClass): [number, number, number] {
  const c = KOPPEN_NATURAL[k];
  // Defensive copy because the snow/rock blend mutates locally.
  return [c[0], c[1], c[2]];
}

function colorFlowAccumulation(data: Float32Array, rgba: Uint8Array, seaLevel: number, worldData?: WorldData): void {
  const elevation = worldData?.elevation;
  // log2(1 + max) roughly — clamp to a sensible upper bound so visualization
  // doesn't collapse around one absurdly-long main stem.
  const LOG_CAP = 18;
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    if (elevation && elevation[i] < seaLevel) {
      rgba[o] = 10;
      rgba[o + 1] = 20;
      rgba[o + 2] = 60;
      rgba[o + 3] = 255;
      continue;
    }
    const v = Math.min(Math.log2(1 + data[i]) / LOG_CAP, 1);
    // Dark brown (low flow, dry land) → cyan (major rivers)
    rgba[o] = Math.round((1 - v) * 80 + v * 120);
    rgba[o + 1] = Math.round((1 - v) * 60 + v * 220);
    rgba[o + 2] = Math.round((1 - v) * 30 + v * 255);
    rgba[o + 3] = 255;
  }
}

function colorRivers(data: Float32Array, rgba: Uint8Array, seaLevel: number, worldData?: WorldData): void {
  const elevation = worldData?.elevation;
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    if (elevation && elevation[i] < seaLevel) {
      // Ocean background — same palette as elevation layer.
      const depth = mapToUnsignedRange(elevation[i]);
      rgba[o] = 0;
      rgba[o + 1] = Math.round(depth * 80);
      rgba[o + 2] = Math.round(100 + depth * 155);
      rgba[o + 3] = 255;
      continue;
    }
    const base = elevation ? Math.round(mapToUnsignedRange(elevation[i]) * 255) : 128;
    const t = data[i];
    // Blend grayscale land with a river blue.
    const RIVER_R = 40;
    const RIVER_G = 120;
    const RIVER_B = 220;
    rgba[o] = Math.round(base * (1 - t) + RIVER_R * t);
    rgba[o + 1] = Math.round(base * (1 - t) + RIVER_G * t);
    rgba[o + 2] = Math.round(base * (1 - t) + RIVER_B * t);
    rgba[o + 3] = 255;
  }
}

function colorLakes(data: Uint8Array, rgba: Uint8Array, seaLevel: number, worldData?: WorldData): void {
  const elevation = worldData?.elevation;
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    if (elevation && elevation[i] < seaLevel) {
      const depth = mapToUnsignedRange(elevation[i]);
      rgba[o] = 0;
      rgba[o + 1] = Math.round(depth * 80);
      rgba[o + 2] = Math.round(100 + depth * 155);
      rgba[o + 3] = 255;
      continue;
    }
    if (data[i] === 1) {
      rgba[o] = 30;
      rgba[o + 1] = 90;
      rgba[o + 2] = 200;
    } else {
      const v = elevation ? Math.round(mapToUnsignedRange(elevation[i]) * 255) : 128;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
    }
    rgba[o + 3] = 255;
  }
}

function colorAridity(data: Float32Array, rgba: Uint8Array, seaLevel: number, worldData?: WorldData): void {
  const elevation = worldData?.elevation;
  // Aridity in [0, 1.5+]. Color stops:
  //   0.0  hyper-arid → deep tan/brown
  //   0.2  arid       → tan
  //   0.5  semi-arid  → olive
  //   0.65 humid      → green
  //   1.0+ very humid → deep green
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    if (elevation && elevation[i] < seaLevel) {
      rgba[o] = 0;
      rgba[o + 1] = 30;
      rgba[o + 2] = 80;
      rgba[o + 3] = 255;
      continue;
    }
    const v = Math.min(data[i], 1);
    const r = Math.round((1 - v) * 200 + v * 30);
    const g = Math.round((1 - v) * 150 + v * 140);
    const b = Math.round((1 - v) * 80 + v * 60);
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }
}

function colorScalar(
  data: Float32Array,
  rgba: Uint8Array,
  low: [number, number, number],
  high: [number, number, number],
  scale: number,
  seaLevel: number,
  worldData?: WorldData
): void {
  const elevation = worldData?.elevation;
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    if (elevation && elevation[i] < seaLevel) {
      rgba[o] = 0;
      rgba[o + 1] = 30;
      rgba[o + 2] = 80;
      rgba[o + 3] = 255;
      continue;
    }
    const t = Math.max(0, Math.min(1, data[i] * scale));
    rgba[o] = Math.round(low[0] * (1 - t) + high[0] * t);
    rgba[o + 1] = Math.round(low[1] * (1 - t) + high[1] * t);
    rgba[o + 2] = Math.round(low[2] * (1 - t) + high[2] * t);
    rgba[o + 3] = 255;
  }
}

const KOPPEN_COLORS: Record<KoppenClass, [number, number, number]> = {
  [KoppenClass.Af]: [0, 0, 254],
  [KoppenClass.Am]: [0, 119, 255],
  [KoppenClass.Aw]: [70, 169, 250],
  [KoppenClass.BWh]: [254, 0, 0],
  [KoppenClass.BWk]: [254, 150, 150],
  [KoppenClass.BSh]: [245, 163, 1],
  [KoppenClass.BSk]: [255, 219, 99],
  [KoppenClass.Cfa]: [198, 255, 78],
  [KoppenClass.Cfb]: [102, 255, 51],
  [KoppenClass.Csa]: [255, 255, 0],
  [KoppenClass.Csb]: [198, 199, 0],
  [KoppenClass.Cwa]: [150, 255, 150],
  [KoppenClass.Cwb]: [99, 199, 100],
  [KoppenClass.Dfa]: [55, 200, 255],
  [KoppenClass.Dfb]: [55, 150, 200],
  [KoppenClass.Dfc]: [3, 120, 120],
  [KoppenClass.Dwa]: [171, 177, 255],
  [KoppenClass.Dwb]: [90, 120, 220],
  [KoppenClass.Dsa]: [255, 0, 254],
  [KoppenClass.Dsb]: [198, 0, 199],
  [KoppenClass.ET]: [178, 178, 178],
  [KoppenClass.EF]: [102, 102, 102],
};

function colorKoppen(data: Uint8Array, rgba: Uint8Array, seaLevel: number, worldData?: WorldData): void {
  const elevation = worldData?.elevation;
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    if (elevation && elevation[i] < seaLevel) {
      const depth = mapToUnsignedRange(elevation[i]);
      rgba[o] = 0;
      rgba[o + 1] = Math.round(depth * 80);
      rgba[o + 2] = Math.round(100 + depth * 155);
      rgba[o + 3] = 255;
      continue;
    }
    const color = KOPPEN_COLORS[data[i] as KoppenClass] ?? [255, 0, 255];
    rgba[o] = color[0];
    rgba[o + 1] = color[1];
    rgba[o + 2] = color[2];
    rgba[o + 3] = 255;
  }
}

/**
 * Simple hillshade: directional gradient from a top-left light source.
 * Returns a per-pixel shade multiplier in [0.6, 1.3].
 */
function computeHillshade(elevation: Float32Array, width: number, height: number): Float32Array {
  const shade = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      // Horizontal gradient (wraps)
      const left = elevation[y * width + mod(x - 1, width)];
      const right = elevation[y * width + mod(x + 1, width)];
      const dx = right - left;
      // Vertical gradient (clamps)
      const up = y > 0 ? elevation[(y - 1) * width + x] : elevation[idx];
      const down = y < height - 1 ? elevation[(y + 1) * width + x] : elevation[idx];
      const dy = down - up;
      // Light from top-left: dot(normal, lightDir) where lightDir ≈ (-1, -1, 2)
      const s = 1 + (-dx - dy) * 2;
      shade[idx] = Math.max(0.6, Math.min(1.3, s));
    }
  }
  return shade;
}
