/**
 * Shared types for the tectonics stage. Only the public surface (PlateType,
 * BoundaryType, TectonicResult) is re-exported from `./index`; everything
 * else is internal to the stage.
 */

import { type Vec3 } from '@lib/voronoi-sphere';

export enum PlateType {
  Continental,
  Oceanic,
}

export enum BoundaryType {
  Convergent,
  Divergent,
  Transform,
}

export enum InteractionType {
  Collision, // cont-cont convergent (Himalayas)
  Subduction, // ocean-cont convergent (Andes)
  OceanicConvergence, // ocean-ocean convergent (Mariana Trench)
  ContinentalRift, // cont divergent (East Africa)
  OceanicRidge, // ocean-ocean divergent (Mid-Atlantic Ridge)
  Transform, // any transform (San Andreas)
}

export interface PlateProperties {
  index: number;
  type: PlateType;
  /**
   * Euler rotation vector for the plate's rigid-body motion on the unit sphere.
   * Direction is the Euler pole; magnitude is angular speed (arbitrary units —
   * intensities are normalized later). Surface velocity at any point r̂ on the
   * plate is `omega × r̂`, a tangent-plane vector regardless of latitude. This
   * replaces the legacy 2D pixel-space (dx, dy) drift, which biased
   * convergence classification at high latitudes.
   */
  omega: [number, number, number];
  /** Normalized lithospheric thickness [0, 1]. Continental ~0.55–0.85, Oceanic ~0.1–0.35. */
  thickness: number;
  /** Normalized crustal density [0, 1]. Continental ~0.2–0.4, Oceanic ~0.55–0.85 (higher = older). */
  density: number;
  /** Isostatic equilibrium base elevation, derived from thickness & density. */
  baseElevation: number;
}

export interface BoundaryInfo {
  plateA: number;
  plateB: number;
  type: BoundaryType;
  interactionType: InteractionType;
  /** Relative velocity magnitude, normalized to [0, 1] across all edges. */
  intensity: number;
  /** Shared boundary length as great-circle arc length (radians), summed over
   * the pair's Voronoi edges. (Was a pixel count under the legacy raster graph.) */
  length: number;
  typeA: PlateType;
  typeB: PlateType;
  /** Index of the plate that subducts (-1 if not applicable). */
  subductingPlate: number;
}

/**
 * Pre-calculated vector geometry of a plate-pair boundary. Index-aligned with
 * the matching `BoundaryInfo` in `TectonicResult.boundaries`. This is the
 * structured "geometry channel" the rewire exposes — boundary arcs as real
 * unit-vector polylines, available to downstream / future simulation stages
 * without re-deriving them from the pixel `plateMap`.
 */
export interface BoundaryArc {
  plateA: number;
  plateB: number;
  /** One or more chained great-circle polylines (unit vectors). More than one
   * when triple junctions split the plate-pair boundary into disjoint runs. */
  segments: Vec3[][];
  /** Parallel to `segments`: whether each polyline is a closed loop. */
  isClosed: boolean[];
}

export interface TectonicResult {
  baseElevation: Float32Array;
  faults: Float32Array;
  /** Per-pixel InteractionType of the dominant boundary fault (255 = none).
   *  Drives the type-colored Faults layer. */
  faultType: Uint8Array;
  mountainRanges: Float32Array;
  plateMap: Int32Array;
  plates: PlateProperties[];
  boundaries: BoundaryInfo[];
  /** Plate → sorted neighbor-plate list (from the pre-calculated Voronoi edges). */
  plateAdjacency: number[][];
  /** Per-boundary vector arc geometry, index-aligned with `boundaries`. */
  boundaryArcs: BoundaryArc[];
  /** Signed intra-continental perturbation (positive = swell, negative = basin). */
  continentalSubRelief: Float32Array;
  /** Pixel distance to nearest ridge/rift seed (Chamfer). Feeds the ocean age gradient. */
  distToRidge: Float32Array;
  /** distToRidge normalized to [0, 1] (1 = farthest abyssal plain from any ridge). */
  oceanAge: Float32Array;
  /** Geomorphology: volcanic island-arc intensity [0, 1] stamped on the
   *  overriding plate alongside oceanic subduction boundaries. */
  volcanicArcs: Float32Array;
  /** Geomorphology: rift-floor membership [0, 1] along continental rifts.
   *  Consumed by hydrology to bias rift-lake formation. */
  riftFloorMask: Float32Array;
}

/**
 * Internal: plate centroid in both representations.
 *
 * `x, y` is the equirect pixel projection (used by the cylindrical seed-placement
 * helpers). `r` is the unit-vector centroid on the sphere (used by Phase-A
 * boundary classification, which evaluates Euler-pole velocities at midpoints
 * without going through pixel space).
 */
export interface PlateCentroid {
  x: number;
  y: number;
  r: [number, number, number];
}
