/**
 * Plate seed selection and cell-graph partitioning.
 *
 * Two-phase placement:
 *   Phase 1 — major plates (largest ~40%) via farthest-point sampling.
 *   Phase 2 — minor plates seeded at preview-partition boundaries via the
 *             same farthest-point rule, restricted to boundary cells.
 *
 * The cells themselves are partitioned by cost-scaled multi-source Dijkstra
 * — each plate's per-hop cost is derived from its target area fraction so
 * competitive growth produces sizes matching the requested distribution.
 */

/** Simple seeded PRNG (xorshift32). */
export function xorshift32(state: { s: number }): number {
  let s = state.s;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  state.s = s;
  return (s >>> 0) / 0xffffffff;
}

/** Update minDist array with distances from a newly placed seed. */
function updateMinDist(
  seeds: { x: number; y: number }[],
  minDist: Float32Array,
  newSeed: number,
  cellCount: number,
  width: number
): void {
  const sx = seeds[newSeed].x;
  const sy = seeds[newSeed].y;
  for (let i = 0; i < cellCount; i++) {
    let dx = seeds[i].x - sx;
    if (dx > width / 2) dx -= width;
    else if (dx < -width / 2) dx += width;
    const dy = seeds[i].y - sy;
    const d = dx * dx + dy * dy;
    if (d < minDist[i]) minDist[i] = d;
  }
}

export function selectPlateSeeds(
  seeds: { x: number; y: number }[],
  cellCount: number,
  plateCount: number,
  width: number,
  targetFractions: number[],
  neighbors: number[][],
  rng: { s: number }
): number[] {
  const plateSeeds = new Array<number>(plateCount);
  const placed = new Uint8Array(cellCount);

  // Sort plates by target fraction descending → major plates first
  const order = targetFractions.map((f, i) => ({ fraction: f, plate: i })).sort((a, b) => b.fraction - a.fraction);

  const majorCount = Math.max(3, Math.ceil(plateCount * 0.4));

  // --- Phase 1: Major plates via farthest-point sampling ---
  const minDist = new Float32Array(cellCount).fill(Infinity);

  const first = Math.floor(xorshift32(rng) * cellCount);
  plateSeeds[order[0].plate] = first;
  placed[first] = 1;

  for (let m = 1; m < majorCount; m++) {
    updateMinDist(seeds, minDist, plateSeeds[order[m - 1].plate], cellCount, width);

    let best = -1;
    let bestD = -1;
    for (let i = 0; i < cellCount; i++) {
      if (!placed[i] && minDist[i] > bestD) {
        bestD = minDist[i];
        best = i;
      }
    }
    plateSeeds[order[m].plate] = best;
    placed[best] = 1;
  }
  updateMinDist(seeds, minDist, plateSeeds[order[majorCount - 1].plate], cellCount, width);

  // --- Phase 2: Preview Dijkstra with major plates to find real boundaries ---
  const previewSeeds: number[] = [];
  const previewFractions: number[] = [];
  for (let m = 0; m < majorCount; m++) {
    previewSeeds.push(plateSeeds[order[m].plate]);
    previewFractions.push(order[m].fraction);
  }
  const previewAssignment = groupCellsIntoPlates(neighbors, cellCount, majorCount, previewSeeds, previewFractions);

  // Mark cells at boundaries of the preview partition
  const isBoundaryCell = new Uint8Array(cellCount);
  for (let c = 0; c < cellCount; c++) {
    for (const n of neighbors[c]) {
      if (previewAssignment[n] !== previewAssignment[c]) {
        isBoundaryCell[c] = 1;
        break;
      }
    }
  }

  // --- Phase 3: Minor seeds at boundary cells via farthest-point sampling ---
  for (let m = majorCount; m < plateCount; m++) {
    let best = -1;
    let bestD = -1;

    // Pick the boundary cell farthest from all placed seeds
    for (let i = 0; i < cellCount; i++) {
      if (!placed[i] && isBoundaryCell[i] && minDist[i] > bestD) {
        bestD = minDist[i];
        best = i;
      }
    }

    if (best === -1) {
      // Fallback: any unplaced cell (boundary cells exhausted)
      for (let i = 0; i < cellCount; i++) {
        if (!placed[i] && minDist[i] > bestD) {
          bestD = minDist[i];
          best = i;
        }
      }
    }

    plateSeeds[order[m].plate] = best;
    placed[best] = 1;
    updateMinDist(seeds, minDist, best, cellCount, width);
  }

  return plateSeeds;
}

/**
 * Generate target area fractions using a power-law distribution.
 * A few large plates cover most of the globe, many small plates fill the rest.
 * The fractions are shuffled so large plates aren't always the first seeds.
 */
export function generateSizeDistribution(plateCount: number, rng: { s: number }): number[] {
  const ALPHA = 1.2;
  const raw: number[] = [];
  for (let i = 0; i < plateCount; i++) {
    raw.push(1 / Math.pow(i + 1, ALPHA));
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  const fractions = raw.map((v) => v / sum);

  // Fisher-Yates shuffle so large plates aren't always the first seeds
  for (let i = fractions.length - 1; i > 0; i--) {
    const j = Math.floor(xorshift32(rng) * (i + 1));
    [fractions[i], fractions[j]] = [fractions[j], fractions[i]];
  }

  return fractions;
}

/**
 * Group voronoi cells into plates using cost-scaled multi-source Dijkstra.
 *
 * All plates start growing simultaneously from their seeds, but each plate
 * has a per-hop cost derived from its target area fraction. Large plates
 * have low cost (grow fast / expand far), small plates have high cost
 * (grow slow / stay small). The competitive growth naturally partitions
 * the cell graph with sizes matching the target distribution.
 */
export function groupCellsIntoPlates(
  neighbors: number[][],
  cellCount: number,
  plateCount: number,
  plateSeeds: number[],
  targetFractions: number[]
): Int32Array {
  const cellToPlate = new Int32Array(cellCount).fill(-1);

  // Compute per-plate growth cost: cost ∝ 1/sqrt(fraction).
  // Large plates have low cost (grow far), small plates have high cost (grow short).
  // In competitive 2D growth, area ∝ radius² and radius ∝ 1/cost,
  // so area ∝ 1/cost² ∝ fraction. Cap to avoid extreme ratios.
  const maxFraction = Math.max(...targetFractions);
  const costs = targetFractions.map((f) => Math.min(Math.sqrt(maxFraction / f), 10));

  // Min-heap priority queue
  const heap: { priority: number; cell: number; plate: number }[] = [];

  const push = (priority: number, cell: number, plate: number) => {
    heap.push({ priority, cell, plate });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[i].priority >= heap[parent].priority) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  };

  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < heap.length && heap[l].priority < heap[smallest].priority) smallest = l;
        if (r < heap.length && heap[r].priority < heap[smallest].priority) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };

  // Pre-claim all seed cells
  for (let p = 0; p < plateCount; p++) {
    cellToPlate[plateSeeds[p]] = p;
  }

  // Seed the queue with neighbors of all plate seeds (all start simultaneously)
  for (let p = 0; p < plateCount; p++) {
    for (const n of neighbors[plateSeeds[p]]) {
      if (cellToPlate[n] === -1) {
        push(costs[p], n, p);
      }
    }
  }

  // Dijkstra: claim cells in priority order, each hop costs costs[plate]
  while (heap.length > 0) {
    const { priority, cell, plate } = pop();
    if (cellToPlate[cell] !== -1) continue; // already claimed

    cellToPlate[cell] = plate;

    for (const n of neighbors[cell]) {
      if (cellToPlate[n] === -1) {
        push(priority + costs[plate], n, plate);
      }
    }
  }

  // Safety: assign any remaining unclaimed cells to a neighbor's plate
  for (let i = 0; i < cellCount; i++) {
    if (cellToPlate[i] === -1) {
      for (const n of neighbors[i]) {
        if (cellToPlate[n] !== -1) {
          cellToPlate[i] = cellToPlate[n];
          break;
        }
      }
    }
  }

  return cellToPlate;
}
