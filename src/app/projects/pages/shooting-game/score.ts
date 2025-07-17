import { EcsRenderableComponent, EcsEntity, EcsTransform, EcsScene } from 'src/app/lib/ecs';

export class ScoreRenderable extends EcsRenderableComponent {
  constructor(
    scene: EcsScene<RenderingContext>,
    entity: EcsEntity,
    transform: EcsTransform,
    private getScore: () => number
  ) {
    super(scene, entity, transform);
  }

  override render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'white';
    ctx.font = '24px Arial';
    ctx.fillText(`Score: ${this.getScore()}`, 10, 30);
  }
}
