/**
 * Spherical Voronoi tessellation: voronoi cells on the surface of a unit sphere.
 *
 * Internally stores cells as an equirectangular (lon × lat) grid. Both the sphere
 * (orthographic) view and the mercator view sample from this grid, so rotation /
 * pan are cheap (single lookup per output pixel).
 *
 * Reuses {@link buildVoronoiGraph} from `voronoi.ts` with `wrapX=true` — the
 * equirectangular grid wraps in longitude exactly like the cylindrical case.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SphereVoronoiConfig {
  /** Equirectangular grid width (longitude bins). */
  width: number;
  /** Equirectangular grid height (latitude bins). */
  height: number;
  seedCount: number;
  seed: number;
  /** Lloyd relaxation iterations. 0 = raw random placement. */
  relaxationIterations: number;
}

export interface SphereVoronoiResult {
  /** Per-pixel cell assignment on the equirectangular grid (row-major: row × width + col). */
  cells: Int32Array;
  /** Final seed positions as unit vectors. */
  seeds: Vec3[];
  /** Equirectangular grid width (longitude bins). */
  width: number;
  /** Equirectangular grid height (latitude bins). */
  height: number;
}

const RELAXATION_FACTOR = 0.5;

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
 * Lloyd relaxation on the sphere: each iteration moves seeds toward the
 * (cosine-weighted) centroid of their cells in 3D space, then renormalizes
 * back to the unit sphere. Uses partial relaxation (lerp by RELAXATION_FACTOR).
 */
function lloydRelaxSphere(
  seeds: Vec3[],
  cells: Int32Array,
  width: number,
  height: number,
  iterations: number,
  gridVecs: Vec3[]
): Vec3[] {
  const current: Vec3[] = seeds.map((s) => ({ x: s.x, y: s.y, z: s.z }));

  // Per-row area weight = cos(lat) — equirect bins shrink toward the poles.
  const rowWeights = new Float64Array(height);
  for (let row = 0; row < height; row++) {
    const lat = Math.PI / 2 - ((row + 0.5) / height) * Math.PI;
    rowWeights[row] = Math.cos(lat);
  }

  for (let iter = 0; iter < iterations; iter++) {
    assignSphereCells(current, cells, gridVecs);

    const sumX = new Float64Array(current.length);
    const sumY = new Float64Array(current.length);
    const sumZ = new Float64Array(current.length);

    for (let row = 0; row < height; row++) {
      const w = rowWeights[row];
      const rowOff = row * width;
      for (let col = 0; col < width; col++) {
        const cell = cells[rowOff + col];
        const v = gridVecs[rowOff + col];
        sumX[cell] += v.x * w;
        sumY[cell] += v.y * w;
        sumZ[cell] += v.z * w;
      }
    }

    for (let i = 0; i < current.length; i++) {
      const cx = sumX[i];
      const cy = sumY[i];
      const cz = sumZ[i];
      const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (len === 0) continue;
      const ncx = cx / len;
      const ncy = cy / len;
      const ncz = cz / len;
      // Partial relaxation: lerp toward centroid in 3D, then renormalize.
      const nx = current[i].x + (ncx - current[i].x) * RELAXATION_FACTOR;
      const ny = current[i].y + (ncy - current[i].y) * RELAXATION_FACTOR;
      const nz = current[i].z + (ncz - current[i].z) * RELAXATION_FACTOR;
      const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nlen === 0) continue;
      current[i].x = nx / nlen;
      current[i].y = ny / nlen;
      current[i].z = nz / nlen;
    }
  }

  return current;
}

/**
 * Generate a spherical Voronoi tessellation. The result's `cells` array stores
 * the cell assignment on an equirectangular grid that wraps in longitude.
 */
export function generateSphereVoronoi(config: SphereVoronoiConfig): SphereVoronoiResult {
  const { width, height } = config;
  const gridVecs = buildGridVecs(width, height);
  const cells = new Int32Array(width * height);

  let seeds = generateSphereSeeds(config.seedCount, config.seed);
  if (config.relaxationIterations > 0) {
    seeds = lloydRelaxSphere(seeds, cells, width, height, config.relaxationIterations, gridVecs);
  }
  assignSphereCells(seeds, cells, gridVecs);

  return { cells, seeds, width, height };
}

/** Per-cell color via golden-angle hue spacing (matches `voronoiToRGBA`). */
function buildCellColors(seedCount: number): [number, number, number][] {
  const colors: [number, number, number][] = [];
  for (let i = 0; i < seedCount; i++) {
    const hue = ((i * 137.508) % 360) / 360;
    colors.push(hslToRgb(hue, 0.55, 0.55));
  }
  return colors;
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

/**
 * Render the cell map as a mercator projection. The image wraps seamlessly
 * along the x-axis (longitude). Latitude is clamped at the standard
 * web-mercator extent so the poles aren't infinitely stretched.
 *
 * Each output pixel computes its own nearest-seed assignment (max dot-product
 * against the seed list) rather than sampling the equirect cell map. This
 * gives pixel-perfect cell boundaries with no grid quantization.
 */
export function sphereVoronoiToMercatorRGBA(
  result: SphereVoronoiResult,
  outWidth: number,
  outHeight: number,
  showBoundaries: boolean
): Uint8Array {
  const rgba = new Uint8Array(outWidth * outHeight * 4);
  const cellMap = new Int32Array(outWidth * outHeight);
  const seeds = result.seeds;
  const n = seeds.length;

  // Flatten seeds into a typed array so the inner loop avoids object access.
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const sz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sx[i] = seeds[i].x;
    sy[i] = seeds[i].y;
    sz[i] = seeds[i].z;
  }

  // Mercator y range: [-π, π]. y_norm = 1 - 2·(row+0.5)/outHeight ∈ (-1, 1).
  // mercY = y_norm · π. lat = atan(sinh(mercY)).
  for (let row = 0; row < outHeight; row++) {
    const yNorm = 1 - (2 * (row + 0.5)) / outHeight;
    const mercY = yNorm * Math.PI;
    const lat = Math.atan(Math.sinh(mercY));
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let col = 0; col < outWidth; col++) {
      const lon = ((col + 0.5) / outWidth) * 2 * Math.PI - Math.PI;
      const px = cosLat * Math.cos(lon);
      const py = cosLat * Math.sin(lon);
      const pz = sinLat;
      let maxDot = -Infinity;
      let closest = 0;
      for (let i = 0; i < n; i++) {
        const d = px * sx[i] + py * sy[i] + pz * sz[i];
        if (d > maxDot) {
          maxDot = d;
          closest = i;
        }
      }
      cellMap[row * outWidth + col] = closest;
    }
  }

  const colors = buildCellColors(result.seeds.length);

  for (let row = 0; row < outHeight; row++) {
    for (let col = 0; col < outWidth; col++) {
      const idx = row * outWidth + col;
      const cell = cellMap[idx];
      const out = idx * 4;

      let isBorder = false;
      if (showBoundaries) {
        // X-wraps (mercator's left/right edges are adjacent).
        const left = col > 0 ? cellMap[idx - 1] : cellMap[row * outWidth + outWidth - 1];
        if (left !== cell) isBorder = true;
        else {
          const right = col < outWidth - 1 ? cellMap[idx + 1] : cellMap[row * outWidth];
          if (right !== cell) isBorder = true;
          else if (row > 0 && cellMap[idx - outWidth] !== cell) isBorder = true;
          else if (row < outHeight - 1 && cellMap[idx + outWidth] !== cell) isBorder = true;
        }
      }

      if (isBorder) {
        rgba[out] = 20;
        rgba[out + 1] = 20;
        rgba[out + 2] = 20;
      } else {
        const c = colors[cell];
        rgba[out] = c[0];
        rgba[out + 1] = c[1];
        rgba[out + 2] = c[2];
      }
      rgba[out + 3] = 255;
    }
  }

  return rgba;
}

/**
 * Render the cell map onto a sphere viewed orthographically. Pixels outside
 * the disk are transparent. The view's center is at `(lon = rotLon, lat = rotLat)`.
 *
 * Each output pixel computes nearest-seed directly (max dot-product against
 * the seed list) — no equirect grid sampling — so cell boundaries on the
 * sphere are pixel-perfect.
 */
export function sphereVoronoiToOrthographicRGBA(
  result: SphereVoronoiResult,
  size: number,
  rotLon: number,
  rotLat: number,
  showBoundaries: boolean
): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const cellMap = new Int32Array(size * size).fill(-1);
  const seeds = result.seeds;
  const n = seeds.length;

  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const sz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sx[i] = seeds[i].x;
    sy[i] = seeds[i].y;
    sz[i] = seeds[i].z;
  }

  // Camera basis (world coords).
  const cl = Math.cos(rotLat);
  const sl = Math.sin(rotLat);
  const cn = Math.cos(rotLon);
  const sn = Math.sin(rotLon);
  const fx = cl * cn;
  const fy = cl * sn;
  const fz = sl;
  const rx = -sn;
  const ry = cn;
  // rz = 0
  const ux = -sl * cn;
  const uy = -sl * sn;
  const uz = cl;

  const half = size / 2;
  for (let py = 0; py < size; py++) {
    const v = -((py - half + 0.5) / half);
    for (let px = 0; px < size; px++) {
      const u = (px - half + 0.5) / half;
      const r2 = u * u + v * v;
      if (r2 > 1) continue;
      const w = Math.sqrt(1 - r2);

      // World point = u·right + v·up + w·forward (this is on the unit sphere).
      const wx = u * rx + v * ux + w * fx;
      const wy = u * ry + v * uy + w * fy;
      const wz = /* u·rz + */ v * uz + w * fz;

      let maxDot = -Infinity;
      let closest = 0;
      for (let i = 0; i < n; i++) {
        const d = wx * sx[i] + wy * sy[i] + wz * sz[i];
        if (d > maxDot) {
          maxDot = d;
          closest = i;
        }
      }
      cellMap[py * size + px] = closest;
    }
  }

  const colors = buildCellColors(result.seeds.length);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = py * size + px;
      const cell = cellMap[idx];
      const out = idx * 4;

      if (cell === -1) {
        rgba[out + 3] = 0;
        continue;
      }

      let isBorder = false;
      if (showBoundaries) {
        // Treat outside-disk as a border so cells are outlined against the disk edge too.
        const left = px > 0 ? cellMap[idx - 1] : -1;
        const right = px < size - 1 ? cellMap[idx + 1] : -1;
        const top = py > 0 ? cellMap[idx - size] : -1;
        const bot = py < size - 1 ? cellMap[idx + size] : -1;
        if (
          (left !== cell && left !== -1) ||
          (right !== cell && right !== -1) ||
          (top !== cell && top !== -1) ||
          (bot !== cell && bot !== -1)
        ) {
          isBorder = true;
        }
      }

      if (isBorder) {
        rgba[out] = 20;
        rgba[out + 1] = 20;
        rgba[out + 2] = 20;
      } else {
        const c = colors[cell];
        rgba[out] = c[0];
        rgba[out + 1] = c[1];
        rgba[out + 2] = c[2];
      }
      rgba[out + 3] = 255;
    }
  }

  return rgba;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  const sector = (h * 6) | 0;
  switch (sector % 6) {
    case 0:
      r = c;
      g = x;
      break;
    case 1:
      r = x;
      g = c;
      break;
    case 2:
      g = c;
      b = x;
      break;
    case 3:
      g = x;
      b = c;
      break;
    case 4:
      r = x;
      b = c;
      break;
    case 5:
      r = c;
      b = x;
      break;
  }
  return [((r + m) * 255) | 0, ((g + m) * 255) | 0, ((b + m) * 255) | 0];
}
