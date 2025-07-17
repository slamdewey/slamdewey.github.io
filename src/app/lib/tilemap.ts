import { drawPolygon, FillStyleFn, TileTerrainFillStyles } from '../util/rendering';
import { AxialCoordinate, Coordinate, Vector2 } from './coordinate';
import { EcsRenderableComponent } from './ecs/ecs';

export const ALL_TILE_TERRAINS = [
  'void',
  'test',
  'ocean',
  'ocean_shelf',
  'shore',
  'grass',
  'tundra',
  'arctic',
] as const;
export type TileTerrain = (typeof ALL_TILE_TERRAINS)[number];

export const ALL_TILE_FEATURES = ['none', 'hill'];
export type TileFeature = (typeof ALL_TILE_FEATURES)[number];

export interface Tile<C extends Coordinate> {
  position: C;
  terrainType: TileTerrain;
  feature: TileFeature | undefined;
  isPassable: boolean;
  speedModifier: number;
  getNeighborOffsets: () => C[];
  getNeighborHashes: () => number[];
}

export class SquareTile implements Tile<Vector2> {
  private static readonly neighborOffsets = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ] as Vector2[];

  public getNeighborOffsets(): Vector2[] {
    return SquareTile.neighborOffsets;
  }

  public getNeighborHashes(): number[] {
    return SquareTile.neighborOffsets.map((offset: Vector2) => {
      return Coordinate.getHashCode(Vector2.plus(this.position, offset));
    });
  }

  position: Vector2;
  terrainType: TileTerrain;
  feature: TileFeature | undefined;
  isPassable: boolean;
  speedModifier: number;
}

export class HexTile implements Tile<AxialCoordinate> {
  public static readonly graphicalWidth = 20;
  public static readonly graphicalHeight = Math.floor((this.graphicalWidth * 13) / 15);
  private static readonly neighborOffsets = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ] as AxialCoordinate[];

  public getNeighborOffsets(): AxialCoordinate[] {
    return HexTile.neighborOffsets;
  }

  public getNeighborHashes(): number[] {
    return HexTile.neighborOffsets.map((offset: AxialCoordinate) => {
      return Coordinate.getHashCode(AxialCoordinate.plus(this.position, offset));
    });
  }

  public static TileToWorld(coord: AxialCoordinate, getTileCenter = true) {
    const tileCenterOffset = new AxialCoordinate(-2 / 3, 1 / 3);
    const offsetCoord = getTileCenter ? AxialCoordinate.plus(coord, tileCenterOffset) : coord;
    return new Vector2().set([
      ((offsetCoord.q * HexTile.graphicalWidth) / 2) * (3 / 2),
      (offsetCoord.q * HexTile.graphicalHeight) / 2 + offsetCoord.r * HexTile.graphicalHeight,
    ]);
  }

  position: AxialCoordinate;
  terrainType: TileTerrain;
  feature: TileFeature | undefined;
  isPassable: boolean;
  speedModifier: number;
}

export abstract class TileMap<C extends Coordinate> extends EcsRenderableComponent {
  public readonly columns: number;
  public readonly columnHeight: number;
  protected readonly numTiles: number;

  constructor(columns: number, columnHeight: number) {
    super();
    this.columns = columns;
    this.columnHeight = columnHeight;
    this.numTiles = columns * columnHeight;
  }

  public abstract setTiles(tileSet?: Tile<C>[]): void;
  public abstract getTileAt(coordinate: C): Tile<C> | undefined;
}

export class HexTileMap extends TileMap<AxialCoordinate> {
  private readonly hexTilePolygon: Vector2[];
  // this offset aligns the map to the edge of the fourth quadrant of worldspace
  private readonly tilePositionOffset = new AxialCoordinate(2 / 3, 2 / 3);
  // this offset aligns map's origin to it's center
  private readonly mapPositionOffset: AxialCoordinate;

  private tileSet: Set<HexTile>;
  private tileLookupByCoordinateHash: Map<number, HexTile>;

  constructor(columns: number, columnHeight: number) {
    super(columns, columnHeight);
    this.hexTilePolygon = this.createHexTilePolygon();
    this.mapPositionOffset = new AxialCoordinate(columns / 2, columnHeight / 2);

    this.tileSet = new Set();
    this.tileLookupByCoordinateHash = new Map<number, HexTile>();
  }

  public setTiles(tileSet?: HexTile[]): void {
    if (tileSet?.length != this.numTiles) {
      throw new Error(`Can't setTiles with tileSet of size ${tileSet?.length}.  Expecting length of: ${this.numTiles}`);
    }
    this.tileSet = new Set(tileSet);
    this.tileLookupByCoordinateHash = new Map<number, HexTile>();
    this.tileSet?.forEach((tile) => {
      this.tileLookupByCoordinateHash.set(tile.position.getHashCode(), tile);
    });
  }

  getTileAt(coordinate: AxialCoordinate): HexTile | undefined {
    return this.tileLookupByCoordinateHash.get(coordinate.getHashCode());
  }

  private createHexTilePolygon() {
    const radius = HexTile.graphicalWidth / 2;
    const inset = 0;
    const size = radius - inset;
    const step = (Math.PI * 2) / 6;
    const points: Vector2[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = step * i;
      points.push(new Vector2(size * Math.cos(angle), size * Math.sin(angle)));
    }
    return points;
  }

  public render(ctx: CanvasRenderingContext2D): void {
    const localTileOffset = AxialCoordinate.minus(this.tilePositionOffset, this.mapPositionOffset);

    this.tileSet.forEach((tile: HexTile) => {
      const fillStyleFn: FillStyleFn = TileTerrainFillStyles.get(tile.terrainType)!;
      const fillStyle = fillStyleFn(ctx);
      const offsetTilePosition = AxialCoordinate.plus(tile.position, localTileOffset);
      const position = HexTile.TileToWorld(offsetTilePosition, true);
      drawPolygon(ctx, this.hexTilePolygon, fillStyle, position);
      // draw feature?
    });
  }
}
