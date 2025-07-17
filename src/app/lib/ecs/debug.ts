import { EcsRenderableComponent } from './component';

export class DebugGridComponent extends EcsRenderableComponent {
  public override render(ctx: CanvasRenderingContext2D) {
    const interval = 100;
    const dimension = 20;
    const uvGradient = ctx.createLinearGradient(
      -dimension * interval,
      -dimension * interval,
      dimension * interval,
      dimension * interval
    );
    uvGradient.addColorStop(0, 'green');
    uvGradient.addColorStop(1, 'red');
    for (let x = -dimension; x < dimension + 1; x++) {
      ctx.beginPath();
      ctx.strokeStyle = x == 0 ? 'white' : uvGradient;
      ctx.lineWidth = 1;
      ctx.moveTo(x * interval, -dimension * interval);
      ctx.lineTo(x * interval, dimension * interval);
      ctx.stroke();
    }

    for (let y = -dimension; y < dimension + 1; y++) {
      ctx.beginPath();
      ctx.strokeStyle = y == 0 ? 'white' : uvGradient;
      ctx.lineWidth = 1;
      ctx.moveTo(-dimension * interval, y * interval);
      ctx.lineTo(dimension * interval, y * interval);
      ctx.stroke();
    }
  }
}
