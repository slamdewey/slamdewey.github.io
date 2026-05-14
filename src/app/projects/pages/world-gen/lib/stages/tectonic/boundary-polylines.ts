/**
 * Vectorize plate boundaries as sub-pixel polylines on the sphere, with
 * per-vertex falloff widths that taper smoothly at triple-junctions.
 *
 * Phase A4 of the spherical-math plan. Replaces the pixel-grid boundary
 * detection in rasterize.ts Pass 5 with smoothed, sub-pixel-accurate seed
 * geometry, and gives each polyline a per-side `widthA / widthB` that
 * shrinks toward the minimum of all converging boundaries at junctions —
 * fixing the "wide stamp wraps around the corner" taper artifact.
 *
 * The trace operates in *pixel-corner* coordinates: corner (cx, cy) is the
 * point where pixels (cx-1, cy-1), (cx, cy-1), (cx-1, cy), (cx, cy) meet.
 * Pole rows (cy = 0 and cy = H) are *single* virtual junctions — every
 * polyline that reaches the pole terminates at one of these two virtual
 * corners, since the entire pole row maps to one geometric point on the
 * sphere.
 */

import { mod } from '@lib/math';
import { BoundaryInfo, InteractionType } from './types';

// Duplicated from rasterize.ts. The two callers share the calibration; if
// they ever drift apart the boundary widths used for Dijkstra search radius
// and for stamping will mismatch.
const FALLOFF_MULTIPLIER: Record<InteractionType, number> = {
  [InteractionType.Collision]: 1.8,
  [InteractionType.Subduction]: 1.4,
  [InteractionType.OceanicConvergence]: 0.7,
  [InteractionType.ContinentalRift]: 1.2,
  [InteractionType.OceanicRidge]: 0.8,
  [InteractionType.Transform]: 0.35,
};
const SUBDUCTION_TRENCH_MULTIPLIER = 0.4;

export interface BoundaryPolyline {
  /** Index into the `boundaries` array this polyline was traced for. */
  boundaryIndex: number;
  plateA: number;
  plateB: number;
  /**
   * Pixel-corner coordinates of the vertices, packed as [cx0, cy0, cx1, cy1, ...].
   * cx is taken mod width (longitude wrap); cy is in `[0, H]`. The two virtual
   * pole "corners" use sentinel cy = 0 / cy = H with the polyline endpoint
   * snapped to the corresponding pole-row crossing longitude.
   */
  vertices: Float32Array;
  /**
   * Per-vertex falloff width in equator-pixel-equivalent, packed as
   * [widthA0, widthB0, widthA1, widthB1, ...]. widthA is the stamp width on
   * plateA's side, widthB on plateB's. Widths taper down to `min`-of-
   * converging-boundaries at junction endpoints.
   */
  widths: Float32Array;
  isClosed: boolean;
}

/**
 * Convenience: per-side falloff width in equator-pixel-equivalent for a
 * given boundary, evaluated on the requested side. Mirrors the inline logic
 * in rasterize.ts but lives here so polyline construction can call it.
 */
function falloffForSide(b: BoundaryInfo, pixelPlate: number, baseFalloff: number, falloffScale: number): number {
  const isSubducting = b.subductingPlate === pixelPlate;
  let mult = FALLOFF_MULTIPLIER[b.interactionType];
  if (b.interactionType === InteractionType.Subduction && isSubducting) mult = SUBDUCTION_TRENCH_MULTIPLIER;
  else if (b.interactionType === InteractionType.OceanicConvergence && isSubducting)
    mult = SUBDUCTION_TRENCH_MULTIPLIER;
  return baseFalloff * mult * falloffScale;
}

/**
 * Iterate over corners in `[0, W) × [1, H-1]` (strictly interior in y) and
 * return the four plate ids surrounding each. Pixel positions use longitude
 * wrap. Corners at cy = 0 and cy = H are not handled here; the trace folds
 * polylines that reach those rows into two virtual pole junctions.
 */
function plateAt(plateMap: Int32Array, width: number, x: number, y: number): number {
  return plateMap[y * width + mod(x, width)];
}

interface TraceContext {
  width: number;
  height: number;
  plateMap: Int32Array;
  /** Total corner count for indexing: width × (height + 1). */
  cornerCount: number;
  /** Two synthetic pole-corner ids appended after the normal corners. */
  northPoleCorner: number;
  southPoleCorner: number;
}

function cornerIdx(ctx: TraceContext, cx: number, cy: number): number {
  return cy * ctx.width + mod(cx, ctx.width);
}

interface CornerEdge {
  /** Index of the corner this edge leads to. May be a pole-corner sentinel. */
  to: number;
  /** Plate pair, lo < hi. */
  lo: number;
  hi: number;
  /** Globally-unique edge id, set when emitted into the edge list. */
  edgeId: number;
}

interface BoundaryEdge {
  from: number;
  to: number;
  lo: number;
  hi: number;
}

/**
 * Enumerate all boundary edges (corner-to-corner segments where the two
 * adjacent pixels are on different plates). Each edge is emitted once,
 * with `from < to` for ordinary edges. Edges that cross into a pole row
 * use the pole-corner sentinel as `to`.
 */
function buildBoundaryEdges(ctx: TraceContext): { edges: BoundaryEdge[]; perCorner: CornerEdge[][] } {
  const { width, height, plateMap, northPoleCorner, southPoleCorner } = ctx;
  const edges: BoundaryEdge[] = [];
  // Map from corner id (including pole sentinels) to its incident edges.
  const perCorner: CornerEdge[][] = new Array(southPoleCorner + 1);
  for (let i = 0; i < perCorner.length; i++) perCorner[i] = [];

  const emit = (fromCorner: number, toCorner: number, a: number, b: number): void => {
    if (a === b || a < 0 || b < 0) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const edgeId = edges.length;
    edges.push({ from: fromCorner, to: toCorner, lo, hi });
    perCorner[fromCorner].push({ to: toCorner, lo, hi, edgeId });
    perCorner[toCorner].push({ to: fromCorner, lo, hi, edgeId });
  };

  // Interior corners: cy ∈ [1, H-1], cx ∈ [0, W). For each, look at the 4
  // surrounding pixels and emit boundary edges along N, E directions only
  // (S and W are emitted by the corresponding neighbor). Edges that cross
  // into rows -1 or H are redirected to a pole sentinel corner.
  for (let cy = 1; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const fromId = cornerIdx(ctx, cx, cy);
      const NW = plateAt(plateMap, width, cx - 1, cy - 1);
      const NE = plateAt(plateMap, width, cx, cy - 1);
      const SW = plateAt(plateMap, width, cx - 1, cy);
      const SE = plateAt(plateMap, width, cx, cy);

      // N edge: between NW (cx-1, cy-1) and NE (cx, cy-1). Target corner (cx, cy-1).
      // If cy-1 === 0 the target is on the north-pole row → use sentinel.
      // Each vertical inter-corner edge is owned by its south corner (this
      // corner) so it's emitted exactly once; the corresponding S-edge
      // emission only fires at the south pole row.
      if (NW !== NE) {
        const to = cy - 1 === 0 ? northPoleCorner : cornerIdx(ctx, cx, cy - 1);
        emit(fromId, to, NW, NE);
      }
      // E edge: between NE (cx, cy-1) and SE (cx, cy). Target corner (cx+1, cy).
      if (NE !== SE) {
        const to = cornerIdx(ctx, cx + 1, cy);
        emit(fromId, to, NE, SE);
      }
      // W edge: between NW (cx-1, cy-1) and SW (cx-1, cy). Target (cx-1, cy).
      // Only emit if the target's column index hasn't already emitted us — i.e.,
      // emit only when this corner's cx is the larger of (cx, cx-1) under wrap.
      // Simpler: skip W (it gets emitted as E from corner (cx-1, cy)).
      // S edge: between SW (cx-1, cy) and SE (cx, cy). Target (cx, cy+1).
      // If cy === H-1 → target row is H → pole sentinel.
      if (SW !== SE) {
        const to = cy === height - 1 ? southPoleCorner : cornerIdx(ctx, cx, cy + 1);
        if (to === southPoleCorner) emit(fromId, to, SW, SE);
        // else: emitted as N edge from the south-neighbor corner already.
      }
    }
  }

  return { edges, perCorner };
}

/**
 * Trace polylines from the boundary-edge graph: walk through degree-2
 * single-pair corners until a junction (different plate pair count, or
 * a pole sentinel) is reached. Closed loops with no junctions become
 * cyclic polylines.
 *
 * Returns one entry per traced polyline. Each polyline's plate pair (lo, hi)
 * matches its boundary in the supplied `boundaries` array.
 */
function tracePolylines(
  ctx: TraceContext,
  edges: BoundaryEdge[],
  perCorner: CornerEdge[][],
  plateCount: number,
  boundariesByPair: Map<number, number>
): BoundaryPolyline[] {
  const polylines: BoundaryPolyline[] = [];
  const edgeVisited = new Uint8Array(edges.length);

  const pairKey = (lo: number, hi: number): number => lo * plateCount + hi;

  /**
   * Find the unique other edge at `corner` matching plate pair (lo, hi),
   * excluding the edge we arrived on. Returns null if the count isn't
   * exactly 1 — meaning the polyline terminates here (junction).
   */
  const nextEdgeAt = (corner: number, lo: number, hi: number, excludeEdgeId: number): CornerEdge | null => {
    const incident = perCorner[corner];
    let found: CornerEdge | null = null;
    for (const e of incident) {
      if (e.edgeId === excludeEdgeId) continue;
      if (e.lo === lo && e.hi === hi) {
        if (found !== null) return null; // ≥2 candidates → junction
        found = e;
      }
    }
    return found;
  };

  for (let startId = 0; startId < edges.length; startId++) {
    if (edgeVisited[startId]) continue;
    const startEdge = edges[startId];
    const lo = startEdge.lo;
    const hi = startEdge.hi;

    // Walk forward from startEdge.from in the direction of startEdge.to.
    const forwardCorners: number[] = [startEdge.from];
    edgeVisited[startId] = 1;
    let curCorner = startEdge.to;
    let cameFromEdge = startId;
    let closed = false;
    while (true) {
      forwardCorners.push(curCorner);
      if (curCorner === ctx.northPoleCorner || curCorner === ctx.southPoleCorner) break;
      const next = nextEdgeAt(curCorner, lo, hi, cameFromEdge);
      if (!next) break;
      if (edgeVisited[next.edgeId]) {
        // Closed loop — we walked around back to startEdge.
        closed = true;
        break;
      }
      edgeVisited[next.edgeId] = 1;
      cameFromEdge = next.edgeId;
      curCorner = next.to;
    }

    // Walk backward from startEdge.from in the opposite direction.
    const backwardCorners: number[] = [];
    if (!closed) {
      let bwdCorner = startEdge.from;
      let bwdFromEdge = startId;
      while (true) {
        if (bwdCorner === ctx.northPoleCorner || bwdCorner === ctx.southPoleCorner) break;
        const next = nextEdgeAt(bwdCorner, lo, hi, bwdFromEdge);
        if (!next) break;
        if (edgeVisited[next.edgeId]) break;
        edgeVisited[next.edgeId] = 1;
        bwdFromEdge = next.edgeId;
        bwdCorner = next.to;
        backwardCorners.push(bwdCorner);
      }
    }

    // Concatenate: reversed-backward + forward.
    const fullCorners = [...backwardCorners.reverse(), ...forwardCorners];

    // Resolve the boundary index for this (lo, hi) pair.
    const boundaryIndex = boundariesByPair.get(pairKey(lo, hi));
    if (boundaryIndex === undefined) continue; // shouldn't happen for real plate pairs

    // Convert corner indices to (cx, cy) pixel-corner coordinates.
    const vertices = new Float32Array(fullCorners.length * 2);
    for (let i = 0; i < fullCorners.length; i++) {
      const c = fullCorners[i];
      let cx: number;
      let cy: number;
      if (c === ctx.northPoleCorner) {
        // Snap pole-corner to the longitude of the closest non-pole vertex.
        const adj = i === 0 ? fullCorners[i + 1] : fullCorners[i - 1];
        cx = adj === ctx.northPoleCorner || adj === ctx.southPoleCorner ? 0 : adj % ctx.width;
        cy = 0;
      } else if (c === ctx.southPoleCorner) {
        const adj = i === 0 ? fullCorners[i + 1] : fullCorners[i - 1];
        cx = adj === ctx.northPoleCorner || adj === ctx.southPoleCorner ? 0 : adj % ctx.width;
        cy = ctx.height;
      } else {
        cx = c % ctx.width;
        cy = (c - cx) / ctx.width;
      }
      vertices[i * 2] = cx;
      vertices[i * 2 + 1] = cy;
    }

    polylines.push({
      boundaryIndex,
      plateA: lo,
      plateB: hi,
      vertices,
      widths: new Float32Array(fullCorners.length * 2), // filled later
      isClosed: closed,
    });
  }

  return polylines;
}

/**
 * Chaikin corner-cutting in pixel-corner space. Each segment AB becomes A',
 * B' at the 1/4 and 3/4 points along AB. Junction endpoints (the first and
 * last vertices of an open polyline) are anchored — otherwise plate corners
 * would gap or overlap after smoothing. Closed cyclic polylines smooth all
 * vertices.
 *
 * Pixel-corner space is fine for short-distance smoothing because over a few
 * pixels the equirect projection is approximately a tangent plane, even at
 * high latitudes. Longer-range smoothing would need slerp on the sphere.
 */
function chaikinSmooth(polylines: BoundaryPolyline[], width: number, iterations: number): void {
  for (let it = 0; it < iterations; it++) {
    for (const pl of polylines) {
      const n = pl.vertices.length / 2;
      if (n < 3) continue;
      // Open polyline: keep first + last verts, plus 2 cut-corner verts per
      // segment → 2 + 2(n-1) = 2n verts. Closed polyline: 2 cut-corner verts
      // per segment → 2n verts. Both cases need 4n float slots; allocate
      // 4(n+1) to absorb off-by-one issues from rounding step counts.
      const out = new Float32Array(4 * (n + 1));
      let outIdx = 0;
      const writeVert = (x: number, y: number): void => {
        out[outIdx++] = x;
        out[outIdx++] = y;
      };
      const lerpX = (a: number, b: number, t: number): number => {
        // Longitude lerp with shortest-arc handling.
        let d = b - a;
        if (d > width / 2) d -= width;
        else if (d < -width / 2) d += width;
        return mod(a + d * t, width);
      };
      if (!pl.isClosed) writeVert(pl.vertices[0], pl.vertices[1]);
      const segCount = pl.isClosed ? n : n - 1;
      for (let s = 0; s < segCount; s++) {
        const i = s;
        const j = pl.isClosed ? (s + 1) % n : s + 1;
        const ax = pl.vertices[i * 2];
        const ay = pl.vertices[i * 2 + 1];
        const bx = pl.vertices[j * 2];
        const by = pl.vertices[j * 2 + 1];
        // Q at t=1/4, R at t=3/4.
        const qx = lerpX(ax, bx, 0.25);
        const qy = ay + (by - ay) * 0.25;
        const rx = lerpX(ax, bx, 0.75);
        const ry = ay + (by - ay) * 0.75;
        writeVert(qx, qy);
        writeVert(rx, ry);
      }
      if (!pl.isClosed) writeVert(pl.vertices[(n - 1) * 2], pl.vertices[(n - 1) * 2 + 1]);
      pl.vertices = out.subarray(0, outIdx);
      pl.widths = new Float32Array((outIdx / 2) * 2); // resized; will be refilled
    }
  }
}

/**
 * Initialize per-vertex (widthA, widthB) for every polyline from its
 * boundary's own per-side falloff width. The junction-min taper is applied
 * by `taperWidthsAtJunctions` afterwards.
 */
function initVertexWidths(
  polylines: BoundaryPolyline[],
  boundaries: BoundaryInfo[],
  baseFalloff: number,
  falloffScale: number
): void {
  for (const pl of polylines) {
    const b = boundaries[pl.boundaryIndex];
    const wA = falloffForSide(b, b.plateA, baseFalloff, falloffScale);
    const wB = falloffForSide(b, b.plateB, baseFalloff, falloffScale);
    const n = pl.vertices.length / 2;
    pl.widths = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) {
      pl.widths[v * 2] = wA;
      pl.widths[v * 2 + 1] = wB;
    }
  }
}

/**
 * Apply junction-min taper to per-vertex widths: at each junction (pixel-
 * corner shared by ≥2 polylines' endpoints), replace each polyline's
 * endpoint width with the minimum width across all converging polylines
 * for the matching plate. Then 1D-smooth along the polyline so the taper
 * spans several vertices instead of dropping at the endpoint.
 */
function taperWidthsAtJunctions(polylines: BoundaryPolyline[], width: number, taperIterations: number): void {
  // Junction key: round (cx, cy) to integer corner id with longitude wrap.
  const junctionKey = (cx: number, cy: number): number => {
    const ix = mod(Math.round(cx) | 0, width);
    const iy = Math.round(cy) | 0;
    return iy * width + ix;
  };

  interface JunctionRef {
    pi: number;
    endpoint: 'first' | 'last';
    plateA: number;
    plateB: number;
  }
  const junctionRefs = new Map<number, JunctionRef[]>();
  for (let pi = 0; pi < polylines.length; pi++) {
    const pl = polylines[pi];
    if (pl.isClosed) continue;
    const n = pl.vertices.length / 2;
    if (n < 1) continue;
    const firstKey = junctionKey(pl.vertices[0], pl.vertices[1]);
    const lastKey = junctionKey(pl.vertices[(n - 1) * 2], pl.vertices[(n - 1) * 2 + 1]);
    const ref = (key: number, ep: 'first' | 'last'): void => {
      const arr = junctionRefs.get(key) ?? [];
      arr.push({ pi, endpoint: ep, plateA: pl.plateA, plateB: pl.plateB });
      junctionRefs.set(key, arr);
    };
    ref(firstKey, 'first');
    if (n > 1) ref(lastKey, 'last');
  }

  // At each junction, compute the min width per *plate* across all
  // converging polylines. Apply that min to each polyline's endpoint on
  // the matching plate side.
  for (const refs of junctionRefs.values()) {
    if (refs.length < 2) continue;
    // Gather minimum width per plate id (the plate on which the stamp would
    // land for that polyline's side).
    const minWByPlate = new Map<number, number>();
    for (const r of refs) {
      const pl = polylines[r.pi];
      const vIdx = r.endpoint === 'first' ? 0 : pl.vertices.length / 2 - 1;
      const wA = pl.widths[vIdx * 2];
      const wB = pl.widths[vIdx * 2 + 1];
      const prevA = minWByPlate.get(r.plateA) ?? Infinity;
      const prevB = minWByPlate.get(r.plateB) ?? Infinity;
      if (wA < prevA) minWByPlate.set(r.plateA, wA);
      if (wB < prevB) minWByPlate.set(r.plateB, wB);
    }
    // Apply the per-plate min to each polyline's endpoint slot.
    for (const r of refs) {
      const pl = polylines[r.pi];
      const vIdx = r.endpoint === 'first' ? 0 : pl.vertices.length / 2 - 1;
      const minA = minWByPlate.get(r.plateA);
      const minB = minWByPlate.get(r.plateB);
      if (minA !== undefined) pl.widths[vIdx * 2] = minA;
      if (minB !== undefined) pl.widths[vIdx * 2 + 1] = minB;
    }
  }

  // 1D box-smoothing along each polyline so the junction-min taper spreads
  // over several vertices instead of jumping at one endpoint.
  for (let it = 0; it < taperIterations; it++) {
    for (const pl of polylines) {
      const n = pl.vertices.length / 2;
      if (n < 3) continue;
      const tmp = new Float32Array(pl.widths.length);
      for (let v = 0; v < n; v++) {
        const isEndpoint = !pl.isClosed && (v === 0 || v === n - 1);
        if (isEndpoint) {
          tmp[v * 2] = pl.widths[v * 2];
          tmp[v * 2 + 1] = pl.widths[v * 2 + 1];
          continue;
        }
        const prev = pl.isClosed && v === 0 ? n - 1 : v - 1;
        const next = pl.isClosed && v === n - 1 ? 0 : v + 1;
        tmp[v * 2] = (pl.widths[prev * 2] + pl.widths[v * 2] + pl.widths[next * 2]) / 3;
        tmp[v * 2 + 1] = (pl.widths[prev * 2 + 1] + pl.widths[v * 2 + 1] + pl.widths[next * 2 + 1]) / 3;
      }
      pl.widths.set(tmp);
    }
  }
}

/**
 * Public entry point: trace + smooth + width-taper.
 */
export function buildBoundaryPolylines(
  plateMap: Int32Array,
  boundaries: BoundaryInfo[],
  plateCount: number,
  baseFalloff: number,
  falloffScale: number,
  width: number,
  height: number,
  chaikinIterations = 2,
  widthTaperIterations = 20
): BoundaryPolyline[] {
  const cornerCount = width * (height + 1);
  const ctx: TraceContext = {
    width,
    height,
    plateMap,
    cornerCount,
    northPoleCorner: cornerCount,
    southPoleCorner: cornerCount + 1,
  };

  // Boundary lookup table: plate-pair (lo, hi) → index into `boundaries`.
  const boundariesByPair = new Map<number, number>();
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const lo = Math.min(b.plateA, b.plateB);
    const hi = Math.max(b.plateA, b.plateB);
    boundariesByPair.set(lo * plateCount + hi, i);
  }

  const { edges, perCorner } = buildBoundaryEdges(ctx);
  const polylines = tracePolylines(ctx, edges, perCorner, plateCount, boundariesByPair);
  chaikinSmooth(polylines, width, chaikinIterations);
  initVertexWidths(polylines, boundaries, baseFalloff, falloffScale);
  taperWidthsAtJunctions(polylines, width, widthTaperIterations);
  return polylines;
}

/**
 * Rasterize every polyline into per-boundary seed pixel coordinates +
 * per-pixel widthA/widthB. Returns parallel arrays indexed by boundary index.
 * Pixels that are never visited keep `widthA = widthB = 0`, which the
 * downstream Dijkstra interprets as "no seed here for this boundary."
 *
 * Step size is half a pixel along the polyline in pixel-corner space —
 * dense enough that consecutive samples never skip a pixel.
 */
export interface RasterizedBoundary {
  seedMask: Uint8Array;
  widthA: Float32Array;
  widthB: Float32Array;
  maxWidth: number;
}

export function rasterizePolylines(
  polylines: BoundaryPolyline[],
  numBoundaries: number,
  plateMap: Int32Array,
  width: number,
  height: number
): RasterizedBoundary[] {
  const out: RasterizedBoundary[] = new Array(numBoundaries);
  for (let i = 0; i < numBoundaries; i++) {
    out[i] = {
      seedMask: new Uint8Array(width * height),
      widthA: new Float32Array(width * height),
      widthB: new Float32Array(width * height),
      maxWidth: 0,
    };
  }

  const markSeed = (
    bIdx: number,
    px: number,
    py: number,
    wA: number,
    wB: number,
    plateA: number,
    plateB: number
  ): void => {
    if (py < 0 || py >= height) return;
    const idx = py * width + mod(px, width);
    const p = plateMap[idx];
    if (p !== plateA && p !== plateB) return;
    const o = out[bIdx];
    o.seedMask[idx] = 1;
    // When multiple polyline samples cover the same pixel (the polyline is
    // dense vs. pixel grid, or curves back on itself), keep the *smaller*
    // width. Taking MAX would override the tapered tip with the wider
    // mid-polyline value at junction-adjacent pixels and erase the C-style
    // narrowing. MIN preserves the taper monotonically. The `=== 0`
    // sentinel handles the first write (uninitialized buffer is zero).
    if (o.widthA[idx] === 0 || wA < o.widthA[idx]) o.widthA[idx] = wA;
    if (o.widthB[idx] === 0 || wB < o.widthB[idx]) o.widthB[idx] = wB;
  };

  for (const pl of polylines) {
    const b = pl.boundaryIndex;
    if (b < 0 || b >= numBoundaries) continue;
    const n = pl.vertices.length / 2;
    if (n < 2) {
      if (n === 1) {
        // Degenerate single-vertex polyline. Stamp the seed at its pixel.
        const cx = pl.vertices[0];
        const cy = pl.vertices[1];
        markSeed(b, Math.floor(cx), Math.floor(cy), pl.widths[0], pl.widths[1], pl.plateA, pl.plateB);
      }
      continue;
    }
    const segCount = pl.isClosed ? n : n - 1;
    for (let s = 0; s < segCount; s++) {
      const i = s;
      const j = pl.isClosed ? (s + 1) % n : s + 1;
      const ax = pl.vertices[i * 2];
      const ay = pl.vertices[i * 2 + 1];
      const bx = pl.vertices[j * 2];
      const by = pl.vertices[j * 2 + 1];
      // Longitude shortest-arc unwrap so length-based stepping works.
      let dx = bx - ax;
      if (dx > width / 2) dx -= width;
      else if (dx < -width / 2) dx += width;
      const dy = by - ay;
      const segLen = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(segLen * 2)); // ~0.5px step
      const wAi = pl.widths[i * 2];
      const wBi = pl.widths[i * 2 + 1];
      const wAj = pl.widths[j * 2];
      const wBj = pl.widths[j * 2 + 1];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const sx = mod(ax + dx * t, width);
        const sy = ay + dy * t;
        const wA = wAi * (1 - t) + wAj * t;
        const wB = wBi * (1 - t) + wBj * t;
        // Mark both candidate pixels (the polyline runs *between* pixels,
        // so both flanking pixels are candidate seeds — the plate filter
        // decides which actually take the seed).
        const px = Math.floor(sx);
        const py = Math.floor(sy);
        markSeed(b, px, py, wA, wB, pl.plateA, pl.plateB);
        markSeed(b, px - 1, py, wA, wB, pl.plateA, pl.plateB);
        markSeed(b, px, py - 1, wA, wB, pl.plateA, pl.plateB);
        markSeed(b, px - 1, py - 1, wA, wB, pl.plateA, pl.plateB);
      }
    }
  }

  // Track per-boundary max width for Dijkstra search radius.
  for (const o of out) {
    let m = 0;
    for (let i = 0; i < o.widthA.length; i++) {
      if (o.widthA[i] > m) m = o.widthA[i];
      if (o.widthB[i] > m) m = o.widthB[i];
    }
    o.maxWidth = m;
  }

  return out;
}
