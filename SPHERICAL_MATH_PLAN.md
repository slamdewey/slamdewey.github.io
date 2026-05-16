# Spherical-Correct Math Across world-gen

Plan to remove latitude bias from the world-gen pipeline. Phases are ordered so each is independently verifiable on the equirect + sphere views before moving on.

## Helpers we already have

- `world-geometry.ts:buildWorldGeometry` — per-row `cosLatRow`, `sinLatRow`, `kmPerXPixelRow`, `xStepFactorRow`, `kmPerYPixel`, `d8KmDist`, `diffWeights`.
- `lib/math.ts:sphericalEmbed3D` — `(x, y, W, H) → unit vector` on the sphere.
- `tectonic/rasterize.ts:sphericalDistanceTransform` — Dijkstra with pole-crossing via antipodal-longitude routing (rasterize.ts:531-535). Canonical pole-wrap pattern; reuse / extract.

Most fixes are "stop reinventing — use the helper."

---

## Phase A — Tectonic drift as rotation axis (the wedge fix)

**Goal:** plate motion is a rotation `ω` of the lithosphere around an Euler pole, not a 2D pixel velocity. Boundary-relative velocity at any boundary midpoint is `(ω_A − ω_B) × r_mid`, a tangent-plane vector at `r_mid` regardless of latitude.

1. `tectonic/types.ts:27-38` — replace `dx, dy: number` on `PlateProperties` with `omega: [number, number, number]` (Euler axis-angle vector). Keep `baseElevation`, `thickness`, `density` unchanged.
2. `tectonic/properties.ts:101-155 (assignPlateProperties)` — sample `omega` as a uniform 3-vector with magnitude in the same range as today's `0.3–1.0`. Drop the `cos(angle), sin(angle)` construction at lines 124, 146-147.
3. `tectonic/properties.ts:32-82 (computePlateCentroidsSphere)` — also expose the unit-vector centroid (so `boundaries.ts` skips the embed-back step).
4. `tectonic/boundaries.ts:60-138 (classifyBoundaries)`:
   - Compute boundary midpoint as a unit vector via slerp/sum-and-normalize of `r_A, r_B`.
   - Surface velocity at midpoint: `vA = ω_A × r_mid`, `vB = ω_B × r_mid`. Relative `v = vA − vB`.
   - Boundary normal at midpoint: `(r_B − r_A)` projected to the tangent plane at `r_mid` (subtract radial), then normalized.
   - `vNormal = v · n̂`, `vTangent = |v − vNormal·n̂|`. Classification rule unchanged.
   - Intensity = `|v|` directly. No `cosMid` scaling.
5. Delete the `cosMid` block at boundaries.ts:73-95 — no longer needed.

**Why this is right:** real-Earth plate motion is described by Euler poles. Eliminates the structural transform-suppression bias near the poles.

**Verification:** seed-by-seed comparison on the same scene as today's wedge. Expect the polar collision either to keep its strength but drop to comparable intensity with mid-latitude collisions, or to reclassify because its actual `v · n̂` was small and only looked large after cos-suppression of the tangent.

---

## Phase A2 — Smooth plate baselines into a continuous field

**Problem (not in original plan):** every interior pixel's `effectiveBase` at `rasterize.ts:167-183` resolves to its plate's discrete `baseElevation = computeIsostasy(thickness, density)`. Adjacent plates can differ by 0.3+ in baseline. The Jacobi pass (8 iterations, α=0.1) is too weak a smoother to cross such steps, so passive plate boundaries (Transform / ContinentalRift) leave visible cliffs in the elevation field — plate-shape patches show through as biome discontinuities. Orogenic boundaries hide the seam under their own stamp; passive ones do not.

**Goal:** the gravity target is itself a continuous field. Per-plate baselines diffuse smoothly across boundaries (except across orogenic boundaries, which should retain contrast).

1. New pre-pass before Jacobi (slot it in around `rasterize.ts:162`, before `effectiveBase` is first called):
   - Build a `baselineField: Float32Array` of size `width * height`. Initialize each pixel with `plates[plateMap[idx]].baseElevation`.
   - Run a sphere-aware diffusion sweep on this field — N iterations of an 8-neighbor average with pole wrap (Phase B helper). Tunable: ~16–32 iterations gives a smoothing radius of roughly 4–6 px, enough to blur out plate cliffs without erasing continent-scale contrast.
   - Boundaries: orogenic boundary pixels (Collision, Subduction, OceanicConvergence) act as pinned values during the diffusion sweep so contrast is preserved where it's wanted. Passive boundaries (Transform, ContinentalRift, OceanicRidge) are _not_ pinned — they smooth freely.
2. `rasterize.ts:167-174 (effectiveBase)` — replace `plate.baseElevation` with `baselineField[idx]`. The shelf-target blend still applies on top for continental pixels.
3. The Jacobi pass itself stays as-is — gravity α=0.1 now pulls toward a smooth field, so interiors no longer fight a discrete step.

**Why this is right:** isostatic equilibrium is a continuous physical equilibrium of the lithosphere on the asthenosphere, not a step function at plate boundaries. Sharp baseline jumps are an artifact of treating each plate as an independent slab; in reality, mantle viscosity smears the equilibrium across boundaries except where active orogeny holds the gradient up. Pinning the diffusion only at orogenic pixels captures that distinction.

**Verification:** the diagonal plate-shape steps visible in the biome view (image 8) should disappear. Mountain belts at convergent boundaries should remain prominent (they get the same stamp on top of the smoothed baseline).

---

## Phase A3 — Fault-junction continuity via per-boundary stamping

**Problem:** in `rasterize.ts` Pass 3 (`propagateBoundaryIndex`) every pixel is assigned exactly one `nearestBoundary[idx]`, then Pass 5 applies only that boundary's elevDelta. At a T- or Y-junction where two boundaries with different falloff widths meet — e.g., a wide Collision band beside a narrow Transform — neighboring pixels flip between the two assignments, so the wide stamp truncates abruptly and the narrow one starts. Visible as the sharp side-step inside a mountain belt on the fault map.

**Goal:** each plate boundary independently stamps every pixel within its own falloff range. At junctions, contributions from multiple boundaries add — naturally continuous, with optional turbulent peaks where strong boundaries overlap (the Pamir Knot effect: multiple orogenic boundaries meeting → tallest mountains).

1. Factor the sphere-Dijkstra: pull cell-center precomputation and the heap out of `sphericalDistanceTransform` into reusable utilities. Add a variant that:
   - Accepts a per-boundary seed mask.
   - Accepts an allowed-plate filter (`plateA, plateB`); skip expanding into any other plate.
   - Accepts a max distance (radians) for early termination, so each per-boundary call only touches O(falloffArea) cells.
2. Build per-boundary seed masks during a single O(W·H) plate-edge scan: for each pair (plateA, plateB) the seed pixels are those on plateA touching a plateB neighbor, and vice versa. Store as one shared `Uint8Array` cleared and refilled per boundary.
3. Replace Pass 5 with: `for each boundary b: run plate-restricted Dijkstra → for each reached pixel, compute warpedDist and per-side effectiveFalloff, accumulate elevDelta, mountainRange (max), faults (max)`. Drop the single-nearest-boundary BFS (`propagateBoundaryIndex`) and `nearestBoundary` array, except where still needed for the orogenic-pin mask in Phase A2.
4. Keep the noise-warp on `dist[i]` per-pixel — it still prevents falloff bands from tracing Voronoi polygons.
5. Cap the per-pixel accumulated `elevDelta` at a sane max (e.g., +0.8) to prevent unrealistic stacking when 4+ orogenic boundaries pile onto a single junction pixel.

**Why this is right:** plate boundaries are real physical features that each have their own deformation footprint. There's no a-priori reason a single pixel belongs to "the" nearest boundary — pixels at junctions feel multiple boundaries simultaneously, and natural orogeny works that way. Per-boundary stamping makes the model match this directly.

**Verification:** the sharp step where a wide collision band meets a narrow transform (zoomed orb shot, image 11) should smooth into a continuous transition; triple-junction mountains should look more peaked, not less.

---

## Phase A4 — Vectorize plate boundaries + smoothly-varying width

**Problem 1 (junction taper):** even after A3, per-boundary stamping leaves a visible "wide stamp wraps around the corner" effect at triple-junctions (image 12). The wide boundary's seed pixels end at the junction; the sphere-Dijkstra from that endpoint propagates radially in a quarter-disc, so the wide stamp ends in a curved cap before the narrow neighbor takes over. Per-boundary stamping killed the _cliff_; it didn't kill the _taper_.

**Problem 2 (boundary jaggies):** plate boundaries are traced at integer-pixel resolution from the Voronoi cellMap, so every downstream consumer (faults, falloff fields, biome thresholds) inherits the pixel-staircase. Near the poles where the grazing angle is shallow, this reads as a terraced surface (image 13).

**Goal:** plate boundaries become smooth sub-pixel polylines on the sphere, and each boundary's falloff width can vary along its length so adjacent boundaries taper to match each other at junctions.

1. New module `tectonic/boundary-polylines.ts`. Trace polylines via marching-squares classification of pixel corners (`(W) × (H+1)` corners on the equirect grid, with pole rows wrapping antipodally). For each corner, count distinct plates in the 4 surrounding pixels:
   - 1 plate: not a boundary corner — skip.
   - 2 plates: simple boundary corner, degree-2 in the boundary graph.
   - 3+ plates: triple junction, degree-3+, the anchor points. Walk from each junction along simple corners until reaching another junction → one polyline per plate-pair arc. Closed loops (a plate fully encircled) become cyclic polylines with no junction endpoints.
2. **Chaikin corner-cutting smoothing** in pixel-corner space, ~2 iterations. Junction endpoints anchored (otherwise plates would gap/overlap at corners). Pixel-space smoothing is fine here because the corner cuts are local (a few pixels), and over that span equirect ≈ tangent plane even near the poles. Closed cyclic loops smooth without anchors.
3. **Per-vertex width** with junction taper (the C-style fix):
   - Each polyline carries `widthA[v]`, `widthB[v]` per vertex, initialized to its boundary type's per-side falloff width.
   - At junction endpoints, the widthA/widthB on that side are set to `min` across all polylines meeting at the junction whose adjacent plate matches. Min, not avg — so wide stamps shrink to fit narrow neighbors at the corner.
   - Diffuse widthA/widthB along the polyline (5–10 passes of a 3-tap 1D smoother) so the taper spans several vertices rather than dropping at one endpoint.
4. **Rasterize polylines back to seeds + width fields.** For each boundary's polyline:
   - Walk it densely (sub-pixel-spaced samples) and mark the nearest pixel of plate A and plate B as a seed.
   - At each seed pixel store the local `widthA[v]`, `widthB[v]` from the nearest polyline vertex.
   - Pixels not seeded: `width` stays at 0 / sentinel.
5. **Propagate widths through `boundaryStampDijkstra`.** When relaxing a neighbor, inherit `widthA`, `widthB` from the source cell alongside dist. The destination's stamping side-width comes from this propagated field, not from a per-boundary constant.
6. **Pass 5 stamping** reads `widthA[i]` if pixel is on plate A, `widthB[i]` otherwise. The Dijkstra search radius per boundary becomes the max of all `widthA[v]`, `widthB[v]` for that polyline (taper-aware).

**Why this is right:** plate boundaries on Earth are smooth (well, fractal — but locally smooth) physical features, not stair-stepped polygon edges. Vectorizing them is the right structural representation. Tapered widths at junctions are how real orogenic systems behave — mountain ranges narrow and rejoin where boundaries meet (the Pamir Knot tapers the Himalaya, the Tien Shan, and the Hindu Kush down where they converge).

**Verification:** the junction taper from image 12 should resolve into a smooth meetup; the polar pixel terraces from image 13 should soften (won't fully go away until biome rendering masks them, but the underlying elevation field becomes sub-pixel accurate at the boundaries).

---

## Phase B — Tectonic pole wrap in pixel-grid passes

The dist field already crosses the pole; the rest of `rasterize.ts` doesn't. Make them consistent.

1. `rasterize.ts:92-97` — boundary detection at y=0 / y=H-1: replace `: -1` with antipodal-longitude lookup (same idea as `sphericalDistanceTransform` line 531-535).
2. `rasterize.ts:409-414 (propagateBoundaryIndex)` — same fix for BFS neighbor offsets so boundary indices wrap across the pole.
3. `rasterize.ts:199-200` (Jacobi up/down) — replace `y > 0 ? ... : self` with antipodal lookup. Pole rows then relax against cross-pole neighbors instead of pinning their own value.

**Verification:** the horizontal seam at the very top of the elevation view should disappear; pole row values should match surrounding terrain.

---

## Phase C — Semi-Lagrangian advection across the pole

`humidity-sim.ts:220-222` and `ocean-currents.ts:192-193` trace particles backward as `(srcX, srcY) = (x − u·dt, y − v·dt)` and clamp `srcY` to `[0, H-1]`. Should re-emerge at antipodal longitude.

1. Add `wrapEquirectAcrossPole(srcX, srcY, W, H) → {x, y}` to `lib/math.ts`. Loops in case dt overshoots multiple poles.
2. Replace clamps in `humidity-sim.ts:220-222` (advection), `humidity-sim.ts:270-273` (orographic upwind sample), and `ocean-currents.ts:192-193` (SST advection).
3. Make `bilinearSample` in those files wrap at the pole rather than clamp.

**Verification:** humidity / SST features should pass through the pole rather than pile up there.

---

## Phase D — Diffusion uses km-aware weights

`humidity-sim.ts:227-255` and `ocean-currents.ts:202-226` currently average neighbors with equal weights. `diffWeights` is already computed per-row in `world-geometry.ts:104-106`.

1. Replace separable `(N + S + center)/3` and `(E + W + center)/3` passes with the 8-neighbor weighted form using `diffWeights` per row `y`.
2. At pole rows, NS neighbor pulls from antipodal longitude (Phase B/C helper).

**Verification:** polar features should stop appearing artificially diffused E-W.

---

## Phase E — Geostrophic wind in km-space

`wind.ts:188-189` uses `gradScale = width` as a constant; polar pressure-gradient magnitudes are inflated by ~`1/cos(lat)`.

1. Read `kmPerXPixelRow[y]` and `kmPerYPixel` from world-geometry. Compute `dPx_per_km = (P[xR] − P[xL]) / (2 · kmPerXPixelRow[y])`, similarly for y.
2. Drop `gradScale = width`. Calibrate the new km-to-wind constant against the equator row of current output so the change is visually neutral away from the poles.

**Verification:** polar geostrophic wind speeds should drop. Equatorial winds unchanged.

---

## Phase F — D8 hydrology across the pole

`hydrology.ts:346-354` and `hydrology.ts:410-413` skip neighbors where `ny < 0 || ny >= height`.

1. Replace skip with antipodal-longitude wrap. Use `d8KmDist[y*8+d]` from world-geometry as per-edge cost.
2. Confirm the flow-accumulation queue handles the wrapped neighbor.

**Verification:** rivers near the poles should route across rather than stop dead.

---

## Phase G — Ocean boundary-current distance in km

`ocean-currents.ts:56-82` walks east/west counting pixels; `:116` multiplies by `kmPerPxX` at the consumer.

Action: **audit only**. Verify line 116 uses `kmPerXPixelRow[y]` not a constant. Fold any fix into the Phase D/E PR.

---

## Execution order

1. **Phase A** — biggest visible payoff; isolates the wedge-class artifact.
2. **Phase B** — small surface, removes the pole-row seam.
3. **Phase A2** — smooths plate-interior baseline cliffs.
4. **Phase A3** — per-boundary stamping for fault continuity at junctions.
5. **Phase A4** — vectorize plate boundaries + smoothly-varying width at junctions.
6. **Phase F** — cheap, visually obvious in river view.
7. **Phase C + D** together — touch the same files, share the wrap helper.
8. **Phase E** — needs re-tuning of magnitude constants; do last.
9. **Phase G** — audit, fold into prior PR if needed.

Across all phases, extract one shared `wrapEquirectAcrossPole(x, y, W, H)` helper into `lib/math.ts` so tectonic, hydrology, and climate share the same wrap rule (matching `sphericalDistanceTransform`).
