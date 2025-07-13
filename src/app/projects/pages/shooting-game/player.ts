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

export class Player extends EcsEntity {
  constructor(scene: EcsScene<RenderingContext>) {
    super(scene, 'Player');
    this.createComponent(PlayerRenderable);
    this.createComponent(PlayerController);
    const collision = this.createComponent(Collider, new Rectangle(20, 20));
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

  private shootActionListener: ActionListener = () => this.shoot();

  constructor(scene: EcsScene<RenderingContext>, entity: EcsEntity, transform: EcsTransform) {
    super(scene, entity, transform);
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
      return; // No shoot direction
    }

    const shootDirection = new Vector2(shootHorizontal, shootVertical).normalize();

    this.scene.createEntity(
      Projectile,
      'Projectile',
      new Vector2(this.transform.position.x, this.transform.position.y),
      shootDirection
    );
  }
}

