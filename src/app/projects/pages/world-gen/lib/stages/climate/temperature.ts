import { OpenSimplexNoise, fBm3D } from '@lib/noise';
import { map, sphericalEmbed3D } from '@lib/math';
import { NoiseVariables, WorldFields } from '../../types';

export type Season = 'summer' | 'winter' | 'mean';

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

  // Max influence distance: pixels beyond this are fully "inland"
  const maxOceanInfluence = Math.round(width / 8);

  // Hemispheric tilt sign per season. Northern summer = +1 (NH warmer), winter = -1.
  const tiltSign = season === 'summer' ? 1 : season === 'winter' ? -1 : 0;
  const tiltAmount = tiltSign * seasonalTilt;

  for (let y = 0; y < height; y++) {
    // Inverse parabola: T(y) = 1 - (2y/height - 1)^2
    // Use raw y/height for latitude (geographic, not noise-space)
    const latNorm = (2 * y) / height - 1; // +1 at south pole, -1 at north pole
    let latitudeTemp = 1 - latNorm * latNorm;
    // Hemispheric tilt: warm one hemisphere, cool the other.
    // latNorm < 0 = northern, > 0 = southern.
    latitudeTemp += tiltAmount * -latNorm;

    // Ocean baseline at this latitude — gets per-cell adjustment from currents.
    const baseOceanTemp = latitudeTemp * 0.8;

    for (let x = 0; x < width; x++) {
      sphericalEmbed3D(x, y, width, height, np);

      const idx = y * width + x;
      let temp = latitudeTemp;

      // Add noise jitter
      const n = fBm3D(noise, np[0], np[1], np[2], 1, jitterFreq, 1, 1);
      temp *= map(n, -1, 1, 0.75, 1);

      if (elevation[idx] > seaLevel) {
        const proximity = Math.min(distToOcean[idx] / maxOceanInfluence, 1);

        // Continentality: amplify the seasonal tilt for inland cells. The
        // extra tilt is equal-and-opposite between summer and winter, so the
        // annual mean is preserved while the seasonal amplitude grows inland.
        // Drives Dfa/Cfb contrasts (Chicago vs Dublin at the same latitude).
        if (continentalityStrength > 0 && tiltAmount !== 0) {
          temp += tiltAmount * -latNorm * continentalityStrength * proximity;
        }

        // Lapse rate: temperature decreases with elevation
        temp *= 1 - elevation[idx] * 0.3;

        // Coastal moderation: blend toward the (current-adjusted) ocean
        // temperature of the nearest ocean cell. The modifier is already
        // scaled by proximity in the propagation pass.
        const moderationStrength = (1 - proximity) * 0.3;
        const localOceanTemp = baseOceanTemp + oceanTempModifier[idx];
        temp = temp * (1 - moderationStrength) + localOceanTemp * moderationStrength;
      } else {
        // Water is cooler; apply current-driven heat advection directly.
        temp = temp * (4 / 5) + oceanTempModifier[idx];
      }

      temperature[idx] = temp;
    }
  }

  return temperature;
}
