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

// Fraction of the overall progress bar allotted to generation; the remainder
// covers layer-image rendering.
const GEN_PORTION = 0.85;

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  const generator = new WorldGenerator(data.config);
  const worldData = generator.generate((stage, fraction) => {
    const msg: WorkerResponse = { type: 'progress', stage, fraction: fraction * GEN_PORTION };
    postMessage(msg);
  });

  // Render resolution is separate from physics resolution (Phase A5). Layer
  // images are materialized at renderW × renderH; if the config doesn't
  // specify them they fall back to physics resolution (pre-A5 behavior).
  const renderW = data.config.renderWidth ?? worldData.width;
  const renderH = data.config.renderHeight ?? worldData.height;

  const sampler = new WorldSampler(worldData);
  const layerImages = {} as Record<LayerName, Uint8Array>;
  for (let i = 0; i < ALL_LAYERS.length; i++) {
    const layer = ALL_LAYERS[i];
    const rgba = new Uint8Array(renderW * renderH * 4);
    if (layer === 'plates') {
      platesToRGBA(rgba, renderW, renderH, sampler);
    } else {
      layerToRGBA(rgba, renderW, renderH, layer, sampler);
    }
    layerImages[layer] = rgba;
    const progress: WorkerResponse = {
      type: 'progress',
      stage: 'Rendering layers',
      fraction: GEN_PORTION + (1 - GEN_PORTION) * ((i + 1) / ALL_LAYERS.length),
    };
    postMessage(progress);
  }

  const response: WorkerResponse = {
    type: 'result',
    worldData,
    layerImages,
    renderWidth: renderW,
    renderHeight: renderH,
  };

  // Collect all typed array buffers for zero-copy transfer.
  // NOTE: temperature and precipitation alias temperatureMean / precipAnnual,
  // so we transfer each underlying buffer exactly once.
  const transfer: ArrayBuffer[] = [
    worldData.plateMap.buffer,
    worldData.faultLines.buffer,
    worldData.faultType.buffer,
    worldData.mountainRanges.buffer,
    worldData.volcanicArcs.buffer,
    worldData.riftFloorMask.buffer,
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
