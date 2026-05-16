# Sphere-aware pipeline centralization

Phased plan to centralize sphere math in `WorldGeometry` and migrate every stage that touches grid spacing onto it. Each phase ends at a clean, committable state — we stop, commit, regenerate, and reassess before starting the next.

## Goals

1. Eliminate the class of bugs where a stage uses pixel-distance as if it were km-distance.
2. Centralize the sphere primitives so future stages can't accidentally regress.
3. Fix the visible polar artifacts: jagged elevation (under-eroded polar ridges), over-counted polar rivers, anisotropic polar diffusion.

## Conventions adopted across all phases

- **Linear distance unit**: km. Where a function previously used "pixels", it migrates to km. The conversion lives entirely inside `WorldGeometry`.
- **Area weight**: cell area is normalized by `cellAreaWeight[y]` (already exists, sums to 1.0 across the grid). Used wherever per-cell quantities must integrate over the sphere correctly.
- **No silent dual-unit interfaces**: every helper either takes/returns km or returns "equator-pixel-equivalent" (only when matching an existing convention like the chamfers we just fixed). Doc-string flags which.

---

## Phase 1 — Extend `WorldGeometry` with sphere-aware primitives

**Scope**: pure additions to `lib/world-geometry.ts`. No callers change.

Add to the `WorldGeometry` interface:

- `kmPerYPixel: number` — `cellSizeKmEquator * π/2` ÷ (height/2)? No — actually it's `(circumferenceKm / 2) / height`. Constant.
- `kmPerXPixelRow: Float32Array` — equator-cellsize × cosLat per row.
- `xStepFactorRow: Float32Array` — `1 / cosLat[y]` clamped at COS_FLOOR. How many pixels a wind component of magnitude 1 traverses per step at this latitude. Already computed inline in three places; promote to geom.
- `d8KmDist: Float32Array` — flat `(y * 8 + d)` lookup of D8 step distance in km per row. Replaces `D8_DIST[d]` in callers.
- `diffWeights: Float32Array` — flat `(y * 3 + slot)` per-row diffusion weights for {EW, NS, diag}, normalized to sum to 1 per row. Used by hillslope diffusion and any future sphere-aware blur.

Single shared `COS_FLOOR = 0.05` constant exported from world-geometry to keep clamping consistent.

**Verification**: `npx tsc` clean. No runtime change.

**Commit message**: `feat(world-gen): extend WorldGeometry with sphere-aware distance/diffusion primitives`

---

## Phase 2 — Migrate existing sphere-aware callers onto the helpers

**Scope**: refactor only. Callers that already do the right thing inline move to `geom.*` helpers so the math lives in one place.

Files:

- `lib/stages/climate/humidity-sim.ts` — replace inline `xStepFactorRow`, `xDiffBlendRow` derivations (lines ~120–128) with `geom.xStepFactorRow` and a geom-derived diffusion blend.
- `lib/stages/ocean-currents.ts` — replace the new inline `xStepFactorRow` in `advectSstAnomaly` and the per-row `xCostRow`/`diagCostRow` in `propagateNearestOcean` with geom lookups.
- `lib/stages/wind.ts` — replace inline `invCosLat` in `applyTerrainDeflection` with geom. Need to thread `geom` through — currently this function only takes `(fields, wind)`. Update pipeline to pass geom.

**Verification**: regenerate, output should be byte-identical (or within floating-point noise) to current.

**Commit message**: `refactor(world-gen): route sphere math through WorldGeometry helpers`

---

## Phase 3 — Hydrology becomes geom-aware

**Scope**: the visible-impact phase. Threads `geom` through hydrology, fixes the three bugs identified in the audit.

### 3a. Plumbing

`runHydrology(fields, hydrology)` and `computeFlowAndRivers(fields, hydrology)` gain a `geom: WorldGeometry` parameter. Pipeline passes it.

### 3b. Stream-power slope in km

`applyStreamPowerErosion`: replace `slope = drop / D8_DIST[d]` with `slope = drop / geom.d8KmDist[y * 8 + d]`. The slope unit is now elev-units / km. The erosion `K` constant was calibrated against the old pixel-distance slope, so it'll need a one-time rescale — at equator one pixel ≈ 40 km, so `slope_km = slope_pixel / 40`. Compensate by scaling `erosionStrength` × 40^n (n is the slope exponent ≈ 1.0). Set `DEFAULT_HYDROLOGY.erosionStrength = 0.02 * 40 = 0.8` (or pick whatever keeps the equator-erosion-per-iteration the same).

**Expected impact**: polar terrain erodes properly on east-west drops; jagged polar ridges should smooth out.

### 3c. Area-correct flow accumulation

`computeFlowAccumulation`: each cell contributes `(rainfall ?? 1) * cosLatRow[y]` instead of `rainfall ?? 1`. This makes `flowAcc` represent total upstream rainfall × area, integrated correctly on the sphere. Polar cells (small km² area) contribute less, so polar rivers look proportional to actual catchment.

The `riverLogThreshold` will need a small re-tuning since flowAcc magnitudes shift down (polar cells now ~0 contribution, equatorial cells unchanged). Lake `budgetRatio` similarly. Both adjustable through existing config — start with current defaults and only re-tune if sweep shows regression.

### 3d. Diffusion-related polar smoothing left for Phase 4.

**Verification**: regenerate. Check:

- Jagged polar elevation noticeably smoother.
- River layer no longer over-saturated near poles.
- Lake count roughly unchanged at low-to-mid latitudes.
- Equatorial behavior near-identical to pre-change (this is the regression bar).

If equatorial regresses, retune `erosionStrength` rather than reverting.

**Commit message**: `feat(world-gen/hydrology): area-weighted flow and km-correct stream-power slope`

---

## Phase 4 — Anisotropic hillslope diffusion

**Scope**: small targeted fix; resolves residual polar diffusion bias.

`applyHillslopeDiffusion`: replace uniform 8-neighbor average with a weighted average using `geom.diffWeights[y * 3 + slot]`. Polar cells weight east-west neighbors heavier than north-south (since they're closer in km), making the diffusion isotropic in km-space.

**Verification**: regenerate. Polar terrain should look smoother than phase 3 alone produced. Equatorial unchanged.

**Commit message**: `feat(world-gen/hydrology): isotropic hillslope diffusion in km-space`

---

## Phase 5 — Sweep remaining stages, tighten the boundary

**Scope**: audit + small fixes for anything we missed; tighten interfaces.

Audit (read-only, then targeted fixes):

- `lib/stages/elevation.ts` — domain-warped fBm; uses `sphericalEmbed3D` for noise sampling so should be fine, but verify.
- `lib/stages/post-processing.ts` — 3×3 mountain dilation, depth-stretch on shelves. Topology ops; flag if any treats grid as flat.
- `lib/stages/tectonic/rasterize.ts` — the two flat chamfers we left alone (boundary falloff, shelf seed). The dev comment says they're clipped tight enough that pole-pinching doesn't show; confirm visually on a high-resolution polar render. Defer fix if confirmed harmless.
- `lib/stages/biomes.ts` — pure per-cell, no spatial; verify by reading.

Tightening the boundary:

- Once everyone consumes `geom`, consider whether `WorldFields` should carry `geom` instead of every stage taking it as a separate parameter. Cleaner for new stages.
- Remove now-unused inline `COS_FLOOR` constants in stage files.
- Document in `world-geometry.ts` that **any code that uses pixel distance as if it were km, or assumes per-cell quantities are area-equal, should use `geom` instead**.

**Verification**: full regenerate + multi-seed sweep. Compare to baseline captured at end of Phase 4.

**Commit message**: `chore(world-gen): audit residual sphere-flat sites and document geom contract`

---

## Out of scope

- Tectonic ocean-age (`sphericalDistanceTransform` already correct; sphere preview artifacts are visualization, not generation).
- The two intentionally-flat tectonic chamfers (boundary falloff, shelf seed) — left as-is per existing dev comment unless Phase 5 finds they're actually visible.
- Any change to wind generation / pressure field — already correctly uses sin(lat) for Coriolis and is sphere-aware.
- The `ParamControlsComponent` slider ranges for hydrology variables — may need adjusting if Phase 3's `erosionStrength` rescale lands on a number outside the current slider range. Touch only if needed.

## Stop-and-reassess gates

After each phase commits:

1. Regenerate.
2. Visually inspect: biomes, temperature, elevation, rivers, lakes (from pole to equator).
3. Run multi-seed sweep; compare Köppen group deltas vs the most recent baseline.
4. **Greenlight**: deltas didn't regress, no new artifacts → proceed. **Yellow**: phase shifted things in unexpected ways → discuss before moving on. **Red**: phase broke something → revert or fix in a follow-up commit before next phase.
