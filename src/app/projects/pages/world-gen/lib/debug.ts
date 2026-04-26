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

interface WorldStats {
  map: { width: number; height: number; totalCells: number; landCells: number; landPct: number };
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

function computeWorldStats(worldData: WorldData): WorldStats {
  const {
    width,
    height,
    elevation,
    seaLevel,
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

  const totalCells = elevation.length;
  const landIndices: number[] = [];
  const landRows: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (elevation[i] >= seaLevel) {
        landIndices.push(i);
        landRows.push(y);
      }
    }
  }
  const landCount = landIndices.length;

  // --- Köppen distribution ---
  const koppenCounts = new Array(Object.keys(KoppenClass).length / 2).fill(0);
  for (const i of landIndices) koppenCounts[koppenClass[i]]++;
  const koppen: Record<string, { sim: number; earth: number; delta: number }> = {};
  for (let k = 0; k < koppenCounts.length; k++) {
    const sim = round2((100 * koppenCounts[k]) / landCount);
    const earth = EARTH_KOPPEN_PCT[k as KoppenClass] ?? 0;
    koppen[KOPPEN_CODE[k as KoppenClass]] = { sim, earth, delta: round2(sim - earth) };
  }

  // --- Group totals A/B/C/D/E ---
  const groupSim = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const earthGroups = { A: 19, B: 33, C: 13, D: 22, E: 13 };
  for (let k = 0; k < koppenCounts.length; k++) {
    const pct = (100 * koppenCounts[k]) / landCount;
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

  // --- Köppen by latitude band ---
  const bandDefs = [
    { name: '0-15deg (tropical)', from: 0, to: 15 / 90 },
    { name: '15-30deg (subtropical)', from: 15 / 90, to: 30 / 90 },
    { name: '30-45deg (warm-temperate)', from: 30 / 90, to: 45 / 90 },
    { name: '45-60deg (cold-temperate)', from: 45 / 90, to: 60 / 90 },
    { name: '60-90deg (polar)', from: 60 / 90, to: 1 },
  ];
  const latitudeBands: Record<string, BandStats> = {};
  for (const band of bandDefs) {
    const counts = new Array(koppenCounts.length).fill(0);
    let bandLand = 0;
    for (let n = 0; n < landIndices.length; n++) {
      const y = landRows[n];
      const distEq = Math.abs(y / height - 0.5) * 2;
      if (distEq >= band.from && distEq < band.to) {
        counts[koppenClass[landIndices[n]]]++;
        bandLand++;
      }
    }
    if (bandLand === 0) {
      latitudeBands[band.name] = { landCells: 0, pctOfLand: 0, topClasses: [] };
      continue;
    }
    const topClasses = counts
      .map((c, k) => ({ code: KOPPEN_CODE[k as KoppenClass], pct: round2((100 * c) / bandLand) }))
      .filter((e) => e.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 6);
    latitudeBands[band.name] = {
      landCells: bandLand,
      pctOfLand: round2((100 * bandLand) / landCount),
      topClasses,
    };
  }

  return {
    map: {
      width,
      height,
      totalCells,
      landCells: landCount,
      landPct: round2((100 * landCount) / totalCells),
    },
    koppen,
    groups,
    aridityHistogram,
    fields,
    latitudeBands,
  };
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
