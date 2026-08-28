/**
 * Geomorphology sub-stage — turns the pre-calculated tectonic vector geometry
 * (`boundaryArcs` + `plates`/`boundaries`) into geomorphic features that the
 * raster passes don't produce:
 *
 *   - **Volcanic island arcs** along ocean–ocean convergence: the boundary arc
 *     is offset toward the overriding (non-subducting) plate by an arc–trench
 *     gap and stamped as a chain of islands (1-D noise breaks the ridge into
 *     discrete islands).
 *   - **Continental rift valleys**: horst shoulders offset to either side of a
 *     `ContinentalRift` axis, plus a `riftFloorMask` band along the axis that
 *     the hydrology stage uses to bias rift-lake formation.
 *
 * Runs after `rasterizePlateInteractions` and MUTATES `baseElevation` /
 * `mountainRanges` in place, so the downstream `elevation.ts` warp+fBm and
 * `post-processing.ts` mountain boost pick the features up exactly like the
 * collision/subduction relief already stamped by the raster passes.
 *
 * All geometry is done in unit-vector (sphere) space and projected to the
 * equirectangular grid (row 0 = north pole; wraps in longitude), matching the
 * convention in `voronoi-sphere.ts` / `boundary-polylines.ts`.
 */

import { OpenSimplexNoise } from '@lib/noise';
import { mod } from '@lib/math';
import { arcLength, slerp } from '@lib/voronoi-edges';
import { type Vec3 } from '@lib/voronoi-sphere';
import { NoiseVariables, TectonicVariables } from '../../types';
import { BoundaryArc, BoundaryInfo, InteractionType, PlateProperties, PlateType } from './types';

const TWO_PI = Math.PI * 2;
const RIFT_FLOOR_DEEPEN = 0.06; // modest extra graben deepening (atop the rift interactionElevation)
const ISLAND_NOISE_FREQ = 6.0; // along-arc gap frequency for volcanic island chains

export interface GeomorphologyResult {
  volcanicArcs: Float32Array;
  riftFloorMask: Float32Array;
}

export function applyGeomorphology(
  baseElevation: Float32Array,
  mountainRanges: Float32Array,
  plateMap: Int32Array,
  plates: PlateProperties[],
  boundaries: BoundaryInfo[],
  boundaryArcs: BoundaryArc[],
  width: number,
  height: number,
  nv: NoiseVariables,
  tv: TectonicVariables
): GeomorphologyResult {
  const size = width * height;
  const volcanicArcs = new Float32Array(size);
  const riftFloorMask = new Float32Array(size);

  const baseFalloff = Math.max(4, Math.round(width / 64));
  const radToEqPx = width / TWO_PI;
  const pixelsPerRad = radToEqPx; // for slerp subdivision density (~1 px/sample)
  const islandNoise = new OpenSimplexNoise((nv.seed ^ 0x150a7d15) | 0);

  const gapRad = (tv.volcanicArcGap * baseFalloff) / radToEqPx;
  const shoulderRad = (tv.riftShoulderDist * baseFalloff) / radToEqPx;
  const islandRadPx = baseFalloff;
  const shoulderRadPx = baseFalloff;
  const floorRadPx = tv.riftFloorWidth * baseFalloff;

  for (let i = 0; i < boundaryArcs.length; i++) {
    const b = boundaries[i];
    const arc = boundaryArcs[i];
    if (!arc || arc.segments.length === 0) continue;

    if (b.interactionType === InteractionType.OceanicConvergence && tv.volcanicArcGap > 0) {
      // Island arc on the overriding (non-subducting) oceanic plate.
      const overriding = b.subductingPlate === b.plateA ? b.plateB : b.plateA;
      for (const seg of arc.segments) {
        const dense = densify(seg, pixelsPerRad);
        const offset = offsetPolyline(dense, gapRad, overriding, plateMap, width, height);
        // Stamp a normalized [0, 1] island intensity; volcanicArcStrength is
        // applied once when folding into baseElevation below.
        stampIslands(offset, volcanicArcs, islandRadPx, overriding, plateMap, width, height, islandNoise);
      }
    } else if (b.interactionType === InteractionType.ContinentalRift) {
      for (const seg of arc.segments) {
        const dense = densify(seg, pixelsPerRad);
        // Rift-floor band along the axis (no plate restriction — the floor
        // straddles the boundary). Feeds the hydrology lake bias.
        stampMask(dense, riftFloorMask, floorRadPx, 1, width, height);
        // Horst shoulders offset to both sides, restricted to continental crust.
        if (tv.riftShoulderDist > 0 && tv.riftShoulderHeight > 0) {
          const left = offsetFixedSide(dense, +shoulderRad);
          const right = offsetFixedSide(dense, -shoulderRad);
          stampShoulder(left, baseElevation, mountainRanges, shoulderRadPx, tv.riftShoulderHeight, plates, plateMap, width, height); // prettier-ignore
          stampShoulder(right, baseElevation, mountainRanges, shoulderRadPx, tv.riftShoulderHeight, plates, plateMap, width, height); // prettier-ignore
        }
      }
    }
  }

  // Fold volcanic-arc intensity into the terrain: lift oceanic crust toward/above
  // sea level and feed the post-processing mountain boost.
  for (let i = 0; i < size; i++) {
    const va = volcanicArcs[i];
    if (va > 0) {
      baseElevation[i] += tv.volcanicArcStrength * va;
      const mr = va * 0.5;
      if (mr > mountainRanges[i]) mountainRanges[i] = mr;
    }
    const rf = riftFloorMask[i];
    if (rf > 0) baseElevation[i] -= RIFT_FLOOR_DEEPEN * rf;
  }

  return { volcanicArcs, riftFloorMask };
}

// ── geometry helpers ───────────────────────────────────────────────────────

function normalize(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function projectPx(v: Vec3, width: number, height: number): { px: number; py: number } {
  const z = v.z < -1 ? -1 : v.z > 1 ? 1 : v.z;
  const lat = Math.asin(z);
  const lon = Math.atan2(v.y, v.x);
  return { px: ((lon + Math.PI) / TWO_PI) * width, py: ((Math.PI / 2 - lat) / Math.PI) * height };
}

function plateAtVec(v: Vec3, plateMap: Int32Array, width: number, height: number): number {
  const { px, py } = projectPx(v, width, height);
  let iy = Math.floor(py);
  if (iy < 0) iy = 0;
  else if (iy >= height) iy = height - 1;
  const ix = mod(Math.floor(px), width);
  return plateMap[iy * width + ix];
}

/** Slerp-subdivide a polyline to ~1 px between samples. */
function densify(seg: Vec3[], pixelsPerRad: number): Vec3[] {
  if (seg.length < 2) return seg.slice();
  const out: Vec3[] = [];
  for (let i = 0; i < seg.length - 1; i++) {
    const a = seg[i];
    const b = seg[i + 1];
    const steps = Math.max(1, Math.ceil(arcLength(a, b) * pixelsPerRad));
    for (let k = 0; k < steps; k++) out.push(k === 0 ? a : slerp(a, b, k / steps));
  }
  out.push(seg[seg.length - 1]);
  return out;
}

/** In-surface unit normal at sample i of a dense polyline (t × v). */
function normalAt(dense: Vec3[], i: number): Vec3 {
  const v = dense[i];
  const prev = dense[Math.max(0, i - 1)];
  const next = dense[Math.min(dense.length - 1, i + 1)];
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const tz = next.z - prev.z;
  // n = t × v
  return normalize(ty * v.z - tz * v.y, tz * v.x - tx * v.z, tx * v.y - ty * v.x);
}

/** Offset each sample toward `towardPlate` by `gapRad`, picking the ± normal
 *  side whose offset lands on the target plate (falls back to +n). */
function offsetPolyline(
  dense: Vec3[],
  gapRad: number,
  towardPlate: number,
  plateMap: Int32Array,
  width: number,
  height: number
): Vec3[] {
  const c = Math.cos(gapRad);
  const s = Math.sin(gapRad);
  const out: Vec3[] = new Array(dense.length);
  for (let i = 0; i < dense.length; i++) {
    const v = dense[i];
    const n = normalAt(dense, i);
    const plus = normalize(v.x * c + n.x * s, v.y * c + n.y * s, v.z * c + n.z * s);
    if (plateAtVec(plus, plateMap, width, height) === towardPlate) {
      out[i] = plus;
      continue;
    }
    const minus = normalize(v.x * c - n.x * s, v.y * c - n.y * s, v.z * c - n.z * s);
    out[i] = plateAtVec(minus, plateMap, width, height) === towardPlate ? minus : plus;
  }
  return out;
}

/** Offset each sample to a fixed normal side (sign of gapRad), no plate test. */
function offsetFixedSide(dense: Vec3[], gapRad: number): Vec3[] {
  const c = Math.cos(Math.abs(gapRad));
  const s = Math.sin(Math.abs(gapRad)) * Math.sign(gapRad);
  const out: Vec3[] = new Array(dense.length);
  for (let i = 0; i < dense.length; i++) {
    const v = dense[i];
    const n = normalAt(dense, i);
    out[i] = normalize(v.x * c + n.x * s, v.y * c + n.y * s, v.z * c + n.z * s);
  }
  return out;
}

// ── stamping ───────────────────────────────────────────────────────────────

/** Quadratic-falloff disk stamp, max-combined, with cos(lat) x-correction so
 *  the footprint stays round on the sphere. Optional plate restriction. */
function stampDisk(
  target: Float32Array,
  px: number,
  py: number,
  radPx: number,
  value: number,
  width: number,
  height: number,
  restrictPlate: number,
  plateMap: Int32Array
): void {
  if (value <= 0) return;
  const iy0 = Math.max(0, Math.floor(py - radPx));
  const iy1 = Math.min(height - 1, Math.ceil(py + radPx));
  for (let iy = iy0; iy <= iy1; iy++) {
    const lat = Math.PI / 2 - ((iy + 0.5) / height) * Math.PI;
    const cosLat = Math.max(0.15, Math.cos(lat));
    const radX = radPx / cosLat;
    const ixStart = Math.floor(px - radX);
    const ixEnd = Math.ceil(px + radX);
    const dy = iy + 0.5 - py;
    for (let ixx = ixStart; ixx <= ixEnd; ixx++) {
      const dx = (ixx + 0.5 - px) * cosLat;
      const dist = Math.hypot(dx, dy);
      if (dist > radPx) continue;
      const ix = mod(ixx, width);
      const idx = iy * width + ix;
      if (restrictPlate >= 0 && plateMap[idx] !== restrictPlate) continue;
      const fall = 1 - dist / radPx;
      const v = value * fall * fall;
      if (v > target[idx]) target[idx] = v;
    }
  }
}

/** Stamp a chain of islands: per-sample peak is gated by a 1-D noise of the
 *  sample position so the offset ridge breaks into discrete islands. */
function stampIslands(
  poly: Vec3[],
  target: Float32Array,
  radPx: number,
  restrictPlate: number,
  plateMap: Int32Array,
  width: number,
  height: number,
  noise: OpenSimplexNoise
): void {
  for (const v of poly) {
    const g = noise.eval3D(v.x * ISLAND_NOISE_FREQ, v.y * ISLAND_NOISE_FREQ, v.z * ISLAND_NOISE_FREQ);
    const gate = g > 0 ? g : 0; // ~half the arc is open water
    if (gate <= 0) continue;
    const { px, py } = projectPx(v, width, height);
    stampDisk(target, px, py, radPx, gate, width, height, restrictPlate, plateMap);
  }
}

/** Stamp a continuous mask band along a polyline (no plate restriction). */
function stampMask(
  poly: Vec3[],
  target: Float32Array,
  radPx: number,
  value: number,
  width: number,
  height: number
): void {
  for (const v of poly) {
    const { px, py } = projectPx(v, width, height);
    stampDisk(target, px, py, radPx, value, width, height, -1, plateMapNone);
  }
}

/** Rift horst shoulder: add uplift to baseElevation (and feed mountainRanges)
 *  on continental crust only. */
function stampShoulder(
  poly: Vec3[],
  baseElevation: Float32Array,
  mountainRanges: Float32Array,
  radPx: number,
  height_: number,
  plates: PlateProperties[],
  plateMap: Int32Array,
  width: number,
  height: number
): void {
  for (const v of poly) {
    const { px, py } = projectPx(v, width, height);
    const iy0 = Math.max(0, Math.floor(py - radPx));
    const iy1 = Math.min(height - 1, Math.ceil(py + radPx));
    for (let iy = iy0; iy <= iy1; iy++) {
      const lat = Math.PI / 2 - ((iy + 0.5) / height) * Math.PI;
      const cosLat = Math.max(0.15, Math.cos(lat));
      const radX = radPx / cosLat;
      const dy = iy + 0.5 - py;
      for (let ixx = Math.floor(px - radX); ixx <= Math.ceil(px + radX); ixx++) {
        const dx = (ixx + 0.5 - px) * cosLat;
        const dist = Math.hypot(dx, dy);
        if (dist > radPx) continue;
        const ix = mod(ixx, width);
        const idx = iy * width + ix;
        if (plates[plateMap[idx]]?.type !== PlateType.Continental) continue;
        const fall = 1 - dist / radPx;
        const lift = height_ * fall * fall;
        baseElevation[idx] += lift;
        const mr = (lift / Math.max(1e-6, height_)) * 0.4;
        if (mr > mountainRanges[idx]) mountainRanges[idx] = mr;
      }
    }
  }
}

// Sentinel passed to stampDisk when no plate restriction is wanted; never read
// because restrictPlate is -1 in that path.
const plateMapNone = new Int32Array(0);
