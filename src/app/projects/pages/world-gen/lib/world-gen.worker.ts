import { WorldGenerator } from './pipeline';
import { layerToRGBA, platesToRGBA } from './color-maps';
import { LayerName, WorldData } from './types';
import { WorldSampler } from './world-sampler';
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

  // Render resolution is separate from physics resolution (Phase A5). Layer
  // images are materialized at renderW × renderH; if the config doesn't
  // specify them they fall back to physics resolution (pre-A5 behavior).
  const renderW = data.config.renderWidth ?? worldData.width;
  const renderH = data.config.renderHeight ?? worldData.height;

  const sampler = new WorldSampler(worldData);
  const layerImages = {} as Record<LayerName, Uint8Array>;
  for (const layer of ALL_LAYERS) {
    const rgba = new Uint8Array(renderW * renderH * 4);
    if (layer === 'plates') {
      platesToRGBA(rgba, renderW, renderH, sampler);
    } else {
      layerToRGBA(rgba, renderW, renderH, layer, sampler);
    }
    layerImages[layer] = rgba;
  }

  const response: WorkerResponse = { worldData, layerImages, renderWidth: renderW, renderHeight: renderH };

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

// `selectLayerSource` is no longer needed — the new layerToRGBA goes through
// the sampler, which knows how to read each field. Kept here in a comment
// only for the historical record of which layer mapped to which array; that
// mapping now lives inside `WorldSampler.sampleX` methods and the layer-
// dispatch switch in color-maps.ts.
export type _UnusedWorldData = WorldData;
