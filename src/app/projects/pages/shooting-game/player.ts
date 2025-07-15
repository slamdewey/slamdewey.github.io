import {
  EcsEntity,
  EcsRenderableComponent,
  Collider,
  EcsScene,
  EcsTransform,
  EcsComponent,
  ActionListener,
} from 'src/app/lib/ecs';
import { Enemy } from './enemy';
import { Vector2 } from 'src/app/lib/coordinate';
import { Projectile } from './projectile';
import { ShootingGameActions, ShootingGameAxes } from './game-input';
import { Rectangle } from 'src/app/lib/ecs/geometry';
import { ObjectPool } from 'src/app/lib/ecs/object-pool';

export class Player extends EcsEntity {
  constructor(scene: EcsScene<RenderingContext>, name: string, projectilePool: ObjectPool<Projectile>) {
    super(scene, name);
    this.createComponent(PlayerRenderable);
    this.createComponent(PlayerController, projectilePool);
    const collision = this.createComponent(Collider, new Rectangle(20, 20), 'player');
    collision.onCollision = (entity) => {
      if (entity instanceof Enemy) {
        this.scene.remove(this);
      }
    };
  }
}

export class PlayerRenderable extends EcsRenderableComponent {
  constructor(
    scene: EcsScene<RenderingContext>,
    entity: EcsEntity,
    transform: EcsTransform,
    private color: string = 'white'
  ) {
    super(scene, entity, transform);
  }

  override render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-10, -10);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
  }
}

export class PlayerController extends EcsComponent {
  private readonly MOVE_SPEED = 150;

  public velocity: Vector2 = new Vector2();

  private readonly shootActionListener: ActionListener = () => this.shoot();
  private readonly projectilePool: ObjectPool<Projectile>;

  constructor(
    scene: EcsScene<RenderingContext>,
    entity: EcsEntity,
    transform: EcsTransform,
    projectilePool: ObjectPool<Projectile>
  ) {
    super(scene, entity, transform);
    this.projectilePool = projectilePool;
  }

  override onAddedToScene(): void {
    this.scene.registerActionListener(ShootingGameActions.Shoot, this.shootActionListener);
  }

  override onRemovedFromScene(): void {
    this.scene.deregisterActionListener(ShootingGameActions.Shoot, this.shootActionListener);
  }

  override update(deltaTime: number): void {
    const moveHorizontal = this.scene.getAxisValue(ShootingGameAxes.MoveX);
    const moveVertical = this.scene.getAxisValue(ShootingGameAxes.MoveY);
    const moveDirection = new Vector2(moveHorizontal, moveVertical).normalize();

    this.velocity = Vector2.scale(moveDirection, this.MOVE_SPEED);
    this.velocity = Vector2.scale(this.velocity, deltaTime);

    this.transform.position = Vector2.plus(this.transform.position, this.velocity);
  }

  shoot() {
    const shootHorizontal = this.scene.getAxisValue(ShootingGameAxes.AimX);
    const shootVertical = this.scene.getAxisValue(ShootingGameAxes.AimY);

    if (shootHorizontal === 0 && shootVertical === 0) {
      return;
    }

    const shootDirection = Vector2.getAngle(shootHorizontal, shootVertical);

    this.projectilePool.instantiate(new Vector2(this.transform.position.x, this.transform.position.y), shootDirection);
  }
}

