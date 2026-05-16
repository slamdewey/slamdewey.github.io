import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { sphericalEmbed3D } from '@lib/math';
import { NoiseVariables, WorldFields } from '../../types';
import {
  T_EQUATOR_C,
  T_POLE_C,
  LAPSE_C_PER_NORM_ELEVATION,
  OCEAN_SEASONAL_DAMPING,
  OCEAN_MERIDIONAL_DAMPING,
} from '../../physics';

export type Season = 'summer' | 'winter' | 'mean';

/** Peak-to-peak noise jitter in °C. Adds local variation without changing
 *  the latitude/elevation field shape; small enough that it doesn't affect
 *  Köppen statistics. */
const NOISE_JITTER_C = 1.5;

/** Air-cell temperature in °C. Latitude profile is parabolic between
 *  equator and pole annual means, with hemispheric seasonal tilt, additive
 *  elevation lapse, and coastal moderation toward the local ocean. */
export function generateTemperature(
  fields: WorldFields,
  nv: NoiseVariables,
  oceanTempModifier: Float32Array,
  distToOcean: Float32Array,
  season: Season = 'mean',
  seasonalTilt = 0,
  continentalityStrength = 0
): Float32Array {
  const { width, height } = fields;
  const elevation = fields.elevation!;
  const seaLevel = fields.seaLevel!;
  const noise = new OpenSimplexNoise((nv.seed ^ 0xf88f88f8) | 0);
  const temperature = new Float32Array(width * height);

  const jitterFreq = nv.frequency * 1.5;
  const np = new Float32Array(3);

  const maxOceanInfluence = Math.round(width / 8);

  // Northern summer = +1 (NH warmer), winter = -1.
  const tiltSign = season === 'summer' ? 1 : season === 'winter' ? -1 : 0;
  const tiltAmount = tiltSign * seasonalTilt;

  const T_RANGE = T_EQUATOR_C - T_POLE_C;
  const T_GLOBAL_MEAN = (T_EQUATOR_C + T_POLE_C) * 0.5;

  for (let y = 0; y < height; y++) {
    const latNorm = (2 * y) / height - 1; // +1 at south pole, -1 at north pole
    // Annual-mean latitudinal temperature for the air column (= land baseline).
    const annualMeanT = T_EQUATOR_C - T_RANGE * latNorm * latNorm;
    // Per-hemisphere seasonal swing in °C. Sign convention preserved from prior
    // model: with NH summer (tiltSign=+1) and NH cells (latNorm<0), `-latNorm`
    // is positive → seasonalSwing > 0 → warmer NH summer.
    const seasonalSwing = tiltAmount * -latNorm;
    const latLandT = annualMeanT + seasonalSwing;
    // Ocean has a softer meridional gradient than the atmosphere (warm water
    // flows poleward, water can't go below ~-2°C) AND damped seasonal swing
    // due to high thermal mass. We pull the latitude mean toward the global
    // mean before adding the damped seasonal component.
    const oceanAnnualT = T_GLOBAL_MEAN + (annualMeanT - T_GLOBAL_MEAN) * OCEAN_MERIDIONAL_DAMPING;
    const oceanAirT = oceanAnnualT + seasonalSwing * OCEAN_SEASONAL_DAMPING;

    for (let x = 0; x < width; x++) {
      sphericalEmbed3D(x, y, width, height, np);

      const idx = y * width + x;
      const n = fBm3D(noise, np[0], np[1], np[2], 1, jitterFreq, 1, 1);
      const jitter = n * NOISE_JITTER_C;

      let temp: number;
      if (elevation[idx] > seaLevel) {
        temp = latLandT + jitter;
        const proximity = Math.min(distToOcean[idx] / maxOceanInfluence, 1);

        // Continentality: amplify the seasonal tilt for inland cells.
        // Annual mean preserved (the per-season extras cancel summer↔winter).
        if (continentalityStrength > 0 && tiltAmount !== 0) {
          temp += seasonalSwing * continentalityStrength * proximity;
        }

        // Additive lapse rate — physical, not multiplicative.
        temp -= elevation[idx] * LAPSE_C_PER_NORM_ELEVATION;

        // Coastal moderation: blend toward local ocean temperature
        // (boundary-current modifier already applied to the ocean cell).
        const moderationStrength = (1 - proximity) * 0.3;
        const localOceanTemp = oceanAirT + oceanTempModifier[idx];
        temp = temp * (1 - moderationStrength) + localOceanTemp * moderationStrength;
      } else {
        // Water cells: damped seasonal swing + boundary-current anomaly.
        temp = oceanAirT + oceanTempModifier[idx] + jitter * 0.5;
      }

      temperature[idx] = temp;
    }
  }

  return temperature;
}
