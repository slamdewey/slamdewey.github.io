/**
 * Spatial index for nearest-polyline-segment queries on the sphere.
 *
 * Phase A5 of the spherical-math plan: replace pixel-grid stamping with
 * analytical queries that can be evaluated at any render resolution. The
 * index needs to answer, in roughly O(1) per query:
 *
 *   "Given a position (lon, lat), what is the closest boundary polyline
 *    segment, what is the signed distance to it, and which side am I on?"
 *
 * Implementation: equirectangular grid bucket. Each cell stores indices of
 * polyline segments whose bounding box (in pixel-corner space, with
 * longitude wrap) touches the cell. Queries pull all segments from the
 * cell containing the query point plus a small neighbor radius, then run
 * an exact closest-point-on-segment test against each.
 *
 * Bucket resolution is chosen so the average cell contains O(1) segments
 * for realistic plate counts (32 plates × ~5 polylines × ~40 verts ≈ 6400
 * segments). At a default 64×32 bucket grid, that's ~3 segments/cell.
 */

import { mod } from '@lib/math';
import { BoundaryPolyline } from './boundary-polylines';

export interface NearestPolyline {
  /** Polyline that owns the closest segment, or null if no polylines exist. */
  polyline: BoundaryPolyline | null;
  /** Segment index within the polyline: closest segment is `polyline.vertices[segIdx*2 .. segIdx*2+3]`. */
  segIdx: number;
  /** Parametric position along the segment, t ∈ [0, 1]. 0 = segment start, 1 = end. */
  t: number;
  /** Great-circle distance from query point to the closest point on segment, in pixel-corner units (matches polyline vertex space). */
  dist: number;
  /**
   * Signed offset from the query point onto the segment's perpendicular axis.
   * Positive means the query point is on the side of the segment from which
   * `polyline.plateA` faces; negative means `polyline.plateB`'s side.
   * Useful for distinguishing which plate of the pair the query is "in"
   * without needing a separate plate-membership lookup.
   */
  side: number;
}

export class PolylineSpatialIndex {
  /**
   * Bucket grid in pixel-corner space. `bucketGridW × bucketGridH` cells,
   * each cell stores `segmentRefs[start..end)`. Cell at bucket-coord (bx, by)
   * occupies pixel-corner space `[bx*cellW, (bx+1)*cellW) × [by*cellH, (by+1)*cellH)`,
   * with x wrapping and y clamped to `[0, height]`.
   */
  private readonly bucketGridW: number;
  private readonly bucketGridH: number;
  private readonly cellW: number;
  private readonly cellH: number;
  /** Flattened `[polylineIdx, segIdx, polylineIdx, segIdx, ...]` per bucket cell, dense. */
  private readonly segmentRefs: Int32Array;
  /** Per-bucket [start, end) offsets into `segmentRefs`. */
  private readonly bucketOffsets: Int32Array;

  constructor(
    private readonly polylines: BoundaryPolyline[],
    private readonly worldWidth: number,
    private readonly worldHeight: number
  ) {
    // Bucket grid scales with map size. ~32 buckets per equator-pixel on each
    // axis keeps cells small enough that ~1–3 segments land per cell on
    // realistic plate counts.
    this.bucketGridW = Math.max(8, Math.min(128, Math.round(worldWidth / 16)));
    this.bucketGridH = Math.max(4, Math.min(64, Math.round(worldHeight / 16)));
    this.cellW = worldWidth / this.bucketGridW;
    this.cellH = worldHeight / this.bucketGridH;

    // Two-pass build: count refs per bucket, allocate, fill.
    const numBuckets = this.bucketGridW * this.bucketGridH;
    const counts = new Int32Array(numBuckets);

    const visitSegmentCells = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      fn: (bucketIdx: number) => void
    ): void => {
      // Bounding box, handling longitude wrap by emitting both halves when
      // the segment crosses the antimeridian.
      let dx = bx - ax;
      if (dx > this.worldWidth / 2) dx -= this.worldWidth;
      else if (dx < -this.worldWidth / 2) dx += this.worldWidth;
      const minXRaw = Math.min(ax, ax + dx);
      const maxXRaw = Math.max(ax, ax + dx);
      const minY = Math.max(0, Math.min(ay, by) - 0.5);
      const maxY = Math.min(this.worldHeight, Math.max(ay, by) + 0.5);
      const minBy = Math.max(0, Math.floor(minY / this.cellH));
      const maxBy = Math.min(this.bucketGridH - 1, Math.floor(maxY / this.cellH));
      // Pad x bbox by half a cell so segments grazing a cell boundary still
      // register on both sides — querying only the host cell would miss
      // segments that pass between cell centers.
      const minBx = Math.floor((minXRaw - this.cellW * 0.5) / this.cellW);
      const maxBx = Math.floor((maxXRaw + this.cellW * 0.5) / this.cellW);
      for (let by_ = minBy; by_ <= maxBy; by_++) {
        for (let bx_ = minBx; bx_ <= maxBx; bx_++) {
          const wrappedBx = mod(bx_, this.bucketGridW);
          fn(by_ * this.bucketGridW + wrappedBx);
        }
      }
    };

    for (const pl of polylines) {
      const n = pl.vertices.length / 2;
      const segCount = pl.isClosed ? n : n - 1;
      for (let s = 0; s < segCount; s++) {
        const i = s;
        const j = pl.isClosed ? (s + 1) % n : s + 1;
        const ax = pl.vertices[i * 2];
        const ay = pl.vertices[i * 2 + 1];
        const bx = pl.vertices[j * 2];
        const by = pl.vertices[j * 2 + 1];
        visitSegmentCells(ax, ay, bx, by, (bIdx) => counts[bIdx]++);
      }
    }

    // Prefix-sum to compute bucket offsets, then fill segmentRefs.
    const bucketOffsets = new Int32Array(numBuckets + 1);
    let running = 0;
    for (let i = 0; i < numBuckets; i++) {
      bucketOffsets[i] = running;
      running += counts[i];
    }
    bucketOffsets[numBuckets] = running;

    const segmentRefs = new Int32Array(running * 2);
    const fillCursor = new Int32Array(numBuckets);
    for (let pi = 0; pi < polylines.length; pi++) {
      const pl = polylines[pi];
      const n = pl.vertices.length / 2;
      const segCount = pl.isClosed ? n : n - 1;
      for (let s = 0; s < segCount; s++) {
        const i = s;
        const j = pl.isClosed ? (s + 1) % n : s + 1;
        const ax = pl.vertices[i * 2];
        const ay = pl.vertices[i * 2 + 1];
        const bx = pl.vertices[j * 2];
        const by = pl.vertices[j * 2 + 1];
        visitSegmentCells(ax, ay, bx, by, (bIdx) => {
          const slot = bucketOffsets[bIdx] + fillCursor[bIdx];
          fillCursor[bIdx]++;
          segmentRefs[slot * 2] = pi;
          segmentRefs[slot * 2 + 1] = s;
        });
      }
    }

    this.segmentRefs = segmentRefs;
    this.bucketOffsets = bucketOffsets;
  }

  /**
   * Find the closest polyline segment to `(qx, qy)` in pixel-corner space.
   * Queries the host bucket plus 8 neighbors (toroidal in x) so segments
   * grazing the bucket boundary aren't missed.
   *
   * Returns `null` if no polylines exist at all. The query is O(K) where K
   * is the number of segments in the neighborhood (typically ~10–30).
   */
  nearest(qx: number, qy: number, out: NearestPolyline): NearestPolyline {
    out.polyline = null;
    out.segIdx = -1;
    out.t = 0;
    out.dist = Infinity;
    out.side = 0;

    if (this.polylines.length === 0) return out;

    const bxHost = Math.floor(mod(qx, this.worldWidth) / this.cellW);
    const byHost = Math.max(0, Math.min(this.bucketGridH - 1, Math.floor(qy / this.cellH)));

    let bestDist = Infinity;
    let bestPi = -1;
    let bestSeg = -1;
    let bestT = 0;
    let bestSide = 0;

    for (let dby = -1; dby <= 1; dby++) {
      const by = byHost + dby;
      if (by < 0 || by >= this.bucketGridH) continue;
      for (let dbx = -1; dbx <= 1; dbx++) {
        const bx = mod(bxHost + dbx, this.bucketGridW);
        const bIdx = by * this.bucketGridW + bx;
        const start = this.bucketOffsets[bIdx];
        const end = this.bucketOffsets[bIdx + 1];
        for (let k = start; k < end; k++) {
          const pi = this.segmentRefs[k * 2];
          const sIdx = this.segmentRefs[k * 2 + 1];
          const pl = this.polylines[pi];
          const n = pl.vertices.length / 2;
          const jSeg = pl.isClosed ? (sIdx + 1) % n : sIdx + 1;
          const ax = pl.vertices[sIdx * 2];
          const ay = pl.vertices[sIdx * 2 + 1];
          const segBx = pl.vertices[jSeg * 2];
          const segBy = pl.vertices[jSeg * 2 + 1];

          // Longitude shortest-arc unwrap for the segment direction vector.
          let sDx = segBx - ax;
          if (sDx > this.worldWidth / 2) sDx -= this.worldWidth;
          else if (sDx < -this.worldWidth / 2) sDx += this.worldWidth;
          const sDy = segBy - ay;
          const segLen2 = sDx * sDx + sDy * sDy;

          // Same unwrap for the query → segment-start vector.
          let qDx = qx - ax;
          if (qDx > this.worldWidth / 2) qDx -= this.worldWidth;
          else if (qDx < -this.worldWidth / 2) qDx += this.worldWidth;
          const qDy = qy - ay;

          const t = segLen2 > 0 ? Math.max(0, Math.min(1, (qDx * sDx + qDy * sDy) / segLen2)) : 0;
          const closeX = sDx * t;
          const closeY = sDy * t;
          const deltaX = qDx - closeX;
          const deltaY = qDy - closeY;
          const d2 = deltaX * deltaX + deltaY * deltaY;

          if (d2 < bestDist * bestDist) {
            // Side = sign of the 2D cross product (segment dir × query offset).
            // Positive: query is on the "left" of A→B in pixel-corner space.
            // We define this consistently so callers can map it to plate side.
            const cross = sDx * qDy - sDy * qDx;
            bestDist = Math.sqrt(d2);
            bestPi = pi;
            bestSeg = sIdx;
            bestT = t;
            bestSide = cross >= 0 ? 1 : -1;
          }
        }
      }
    }

    if (bestPi < 0) return out;

    out.polyline = this.polylines[bestPi];
    out.segIdx = bestSeg;
    out.t = bestT;
    out.dist = bestDist;
    out.side = bestSide;
    return out;
  }
}
