/**
 * Plate partitioning by seeded region-growing with explicit size targets.
 *
 * Random edge contraction (the previous approach) has an inherent runaway —
 * a region's pick-probability scales with its perimeter, so one plate snowballs
 * and swallows the sphere. Instead we:
 *
 *   1. pick well-spread seed cells (farthest-point sampling on the sphere),
 *   2. draw a target size per plate from a flattened power law (a few large
 *      plates, a smooth tail of smaller ones — no giant, no micro-slivers), and
 *   3. grow plates by weighted multi-source Dijkstra (a weighted Voronoi), where
 *      each plate's per-step cost is `1 / sqrt(targetSize)` so larger plates
 *      reach further.
 *
 * Growing in global distance order makes every plate a compact front, so fronts
 * meet along smooth boundaries instead of one plate snaking tendrils through
 * gaps to hit an oversized target (the "fingering" of greedy fill-ratio growth).
 * A plate only relaxes from cells it already claimed, so each plate is connected
 * (no embedded islands); small plates settle into the gaps between large ones.
 */

import { type Vec3 } from '@lib/voronoi-sphere';

/** Flatten the head of the size power law: larger → more comparable majors. */
const HEAD_FLATTEN = 3;
/** Power-law exponent for the plate-size distribution. */
const SIZE_ALPHA = 1.0;
/** Fraction of the globe carved into minor (micro) plates at major junctions.
 *  The rest stays major, so the large plates dominate the surface. */
const MINOR_AREA_FRACTION = 0.2;

/** Simple seeded PRNG (xorshift32). */
export function xorshift32(state: { s: number }): number {
  let s = state.s;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  state.s = s;
  return (s >>> 0) / 0xffffffff;
}

/**
 * Choose `plateCount` seed cells by farthest-point sampling on the unit sphere:
 * the first is random, each subsequent seed is the cell maximizing the minimum
 * great-circle distance (here `1 − dot`, monotonic in arc length) to all chosen
 * seeds. Produces well-separated plate nuclei so majors don't cluster.
 */
export function selectPlateSeeds(sphereSeeds: Vec3[], plateCount: number, rng: { s: number }): number[] {
  const n = sphereSeeds.length;
  const seeds: number[] = [];
  const minDist = new Float64Array(n).fill(Infinity);

  const updateFrom = (seedIdx: number): void => {
    const s = sphereSeeds[seedIdx];
    for (let i = 0; i < n; i++) {
      const o = sphereSeeds[i];
      const d = 1 - (s.x * o.x + s.y * o.y + s.z * o.z);
      if (d < minDist[i]) minDist[i] = d;
    }
  };

  const pick = Math.floor(xorshift32(rng) * n);
  seeds.push(pick);
  updateFrom(pick);

  for (let m = 1; m < plateCount; m++) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      if (minDist[i] > bestD) {
        bestD = minDist[i];
        best = i;
      }
    }
    seeds.push(best);
    updateFrom(best);
  }

  return seeds;
}

/**
 * Per-plate target cell counts from a flattened power law `1 / (i + HEAD_FLATTEN)^α`,
 * lightly jittered, sorted descending, and scaled so the targets sum to
 * `cellCount`. Descending order pairs with the farthest-point seed order, so the
 * largest plates get the most isolated seeds (room to grow) and the small ones
 * fill the gaps. With the defaults the largest plate lands near ~12 % of the
 * globe and the smallest near ~1 % — Earth-like, with no runaway giant.
 */
export function generatePlateSizeTargets(plateCount: number, cellCount: number, rng: { s: number }): Int32Array {
  const weights: number[] = [];
  for (let i = 0; i < plateCount; i++) {
    const base = 1 / Math.pow(i + HEAD_FLATTEN, SIZE_ALPHA);
    weights.push(base * (0.85 + 0.3 * xorshift32(rng))); // ±~15% jitter
  }
  weights.sort((a, b) => b - a);

  let sum = 0;
  for (const w of weights) sum += w;

  const target = new Int32Array(plateCount);
  let acc = 0;
  for (let i = 0; i < plateCount; i++) {
    target[i] = Math.max(1, Math.round((weights[i] / sum) * cellCount));
    acc += target[i];
  }
  // Absorb the rounding remainder into the largest plate.
  target[0] += cellCount - acc;
  if (target[0] < 1) target[0] = 1;
  return target;
}

/**
 * Grow `plateCount` plates from their seeds by weighted multi-source Dijkstra —
 * a weighted Voronoi partition of the cell graph.
 *
 * Each plate has a per-step cost `1 / sqrt(targetSize)`, so larger-target plates
 * expand further before colliding with neighbors (area ≈ radius² ≈ 1/cost²,
 * which recovers the target size ratios). Cells are claimed in global
 * weighted-distance order, so every plate advances as a compact front and
 * fronts meet along smooth boundaries — no greedy tendrils "fingering" through
 * gaps the way fill-ratio growth does. A plate only ever relaxes from cells it
 * already claimed, so each plate is connected (no embedded islands); small
 * plates simply settle into the gaps between the large ones.
 */
export function growPlatesFromSeeds(
  neighbors: number[][],
  cellCount: number,
  plateCount: number,
  seeds: number[],
  targetSize: Int32Array
): Int32Array {
  const cellToPlate = new Int32Array(cellCount).fill(-1);

  const cost = new Float64Array(plateCount);
  for (let p = 0; p < plateCount; p++) cost[p] = 1 / Math.sqrt(Math.max(1, targetSize[p]));

  // Binary min-heap over (dist, cell, plate). Capacity bounds total pushes:
  // each cell relaxes its neighbors at most once (when first claimed), so
  // pushes ≤ total directed adjacency + the seed pushes.
  let cap = plateCount;
  for (let i = 0; i < cellCount; i++) cap += neighbors[i].length;
  const hd = new Float64Array(cap);
  const hc = new Int32Array(cap);
  const hp = new Int32Array(cap);
  let hn = 0;

  const push = (d: number, c: number, p: number): void => {
    let i = hn++;
    hd[i] = d;
    hc[i] = c;
    hp[i] = p;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (hd[parent] <= hd[i]) break;
      const td = hd[i];
      hd[i] = hd[parent];
      hd[parent] = td;
      const tc = hc[i];
      hc[i] = hc[parent];
      hc[parent] = tc;
      const tp = hp[i];
      hp[i] = hp[parent];
      hp[parent] = tp;
      i = parent;
    }
  };

  let popD = 0;
  let popC = 0;
  let popP = 0;
  const pop = (): void => {
    popD = hd[0];
    popC = hc[0];
    popP = hp[0];
    hn--;
    if (hn > 0) {
      hd[0] = hd[hn];
      hc[0] = hc[hn];
      hp[0] = hp[hn];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < hn && hd[l] < hd[s]) s = l;
        if (r < hn && hd[r] < hd[s]) s = r;
        if (s === i) break;
        const td = hd[i];
        hd[i] = hd[s];
        hd[s] = td;
        const tc = hc[i];
        hc[i] = hc[s];
        hc[s] = tc;
        const tp = hp[i];
        hp[i] = hp[s];
        hp[s] = tp;
        i = s;
      }
    }
  };

  for (let p = 0; p < plateCount; p++) {
    const s = seeds[p];
    cellToPlate[s] = p;
    for (const nb of neighbors[s]) if (cellToPlate[nb] === -1) push(cost[p], nb, p);
  }

  while (hn > 0) {
    pop();
    const c = popC;
    if (cellToPlate[c] !== -1) continue;
    const p = popP;
    cellToPlate[c] = p;
    const nd = popD + cost[p];
    for (const nb of neighbors[c]) if (cellToPlate[nb] === -1) push(nd, nb, p);
  }

  // Safety net: any cell left unclaimed (disconnected graph) joins a neighbor.
  for (let i = 0; i < cellCount; i++) {
    if (cellToPlate[i] !== -1) continue;
    for (const nb of neighbors[i]) {
      if (cellToPlate[nb] !== -1) {
        cellToPlate[i] = cellToPlate[nb];
        break;
      }
    }
  }

  return cellToPlate;
}

/**
 * Two-tier plate partition. First lay down `majorCount` large plates that tile
 * the whole globe (weighted Voronoi → compact, no fingering, no islands). Then
 * carve `minorCount` micro-plates out of the cells straddling major–major
 * boundaries — where real microplates form — each capped to a small size so the
 * majors keep ~`1 − MINOR_AREA_FRACTION` of the surface.
 *
 * Because minor seeds sit ON major boundaries and stay small, a minor always
 * touches two or more majors instead of being stranded inside one (the
 * "embedded island" artifact), and the majors remain clearly dominant.
 *
 * Returns the final `cellToPlate` and the total plate count (majors + the minors
 * that actually fit on the available boundary).
 */
export function partitionPlates(
  sphereSeeds: Vec3[],
  neighbors: number[][],
  cellCount: number,
  majorCount: number,
  minorCount: number,
  rng: { s: number }
): { cellToPlate: Int32Array; plateCount: number } {
  // Tier 1: major plates over every cell.
  const majorSeeds = selectPlateSeeds(sphereSeeds, majorCount, rng);
  const majorTargets = generatePlateSizeTargets(majorCount, cellCount, rng);
  const cellToPlate = growPlatesFromSeeds(neighbors, cellCount, majorCount, majorSeeds, majorTargets);
  if (minorCount <= 0) return { cellToPlate, plateCount: majorCount };

  // Cells on a major–major boundary are the candidate microplate nuclei.
  const boundary: number[] = [];
  for (let c = 0; c < cellCount; c++) {
    const p = cellToPlate[c];
    for (const nb of neighbors[c]) {
      if (cellToPlate[nb] !== p) {
        boundary.push(c);
        break;
      }
    }
  }
  if (boundary.length === 0) return { cellToPlate, plateCount: majorCount };

  // Tier 2: spread minor seeds along the boundaries and grow capped micro-plates.
  const nMinor = Math.min(minorCount, boundary.length);
  const minorSeeds = selectSeedsAmong(sphereSeeds, boundary, nMinor, rng);

  const totalMinorArea = Math.round(cellCount * MINOR_AREA_FRACTION);
  const perMinor = Math.max(2, Math.floor(totalMinorArea / nMinor));
  const caps = new Int32Array(nMinor);
  for (let m = 0; m < nMinor; m++) caps[m] = Math.max(1, Math.round(perMinor * (0.5 + xorshift32(rng))));

  growMinorPlates(neighbors, cellToPlate, minorSeeds, caps, majorCount);

  // Every minor claims at least its own (boundary) seed cell, so ids are dense
  // in [majorCount, majorCount + nMinor).
  return { cellToPlate, plateCount: majorCount + nMinor };
}

/** Farthest-point sampling of `k` cells restricted to the `candidates` subset. */
function selectSeedsAmong(sphereSeeds: Vec3[], candidates: number[], k: number, rng: { s: number }): number[] {
  const m = candidates.length;
  if (m === 0 || k <= 0) return [];
  const minDist = new Float64Array(m).fill(Infinity);
  const updateFrom = (cell: number): void => {
    const s = sphereSeeds[cell];
    for (let i = 0; i < m; i++) {
      const o = sphereSeeds[candidates[i]];
      const d = 1 - (s.x * o.x + s.y * o.y + s.z * o.z);
      if (d < minDist[i]) minDist[i] = d;
    }
  };
  const chosen: number[] = [candidates[Math.floor(xorshift32(rng) * m)]];
  updateFrom(chosen[0]);
  for (let n = 1; n < k; n++) {
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < m; i++) {
      if (minDist[i] > bestD) {
        bestD = minDist[i];
        best = i;
      }
    }
    chosen.push(candidates[best]);
    updateFrom(candidates[best]);
  }
  return chosen;
}

/**
 * Carve micro-plates out of the major partition by multi-source BFS from the
 * minor seeds. Uniform edge cost ⇒ FIFO BFS is already distance-ordered, so each
 * minor grows as a compact blob and the nearest minor wins contested cells. Only
 * cells still belonging to a major are claimable, and each minor stops at its
 * cap, so minors stay small and bounded. Minor `m` gets id `majorOffset + m`.
 */
function growMinorPlates(
  neighbors: number[][],
  cellToPlate: Int32Array,
  minorSeeds: number[],
  caps: Int32Array,
  majorOffset: number
): void {
  const M = minorSeeds.length;
  const curSize = new Int32Array(M);
  const qCell: number[] = [];
  const qMinor: number[] = [];
  for (let m = 0; m < M; m++) {
    qCell.push(minorSeeds[m]);
    qMinor.push(m);
  }
  let head = 0;
  while (head < qCell.length) {
    const c = qCell[head];
    const m = qMinor[head];
    head++;
    if (cellToPlate[c] >= majorOffset) continue; // already taken by a minor
    if (curSize[m] >= caps[m]) continue;
    cellToPlate[c] = majorOffset + m;
    curSize[m]++;
    for (const nb of neighbors[c]) {
      if (cellToPlate[nb] < majorOffset) {
        qCell.push(nb);
        qMinor.push(m);
      }
    }
  }
}
