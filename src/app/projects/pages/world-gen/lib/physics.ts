/**
 * Universal Earth-like physical parameters used by multiple stages.
 *
 * Anything in this file is anchored in real-Earth atmospheric or oceanic
 * physics, not in this model's tuning. Stage-specific tuning constants
 * (Gaussian widths, smoothstep thresholds, Coriolis scales chosen to make
 * wind magnitudes come out near 1, etc.) stay in their stage files.
 */

/** Hadley cell half-width as a fraction of pole-to-pole (0..1). Earth-like:
 *  30° / 180° = 1/6. Set by atmospheric-height / planetary-radius geometry
 *  (Held–Hou theory); effectively a constant for Earth-scale worlds. */
export const HADLEY_EXTENT = 1 / 6;

/** Polar cell half-width — distance from pole to the Ferrel/polar boundary
 *  at ~60° latitude, as a fraction of pole-to-pole. Earth-like: 30° / 180°. */
export const POLAR_EXTENT = 1 / 6;

/** Width of the Ferrel cell — whatever's left between Hadley and polar cells. */
export const FERREL_WIDTH = 1 - 2 * POLAR_EXTENT - 2 * HADLEY_EXTENT;

/** Ekman boundary-layer friction angle in degrees. Real-ocean values fall in
 *  ~20–45°; we use 25° as a representative mid-latitude figure. */
export const EKMAN_DEG = 25;

/** Boundary-current e-folding length in km. ~4000 km is the fraction of an
 *  ocean basin within which real boundary currents (Gulf Stream, Kuroshio,
 *  California, Humboldt …) dominate surface heat transport. Earth's
 *  circumference is 40,000 km, so this is ~1/10 of a basin. */
export const BOUNDARY_EFOLD_KM = 4000;

/** Annual-mean temperature at the equator (°C). Earth-like baseline. */
export const T_EQUATOR_C = 26;
/** Annual-mean temperature at the geographic poles (°C). Earth-like baseline.
 *  Real-Earth poles average ~-18°C at sea level (Vostok winter dips much
 *  colder; this is the parabola floor before noise/seasonal swing). */
export const T_POLE_C = -18;
/** Lapse-rate-equivalent °C drop per unit of normalized elevation. Elevation
 *  field is roughly [0, 1] where 1 ≈ 5 km altitude; with a real lapse rate of
 *  6.5 °C/km the maximum-elevation drop is ~32 °C. We use a slightly softer
 *  value because most "land" cells sit at low altitudes (0.05–0.3 normalized)
 *  and the visualization gets overwhelming if every continental interior
 *  drops 6+ °C below its latitude baseline. */
export const LAPSE_C_PER_NORM_ELEVATION = 22;
/** Ocean seasonal-swing damping factor: how much of the latitude tilt
 *  amplitude actually swings on water cells. Earth's open ocean swings ~50 %
 *  as much as same-latitude land due to high thermal mass. */
export const OCEAN_SEASONAL_DAMPING = 0.5;
/** Ocean meridional-gradient damping. Real ocean SST has a softer
 *  equator-to-pole gradient than the atmosphere because warm water flows
 *  poleward and water can't drop below its freezing point. With damping=0.7,
 *  ocean cells are pulled 30 % toward the global mean: equator ocean ≈ 19 °C,
 *  pole ocean ≈ -11 °C, vs +26 / -18 °C for the air column. */
export const OCEAN_MERIDIONAL_DAMPING = 0.7;

/** Calibration: per-season raw precipitation output (one cycle of the humidity
 *  sim) → mm. Each season represents 6 months of climatology, so summing
 *  summer + winter raw output × this constant yields annual mm.
 *  Tuned so that mean cell precipitation across the simulation lands near
 *  Earth's land mean (~715 mm/year) at default climate parameters. */
export const PRECIP_MM_PER_UNIT = 800;
/** Hamon-style PET coefficient. PET_per_season_mm ≈ K · max(0, T_C)^1.3.
 *  K=16 places tropical annual PET near 1900 mm and continental temperate
 *  near 750 mm — within a factor of ~1.2 of published Earth ranges. */
export const PET_K_PER_SEASON = 16;
/** Exponent in PET formula. Empirically Thornthwaite-like (1.3–1.5). */
export const PET_TEMP_EXPONENT = 1.3;
