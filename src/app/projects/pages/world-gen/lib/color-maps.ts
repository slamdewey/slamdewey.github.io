import { Biome, BIOME_COLORS, type LayerName, type WorldData } from './types';
import { mapToUnsignedRange, mod } from '@lib/math';

/**
 * Convert a layer's Float32Array data to an RGBA Uint8Array for GPU upload.
 * Biome layer uses hillshading from elevation for a 3D effect.
 */
export function layerToRGBA(
  data: Float32Array,
  width: number,
  height: number,
  layer: LayerName,
  seaLevel: number,
  worldData?: WorldData
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);

  switch (layer) {
    case 'faultLines':
      colorFaultLines(data, rgba);
      break;
    case 'elevation':
      colorElevation(data, rgba, seaLevel);
      break;
    case 'temperature':
      colorTemperature(data, rgba);
      break;
    case 'wind':
      colorWind(data, rgba, width, height);
      break;
    case 'precipitation':
      colorPrecipitation(data, rgba);
      break;
    case 'biomes':
      colorBiomes(data, rgba, width, height, worldData);
      break;
  }

  return rgba;
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
