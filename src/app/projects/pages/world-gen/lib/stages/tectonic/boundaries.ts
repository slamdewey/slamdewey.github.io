import { type VoronoiEdge } from '@lib/voronoi';
import { BoundaryInfo, BoundaryType, InteractionType, PlateCentroid, PlateProperties, PlateType } from './types';

/**
 * Aggregate cell-level voronoi edges into plate-level boundaries.
 * Only edges between cells belonging to different plates are included.
 */
export function aggregatePlateBoundaries(
  cellEdges: VoronoiEdge[],
  cellToPlate: Int32Array,
  plateCount: number
): { plateA: number; plateB: number; length: number }[] {
  const edgeMap = new Map<number, number>(); // packed key -> index
  const plateBoundaries: { plateA: number; plateB: number; length: number }[] = [];

  for (const edge of cellEdges) {
    const pA = cellToPlate[edge.cellA];
    const pB = cellToPlate[edge.cellB];
    if (pA === pB) continue; // intra-plate edge

    const lo = Math.min(pA, pB);
    const hi = Math.max(pA, pB);
    const key = lo * plateCount + hi;

    const idx = edgeMap.get(key);
    if (idx !== undefined) {
      plateBoundaries[idx].length += edge.length;
    } else {
      edgeMap.set(key, plateBoundaries.length);
      plateBoundaries.push({ plateA: lo, plateB: hi, length: edge.length });
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
  centroids: PlateCentroid[],
  width: number,
  height: number
): BoundaryInfo[] {
  const classified: { boundary: (typeof rawBoundaries)[0]; type: BoundaryType; rawIntensity: number }[] = [];
  let maxIntensity = 0;

  for (const boundary of rawBoundaries) {
    const pA = plates[boundary.plateA];
    const pB = plates[boundary.plateB];
    const cA = centroids[boundary.plateA];
    const cB = centroids[boundary.plateB];

    // Wrap-aware A→B vector. Scale x components by cos(lat) at the boundary
    // midpoint so geometry is in km-equivalent units rather than pixels — at
    // high latitudes one pixel of x covers far less ground than one pixel of y.
    const midY = (cA.y + cB.y) * 0.5;
    const midLat = Math.PI / 2 - ((midY + 0.5) / height) * Math.PI;
    const cosMid = Math.cos(midLat);

    let nxPx = cB.x - cA.x;
    if (nxPx > width / 2) nxPx -= width;
    else if (nxPx < -width / 2) nxPx += width;
    const nx = nxPx * cosMid;
    const ny = cB.y - cA.y;
    const nLen = Math.sqrt(nx * nx + ny * ny);
    if (nLen === 0) continue;
    const ux = nx / nLen;
    const uy = ny / nLen;

    // Relative drift of A toward B (same cos(lat) scaling on x).
    const relDx = (pA.dx - pB.dx) * cosMid;
    const relDy = pA.dy - pB.dy;

    // Project onto normal (positive = convergent)
    const vNormal = relDx * ux + relDy * uy;
    const vTanX = relDx - vNormal * ux;
    const vTanY = relDy - vNormal * uy;
    const vTangent = Math.sqrt(vTanX * vTanX + vTanY * vTanY);

    let type: BoundaryType;
    if (Math.abs(vNormal) > vTangent) {
      type = vNormal > 0 ? BoundaryType.Convergent : BoundaryType.Divergent;
    } else {
      type = BoundaryType.Transform;
    }

    const rawIntensity = Math.sqrt(relDx * relDx + relDy * relDy);
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
      return { elevDelta: -0.15 * f, mountainRange: 0 };
    case InteractionType.OceanicConvergence:
      // Denser plate subducts → trench; lighter plate gets volcanic island arc
      if (isSubductingSide) {
        return { elevDelta: -0.12 * f, mountainRange: 0 };
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
