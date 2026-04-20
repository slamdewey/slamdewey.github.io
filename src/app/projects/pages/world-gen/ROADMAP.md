# World Generation Pipeline Roadmap

## Current Architecture

```
pipeline.ts: WorldGenerator.generate()
  Stage 1: Tectonic Plates (voronoi → plates → boundaries → rasterize)
  Stage 2: Elevation (tectonic base + fBm noise)
  Stage 3: Temperature (latitude + elevation lapse rate + noise jitter)
  Stage 4: Wind (6-cell atmospheric model + noise jitter)
  Stage 5: Precipitation (evaporation/advection/orographic sim)
  Stage 6: Post-processing (mountain ranges + continental shelves)
  Stage 7: Biome classification (6x6 Whittaker-style table)
```

## What's Already Working

- [x] Continental vs Oceanic crust distinction (PlateType enum)
- [x] Plate velocities (random direction + magnitude 0.3–1.0)
- [x] Boundary classification (convergent/divergent/transform)
- [x] 6 interaction types (collision, subduction, oceanic convergence, rift, ridge, transform)
- [x] Boundary influence falloff (chamfer distance + quadratic curve)
- [x] Jacobi relaxation for smooth interior elevation gradients
- [x] Multi-scale noise via fBm (configurable octaves, persistence, lacunarity)
- [x] 6-cell wind model with cosine-interpolated profiles
- [x] Temperature: latitude curve + elevation lapse rate
- [x] Precipitation: evaporation, cloud advection, orographic boost, runoff
- [x] Biome classification: 6x6 moisture/temperature lookup table
- [x] Web Worker execution (non-blocking generation)
- [x] Cylindrical projection (wrap X, clamp Y)

---

## Pipeline Improvements (ordered by dependency)

### Phase 1: Strengthen the Foundation

#### 1.1 — Plate Thickness & Density

**Status:** Not started  
**Why:** Plate type alone isn't enough. Thickness/density affect subduction direction and isostatic equilibrium. Currently both oceanic plates behave identically regardless of age.

- Add `thickness` and `density` to `PlateProperties`
- Older oceanic crust = denser = more likely to subduct
- Feed into elevation baseline calculation (isostasy)

#### 1.2 — Tunable Boundary Falloff Width

**Status:** Partially done (hardcoded `width / 64`)  
**Why:** Different interaction types should have different influence radii. Collision zones (Himalayas) are much wider than transform faults (San Andreas).

- Per-interaction-type falloff width multiplier
- Add to `TectonicVariables` as a global scale factor
- Consider asymmetric falloff for subduction (wide on continental side, narrow trench on oceanic)

#### 1.3 — Temperature: Ocean Proximity Moderation

**Status:** Not started  
**Why:** Coastal areas have moderated temperatures (cooler summers, warmer winters). Current model only uses latitude + elevation. Inland areas should be more extreme.

- Compute distance-to-ocean field (reuse chamfer distance technique)
- Blend toward ocean temperature average based on proximity
- This is critical for correct biome placement

---

### Phase 2: Climate Realism

#### 2.1 — Ocean Currents (Simplified)

**Status:** Not started  
**Why:** Ocean heat transport creates major climate asymmetries. Without it, deserts and rainforests get misplaced. Western coasts are cool (cold currents), eastern coasts are warm.

- Approximate with wind-driven surface currents (reuse wind field over ocean pixels)
- Add latitudinal gyre patterns (clockwise NH, counter-clockwise SH)
- Output: ocean temperature modifier field
- Feed into temperature stage

#### 2.2 — Explicit Rain Shadow

**Status:** Partially there (orographic boost in precipitation.ts)  
**Why:** Current implementation boosts precip on the windward side but doesn't explicitly dry out the leeward side. Need the full mechanism: air rises → cools → dumps moisture → descends dry.

- Track moisture depletion as air crosses mountain ranges
- After orographic precipitation, reduce cloud carry-over on the lee side
- This creates deserts behind mountain ranges (Atacama, Gobi, Great Basin)

#### 2.3 — Wind-Terrain Interaction

**Status:** Not started  
**Why:** Wind currently ignores terrain completely. Mountains should deflect wind, creating rain shadows and funneling effects.

- After elevation is generated, apply a terrain deflection pass to wind
- Mountains block/redirect flow
- Valleys channel flow (optional, lower priority)

---

### Phase 3: Hydrology & Erosion

#### 3.1 — Flow Accumulation / Drainage Network

**Status:** Not started  
**Why:** Rivers are critical for biome realism and gameplay. Flow accumulation is also needed as input for erosion.

- Compute flow direction per pixel (steepest descent, wrap-aware)
- Accumulate flow (each pixel's value = sum of all upstream contributors)
- Threshold for river classification
- Output: `flowAccumulation: Float32Array`, `riverMask: Uint8Array`

#### 3.2 — Hydraulic Erosion (Lightweight)

**Status:** Not started  
**Why:** Noise-only terrain looks artificial. Even a simplified erosion pass dramatically improves realism — rivers carve valleys, sediment fills basins.

- Particle-based or grid-based (grid is faster for our pixel resolution)
- Inputs: elevation, flow accumulation, precipitation
- Erode proportional to flow \* slope
- Deposit sediment where flow slows (flat areas, lake beds)
- Run AFTER noise injection, BEFORE temperature/climate

#### 3.3 — Lake Formation

**Status:** Not started  
**Why:** Endorheic basins (closed drainage) form lakes. Important for biome accuracy and visual interest.

- During flow accumulation, detect pixels with no downhill path
- Fill depressions to form lakes
- Lakes affect local moisture (evaporation source)

---

### Phase 4: Pipeline Restructure

#### 4.1 — Reorder Pipeline Stages

**Status:** Planning  
**Why:** Current order has some dependency issues. Post-processing happens after climate, but erosion needs to happen before climate.

**Target pipeline order:**

```
Stage 0:  Base Grid (cylindrical, continuous coordinates)
Stage 1:  Tectonic Plates (voronoi, low-res)
Stage 2:  Plate Interaction Map (boundaries, classification)
Stage 3:  Base Elevation Field (plate type + boundary effects + Jacobi)
Stage 4:  Noise Injection (multi-scale fBm)
Stage 5:  Erosion Pass (hydraulic erosion + sediment)
Stage 6:  Hydrology (flow accumulation, rivers, lakes)
Stage 7:  Temperature (latitude + elevation + ocean proximity + currents)
Stage 8:  Wind (6-cell model + terrain deflection)
Stage 9:  Moisture/Precipitation (evaporation + advection + rain shadow)
Stage 10: Biome Classification (Whittaker diagram)
Stage 11: Gameplay Voronoi (high-res, optional/later)
```

#### 4.2 — Separate Tectonic Voronoi from Gameplay Voronoi

**Status:** Not started  
**Why:** The tectonic voronoi is low-res (~750 cells for plate grouping). Gameplay tiling needs thousands of cells. They serve completely different purposes.

- Tectonic voronoi: ~50–200 plates, drives geology (already done)
- Gameplay voronoi: thousands of cells, samples FROM continuous maps
- Gameplay tiles are projections of simulation data, not drivers of it

---

### Phase 4b: Visualization

#### 4.3 — Contour Map Overlay

**Status:** Not started  
**Why:** Contour lines are the classic way to communicate elevation on a 2D map. They add immediate visual clarity to the generated terrain — you can "read" mountain ranges, valleys, and coastal shelves at a glance. Also useful as a debug/inspection tool during development.

- Generate isolines at configurable elevation intervals (e.g. every 0.05 or 0.1 in normalized space)
- Render as a semi-transparent overlay that can be composited on top of any layer (elevation, biomes, plates, etc.)
- Two rendering approaches to evaluate:
  - **Pixel-space edge detection:** For each pixel, check if any neighbor crosses an isoline threshold. Fast, trivial to implement on the existing raster pipeline.
  - **Marching squares:** Extract actual polyline contours from the elevation grid. More expensive but produces clean vector-like lines and enables labeling/styling per contour level.
- Start with pixel-space detection (fits the current `Uint8ClampedArray` RGBA output model)
- Configurable styling: line color/opacity, major vs minor contours (e.g. bold every 5th line), optional index labels
- Toggle-able in the layer selector (add to `LayerName` or as a separate overlay toggle)
- Should work on any continuous field, not just elevation — could overlay on temperature or precipitation to show gradients

**Implementation notes:**

- Contour detection runs post-generation as a rendering pass, not a simulation stage
- Keep it in the rendering layer (e.g. `rendering/contour-overlay.ts` or inside the color-map step)
- For the worker pipeline: compute contour mask as an additional output in `WorkerResponse.layerImages`, OR compute client-side from the raw elevation data

---

### Phase 5: Gameplay Layer (Future)

#### 5.1 — High-Resolution Gameplay Voronoi

**Status:** Not started  
**Why:** HOI4-style province tiling for gameplay. Separate from simulation entirely.

- Generate dense voronoi (thousands of cells)
- Each cell samples: elevation, moisture, temperature, biome from continuous fields
- Build adjacency graph for gameplay pathfinding
- Half-edge / DCEL structure for polygon queries

#### 5.2 — Soil Fertility Layer

**Status:** Not started  
**Why:** Gameplay relevance — river floodplains and volcanic regions are fertile.

- Derive from: sediment deposition, volcanic proximity, moisture
- Feed into gameplay (agriculture potential)

---

### Optional / Later Upgrades

- [ ] Seasonal climate shifts (tilt-based temperature oscillation)
- [ ] Ice caps / glaciers (precipitation + temperature threshold)
- [ ] Volcanism hotspots (intraplate magma plumes)
- [ ] Continental shelf detail (bathymetry for oceanic tiles)
- [ ] Soil type classification

---

## Key Design Principle

> **"Continuous simulation → sampled into Voronoi for gameplay"**

The simulation runs on continuous 2D fields (Float32Array grids). Gameplay tiles are a separate, high-resolution voronoi that _reads from_ those fields. This separation is what makes the output feel believable.

---

## Data Structure Summary

### Continuous Fields (simulation backbone)

```
elevation[width * height]      — Float32Array, normalized
temperature[width * height]    — Float32Array, 0–1
moisture[width * height]       — Float32Array, 0–1
wind[width * height * 2]       — Float32Array, interleaved [dx, dy]
flowAccumulation[width*height] — Float32Array (future)
riverMask[width * height]      — Uint8Array (future)
```

### Graph Structures

```
Plates: voronoi cells grouped via Dijkstra, adjacency from shared edges
Gameplay tiles (future): independent high-res voronoi, neighbors[]
```
