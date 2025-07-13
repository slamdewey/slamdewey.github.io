import { Vector2 } from "../coordinate";
import { EcsComponent } from "./component";
import { EcsEntity } from "./entity";
import { EcsScene } from "./scene";
import { EcsTransform } from "./transform";

export class BoxCollider {
  constructor(
    public width: number,
    public height: number,
    public offset: Vector2 = new Vector2()
  ) { }

  public intersects(self: EcsTransform, other: EcsTransform, otherCollider: BoxCollider): boolean {
    const selfLeft = self.position.x + this.offset.x - this.width / 2;
    const selfRight = self.position.x + this.offset.x + this.width / 2;
    const selfTop = self.position.y + this.offset.y - this.height / 2;
    const selfBottom = self.position.y + this.offset.y + this.height / 2;

    const otherLeft = other.position.x + otherCollider.offset.x - otherCollider.width / 2;
    const otherRight = other.position.x + otherCollider.offset.x + otherCollider.width / 2;
    const otherTop = other.position.y + otherCollider.offset.y - otherCollider.height / 2;
    const otherBottom = other.position.y + otherCollider.offset.y + otherCollider.height / 2;

    return selfLeft < otherRight && selfRight > otherLeft && selfTop < otherBottom && selfBottom > otherTop;
  }
}

export abstract class Collider extends EcsComponent {
  public onCollision: (entity: EcsEntity) => void = () => { };
}

export class CollisionComponent extends Collider {
  public collider: BoxCollider;

  constructor(scene: EcsScene<RenderingContext>, entity: EcsEntity, transform: EcsTransform, collider: BoxCollider) {
    super(scene, entity, transform);
    this.collider = collider;
  }
}