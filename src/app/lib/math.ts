const TWO_PI = Math.PI * 2;

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

export function unclampedLerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function inverseLerp(from: number, to: number, value: number): number {
  if (from < to) {
    if (value < from) return 0;
    if (value > to) return 1;
  } else {
    if (value < to) return 1;
    if (value > from) return 0;
  }
  return (value - from) / (to - from);
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function map(value: number, leftMin: number, leftMax: number, rightMin: number, rightMax: number): number {
  return rightMin + ((value - leftMin) * (rightMax - rightMin)) / (leftMax - leftMin);
}

export function mapToSignedRange(value: number): number {
  return map(value, 0, 1, -1, 1);
}

export function mapToUnsignedRange(value: number): number {
  return map(value, -1, 1, 0, 1);
}

/** Positive modulo (always returns >= 0) */
export function mod(x: number, m: number): number {
  return ((x % m) + m) % m;
}

export function sign(a: number): number {
  return a < 0 ? -1 : 1;
}

/**
 * Spherical 3D embedding for noise sampling on an equirectangular grid.
 *
 * Maps cell (x, y) to its unit-vector position on the sphere
 *   lat = π/2 − (y+0.5)/H · π   (row 0 = north pole)
 *   lon = (x+0.5)/W · 2π
 * giving (cos(lat)·cos(lon), cos(lat)·sin(lon), sin(lat)).
 *
 * Using these components as the 3D noise coordinate gives features uniform
 * arc-length size on the globe — no polar squash in the sphere view, no
 * equator-vs-pole density bias, and longitude still wraps seamlessly. The
 * frequency multiplier specifies cycles around the equator, same as before.
 *
 * Writes [nx, ny, nz] into `out` to keep hot loops allocation-free.
 */
export function sphericalEmbed3D(
  x: number,
  y: number,
  width: number,
  height: number,
  out: Float32Array | number[]
): void {
  const lon = ((x + 0.5) / width) * TWO_PI;
  const lat = Math.PI * 0.5 - ((y + 0.5) / height) * Math.PI;
  const cosLat = Math.cos(lat);
  out[0] = cosLat * Math.cos(lon);
  out[1] = cosLat * Math.sin(lon);
  out[2] = Math.sin(lat);
}

/**
 * Equirectangular integer neighbor lookup with sphere wrap.
 *
 * Given a row `y` and a longitudinal offset `nxRaw` (which may be outside
 * `[0, W)`), returns `[nx, ny]` for the neighbor cell. Wraps longitude
 * modulo width. Crossing a pole (ny < 0 or ny >= H) re-emerges at the same
 * pole row at the antipodal longitude — matching the routing used by
 * `sphericalDistanceTransform` in stages/tectonic/rasterize.ts.
 *
 * The output is the natural sphere-correct adjacency on an equirectangular
 * grid: the cell "above" the north pole row is another north pole cell on
 * the opposite side of the globe.
 */
export function wrapEquirectNeighbor(nxRaw: number, nyRaw: number, width: number, height: number): [number, number] {
  let nx = mod(nxRaw, width);
  let ny = nyRaw;
  if (ny < 0) {
    ny = -ny - 1;
    nx = mod(nx + (width >> 1), width);
  } else if (ny >= height) {
    ny = 2 * height - 1 - ny;
    nx = mod(nx + (width >> 1), width);
  }
  // Clamp pathologically large overshoots (multiple pole crossings).
  if (ny < 0) ny = 0;
  else if (ny >= height) ny = height - 1;
  return [nx, ny];
}

export function vec2Normalize(x: number, y: number): [number, number] {
  const len = Math.sqrt(x * x + y * y);
  if (len === 0) return [0, 0];
  return [x / len, y / len];
}

export function vec2Lerp(ax: number, ay: number, bx: number, by: number, t: number): [number, number] {
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}
