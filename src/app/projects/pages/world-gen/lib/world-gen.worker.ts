import { WorldGenerator } from './pipeline';
import { layerToRGBA, platesToRGBA } from './color-maps';
import { LayerName, WorldData } from './types';
import { WorkerRequest, WorkerResponse } from './worker-types';

const ALL_LAYERS: LayerName[] = [
  'plates',
  'faultLines',
  'continentalSubRelief',
  'oceanAge',
  'elevation',
  'temperature',
  'wind',
  'windSummer',
  'windWinter',
  'precipitation',
  'soilMoisture',
  'biomes',
  'flowAccumulation',
  'rivers',
  'lakes',
  'aridity',
  'seasonality',
  'growingSeason',
  'koppen',
];

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  const generator = new WorldGenerator(data.config);
  const worldData = generator.generate();

  const layerImages = {} as Record<LayerName, Uint8Array>;
  for (const layer of ALL_LAYERS) {
    if (layer === 'plates') {
      layerImages[layer] = platesToRGBA(worldData, worldData.width, worldData.height);
    } else {
      const src = selectLayerSource(worldData, layer);
      layerImages[layer] = layerToRGBA(src, worldData.width, worldData.height, layer, worldData.seaLevel, worldData);
    }
  }

  const response: WorkerResponse = { worldData, layerImages };

  // Collect all typed array buffers for zero-copy transfer.
  // NOTE: temperature and precipitation alias temperatureMean / precipAnnual,
  // so we transfer each underlying buffer exactly once.
  const transfer: ArrayBuffer[] = [
    worldData.plateMap.buffer,
    worldData.faultLines.buffer,
    worldData.mountainRanges.buffer,
    worldData.continentalSubRelief.buffer,
    worldData.oceanAge.buffer,
    worldData.elevation.buffer,
    worldData.temperatureSummer.buffer,
    worldData.temperatureWinter.buffer,
    worldData.temperatureMean.buffer,
    worldData.wind.buffer,
    worldData.windSummer.buffer,
    worldData.windWinter.buffer,
    worldData.petSummer.buffer,
    worldData.petWinter.buffer,
    worldData.petAnnual.buffer,
    worldData.precipSummer.buffer,
    worldData.precipWinter.buffer,
    worldData.precipAnnual.buffer,
    worldData.soilMoisture.buffer,
    worldData.aridityIndex.buffer,
    worldData.seasonality.buffer,
    worldData.continentality.buffer,
    worldData.growingSeason.buffer,
    worldData.koppenClass.buffer,
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
    case 'windSummer':
      return worldData.windSummer;
    case 'windWinter':
      return worldData.windWinter;
    case 'flowAccumulation':
      return worldData.flowAccumulation;
    case 'rivers':
      return worldData.rivers;
    case 'lakes':
      return worldData.lakes;
    case 'faultLines':
      return worldData.faultLines;
    case 'continentalSubRelief':
      return worldData.continentalSubRelief;
    case 'oceanAge':
      return worldData.oceanAge;
    case 'elevation':
      return worldData.elevation;
    case 'temperature':
      return worldData.temperatureMean;
    case 'precipitation':
      return worldData.precipAnnual;
    case 'soilMoisture':
      return worldData.soilMoisture;
    case 'biomes':
      return worldData.biomes;
    case 'aridity':
      return worldData.aridityIndex;
    case 'seasonality':
      return worldData.seasonality;
    case 'growingSeason':
      return worldData.growingSeason;
    case 'koppen':
      return worldData.koppenClass;
    default:
      throw new Error(`Unhandled layer ${layer}`);
  }
}
