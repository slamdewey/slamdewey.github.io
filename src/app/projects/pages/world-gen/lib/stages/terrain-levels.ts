/**
 * Shared physical-elevation constants and helpers.
 *
 * As of the terrain-synthesis rebuild, `WorldData.elevation` is in **real
 * meters** with sea level pinned at **0 m** (no longer a normalized [-1, 1]
 * field with a percentile sea level). Every threshold that used to be a
 * fraction of that abstract range now lives here as an explicit altitude, so
 * the renderers, biome classifier, and climate readers all agree on one scale.
 *
 * Hypsometry is Earth-like and two-sloped (see `terrain-synthesis.ts`):
 * continents have low freeboard, oceans are deep. The land slope keeps the
 * legacy "1 normalized unit ≈ 5 km" anchor that the lapse-rate and orographic
 * tunings were originally calibrated against.
 */

/** Meters of depth per unit of dimensionless tectonic potential, below sea
 *  level. The ocean side is a straight linear transfer (its hypsometry and the
 *  continental shelf already read well); only the land side is reshaped. */
export const OCEAN_M_PER_UNIT = 8000;

/**
 * The continental base is a LOW, gently-varying platform — not the source of
 * dramatic relief. Land potential is normalized to [0, 1] across the
 * continental range (clamped, so high swells don't overshoot), raised to
 * `LAND_GAMMA` so the bulk sits near sea level, and scaled to at most
 * `LAND_PLATFORM_M`. Dramatic, tall relief comes separately from the tectonic
 * mountain mask (see `OROGEN_UPLIFT_M` in terrain-synthesis), so the smooth
 * `continentalSubRelief` swells stay gentle hills instead of becoming the tall
 * white blobs that previously dominated the map and wrecked the wind field.
 *
 * Tune `LAND_PLATFORM_M` / `LAND_GAMMA` against `__worldStats.fields.elevation`
 * (target a land mean near ~800 m, Earth ≈ 840 m); raise mountains via
 * `OROGEN_UPLIFT_M`.
 */
export const LAND_PLATFORM_M = 1400;
export const LAND_GAMMA = 2.5;

/**
 * Reference relief (m) over which the climate-gradient gains were tuned.
 * Readers that consume raw inter-pixel elevation *differences* (wind terrain
 * deflection, orographic lift / Föhn drying) divide by this so the existing
 * `ClimateVariables` / wind tunings stay numerically valid after the switch to
 * meters. Mirrors `PRECIP_FLOW_REFERENCE_MM`.
 */
export const ELEV_RELIEF_REFERENCE_M = 5000;

/** Hard clamp on the synthesized elevation field, in meters. Roughly the
 *  Mariana Trench and Everest. */
export const ELEV_MIN_M = -10000;
export const ELEV_MAX_M = 8500;

/** Sea-level datum. Pinned, not a percentile — the land/water partition is
 *  decided in dimensionless potential space before the transfer to meters, so
 *  the coastline is independent of this value being exactly 0. */
export const SEA_LEVEL_M = 0;

/** Altitude (m) at which exposed-rock color starts blending in under the biome
 *  tint, and the dedicated Mountain biome takes over. Legacy 0.85 · 5 km. */
export const MOUNTAIN_LEVEL_M = 4250;

/** Altitude (m) at which the permanent-snow ramp begins. Legacy 0.7 · 5 km. */
export const SNOW_ELEVATION_M = 3500;

/** Depth (m) below sea level separating the shallow-water / shelf band from
 *  open ocean in the biome + ocean colorers. */
export const SHALLOW_WATER_DEPTH_M = 500;

/**
 * Map an elevation in meters to [0, 1] across the full [ELEV_MIN_M, ELEV_MAX_M]
 * envelope. Replaces `mapToUnsignedRange` (which assumed a [-1, 1] field) in
 * the elevation/ocean grayscale colorers. Monotonic, so deeper → darker and
 * higher → brighter exactly as before.
 */
export function elevToUnit(meters: number): number {
  const t = (meters - ELEV_MIN_M) / (ELEV_MAX_M - ELEV_MIN_M);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
