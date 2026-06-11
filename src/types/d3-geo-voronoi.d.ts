/**
 * Minimal ambient declarations for `d3-geo-voronoi`. The library doesn't ship
 * types; we only declare the subset that voronoi-edges.ts uses.
 *
 * Upstream reference: https://github.com/Fil/d3-geo-voronoi
 */
declare module 'd3-geo-voronoi' {
  /** [longitude, latitude] in degrees, the format d3-geo-voronoi expects. */
  type LonLat = [number, number];

  /** Triangle is a 3-tuple of input-point indices (cell indices). */
  type Triangle = [number, number, number];

  /** Dual-graph edge: cell-index pair. */
  type Edge = [number, number];

  interface GeoDelaunay {
    /** Triangles as 3-tuples of cell indices. */
    triangles: Triangle[];
    /** Circumcenter ([lon, lat]) for each triangle in `triangles`, same index. */
    centers: LonLat[];
    /** Dual-graph edges (each as [cellA, cellB]). */
    edges: Edge[];
    /** Per-cell neighbor list. */
    neighbors: number[][];
    /** Per-cell list of triangle indices forming that cell's Voronoi polygon. */
    polygons: number[][];
  }

  interface GeoVoronoi {
    delaunay: GeoDelaunay;
    points: LonLat[];
  }

  export function geoVoronoi(data: LonLat[]): GeoVoronoi;
  export function geoDelaunay(data: LonLat[]): GeoDelaunay;
}
