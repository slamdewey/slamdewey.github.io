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
