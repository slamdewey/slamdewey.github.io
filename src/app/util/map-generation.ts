import { AxialCoordinate } from '../shapes/coordinate';
import { MapGenerationRequest } from '../shapes/map-generation';
import { HexTile, HexTileMap, ALL_TILE_TERRAINS } from '../shapes/tilemap';

export async function SpecularHexMapGenerator(
  request: MapGenerationRequest<AxialCoordinate>
): Promise<void> {
  request.onStatusChange?.('Initializing');

  const tiles: HexTile[] = [];
  const tileMap = new HexTileMap(request.columns, request.columnHeight);
  const allTerrainTypes = ALL_TILE_TERRAINS;

  request.onStatusChange?.('Generating Tiles');

  for (let q = 0; q < request.columns; q++) {
    const offset = -(q / 2);
    for (let r = offset; r < offset + request.columnHeight; r++) {
      const mod = (n: number, d: number) => ((n % d) + d) % d;
      const terrainType = allTerrainTypes[mod(Math.ceil(Math.abs(r + q)), allTerrainTypes.length)];
      tiles.push({
        position: new AxialCoordinate(Math.floor(q), Math.floor(r)),
        terrainType: terrainType,
        feature: undefined,
        isPassable: true,
        speedModifier: 1,
      } as HexTile);
    }
  }

  request.onStatusChange?.(`Generated ${tiles.length} tiles`);

  tileMap.setTiles(tiles);

  request.onStatusChange?.('Done');
  request.onComplete({
    columns: request.columns,
    columnHeight: request.columnHeight,
    tileMap: tileMap,
  });
}
