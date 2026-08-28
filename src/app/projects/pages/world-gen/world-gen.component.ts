import { ChangeDetectionStrategy, Component, computed, OnDestroy, signal } from '@angular/core';
import { SkeletonLoaderComponent } from '@components/skeleton-loader/skeleton-loader.component';
import { BannerComponent } from '@components/banner/banner.component';
import { CodeBlockComponent } from '@components/code-block/code-block.component';
import { SphereViewComponent } from '@components/sphere-view/sphere-view.component';
import { StageDemoComponent, StageImage } from './components/stage-demo/stage-demo.component';
import { ParamControlsComponent } from './components/param-controls/param-controls.component';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { FormsModule } from '@angular/forms';
import {
  NoiseVariables,
  ClimateVariables,
  TectonicVariables,
  HydrologyVariables,
  DEFAULT_NOISE,
  DEFAULT_CLIMATE,
  DEFAULT_TECTONIC,
  DEFAULT_HYDROLOGY,
  LayerName,
  WorldConfig,
  WorldData,
} from './lib/types';
import { WorkerResponse, WorkerResult } from './lib/worker-types';
import { aggregateMultiSeed, computeWorldStats, printWorldStats } from './lib/debug';

// Layer toggles follow pipeline execution order with the final synthesis
// (Biomes) up front as the headline view.
const LAYER_OPTIONS: { value: LayerName; label: string }[] = [
  { value: 'biomes', label: 'Biomes' },
  // Geology
  { value: 'plates', label: 'Plates' },
  { value: 'faultLines', label: 'Faults' },
  { value: 'continentalSubRelief', label: 'Sub-Relief' },
  { value: 'oceanAge', label: 'Ocean Age' },
  { value: 'elevation', label: 'Elevation' },
  // Climate stack
  { value: 'wind', label: 'Wind' },
  { value: 'windSummer', label: 'Wind (Sum)' },
  { value: 'windWinter', label: 'Wind (Win)' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'precipitation', label: 'Precipitation' },
  { value: 'soilMoisture', label: 'Soil Moisture' },
  { value: 'aridity', label: 'Aridity' },
  { value: 'seasonality', label: 'Seasonality' },
  { value: 'growingSeason', label: 'Growing' },
  { value: 'koppen', label: 'Köppen' },
  // Hydrology (final, rain-weighted pass)
  { value: 'flowAccumulation', label: 'Flow' },
  { value: 'rivers', label: 'Rivers' },
  { value: 'lakes', label: 'Lakes' },
];

@Component({
  selector: 'x-world-gen',
  templateUrl: './world-gen.component.html',
  styleUrls: ['./world-gen.component.scss'],
  imports: [
    BannerComponent,
    StageDemoComponent,
    ParamControlsComponent,
    CodeBlockComponent,
    MatButtonToggleModule,
    FormsModule,
    SkeletonLoaderComponent,
    SphereViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorldGenComponent implements OnDestroy {
  readonly layerOptions = LAYER_OPTIONS;

  // --- Code snippets ---

  readonly codeInteractionType = `enum InteractionType {
  Collision,          // cont-cont convergent (Himalayas)
  Subduction,         // ocean-cont convergent (Andes)
  OceanicConvergence, // ocean-ocean convergent (Mariana Trench)
  ContinentalRift,    // cont divergent (East Africa)
  OceanicRidge,       // ocean-ocean divergent (Mid-Atlantic Ridge)
  Transform,          // any transform (San Andreas)
}`;

  readonly codeKoppenClassify = `// Köppen-Geiger classifier (excerpt) — runs per cell
// against the seasonal temperature and precipitation fields.
const tColdest  = Math.min(tSummer, tWinter);
const tWarmest  = Math.max(tSummer, tWinter);
const summerShare = pSummer / (pSummer + pWinter);
const ai = aridityIndex[i]; // MAP / PET

// E — polar (warmest "month" too cold)
if (tWarmest < T_POLAR_WARMEST) {
  return tWarmest < T_ICECAP_WARMEST ? KoppenClass.EF : KoppenClass.ET;
}

// B — arid (aridity index dominates)
if (ai < AI_STEPPE) {
  const isDesert = ai < AI_DESERT;
  const isHot    = tWarmest >= T_HOT_SUMMER;
  return isDesert
    ? (isHot ? KoppenClass.BWh : KoppenClass.BWk)
    : (isHot ? KoppenClass.BSh : KoppenClass.BSk);
}

// A — tropical (no cold winters)
if (tColdest > T_TROPICAL_COLDEST) {
  const driestPrecip = (pSummer + pWinter) * Math.min(summerShare, 1 - summerShare);
  return driestPrecip > 0.25 ? KoppenClass.Af
       : driestPrecip > 0.10 ? KoppenClass.Am
       :                       KoppenClass.Aw;
}
// ... C and D groups follow the same shape, splitting on s/w/f sub-letter
// (summer-dry, winter-dry, no-dry-season) and a/b/c warmth tiers.`;

  // Reference + color legend for the six plate interactions. Colors mirror
  // FAULT_TYPE_COLOR in color-maps.ts (the Faults layer paints boundaries by
  // interaction type), so this table doubles as the legend for that layer.
  readonly faultInteractions: readonly {
    color: string;
    name: string;
    motion: string;
    plates: string;
    effect: string;
    example: string;
  }[] = [
    {
      color: 'rgb(255, 64, 48)',
      name: 'Collision',
      motion: 'Convergent',
      plates: 'Cont – Cont',
      effect: 'Mountain belt — both sides crumple upward',
      example: 'Himalayas',
    },
    {
      color: 'rgb(255, 144, 32)',
      name: 'Subduction',
      motion: 'Convergent',
      plates: 'Ocean – Cont',
      effect:
        'Arc mountains on the continent, deep trench on the ocean side (asymmetric; trench deepens with convergence speed)',
      example: 'Andes',
    },
    {
      color: 'rgb(255, 208, 64)',
      name: 'Oceanic convergence',
      motion: 'Convergent',
      plates: 'Ocean – Ocean',
      effect: 'Volcanic island arc on the overriding plate, trench on the subducting plate',
      example: 'Mariana Islands',
    },
    {
      color: 'rgb(96, 220, 96)',
      name: 'Continental rift',
      motion: 'Divergent',
      plates: 'Cont – Cont / Ocean',
      effect: 'Rift valley with raised horst shoulders; floors can fill into rift lakes',
      example: 'East African Rift',
    },
    {
      color: 'rgb(64, 168, 255)',
      name: 'Oceanic ridge',
      motion: 'Divergent',
      plates: 'Ocean – Ocean',
      effect: 'Mid-ocean ridge — seafloor lifts at the spreading axis and sinks with age',
      example: 'Mid-Atlantic Ridge',
    },
    {
      color: 'rgb(198, 96, 232)',
      name: 'Transform',
      motion: 'Transform',
      plates: 'Any',
      effect: 'Strike-slip — plates grind laterally with little vertical motion',
      example: 'San Andreas',
    },
  ];

  // Configuration signals
  noiseConfig = signal<NoiseVariables>({ ...DEFAULT_NOISE });
  climateConfig = signal<ClimateVariables>({ ...DEFAULT_CLIMATE });
  tectonicConfig = signal<TectonicVariables>({ ...DEFAULT_TECTONIC });
  hydrologyConfig = signal<HydrologyVariables>({ ...DEFAULT_HYDROLOGY });
  mapWidth = signal(1024);
  mapHeight = signal(512);
  // Equatorial circumference of the simulated world. Earth-default 40000 km
  // makes the climate physics resolution-independent — changing mapWidth
  // alone won't change the climate, only the spatial detail.
  circumferenceKm = signal(40000);

  // Static stage images (2D canvas, no animation loop)
  plateImage = signal<StageImage | null>(null);
  faultImage = signal<StageImage | null>(null);
  subReliefImage = signal<StageImage | null>(null);
  oceanAgeImage = signal<StageImage | null>(null);
  elevationImage = signal<StageImage | null>(null);
  temperatureImage = signal<StageImage | null>(null);
  windImage = signal<StageImage | null>(null);
  windSummerImage = signal<StageImage | null>(null);
  windWinterImage = signal<StageImage | null>(null);
  precipitationImage = signal<StageImage | null>(null);
  soilMoistureImage = signal<StageImage | null>(null);
  biomeImage = signal<StageImage | null>(null);
  flowImage = signal<StageImage | null>(null);
  riverImage = signal<StageImage | null>(null);
  lakeImage = signal<StageImage | null>(null);
  aridityImage = signal<StageImage | null>(null);
  seasonalityImage = signal<StageImage | null>(null);
  growingSeasonImage = signal<StageImage | null>(null);
  koppenImage = signal<StageImage | null>(null);

  // Shared horizontal pan offset across every stage demo, in image pixels.
  sharedPanOffset = signal(0);

  // Full interactive demo — selected layer
  selectedLayer = signal<LayerName>('biomes');

  fullDemoImage = computed<StageImage | null>(() => {
    const layer = this.selectedLayer();
    switch (layer) {
      case 'plates':
        return this.plateImage();
      case 'faultLines':
        return this.faultImage();
      case 'continentalSubRelief':
        return this.subReliefImage();
      case 'oceanAge':
        return this.oceanAgeImage();
      case 'elevation':
        return this.elevationImage();
      case 'temperature':
        return this.temperatureImage();
      case 'wind':
        return this.windImage();
      case 'windSummer':
        return this.windSummerImage();
      case 'windWinter':
        return this.windWinterImage();
      case 'precipitation':
        return this.precipitationImage();
      case 'soilMoisture':
        return this.soilMoistureImage();
      case 'biomes':
        return this.biomeImage();
      case 'flowAccumulation':
        return this.flowImage();
      case 'rivers':
        return this.riverImage();
      case 'lakes':
        return this.lakeImage();
      case 'aridity':
        return this.aridityImage();
      case 'seasonality':
        return this.seasonalityImage();
      case 'growingSeason':
        return this.growingSeasonImage();
      case 'koppen':
        return this.koppenImage();
      default:
        return null;
    }
  });

  // State
  isGenerating = signal(false);
  // Progress reported by the worker while a generation runs.
  genStage = signal('');
  genFraction = signal(0);
  /** Loading-overlay text: current stage + overall percent. */
  genStatus = computed(() => {
    const stage = this.genStage();
    if (!stage) return 'Generating…';
    return `${stage}… ${Math.round(this.genFraction() * 100)}%`;
  });

  // Worker
  private worker: Worker | null = null;

  // Longitude rotation is derived from sharedPanOffset so the sphere spins in
  // lockstep with every cylindrical layer panner. Latitude tilt is sphere-only.
  layerSphereRotLat = signal(0);
  layerSphereRotLon = computed(() => {
    const img = this.fullDemoImage();
    if (!img) return 0;
    return (this.sharedPanOffset() / img.width) * Math.PI * 2;
  });
  private isLayerSphereRotating = false;
  private layerRotStartX = 0;
  private layerRotStartY = 0;
  private layerRotBaseLat = 0;
  private layerRotBasePan = 0;

  constructor() {
    setTimeout(() => this.regenerate(), 0);
  }

  ngOnDestroy(): void {
    this.worker?.terminate();
  }

  // --- Sphere drag: horizontal → sharedPanOffset, vertical → rotLat ---

  onLayerSphereRotateStart(e: PointerEvent): void {
    this.isLayerSphereRotating = true;
    this.layerRotStartX = e.clientX;
    this.layerRotStartY = e.clientY;
    this.layerRotBaseLat = this.layerSphereRotLat();
    this.layerRotBasePan = this.sharedPanOffset();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  onLayerSphereRotateMove(e: PointerEvent): void {
    if (!this.isLayerSphereRotating) return;
    const target = e.currentTarget as HTMLElement;
    const img = this.fullDemoImage();
    if (!img) return;
    // Vertical drag → rotLat (sphere-only).
    const dy = e.clientY - this.layerRotStartY;
    const latScale = Math.PI / target.clientWidth;
    const limit = Math.PI / 2 - 0.001;
    let lat = this.layerRotBaseLat + dy * latScale;
    if (lat > limit) lat = limit;
    else if (lat < -limit) lat = -limit;
    this.layerSphereRotLat.set(lat);
    // Horizontal drag → sharedPanOffset (drives sphere lon AND every equirect panner).
    const dx = e.clientX - this.layerRotStartX;
    const panScale = img.width / target.clientWidth;
    this.sharedPanOffset.set(this.layerRotBasePan - dx * panScale);
  }

  onLayerSphereRotateEnd(e: PointerEvent): void {
    this.isLayerSphereRotating = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  regenerate(): void {
    this.isGenerating.set(true);
    this.genStage.set('');
    this.genFraction.set(0);
    this.sharedPanOffset.set(0);

    // Abandon any in-flight generation. The worker runs generate() synchronously,
    // so a freshly posted message just queues behind the running one — it can't
    // cancel it. Terminating and respawning kills the stale computation so we
    // don't waste cores rendering a result we're about to throw away.
    this.worker?.terminate();
    const worker = new Worker(new URL('./lib/world-gen.worker', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') {
        this.genStage.set(data.stage);
        this.genFraction.set(data.fraction);
      } else {
        this.onWorkerResult(data);
      }
    };
    this.worker = worker;
    worker.postMessage({ config: this.buildConfig() });
  }

  private buildConfig(seedOverride?: number): WorldConfig {
    const noise = { ...this.noiseConfig() };
    if (seedOverride !== undefined) noise.seed = seedOverride;
    return {
      width: this.mapWidth(),
      height: this.mapHeight(),
      circumferenceKm: this.circumferenceKm(),
      noise,
      climate: this.climateConfig(),
      tectonic: this.tectonicConfig(),
      hydrology: this.hydrologyConfig(),
    };
  }

  /**
   * Run N parallel workers with random seeds and the current params; aggregate
   * Köppen / group stats across them. The aggregate exposes mean ± stddev per
   * class, which is how we tell whether a tuning result is robust (low stddev)
   * or specific to one map's geography (high stddev).
   *
   * Each generation runs in its own dedicated Worker so they execute concurrently
   * on multiple CPU cores. Workers are terminated on completion (no buffer reuse
   * since the underlying Float32Arrays are transferred and detached).
   */
  async runMultiSeedSweep(seedCount = 5): Promise<void> {
    this.isGenerating.set(true);
    const config = this.buildConfig();
    const seeds: number[] = [];
    const promises: Promise<WorldData>[] = [];
    for (let i = 0; i < seedCount; i++) {
      const seed = Math.floor(Math.random() * 2147483647);
      seeds.push(seed);
      promises.push(this.runOneInDedicatedWorker({ ...config, noise: { ...config.noise, seed } }));
    }

    console.log(`%c🌍 Multi-seed sweep — running ${seedCount} workers in parallel`, 'font-weight: bold; color: #3a8');
    const start = performance.now();
    const worldDatas = await Promise.all(promises);
    const elapsed = (performance.now() - start) / 1000;
    console.log(`Done in ${elapsed.toFixed(1)}s`);

    const allStats = worldDatas.map((wd) => computeWorldStats(wd));
    const agg = aggregateMultiSeed(seeds, allStats);
    console.log('%cAggregate (JSON below):', 'font-weight: bold; color: #3a8');
    console.log(JSON.stringify(agg, null, 2));
    (globalThis as unknown as { __sweepStats?: typeof agg }).__sweepStats = agg;

    this.isGenerating.set(false);
  }

  private runOneInDedicatedWorker(config: WorldConfig): Promise<WorldData> {
    return new Promise((resolve) => {
      const w = new Worker(new URL('./lib/world-gen.worker', import.meta.url), { type: 'module' });
      w.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type !== 'result') return; // ignore progress pings
        w.terminate();
        resolve(data.worldData);
      };
      w.postMessage({ config });
    });
  }

  private onWorkerResult(result: WorkerResult): void {
    const { worldData, layerImages, renderWidth, renderHeight } = result;

    // Texture dimensions follow the *render* resolution (Phase A5). Physics
    // resolution (worldData.width/height) only matters for stat readouts.
    const w = renderWidth;
    const h = renderHeight;

    this.plateImage.set({ rgba: layerImages.plates, width: w, height: h });
    this.faultImage.set({ rgba: layerImages.faultLines, width: w, height: h });
    this.subReliefImage.set({ rgba: layerImages.continentalSubRelief, width: w, height: h });
    this.oceanAgeImage.set({ rgba: layerImages.oceanAge, width: w, height: h });
    this.elevationImage.set({ rgba: layerImages.elevation, width: w, height: h });
    this.temperatureImage.set({ rgba: layerImages.temperature, width: w, height: h });
    this.windImage.set({ rgba: layerImages.wind, width: w, height: h });
    this.windSummerImage.set({ rgba: layerImages.windSummer, width: w, height: h });
    this.windWinterImage.set({ rgba: layerImages.windWinter, width: w, height: h });
    this.precipitationImage.set({ rgba: layerImages.precipitation, width: w, height: h });
    this.soilMoistureImage.set({ rgba: layerImages.soilMoisture, width: w, height: h });
    this.biomeImage.set({ rgba: layerImages.biomes, width: w, height: h });
    this.flowImage.set({ rgba: layerImages.flowAccumulation, width: w, height: h });
    this.riverImage.set({ rgba: layerImages.rivers, width: w, height: h });
    this.lakeImage.set({ rgba: layerImages.lakes, width: w, height: h });
    this.aridityImage.set({ rgba: layerImages.aridity, width: w, height: h });
    this.seasonalityImage.set({ rgba: layerImages.seasonality, width: w, height: h });
    this.growingSeasonImage.set({ rgba: layerImages.growingSeason, width: w, height: h });
    this.koppenImage.set({ rgba: layerImages.koppen, width: w, height: h });

    printWorldStats(worldData);

    this.isGenerating.set(false);
  }

  onLayerChange(layer: LayerName): void {
    this.selectedLayer.set(layer);
  }
}
