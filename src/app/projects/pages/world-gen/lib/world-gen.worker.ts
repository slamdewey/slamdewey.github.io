import { WorldGenerator } from './pipeline';
import { layerToRGBA } from './color-maps';
import { LayerName } from './types';
import { WorkerRequest, WorkerResponse } from './worker-types';

const ALL_LAYERS: LayerName[] = ['faultLines', 'elevation', 'temperature', 'wind', 'precipitation', 'biomes'];

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  const generator = new WorldGenerator(data.config);
  const worldData = generator.generate();

  const layerImages = {} as Record<LayerName, Uint8Array>;
  for (const layer of ALL_LAYERS) {
    const src = layer === 'wind' ? worldData.wind : worldData[layer];
    layerImages[layer] = layerToRGBA(src, worldData.width, worldData.height, layer, worldData.seaLevel, worldData);
  }

  const response: WorkerResponse = { worldData, layerImages };

  // Collect all typed array buffers for zero-copy transfer
  const transfer: ArrayBuffer[] = [
    worldData.faultLines.buffer,
    worldData.mountainRanges.buffer,
    worldData.elevation.buffer,
    worldData.temperature.buffer,
    worldData.wind.buffer,
    worldData.precipitation.buffer,
    worldData.biomes.buffer,
    ...ALL_LAYERS.map((l) => layerImages[l].buffer),
  ];

  postMessage(response, transfer);
});
