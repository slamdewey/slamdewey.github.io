import { OpenSimplexNoise } from '@lib/noise';
import { mod, sphericalEmbed3D } from '@lib/math';
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
      centroids.push({ x: 0, y: 0 });
      continue;
    }
    const cx = sumX[p];
    const cy = sumY[p];
    const cz = sumZ[p];
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (len === 0) {
      centroids.push({ x: 0, y: 0 });
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
 * Assign plate type and drift using a low-frequency noise field.
 * Sampling noise at each plate's centroid creates spatial coherence.
 * Thickness and density are derived from plate type with random variation,
 * representing geological age and composition differences.
 */
export function assignPlateProperties(
  centroids: PlateCentroid[],
  plateCount: number,
  width: number,
  height: number,
  seed: number
): PlateProperties[] {
  const rng = { s: (seed ^ 0xdeadbeef) | 1 };
  const continentNoise = new OpenSimplexNoise((seed ^ 0xcafebeef) | 0);
  // The unit-vector embedding confines noise samples to the box [−1, 1]³, so
  // freq must be high enough that multiple distinct features fit on the
  // sphere. Below ~1.0 a single noise blob dominates the whole globe and its
  // gradient along z = sin(lat) forces a hemispheric bias (one whole hemi
  // continental, the other oceanic). 1.6 gives ~3 features pole-to-pole and
  // ~1.6 around the equator — continent-sized chunks at all latitudes.
  const CONTINENT_FREQ = 1.6;

  const np = new Float32Array(3);
  const plates: PlateProperties[] = [];
  for (let i = 0; i < plateCount; i++) {
    sphericalEmbed3D(centroids[i].x, centroids[i].y, width, height, np);
    const sample = continentNoise.eval3D(np[0] * CONTINENT_FREQ, np[1] * CONTINENT_FREQ, np[2] * CONTINENT_FREQ);

    const angle = xorshift32(rng) * Math.PI * 2;
    const magnitude = 0.3 + xorshift32(rng) * 0.7;

    const type = sample > 0 ? PlateType.Continental : PlateType.Oceanic;

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
      dx: Math.cos(angle) * magnitude,
      dy: Math.sin(angle) * magnitude,
      thickness,
      density,
      baseElevation: computeIsostasy(thickness, density),
    });
  }

  return plates;
}
