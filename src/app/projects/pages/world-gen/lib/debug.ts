import { KoppenClass, WorldData } from './types';

/**
 * Approximate Köppen-Geiger climate distribution on real Earth, as a fraction
 * of total ice-free land area. From Beck et al. (2018) and Peel et al. (2007).
 * Numbers are rounded; exact values vary by source and projection.
 */
const EARTH_KOPPEN_PCT: Record<KoppenClass, number> = {
  [KoppenClass.Af]: 7.0,
  [KoppenClass.Am]: 4.0,
  [KoppenClass.Aw]: 8.0,
  [KoppenClass.BWh]: 14.0,
  [KoppenClass.BWk]: 5.0,
  [KoppenClass.BSh]: 8.0,
  [KoppenClass.BSk]: 6.0,
  [KoppenClass.Cfa]: 3.0,
  [KoppenClass.Cfb]: 4.0,
  [KoppenClass.Csa]: 2.0,
  [KoppenClass.Csb]: 1.0,
  [KoppenClass.Cwa]: 2.0,
  [KoppenClass.Cwb]: 1.0,
  [KoppenClass.Dfa]: 2.0,
  [KoppenClass.Dfb]: 4.0,
  [KoppenClass.Dfc]: 9.0,
  [KoppenClass.Dwa]: 1.0,
  [KoppenClass.Dwb]: 2.0,
  [KoppenClass.Dsa]: 0.5,
  [KoppenClass.Dsb]: 0.5,
  [KoppenClass.ET]: 8.0,
  [KoppenClass.EF]: 5.0,
};

const KOPPEN_CODE: Record<KoppenClass, string> = {
  [KoppenClass.Af]: 'Af',
  [KoppenClass.Am]: 'Am',
  [KoppenClass.Aw]: 'Aw',
  [KoppenClass.BWh]: 'BWh',
  [KoppenClass.BWk]: 'BWk',
  [KoppenClass.BSh]: 'BSh',
  [KoppenClass.BSk]: 'BSk',
  [KoppenClass.Cfa]: 'Cfa',
  [KoppenClass.Cfb]: 'Cfb',
  [KoppenClass.Csa]: 'Csa',
  [KoppenClass.Csb]: 'Csb',
  [KoppenClass.Cwa]: 'Cwa',
  [KoppenClass.Cwb]: 'Cwb',
  [KoppenClass.Dfa]: 'Dfa',
  [KoppenClass.Dfb]: 'Dfb',
  [KoppenClass.Dfc]: 'Dfc',
  [KoppenClass.Dwa]: 'Dwa',
  [KoppenClass.Dwb]: 'Dwb',
  [KoppenClass.Dsa]: 'Dsa',
  [KoppenClass.Dsb]: 'Dsb',
  [KoppenClass.ET]: 'ET',
  [KoppenClass.EF]: 'EF',
};

interface FieldStats {
  min: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
}

interface BandStats {
  landCells: number;
  pctOfLand: number;
  topClasses: { code: string; pct: number }[];
}

export interface WorldStats {
  map: { width: number; height: number; totalCells: number; landCells: number; landPct: number };
  /** Tectonic plate size distribution (area-weighted % of the globe), to catch
   *  a single plate dominating. `areaPct` is sorted descending. */
  plates: { count: number; largestPct: number; smallestPct: number; areaPct: number[] };
  koppen: Record<string, { sim: number; earth: number; delta: number }>;
  groups: Record<string, { sim: number; earth: number; delta: number }>;
  aridityHistogram: Record<string, number>;
  fields: Record<string, FieldStats>;
  latitudeBands: Record<string, BandStats>;
}

/**
 * Print post-generation diagnostics as a single JSON blob to the dev console.
 * The user can copy the entire object to clipboard and paste it into a
 * conversation for a meaningful tuning discussion.
 *
 * Land cells are everything ≥ seaLevel; ocean cells are excluded everywhere
 * because Köppen classes don't apply to water.
 */
export function printWorldStats(worldData: WorldData): void {
  const stats = computeWorldStats(worldData);
  // console.log a label first so the user can find it; then pretty-print the
  // JSON so it's directly copy-pasteable.
  console.log('%c🌍 World stats (JSON below — right-click → Copy object)', 'font-weight: bold; color: #3a8');
  console.log(JSON.stringify(stats, null, 2));
  // Also stash on window so the user can reach it from the console with `__worldStats`.
  (globalThis as unknown as { __worldStats?: WorldStats }).__worldStats = stats;
}

export function computeWorldStats(worldData: WorldData): WorldStats {
  const {
    width,
    height,
    elevation,
    seaLevel,
    plateMap,
    plates,
    koppenClass,
    precipAnnual,
    precipSummer,
    precipWinter,
    soilMoisture,
    aridityIndex,
    temperatureSummer,
    temperatureWinter,
    temperatureMean,
    petAnnual,
  } = worldData;

  // Per-row cos(lat): the area weight of each cell. Köppen / group / band
  // percentages are reported as fractions of *land surface area*, not cell count,
  // so a polar row's land cells contribute ~10× less than an equatorial row's.
  // This is what reconciles our equirect grid with Earth's spherical reality.
  const cosLatRow = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    cosLatRow[y] = Math.cos(Math.PI / 2 - ((y + 0.5) / height) * Math.PI);
  }
  // Total area weight per cell, summed over the whole grid (land + ocean).
  let totalAreaWeight = 0;
  for (let y = 0; y < height; y++) totalAreaWeight += cosLatRow[y] * width;

  const totalCells = elevation.length;
  const landIndices: number[] = [];
  const landRows: number[] = [];
  let landCount = 0;
  let landAreaWeight = 0;
  for (let y = 0; y < height; y++) {
    const w = cosLatRow[y];
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (elevation[i] >= seaLevel) {
        landIndices.push(i);
        landRows.push(y);
        landCount++;
        landAreaWeight += w;
      }
    }
  }

  // --- Tectonic plate size distribution (area-weighted, land + ocean) ---
  const plateAreaWeight = new Float64Array(plates.length);
  for (let y = 0; y < height; y++) {
    const w = cosLatRow[y];
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      const p = plateMap[rowBase + x];
      if (p >= 0 && p < plates.length) plateAreaWeight[p] += w;
    }
  }
  const invTotalArea = totalAreaWeight > 0 ? 1 / totalAreaWeight : 0;
  const plateAreaPct = Array.from(plateAreaWeight, (w) => round2(100 * w * invTotalArea)).sort((a, b) => b - a);
  const plateStats = {
    count: plates.length,
    largestPct: plateAreaPct[0] ?? 0,
    smallestPct: plateAreaPct[plateAreaPct.length - 1] ?? 0,
    areaPct: plateAreaPct,
  };

  // --- Köppen distribution (area-weighted) ---
  const koppenWeight = new Float64Array(Object.keys(KoppenClass).length / 2);
  for (let n = 0; n < landIndices.length; n++) {
    koppenWeight[koppenClass[landIndices[n]]] += cosLatRow[landRows[n]];
  }
  const koppen: Record<string, { sim: number; earth: number; delta: number }> = {};
  const invLandWeight = landAreaWeight > 0 ? 1 / landAreaWeight : 0;
  for (let k = 0; k < koppenWeight.length; k++) {
    const sim = round2(100 * koppenWeight[k] * invLandWeight);
    const earth = EARTH_KOPPEN_PCT[k as KoppenClass] ?? 0;
    koppen[KOPPEN_CODE[k as KoppenClass]] = { sim, earth, delta: round2(sim - earth) };
  }

  // --- Group totals A/B/C/D/E (area-weighted) ---
  const groupSim = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const earthGroups = { A: 19, B: 33, C: 13, D: 22, E: 13 };
  for (let k = 0; k < koppenWeight.length; k++) {
    const pct = 100 * koppenWeight[k] * invLandWeight;
    if (k <= KoppenClass.Aw) groupSim.A += pct;
    else if (k <= KoppenClass.BSk) groupSim.B += pct;
    else if (k <= KoppenClass.Cwb) groupSim.C += pct;
    else if (k <= KoppenClass.Dsb) groupSim.D += pct;
    else groupSim.E += pct;
  }
  const groups: Record<string, { sim: number; earth: number; delta: number }> = {};
  for (const g of ['A', 'B', 'C', 'D', 'E'] as const) {
    groups[g] = { sim: round2(groupSim[g]), earth: earthGroups[g], delta: round2(groupSim[g] - earthGroups[g]) };
  }

  // --- Aridity histogram (UNEP buckets) ---
  const aiBuckets = [
    { name: 'hyper-arid (<0.05)', from: 0, to: 0.05 },
    { name: 'arid (0.05-0.20)', from: 0.05, to: 0.2 },
    { name: 'semi-arid (0.20-0.50)', from: 0.2, to: 0.5 },
    { name: 'dry-sub-humid (0.50-0.65)', from: 0.5, to: 0.65 },
    { name: 'humid (0.65-1.00)', from: 0.65, to: 1.0 },
    { name: 'very-humid (>=1.00)', from: 1.0, to: Infinity },
  ];
  const aridityHistogram: Record<string, number> = {};
  for (const b of aiBuckets) {
    let count = 0;
    for (const i of landIndices) if (aridityIndex[i] >= b.from && aridityIndex[i] < b.to) count++;
    aridityHistogram[b.name] = round2((100 * count) / landCount);
  }

  // --- Field statistics ---
  const fields: Record<string, FieldStats> = {
    // Land-only elevation in meters — the hypsometry histogram for tuning the
    // two-slope transfer and context-detail amplitudes.
    elevation: fieldStats(elevation, landIndices),
    precipAnnual: fieldStats(precipAnnual, landIndices),
    precipSummer: fieldStats(precipSummer, landIndices),
    precipWinter: fieldStats(precipWinter, landIndices),
    aridityIndex: fieldStats(aridityIndex, landIndices),
    soilMoisture: fieldStats(soilMoisture, landIndices),
    temperatureMean: fieldStats(temperatureMean, landIndices),
    temperatureSummer: fieldStats(temperatureSummer, landIndices),
    temperatureWinter: fieldStats(temperatureWinter, landIndices),
    petAnnual: fieldStats(petAnnual, landIndices),
  };

  // --- Köppen by latitude band (area-weighted) ---
  const bandDefs = [
    { name: '0-15deg (tropical)', from: 0, to: 15 / 90 },
    { name: '15-30deg (subtropical)', from: 15 / 90, to: 30 / 90 },
    { name: '30-45deg (warm-temperate)', from: 30 / 90, to: 45 / 90 },
    { name: '45-60deg (cold-temperate)', from: 45 / 90, to: 60 / 90 },
    { name: '60-90deg (polar)', from: 60 / 90, to: 1 },
  ];
  const latitudeBands: Record<string, BandStats> = {};
  for (const band of bandDefs) {
    const weights = new Float64Array(koppenWeight.length);
    let bandLandWeight = 0;
    let bandLandCells = 0;
    for (let n = 0; n < landIndices.length; n++) {
      const y = landRows[n];
      const distEq = Math.abs(y / height - 0.5) * 2;
      if (distEq >= band.from && distEq < band.to) {
        const w = cosLatRow[y];
        weights[koppenClass[landIndices[n]]] += w;
        bandLandWeight += w;
        bandLandCells++;
      }
    }
    if (bandLandWeight === 0) {
      latitudeBands[band.name] = { landCells: 0, pctOfLand: 0, topClasses: [] };
      continue;
    }
    const invBand = 1 / bandLandWeight;
    const topClasses = Array.from(weights)
      .map((w, k) => ({ code: KOPPEN_CODE[k as KoppenClass], pct: round2(100 * w * invBand) }))
      .filter((e) => e.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 6);
    latitudeBands[band.name] = {
      landCells: bandLandCells,
      pctOfLand: round2(100 * bandLandWeight * invLandWeight),
      topClasses,
    };
  }

  return {
    map: {
      width,
      height,
      totalCells,
      landCells: landCount,
      landPct: round2((100 * landAreaWeight) / totalAreaWeight),
    },
    plates: plateStats,
    koppen,
    groups,
    aridityHistogram,
    fields,
    latitudeBands,
  };
}

/**
 * Aggregate Köppen-class & group statistics across multiple seeds. For each
 * class we report mean, stddev, min, max across the seeds, plus the Earth
 * reference and the (mean - earth) delta. Variance is the diagnostic that
 * tells us whether a tuning result is robust (low stddev → repeatable across
 * seeds) or seed-dependent (high stddev → an artifact of one map's geography).
 */
export interface MultiSeedStats {
  seedCount: number;
  perSeed: { seed: number; landPct: number }[];
  koppen: Record<string, { mean: number; stddev: number; min: number; max: number; earth: number; delta: number }>;
  groups: Record<string, { mean: number; stddev: number; min: number; max: number; earth: number; delta: number }>;
}

export function aggregateMultiSeed(seeds: number[], stats: WorldStats[]): MultiSeedStats {
  const koppen: MultiSeedStats['koppen'] = {};
  const groups: MultiSeedStats['groups'] = {};
  if (stats.length === 0) return { seedCount: 0, perSeed: [], koppen, groups };

  const koppenKeys = Object.keys(stats[0].koppen);
  for (const k of koppenKeys) {
    const vals = stats.map((s) => s.koppen[k].sim);
    koppen[k] = {
      ...summarize(vals),
      earth: stats[0].koppen[k].earth,
      delta: round2(mean(vals) - stats[0].koppen[k].earth),
    };
  }
  const groupKeys = Object.keys(stats[0].groups);
  for (const g of groupKeys) {
    const vals = stats.map((s) => s.groups[g].sim);
    groups[g] = {
      ...summarize(vals),
      earth: stats[0].groups[g].earth,
      delta: round2(mean(vals) - stats[0].groups[g].earth),
    };
  }
  return {
    seedCount: stats.length,
    perSeed: stats.map((s, i) => ({ seed: seeds[i], landPct: s.map.landPct })),
    koppen,
    groups,
  };
}

function summarize(vals: number[]): { mean: number; stddev: number; min: number; max: number } {
  const m = mean(vals);
  const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length;
  return {
    mean: round2(m),
    stddev: round2(Math.sqrt(variance)),
    min: round2(Math.min(...vals)),
    max: round2(Math.max(...vals)),
  };
}

function mean(vals: number[]): number {
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function fieldStats(field: Float32Array, indices: number[]): FieldStats {
  const sorted = new Float32Array(indices.length);
  let sum = 0;
  for (let n = 0; n < indices.length; n++) {
    const v = field[indices[n]];
    sorted[n] = v;
    sum += v;
  }
  sorted.sort();
  const n = sorted.length;
  const pct = (q: number) => sorted[Math.min(n - 1, Math.floor(n * q))];
  return {
    min: round3(sorted[0] ?? 0),
    p10: round3(pct(0.1)),
    p25: round3(pct(0.25)),
    p50: round3(pct(0.5)),
    p75: round3(pct(0.75)),
    p90: round3(pct(0.9)),
    max: round3(sorted[n - 1] ?? 0),
    mean: round3(sum / n),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
