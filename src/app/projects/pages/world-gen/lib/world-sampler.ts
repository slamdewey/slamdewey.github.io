/**
 * WorldSampler — read any pipeline output at any (lon, lat) position,
 * independent of the physics grid resolution.
 *
 * Phase A5 of the spherical-math plan: the worker runs the physics pipeline
 * at `physicsRes` (width × height), producing Float32/Uint8 arrays. The
 * renderer wants those values at a higher `renderRes` for crisp layer
 * images. This sampler is the bridge: it bilinear-samples smooth physics
 * fields (elevation, climate) and nearest-samples categorical fields
 * (Köppen class, lakes, plate id).
 *
 * For now it's a pure resolution decoupler — bilinear of pixel-quantized
 * sharp features (coastlines, mountain belts) is *blurred* rather than
 * staircased, which is already a substantial visual win. A follow-up phase
 * can add analytical-polyline refinements that snap sharp features back
 * to sub-pixel polyline geometry. The class's method signatures are
 * chosen so that refinement can be added without changing call sites.
 */

import { mod } from '@lib/math';
import { type WorldData } from './types';
import { KoppenClass } from './stages/climate/koppen';
import { ELEV_RELIEF_REFERENCE_M } from './stages/terrain-levels';

/** Hillshade slope gain. Elevation is in meters, so the neighbor difference is
 *  normalized by the reference relief to keep the legacy gain of 2 (tuned for a
 *  dimensionless [-1, 1] field) and the [0.6, 1.3] output clamp calibrated. */
const HILLSHADE_GAIN = 2 / ELEV_RELIEF_REFERENCE_M;

/**
 * Map a render pixel index (rx, ry) at render resolution (rw, rh) to physics
 * pixel space (px ∈ [0, physicsW), py ∈ [0, physicsH-1]). Adds 0.5 to
 * center on the render pixel, then scales. Returned px wraps in longitude;
 * py is unconstrained here (caller clamps).
 */
function renderToPhysics(rx: number, ry: number, rw: number, rh: number, pw: number, ph: number): [number, number] {
  return [((rx + 0.5) / rw) * pw - 0.5, ((ry + 0.5) / rh) * ph - 0.5];
}

export class WorldSampler {
  readonly width: number;
  readonly height: number;

  constructor(private readonly world: WorldData) {
    this.width = world.width;
    this.height = world.height;
  }

  /**
   * Sea level threshold — needed by every consumer that distinguishes land
   * from water, so it's exposed directly rather than going through a sample.
   */
  get seaLevel(): number {
    return this.world.seaLevel;
  }

  /**
   * Whole-world `WorldData` accessor — exposed so debug consumers (plate-id
   * coloring, hillshade tables) can fall back to physics-res reads when they
   * don't yet have an analytical version.
   */
  get raw(): WorldData {
    return this.world;
  }

  /**
   * Bilinear sample of a scalar Float32 field at *physics-pixel* coordinates
   * (fractional px, py). Longitude wraps in x; y is clamped to `[0, H-1]`
   * (the pole rows are single geometric points so clamping is correct).
   */
  bilinearF32(field: Float32Array, px: number, py: number): number {
    const W = this.width;
    const H = this.height;
    let py0 = Math.floor(py);
    let py1 = py0 + 1;
    let ty = py - py0;
    if (py0 < 0) {
      py0 = 0;
      py1 = 0;
      ty = 0;
    } else if (py1 >= H) {
      py0 = H - 1;
      py1 = H - 1;
      ty = 0;
    }
    const px0 = mod(Math.floor(px), W);
    const px1 = mod(px0 + 1, W);
    const tx = px - Math.floor(px);
    const a = field[py0 * W + px0];
    const b = field[py0 * W + px1];
    const c = field[py1 * W + px0];
    const d = field[py1 * W + px1];
    const ab = a * (1 - tx) + b * tx;
    const cd = c * (1 - tx) + d * tx;
    return ab * (1 - ty) + cd * ty;
  }

  /**
   * Nearest-neighbor sample of a categorical Uint8 field. Used for Köppen,
   * lakes, plateId — values that can't be interpolated.
   */
  nearestU8(field: Uint8Array, px: number, py: number): number {
    const W = this.width;
    const H = this.height;
    const ix = mod(Math.round(px), W);
    const iy = Math.max(0, Math.min(H - 1, Math.round(py)));
    return field[iy * W + ix];
  }

  /**
   * Nearest-neighbor sample of a categorical Int32 field. Plate id is the
   * only consumer at the moment.
   */
  nearestI32(field: Int32Array, px: number, py: number): number {
    const W = this.width;
    const H = this.height;
    const ix = mod(Math.round(px), W);
    const iy = Math.max(0, Math.min(H - 1, Math.round(py)));
    return field[iy * W + ix];
  }

  // ── Convenience field samplers ────────────────────────────────────────
  // Each takes physics-pixel coordinates. Callers that work in render-pixel
  // coordinates use `renderToPhysicsCoord` first.

  sampleElevation(px: number, py: number): number {
    return this.bilinearF32(this.world.elevation, px, py);
  }

  sampleTemperatureMean(px: number, py: number): number {
    return this.bilinearF32(this.world.temperatureMean, px, py);
  }

  sampleTemperatureSummer(px: number, py: number): number {
    return this.bilinearF32(this.world.temperatureSummer, px, py);
  }

  sampleTemperatureWinter(px: number, py: number): number {
    return this.bilinearF32(this.world.temperatureWinter, px, py);
  }

  samplePrecipAnnual(px: number, py: number): number {
    return this.bilinearF32(this.world.precipAnnual, px, py);
  }

  samplePrecipSummer(px: number, py: number): number {
    return this.bilinearF32(this.world.precipSummer, px, py);
  }

  samplePrecipWinter(px: number, py: number): number {
    return this.bilinearF32(this.world.precipWinter, px, py);
  }

  samplePetAnnual(px: number, py: number): number {
    return this.bilinearF32(this.world.petAnnual, px, py);
  }

  sampleAridityIndex(px: number, py: number): number {
    return this.bilinearF32(this.world.aridityIndex, px, py);
  }

  sampleSeasonality(px: number, py: number): number {
    return this.bilinearF32(this.world.seasonality, px, py);
  }

  sampleGrowingSeason(px: number, py: number): number {
    return this.bilinearF32(this.world.growingSeason, px, py);
  }

  sampleSoilMoisture(px: number, py: number): number {
    return this.bilinearF32(this.world.soilMoisture, px, py);
  }

  sampleFaultLines(px: number, py: number): number {
    return this.bilinearF32(this.world.faultLines, px, py);
  }

  /** Nearest (categorical) InteractionType of the dominant fault, 255 = none. */
  sampleFaultType(px: number, py: number): number {
    return this.nearestU8(this.world.faultType, px, py);
  }

  sampleContinentalSubRelief(px: number, py: number): number {
    return this.bilinearF32(this.world.continentalSubRelief, px, py);
  }

  sampleOceanAge(px: number, py: number): number {
    return this.bilinearF32(this.world.oceanAge, px, py);
  }

  sampleRivers(px: number, py: number): number {
    return this.bilinearF32(this.world.rivers, px, py);
  }

  sampleFlowAccumulation(px: number, py: number): number {
    return this.bilinearF32(this.world.flowAccumulation, px, py);
  }

  /** Wind is stored interleaved [dx, dy]. Returned as [dx, dy] components. */
  sampleWind(px: number, py: number, source: Float32Array, out: [number, number]): [number, number] {
    const W = this.width;
    const H = this.height;
    let py0 = Math.floor(py);
    let py1 = py0 + 1;
    let ty = py - py0;
    if (py0 < 0) {
      py0 = 0;
      py1 = 0;
      ty = 0;
    } else if (py1 >= H) {
      py0 = H - 1;
      py1 = H - 1;
      ty = 0;
    }
    const px0 = mod(Math.floor(px), W);
    const px1 = mod(px0 + 1, W);
    const tx = px - Math.floor(px);
    const o00 = (py0 * W + px0) * 2;
    const o01 = (py0 * W + px1) * 2;
    const o10 = (py1 * W + px0) * 2;
    const o11 = (py1 * W + px1) * 2;
    const dx =
      (source[o00] * (1 - tx) + source[o01] * tx) * (1 - ty) + (source[o10] * (1 - tx) + source[o11] * tx) * ty;
    const dy =
      (source[o00 + 1] * (1 - tx) + source[o01 + 1] * tx) * (1 - ty) +
      (source[o10 + 1] * (1 - tx) + source[o11 + 1] * tx) * ty;
    out[0] = dx;
    out[1] = dy;
    return out;
  }

  sampleKoppen(px: number, py: number): KoppenClass {
    return this.nearestU8(this.world.koppenClass, px, py) as KoppenClass;
  }

  sampleLake(px: number, py: number): number {
    return this.nearestU8(this.world.lakes, px, py);
  }

  samplePlate(px: number, py: number): number {
    return this.nearestI32(this.world.plateMap, px, py);
  }

  /**
   * Map render-pixel coordinates (rx, ry) at render-res (rw, rh) to physics-
   * pixel coordinates. Pure utility — exposed so callers can take it out of
   * a hot loop and amortize the divides.
   */
  renderToPhysicsCoord(rx: number, ry: number, rw: number, rh: number, out: [number, number]): [number, number] {
    const [px, py] = renderToPhysics(rx, ry, rw, rh, this.width, this.height);
    out[0] = px;
    out[1] = py;
    return out;
  }

  /**
   * Compute hillshade at a render pixel by sampling elevation at four
   * neighbors. Render-res-aware: the step size in physics-pixel space is
   * `physicsW / renderW`, so the gradient is computed in physics-pixel
   * units regardless of how much we're upsampling. Returns a multiplier
   * in [0.6, 1.3] matching the legacy `computeHillshade`.
   */
  sampleHillshade(px: number, py: number, stepPx: number): number {
    const left = this.sampleElevation(px - stepPx, py);
    const right = this.sampleElevation(px + stepPx, py);
    const up = this.sampleElevation(px, py - stepPx);
    const down = this.sampleElevation(px, py + stepPx);
    const dx = right - left;
    const dy = down - up;
    const s = 1 + (-dx - dy) * HILLSHADE_GAIN;
    return Math.max(0.6, Math.min(1.3, s));
  }
}
