import { type SphereEdge, arcLength } from '@lib/voronoi-edges';
import { type Vec3 } from '@lib/voronoi-sphere';
import { BoundaryInfo, BoundaryType, InteractionType, PlateCentroid, PlateProperties, PlateType } from './types';

/**
 * One inter-plate Voronoi edge: a great-circle arc segment of a plate boundary,
 * with its endpoints as unit vectors. Derived from the pre-calculated
 * `voronoiSphere` edge list — no pixel re-tracing.
 */
export interface InterPlateArc {
  plateLo: number;
  plateHi: number;
  a: Vec3;
  b: Vec3;
}

/**
 * Filter the cell-level Voronoi edges down to the inter-plate ones — those
 * whose two cells were assigned to different plates. Each surviving edge is one
 * arc segment of the boundary between its plate pair, carrying real geometry.
 */
export function collectInterPlateArcs(edges: SphereEdge[], cellToPlate: Int32Array): InterPlateArc[] {
  const arcs: InterPlateArc[] = [];
  for (const e of edges) {
    const pA = cellToPlate[e.cellA];
    const pB = cellToPlate[e.cellB];
    if (pA === pB || pA < 0 || pB < 0) continue; // intra-plate or unassigned
    const lo = pA < pB ? pA : pB;
    const hi = pA < pB ? pB : pA;
    arcs.push({ plateLo: lo, plateHi: hi, a: e.a, b: e.b });
  }
  return arcs;
}

/** Plate → sorted neighbor-plate list, derived from the inter-plate arcs. */
export function plateAdjacencyFromArcs(arcs: InterPlateArc[], plateCount: number): number[][] {
  const sets: Set<number>[] = new Array(plateCount);
  for (let i = 0; i < plateCount; i++) sets[i] = new Set<number>();
  for (const arc of arcs) {
    sets[arc.plateLo].add(arc.plateHi);
    sets[arc.plateHi].add(arc.plateLo);
  }
  return sets.map((s) => Array.from(s).sort((a, b) => a - b));
}

/**
 * Aggregate inter-plate arcs into plate-level boundaries. The boundary "length"
 * is the sum of its arcs' great-circle lengths (radians) — the true edge length
 * on the sphere, replacing the legacy pixel-count proxy.
 */
export function aggregatePlateBoundaries(
  arcs: InterPlateArc[],
  plateCount: number
): { plateA: number; plateB: number; length: number }[] {
  const edgeMap = new Map<number, number>(); // packed key -> index
  const plateBoundaries: { plateA: number; plateB: number; length: number }[] = [];

  for (const arc of arcs) {
    const lo = arc.plateLo;
    const hi = arc.plateHi;
    const key = lo * plateCount + hi;
    const len = arcLength(arc.a, arc.b);

    const idx = edgeMap.get(key);
    if (idx !== undefined) {
      plateBoundaries[idx].length += len;
    } else {
      edgeMap.set(key, plateBoundaries.length);
      plateBoundaries.push({ plateA: lo, plateB: hi, length: len });
    }
  }

  return plateBoundaries;
}

function deriveInteractionType(type: BoundaryType, typeA: PlateType, typeB: PlateType): InteractionType {
  const bothContinental = typeA === PlateType.Continental && typeB === PlateType.Continental;
  const bothOceanic = typeA === PlateType.Oceanic && typeB === PlateType.Oceanic;

  switch (type) {
    case BoundaryType.Convergent:
      if (bothContinental) return InteractionType.Collision;
      if (bothOceanic) return InteractionType.OceanicConvergence;
      return InteractionType.Subduction;
    case BoundaryType.Divergent:
      if (bothOceanic) return InteractionType.OceanicRidge;
      return InteractionType.ContinentalRift;
    case BoundaryType.Transform:
      return InteractionType.Transform;
  }
}

export function classifyBoundaries(
  rawBoundaries: { plateA: number; plateB: number; length: number }[],
  plates: PlateProperties[],
  centroids: PlateCentroid[]
): BoundaryInfo[] {
  const classified: { boundary: (typeof rawBoundaries)[0]; type: BoundaryType; rawIntensity: number }[] = [];
  let maxIntensity = 0;

  for (const boundary of rawBoundaries) {
    const pA = plates[boundary.plateA];
    const pB = plates[boundary.plateB];
    const rA = centroids[boundary.plateA].r;
    const rB = centroids[boundary.plateB].r;

    // Boundary midpoint as a unit vector on the sphere — sum of the two
    // centroid unit vectors, renormalized. Matches a great-circle midpoint
    // when |rA| = |rB| = 1, and degrades gracefully toward antipodal pairs
    // (rare for adjacent plates).
    let mx = rA[0] + rB[0];
    let my = rA[1] + rB[1];
    let mz = rA[2] + rB[2];
    const mLen = Math.sqrt(mx * mx + my * my + mz * mz);
    if (mLen === 0) continue;
    mx /= mLen;
    my /= mLen;
    mz /= mLen;

    // Surface velocity at the midpoint from each plate's Euler rotation:
    // v = ω × r̂. Already a tangent-plane vector (perpendicular to r̂).
    const oA = pA.omega;
    const oB = pB.omega;
    const dOx = oA[0] - oB[0];
    const dOy = oA[1] - oB[1];
    const dOz = oA[2] - oB[2];
    // (ω_A − ω_B) × r̂_mid
    const vx = dOy * mz - dOz * my;
    const vy = dOz * mx - dOx * mz;
    const vz = dOx * my - dOy * mx;
    const vMag = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (vMag === 0) continue;

    // Boundary normal at midpoint: project (rB − rA) onto the tangent plane
    // at r̂_mid (subtract the radial component) and normalize. Points from A
    // toward B along the great circle through both centroids.
    let nx = rB[0] - rA[0];
    let ny = rB[1] - rA[1];
    let nz = rB[2] - rA[2];
    const nDotM = nx * mx + ny * my + nz * mz;
    nx -= nDotM * mx;
    ny -= nDotM * my;
    nz -= nDotM * mz;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen === 0) continue;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;

    // Project velocity onto normal (positive = convergent — A moving toward B).
    const vNormal = vx * nx + vy * ny + vz * nz;
    const vTanX = vx - vNormal * nx;
    const vTanY = vy - vNormal * ny;
    const vTanZ = vz - vNormal * nz;
    const vTangent = Math.sqrt(vTanX * vTanX + vTanY * vTanY + vTanZ * vTanZ);

    let type: BoundaryType;
    if (Math.abs(vNormal) > vTangent) {
      type = vNormal > 0 ? BoundaryType.Convergent : BoundaryType.Divergent;
    } else {
      type = BoundaryType.Transform;
    }

    const rawIntensity = vMag;
    if (rawIntensity > maxIntensity) maxIntensity = rawIntensity;

    classified.push({ boundary, type, rawIntensity });
  }

  const invMax = maxIntensity > 0 ? 1 / maxIntensity : 1;
  return classified.map(({ boundary, type, rawIntensity }) => {
    const pA = plates[boundary.plateA];
    const pB = plates[boundary.plateB];
    const interactionType = deriveInteractionType(type, pA.type, pB.type);

    // Determine which plate subducts based on density
    let subductingPlate = -1;
    if (interactionType === InteractionType.Subduction) {
      // In ocean-continent convergence, the oceanic plate always subducts
      subductingPlate = pA.type === PlateType.Oceanic ? boundary.plateA : boundary.plateB;
    } else if (interactionType === InteractionType.OceanicConvergence) {
      // In ocean-ocean convergence, the denser (older) plate subducts
      subductingPlate = pA.density >= pB.density ? boundary.plateA : boundary.plateB;
    }

    return {
      plateA: boundary.plateA,
      plateB: boundary.plateB,
      type,
      interactionType,
      intensity: rawIntensity * invMax,
      length: boundary.length,
      typeA: pA.type,
      typeB: pB.type,
      subductingPlate,
    };
  });
}

/**
 * Compute the elevation delta and mountain range intensity for a pixel
 * near a plate boundary, based on the physical interaction type.
 *
 * `t` is the normalized falloff (1.0 at the boundary, 0.0 at falloff edge).
 * `pixelPlateType` is the plate type of the pixel being evaluated —
 * this matters for asymmetric interactions like subduction.
 * `isSubductingSide` indicates whether this pixel belongs to the subducting plate —
 * used for asymmetric elevation in convergent boundaries.
 */
export function interactionElevation(
  interaction: InteractionType,
  pixelPlateType: PlateType,
  intensity: number,
  t: number,
  isSubductingSide = false
): { elevDelta: number; mountainRange: number } {
  const f = intensity * t;
  switch (interaction) {
    case InteractionType.Collision:
      return { elevDelta: 0.4 * f, mountainRange: 0.8 * t };
    case InteractionType.Subduction:
      if (pixelPlateType === PlateType.Continental) {
        return { elevDelta: 0.35 * f, mountainRange: 0.6 * t };
      }
      // Trench on the subducting (oceanic) side. Depth scales with convergence
      // intensity — fast/steep subduction carves a deeper trench (Mariana-style)
      // than a slow one.
      return { elevDelta: -(0.12 + 0.1 * intensity) * f, mountainRange: 0 };
    case InteractionType.OceanicConvergence:
      // Denser plate subducts → trench; lighter plate gets volcanic island arc.
      // Trench depth scales with convergence intensity (same as above).
      if (isSubductingSide) {
        return { elevDelta: -(0.1 + 0.1 * intensity) * f, mountainRange: 0 };
      }
      return { elevDelta: 0.1 * f, mountainRange: 0.3 * t };
    case InteractionType.ContinentalRift:
      return { elevDelta: -0.1 * f, mountainRange: 0 };
    case InteractionType.OceanicRidge:
      return { elevDelta: 0.03 * f, mountainRange: 0 };
    case InteractionType.Transform:
      return { elevDelta: 0, mountainRange: 0 };
  }
}
