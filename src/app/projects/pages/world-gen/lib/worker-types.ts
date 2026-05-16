import { WorldConfig, WorldData, LayerName } from './types';

export interface WorkerRequest {
  config: WorldConfig;
}

export interface WorkerResponse {
  worldData: WorldData;
  layerImages: Record<LayerName, Uint8Array>;
  /**
   * Resolution at which `layerImages` were materialized (Phase A5). Equals
   * `worldData.width` / `worldData.height` if the request didn't override
   * with `renderWidth` / `renderHeight`. The component uses these to size
   * GPU textures.
   */
  renderWidth: number;
  renderHeight: number;
}
