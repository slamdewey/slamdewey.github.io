import {
  EcsEntity,
  EcsRenderableComponent,
  EcsComponent,
  Collider,
  EcsScene,
  EcsTransform,
  Rectangle,
} from 'src/app/lib/ecs';
import { Vector2 } from 'src/app/lib/coordinate';
import { Enemy } from './enemy';

export class ProjectileRenderable extends EcsRenderableComponent {
  constructor(
    scene: EcsScene<RenderingContext>,
    entity: EcsEntity,
    transform: EcsTransform,
    private color = 'red'
  ) {
    super(scene, entity, transform);
  }

  override render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, 2 * Math.PI);
    ctx.fill();
  }
}

export class ProjectileComponent extends EcsComponent {
  public speed = 200;

  constructor(scene: EcsScene<RenderingContext>, entity: EcsEntity, transform: EcsTransform) {
    super(scene, entity, transform);
  }

  override update(deltaTime: number): void {
    this.transform.position = Vector2.plus(
      this.transform.position,
      Vector2.scale(this.transform.forward(), this.speed * deltaTime)
    );
  }
}

export class Projectile extends EcsEntity {
  constructor(scene: EcsScene<RenderingContext>, name: string) {
    super(scene, name);
    this.createComponent(ProjectileRenderable);
    this.createComponent(ProjectileComponent);
    const collision = this.createComponent(Collider, new Rectangle(4, 4), 'projectile');
    collision.onCollision = (entity) => {
      if (entity instanceof Enemy) {
        this.scene.remove(this);
      }
    };
  }

  public static create(scene: EcsScene<RenderingContext>, position: Vector2, rotation: number): Projectile {
    const name = `Projectile-${crypto.randomUUID()}`;
    const projectile = new Projectile(scene, name);
    projectile.transform.position = position;
    projectile.transform.rotation = rotation;
    return projectile;
  }
}
