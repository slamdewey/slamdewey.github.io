import { OpenSimplexNoise } from '@lib/noise';
import { mod, sphericalEmbed3D } from '@lib/math';
import { NoiseVariables, TectonicVariables } from '../../types';
import { BoundaryInfo, InteractionType, PlateProperties, PlateType } from './types';
import { interactionElevation } from './boundaries';

// ── Per-interaction falloff width multipliers ────────────────────────────

/**
 * Falloff width multiplier per interaction type.
 * Collision zones (Himalayas) are wide; transform faults (San Andreas) are narrow.
 * For subduction, the overriding plate side is wider than the trench side.
 */
const FALLOFF_MULTIPLIER: Record<InteractionType, number> = {
  [InteractionType.Collision]: 1.8,
  [InteractionType.Subduction]: 1.4, // overriding (continental) side
  [InteractionType.OceanicConvergence]: 0.7,
  [InteractionType.ContinentalRift]: 1.2,
  [InteractionType.OceanicRidge]: 0.8,
  [InteractionType.Transform]: 0.35,
};

/** Subducting-side falloff is narrower (trench). */
const SUBDUCTION_TRENCH_MULTIPLIER = 0.4;

// ── Continental shelf ─────────────────────────────────────────────────────

/**
 * Width of the continental shelf band (in multiples of baseFalloff), measured
 * inland from a passive-style continental-oceanic margin. Scales with map size
 * via baseFalloff.
 */
const SHELF_WIDTH_MULTIPLIER = 3.0;

/**
 * Target elevation for the near-margin shelf band. Sits just below the sea
 * level the percentile rule tends to land on, so fBm detail can lift parts
 * of it back above water as offshore islands.
 */
const SHELF_TARGET = -0.25;

// ── Rasterization ─────────────────────────────────────────────────────────

export function rasterizePlateInteractions(
  plateMap: Int32Array,
  boundaries: BoundaryInfo[],
  plates: PlateProperties[],
  width: number,
  height: number,
  nv: NoiseVariables,
  tv: TectonicVariables
): {
  baseElevation: Float32Array;
  faults: Float32Array;
  mountainRanges: Float32Array;
  continentalSubRelief: Float32Array;
  distToRidge: Float32Array;
  oceanAge: Float32Array;
} {
  const falloffScale = tv.boundaryFalloffScale;
  const size = width * height;
  const baseElevation = new Float32Array(size);
  const faults = new Float32Array(size);
  const mountainRanges = new Float32Array(size);

  const plateCount = plates.length;

  // Build boundary lookup: packed key -> boundary array index
  const boundaryMap = new Map<number, number>();
  for (let bi = 0; bi < boundaries.length; bi++) {
    const b = boundaries[bi];
    const lo = Math.min(b.plateA, b.plateB);
    const hi = Math.max(b.plateA, b.plateB);
    boundaryMap.set(lo * plateCount + hi, bi);
  }

  // Pass 1: Detect plate-boundary pixels, record highest-intensity boundary index
  const isBoundary = new Uint8Array(size);
  const nearestBoundary = new Int16Array(size).fill(-1);
  // Pixels on continental plates that border an oceanic plate via a passive-style
  // interaction (transform or rift). Seeds the shelf distance transform so the
  // Jacobi target can sag toward shallow-water depth on this side of the margin.
  // Subduction continental-side pixels are intentionally excluded so the
  // mountain belt there keeps its full height.
  const shelfSeedMask = new Uint8Array(size);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const plate = plateMap[idx];

      const neighbors = [
        x > 0 ? plateMap[idx - 1] : plateMap[y * width + width - 1],
        x < width - 1 ? plateMap[idx + 1] : plateMap[y * width],
        y > 0 ? plateMap[idx - width] : -1,
        y < height - 1 ? plateMap[idx + width] : -1,
      ];

      let bestIntensity = -1;
      let hasPassiveOceanicNeighbor = false;
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && neighbor !== plate) {
          const lo = Math.min(plate, neighbor);
          const hi = Math.max(plate, neighbor);
          const bi = boundaryMap.get(lo * plateCount + hi);
          if (bi !== undefined) {
            const nb = boundaries[bi];
            if (nb.intensity > bestIntensity) {
              bestIntensity = nb.intensity;
              nearestBoundary[idx] = bi;
            }
            if (
              plates[plate].type === PlateType.Continental &&
              plates[neighbor].type === PlateType.Oceanic &&
              (nb.interactionType === InteractionType.Transform ||
                nb.interactionType === InteractionType.ContinentalRift)
            ) {
              hasPassiveOceanicNeighbor = true;
            }
          }
        }
      }
      if (bestIntensity >= 0) {
        isBoundary[idx] = 1;
      }
      if (hasPassiveOceanicNeighbor) {
        shelfSeedMask[idx] = 1;
      }
    }
  }

  // Pass 2: Chamfer distance transform
  const dist = chamferDistance(isBoundary, width, height);

  // Pass 2b: Chamfer distance to nearest passive-margin shelf seed. Continental
  // pixels within shelf range get their gravity target pulled toward SHELF_TARGET,
  // producing the shallow band that gives coastlines their ragged, island-dotted
  // character. Pixels far inland (or outside continental plates entirely) keep
  // their plate's baseline as the target.
  const distToShelfSeed = chamferDistance(shelfSeedMask, width, height);

  // Pass 3: BFS from boundary pixels to propagate boundary index outward
  // Use the maximum possible falloff width for BFS reach, then per-pixel widths in Pass 5
  const baseFalloff = Math.max(4, Math.round(width / 64));
  const maxFalloffWidth = Math.ceil(baseFalloff * 1.8 * falloffScale); // 1.8 = largest multiplier (Collision)
  propagateBoundaryIndex(nearestBoundary, isBoundary, dist, maxFalloffWidth, width, height);

  const shelfWidth = baseFalloff * SHELF_WIDTH_MULTIPLIER * falloffScale;

  // Pass 4: Jacobi relaxation for smooth interior elevation gradients.
  // Each pixel has an "effective base" — usually its plate's isostatic
  // baseline, but pulled toward SHELF_TARGET on the continental side of
  // passive-style cont-ocean margins.
  const effectiveBase = (idx: number): number => {
    const plate = plates[plateMap[idx]];
    if (plate.type !== PlateType.Continental) return plate.baseElevation;
    const d = distToShelfSeed[idx];
    if (d >= shelfWidth) return plate.baseElevation;
    const t = d / shelfWidth; // 0 at seed, 1 at far edge of shelf band
    return SHELF_TARGET * (1 - t) + plate.baseElevation * t;
  };

  // Initialize every pixel (boundary and interior) at its effective base.
  // This lets continental boundary pixels adjacent to passive oceanic margins
  // sag toward SHELF_TARGET along with their neighbors, instead of standing up
  // as a one-pixel cliff above the shelf (which previously formed a ring of
  // strip-islands tracing the continental fault lines).
  for (let i = 0; i < size; i++) {
    baseElevation[i] = effectiveBase(i);
  }

  // Jacobi iterations: smooth interior while keeping boundaries pinned
  const JACOBI_ITERATIONS = 8;
  const GRAVITY_ALPHA = 0.1; // pull toward effective base — higher = flatter interiors
  const temp = new Float32Array(size);

  for (let iter = 0; iter < JACOBI_ITERATIONS; iter++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;

        // Average of 4 neighbors (wrap x, clamp y) — needed for both pinned
        // (soft-blend) and interior branches under Fix D.
        const left = baseElevation[y * width + mod(x - 1, width)];
        const right = baseElevation[y * width + mod(x + 1, width)];
        const up = y > 0 ? baseElevation[(y - 1) * width + x] : baseElevation[idx];
        const down = y < height - 1 ? baseElevation[(y + 1) * width + x] : baseElevation[idx];
        const avg = (left + right + up + down) / 4;

        if (isBoundary[idx]) {
          // Fix D: passive seams (transforms, continental rifts) blend halfway
          // with neighbors so they don't survive smoothing as one-pixel cliffs.
          // Orogenic boundaries stay hard-pinned so mountain belts keep their crest.
          if (tv.boundarySoftenPassive) {
            const bi = nearestBoundary[idx];
            const type = bi >= 0 ? boundaries[bi].interactionType : null;
            if (type === InteractionType.Transform || type === InteractionType.ContinentalRift) {
              temp[idx] = 0.5 * baseElevation[idx] + 0.5 * avg;
              continue;
            }
          }
          temp[idx] = baseElevation[idx]; // pinned
          continue;
        }

        temp[idx] = (1 - GRAVITY_ALPHA) * avg + GRAVITY_ALPHA * effectiveBase(idx);
      }
    }
    // Swap
    baseElevation.set(temp);
  }

  // Pass 4.5: Intra-plate relief so coastlines aren't uniform-by-plate.
  //   - Continental pixels get a signed ridged-fBm perturbation — cratons,
  //     swells, intracratonic basins (Hudson-Bay-style embayments).
  //   - Oceanic pixels get an age-from-ridge exponential gradient —
  //     mid-ocean ridges rise, abyssal plains sink.
  // Applied *after* Jacobi (so smoothing doesn't erase it) but *before* the
  // interaction-delta overlay (so orogenic belts still sit on top).
  const continentalSubRelief = new Float32Array(size);

  // Seed the ridge-distance field from divergent-boundary pixels only.
  const ridgeSeedMask = new Uint8Array(size);
  let hasRidgeSeeds = false;
  for (let i = 0; i < size; i++) {
    if (!isBoundary[i]) continue;
    const bi = nearestBoundary[i];
    if (bi < 0) continue;
    const type = boundaries[bi].interactionType;
    if (type === InteractionType.OceanicRidge || type === InteractionType.ContinentalRift) {
      ridgeSeedMask[i] = 1;
      hasRidgeSeeds = true;
    }
  }
  // Sphere-aware: flat chamfer would pinch ocean-age contours to a vertex at
  // the poles because horizontal pixel cost doesn't shrink with cos(lat). The
  // other two chamfer calls above (boundary falloff, shelf band) share this
  // latent bug, but they're clipped to a few pixels of falloff so it never
  // shows visually — left as-is for now.
  // Output is in radians; rescale to equator-pixel-equivalent units so the
  // existing oceanAgeScale = width/6 stays calibrated for the exp() falloff.
  const distToRidge = sphericalDistanceTransform(ridgeSeedMask, width, height);
  const radToEqPx = width / (2 * Math.PI);
  for (let i = 0; i < size; i++) {
    if (Number.isFinite(distToRidge[i])) distToRidge[i] *= radToEqPx;
  }
  const oceanAge = new Float32Array(size);
  const oceanAgeScale = width / 6;

  // Find the max finite ridge distance for oceanAge normalization. Unreachable
  // cells come back as Infinity; with no seeds the hasRidgeSeeds guard skips
  // this whole block and oceanAge stays at 0.
  if (hasRidgeSeeds) {
    let maxRidgeDist = 0;
    for (let i = 0; i < size; i++) {
      const d = distToRidge[i];
      if (Number.isFinite(d) && d > maxRidgeDist) maxRidgeDist = d;
    }
    const invMax = maxRidgeDist > 0 ? 1 / maxRidgeDist : 0;
    for (let i = 0; i < size; i++) {
      oceanAge[i] = Math.min(1, distToRidge[i] * invMax);
    }
  }

  const subReliefNoise = new OpenSimplexNoise((nv.seed ^ 0xbee5ca7e) | 0);
  const subReliefFreq = nv.frequency * tv.continentalSubReliefFrequency;
  const subReliefAmp = tv.continentalSubReliefAmplitude;
  const ageStrength = tv.oceanicAgeGradientStrength;

  const npSub = new Float32Array(3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const plate = plates[plateMap[idx]];
      if (plate.type === PlateType.Continental) {
        sphericalEmbed3D(x, y, width, height, npSub);
        // Plain fBm in [-1, 1], symmetric around 0 → roughly half swells
        // (positive) and half basins (negative). The earlier ridged-fBm form
        // (1 − |n|) only produced positive deltas, so the diverging red/blue
        // sub-relief layer never showed blue.
        let sum = 0;
        let range = 0;
        let f = subReliefFreq;
        let a = 1;
        for (let o = 0; o < 4; o++) {
          const n = subReliefNoise.eval3D(npSub[0] * f, npSub[1] * f, npSub[2] * f);
          sum += n * a;
          range += a;
          f *= 2.0;
          a *= 0.5;
        }
        const signed = sum / Math.max(range, 1);
        const delta = signed * subReliefAmp;
        continentalSubRelief[idx] = delta;
        baseElevation[idx] += delta;
      } else if (hasRidgeSeeds) {
        // Oceanic age-from-ridge gradient: ridges lift, abyssal plains sink.
        const d = distToRidge[idx];
        const rawDelta = 0.15 * Math.exp(-d / oceanAgeScale) - 0.1;
        baseElevation[idx] += rawDelta * ageStrength;
      }
    }
  }

  // Pass 5: Add interaction falloff for faults and mountainRanges,
  // and overlay interaction elevation delta on top of the gradient base.
  // Each interaction type has its own falloff width; subduction is asymmetric.
  //
  // `dist[i]` is warped by a low-amplitude noise before the falloff curve is
  // evaluated, so the interaction band (especially the subduction mountain
  // belt) does not trace the Voronoi polygon 1:1 — without this, coastlines
  // on active margins are forced straight by the uniform +0.35 elevation
  // band stamped along the plate edge.
  const pass5Warp = new OpenSimplexNoise((nv.seed ^ 0xfa5170c5) | 0);
  const warpFreqPass5 = nv.frequency * tv.coastlineWarpFrequency;
  const npWarp = new Float32Array(3);

  for (let i = 0; i < size; i++) {
    const bi = nearestBoundary[i];
    if (bi < 0) continue;

    const b = boundaries[bi];
    const pixelPlate = plateMap[i];
    const isSubducting = b.subductingPlate === pixelPlate;

    // Compute per-pixel falloff width based on interaction type and side
    let multiplier = FALLOFF_MULTIPLIER[b.interactionType];
    if (b.interactionType === InteractionType.Subduction && isSubducting) {
      multiplier = SUBDUCTION_TRENCH_MULTIPLIER;
    } else if (b.interactionType === InteractionType.OceanicConvergence && isSubducting) {
      multiplier = SUBDUCTION_TRENCH_MULTIPLIER;
    }
    const effectiveFalloff = baseFalloff * multiplier * falloffScale;

    // Noise-warp the distance so the interaction band zigzags instead of
    // tracing the plate polygon. Amplitude is capped at 0.8·effectiveFalloff
    // so the band can jitter but cannot stamp phantom mountains far inland.
    const px = i % width;
    const py = (i - px) / width;
    sphericalEmbed3D(px, py, width, height, npWarp);
    const warpSample = pass5Warp.eval3D(
      npWarp[0] * warpFreqPass5,
      npWarp[1] * warpFreqPass5,
      npWarp[2] * warpFreqPass5
    );
    const warpLim = 0.8 * effectiveFalloff;
    const rawOffset = warpSample * effectiveFalloff * tv.coastlineWarpAmplitude * 3;
    const distOffset = rawOffset > warpLim ? warpLim : rawOffset < -warpLim ? -warpLim : rawOffset;
    const warpedDist = Math.max(0, dist[i] + distOffset);

    if (warpedDist >= effectiveFalloff) continue;

    const t = 1 - warpedDist / effectiveFalloff;
    const falloff = t * t; // quadratic for smoother edges

    const plateType = plates[pixelPlate].type;
    const { elevDelta, mountainRange } = interactionElevation(
      b.interactionType,
      plateType,
      b.intensity,
      falloff,
      isSubducting
    );

    // Apply interaction delta to every pixel in the falloff band, including
    // boundaries (t=1 there, matching the previously pinned crest magnitude).
    baseElevation[i] += elevDelta;
    mountainRanges[i] = mountainRange;
    faults[i] = b.intensity * falloff;
  }

  return { baseElevation, faults, mountainRanges, continentalSubRelief, distToRidge, oceanAge };
}

/**
 * BFS from boundary pixels to propagate the nearest boundary index
 * outward to all pixels within falloff range.
 */
function propagateBoundaryIndex(
  nearestBoundary: Int16Array,
  isBoundary: Uint8Array,
  dist: Float32Array,
  falloffWidth: number,
  width: number,
  height: number
): void {
  const queue: number[] = [];
  const visited = new Uint8Array(width * height);

  // Seed BFS with boundary pixels
  for (let i = 0; i < isBoundary.length; i++) {
    if (isBoundary[i]) {
      visited[i] = 1;
      queue.push(i);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx - x) / width;

    const neighborOffsets = [
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
      x > 0 ? idx - 1 : y * width + width - 1,
      x < width - 1 ? idx + 1 : y * width,
    ];

    for (const nIdx of neighborOffsets) {
      if (nIdx < 0 || visited[nIdx]) continue;
      if (dist[nIdx] >= falloffWidth) continue;

      visited[nIdx] = 1;
      nearestBoundary[nIdx] = nearestBoundary[idx];
      queue.push(nIdx);
    }
  }
}

/**
 * Multi-source Dijkstra on the equirect grid with sphere-aware edge weights.
 * Returns great-circle distance (radians) from each cell to the nearest seed,
 * Infinity if unreachable. Pole rows route across the pole to their antipodal
 * longitude — crucial for fields read on the sphere view, where flat chamfer
 * pinches to a vertex at the poles.
 */
function sphericalDistanceTransform(isSeed: Uint8Array, width: number, height: number): Float32Array {
  const size = width * height;
  const dist = new Float32Array(size);
  for (let i = 0; i < size; i++) dist[i] = Infinity;
  const visited = new Uint8Array(size);

  // Cell-center unit vectors on the sphere, used for great-circle edge cost.
  const centers = new Float32Array(size * 3);
  const tmp = new Float32Array(3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sphericalEmbed3D(x, y, width, height, tmp);
      const o = (y * width + x) * 3;
      centers[o] = tmp[0];
      centers[o + 1] = tmp[1];
      centers[o + 2] = tmp[2];
    }
  }

  // Binary min-heap over (dist, idx) pairs. Capacity 4× cell count is
  // empirically safe — each cell is rarely relaxed more than a couple of times.
  const heapCap = Math.max(64, size * 4);
  const heapDist = new Float32Array(heapCap);
  const heapIdx = new Int32Array(heapCap);
  let heapSize = 0;
  let poppedDist = 0;

  const heapPush = (d: number, idx: number): void => {
    let i = heapSize++;
    heapDist[i] = d;
    heapIdx[i] = idx;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapDist[parent] <= heapDist[i]) break;
      const td = heapDist[i];
      const ti = heapIdx[i];
      heapDist[i] = heapDist[parent];
      heapIdx[i] = heapIdx[parent];
      heapDist[parent] = td;
      heapIdx[parent] = ti;
      i = parent;
    }
  };

  const heapPop = (): number => {
    poppedDist = heapDist[0];
    const top = heapIdx[0];
    heapSize--;
    if (heapSize > 0) {
      heapDist[0] = heapDist[heapSize];
      heapIdx[0] = heapIdx[heapSize];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heapSize && heapDist[l] < heapDist[smallest]) smallest = l;
        if (r < heapSize && heapDist[r] < heapDist[smallest]) smallest = r;
        if (smallest === i) break;
        const td = heapDist[i];
        const ti = heapIdx[i];
        heapDist[i] = heapDist[smallest];
        heapIdx[i] = heapIdx[smallest];
        heapDist[smallest] = td;
        heapIdx[smallest] = ti;
        i = smallest;
      }
    }
    return top;
  };

  for (let i = 0; i < size; i++) {
    if (isSeed[i]) {
      dist[i] = 0;
      heapPush(0, i);
    }
  }

  const halfW = width >> 1;

  while (heapSize > 0) {
    const i = heapPop();
    if (visited[i]) continue;
    if (poppedDist > dist[i]) continue;
    visited[i] = 1;
    const x = i % width;
    const y = (i - x) / width;
    const ci = i * 3;
    const cix = centers[ci];
    const ciy = centers[ci + 1];
    const ciz = centers[ci + 2];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        let ny = y + dy;
        let nx = mod(x + dx, width);
        if (ny < 0 || ny >= height) {
          // Crossing a pole: stay in the pole row at the antipodal longitude.
          ny = y;
          nx = mod(nx + halfW, width);
        }
        const j = ny * width + nx;
        if (visited[j]) continue;
        const cj = j * 3;
        let dot = cix * centers[cj] + ciy * centers[cj + 1] + ciz * centers[cj + 2];
        if (dot > 1) dot = 1;
        else if (dot < -1) dot = -1;
        const step = Math.acos(dot);
        const nd = poppedDist + step;
        if (nd < dist[j]) {
          dist[j] = nd;
          heapPush(nd, j);
        }
      }
    }
  }

  return dist;
}

/**
 * Two-pass Chamfer distance transform.
 * Returns approximate Euclidean distance to nearest boundary pixel.
 */
function chamferDistance(isBoundary: Uint8Array, width: number, height: number): Float32Array {
  const size = width * height;
  const dist = new Float32Array(size);
  const INF = width + height;

  for (let i = 0; i < size; i++) {
    dist[i] = isBoundary[i] ? 0 : INF;
  }

  // Forward pass (top-left to bottom-right)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const left = y * width + mod(x - 1, width);
      if (dist[left] + 1 < dist[idx]) dist[idx] = dist[left] + 1;
      if (y > 0) {
        const top = (y - 1) * width + x;
        if (dist[top] + 1 < dist[idx]) dist[idx] = dist[top] + 1;
        const topLeft = (y - 1) * width + mod(x - 1, width);
        if (dist[topLeft] + 1.414 < dist[idx]) dist[idx] = dist[topLeft] + 1.414;
        const topRight = (y - 1) * width + mod(x + 1, width);
        if (dist[topRight] + 1.414 < dist[idx]) dist[idx] = dist[topRight] + 1.414;
      }
    }
  }

  // Backward pass (bottom-right to top-left)
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = y * width + x;
      const right = y * width + mod(x + 1, width);
      if (dist[right] + 1 < dist[idx]) dist[idx] = dist[right] + 1;
      if (y < height - 1) {
        const bottom = (y + 1) * width + x;
        if (dist[bottom] + 1 < dist[idx]) dist[idx] = dist[bottom] + 1;
        const bottomLeft = (y + 1) * width + mod(x - 1, width);
        if (dist[bottomLeft] + 1.414 < dist[idx]) dist[idx] = dist[bottomLeft] + 1.414;
        const bottomRight = (y + 1) * width + mod(x + 1, width);
        if (dist[bottomRight] + 1.414 < dist[idx]) dist[idx] = dist[bottomRight] + 1.414;
      }
    }
  }

  return dist;
}
