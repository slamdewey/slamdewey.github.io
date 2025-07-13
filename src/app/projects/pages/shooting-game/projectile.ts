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
    private color: string = 'red'
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
  public velocity: Vector2 = new Vector2();
  public speed = 200;

  constructor(scene: EcsScene<RenderingContext>, entity: EcsEntity, transform: EcsTransform) {
    super(scene, entity, transform);
  }

  override update(deltaTime: number): void {
    this.transform.position.x += this.velocity.x * this.speed * deltaTime;
    this.transform.position.y += this.velocity.y * this.speed * deltaTime;
  }
}

export class Projectile extends EcsEntity {
  constructor(scene: EcsScene<RenderingContext>, name: string, position: Vector2, velocity: Vector2) {
    super(scene, name);
    this.createComponent(ProjectileRenderable);
    const projectileComponent = this.createComponent(ProjectileComponent);
    projectileComponent.velocity = velocity;
    const collision = this.createComponent(Collider, new Rectangle(4, 4));
    collision.onCollision = (entity) => {
      if (entity instanceof Enemy) {
        this.scene.remove(this);
      }
    };
    this.transform.position = position;
  }
}

