import { mod } from '@lib/math';

/**
 * Phase 3 — Hydrology & Erosion.
 *
 * Carves rivers and valleys into the elevation field, and derives flow,
 * river, and lake masks. Runs after terrain post-processing and before
 * climate stages so wind, currents, and precipitation all see the eroded
 * surface.
 *
 * Pipeline order inside this stage:
 *   1. Priority-flood depression fill (Barnes-Lehman) → filled surface + lake mask
 *   2. D8 flow direction on filled surface
 *   3. Flow accumulation via elevation-sorted topological walk
 *   4. Stream-power erosion iterations with hillslope diffusion sub-pass
 *   5. Re-route flow on eroded terrain for final rivers output
 *
 * Rainfall is uniform (1.0 per cell) in this pass — real precipitation is
 * computed downstream so we can't feed it back without reordering.
 */
export interface HydrologyVariables {
  /** How many stream-power erosion iterations to run. */
  erosionIterations: number;
  /** K coefficient in dE = -K * A^m * S^n. */
  erosionStrength: number;
  /** m exponent — flow accumulation influence on erosion rate. */
  flowExponent: number;
  /** n exponent — slope influence on erosion rate. */
  slopeExponent: number;
  /** Hillslope diffusion coefficient applied after each erosion iteration. */
  diffusionStrength: number;
  /** log2(1 + flowAcc) cutoff above which a cell is considered a river. */
  riverLogThreshold: number;
  /** (filled - elevation) above this value classifies a cell as a lake. */
  lakeDepthEpsilon: number;
}

export const DEFAULT_HYDROLOGY: HydrologyVariables = {
  erosionIterations: 8,
  erosionStrength: 0.02,
  flowExponent: 0.5,
  slopeExponent: 1.0,
  diffusionStrength: 0.1,
  riverLogThreshold: 4.0,
  lakeDepthEpsilon: 0.003,
};

export interface HydrologyResult {
  /** Upstream-cell count per pixel on the final (post-erosion) surface. */
  flowAccumulation: Float32Array;
  /** River intensity in [0, 1], derived from log flow accumulation. */
  rivers: Float32Array;
  /** 0/1 lake mask from depression filling on the pre-erosion surface. */
  lakes: Uint8Array;
}

// D8 neighbor offsets indexed 0..7 = N, NE, E, SE, S, SW, W, NW.
const D8_DX = [0, 1, 1, 1, 0, -1, -1, -1];
const D8_DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const D8_DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

const FILL_EPSILON = 1e-6;
const EROSION_FLOOR_BELOW_SEA = 0.1;

export function runHydrology(
  width: number,
  height: number,
  elevation: Float32Array,
  seaLevel: number,
  config: HydrologyVariables
): HydrologyResult {
  // 1. Depression fill.
  const filled = priorityFloodFill(elevation, width, height, seaLevel);
  const lakes = buildLakeMask(elevation, filled, seaLevel, config.lakeDepthEpsilon);

  // 2. Flow direction on the filled surface so every land cell has a downhill.
  const flowDir = computeD8FlowDir(filled, width, height, seaLevel);

  // 3. Initial flow accumulation.
  let flowAcc = computeFlowAccumulation(filled, flowDir, width, height, seaLevel);

  // 4. Erosion passes on the original (un-filled) elevation.
  const erosionFloor = seaLevel - EROSION_FLOOR_BELOW_SEA;
  for (let i = 0; i < config.erosionIterations; i++) {
    applyStreamPowerErosion(
      elevation,
      flowAcc,
      flowDir,
      width,
      height,
      seaLevel,
      erosionFloor,
      config.erosionStrength,
      config.flowExponent,
      config.slopeExponent
    );
    applyHillslopeDiffusion(elevation, width, height, seaLevel, config.diffusionStrength);
  }

  // 5. Final flow on the eroded surface. Re-fill so trapped basins don't
  // break the topological walk after erosion reshapes things.
  const finalFilled = priorityFloodFill(elevation, width, height, seaLevel);
  const finalFlowDir = computeD8FlowDir(finalFilled, width, height, seaLevel);
  flowAcc = computeFlowAccumulation(finalFilled, finalFlowDir, width, height, seaLevel);

  const rivers = buildRiverMask(flowAcc, elevation, seaLevel, config.riverLogThreshold);

  return { flowAccumulation: flowAcc, rivers, lakes };
}

// --- Priority flood (Barnes-Lehman 2014) -----------------------------------

/**
 * Min-heap flood fill. Seeds every ocean cell and every Y-edge land cell
 * as an outlet at its own elevation, then grows the filled surface inward.
 * Each popped cell enforces `filled[neighbor] = max(elevation[neighbor],
 * filled[cell] + eps)`, guaranteeing a monotonically descending path from
 * every land cell back to an outlet.
 */
function priorityFloodFill(elevation: Float32Array, width: number, height: number, seaLevel: number): Float32Array {
  const size = width * height;
  const filled = new Float32Array(size);
  const closed = new Uint8Array(size);
  const heap = new MinHeap(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const isOcean = elevation[idx] < seaLevel;
      const isYEdge = y === 0 || y === height - 1;
      if (isOcean || isYEdge) {
        filled[idx] = elevation[idx];
        closed[idx] = 1;
        heap.push(elevation[idx], idx);
      }
    }
  }

  while (heap.size > 0) {
    const idx = heap.pop();
    const y = (idx / width) | 0;
    const x = idx - y * width;
    const popElev = filled[idx];

    for (let d = 0; d < 8; d++) {
      const nx = mod(x + D8_DX[d], width);
      const ny = y + D8_DY[d];
      if (ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (closed[nIdx]) continue;

      const raised = popElev + FILL_EPSILON;
      filled[nIdx] = elevation[nIdx] >= raised ? elevation[nIdx] : raised;
      closed[nIdx] = 1;
      heap.push(filled[nIdx], nIdx);
    }
  }

  return filled;
}

function buildLakeMask(elevation: Float32Array, filled: Float32Array, seaLevel: number, epsilon: number): Uint8Array {
  const out = new Uint8Array(elevation.length);
  for (let i = 0; i < elevation.length; i++) {
    if (elevation[i] >= seaLevel && filled[i] - elevation[i] > epsilon) {
      out[i] = 1;
    }
  }
  return out;
}

// --- D8 flow direction ------------------------------------------------------

function computeD8FlowDir(filled: Float32Array, width: number, height: number, seaLevel: number): Int8Array {
  const flowDir = new Int8Array(filled.length).fill(-1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (filled[idx] < seaLevel) continue;

      let bestDir = -1;
      let bestDrop = 0;
      for (let d = 0; d < 8; d++) {
        const nx = mod(x + D8_DX[d], width);
        const ny = y + D8_DY[d];
        if (ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        const drop = (filled[idx] - filled[nIdx]) / D8_DIST[d];
        if (drop > bestDrop) {
          bestDrop = drop;
          bestDir = d;
        }
      }
      flowDir[idx] = bestDir;
    }
  }
  return flowDir;
}

// --- Flow accumulation ------------------------------------------------------

/**
 * Accumulate 1 unit per cell downstream. Cells are processed in descending
 * order of filled elevation — this is a valid topological order on the
 * filled (depression-free) surface because every cell's downstream target
 * is strictly lower.
 */
function computeFlowAccumulation(
  filled: Float32Array,
  flowDir: Int8Array,
  width: number,
  height: number,
  seaLevel: number
): Float32Array {
  const size = width * height;
  const flowAcc = new Float32Array(size);

  // Collect land-cell indices, then sort by descending elevation.
  let landCount = 0;
  const landIdx = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    if (filled[i] >= seaLevel) {
      landIdx[landCount++] = i;
      flowAcc[i] = 1;
    }
  }
  const landView = landIdx.subarray(0, landCount);
  // Array.from + sort is ~equally fast for this size and keeps code simple.
  const sorted = Array.from(landView).sort((a, b) => filled[b] - filled[a]);

  for (const idx of sorted) {
    // for (let i = 0; i < sorted.length; i++) {
    const d = flowDir[idx];
    if (d < 0) continue;
    const y = (idx / width) | 0;
    const x = idx - y * width;
    const nx = mod(x + D8_DX[d], width);
    const ny = y + D8_DY[d];
    if (ny < 0 || ny >= height) continue;
    flowAcc[ny * width + nx] += flowAcc[idx];
  }

  return flowAcc;
}

// --- Stream-power erosion ---------------------------------------------------

function applyStreamPowerErosion(
  elevation: Float32Array,
  flowAcc: Float32Array,
  flowDir: Int8Array,
  width: number,
  height: number,
  seaLevel: number,
  floor: number,
  K: number,
  m: number,
  n: number
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (elevation[idx] < seaLevel) continue;
      const d = flowDir[idx];
      if (d < 0) continue;

      const nx = mod(x + D8_DX[d], width);
      const ny = y + D8_DY[d];
      if (ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;

      const drop = elevation[idx] - elevation[nIdx];
      if (drop <= 0) continue;
      const slope = drop / D8_DIST[d];

      const erode = K * Math.pow(flowAcc[idx], m) * Math.pow(slope, n);
      let next = elevation[idx] - erode;
      if (next < floor) next = floor;
      // Never erode below downstream neighbor — keeps flow monotonic.
      if (next < elevation[nIdx]) next = elevation[nIdx];
      elevation[idx] = next;
    }
  }
}

function applyHillslopeDiffusion(
  elevation: Float32Array,
  width: number,
  height: number,
  seaLevel: number,
  kd: number
): void {
  if (kd <= 0) return;
  const src = Float32Array.from(elevation);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (src[idx] < seaLevel) continue;

      let sum = 0;
      let count = 0;
      for (let d = 0; d < 8; d++) {
        const nx = mod(x + D8_DX[d], width);
        const ny = y + D8_DY[d];
        if (ny < 0 || ny >= height) continue;
        sum += src[ny * width + nx];
        count++;
      }
      const avg = sum / count;
      elevation[idx] = src[idx] + (avg - src[idx]) * kd;
    }
  }
}

// --- River mask -------------------------------------------------------------

function buildRiverMask(
  flowAcc: Float32Array,
  elevation: Float32Array,
  seaLevel: number,
  logThreshold: number
): Float32Array {
  const rivers = new Float32Array(flowAcc.length);
  for (let i = 0; i < flowAcc.length; i++) {
    if (elevation[i] < seaLevel) continue;
    const mag = Math.log2(1 + flowAcc[i]);
    if (mag <= logThreshold) continue;
    const t = (mag - logThreshold) / 4;
    rivers[i] = t > 1 ? 1 : t;
  }
  return rivers;
}

// --- Binary min-heap keyed on a Float32 priority ----------------------------

class MinHeap {
  size = 0;
  private prio: Float32Array;
  private vals: Int32Array;

  constructor(capacity: number) {
    this.prio = new Float32Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  push(priority: number, value: number): void {
    let i = this.size++;
    this.prio[i] = priority;
    this.vals[i] = value;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const out = this.vals[0];
    this.size--;
    if (this.size > 0) {
      this.prio[0] = this.prio[this.size];
      this.vals[0] = this.vals[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < this.size && this.prio[l] < this.prio[best]) best = l;
        if (r < this.size && this.prio[r] < this.prio[best]) best = r;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return out;
  }

  private swap(a: number, b: number): void {
    const tp = this.prio[a];
    this.prio[a] = this.prio[b];
    this.prio[b] = tp;
    const tv = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = tv;
  }
}
