import { WorldConfig, WorldData, LayerName } from './types';

export interface WorkerRequest {
  config: WorldConfig;
}

/** Intermediate progress ping emitted while a generation is running, so the UI
 *  can show the current stage and an overall fraction in [0, 1]. */
export interface WorkerProgress {
  type: 'progress';
  /** Human-readable name of the stage currently running. */
  stage: string;
  /** Overall completion fraction in [0, 1] (generation + layer rendering). */
  fraction: number;
}

export interface WorkerResult {
  type: 'result';
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

/** Everything the worker posts back: zero or more progress pings, then one result. */
export type WorkerResponse = WorkerProgress | WorkerResult;
