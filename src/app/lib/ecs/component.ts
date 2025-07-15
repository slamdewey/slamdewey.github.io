import { EcsEntity } from "./entity";
import { EcsScene } from "./scene";
import { EcsTransform } from "./transform";
import { EcsObject } from "./ecs-object";

export class EcsComponent extends EcsObject {
  public readonly scene: EcsScene<RenderingContext>;
  public readonly entity: EcsEntity;
  public readonly transform: EcsTransform;

  constructor(scene: EcsScene<RenderingContext>, entity: EcsEntity, transform: EcsTransform) {
    super();
    this.scene = scene;
    this.entity = entity;
    this.transform = transform;
  }

  public onAddedToScene(): void {}
  public onRemovedFromScene(): void {}
  public onAddedToEntity(): void {}
  public onRemovedFromEntity(): void {}

  public update(deltaTime: number): void {}
  public lateUpdate(): void {}
  public drawGizmos<T extends RenderingContext>(ctx: T): void {}
}

export abstract class EcsRenderableComponent extends EcsComponent {
  public abstract render(ctx: RenderingContext): void;
}