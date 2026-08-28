import { mod } from '@lib/math';
import { type Vec3 } from '@lib/voronoi-sphere';
import { PlateCentroid, PlateProperties, PlateType } from './types';
import { xorshift32 } from './seeds';

/**
 * Project unit-sphere seed positions to equirectangular pixel coords:
 * lon = atan2(y, x), lat = asin(z); pxX = (lon+π)/(2π)·W, pxY = (π/2−lat)/π·H.
 */
export function sphereSeedsToPixels(sphereSeeds: Vec3[], width: number, height: number): { x: number; y: number }[] {
  const TWO_PI = Math.PI * 2;
  const out: { x: number; y: number }[] = new Array(sphereSeeds.length);
  for (let i = 0; i < sphereSeeds.length; i++) {
    const s = sphereSeeds[i];
    const lat = Math.asin(s.z < -1 ? -1 : s.z > 1 ? 1 : s.z);
    const lon = Math.atan2(s.y, s.x);
    out[i] = {
      x: ((lon + Math.PI) / TWO_PI) * width,
      y: ((Math.PI / 2 - lat) / Math.PI) * height,
    };
  }
  return out;
}

/**
 * Compute plate centroids on the sphere: sum the unit-vector positions of all
 * member-cell seeds, renormalize to the unit sphere, then project to pixel
 * coords. This is the natural sphere centroid (no pole-bias from cylindrical
 * y-averaging) and is well-defined even for plates that span the antimeridian.
 */
export function computePlateCentroidsSphere(
  sphereSeeds: Vec3[],
  cellToPlate: Int32Array,
  cellCount: number,
  plateCount: number,
  width: number,
  height: number
): PlateCentroid[] {
  const sumX = new Float64Array(plateCount);
  const sumY = new Float64Array(plateCount);
  const sumZ = new Float64Array(plateCount);
  const counts = new Int32Array(plateCount);

  for (let i = 0; i < cellCount; i++) {
    const p = cellToPlate[i];
    if (p < 0) continue;
    counts[p]++;
    const s = sphereSeeds[i];
    sumX[p] += s.x;
    sumY[p] += s.y;
    sumZ[p] += s.z;
  }

  const TWO_PI = Math.PI * 2;
  const centroids: PlateCentroid[] = [];
  for (let p = 0; p < plateCount; p++) {
    if (counts[p] === 0) {
      centroids.push({ x: 0, y: 0, r: [1, 0, 0] });
      continue;
    }
    const cx = sumX[p];
    const cy = sumY[p];
    const cz = sumZ[p];
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (len === 0) {
      centroids.push({ x: 0, y: 0, r: [1, 0, 0] });
      continue;
    }
    const nx = cx / len;
    const ny = cy / len;
    const nz = cz / len;
    const lat = Math.asin(nz < -1 ? -1 : nz > 1 ? 1 : nz);
    const lon = Math.atan2(ny, nx);
    centroids.push({
      x: mod(((lon + Math.PI) / TWO_PI) * width, width),
      y: ((Math.PI / 2 - lat) / Math.PI) * height,
      r: [nx, ny, nz],
    });
  }

  return centroids;
}

/**
 * Compute isostatic equilibrium base elevation from thickness and density.
 *
 * Thicker, less-dense crust floats higher on the mantle (continental highlands).
 * Thinner, denser crust sits lower (oceanic basins).
 * Calibrated so average continental ≈ 0.25, average oceanic ≈ -0.35.
 */
export function computeIsostasy(thickness: number, density: number): number {
  return 1.5 * thickness * (1 - density) - 0.5;
}

/**
 * Decide which plates are continental by growing `continentCount` contiguous
 * clusters until continental crust reaches `targetFraction` of the globe.
 *
 * Seeds are chosen by farthest-point sampling on the plate centroids (so the
 * nuclei spread out), then continental crust grows outward along plate
 * adjacency in random order. Because growth follows adjacency, each continent
 * is a connected blob of plates — a few big landmasses instead of the scattered
 * archipelago that per-plate noise produced. Clusters may merge if they grow
 * into each other (a Pangaea), which is fine.
 */
export function assignContinentalPlates(
  adjacency: number[][],
  plateCellCount: Int32Array,
  centroids: PlateCentroid[],
  continentCount: number,
  targetFraction: number,
  totalCells: number,
  rng: { s: number }
): boolean[] {
  const plateCount = centroids.length;
  const isCont = new Array<boolean>(plateCount).fill(false);
  if (plateCount === 0) return isCont;
  const nSeeds = Math.max(1, Math.min(continentCount, plateCount));

  // Farthest-point continent seeds on the centroid unit vectors.
  const minDist = new Float64Array(plateCount).fill(Infinity);
  const updateFrom = (p: number): void => {
    const r = centroids[p].r;
    for (let i = 0; i < plateCount; i++) {
      const ri = centroids[i].r;
      const d = 1 - (r[0] * ri[0] + r[1] * ri[1] + r[2] * ri[2]);
      if (d < minDist[i]) minDist[i] = d;
    }
  };
  const seeds: number[] = [Math.floor(xorshift32(rng) * plateCount)];
  updateFrom(seeds[0]);
  for (let m = 1; m < nSeeds; m++) {
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < plateCount; i++) {
      if (minDist[i] > bestD) {
        bestD = minDist[i];
        best = i;
      }
    }
    seeds.push(best);
    updateFrom(best);
  }

  // Grow continental crust from the seeds along adjacency until the target area.
  let contArea = 0;
  const frontier: number[] = [];
  for (const s of seeds) {
    if (isCont[s]) continue;
    isCont[s] = true;
    contArea += plateCellCount[s];
    for (const nb of adjacency[s]) if (!isCont[nb]) frontier.push(nb);
  }

  const targetArea = targetFraction * totalCells;
  while (contArea < targetArea && frontier.length > 0) {
    const k = Math.floor(xorshift32(rng) * frontier.length);
    const p = frontier[k];
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
    if (isCont[p]) continue;
    isCont[p] = true;
    contArea += plateCellCount[p];
    for (const nb of adjacency[p]) if (!isCont[nb]) frontier.push(nb);
  }

  return isCont;
}

/**
 * Assign plate type, drift, thickness and density. Continentality is decided
 * upstream (see {@link assignContinentalPlates}) and passed in as a per-plate
 * boolean, so continents form a few contiguous clusters rather than a noisy
 * scatter. Thickness and density are derived from the type with random
 * variation, representing geological age and composition differences.
 */
export function assignPlateProperties(
  centroids: PlateCentroid[],
  isContinental: boolean[],
  seed: number
): PlateProperties[] {
  const plateCount = centroids.length;
  const rng = { s: (seed ^ 0xdeadbeef) | 1 };

  const plates: PlateProperties[] = [];
  for (let i = 0; i < plateCount; i++) {
    // Euler rotation vector: isotropic direction on S², magnitude in the same
    // 0.3–1.0 range as the legacy 2D drift so downstream intensity calibration
    // (which normalizes to [0, 1] across all boundaries anyway) stays comparable.
    // Sampled via Marsaglia: pick a uniform unit vector, scale by magnitude.
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let s2 = 2;
    while (s2 >= 1 || s2 === 0) {
      const u = xorshift32(rng) * 2 - 1;
      const v = xorshift32(rng) * 2 - 1;
      s2 = u * u + v * v;
      if (s2 < 1 && s2 > 0) {
        const f = 2 * Math.sqrt(1 - s2);
        ox = u * f;
        oy = v * f;
        oz = 1 - 2 * s2;
      }
    }
    const magnitude = 0.3 + xorshift32(rng) * 0.7;
    const omega: [number, number, number] = [ox * magnitude, oy * magnitude, oz * magnitude];

    const type = isContinental[i] ? PlateType.Continental : PlateType.Oceanic;

    // Thickness & density vary by plate type with random spread
    let thickness: number;
    let density: number;
    if (type === PlateType.Continental) {
      // Continental: thick (0.55–0.85), low density (0.2–0.4)
      thickness = 0.55 + xorshift32(rng) * 0.3;
      density = 0.2 + xorshift32(rng) * 0.2;
    } else {
      // Oceanic: thin (0.1–0.35), higher density (0.55–0.85)
      // Higher density represents older, cooler oceanic lithosphere
      thickness = 0.1 + xorshift32(rng) * 0.25;
      density = 0.55 + xorshift32(rng) * 0.3;
    }

    plates.push({
      index: i,
      type,
      omega,
      thickness,
      density,
      baseElevation: computeIsostasy(thickness, density),
    });
  }

  return plates;
}
