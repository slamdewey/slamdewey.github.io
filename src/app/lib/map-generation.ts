import { Coordinate } from './coordinate';
import { TileMap } from './tilemap';

export interface NoiseVariables {
  seed: number | undefined;
  octaves: number;
  frequency: number;
  persistence: number;
  lacunarity: number;
}

export type MapGenerationAlgorithm = <C extends Coordinate>(request: MapGenerationRequest<C>) => Promise<void>;

export async function generateTileMap<C extends Coordinate>(request: MapGenerationRequest<C>): Promise<void> {
  try {
    return request.algorithm(request);
  } catch (e) {
    request.error?.(e as Error);
  }
}

export interface MapGenerationRequest<C extends Coordinate> {
  columns: number;
  columnHeight: number;
  noiseVariables: NoiseVariables;
  waterPercentage: number;
  algorithm: MapGenerationAlgorithm;
  onComplete: (response: MapGenerationResponse<C>) => void;
  error?: (error: Error) => void;
  onStatusChange?: (...status: any) => void;
}

export interface MapGenerationResponse<C extends Coordinate> {
  columns: number;
  columnHeight: number;
  tileMap: TileMap<C>;
}
