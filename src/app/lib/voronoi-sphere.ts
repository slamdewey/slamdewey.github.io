/**
 * Spherical primitives for the world generator: seed generation, nearest-seed
 * raster assignment on an equirectangular grid, and unit-vector → screen
 * projection helpers.
 *
 * The vector Voronoi tessellation itself (cells + pre-calculated edges) now
 * lives in `voronoi-edges.ts` (`voronoiSphere`). This module keeps only the
 * pieces that operate on the equirectangular raster grid — the per-pixel
 * `cellMap`/`plateMap` the world-gen pipeline still consumes — plus the
 * projection helpers used by the playground's Canvas2D overlay.
 *
 * Equirectangular grid convention: row 0 = north pole, lat = π/2 − (row+0.5)/H·π;
 * col 0 = lon = −π; wraps in longitude.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function xorshift32(state: { s: number }): number {
  let s = state.s;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  state.s = s;
  return (s >>> 0) / 0xffffffff;
}

/**
 * Generate seed points uniformly distributed on the unit sphere. Uses
 * `theta = 2π·u`, `phi = acos(2v − 1)` so phi is uniform in cos(phi),
 * which gives equal-area distribution.
 */
export function generateSphereSeeds(seedCount: number, seed: number): Vec3[] {
  const rng = { s: seed | 1 };
  const seeds: Vec3[] = [];
  for (let i = 0; i < seedCount; i++) {
    const u = xorshift32(rng);
    const v = xorshift32(rng);
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const sinPhi = Math.sin(phi);
    seeds.push({
      x: sinPhi * Math.cos(theta),
      y: sinPhi * Math.sin(theta),
      z: Math.cos(phi),
    });
  }
  return seeds;
}

/**
 * Precompute the unit vector for the center of each equirectangular grid cell.
 * Returns a flat array indexed `row * width + col`.
 */
function buildGridVecs(width: number, height: number): Vec3[] {
  const vecs: Vec3[] = new Array(width * height);
  for (let row = 0; row < height; row++) {
    const lat = Math.PI / 2 - ((row + 0.5) / height) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let col = 0; col < width; col++) {
      const lon = ((col + 0.5) / width) * 2 * Math.PI - Math.PI;
      vecs[row * width + col] = {
        x: cosLat * Math.cos(lon),
        y: cosLat * Math.sin(lon),
        z: sinLat,
      };
    }
  }
  return vecs;
}

/**
 * Assign every grid cell to its nearest seed. Uses max dot-product
 * (monotonic with arccos for unit vectors), so no trig in the inner loop.
 */
function assignSphereCells(seeds: Vec3[], cells: Int32Array, gridVecs: Vec3[]): void {
  const n = seeds.length;
  const total = gridVecs.length;
  for (let idx = 0; idx < total; idx++) {
    const p = gridVecs[idx];
    let maxDot = -Infinity;
    let closest = 0;
    for (let i = 0; i < n; i++) {
      const s = seeds[i];
      const d = p.x * s.x + p.y * s.y + p.z * s.z;
      if (d > maxDot) {
        maxDot = d;
        closest = i;
      }
    }
    cells[idx] = closest;
  }
}

/**
 * Nearest-seed raster assignment: build the equirectangular `cellMap` for a
 * fixed set of seeds (no relaxation). The world-gen tectonic stage relaxes the
 * seeds analytically (`lloydSphere`) and tessellates them with `voronoiSphere`,
 * then calls this to get the per-pixel `cellMap` that `plateMap` and all the
 * downstream raster stages consume — guaranteeing raster and vector views share
 * identical seeds.
 */
export function assignSphereCellsRaster(seeds: Vec3[], width: number, height: number): Int32Array {
  const gridVecs = buildGridVecs(width, height);
  const cells = new Int32Array(width * height);
  assignSphereCells(seeds, cells, gridVecs);
  return cells;
}

/**
 * Project a unit vector into mercator pixel coordinates with `y` ∈ [-π, π]
 * mapped linearly to row 0..(height-1). Returns `null` when |y| > π
 * (clipped poles).
 */
export function vec3ToMercator(v: Vec3, width: number, height: number): { x: number; y: number } | null {
  const lat = Math.asin(Math.max(-1, Math.min(1, v.z)));
  const lon = Math.atan2(v.y, v.x);
  // Mercator y in [-π, π] (web-mercator's standard latitude clamp)
  const my = Math.log(Math.tan(Math.PI / 4 + lat / 2));
  if (!Number.isFinite(my) || my > Math.PI || my < -Math.PI) return null;
  const x = ((lon + Math.PI) / (2 * Math.PI)) * width;
  const y = ((Math.PI - my) / (2 * Math.PI)) * height;
  return { x, y };
}

/**
 * Project a unit vector through the orthographic camera with the given rotation.
 * Returns view-space `(u, v)` in [-1, 1] where the front hemisphere has `frontFacing = true`.
 *
 * The camera's center-of-view is (lon = rotLon, lat = rotLat).
 */
export function vec3ToView(v: Vec3, rotLon: number, rotLat: number): { u: number; vv: number; frontFacing: boolean } {
  const cl = Math.cos(rotLat);
  const sl = Math.sin(rotLat);
  const cn = Math.cos(rotLon);
  const sn = Math.sin(rotLon);
  // View-space basis in world coords:
  // forward (camera-out, +w) = (cl·cn, cl·sn, sl)
  // right (+u) = (-sn, cn, 0)
  // up (+v) = (-sl·cn, -sl·sn, cl)
  // To get view coords, dot with each basis vector.
  const u = -sn * v.x + cn * v.y;
  const vv = -sl * cn * v.x + -sl * sn * v.y + cl * v.z;
  const w = cl * cn * v.x + cl * sn * v.y + sl * v.z;
  return { u, vv, frontFacing: w >= 0 };
}
