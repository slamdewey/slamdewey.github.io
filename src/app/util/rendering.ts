import { Vector2 } from '../lib/coordinate';
import { HexTile, TileTerrain } from '../lib/tilemap';

export type FillStyle = string | CanvasGradient | CanvasPattern;
export type FillStyleFn = (ctx: CanvasRenderingContext2D) => FillStyle;

export const TileTerrainFillStyles = new Map<TileTerrain, FillStyleFn>([
  ['void', () => 'rgb(0, 0, 0, 0)'],
  [
    'test',
    (ctx: CanvasRenderingContext2D) => {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, HexTile.graphicalWidth / 2);
      grad.addColorStop(0, 'white');
      grad.addColorStop(0.5, 'red');
      grad.addColorStop(1, 'yellow');
      return grad as FillStyle;
    },
  ],
  ['ocean', () => 'blue'],
  ['ocean_shelf', () => 'rgb(0, 127, 255, 255)'],
  ['shore', () => 'tan'],
  ['grass', () => 'green'],
  ['tundra', () => 'gray'],
  ['arctic', () => 'rgb(230, 230, 230)'],
]);

export const drawPolygon = (
  ctx: CanvasRenderingContext2D,
  vertices: Vector2[],
  fillStyle: FillStyle,
  position: Vector2
) => {
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.translate(position.x, position.y);
  ctx.translate(vertices[0].x, vertices[0].y);
  ctx.beginPath();
  vertices.forEach((vertex) => {
    ctx.lineTo(vertex.x, vertex.y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};
