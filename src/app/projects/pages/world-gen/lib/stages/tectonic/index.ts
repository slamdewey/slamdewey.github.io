/**
 * Tectonics stage: spherical Voronoi → plate partition → boundary classification
 * → rasterized elevation/fault/mountain fields.
 *
 * Entry point: {@link generateTectonicPlates}. Sub-modules are split by
 * concern (seeds, properties, boundaries, rasterize) but only the public
 * types and the entry function are re-exported here.
 */
import { buildVoronoiGraph } from '@lib/voronoi';
import { generateSphereVoronoi } from '@lib/voronoi-sphere';
import { NoiseVariables, TectonicVariables, WorldFields } from '../../types';
import { generateSizeDistribution, groupCellsIntoPlates, selectPlateSeeds } from './seeds';
import { assignPlateProperties, computePlateCentroidsSphere, sphereSeedsToPixels } from './properties';
import { aggregatePlateBoundaries, classifyBoundaries } from './boundaries';
import { rasterizePlateInteractions } from './rasterize';
import { TectonicResult } from './types';

export {
  PlateType,
  BoundaryType,
  InteractionType,
  type PlateProperties,
  type BoundaryInfo,
  type TectonicResult,
} from './types';
export { computeIsostasy } from './properties';
export { interactionElevation } from './boundaries';

export function generateTectonicPlates(fields: WorldFields, nv: NoiseVariables, tv: TectonicVariables): TectonicResult {
  const { width, height } = fields;
  const { plateCount, cellCount, relaxationIterations } = tv;
  const rng = { s: (nv.seed ^ 0xabcdef01) | 1 };

  // Step 1: Spherical Voronoi tessellation. The cell grid is equirectangular
  // (row 0 = north pole, lat = π/2 − (row+0.5)/H · π) and wraps in longitude
  // exactly like the cylindrical case, so downstream raster consumers are
  // unchanged. Seed positions are unit vectors on the sphere.
  const sphereVoronoi = generateSphereVoronoi({
    width,
    height,
    seedCount: cellCount,
    seed: nv.seed,
    relaxationIterations,
  });
  const { cells: cellMap, seeds: sphereSeeds } = sphereVoronoi;

  // Project sphere seeds → pixel coords for the cylindrical seed-placement
  // helpers below (farthest-point sampling, BFS partitioning). Those helpers
  // compare adjacent or near-by cells where tangent-plane (pixel) distance is
  // a fine approximation. Sphere-correct work happens in centroid math
  // (Step 5) and the Euler-pole velocity classification in Step 6.
  const seeds = sphereSeedsToPixels(sphereSeeds, width, height);

  // Step 2: Build cell adjacency graph
  const graph = buildVoronoiGraph(cellMap, width, height, cellCount, true);

  // Step 3: Group cells into plates
  const targetFractions = generateSizeDistribution(plateCount, rng);
  const plateSeeds = selectPlateSeeds(seeds, cellCount, plateCount, width, targetFractions, graph.neighbors, rng);
  const cellToPlate = groupCellsIntoPlates(graph.neighbors, cellCount, plateCount, plateSeeds, targetFractions);

  // Step 4: Build pixel-level plate map
  const plateMap = new Int32Array(width * height);
  for (let i = 0; i < plateMap.length; i++) {
    plateMap[i] = cellToPlate[cellMap[i]];
  }

  // Step 5: Compute plate centroids (averaging Vec3 unit vectors → renormalize
  // → project to pixel) and assign properties.
  const centroids = computePlateCentroidsSphere(sphereSeeds, cellToPlate, cellCount, plateCount, width, height);
  const plates = assignPlateProperties(centroids, plateCount, width, height, nv.seed);

  // Step 6: Aggregate and classify plate-level boundaries
  const rawBoundaries = aggregatePlateBoundaries(graph.edges, cellToPlate, plateCount);
  const boundaries = classifyBoundaries(rawBoundaries, plates, centroids);

  // Step 7: Rasterize interactions into baseElevation, faults, mountainRanges,
  // continentalSubRelief, distToRidge, and oceanAge.
  const { baseElevation, faults, mountainRanges, continentalSubRelief, distToRidge, oceanAge } =
    rasterizePlateInteractions(plateMap, boundaries, plates, width, height, nv, tv);

  return {
    baseElevation,
    faults,
    mountainRanges,
    plateMap,
    plates,
    boundaries,
    continentalSubRelief,
    distToRidge,
    oceanAge,
  };
}
