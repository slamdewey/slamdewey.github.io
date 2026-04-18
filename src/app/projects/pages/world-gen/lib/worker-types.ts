import { WorldConfig, WorldData, LayerName } from './types';

export interface WorkerRequest {
  config: WorldConfig;
}

export interface WorkerResponse {
  worldData: WorldData;
  layerImages: Record<LayerName, Uint8Array>;
}
