/**
 * Plate-boundary polylines assembled from the PRE-CALCULATED Voronoi edges.
 *
 * Each plate boundary is the set of cell-edge great-circle arcs whose two cells
 * landed on different plates (`InterPlateArc`). This module chains those arcs
 * into ordered polylines per plate-pair (degree-2 walk in sphere-vertex space),
 * projects them to equirectangular pixel-corner coordinates, and emits the same
 * `BoundaryPolyline` shape the downstream rasterizer/Dijkstra stamp consumes.
 *
 * This replaces the old pixel-corner tracer that re-derived boundary geometry by
 * walking the `plateMap` raster (with virtual pole-corner junctions and Chaikin
 * smoothing to undo the staircase). The arcs are already the true smooth
 * boundary, so there is no staircase to smooth and no pole singularity to
 * special-case — chaining happens in 3D unit-vector space where the poles are
 * ordinary points. The only raster-space concern left is the antimeridian seam,
 * handled by the existing per-segment shortest-arc unwrap in `rasterizePolylines`
 * plus slerp subdivision that keeps every emitted segment short.
 *
 * Equirect grid convention (matches `voronoi-sphere.ts` / `properties.ts`):
 * row 0 = north pole, lat = π/2 − (row+0.5)/H·π; col 0 = lon = −π; wraps in x.
 */

import { mod } from '@lib/math';
import { arcLength, slerp } from '@lib/voronoi-edges';
import { type Vec3 } from '@lib/voronoi-sphere';
import { type InterPlateArc } from './boundaries';
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
   * cx is taken mod width (longitude wrap); cy is in `[0, H]` (0 = north pole).
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
 * given boundary, evaluated on the requested side.
 */
function falloffForSide(b: BoundaryInfo, pixelPlate: number, baseFalloff: number, falloffScale: number): number {
  const isSubducting = b.subductingPlate === pixelPlate;
  let mult = FALLOFF_MULTIPLIER[b.interactionType];
  if (b.interactionType === InteractionType.Subduction && isSubducting) mult = SUBDUCTION_TRENCH_MULTIPLIER;
  else if (b.interactionType === InteractionType.OceanicConvergence && isSubducting)
    mult = SUBDUCTION_TRENCH_MULTIPLIER;
  return baseFalloff * mult * falloffScale;
}

// ---------------------------------------------------------------------------
// Arc chaining (sphere-vertex space)
// ---------------------------------------------------------------------------

/** A chained boundary as unit-vector vertices, before pixel projection. */
export interface Vec3Polyline {
  plateLo: number;
  plateHi: number;
  /** Chained boundary vertices (Voronoi vertices) as unit vectors. */
  verts: Vec3[];
  /** Global canonical vertex id per entry in `verts` (for junction keying). */
  vertexIds: number[];
  isClosed: boolean;
}

const VERTEX_KEY_PRECISION = 1e6;

function vertexKey3(v: Vec3): string {
  return `${Math.round(v.x * VERTEX_KEY_PRECISION)},${Math.round(v.y * VERTEX_KEY_PRECISION)},${Math.round(
    v.z * VERTEX_KEY_PRECISION
  )}`;
}

/**
 * Chain inter-plate arcs into ordered polylines per plate-pair.
 *
 * Vertex identity is global (quantized endpoints), so arcs of *different* plate
 * pairs that meet at the same Voronoi vertex resolve to the same id — that's
 * how triple-junctions are detected: within one pair's group such a vertex has
 * incident degree ≠ 2 and terminates the walk.
 */
export function chainArcsIntoPolylines(arcs: InterPlateArc[], plateCount: number): Vec3Polyline[] {
  const vertexIdByKey = new Map<string, number>();
  const canonicalVerts: Vec3[] = [];
  const idOf = (v: Vec3): number => {
    const key = vertexKey3(v);
    let id = vertexIdByKey.get(key);
    if (id === undefined) {
      id = canonicalVerts.length;
      vertexIdByKey.set(key, id);
      canonicalVerts.push(v);
    }
    return id;
  };

  interface LocalArc {
    v0: number;
    v1: number;
  }
  const groups = new Map<number, LocalArc[]>();
  for (const arc of arcs) {
    const key = arc.plateLo * plateCount + arc.plateHi;
    const la: LocalArc = { v0: idOf(arc.a), v1: idOf(arc.b) };
    const g = groups.get(key);
    if (g) g.push(la);
    else groups.set(key, [la]);
  }

  const polylines: Vec3Polyline[] = [];
  for (const [key, group] of groups) {
    const plateLo = Math.floor(key / plateCount);
    const plateHi = key % plateCount;
    traceGroup(group, plateLo, plateHi, canonicalVerts, polylines);
  }
  return polylines;
}

/** Degree-2 walk over one plate-pair's arc set (mirrors the legacy corner walk). */
function traceGroup(
  group: { v0: number; v1: number }[],
  plateLo: number,
  plateHi: number,
  canonicalVerts: Vec3[],
  out: Vec3Polyline[]
): void {
  // Incident arcs per vertex within this pair group.
  const incident = new Map<number, { local: number; other: number }[]>();
  const add = (v: number, local: number, other: number): void => {
    const arr = incident.get(v);
    if (arr) arr.push({ local, other });
    else incident.set(v, [{ local, other }]);
  };
  for (let i = 0; i < group.length; i++) {
    add(group[i].v0, i, group[i].v1);
    add(group[i].v1, i, group[i].v0);
  }

  // Unique continuation at `cur` excluding the arc we came on; null at a
  // junction (degree ≠ 2 → not exactly one other incident arc).
  const nextAt = (cur: number, excludeLocal: number): { local: number; other: number } | null => {
    const arr = incident.get(cur);
    if (!arr) return null;
    let found: { local: number; other: number } | null = null;
    for (const e of arr) {
      if (e.local === excludeLocal) continue;
      if (found !== null) return null; // ≥2 continuations → junction
      found = e;
    }
    return found;
  };

  const visited = new Uint8Array(group.length);
  for (let start = 0; start < group.length; start++) {
    if (visited[start]) continue;
    visited[start] = 1;
    const a0 = group[start].v0;
    const a1 = group[start].v1;

    // Walk forward from a0 → a1 and beyond.
    const forward: number[] = [a0];
    let cur = a1;
    let came = start;
    let closed = false;
    while (true) {
      forward.push(cur);
      const next = nextAt(cur, came);
      if (!next) break;
      if (visited[next.local]) {
        closed = true;
        break;
      }
      visited[next.local] = 1;
      came = next.local;
      cur = next.other;
    }

    // Walk backward from a0 (open polylines only).
    const backward: number[] = [];
    if (!closed) {
      let bcur = a0;
      let bcame = start;
      while (true) {
        const next = nextAt(bcur, bcame);
        if (!next) break;
        if (visited[next.local]) break;
        visited[next.local] = 1;
        bcame = next.local;
        bcur = next.other;
        backward.push(bcur);
      }
    }

    const ids = [...backward.reverse(), ...forward];
    out.push({
      plateLo,
      plateHi,
      verts: ids.map((id) => canonicalVerts[id]),
      vertexIds: ids,
      isClosed: closed,
    });
  }
}

// ---------------------------------------------------------------------------
// Vec3 polyline → pixel-corner BoundaryPolyline
// ---------------------------------------------------------------------------

/** Pairs a projected polyline with its endpoint vertex ids for junction keying. */
interface PixelPolyline {
  polyline: BoundaryPolyline;
  startVid: number;
  endVid: number;
}

function projectVec3(v: Vec3, width: number, height: number, prevLon: number): { cx: number; cy: number; lon: number } {
  const z = v.z < -1 ? -1 : v.z > 1 ? 1 : v.z;
  const lat = Math.asin(z);
  // At a pole the longitude is undefined — inherit the previous vertex's lon.
  const lon = Math.hypot(v.x, v.y) < 1e-9 ? prevLon : Math.atan2(v.y, v.x);
  const cx = mod(((lon + Math.PI) / (2 * Math.PI)) * width, width);
  const cy = ((Math.PI / 2 - lat) / Math.PI) * height;
  return { cx, cy, lon };
}

/**
 * Project a chained Vec3 polyline to a pixel-corner `BoundaryPolyline`, slerp-
 * subdividing each arc to ≈2 px so every emitted segment is short in longitude
 * (unambiguous seam unwrap) and curvature is preserved. Widths are sized but
 * left zero — `initVertexWidths` fills them.
 */
function vec3PolylineToPixelPolyline(
  pl: Vec3Polyline,
  boundaryIndex: number,
  width: number,
  height: number
): PixelPolyline {
  const pixelsPerRad = width / (2 * Math.PI);
  const n = pl.verts.length;

  const pts: Vec3[] = [];
  const segCount = pl.isClosed ? n : n - 1;
  for (let s = 0; s < segCount; s++) {
    const a = pl.verts[s];
    const b = pl.verts[(s + 1) % n];
    const steps = Math.max(1, Math.ceil((arcLength(a, b) * pixelsPerRad) / 2));
    // Emit [0, steps) per segment; the endpoint is the next segment's start.
    for (let k = 0; k < steps; k++) {
      pts.push(k === 0 ? a : slerp(a, b, k / steps));
    }
  }
  if (!pl.isClosed) pts.push(pl.verts[n - 1]);

  // Seed prevLon from the first non-pole point so a leading pole vertex gets a
  // sane longitude.
  let prevLon = 0;
  for (const p of pts) {
    if (Math.hypot(p.x, p.y) >= 1e-9) {
      prevLon = Math.atan2(p.y, p.x);
      break;
    }
  }

  const vertices = new Float32Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    const pr = projectVec3(pts[i], width, height, prevLon);
    prevLon = pr.lon;
    vertices[i * 2] = pr.cx;
    vertices[i * 2 + 1] = pr.cy;
  }

  const polyline: BoundaryPolyline = {
    boundaryIndex,
    plateA: pl.plateLo,
    plateB: pl.plateHi,
    vertices,
    widths: new Float32Array(pts.length * 2),
    isClosed: pl.isClosed,
  };
  return { polyline, startVid: pl.vertexIds[0], endVid: pl.vertexIds[n - 1] };
}

/**
 * Initialize per-vertex (widthA, widthB) for every polyline from its
 * boundary's own per-side falloff width. The junction-min taper is applied
 * afterwards.
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
 * Apply junction-min taper to per-vertex widths, keyed on the shared Voronoi
 * vertex id (exact topological junctions — no pixel-corner rounding). At each
 * junction (a vertex shared by ≥2 polylines' endpoints), replace each
 * polyline's endpoint width with the minimum across all converging polylines
 * for the matching plate, then 1-D box-smooth so the taper spans several
 * vertices instead of dropping at the endpoint.
 */
function taperWidthsAtJunctionsByVertex(items: PixelPolyline[], taperIterations: number): void {
  interface JunctionRef {
    pi: number;
    endpoint: 'first' | 'last';
    plateA: number;
    plateB: number;
  }
  const junctionRefs = new Map<number, JunctionRef[]>();
  for (let pi = 0; pi < items.length; pi++) {
    const it = items[pi];
    const pl = it.polyline;
    if (pl.isClosed) continue;
    const n = pl.vertices.length / 2;
    if (n < 1) continue;
    const ref = (key: number, ep: 'first' | 'last'): void => {
      const arr = junctionRefs.get(key) ?? [];
      arr.push({ pi, endpoint: ep, plateA: pl.plateA, plateB: pl.plateB });
      junctionRefs.set(key, arr);
    };
    ref(it.startVid, 'first');
    if (n > 1) ref(it.endVid, 'last');
  }

  for (const refs of junctionRefs.values()) {
    if (refs.length < 2) continue;
    const minWByPlate = new Map<number, number>();
    for (const r of refs) {
      const pl = items[r.pi].polyline;
      const vIdx = r.endpoint === 'first' ? 0 : pl.vertices.length / 2 - 1;
      const wA = pl.widths[vIdx * 2];
      const wB = pl.widths[vIdx * 2 + 1];
      const prevA = minWByPlate.get(r.plateA) ?? Infinity;
      const prevB = minWByPlate.get(r.plateB) ?? Infinity;
      if (wA < prevA) minWByPlate.set(r.plateA, wA);
      if (wB < prevB) minWByPlate.set(r.plateB, wB);
    }
    for (const r of refs) {
      const pl = items[r.pi].polyline;
      const vIdx = r.endpoint === 'first' ? 0 : pl.vertices.length / 2 - 1;
      const minA = minWByPlate.get(r.plateA);
      const minB = minWByPlate.get(r.plateB);
      if (minA !== undefined) pl.widths[vIdx * 2] = minA;
      if (minB !== undefined) pl.widths[vIdx * 2 + 1] = minB;
    }
  }

  for (let it = 0; it < taperIterations; it++) {
    for (const item of items) {
      const pl = item.polyline;
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
 * Public entry point: project the pre-chained arc polylines to pixel-corner
 * `BoundaryPolyline`s, init widths, and taper at junctions. The chaining itself
 * (`chainArcsIntoPolylines`) runs once upstream so the result can be shared with
 * the exposed `boundaryArcs` geometry channel.
 */
export function buildBoundaryPolylinesFromArcs(
  chains: Vec3Polyline[],
  boundaries: BoundaryInfo[],
  plateCount: number,
  baseFalloff: number,
  falloffScale: number,
  width: number,
  height: number,
  widthTaperIterations = 20
): BoundaryPolyline[] {
  // Boundary lookup table: plate-pair (lo, hi) → index into `boundaries`.
  const boundariesByPair = new Map<number, number>();
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const lo = Math.min(b.plateA, b.plateB);
    const hi = Math.max(b.plateA, b.plateB);
    boundariesByPair.set(lo * plateCount + hi, i);
  }

  const items: PixelPolyline[] = [];
  for (const chain of chains) {
    if (chain.verts.length < 1) continue;
    const boundaryIndex = boundariesByPair.get(chain.plateLo * plateCount + chain.plateHi);
    if (boundaryIndex === undefined) continue; // shouldn't happen for real plate pairs
    items.push(vec3PolylineToPixelPolyline(chain, boundaryIndex, width, height));
  }

  const polylines = items.map((it) => it.polyline);
  initVertexWidths(polylines, boundaries, baseFalloff, falloffScale);
  taperWidthsAtJunctionsByVertex(items, widthTaperIterations);
  return polylines;
}

// ---------------------------------------------------------------------------
// Rasterization (unchanged from the pixel-tracer era — consumes BoundaryPolyline)
// ---------------------------------------------------------------------------

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
