import { KoppenClass, type LayerName, type WorldData, type BoundaryInfo } from './types';
import { mapToUnsignedRange } from '@lib/math';
import { PlateType, BoundaryType } from './stages/tectonic';
import { classifyKoppenAt } from './stages/climate/koppen';
import type { WorldSampler } from './world-sampler';

/**
 * Convert a layer to an RGBA Uint8Array for GPU upload, materialized at
 * the requested render resolution (Phase A5).
 *
 * `renderW × renderH` is independent of the sampler's physics resolution.
 * Smooth fields (temperature, precipitation, etc.) are bilinear-sampled
 * from the physics grid; categorical fields (Köppen, lakes) are
 * nearest-sampled or re-classified per render pixel from sampled inputs.
 * Sharp features (coastlines, plate boundaries) currently inherit the
 * bilinear smoothing as a soft blur — a follow-up phase can replace that
 * with analytical polyline snapping for sub-pixel-crisp edges.
 */
export function layerToRGBA(
  rgba: Uint8Array,
  renderW: number,
  renderH: number,
  layer: LayerName,
  sampler: WorldSampler
): void {
  switch (layer) {
    case 'plates':
      // Plate layer is rendered via platesToRGBA — caller should route there.
      break;
    case 'faultLines':
      colorFaultLines(rgba, renderW, renderH, sampler);
      break;
    case 'continentalSubRelief':
      colorContinentalSubRelief(rgba, renderW, renderH, sampler);
      break;
    case 'oceanAge':
      colorOceanAge(rgba, renderW, renderH, sampler);
      break;
    case 'elevation':
      colorElevation(rgba, renderW, renderH, sampler);
      break;
    case 'temperature':
      colorTemperature(rgba, renderW, renderH, sampler);
      break;
    case 'wind':
      colorWind(rgba, renderW, renderH, sampler, sampler.raw.wind);
      break;
    case 'windSummer':
      colorWind(rgba, renderW, renderH, sampler, sampler.raw.windSummer);
      break;
    case 'windWinter':
      colorWind(rgba, renderW, renderH, sampler, sampler.raw.windWinter);
      break;
    case 'precipitation':
      colorPrecipitation(rgba, renderW, renderH, sampler);
      break;
    case 'soilMoisture':
      colorSoilMoisture(rgba, renderW, renderH, sampler);
      break;
    case 'biomes':
      colorBiomes(rgba, renderW, renderH, sampler);
      break;
    case 'flowAccumulation':
      colorFlowAccumulation(rgba, renderW, renderH, sampler);
      break;
    case 'rivers':
      colorRivers(rgba, renderW, renderH, sampler);
      break;
    case 'lakes':
      colorLakes(rgba, renderW, renderH, sampler);
      break;
    case 'aridity':
      colorAridity(rgba, renderW, renderH, sampler);
      break;
    case 'seasonality':
      colorMaskedScalar(
        rgba,
        renderW,
        renderH,
        sampler,
        (px, py) => sampler.sampleSeasonality(px, py),
        [50, 50, 80],
        [240, 200, 80]
      );
      break;
    case 'growingSeason':
      colorMaskedScalar(
        rgba,
        renderW,
        renderH,
        sampler,
        (px, py) => sampler.sampleGrowingSeason(px, py),
        [120, 80, 40],
        [40, 180, 60]
      );
      break;
    case 'koppen':
      colorKoppen(rgba, renderW, renderH, sampler);
      break;
  }
}

/**
 * Render tectonic plates as colored Voronoi cells at render resolution.
 * Boundary pixels are detected by sampling 4 neighbors at *physics-pixel*
 * spacing — at higher render resolutions the boundary outline matches the
 * physics-grid boundary, just upsampled. (Sub-pixel-crisp plate boundaries
 * would require analytical polyline rendering — deferred.)
 */
export function platesToRGBA(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const world = sampler.raw;
  const { plates, boundaries } = world;
  const plateCount = plates.length;

  const boundaryMap = new Map<number, BoundaryType>();
  for (const b of boundaries) {
    const lo = Math.min(b.plateA, b.plateB);
    const hi = Math.max(b.plateA, b.plateB);
    boundaryMap.set(lo * plateCount + hi, b.type);
  }

  const plateColors: [number, number, number][] = plates.map((p, i) => {
    const hue = (i * 137.508) % 360;
    if (p.type === PlateType.Continental) {
      return hslToRgb(((hue % 120) + 20) / 360, 0.5, 0.5);
    }
    return hslToRgb(((hue % 120) + 180) / 360, 0.5, 0.45);
  });

  const BOUNDARY_COLORS: Record<BoundaryType, [number, number, number]> = {
    [BoundaryType.Convergent]: [200, 40, 40],
    [BoundaryType.Divergent]: [40, 80, 200],
    [BoundaryType.Transform]: [200, 180, 40],
  };

  const physicsW = sampler.width;
  const physicsH = sampler.height;
  const scaleX = physicsW / renderW;
  const scaleY = physicsH / renderH;

  for (let ry = 0; ry < renderH; ry++) {
    const py = (ry + 0.5) * scaleY - 0.5;
    for (let rx = 0; rx < renderW; rx++) {
      const px = (rx + 0.5) * scaleX - 0.5;
      const cell = sampler.samplePlate(px, py);
      const out = (ry * renderW + rx) * 4;

      // Boundary detection: sample 4 physics-pixel neighbors and check for
      // a different plate id. At render-res ≥ physics-res this preserves
      // the same one-physics-pixel-wide boundary band as the original.
      const nL = sampler.samplePlate(px - 1, py);
      const nR = sampler.samplePlate(px + 1, py);
      const nU = sampler.samplePlate(px, py - 1);
      const nD = sampler.samplePlate(px, py + 1);
      let boundaryType: BoundaryType | null = null;
      for (const n of [nL, nR, nU, nD]) {
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
}

// ── Per-pixel coordinate helper ────────────────────────────────────────────

/**
 * Stream physics-pixel coordinates for every render pixel in row-major order.
 * Centralizes the scaling so per-layer color functions can stay tight.
 */
function forEachRenderPixel(
  renderW: number,
  renderH: number,
  sampler: WorldSampler,
  fn: (rx: number, ry: number, px: number, py: number, out: number) => void
): void {
  const scaleX = sampler.width / renderW;
  const scaleY = sampler.height / renderH;
  let out = 0;
  for (let ry = 0; ry < renderH; ry++) {
    const py = (ry + 0.5) * scaleY - 0.5;
    for (let rx = 0; rx < renderW; rx++) {
      const px = (rx + 0.5) * scaleX - 0.5;
      fn(rx, ry, px, py, out);
      out += 4;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
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

// ── Per-layer renderers ────────────────────────────────────────────────────

function colorFaultLines(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const v = Math.round(sampler.sampleFaultLines(px, py) * 255);
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  });
}

function colorContinentalSubRelief(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const scale = 1 / 0.35;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const t = Math.max(-1, Math.min(1, sampler.sampleContinentalSubRelief(px, py) * scale));
    if (t >= 0) {
      rgba[o] = Math.round(200 + t * 20);
      rgba[o + 1] = Math.round(200 + t * -140);
      rgba[o + 2] = Math.round(200 + t * -140);
    } else {
      const k = -t;
      rgba[o] = Math.round(200 - k * 140);
      rgba[o + 1] = Math.round(200 - k * 110);
      rgba[o + 2] = Math.round(200 + k * 20);
    }
    rgba[o + 3] = 255;
  });
}

function colorOceanAge(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const low: [number, number, number] = [180, 220, 255];
  const high: [number, number, number] = [5, 15, 40];
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const t = Math.max(0, Math.min(1, sampler.sampleOceanAge(px, py)));
    rgba[o] = Math.round(low[0] * (1 - t) + high[0] * t);
    rgba[o + 1] = Math.round(low[1] * (1 - t) + high[1] * t);
    rgba[o + 2] = Math.round(low[2] * (1 - t) + high[2] * t);
    rgba[o + 3] = 255;
  });
}

function colorElevation(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const seaLevel = sampler.seaLevel;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const raw = sampler.sampleElevation(px, py);
    if (raw < seaLevel) {
      const depth = mapToUnsignedRange(raw);
      rgba[o] = 0;
      rgba[o + 1] = Math.round(depth * 80);
      rgba[o + 2] = Math.round(100 + depth * 155);
    } else {
      const v = Math.round(mapToUnsignedRange(raw) * 255);
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
    }
    rgba[o + 3] = 255;
  });
}

const TEMP_DISPLAY_MIN_C = -40;
const TEMP_DISPLAY_MAX_C = 35;
const TEMP_STOPS: { t: number; rgb: [number, number, number] }[] = [
  { t: 0.0, rgb: [40, 40, 120] },
  { t: 0.25, rgb: [70, 150, 220] },
  { t: 0.45, rgb: [140, 210, 220] },
  { t: 0.6, rgb: [200, 230, 150] },
  { t: 0.75, rgb: [230, 180, 80] },
  { t: 0.9, rgb: [220, 90, 50] },
  { t: 1.0, rgb: [140, 20, 20] },
];

function colorTemperature(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const range = TEMP_DISPLAY_MAX_C - TEMP_DISPLAY_MIN_C;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const t = sampler.sampleTemperatureMean(px, py);
    const tNorm = Math.max(0, Math.min(1, (t - TEMP_DISPLAY_MIN_C) / range));
    let hi = 1;
    while (hi < TEMP_STOPS.length - 1 && TEMP_STOPS[hi].t < tNorm) hi++;
    const a = TEMP_STOPS[hi - 1];
    const b = TEMP_STOPS[hi];
    const span = b.t - a.t;
    const k = span > 0 ? (tNorm - a.t) / span : 0;
    rgba[o] = Math.round(a.rgb[0] * (1 - k) + b.rgb[0] * k);
    rgba[o + 1] = Math.round(a.rgb[1] * (1 - k) + b.rgb[1] * k);
    rgba[o + 2] = Math.round(a.rgb[2] * (1 - k) + b.rgb[2] * k);
    rgba[o + 3] = 255;
  });
}

function colorWind(
  rgba: Uint8Array,
  renderW: number,
  renderH: number,
  sampler: WorldSampler,
  source: Float32Array
): void {
  const tmp: [number, number] = [0, 0];
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    sampler.sampleWind(px, py, source, tmp);
    const dx = Math.max(-1, Math.min(1, tmp[0]));
    const dy = Math.max(-1, Math.min(1, tmp[1]));
    rgba[o] = Math.round(mapToUnsignedRange(dx) * 255);
    rgba[o + 1] = Math.round(mapToUnsignedRange(dy) * 255);
    rgba[o + 2] = 0;
    rgba[o + 3] = 255;
  });
}

const PRECIP_DISPLAY_MAX_MM = 3500;

function colorPrecipitation(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const inv = 1 / PRECIP_DISPLAY_MAX_MM;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const v = Math.round(Math.max(0, Math.min(1, sampler.samplePrecipAnnual(px, py) * inv)) * 255);
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  });
}

function colorSoilMoisture(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const seaLevel = sampler.seaLevel;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    if (sampler.sampleElevation(px, py) < seaLevel) {
      rgba[o] = 0;
      rgba[o + 1] = 30;
      rgba[o + 2] = 80;
      rgba[o + 3] = 255;
      return;
    }
    const t = Math.max(0, Math.min(1, sampler.sampleSoilMoisture(px, py)));
    rgba[o] = Math.round(190 * (1 - t) + 30 * t);
    rgba[o + 1] = Math.round(165 * (1 - t) + 110 * t);
    rgba[o + 2] = Math.round(110 * (1 - t) + 130 * t);
    rgba[o + 3] = 255;
  });
}

// Satellite-realistic palette indexed by Köppen class.
const KOPPEN_NATURAL: Record<KoppenClass, [number, number, number]> = {
  [KoppenClass.Af]: [30, 80, 35],
  [KoppenClass.Am]: [45, 100, 45],
  [KoppenClass.Aw]: [165, 145, 80],
  [KoppenClass.BWh]: [225, 200, 145],
  [KoppenClass.BWk]: [180, 165, 130],
  [KoppenClass.BSh]: [195, 170, 110],
  [KoppenClass.BSk]: [170, 160, 110],
  [KoppenClass.Cfa]: [80, 130, 65],
  [KoppenClass.Cfb]: [95, 145, 75],
  [KoppenClass.Csa]: [150, 145, 85],
  [KoppenClass.Csb]: [135, 140, 95],
  [KoppenClass.Cwa]: [90, 135, 70],
  [KoppenClass.Cwb]: [100, 145, 80],
  [KoppenClass.Dfa]: [80, 115, 60],
  [KoppenClass.Dfb]: [70, 105, 60],
  [KoppenClass.Dfc]: [70, 95, 65],
  [KoppenClass.Dwa]: [110, 130, 80],
  [KoppenClass.Dwb]: [85, 110, 70],
  [KoppenClass.Dsa]: [135, 130, 80],
  [KoppenClass.Dsb]: [115, 125, 85],
  [KoppenClass.ET]: [155, 155, 140],
  [KoppenClass.EF]: [240, 242, 245],
};

const SHALLOW_OCEAN: [number, number, number] = [60, 110, 165];
const DEEP_OCEAN: [number, number, number] = [10, 30, 75];
const COASTAL_SHELF: [number, number, number] = [80, 140, 180];
const LAKE_COLOR: [number, number, number] = [50, 95, 150];
const RIVER_COLOR: [number, number, number] = [70, 115, 165];
const ROCK_COLOR: [number, number, number] = [120, 110, 95];
const SNOW_COLOR: [number, number, number] = [248, 250, 252];
const MOUNTAIN_LEVEL = 0.85;
const SNOW_T_START_C = -2;
const SNOW_T_FULL_C = -20;
const SNOW_ELEVATION = 0.7;

/**
 * Biomes layer. Per render pixel: sample elevation, re-classify Köppen
 * from sampled climate inputs (so biome boundaries follow the bilinear-
 * smooth elevation rather than the nearest-physics-pixel staircase), then
 * apply hillshading. The Köppen reclassification is the user-confirmed
 * design choice from Phase A5 — biome boundaries deserve render-res
 * sharpness because they're the single most visually prominent feature.
 */
function colorBiomes(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const seaLevel = sampler.seaLevel;
  // Hillshade step in physics-pixel space: stays at 1 px regardless of
  // render upsampling so the gradient is computed in the same units as
  // the original. At renderRes > physicsRes this means the hillshade
  // varies smoothly with elevation rather than tracking render pixels.
  const stepPx = 1;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const e = sampler.sampleElevation(px, py);

    // Ocean.
    if (e < seaLevel) {
      const depth = (seaLevel - e) / Math.max(0.01, seaLevel + 1);
      const t = Math.min(1, depth * 2);
      let r: number;
      let g: number;
      let b: number;
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
      return;
    }

    // Inland water: lakes & rivers.
    const lake = sampler.sampleLake(px, py);
    const tMean = sampler.sampleTemperatureMean(px, py);
    if (lake === 1) {
      const iceK = Math.min(1, Math.max(0, (SNOW_T_START_C - tMean) / (SNOW_T_START_C - SNOW_T_FULL_C)));
      rgba[o] = Math.round(LAKE_COLOR[0] * (1 - iceK) + SNOW_COLOR[0] * iceK);
      rgba[o + 1] = Math.round(LAKE_COLOR[1] * (1 - iceK) + SNOW_COLOR[1] * iceK);
      rgba[o + 2] = Math.round(LAKE_COLOR[2] * (1 - iceK) + SNOW_COLOR[2] * iceK);
      rgba[o + 3] = 255;
      return;
    }

    // Re-classify Köppen at this render pixel using bilinear-sampled climate
    // inputs. Lets biome boundaries follow the smooth bilinear elevation /
    // temperature / precip fields rather than the nearest-physics-cell
    // staircase that the precomputed koppenClass array represents.
    const tSummer = sampler.sampleTemperatureSummer(px, py);
    const tWinter = sampler.sampleTemperatureWinter(px, py);
    const pSummer = sampler.samplePrecipSummer(px, py);
    const pWinter = sampler.samplePrecipWinter(px, py);
    const petAnnual = sampler.samplePetAnnual(px, py);
    const koppen = classifyKoppenAt(tSummer, tWinter, pSummer, pWinter, petAnnual, e, seaLevel);

    const riverIntensity = sampler.sampleRivers(px, py);
    if (riverIntensity > 0.5) {
      const baseColor = KOPPEN_NATURAL[koppen];
      const t = Math.min(1, (riverIntensity - 0.5) * 2);
      const r = baseColor[0] * (1 - t) + RIVER_COLOR[0] * t;
      const g = baseColor[1] * (1 - t) + RIVER_COLOR[1] * t;
      const b = baseColor[2] * (1 - t) + RIVER_COLOR[2] * t;
      const shade = sampler.sampleHillshade(px, py, stepPx);
      rgba[o] = Math.min(255, Math.round(r * shade));
      rgba[o + 1] = Math.min(255, Math.round(g * shade));
      rgba[o + 2] = Math.min(255, Math.round(b * shade));
      rgba[o + 3] = 255;
      return;
    }

    // Köppen-natural land color, then rock blend at high elevation, then snow.
    let cr = KOPPEN_NATURAL[koppen][0];
    let cg = KOPPEN_NATURAL[koppen][1];
    let cb = KOPPEN_NATURAL[koppen][2];

    if (e > MOUNTAIN_LEVEL) {
      const k = Math.min(1, (e - MOUNTAIN_LEVEL) / (1 - MOUNTAIN_LEVEL));
      cr = cr * (1 - k) + ROCK_COLOR[0] * k;
      cg = cg * (1 - k) + ROCK_COLOR[1] * k;
      cb = cb * (1 - k) + ROCK_COLOR[2] * k;
    }

    const snowChance =
      Math.max(0, (SNOW_T_START_C - tMean) / (SNOW_T_START_C - SNOW_T_FULL_C)) +
      Math.max(0, (e - SNOW_ELEVATION) / (1 - SNOW_ELEVATION)) * 0.6;
    if (snowChance > 0) {
      const k = Math.min(1, snowChance);
      cr = cr * (1 - k) + SNOW_COLOR[0] * k;
      cg = cg * (1 - k) + SNOW_COLOR[1] * k;
      cb = cb * (1 - k) + SNOW_COLOR[2] * k;
    }

    const shade = sampler.sampleHillshade(px, py, stepPx);
    rgba[o] = Math.min(255, Math.round(cr * shade));
    rgba[o + 1] = Math.min(255, Math.round(cg * shade));
    rgba[o + 2] = Math.min(255, Math.round(cb * shade));
    rgba[o + 3] = 255;
  });
}

function colorFlowAccumulation(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const seaLevel = sampler.seaLevel;
  const LOG_CAP = 18;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    if (sampler.sampleElevation(px, py) < seaLevel) {
      rgba[o] = 10;
      rgba[o + 1] = 20;
      rgba[o + 2] = 60;
      rgba[o + 3] = 255;
      return;
    }
    const v = Math.min(Math.log2(1 + sampler.sampleFlowAccumulation(px, py)) / LOG_CAP, 1);
    rgba[o] = Math.round((1 - v) * 80 + v * 120);
    rgba[o + 1] = Math.round((1 - v) * 60 + v * 220);
    rgba[o + 2] = Math.round((1 - v) * 30 + v * 255);
    rgba[o + 3] = 255;
  });
}

function colorRivers(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const seaLevel = sampler.seaLevel;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const e = sampler.sampleElevation(px, py);
    if (e < seaLevel) {
      const depth = mapToUnsignedRange(e);
      rgba[o] = 0;
      rgba[o + 1] = Math.round(depth * 80);
      rgba[o + 2] = Math.round(100 + depth * 155);
      rgba[o + 3] = 255;
      return;
    }
    const base = Math.round(mapToUnsignedRange(e) * 255);
    const t = sampler.sampleRivers(px, py);
    const RIVER_R = 40;
    const RIVER_G = 120;
    const RIVER_B = 220;
    rgba[o] = Math.round(base * (1 - t) + RIVER_R * t);
    rgba[o + 1] = Math.round(base * (1 - t) + RIVER_G * t);
    rgba[o + 2] = Math.round(base * (1 - t) + RIVER_B * t);
    rgba[o + 3] = 255;
  });
}

function colorLakes(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const seaLevel = sampler.seaLevel;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const e = sampler.sampleElevation(px, py);
    if (e < seaLevel) {
      const depth = mapToUnsignedRange(e);
      rgba[o] = 0;
      rgba[o + 1] = Math.round(depth * 80);
      rgba[o + 2] = Math.round(100 + depth * 155);
      rgba[o + 3] = 255;
      return;
    }
    if (sampler.sampleLake(px, py) === 1) {
      rgba[o] = 30;
      rgba[o + 1] = 90;
      rgba[o + 2] = 200;
    } else {
      const v = Math.round(mapToUnsignedRange(e) * 255);
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
    }
    rgba[o + 3] = 255;
  });
}

const ARIDITY_DISPLAY_CEILING = 1.5;

function colorAridity(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const seaLevel = sampler.seaLevel;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    if (sampler.sampleElevation(px, py) < seaLevel) {
      rgba[o] = 0;
      rgba[o + 1] = 30;
      rgba[o + 2] = 80;
      rgba[o + 3] = 255;
      return;
    }
    const v = Math.min(sampler.sampleAridityIndex(px, py) / ARIDITY_DISPLAY_CEILING, 1);
    rgba[o] = Math.round((1 - v) * 200 + v * 30);
    rgba[o + 1] = Math.round((1 - v) * 150 + v * 140);
    rgba[o + 2] = Math.round((1 - v) * 80 + v * 60);
    rgba[o + 3] = 255;
  });
}

function colorMaskedScalar(
  rgba: Uint8Array,
  renderW: number,
  renderH: number,
  sampler: WorldSampler,
  sample: (px: number, py: number) => number,
  low: [number, number, number],
  high: [number, number, number]
): void {
  const seaLevel = sampler.seaLevel;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    if (sampler.sampleElevation(px, py) < seaLevel) {
      rgba[o] = 0;
      rgba[o + 1] = 30;
      rgba[o + 2] = 80;
      rgba[o + 3] = 255;
      return;
    }
    const t = Math.max(0, Math.min(1, sample(px, py)));
    rgba[o] = Math.round(low[0] * (1 - t) + high[0] * t);
    rgba[o + 1] = Math.round(low[1] * (1 - t) + high[1] * t);
    rgba[o + 2] = Math.round(low[2] * (1 - t) + high[2] * t);
    rgba[o + 3] = 255;
  });
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

function colorKoppen(rgba: Uint8Array, renderW: number, renderH: number, sampler: WorldSampler): void {
  const seaLevel = sampler.seaLevel;
  forEachRenderPixel(renderW, renderH, sampler, (_rx, _ry, px, py, o) => {
    const e = sampler.sampleElevation(px, py);
    if (e < seaLevel) {
      const depth = mapToUnsignedRange(e);
      rgba[o] = 0;
      rgba[o + 1] = Math.round(depth * 80);
      rgba[o + 2] = Math.round(100 + depth * 155);
      rgba[o + 3] = 255;
      return;
    }
    // Re-classify per render pixel to inherit bilinear smoothness in the
    // climate inputs.
    const tSummer = sampler.sampleTemperatureSummer(px, py);
    const tWinter = sampler.sampleTemperatureWinter(px, py);
    const pSummer = sampler.samplePrecipSummer(px, py);
    const pWinter = sampler.samplePrecipWinter(px, py);
    const petAnnual = sampler.samplePetAnnual(px, py);
    const k = classifyKoppenAt(tSummer, tWinter, pSummer, pWinter, petAnnual, e, seaLevel);
    const color = KOPPEN_COLORS[k] ?? [255, 0, 255];
    rgba[o] = color[0];
    rgba[o + 1] = color[1];
    rgba[o + 2] = color[2];
    rgba[o + 3] = 255;
  });
}

// Re-export for callers that still want the BIOME_COLORS / KoppenClass enum
// off color-maps.
export { KOPPEN_NATURAL, KOPPEN_COLORS };

// Avoid an unused import warning while keeping BoundaryInfo available for
// downstream consumers who import from this module.
export type { BoundaryInfo, WorldData };
