import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { BannerComponent } from '@components/banner/banner.component';
import { StageDemoComponent } from './components/stage-demo/stage-demo.component';
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
  imports: [BannerComponent, StageDemoComponent, ParamControlsComponent, MatButtonToggleModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorldGenComponent {
  readonly layerOptions = LAYER_OPTIONS;

  // Configuration signals
  noiseConfig = signal<NoiseVariables>({ ...DEFAULT_NOISE });
  climateConfig = signal<ClimateVariables>({ ...DEFAULT_CLIMATE });
  mapWidth = signal(512);
  mapHeight = signal(256);

  // Backdrops for inline demos
  faultDemo = new MapTextureBackdrop();
  elevationDemo = new MapTextureBackdrop();
  temperatureDemo = new MapTextureBackdrop();
  windDemo = new MapTextureBackdrop();
  precipitationDemo = new MapTextureBackdrop();
  biomeDemo = new MapTextureBackdrop();

  // Full demo backdrop + layer selection
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

      this.pushToBackdrops(worldData, layerImages);
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

  onPanStart(event: MouseEvent): void {
    this.isPanning = true;
    this.panStartX = event.clientX;
    this.panBase = this.fullDemo.panOffset;
    event.preventDefault();
  }

  onPanMove(event: MouseEvent): void {
    if (!this.isPanning || !this.worldData) return;
    const dx = event.clientX - this.panStartX;
    // Convert pixel delta to UV offset (negative so dragging right moves map right)
    const target = event.currentTarget as HTMLElement;
    this.fullDemo.panOffset = this.panBase - dx / target.clientWidth;
  }

  onPanEnd(): void {
    this.isPanning = false;
  }

  private pushToBackdrops(worldData: WorldData, layerImages: Record<LayerName, Uint8Array>): void {
    const w = worldData.width;
    const h = worldData.height;

    this.faultDemo.uploadData(layerImages.faultLines, w, h);
    this.elevationDemo.uploadData(layerImages.elevation, w, h);
    this.temperatureDemo.uploadData(layerImages.temperature, w, h);
    this.windDemo.uploadData(layerImages.wind, w, h);
    this.precipitationDemo.uploadData(layerImages.precipitation, w, h);
    this.biomeDemo.uploadData(layerImages.biomes, w, h);
    this.fullDemo.uploadData(layerImages[this.selectedLayer()], w, h);
  }
}
