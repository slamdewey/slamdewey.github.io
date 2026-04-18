import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { BannerComponent } from '@components/banner/banner.component';
import { BackdropComponent } from '@components/backdrop/backdrop.component';
import { StageDemoComponent, StageImage } from './components/stage-demo/stage-demo.component';
import { ParamControlsComponent } from './components/param-controls/param-controls.component';
import { MapTextureBackdrop } from './rendering/map-texture-backdrop';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { FormsModule } from '@angular/forms';
import { NoiseVariables, ClimateVariables, DEFAULT_NOISE, DEFAULT_CLIMATE, LayerName, WorldData } from './lib/types';
import { WorldGenerator } from './lib/pipeline';
import { layerToRGBA } from './lib/color-maps';

const LAYER_OPTIONS: { value: LayerName; label: string }[] = [
  { value: 'biomes', label: 'Biomes' },
  { value: 'faultLines', label: 'Faults' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'wind', label: 'Wind' },
  { value: 'precipitation', label: 'Precipitation' },
];

const ALL_LAYERS: LayerName[] = ['faultLines', 'elevation', 'temperature', 'wind', 'precipitation', 'biomes'];

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
export class WorldGenComponent {
  readonly layerOptions = LAYER_OPTIONS;

  // Configuration signals
  noiseConfig = signal<NoiseVariables>({ ...DEFAULT_NOISE });
  climateConfig = signal<ClimateVariables>({ ...DEFAULT_CLIMATE });
  mapWidth = signal(512);
  mapHeight = signal(256);

  // Static stage images (2D canvas, no animation loop)
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

  constructor() {
    setTimeout(() => this.regenerate(), 0);
  }

  regenerate(): void {
    this.isGenerating.set(true);

    setTimeout(() => {
      const generator = new WorldGenerator({
        width: this.mapWidth(),
        height: this.mapHeight(),
        noise: this.noiseConfig(),
        climate: this.climateConfig(),
      });

      const worldData = generator.generate();
      this.worldData = worldData;

      // Pre-render all layers to RGBA
      const layerImages = {} as Record<LayerName, Uint8Array>;
      for (const layer of ALL_LAYERS) {
        const data = layer === 'wind' ? worldData.wind : worldData[layer];
        layerImages[layer] = layerToRGBA(data, worldData.width, worldData.height, layer, worldData.seaLevel, worldData);
      }
      this.layerImages = layerImages;

      const w = worldData.width;
      const h = worldData.height;

      // Push to static stage demos
      this.faultImage.set({ rgba: layerImages.faultLines, width: w, height: h });
      this.elevationImage.set({ rgba: layerImages.elevation, width: w, height: h });
      this.temperatureImage.set({ rgba: layerImages.temperature, width: w, height: h });
      this.windImage.set({ rgba: layerImages.wind, width: w, height: h });
      this.precipitationImage.set({ rgba: layerImages.precipitation, width: w, height: h });
      this.biomeImage.set({ rgba: layerImages.biomes, width: w, height: h });

      // Push to interactive full demo
      this.fullDemo.uploadData(layerImages[this.selectedLayer()], w, h);

      this.isGenerating.set(false);
    }, 16);
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
