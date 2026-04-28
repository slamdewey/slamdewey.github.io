/**
 * Shared types for the tectonics stage. Only the public surface (PlateType,
 * BoundaryType, TectonicResult) is re-exported from `./index`; everything
 * else is internal to the stage.
 */

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
  dx: number;
  dy: number;
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
  /** Shared boundary length in pixels. */
  length: number;
  typeA: PlateType;
  typeB: PlateType;
  /** Index of the plate that subducts (-1 if not applicable). */
  subductingPlate: number;
}

export interface TectonicResult {
  baseElevation: Float32Array;
  faults: Float32Array;
  mountainRanges: Float32Array;
  plateMap: Int32Array;
  plates: PlateProperties[];
  boundaries: BoundaryInfo[];
  /** Signed intra-continental perturbation (positive = swell, negative = basin). */
  continentalSubRelief: Float32Array;
  /** Pixel distance to nearest ridge/rift seed (Chamfer). Feeds the ocean age gradient. */
  distToRidge: Float32Array;
  /** distToRidge normalized to [0, 1] (1 = farthest abyssal plain from any ridge). */
  oceanAge: Float32Array;
}

/** Internal: 2D pixel-space centroid of a plate. */
export interface PlateCentroid {
  x: number;
  y: number;
}
