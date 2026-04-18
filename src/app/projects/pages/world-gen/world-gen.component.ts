import { ChangeDetectionStrategy, Component, OnDestroy, signal } from '@angular/core';
import { BannerComponent } from '@components/banner/banner.component';
import { BackdropComponent } from '@components/backdrop/backdrop.component';
import { StageDemoComponent, StageImage } from './components/stage-demo/stage-demo.component';
import { ParamControlsComponent } from './components/param-controls/param-controls.component';
import { MapTextureBackdrop } from './rendering/map-texture-backdrop';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { FormsModule } from '@angular/forms';
import {
  NoiseVariables,
  ClimateVariables,
  TectonicVariables,
  DEFAULT_NOISE,
  DEFAULT_CLIMATE,
  DEFAULT_TECTONIC,
  LayerName,
  WorldData,
} from './lib/types';
import { WorkerResponse } from './lib/worker-types';

const LAYER_OPTIONS: { value: LayerName; label: string }[] = [
  { value: 'biomes', label: 'Biomes' },
  { value: 'plates', label: 'Plates' },
  { value: 'faultLines', label: 'Faults' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'wind', label: 'Wind' },
  { value: 'precipitation', label: 'Precipitation' },
];

@Component({
  selector: 'x-world-gen',
  templateUrl: './world-gen.component.html',
  styleUrls: ['./world-gen.component.scss'],
  imports: [
    BannerComponent,
    BackdropComponent,
    StageDemoComponent,
    ParamControlsComponent,
    MatButtonToggleModule,
    FormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorldGenComponent implements OnDestroy {
  readonly layerOptions = LAYER_OPTIONS;

  // Configuration signals
  noiseConfig = signal<NoiseVariables>({ ...DEFAULT_NOISE });
  climateConfig = signal<ClimateVariables>({ ...DEFAULT_CLIMATE });
  tectonicConfig = signal<TectonicVariables>({ ...DEFAULT_TECTONIC });
  mapWidth = signal(512);
  mapHeight = signal(256);

  // Static stage images (2D canvas, no animation loop)
  plateImage = signal<StageImage | null>(null);
  faultImage = signal<StageImage | null>(null);
  elevationImage = signal<StageImage | null>(null);
  temperatureImage = signal<StageImage | null>(null);
  windImage = signal<StageImage | null>(null);
  precipitationImage = signal<StageImage | null>(null);
  biomeImage = signal<StageImage | null>(null);

  // Full interactive demo (WebGL for panning)
  fullDemo = new MapTextureBackdrop();
  selectedLayer = signal<LayerName>('biomes');

  // State
  isGenerating = signal(false);
  private worldData: WorldData | null = null;
  private layerImages: Record<LayerName, Uint8Array> | null = null;

  // Pan state for full demo
  private isPanning = false;
  private panStartX = 0;
  private panBase = 0;

  // Worker
  private worker: Worker | null = null;

  constructor() {
    setTimeout(() => this.regenerate(), 0);
  }

  ngOnDestroy(): void {
    this.worker?.terminate();
  }

  regenerate(): void {
    this.isGenerating.set(true);

    if (!this.worker) {
      this.worker = new Worker(new URL('./lib/world-gen.worker', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => this.onWorkerResult(data);
    }

    this.worker.postMessage({
      config: {
        width: this.mapWidth(),
        height: this.mapHeight(),
        noise: this.noiseConfig(),
        climate: this.climateConfig(),
        tectonic: this.tectonicConfig(),
      },
    });
  }

  private onWorkerResult(result: WorkerResponse): void {
    const { worldData, layerImages } = result;
    this.worldData = worldData;
    this.layerImages = layerImages;

    const w = worldData.width;
    const h = worldData.height;

    this.plateImage.set({ rgba: layerImages.plates, width: w, height: h });
    this.faultImage.set({ rgba: layerImages.faultLines, width: w, height: h });
    this.elevationImage.set({ rgba: layerImages.elevation, width: w, height: h });
    this.temperatureImage.set({ rgba: layerImages.temperature, width: w, height: h });
    this.windImage.set({ rgba: layerImages.wind, width: w, height: h });
    this.precipitationImage.set({ rgba: layerImages.precipitation, width: w, height: h });
    this.biomeImage.set({ rgba: layerImages.biomes, width: w, height: h });

    this.fullDemo.uploadData(layerImages[this.selectedLayer()], w, h);

    this.isGenerating.set(false);
  }

  onLayerChange(layer: LayerName): void {
    this.selectedLayer.set(layer);
    if (this.layerImages && this.worldData) {
      this.fullDemo.uploadData(this.layerImages[layer], this.worldData.width, this.worldData.height);
    }
  }

  // --- Pan controls for full demo ---

  onPanStart(event: PointerEvent): void {
    this.isPanning = true;
    this.panStartX = event.clientX;
    this.panBase = this.fullDemo.panOffset;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPanMove(event: PointerEvent): void {
    if (!this.isPanning || !this.worldData) return;
    const dx = event.clientX - this.panStartX;
    // Convert pixel delta to UV offset (negative so dragging right moves map right)
    const target = event.currentTarget as HTMLElement;
    this.fullDemo.panOffset = this.panBase - dx / target.clientWidth;
  }

  onPanEnd(): void {
    this.isPanning = false;
  }
}
