import { mod } from '@lib/math';
import { WorldFields } from '../types';
import { WorldGeometry } from '../world-geometry';

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
 *
 * `runHydrology` mutates `elevation` (in place) during the erosion loop;
 * `computeFlowAndRivers` (pass 2) does not.
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
  /** (filled - elevation) above this value qualifies a cell as a depression for lake consideration. */
  lakeDepthEpsilon: number;
  /** Minimum (catchment inflow) / (basin PET demand) for a depression to hold a
   *  persistent lake. Inflow comes from the rain-weighted flow accumulation at
   *  the basin's wettest cell; demand is the sum of PET over depression cells.
   *  Real endorheic lakes (Caspian, Great Salt) have ratios well above 1; we
   *  accept anything where inflow covers a meaningful fraction of evaporation. */
  lakeBudgetRatio: number;
  /** Maximum basin size as a fraction of total grid cells. Caps fill artifacts
   *  — large eroded depressions that aren't real geologic basins. */
  lakeMaxAreaFraction: number;
  /** Minimum connected-component size (cells) for a basin to be rendered as
   *  a lake. Filters out 1-cell slivers and numerical noise. */
  lakeMinCells: number;
  /** River fault affinity: bonus added to the D8 downslope drop per unit of
   *  tectonic faultLines intensity, so rivers exploit fault/boundary weak zones
   *  (Rhine graben, Nile). 0 disables. Kept above the D8 tie-jitter (~6e-5) but
   *  below natural gradients so it only steers, never misroutes. */
  faultRiverAffinity: number;
  /** Rift-lake budget relaxation in [0, 1]: a depression that overlaps a rift
   *  floor has its water-budget gate multiplied by (1 − riftLakeRelax·overlap),
   *  so continental-rift grabens fill into lakes more readily. 0 disables. */
  riftLakeRelax: number;
}

export const DEFAULT_HYDROLOGY: HydrologyVariables = {
  // Higher than the legacy 8 because erosion now re-routes flow every iteration
  // (see runHydrology) — more steps let the drainage network develop dendritic
  // valleys. This is the main quality/perf knob: each iteration adds one full
  // priority-flood + flow solve.
  erosionIterations: 15,
  // Calibrated for slope expressed in elev-units / km (geom.d8KmDist). The old
  // pixel-distance default was 0.02; at the default world settings 1 equator
  // pixel ≈ 40 km, so K_km = K_pixel · 40^slopeExponent (n = 1) keeps the
  // equator-erosion-per-iteration the same. The switch to a physical-meters
  // elevation field needs NO change here: with n = 1 the slope and the erodible
  // relief both scale by the meters-per-unit factor, so fractional incision per
  // iteration (and thus the drainage topology) is invariant.
  erosionStrength: 0.8,
  flowExponent: 0.5,
  slopeExponent: 1.0,
  diffusionStrength: 0.1,
  riverLogThreshold: 4.0,
  // Meters: a filled-minus-original depth above this marks a depression cell.
  lakeDepthEpsilon: 40,
  lakeBudgetRatio: 0.5,
  lakeMaxAreaFraction: 0.03,
  lakeMinCells: 6,
  faultRiverAffinity: 0.02,
  riftLakeRelax: 0.6,
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
// Slot index into geom.diffWeights for each D8 direction:
// 0 = EW, 1 = NS, 2 = diag.
const D8_DIFF_SLOT = [1, 2, 0, 2, 1, 2, 0, 2];

const FILL_EPSILON = 1e-6;
/** Erosion can lower land no further than this many meters below sea level. */
const EROSION_FLOOR_BELOW_SEA = 500;

/**
 * Bundle of intermediate fields produced by the fill → D8 → accumulate chain.
 * Pass 1 (erosion) and pass 2 (rain-aware routing) both use this triple.
 */
interface FlowState {
  filled: Float32Array;
  flowDir: Int8Array;
  flowAcc: Float32Array;
}

function routeFlow(
  elevation: Float32Array,
  width: number,
  height: number,
  seaLevel: number,
  geom: WorldGeometry,
  rainfall?: Float32Array,
  faultLines?: Float32Array,
  faultAffinity = 0
): FlowState {
  const filled = priorityFloodFill(elevation, width, height, seaLevel);
  const flowDir = computeD8FlowDir(filled, width, height, seaLevel, faultLines, faultAffinity);
  const flowAcc = computeFlowAccumulation(filled, flowDir, width, height, seaLevel, geom, rainfall);
  return { filled, flowDir, flowAcc };
}

export function runHydrology(fields: WorldFields, geom: WorldGeometry, config: HydrologyVariables): HydrologyResult {
  const { width, height } = fields;
  const elevation = fields.elevation!;
  const seaLevel = fields.seaLevel!;
  // 1. Initial flow on un-eroded surface (uniform rainfall — real precip
  //    isn't known yet). Pass-1 lake detection is skipped; the visible lake
  //    mask comes from pass 2 (buildLakeMaskGated) which has the climate
  //    data it needs to decide which basins are real lakes.
  const faultLines = fields.faultLines;
  const lakes = new Uint8Array(elevation.length);

  // Erosion with per-iteration flow RE-ROUTING. Re-solving the drainage network
  // on the current surface every step is what lets it self-organize — channels
  // grow headward and divides migrate — so the noise-defined relief is reworked
  // into a dendritic valley network instead of merely incising the channels the
  // initial (noisy) surface happened to define. This is the realism-critical
  // step: without re-routing, erosion can deepen cells but never reshape them.
  const erosionFloor = seaLevel - EROSION_FLOOR_BELOW_SEA;
  let flowAcc: Float32Array;
  for (let i = 0; i < config.erosionIterations; i++) {
    const fs = routeFlow(elevation, width, height, seaLevel, geom, undefined, faultLines, config.faultRiverAffinity);
    flowAcc = fs.flowAcc;
    applyStreamPowerErosion(
      elevation,
      flowAcc,
      fs.flowDir,
      width,
      height,
      seaLevel,
      erosionFloor,
      geom,
      config.erosionStrength,
      config.flowExponent,
      config.slopeExponent
    );
    applyHillslopeDiffusion(elevation, width, height, seaLevel, geom, config.diffusionStrength);
  }

  // Final flow on the fully-eroded surface for the river/flow outputs.
  ({ flowAcc } = routeFlow(elevation, width, height, seaLevel, geom, undefined, faultLines, config.faultRiverAffinity));

  const rivers = buildRiverMask(flowAcc, elevation, seaLevel, config.riverLogThreshold);

  return { flowAccumulation: flowAcc, rivers, lakes };
}

// --- Priority flood (Barnes-Lehman 2014) -----------------------------------

/**
 * Min-heap flood fill. Seeds every ocean cell as an outlet at its own
 * elevation, then grows the filled surface inward. Each popped cell enforces
 * `filled[neighbor] = max(elevation[neighbor], filled[cell] + eps)`,
 * guaranteeing a monotonically descending path from every land cell back
 * to the ocean.
 *
 * The map wraps cylindrically in X but is closed at the Y edges. Land cells
 * at y=0 / y=height-1 are NOT seeded — they must drain to the ocean through
 * neighbors, or become endorheic basins filled to an internal outlet level.
 * This prevents rivers from leaking off the top/bottom of the map.
 */
function priorityFloodFill(elevation: Float32Array, width: number, height: number, seaLevel: number): Float32Array {
  const size = width * height;
  const filled = new Float32Array(size);
  const closed = new Uint8Array(size);
  const heap = new MinHeap(size);

  for (let i = 0; i < size; i++) {
    if (elevation[i] < seaLevel) {
      filled[i] = elevation[i];
      closed[i] = 1;
      heap.push(elevation[i], i);
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

/**
 * Pass-2 lake mask — basin-fill formulation with a water-budget gate.
 *
 * Priority-flood has already identified every depression cell (where
 * `filled > elevation`). We flood-fill connected components of depression
 * cells (4-connected, X wraps) and gate each **basin** as a whole on whether
 * its water budget closes at a positive depth:
 *
 *   1. **Minimum area** — rejects 1-cell numerical noise.
 *   2. **Maximum area** — rejects fill artifacts (large eroded depressions
 *      that aren't real geologic basins).
 *   3. **Water budget** — `max(flowAcc) >= ratio * Σ PET`. The peak rain-
 *      weighted flow over basin cells is the inflow delivered by the
 *      catchment; ΣPET is the basin's evaporation demand. A persistent
 *      lake needs inflow to cover a meaningful fraction of that demand.
 *
 * This replaces the older per-gate (flow + aridity) check, which let large
 * cool-floor basins pass even when there was no real water moving through —
 * inflow was incidentally high because the catchment was large, and aridity
 * was incidentally high because PET was small.
 */
function buildLakeMaskGated(
  elevation: Float32Array,
  filled: Float32Array,
  flowAccumulation: Float32Array,
  petAnnual: Float32Array,
  width: number,
  height: number,
  seaLevel: number,
  epsilon: number,
  budgetRatio: number,
  maxAreaFraction: number,
  minCells: number,
  riftFloorMask?: Float32Array,
  riftLakeRelax = 0
): Uint8Array {
  const size = elevation.length;
  const out = new Uint8Array(size);
  const maxArea = Math.floor(size * maxAreaFraction);
  const useRift = riftFloorMask !== undefined && riftLakeRelax > 0;

  const isDepression = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (elevation[i] >= seaLevel && filled[i] - elevation[i] > epsilon) {
      isDepression[i] = 1;
    }
  }

  const visited = new Uint8Array(size);
  const stack: number[] = [];
  const component: number[] = [];

  for (let start = 0; start < size; start++) {
    if (!isDepression[start] || visited[start]) continue;

    component.length = 0;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;

    let maxFlow = 0;
    let petSum = 0;
    let maxRift = 0;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      component.push(idx);

      const f = flowAccumulation[idx];
      if (f > maxFlow) maxFlow = f;
      petSum += petAnnual[idx];
      if (useRift && riftFloorMask![idx] > maxRift) maxRift = riftFloorMask![idx];

      const y = (idx / width) | 0;
      const x = idx - y * width;

      // 4-connected neighbors (X wraps cylindrically, Y closed at poles).
      const east = y * width + mod(x + 1, width);
      const west = y * width + mod(x - 1, width);
      if (!visited[east] && isDepression[east]) {
        visited[east] = 1;
        stack.push(east);
      }
      if (!visited[west] && isDepression[west]) {
        visited[west] = 1;
        stack.push(west);
      }
      if (y > 0) {
        const north = (y - 1) * width + x;
        if (!visited[north] && isDepression[north]) {
          visited[north] = 1;
          stack.push(north);
        }
      }
      if (y < height - 1) {
        const south = (y + 1) * width + x;
        if (!visited[south] && isDepression[south]) {
          visited[south] = 1;
          stack.push(south);
        }
      }
    }

    const area = component.length;
    if (area < minCells) continue;
    if (area > maxArea) continue;
    // Continental-rift grabens relax the water-budget gate in proportion to how
    // strongly the basin overlaps a rift floor, so rift lakes (East African
    // Great Lakes, Baikal) form where a plain depression otherwise wouldn't.
    const effRatio = budgetRatio * (1 - riftLakeRelax * maxRift);
    if (maxFlow < effRatio * petSum) continue;

    for (let i = 0; i < area; i++) out[component[i]] = 1;
  }

  return out;
}

// --- D8 flow direction ------------------------------------------------------

/**
 * Deterministic per-cell/per-direction jitter. Priority-flood on a plateau
 * raises neighbors by just FILL_EPSILON, so many cells have 8 nearly-tied
 * drops and "first one wins" picks the same direction cell after cell —
 * producing perfectly straight 1-cell canyons under stream-power erosion.
 * A tiny stable jitter breaks ties so drainage fans out naturally.
 */
function d8TieJitter(nx: number, ny: number, d: number): number {
  let h = (nx * 374761393) ^ (ny * 668265263) ^ (d * 1274126177);
  h = (h ^ (h >>> 13)) >>> 0;
  // Scale so max jitter is ~6e-5 — larger than FILL_EPSILON (1e-6) so it
  // breaks priority-flood ties, but well below natural elevation gradients
  // so it doesn't misroute real drainage.
  return (h & 0xffff) * 1e-9;
}

function computeD8FlowDir(
  filled: Float32Array,
  width: number,
  height: number,
  seaLevel: number,
  faultLines?: Float32Array,
  faultAffinity = 0
): Int8Array {
  const flowDir = new Int8Array(filled.length).fill(-1);
  const useFault = faultLines !== undefined && faultAffinity > 0;

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
        // Base downslope score (gradient + tie-jitter). A neighbor must clear
        // this > 0 test to be a candidate — i.e. be genuinely downhill — BEFORE
        // any fault bias, so the priority-flood monotonic-descent guarantee and
        // the accumulation topological order are preserved.
        const base = (filled[idx] - filled[nIdx]) / D8_DIST[d] + d8TieJitter(nx, ny, d);
        if (base <= 0) continue;
        // Fault affinity only re-ranks among already-downhill neighbors, biasing
        // flow toward fault/boundary weak zones.
        const score = useFault ? base + faultLines![nIdx] * faultAffinity : base;
        if (score > bestDrop) {
          bestDrop = score;
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
  seaLevel: number,
  geom: WorldGeometry,
  rainfall?: Float32Array
): Float32Array {
  const size = width * height;
  const flowAcc = new Float32Array(size);
  const cosLatRow = geom.cosLatRow;

  // Collect land-cell indices, then sort by descending elevation. Each cell
  // contributes (rainfall ?? 1) · cos(lat) so flowAcc represents total upstream
  // catchment-weighted-by-area on the sphere — polar cells (small km² area)
  // contribute proportionally less, equatorial cells unchanged from before.
  let landCount = 0;
  const landIdx = new Int32Array(size);
  for (let y = 0; y < height; y++) {
    const cosLat = cosLatRow[y];
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      const i = rowBase + x;
      if (filled[i] >= seaLevel) {
        landIdx[landCount++] = i;
        flowAcc[i] = (rainfall ? rainfall[i] : 1) * cosLat;
      }
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
  geom: WorldGeometry,
  K: number,
  m: number,
  n: number
): void {
  const d8KmDist = geom.d8KmDist;
  for (let y = 0; y < height; y++) {
    const rowD8Base = y * 8;
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
      // Slope is elev-units per km. Polar E-W km uses the COS_FLOOR clamp,
      // so polar slopes don't blow up where cos(lat) → 0.
      const slope = drop / d8KmDist[rowD8Base + d];

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
  geom: WorldGeometry,
  kd: number
): void {
  if (kd <= 0) return;
  const src = Float32Array.from(elevation);
  const diffWeights = geom.diffWeights;
  for (let y = 0; y < height; y++) {
    const wRow = y * 3;
    const wEw = diffWeights[wRow + 0];
    const wNs = diffWeights[wRow + 1];
    const wDiag = diffWeights[wRow + 2];
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (src[idx] < seaLevel) continue;

      // Inverse-distance-squared neighbor weighting → diffusion is isotropic
      // in km-space. Polar rows weight EW heavier than NS because EW pixels
      // span fewer km there. Boundary rows skip the missing N/S neighbors and
      // we renormalize against the actually-summed weight so the y=0 / y=H-1
      // rows still produce a proper weighted mean (no synthetic boundary).
      let sum = 0;
      let totalW = 0;
      for (let d = 0; d < 8; d++) {
        const ny = y + D8_DY[d];
        if (ny < 0 || ny >= height) continue;
        const nx = mod(x + D8_DX[d], width);
        const slot = D8_DIFF_SLOT[d];
        const w = slot === 0 ? wEw : slot === 1 ? wNs : wDiag;
        sum += src[ny * width + nx] * w;
        totalW += w;
      }
      if (totalW <= 0) continue;
      const avg = sum / totalW;
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

// --- Pass 2: rain-aware flow & rivers (no erosion) -------------------------

/**
 * Re-runs depression fill, D8 routing, accumulation (weighted by `rainfall`),
 * and river/lake masking on the post-erosion elevation. Used as a cheap
 * second pass after climate so rivers and lakes reflect actual precipitation
 * rather than the uniform rainfall assumption used during erosion.
 *
 * Erosion is intentionally skipped — topology is locked in by pass 1.
 *
 * Lake detection compares catchment-delivered inflow against basin PET demand
 * (see `buildLakeMaskGated`) so dry basins — even large cool-floored ones —
 * remain salt flats rather than spurious lakes.
 */
/** Reference annual precipitation (mm/yr) used to normalize the rainfall
 *  flow weight. A cell receiving 1000 mm/yr contributes 1.0 unit per step —
 *  which keeps the flow-accumulation magnitudes (and the riverLogThreshold
 *  tuning) aligned with the pass-1 erosion run, where rainfall = 1.0. */
const PRECIP_FLOW_REFERENCE_MM = 1000;

export function computeFlowAndRivers(
  fields: WorldFields,
  geom: WorldGeometry,
  config: HydrologyVariables
): HydrologyResult {
  const { width, height } = fields;
  const elevation = fields.elevation!;
  const seaLevel = fields.seaLevel!;
  const precipAnnualMm = fields.precipAnnual!;
  const petAnnual = fields.petAnnual!;

  // Normalize precipitation AND PET to dimensionless units against the same
  // reference so that flow-accumulation magnitudes match the pass-1
  // (uniform-rainfall) scale the river threshold was calibrated against,
  // and the lake water-budget ratio (max flow vs Σ PET) stays unitless.
  const rainfallFlow = new Float32Array(precipAnnualMm.length);
  const petFlow = new Float32Array(petAnnual.length);
  const invRef = 1 / PRECIP_FLOW_REFERENCE_MM;
  for (let i = 0; i < precipAnnualMm.length; i++) {
    rainfallFlow[i] = precipAnnualMm[i] * invRef;
    petFlow[i] = petAnnual[i] * invRef;
  }

  const { filled, flowAcc } = routeFlow(
    elevation,
    width,
    height,
    seaLevel,
    geom,
    rainfallFlow,
    fields.faultLines,
    config.faultRiverAffinity
  );
  const lakes = buildLakeMaskGated(
    elevation,
    filled,
    flowAcc,
    petFlow,
    width,
    height,
    seaLevel,
    config.lakeDepthEpsilon,
    config.lakeBudgetRatio,
    config.lakeMaxAreaFraction,
    config.lakeMinCells,
    fields.riftFloorMask,
    config.riftLakeRelax
  );
  const rivers = buildRiverMask(flowAcc, elevation, seaLevel, config.riverLogThreshold);
  return { flowAccumulation: flowAcc, rivers, lakes };
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
