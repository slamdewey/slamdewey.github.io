import { WorldGenerator } from './pipeline';
import { layerToRGBA, platesToRGBA } from './color-maps';
import { LayerName, WorldData } from './types';
import { WorkerRequest, WorkerResponse } from './worker-types';

const ALL_LAYERS: LayerName[] = [
  'plates',
  'faultLines',
  'elevation',
  'temperature',
  'wind',
  'precipitation',
  'biomes',
  'flowAccumulation',
  'rivers',
  'lakes',
];

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  const generator = new WorldGenerator(data.config);
  const { worldData, tectonicResult } = generator.generate();

  const layerImages = {} as Record<LayerName, Uint8Array>;
  for (const layer of ALL_LAYERS) {
    if (layer === 'plates') {
      layerImages[layer] = platesToRGBA(tectonicResult, worldData.width, worldData.height);
    } else {
      const src = selectLayerSource(worldData, layer);
      layerImages[layer] = layerToRGBA(src, worldData.width, worldData.height, layer, worldData.seaLevel, worldData);
    }
  }

  const response: WorkerResponse = { worldData, layerImages };

  // Collect all typed array buffers for zero-copy transfer
  const transfer: ArrayBuffer[] = [
    worldData.plateMap.buffer,
    worldData.faultLines.buffer,
    worldData.mountainRanges.buffer,
    worldData.elevation.buffer,
    worldData.temperature.buffer,
    worldData.wind.buffer,
    worldData.precipitation.buffer,
    worldData.biomes.buffer,
    worldData.flowAccumulation.buffer,
    worldData.rivers.buffer,
    worldData.lakes.buffer,
    ...ALL_LAYERS.map((l) => layerImages[l].buffer),
  ];

  postMessage(response, transfer);
});

function selectLayerSource(worldData: WorldData, layer: LayerName): Float32Array | Uint8Array {
  switch (layer) {
    case 'wind':
      return worldData.wind;
    case 'flowAccumulation':
      return worldData.flowAccumulation;
    case 'rivers':
      return worldData.rivers;
    case 'lakes':
      return worldData.lakes;
    case 'faultLines':
      return worldData.faultLines;
    case 'elevation':
      return worldData.elevation;
    case 'temperature':
      return worldData.temperature;
    case 'precipitation':
      return worldData.precipitation;
    case 'biomes':
      return worldData.biomes;
    default:
      throw new Error(`Unhandled layer ${layer}`);
  }
}
