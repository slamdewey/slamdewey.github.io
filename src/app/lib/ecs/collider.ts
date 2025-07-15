import { EcsComponent } from './component';
import { EcsEntity } from './entity';
import { EcsScene } from './scene';
import { EcsTransform } from './transform';
import { Rectangle, Shape } from './geometry';

export class Collider extends EcsComponent {
  public shape: Shape;
  public layer: string;
  public onCollision: (entity: EcsEntity) => void = () => {};

  constructor(
    scene: EcsScene<RenderingContext>,
    entity: EcsEntity,
    transform: EcsTransform,
    shape: Shape,
    layer: string
  ) {
    super(scene, entity, transform);
    this.shape = shape;
    this.layer = layer;
  }

  public override drawGizmos<T extends RenderingContext>(ctx: T): void {
    if (this.shape instanceof Rectangle && ctx instanceof CanvasRenderingContext2D) {
      ctx.strokeStyle = 'red';
      ctx.strokeRect(
        this.shape.offset.x - this.shape.width / 2,
        this.shape.offset.y - this.shape.height / 2,
        this.shape.width,
        this.shape.height
      );
    }
  }
}

