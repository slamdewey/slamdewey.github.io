/**
 * Vector Voronoi tessellation — adapter over `d3-delaunay` (planar) and
 * `d3-geo-voronoi` (spherical).
 *
 * Both libraries handle the hard geometric robustness (cocircular ties,
 * degeneracies, hull edges, projection artifacts) that hand-rolled
 * Bowyer-Watson rapidly gets wrong. We only own:
 *   - The unified public types (`PlanarVoronoi`, `SphereVoronoi`, etc.) so
 *     downstream code (the playground, tectonic-plate sim) sees one shape
 *     across topologies.
 *   - The cylindrical-wrap layer (`voronoiCylindrical`), which preprocesses
 *     seeds with ±width ghost copies and runs the libraries' planar Delaunay
 *     on the extended set. d3-delaunay has no native cylindrical mode.
 *   - The analytical Lloyd loops, which move seeds toward their cell's
 *     centroid using the tessellation computed by the libraries.
 */

import { Delaunay } from 'd3-delaunay';
import { geoVoronoi } from 'd3-geo-voronoi';
import { Vec3 } from '@lib/voronoi-sphere';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlanarEdge {
  cellA: number;
  cellB: number;
  /** Endpoints of the boundary segment in world coords. Both lie inside or
   * on the canvas bounds — this is a real visible segment, not a clipped ray. */
  a: Vec2;
  b: Vec2;
  /** Segment midpoint. */
  midpoint: Vec2;
}

export interface PlanarCell {
  cellIndex: number;
  /** CCW-ordered polygon vertices in world coords; empty when the seed has no Voronoi cell. */
  vertices: Vec2[];
}

export interface PlanarVoronoi {
  cells: PlanarCell[];
  edges: PlanarEdge[];
}

export interface SphereEdge {
  cellA: number;
  cellB: number;
  /** Unit-vector endpoints; the edge is the shorter great-circle arc between them. */
  a: Vec3;
  b: Vec3;
  /** Spherical midpoint of the (shorter) arc between `a` and `b`. Falls back
   * to the bisector midpoint of the seed pair when `a` and `b` are antipodal
   * (rendering layer uses this to subdivide the boundary arc). */
  midpoint: Vec3;
}

export interface SphereCell {
  cellIndex: number;
  /** Unit-vector polygon vertices, ordered around the cell. */
  vertices: Vec3[];
}

export interface SphereVoronoi {
  cells: SphereCell[];
  edges: SphereEdge[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ---------------------------------------------------------------------------
// Planar / cylindrical (d3-delaunay)
// ---------------------------------------------------------------------------

/**
 * Planar Voronoi tessellation clipped to `bounds`.
 *
 * **Adjacency is determined by polygon-walk**, not by Delaunay triangle
 * incidence. Two cells are adjacent iff their clipped polygons share a
 * non-canvas-bound segment. This is the *visual* definition (cells whose
 * visible regions touch) and matches what's actually rendered — as opposed
 * to the abstract combinatorial Delaunay-edge definition, which includes
 * "infinity adjacencies" between non-spatially-adjacent hull cells whose
 * unbounded Voronoi cells only meet outside the canvas.
 *
 * Every emitted edge is a real visible boundary segment with both endpoints
 * inside or on the canvas — no clipped rays, no flags.
 */
export function voronoiPlanar(points: Vec2[], bounds: Bounds): PlanarVoronoi {
  const flat: [number, number][] = points.map((p) => [p.x, p.y]);
  const delaunay = Delaunay.from(flat);
  const voronoi = delaunay.voronoi([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);

  // Cells: cellPolygon returns a closed loop (first === last); drop the duplicate.
  const cells: PlanarCell[] = [];
  for (let i = 0; i < points.length; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly) {
      cells.push({ cellIndex: i, vertices: [] });
      continue;
    }
    const vertices: Vec2[] = [];
    for (let j = 0; j < poly.length - 1; j++) {
      vertices.push({ x: poly[j][0], y: poly[j][1] });
    }
    cells.push({ cellIndex: i, vertices });
  }

  // Walk each cell's polygon. For each polygon segment, classify:
  //  - canvas-bound (both vertices on the same canvas edge): skip — it's a
  //    cell↔canvas boundary, not a cell↔cell boundary.
  //  - otherwise: a Voronoi boundary segment. The same segment appears in
  //    exactly one other cell's polygon walk (in reverse direction, since
  //    polygons are CCW). Group by canonical key and emit one edge per pair.
  const segmentMap = new Map<string, { cells: number[]; a: Vec2; b: Vec2 }>();
  for (let i = 0; i < cells.length; i++) {
    const verts = cells[i].vertices;
    if (verts.length < 2) continue;
    for (let j = 0; j < verts.length; j++) {
      const a = verts[j];
      const b = verts[(j + 1) % verts.length];
      if (isOnCanvasBound(a, b, bounds)) continue;
      const key = canonicalSegmentKey(a, b);
      const existing = segmentMap.get(key);
      if (existing) existing.cells.push(i);
      else segmentMap.set(key, { cells: [i], a, b });
    }
  }

  const edges: PlanarEdge[] = [];
  for (const entry of segmentMap.values()) {
    if (entry.cells.length !== 2) continue;
    const c0 = entry.cells[0];
    const c1 = entry.cells[1];
    const a = entry.a;
    const b = entry.b;
    edges.push({
      cellA: c0 < c1 ? c0 : c1,
      cellB: c0 < c1 ? c1 : c0,
      a,
      b,
      midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    });
  }

  return { cells, edges };
}

const SEGMENT_KEY_PRECISION = 1e6;

function vertexKey(p: Vec2): string {
  return `${Math.round(p.x * SEGMENT_KEY_PRECISION)},${Math.round(p.y * SEGMENT_KEY_PRECISION)}`;
}

/** Direction-independent key for a polygon segment, with float-tolerance rounding. */
function canonicalSegmentKey(a: Vec2, b: Vec2): string {
  const ka = vertexKey(a);
  const kb = vertexKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** True iff both segment endpoints lie on the same canvas edge. */
function isOnCanvasBound(a: Vec2, b: Vec2, bounds: Bounds, eps = 1e-6): boolean {
  return (
    (Math.abs(a.x - bounds.minX) < eps && Math.abs(b.x - bounds.minX) < eps) ||
    (Math.abs(a.x - bounds.maxX) < eps && Math.abs(b.x - bounds.maxX) < eps) ||
    (Math.abs(a.y - bounds.minY) < eps && Math.abs(b.y - bounds.minY) < eps) ||
    (Math.abs(a.y - bounds.maxY) < eps && Math.abs(b.y - bounds.maxY) < eps)
  );
}

/**
 * Cylindrical Voronoi: x wraps with period `width`, y is bounded by `height`.
 * We replicate every seed at `x - width` and `x + width`, run the planar
 * adapter on the 3N point set, then keep only edges that touch at least one
 * real cell (the middle copy, indices `[N, 2N)`). Wrap-crossing edges come
 * out as single segments in canonical "shorter route" form — endpoints may
 * sit slightly outside `[0, width)` on the seam side.
 */
export function voronoiCylindrical(points: Vec2[], width: number, height: number): PlanarVoronoi {
  const N = points.length;
  const ghosts: Vec2[] = new Array(3 * N);
  for (let i = 0; i < N; i++) {
    ghosts[i] = { x: points[i].x - width, y: points[i].y };
    ghosts[N + i] = points[i];
    ghosts[2 * N + i] = { x: points[i].x + width, y: points[i].y };
  }

  const bounds: Bounds = { minX: -width, minY: 0, maxX: 2 * width, maxY: height };
  const ghostV = voronoiPlanar(ghosts, bounds);

  const isReal = (i: number): boolean => i >= N && i < 2 * N;
  const realOf = (i: number): number => i % N;

  // Dedup by (cellA, cellB, midpoint-mod-width) — NOT just (cellA, cellB).
  // For cylindrical at low N, two cells can be adjacent twice: once in-window
  // and once across the seam. Both edges have the same cell pair but different
  // canonical midpoints (e.g. midX ≈ 1 vs midX ≈ 0). Collapsing them to one
  // loses the wrap edge and breaks both boundary rendering and the dual graph
  // for wrap-adjacent cells.
  const seen = new Set<string>();
  const edges: PlanarEdge[] = [];
  for (const e of ghostV.edges) {
    if (!isReal(e.cellA) && !isReal(e.cellB)) continue;
    const ra = realOf(e.cellA);
    const rb = realOf(e.cellB);
    if (ra === rb) continue; // cell wraps and meets itself; skip
    const lo = ra < rb ? ra : rb;
    const hi = ra < rb ? rb : ra;
    let midX = (e.a.x + e.b.x) / 2;
    midX = ((midX % width) + width) % width;
    const midY = (e.a.y + e.b.y) / 2;
    const key = `${lo}_${hi}_${Math.round(midX * 1000)}_${Math.round(midY * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      cellA: lo,
      cellB: hi,
      a: e.a,
      b: e.b,
      midpoint: e.midpoint,
    });
  }

  const cells: PlanarCell[] = [];
  for (let i = 0; i < N; i++) {
    const ghostCell = ghostV.cells[N + i];
    cells.push({ cellIndex: i, vertices: ghostCell?.vertices ?? [] });
  }

  return { cells, edges };
}

function edgeKey(a: number, b: number): number {
  return a < b ? a * 65536 + b : b * 65536 + a;
}

// ---------------------------------------------------------------------------
// Spherical (d3-geo-voronoi)
// ---------------------------------------------------------------------------

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

function vec3ToLonLat(v: Vec3): [number, number] {
  const lon = Math.atan2(v.y, v.x) * RAD_TO_DEG;
  const lat = Math.asin(Math.max(-1, Math.min(1, v.z))) * RAD_TO_DEG;
  return [lon, lat];
}

function lonLatToVec3(p: [number, number]): Vec3 {
  const lon = p[0] * DEG_TO_RAD;
  const lat = p[1] * DEG_TO_RAD;
  const cosLat = Math.cos(lat);
  return { x: cosLat * Math.cos(lon), y: cosLat * Math.sin(lon), z: Math.sin(lat) };
}

/**
 * Spherical Voronoi via d3-geo-voronoi. Input/output are unit vectors; the
 * library works in [lon, lat] degrees, so we convert at the boundary.
 *
 * The sphere is closed — every Voronoi edge has exactly two incident
 * triangles and there are no hull/clipping artifacts.
 */
export function voronoiSphere(seeds: Vec3[]): SphereVoronoi {
  if (seeds.length === 0) return { cells: [], edges: [] };
  if (seeds.length === 1) return { cells: [{ cellIndex: 0, vertices: [] }], edges: [] };

  // N=2 special case: the boundary is a single great circle (the bisector
  // perpendicular to seeds[0] - seeds[1]). d3-geo-voronoi returns nothing
  // useful here, so we sample the great circle directly and emit it as a
  // closed loop of segments. Each cell is a hemisphere.
  if (seeds.length === 2) return sphereVoronoiTwo(seeds);

  const lonLat = seeds.map(vec3ToLonLat);
  const v = geoVoronoi(lonLat);
  const d = v.delaunay;

  // Cells: d.polygons[i] is the list of triangle indices forming cell i's
  // Voronoi polygon, in CCW order around the cell. Convert each triangle's
  // circumcenter (in [lon, lat]) back to a unit vector.
  const cells: SphereCell[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const triList = d.polygons[i] ?? [];
    const vertices = triList.map((t: number) => lonLatToVec3(d.centers[t]));
    cells.push({ cellIndex: i, vertices });
  }

  // Edges: use d.edges (the authoritative cell-pair adjacency list — already
  // filtered by d3-geo-voronoi to drop back-hemisphere duplicate-triangle
  // artifacts via the spherical-excess test). For each pair, look up the two
  // d.triangles entries that share both cells; their circumcenters bound the
  // Voronoi edge.
  const pairTris = new Map<number, number[]>();
  for (let t = 0; t < d.triangles.length; t++) {
    const tri = d.triangles[t];
    addEdgeTri(pairTris, tri[0], tri[1], t);
    addEdgeTri(pairTris, tri[1], tri[2], t);
    addEdgeTri(pairTris, tri[2], tri[0], t);
  }

  const edges: SphereEdge[] = [];
  for (const [cellA, cellB] of d.edges) {
    const tris = pairTris.get(edgeKey(cellA, cellB));
    if (!tris || tris.length !== 2) continue;
    const a = lonLatToVec3(d.centers[tris[0]]);
    const b = lonLatToVec3(d.centers[tris[1]]);
    const midpoint = sphericalEdgeMidpoint(a, b, seeds, cellA, cellB);
    edges.push({ cellA, cellB, a, b, midpoint });
  }

  return { cells, edges };
}

/**
 * Cell adjacency as a neighbor list, derived directly from the pre-calculated
 * edge list — no raster pixel scan. `voronoiSphere` emits each adjacent pair
 * exactly once (via d3-geo-voronoi's authoritative `d.edges`), so a single
 * push per endpoint is enough. Each list is sorted ascending so any downstream
 * tie-break that iterates neighbors (e.g. the plate-partition Dijkstra) is
 * deterministic run-to-run regardless of edge emission order.
 */
export function neighborsFromEdges(edges: SphereEdge[], cellCount: number): number[][] {
  const neighbors: number[][] = new Array(cellCount);
  for (let i = 0; i < cellCount; i++) neighbors[i] = [];
  for (const e of edges) {
    if (e.cellA < cellCount && e.cellB < cellCount) {
      neighbors[e.cellA].push(e.cellB);
      neighbors[e.cellB].push(e.cellA);
    }
  }
  for (let i = 0; i < cellCount; i++) neighbors[i].sort((a, b) => a - b);
  return neighbors;
}

/** Great-circle arc length (radians) between two unit vectors. */
export function arcLength(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(dot < -1 ? -1 : dot > 1 ? 1 : dot);
}

/**
 * Spherical linear interpolation between two unit vectors. Falls back to a
 * normalized lerp when the endpoints are nearly coincident (sin Ω → 0), which
 * keeps short-arc subdivision numerically stable.
 */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const clamped = dot < -1 ? -1 : dot > 1 ? 1 : dot;
  const omega = Math.acos(clamped);
  const sin = Math.sin(omega);
  if (sin < 1e-9) {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    const len = Math.hypot(x, y, z) || 1;
    return { x: x / len, y: y / len, z: z / len };
  }
  const wa = Math.sin((1 - t) * omega) / sin;
  const wb = Math.sin(t * omega) / sin;
  return { x: wa * a.x + wb * b.x, y: wa * a.y + wb * b.y, z: wa * a.z + wb * b.z };
}

/**
 * Spherical midpoint between two Voronoi vertices on the *correct* half of
 * the bisector great circle.
 *
 * For well-separated endpoints (`dot(a, b) > -0.9`) `normalize(a + b)` lies
 * on the shorter arc between them; that's unambiguously the correct
 * midpoint.
 *
 * For *near-antipodal* endpoints (always at N=3 because both Voronoi
 * vertices are exactly antipodal; sometimes at N>=4 in degenerate configs),
 * both halves of the bisector great circle are equal length and
 * `normalize(a + b)` is governed by floating-point noise. The bisector
 * midpoint `normalize(seedA + seedB)` is at least on the bisector great
 * circle, but it could be on EITHER of two antipodal points — only one is
 * the actual Voronoi edge midpoint. The correct one is the side AWAY from
 * the other cells; if the candidate lands on the same hemisphere as the
 * centroid of all other seeds, flip to the antipode (which is also on the
 * bisector great circle).
 */
function sphericalEdgeMidpoint(a: Vec3, b: Vec3, seeds: Vec3[], indexA: number, indexB: number): Vec3 {
  const dotAB = a.x * b.x + a.y * b.y + a.z * b.z;
  if (dotAB > -0.9) {
    const sx = a.x + b.x;
    const sy = a.y + b.y;
    const sz = a.z + b.z;
    const sLen = Math.hypot(sx, sy, sz);
    return { x: sx / sLen, y: sy / sLen, z: sz / sLen };
  }

  const candidate = bisectorMidpoint(seeds[indexA], seeds[indexB]);
  if (!candidate) {
    const s = seeds[indexA];
    return { x: s.x, y: s.y, z: s.z };
  }

  // Centroid direction of all other cells.
  let ox = 0;
  let oy = 0;
  let oz = 0;
  for (let i = 0; i < seeds.length; i++) {
    if (i === indexA || i === indexB) continue;
    ox += seeds[i].x;
    oy += seeds[i].y;
    oz += seeds[i].z;
  }
  // If candidate is on the same hemisphere as "others", flip to the antipodal
  // point on the bisector great circle so the Voronoi edge midpoint is on
  // the AWAY-from-others side.
  if (candidate.x * ox + candidate.y * oy + candidate.z * oz > 0) {
    return { x: -candidate.x, y: -candidate.y, z: -candidate.z };
  }
  return candidate;
}

/**
 * Spherical Voronoi for N=2: emit the bisector great circle as 16 short
 * segments. Each cell is a hemisphere; we don't try to compute polygon
 * vertices (which would be the whole great circle of `2k` points).
 */
function sphereVoronoiTwo(seeds: Vec3[]): SphereVoronoi {
  const a = seeds[0];
  const b = seeds[1];
  const nx = a.x - b.x;
  const ny = a.y - b.y;
  const nz = a.z - b.z;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-9) {
    return {
      cells: [
        { cellIndex: 0, vertices: [] },
        { cellIndex: 1, vertices: [] },
      ],
      edges: [],
    };
  }
  // n = normalized (a - b) — normal of the bisector great circle plane.
  const nnx = nx / nLen;
  const nny = ny / nLen;
  const nnz = nz / nLen;
  // Tangent basis on the bisector plane.
  const helperX = Math.abs(nnx) < 0.9 ? 1 : 0;
  const helperY = Math.abs(nnx) < 0.9 ? 0 : 1;
  let ux = nny * 0 - nnz * helperY;
  let uy = nnz * helperX - nnx * 0;
  let uz = nnx * helperY - nny * helperX;
  const uLen = Math.hypot(ux, uy, uz);
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;
  const vx = nny * uz - nnz * uy;
  const vy = nnz * ux - nnx * uz;
  const vz = nnx * uy - nny * ux;

  const segments = 16;
  const samples: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const ang = (i / segments) * 2 * Math.PI;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    samples.push({ x: ux * c + vx * s, y: uy * c + vy * s, z: uz * c + vz * s });
  }
  const edges: SphereEdge[] = [];
  for (let i = 0; i < segments; i++) {
    const sa = samples[i];
    const sb = samples[(i + 1) % segments];
    edges.push({
      cellA: 0,
      cellB: 1,
      a: sa,
      b: sb,
      midpoint: sphericalEdgeMidpoint(sa, sb, seeds, 0, 1),
    });
  }
  return {
    cells: [
      { cellIndex: 0, vertices: samples },
      { cellIndex: 1, vertices: samples.slice().reverse() },
    ],
    edges,
  };
}

/**
 * Midpoint on the bisector great circle between two cells, picked
 * unambiguously by direction: `normalize(seedA + seedB)`. This lies on the
 * bisector (since it's perpendicular to `seedA - seedB`) and points toward
 * the side of the sphere where the cells live, which is the side the Voronoi
 * edge actually traces. Using the cross product instead would pick one of
 * two antipodal candidates with no good way to choose, half the time landing
 * on the wrong semicircle.
 */
function bisectorMidpoint(seedA: Vec3, seedB: Vec3): Vec3 | null {
  const sx = seedA.x + seedB.x;
  const sy = seedA.y + seedB.y;
  const sz = seedA.z + seedB.z;
  const sLen = Math.hypot(sx, sy, sz);
  if (sLen < 1e-9) return null; // seedA and seedB are antipodal — no canonical midpoint
  return { x: sx / sLen, y: sy / sLen, z: sz / sLen };
}

function addEdgeTri(map: Map<number, number[]>, u: number, v: number, t: number): void {
  const k = edgeKey(u, v);
  const arr = map.get(k);
  if (arr) arr.push(t);
  else map.set(k, [t]);
}

// ---------------------------------------------------------------------------
// Analytical Lloyd relaxation
// ---------------------------------------------------------------------------

const LLOYD_RELAXATION_FACTOR = 0.5;

/** Area-weighted centroid of a 2D polygon (vertices ordered, CCW or CW). */
function polygonCentroid(vertices: Vec2[]): Vec2 | null {
  if (vertices.length < 3) return null;
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
    area += cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-12) return null;
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/**
 * Lloyd relaxation on the analytical planar/cylindrical Voronoi. Each
 * iteration computes the tessellation, then moves every seed half-way toward
 * its cell's area-weighted centroid.
 */
export function lloydPlanar(initial: Vec2[], width: number, height: number, wrap: boolean, iterations: number): Vec2[] {
  if (iterations <= 0) return initial.map((s) => ({ x: s.x, y: s.y }));
  const current = initial.map((s) => ({ x: s.x, y: s.y }));
  const bounds: Bounds = { minX: 0, minY: 0, maxX: width, maxY: height };
  for (let it = 0; it < iterations; it++) {
    const tess = wrap ? voronoiCylindrical(current, width, height) : voronoiPlanar(current, bounds);
    for (let i = 0; i < current.length; i++) {
      const cell = tess.cells[i];
      if (!cell) continue;
      const c = polygonCentroid(cell.vertices);
      if (!c) continue;
      let cx = c.x;
      let cy = c.y;
      if (wrap) cx = ((cx % width) + width) % width;
      if (cy < 0) cy = 0;
      else if (cy > height) cy = height;
      let dx = cx - current[i].x;
      if (wrap) {
        if (dx > width / 2) dx -= width;
        else if (dx < -width / 2) dx += width;
      }
      current[i].x += dx * LLOYD_RELAXATION_FACTOR;
      current[i].y += (cy - current[i].y) * LLOYD_RELAXATION_FACTOR;
      if (wrap) current[i].x = ((current[i].x % width) + width) % width;
    }
  }
  return current;
}

/**
 * Spherical Lloyd: at each iteration, move each seed half-way toward the
 * normalized sum of its cell's vertices (a stable proxy for the spherical
 * area-weighted centroid that converges to the same fixed points).
 */
export function lloydSphere(initial: Vec3[], iterations: number): Vec3[] {
  if (iterations <= 0) return initial.map((s) => ({ x: s.x, y: s.y, z: s.z }));
  const current = initial.map((s) => ({ x: s.x, y: s.y, z: s.z }));
  for (let it = 0; it < iterations; it++) {
    const tess = voronoiSphere(current);
    for (let i = 0; i < current.length; i++) {
      const cell = tess.cells[i];
      if (!cell || cell.vertices.length === 0) continue;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const v of cell.vertices) {
        sx += v.x;
        sy += v.y;
        sz += v.z;
      }
      const slen = Math.hypot(sx, sy, sz);
      if (slen < 1e-12) continue;
      const cx = sx / slen;
      const cy = sy / slen;
      const cz = sz / slen;
      const nx = current[i].x + (cx - current[i].x) * LLOYD_RELAXATION_FACTOR;
      const ny = current[i].y + (cy - current[i].y) * LLOYD_RELAXATION_FACTOR;
      const nz = current[i].z + (cz - current[i].z) * LLOYD_RELAXATION_FACTOR;
      const nlen = Math.hypot(nx, ny, nz);
      if (nlen < 1e-12) continue;
      current[i].x = nx / nlen;
      current[i].y = ny / nlen;
      current[i].z = nz / nlen;
    }
  }
  return current;
}
