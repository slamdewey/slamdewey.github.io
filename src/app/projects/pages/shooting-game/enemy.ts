import { EcsEntity, EcsRenderableComponent, EcsComponent, Collider, EcsScene, EcsTransform } from 'src/app/lib/ecs';
import { Vector2 } from 'src/app/lib/coordinate';
import { Projectile } from './projectile';
import { Rectangle } from 'src/app/lib/ecs/geometry';

export class EnemyRenderable extends EcsRenderableComponent {
  constructor(
    scene: EcsScene<RenderingContext>,
    entity: EcsEntity,
    transform: EcsTransform,
    private color: string = 'green'
  ) {
    super(scene, entity, transform);
  }

  override render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = this.color;
    ctx.fillRect(-10, -10, 20, 20);
  }
}

export class EnemyComponent extends EcsComponent {
  public speed = 50;
  public direction = 1;

  constructor(scene: EcsScene<RenderingContext>, entity: EcsEntity, transform: EcsTransform) {
    super(scene, entity, transform);
  }

  override update(deltaTime: number): void {
    this.transform.position.x += this.speed * this.direction * deltaTime;

    if (this.transform.position.x > 200 || this.transform.position.x < -200) {
      this.direction *= -1;
    }
  }
}

export class Enemy extends EcsEntity {
  constructor(scene: EcsScene<RenderingContext>, name: string, position: Vector2, onDeath: () => void) {
    super(scene, name);
    this.createComponent(EnemyRenderable);
    this.createComponent(EnemyComponent);
    const collision = this.createComponent(Collider, new Rectangle(20, 20), 'enemy');
    collision.onCollision = (entity) => {
      if (entity instanceof Projectile) {
        this.scene.remove(this);
        onDeath();
      }
    };
    this.transform.position = position;
  }
}
