import { Biome, BIOME_COLORS, KoppenClass, type LayerName, type WorldData } from './types';
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
    case 'elevation':
      colorElevation(data as Float32Array, rgba, seaLevel);
      break;
    case 'temperature':
      colorTemperature(data as Float32Array, rgba);
      break;
    case 'wind':
      colorWind(data as Float32Array, rgba, width, height);
      break;
    case 'precipitation':
      colorPrecipitation(data as Float32Array, rgba);
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

function colorTemperature(data: Float32Array, rgba: Uint8Array): void {
  for (let i = 0; i < data.length; i++) {
    const t = Math.max(0, Math.min(1, data[i]));
    const o = i * 4;
    // Cyan (0, 255, 255) to Red (255, 0, 0)
    rgba[o] = Math.round(t * 255);
    rgba[o + 1] = Math.round((1 - t) * 255);
    rgba[o + 2] = Math.round((1 - t) * 255);
    rgba[o + 3] = 255;
  }
}

function colorWind(data: Float32Array, rgba: Uint8Array, width: number, height: number): void {
  // Wind is interleaved [dx, dy, ...], so data.length = width*height*2
  const cellCount = width * height;
  for (let i = 0; i < cellCount; i++) {
    const dx = data[i * 2];
    const dy = data[i * 2 + 1];
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

function colorBiomes(data: Float32Array, rgba: Uint8Array, width: number, height: number, worldData?: WorldData): void {
  // Precompute hillshade from elevation if available
  let hillshade: Float32Array | null = null;
  if (worldData) {
    hillshade = computeHillshade(worldData.elevation, width, height);
  }

  for (let i = 0; i < data.length; i++) {
    const biome = data[i] as Biome;
    const color = BIOME_COLORS[biome] ?? [255, 0, 255];
    const o = i * 4;

    // Apply hillshading: shade ranges from ~0.6 (shadow) to ~1.2 (lit)
    const shade = hillshade ? hillshade[i] : 1;
    rgba[o] = Math.min(255, Math.round(color[0] * shade));
    rgba[o + 1] = Math.min(255, Math.round(color[1] * shade));
    rgba[o + 2] = Math.min(255, Math.round(color[2] * shade));
    rgba[o + 3] = 255;
  }
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
