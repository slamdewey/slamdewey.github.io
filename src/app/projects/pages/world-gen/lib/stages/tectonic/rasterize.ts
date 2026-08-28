import { OpenSimplexNoise } from '@lib/noise';
import { mod, sphericalEmbed3D } from '@lib/math';
import { NoiseVariables, TectonicVariables } from '../../types';
import { BoundaryInfo, InteractionType, PlateProperties, PlateType } from './types';
import { interactionElevation } from './boundaries';
import { buildBoundaryPolylinesFromArcs, rasterizePolylines, type Vec3Polyline } from './boundary-polylines';

// Per-interaction falloff width multipliers moved to boundary-polylines.ts
// (Phase A4) — each polyline carries its boundary's per-side widths at the
// vertex level so this stage only consumes them via the rasterized seeds.

/** Sentinel for "no boundary fault stamped at this pixel" in the faultType field. */
export const FAULT_TYPE_NONE = 255;

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
  chains: Vec3Polyline[],
  plates: PlateProperties[],
  width: number,
  height: number,
  nv: NoiseVariables,
  tv: TectonicVariables
): {
  baseElevation: Float32Array;
  faults: Float32Array;
  faultType: Uint8Array;
  mountainRanges: Float32Array;
  continentalSubRelief: Float32Array;
  distToRidge: Float32Array;
  oceanAge: Float32Array;
} {
  const falloffScale = tv.boundaryFalloffScale;
  const size = width * height;
  const baseElevation = new Float32Array(size);
  const faults = new Float32Array(size);
  // Per-pixel InteractionType of the strongest boundary stamped here (255 = no
  // fault). Drives the type-colored Faults layer.
  const faultType = new Uint8Array(size).fill(FAULT_TYPE_NONE);
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

  const halfW = width >> 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const plate = plateMap[idx];

      // N/S neighbors at the pole rows wrap to the antipodal longitude on the
      // same pole row — matching the spherical distance transform's routing.
      const nNorthY = y > 0 ? y - 1 : 0;
      const nNorthX = y > 0 ? x : mod(x + halfW, width);
      const nSouthY = y < height - 1 ? y + 1 : height - 1;
      const nSouthX = y < height - 1 ? x : mod(x + halfW, width);
      const neighbors = [
        x > 0 ? plateMap[idx - 1] : plateMap[y * width + width - 1],
        x < width - 1 ? plateMap[idx + 1] : plateMap[y * width],
        plateMap[nNorthY * width + nNorthX],
        plateMap[nSouthY * width + nSouthX],
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
            // True passive (wide-shelf) margins form where a continent rifted
            // away from oceanic crust (ContinentalRift). Strike-slip (Transform)
            // continental–oceanic margins are active and do NOT build a wide
            // passive shelf, so they're excluded — giving narrow active margins.
            if (
              plates[plate].type === PlateType.Continental &&
              plates[neighbor].type === PlateType.Oceanic &&
              nb.interactionType === InteractionType.ContinentalRift
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

  // Sphere-aware Dijkstra distance transforms. Output is in radians on the
  // unit sphere; rescaled to equator-pixel-equivalent so the existing
  // pixel-derived thresholds (shelfWidth, oceanAgeScale) stay calibrated.
  // Routing across the pole is handled inside the transform. Centers are
  // precomputed once and shared across every per-stage Dijkstra call.
  const radToEqPx = width / (2 * Math.PI);
  const cellCenters = computeCellCenters(width, height);
  const rescaleToEqPx = (d: Float32Array): void => {
    for (let i = 0; i < d.length; i++) {
      if (Number.isFinite(d[i])) d[i] *= radToEqPx;
    }
  };

  // Pass 2: Distance to nearest passive-margin shelf seed. Continental pixels
  // within shelf range get their gravity target pulled toward SHELF_TARGET,
  // producing the shallow band that gives coastlines their ragged, island-
  // dotted character. Pixels far inland (or outside continental plates
  // entirely) keep their plate's baseline as the target.
  const distToShelfSeed = sphericalDistanceTransform(shelfSeedMask, width, height, cellCenters);
  rescaleToEqPx(distToShelfSeed);

  const baseFalloff = Math.max(4, Math.round(width / 64));
  const shelfWidth = baseFalloff * SHELF_WIDTH_MULTIPLIER * falloffScale;

  // Pass 3.5: Diffuse the discrete per-plate isostatic baseline into a
  // continuous field. Without this, two adjacent plates with different
  // baseElevation values produce a visible step at every boundary — the
  // Jacobi pass (α = 0.1, 8 iterations) is too weak to bridge that gap, so
  // passive boundaries (Transform, ContinentalRift, OceanicRidge) leave
  // plate-shape cliffs in the surface.
  //
  // Orogenic boundaries (Collision, Subduction, OceanicConvergence) act as
  // pinned values during the smoothing so the mountain-belt contrast is
  // preserved; passive boundaries diffuse freely.
  const baselineField = new Float32Array(size);
  for (let i = 0; i < size; i++) baselineField[i] = plates[plateMap[i]].baseElevation;

  const isBaselinePinned = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (!isBoundary[i]) continue;
    const bi = nearestBoundary[i];
    if (bi < 0) continue;
    const it = boundaries[bi].interactionType;
    if (
      it === InteractionType.Collision ||
      it === InteractionType.Subduction ||
      it === InteractionType.OceanicConvergence
    ) {
      isBaselinePinned[i] = 1;
    }
  }

  // 8-neighbor Jacobi smoothing of the baseline field with pole wrap.
  // Smoothing radius ≈ sqrt(BASELINE_SMOOTH_ITERATIONS) px ≈ 5 px at 24 iters,
  // enough to dissolve plate cliffs without erasing continent-scale contrast.
  const BASELINE_SMOOTH_ITERATIONS = 24;
  const baselineTemp = new Float32Array(size);
  for (let iter = 0; iter < BASELINE_SMOOTH_ITERATIONS; iter++) {
    for (let y = 0; y < height; y++) {
      const upY = y > 0 ? y - 1 : 0;
      const upXOff = y > 0 ? 0 : halfW;
      const downY = y < height - 1 ? y + 1 : height - 1;
      const downXOff = y < height - 1 ? 0 : halfW;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (isBaselinePinned[idx]) {
          baselineTemp[idx] = baselineField[idx];
          continue;
        }
        const xW = mod(x - 1, width);
        const xE = mod(x + 1, width);
        const upX = mod(x + upXOff, width);
        const downX = mod(x + downXOff, width);
        const upRow = upY * width;
        const downRow = downY * width;
        const rowOff = y * width;
        // 8 neighbors: 4 orthogonal + 4 diagonal. Equal weight is fine here —
        // the field is a dimensionless elevation target, and per-row km-
        // weighting would only matter for advection/diffusion of a flux. At
        // pole rows, `upX`/`downX` already point to the antipodal longitude,
        // so the diagonal offsets ±1 work the same way as interior rows.
        const sum =
          baselineField[rowOff + xW] +
          baselineField[rowOff + xE] +
          baselineField[upRow + upX] +
          baselineField[downRow + downX] +
          baselineField[upRow + mod(upX - 1, width)] +
          baselineField[upRow + mod(upX + 1, width)] +
          baselineField[downRow + mod(downX - 1, width)] +
          baselineField[downRow + mod(downX + 1, width)];
        baselineTemp[idx] = sum / 8;
      }
    }
    baselineField.set(baselineTemp);
  }

  // Pass 4: Jacobi relaxation for smooth interior elevation gradients.
  // Each pixel has an "effective base" — usually its smoothed isostatic
  // baseline from above, but pulled toward SHELF_TARGET on the continental
  // side of passive-style cont-ocean margins.
  const effectiveBase = (idx: number): number => {
    const base = baselineField[idx];
    if (plates[plateMap[idx]].type !== PlateType.Continental) return base;
    const d = distToShelfSeed[idx];
    if (d >= shelfWidth) return base;
    const t = d / shelfWidth; // 0 at seed, 1 at far edge of shelf band
    return SHELF_TARGET * (1 - t) + base * t;
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

        // Average of 4 neighbors. X wraps; Y wraps across the pole to the
        // antipodal longitude on the same pole row, so pole pixels relax
        // against their real sphere neighbors instead of pinning themselves.
        const left = baseElevation[y * width + mod(x - 1, width)];
        const right = baseElevation[y * width + mod(x + 1, width)];
        const upY = y > 0 ? y - 1 : 0;
        const upX = y > 0 ? x : mod(x + halfW, width);
        const downY = y < height - 1 ? y + 1 : height - 1;
        const downX = y < height - 1 ? x : mod(x + halfW, width);
        const up = baseElevation[upY * width + upX];
        const down = baseElevation[downY * width + downX];
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
  // Sphere-aware distance from ridge seeds; rescaled to equator-pixel-equivalent
  // so the existing oceanAgeScale = width/6 stays calibrated for the exp() falloff.
  const distToRidge = sphericalDistanceTransform(ridgeSeedMask, width, height, cellCenters);
  rescaleToEqPx(distToRidge);
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
  // Intra-plate ridged ranges: a separate noise at a sub-continental scale so
  // continent interiors get linear mountain belts, not just smooth swells.
  // `rangeWarpNoise` domain-warps the ridge field so belts meander organically
  // instead of forming a periodic lattice (the classic ridged-noise artifact).
  const rangeNoise = new OpenSimplexNoise((nv.seed ^ 0x0a0b1c2d) | 0);
  const rangeWarpNoise = new OpenSimplexNoise((nv.seed ^ 0x51f2a3b4) | 0);
  const rangeFreq = nv.frequency * 2.5;
  const rangeWarpFreq = nv.frequency * 1.0;
  const rangeAmp = tv.intraContinentalRangeAmplitude;

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

        // Intra-plate ridged relief: ancient-orogeny ranges inside continents
        // (Appalachian/Ural analogue). The active-boundary passes only build
        // relief at current margins, leaving interiors flat; ridged multifractal
        // noise (1 − |fBm|, cubed to sharpen) adds linear belts that rise above
        // the swells while leaving the plains low.
        if (rangeAmp > 0) {
          // Domain warp: displace the sample point by a low-frequency noise
          // vector so ridge belts meander instead of tiling a regular lattice.
          const wf = rangeWarpFreq;
          const wAmp = 0.22;
          const wx =
            npSub[0] + rangeWarpNoise.eval3D(npSub[0] * wf + 19.1, npSub[1] * wf + 3.7, npSub[2] * wf - 5.3) * wAmp;
          const wy =
            npSub[1] + rangeWarpNoise.eval3D(npSub[0] * wf - 7.4, npSub[1] * wf + 11.2, npSub[2] * wf + 8.6) * wAmp;
          const wz =
            npSub[2] + rangeWarpNoise.eval3D(npSub[0] * wf + 4.8, npSub[1] * wf - 9.5, npSub[2] * wf + 2.2) * wAmp;

          let rsum = 0;
          let rrange = 0;
          let rf = rangeFreq;
          let ra = 1;
          for (let o = 0; o < 5; o++) {
            // Per-octave offset decorrelates octaves (each samples a different
            // region) so they don't beat into a grid.
            const off = o * 13.0;
            let rn = rangeNoise.eval3D(wx * rf + off, wy * rf + off, wz * rf - off);
            rn = 1 - Math.abs(rn);
            rsum += rn * ra;
            rrange += ra;
            rf *= 2.13; // non-integer lacunarity — octaves never re-align
            ra *= 0.5;
          }
          let ridged = rsum / Math.max(rrange, 1);
          ridged = ridged * ridged * ridged; // sharpen into belts, suppress plains
          baseElevation[idx] += ridged * rangeAmp;
          if (ridged > 0.35) {
            const mr = ((ridged - 0.35) / 0.65) * 0.7;
            if (mr > mountainRanges[idx]) mountainRanges[idx] = mr;
          }
        }
      } else if (hasRidgeSeeds) {
        // Oceanic age-from-ridge gradient: ridges lift, abyssal plains sink.
        const d = distToRidge[idx];
        const rawDelta = 0.15 * Math.exp(-d / oceanAgeScale) - 0.1;
        baseElevation[idx] += rawDelta * ageStrength;
      }
    }
  }

  // Pass 5: Per-boundary stamping driven by the pre-calculated boundary arcs.
  // The arcs (chained once upstream) are projected to sub-pixel polylines whose
  // per-vertex (widthA, widthB) taper down to `min` of converging boundaries at
  // triple-junctions. Rasterizing the polyline gives per-pixel seed widths that
  // the plate-restricted Dijkstra propagates outward. Pass 5 then stamps
  // elevation at every pixel reached, using the *propagated* width so wide
  // stamps narrow gracefully as they approach narrow neighbors.
  const polylines = buildBoundaryPolylinesFromArcs(
    chains,
    boundaries,
    plateCount,
    baseFalloff,
    falloffScale,
    width,
    height
  );
  const rasterizedBoundaries = rasterizePolylines(polylines, boundaries.length, plateMap, width, height);

  // Distance is warped per-pixel by a low-amplitude noise so the interaction
  // band zigzags instead of tracing the (now-smoothed) polyline 1:1. Sample
  // is pixel-local and boundary-independent — precompute once.
  const pass5Warp = new OpenSimplexNoise((nv.seed ^ 0xfa5170c5) | 0);
  const warpFreqPass5 = nv.frequency * tv.coastlineWarpFrequency;
  const npWarp = new Float32Array(3);
  const warpSampleField = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const px = i % width;
    const py = (i - px) / width;
    sphericalEmbed3D(px, py, width, height, npWarp);
    warpSampleField[i] = pass5Warp.eval3D(
      npWarp[0] * warpFreqPass5,
      npWarp[1] * warpFreqPass5,
      npWarp[2] * warpFreqPass5
    );
  }

  // Accumulator for stacked interaction deltas. Clamped at the end so a
  // freakish K-fold orogenic overlap can't produce nonsense elevations.
  const interactionDelta = new Float32Array(size);

  // Working buffers reused across boundaries.
  const stampDist = new Float32Array(size);
  const stampVisited = new Uint8Array(size);
  const stampWidthA = new Float32Array(size);
  const stampWidthB = new Float32Array(size);

  for (let bi = 0; bi < boundaries.length; bi++) {
    const b = boundaries[bi];
    const ras = rasterizedBoundaries[bi];
    if (ras.maxWidth <= 0) continue;
    const maxDistRad = ras.maxWidth / radToEqPx;

    // Initialize per-pixel width fields from the polyline rasterizer. Seed
    // pixels get their polyline-vertex widths; everywhere else is zero and
    // will be filled in by the Dijkstra's inheritance step.
    stampDist.fill(Infinity);
    stampVisited.fill(0);
    stampWidthA.set(ras.widthA);
    stampWidthB.set(ras.widthB);

    boundaryStampDijkstra(
      ras.seedMask,
      plateMap,
      b.plateA,
      b.plateB,
      maxDistRad,
      cellCenters,
      stampDist,
      stampVisited,
      stampWidthA,
      stampWidthB,
      width,
      height
    );

    // Stamp contributions onto every reached pixel using the *propagated*
    // per-pixel width, not a per-boundary constant. Width at a pixel reflects
    // the polyline vertex that the Dijkstra's shortest path traces back to.
    const warpAmpScale = tv.coastlineWarpAmplitude * 3;
    for (let i = 0; i < size; i++) {
      const dRad = stampDist[i];
      if (!Number.isFinite(dRad)) continue;
      const dEqPx = dRad * radToEqPx;

      const pixelPlate = plateMap[i];
      const isSubducting = b.subductingPlate === pixelPlate;
      const sideWidth = pixelPlate === b.plateA ? stampWidthA[i] : stampWidthB[i];
      if (sideWidth <= 0) continue;

      const warpLim = 0.8 * sideWidth;
      const rawOffset = warpSampleField[i] * sideWidth * warpAmpScale;
      const distOffset = rawOffset > warpLim ? warpLim : rawOffset < -warpLim ? -warpLim : rawOffset;
      const warpedDist = dEqPx + distOffset < 0 ? 0 : dEqPx + distOffset;
      if (warpedDist >= sideWidth) continue;

      const t = 1 - warpedDist / sideWidth;
      const falloff = t * t;

      const { elevDelta, mountainRange } = interactionElevation(
        b.interactionType,
        plates[pixelPlate].type,
        b.intensity,
        falloff,
        isSubducting
      );

      interactionDelta[i] += elevDelta;
      if (mountainRange > mountainRanges[i]) mountainRanges[i] = mountainRange;
      const faultStrength = b.intensity * falloff;
      if (faultStrength > faults[i]) {
        faults[i] = faultStrength;
        faultType[i] = b.interactionType;
      }
    }
  }

  // Clamp accumulated interaction delta to a realistic envelope, then fold it
  // into the base. Bounds chosen to match the strongest single-boundary stamps
  // (Collision +0.4, OceanicConvergence trench −0.12·intensity capped further)
  // with headroom for one extra overlapping boundary.
  const DELTA_MAX = 0.8;
  const DELTA_MIN = -0.3;
  for (let i = 0; i < size; i++) {
    let d = interactionDelta[i];
    if (d > DELTA_MAX) d = DELTA_MAX;
    else if (d < DELTA_MIN) d = DELTA_MIN;
    baseElevation[i] += d;
  }

  return { baseElevation, faults, faultType, mountainRanges, continentalSubRelief, distToRidge, oceanAge };
}

/**
 * Precompute unit-vector positions for every cell on the sphere. Shared by
 * every sphere-Dijkstra in this file so we allocate once per stage run.
 */
function computeCellCenters(width: number, height: number): Float32Array {
  const size = width * height;
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
  return centers;
}

/**
 * Multi-source Dijkstra on the equirect grid with sphere-aware edge weights.
 * Returns great-circle distance (radians) from each cell to the nearest seed,
 * Infinity if unreachable. Pole rows route across the pole to their antipodal
 * longitude — crucial for fields read on the sphere view, where flat chamfer
 * pinches to a vertex at the poles.
 *
 * Pass precomputed `centers` to share the cell-center unit-vector table when
 * running multiple transforms back-to-back.
 */
function sphericalDistanceTransform(
  isSeed: Uint8Array,
  width: number,
  height: number,
  centers?: Float32Array
): Float32Array {
  const size = width * height;
  const dist = new Float32Array(size);
  for (let i = 0; i < size; i++) dist[i] = Infinity;
  const visited = new Uint8Array(size);
  const cellCenters = centers ?? computeCellCenters(width, height);

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
    const cix = cellCenters[ci];
    const ciy = cellCenters[ci + 1];
    const ciz = cellCenters[ci + 2];

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
        let dot = cix * cellCenters[cj] + ciy * cellCenters[cj + 1] + ciz * cellCenters[cj + 2];
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
 * Plate-restricted sphere-aware Dijkstra used by per-boundary stamping
 * (Phase A3). Behaves like `sphericalDistanceTransform` but:
 *   - Only expands into cells where `plateMap[j] === plateA || plateB`. Cells
 *     on third plates are unreachable from this boundary's seeds, so the
 *     boundary's stamp never crosses into unrelated plates.
 *   - Bails as soon as the popped distance exceeds `maxDistRad`, so per-call
 *     cost is O(falloff-area) instead of O(grid). Cells beyond that radius
 *     keep their Infinity sentinel.
 *
 * Caller owns `dist` and `visited` buffers and is responsible for resetting
 * them — `dist` to Infinity, `visited` to 0 — before each call.
 */
function boundaryStampDijkstra(
  seedMask: Uint8Array,
  plateMap: Int32Array,
  plateA: number,
  plateB: number,
  maxDistRad: number,
  centers: Float32Array,
  dist: Float32Array,
  visited: Uint8Array,
  widthA: Float32Array,
  widthB: Float32Array,
  width: number,
  height: number
): void {
  const size = width * height;
  // Heap reused across boundaries — capacity scales with the largest possible
  // falloff region, conservatively bounded by grid size.
  const heapCap = Math.max(64, size);
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
    if (seedMask[i] && (plateMap[i] === plateA || plateMap[i] === plateB)) {
      dist[i] = 0;
      heapPush(0, i);
    }
  }

  const halfW = width >> 1;

  while (heapSize > 0) {
    const i = heapPop();
    if (visited[i]) continue;
    if (poppedDist > dist[i]) continue;
    if (poppedDist > maxDistRad) break; // entire heap is beyond falloff
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
          ny = y;
          nx = mod(nx + halfW, width);
        }
        const j = ny * width + nx;
        if (visited[j]) continue;
        const jp = plateMap[j];
        if (jp !== plateA && jp !== plateB) continue;
        const cj = j * 3;
        let dot = cix * centers[cj] + ciy * centers[cj + 1] + ciz * centers[cj + 2];
        if (dot > 1) dot = 1;
        else if (dot < -1) dot = -1;
        const step = Math.acos(dot);
        const nd = poppedDist + step;
        if (nd < dist[j]) {
          dist[j] = nd;
          // Inherit widthA / widthB from the source cell — the cell whose
          // relaxation just reached `j`. Seed cells get their widths from the
          // polyline rasterizer; this propagates those values outward.
          widthA[j] = widthA[i];
          widthB[j] = widthB[i];
          heapPush(nd, j);
        }
      }
    }
  }
}
