import { clamp, mod } from '@lib/math';

/**
 * Wind-driven surface currents transport heat across ocean cells. A current
 * flowing toward the equator carries cold water from the poles (cooling
 * coasts on western continental margins, e.g. California current); a
 * current flowing toward a pole carries warm equatorial water (Gulf Stream).
 *
 * Output is a per-cell temperature modifier defined over ocean cells. Land
 * cells are filled by chamfer-style propagation from the nearest ocean cell
 * so coastal land inherits the modifier with falloff into the interior.
 */
export interface OceanCurrentResult {
  /** Per-cell temperature modifier in roughly [-STRENGTH, +STRENGTH]. */
  tempModifier: Float32Array;
  /** Pre-computed propagation distance — nonzero on land, 0 on ocean. */
  distToOcean: Float32Array;
}

const STRENGTH = 0.25;

export function generateOceanCurrents(
  width: number,
  height: number,
  wind: Float32Array,
  elevation: Float32Array,
  seaLevel: number
): OceanCurrentResult {
  const size = width * height;
  const tempModifier = new Float32Array(size);
  const distToOcean = new Float32Array(size);
  const INF = width + height;

  for (let y = 0; y < height; y++) {
    const lat = y / height;
    // +1 at north pole, -1 at south pole, 0 at equator
    const polewardness = (0.5 - lat) * 2;

    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (elevation[idx] <= seaLevel) {
        // wind y > 0 means southward → in NH advects cold-from-north (cooling),
        // in SH advects warm-from-equator (warming). Sign math unifies both.
        const currentY = wind[idx * 2 + 1];
        tempModifier[idx] = -currentY * polewardness * STRENGTH;
        distToOcean[idx] = 0;
      } else {
        tempModifier[idx] = 0;
        distToOcean[idx] = INF;
      }
    }
  }

  propagateNearestOcean(width, height, distToOcean, tempModifier);
  return { tempModifier, distToOcean };
}

/**
 * Two-pass chamfer that simultaneously propagates Euclidean-approx distance
 * and copies the modifier value from whichever neighbor "won" the relaxation.
 * On exit, every land cell holds the modifier of its nearest ocean cell.
 */
function propagateNearestOcean(width: number, height: number, dist: Float32Array, modifier: Float32Array): void {
  const relax = (idx: number, srcIdx: number, cost: number): void => {
    const candidate = dist[srcIdx] + cost;
    if (candidate < dist[idx]) {
      dist[idx] = candidate;
      modifier[idx] = modifier[srcIdx];
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      relax(idx, y * width + mod(x - 1, width), 1);
      if (y > 0) {
        relax(idx, (y - 1) * width + x, 1);
        relax(idx, (y - 1) * width + mod(x - 1, width), 1.414);
        relax(idx, (y - 1) * width + mod(x + 1, width), 1.414);
      }
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = y * width + x;
      relax(idx, y * width + mod(x + 1, width), 1);
      if (y < height - 1) {
        relax(idx, (y + 1) * width + x, 1);
        relax(idx, (y + 1) * width + mod(x - 1, width), 1.414);
        relax(idx, (y + 1) * width + mod(x + 1, width), 1.414);
      }
    }
  }

  // Suppress modifier deep inland: scale by 1 - clamp(dist / maxInfluence)
  const maxInfluence = Math.round(width / 8);
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] > 0) {
      const proximity = clamp(1 - dist[i] / maxInfluence, 0, 1);
      modifier[i] *= proximity;
    }
  }
}
