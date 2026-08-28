/**
 * Tectonics stage: spherical Voronoi → plate partition → boundary classification
 * → rasterized elevation/fault/mountain fields.
 *
 * Entry point: {@link generateTectonicPlates}. Sub-modules are split by
 * concern (seeds, properties, boundaries, rasterize) but only the public
 * types and the entry function are re-exported here.
 */
import { generateSphereSeeds, assignSphereCellsRaster } from '@lib/voronoi-sphere';
import { voronoiSphere, lloydSphere, neighborsFromEdges } from '@lib/voronoi-edges';
import { NoiseVariables, TectonicVariables, WorldFields } from '../../types';
import { partitionPlates } from './seeds';
import { assignContinentalPlates, assignPlateProperties, computePlateCentroidsSphere } from './properties';
import {
  aggregatePlateBoundaries,
  classifyBoundaries,
  collectInterPlateArcs,
  plateAdjacencyFromArcs,
} from './boundaries';
import { chainArcsIntoPolylines, type Vec3Polyline } from './boundary-polylines';
import { rasterizePlateInteractions } from './rasterize';
import { applyGeomorphology } from './geomorphology';
import { BoundaryArc, BoundaryInfo, TectonicResult } from './types';

export {
  PlateType,
  BoundaryType,
  InteractionType,
  type PlateProperties,
  type BoundaryInfo,
  type BoundaryArc,
  type TectonicResult,
} from './types';
export { computeIsostasy } from './properties';
export { interactionElevation } from './boundaries';

export function generateTectonicPlates(fields: WorldFields, nv: NoiseVariables, tv: TectonicVariables): TectonicResult {
  const { width, height } = fields;
  const { cellCount, relaxationIterations } = tv;
  const rng = { s: (nv.seed ^ 0xabcdef01) | 1 };

  // Step 1: One vector spherical Voronoi tessellation. Seeds are generated,
  // relaxed analytically (lloydSphere), then tessellated — yielding cells AND
  // pre-calculated great-circle edges in a single pass. The SAME relaxed seeds
  // drive a nearest-seed raster pass for the per-pixel cellMap that plateMap
  // and all downstream raster stages still consume, so the raster and vector
  // views are guaranteed consistent. The equirectangular grid (row 0 = north
  // pole) wraps in longitude exactly like the cylindrical case, so downstream
  // raster consumers are unchanged.
  const seeds3 = generateSphereSeeds(cellCount, nv.seed);
  const sphereSeeds = lloydSphere(seeds3, relaxationIterations);
  const tess = voronoiSphere(sphereSeeds);
  const cellMap = assignSphereCellsRaster(sphereSeeds, width, height);

  // Step 2: Cell adjacency straight from the pre-calculated edge list — no
  // raster pixel scan.
  const neighbors = neighborsFromEdges(tess.edges, cellCount);

  // Step 3: Two-tier plate partition — a handful of major plates tiling the
  // globe (compact weighted Voronoi) plus capped micro-plates carved at the
  // major junctions. Majors stay dominant; minors sit on boundaries rather than
  // stranded inside a major. `plateCount` is the resulting total (majors + the
  // minors that fit) and drives every downstream per-plate array.
  const { cellToPlate, plateCount } = partitionPlates(
    sphereSeeds,
    neighbors,
    cellCount,
    tv.plateCount,
    tv.minorPlateCount,
    rng
  );

  // Step 4: Build pixel-level plate map
  const plateMap = new Int32Array(width * height);
  for (let i = 0; i < plateMap.length; i++) {
    plateMap[i] = cellToPlate[cellMap[i]];
  }

  // Step 4.5: Inter-plate arcs + plate adjacency (needed now for continent
  // clustering; reused by the boundary chaining in Step 6). Plate cell counts
  // are the area weights for the continent-growth target.
  const arcs = collectInterPlateArcs(tess.edges, cellToPlate);
  const plateAdjacency = plateAdjacencyFromArcs(arcs, plateCount);
  const plateCellCount = new Int32Array(plateCount);
  for (let i = 0; i < cellCount; i++) plateCellCount[cellToPlate[i]]++;

  // Step 5: Plate centroids, then continentality as a few contiguous clusters
  // (so land forms big continents, not a scattered archipelago), then per-plate
  // properties. Continental crust targets ~land-fraction + a margin for shelves
  // that sit below sea level; the exact water fraction is still set later by the
  // sea-level percentile in terrain synthesis.
  const centroids = computePlateCentroidsSphere(sphereSeeds, cellToPlate, cellCount, plateCount, width, height);
  const targetContinentalFraction = Math.min(0.75, (1 - nv.waterPercentage) * 1.15);
  const isContinental = assignContinentalPlates(
    plateAdjacency,
    plateCellCount,
    centroids,
    tv.continentCount,
    targetContinentalFraction,
    cellCount,
    rng
  );
  const plates = assignPlateProperties(centroids, isContinental, nv.seed);

  // Step 6: Plate boundaries from the pre-calculated inter-plate arcs. The arcs
  // are chained into per-pair polylines ONCE here — that chaining feeds both the
  // exposed `boundaryArcs` geometry channel and the rasterizer (Step 7).
  const chains = chainArcsIntoPolylines(arcs, plateCount);
  const rawBoundaries = aggregatePlateBoundaries(arcs, plateCount);
  const boundaries = classifyBoundaries(rawBoundaries, plates, centroids);
  const boundaryArcs = buildBoundaryArcs(chains, boundaries, plateCount);

  // Step 7: Rasterize interactions into baseElevation, faults, mountainRanges,
  // continentalSubRelief, distToRidge, and oceanAge — fed the pre-chained arcs.
  const { baseElevation, faults, faultType, mountainRanges, continentalSubRelief, distToRidge, oceanAge } =
    rasterizePlateInteractions(plateMap, boundaries, chains, plates, width, height, nv, tv);

  // Step 8: Geomorphology — vector-data-driven features (volcanic island arcs,
  // continental rift valleys). Mutates baseElevation/mountainRanges in place so
  // the elevation warp+noise and post-processing boost pick them up.
  const { volcanicArcs, riftFloorMask } = applyGeomorphology(
    baseElevation,
    mountainRanges,
    plateMap,
    plates,
    boundaries,
    boundaryArcs,
    width,
    height,
    nv,
    tv
  );

  return {
    baseElevation,
    faults,
    faultType,
    mountainRanges,
    plateMap,
    plates,
    boundaries,
    plateAdjacency,
    boundaryArcs,
    continentalSubRelief,
    distToRidge,
    oceanAge,
    volcanicArcs,
    riftFloorMask,
  };
}

/**
 * Group the chained boundary polylines into per-boundary vector geometry,
 * index-aligned with `boundaries`. A plate-pair boundary split into disjoint
 * runs by triple junctions contributes multiple segments.
 */
function buildBoundaryArcs(chains: Vec3Polyline[], boundaries: BoundaryInfo[], plateCount: number): BoundaryArc[] {
  const byPair = new Map<number, number>();
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const lo = Math.min(b.plateA, b.plateB);
    const hi = Math.max(b.plateA, b.plateB);
    byPair.set(lo * plateCount + hi, i);
  }
  const out: BoundaryArc[] = boundaries.map((b) => ({
    plateA: b.plateA,
    plateB: b.plateB,
    segments: [],
    isClosed: [],
  }));
  for (const chain of chains) {
    const bi = byPair.get(chain.plateLo * plateCount + chain.plateHi);
    if (bi === undefined) continue; // pair dropped during classification
    out[bi].segments.push(chain.verts);
    out[bi].isClosed.push(chain.isClosed);
  }
  return out;
}
