import { EcsEntity } from "./entity";
import { EcsScene } from "./scene";
import { EcsTransform } from "./transform";

export class EcsComponent {
  public readonly scene: EcsScene<RenderingContext>;
  public readonly entity: EcsEntity;
  public readonly transform: EcsTransform;
  private _isActive: boolean = true;

  constructor(scene: EcsScene<RenderingContext>, entity: EcsEntity, transform: EcsTransform) {
    this.scene = scene;
    this.entity = entity;
    this.transform = transform;
  }

  public isActive(): boolean {
    return this._isActive;
  }
  public setActive(state: boolean) {
    this._isActive = state;
    if (state) {
      this.onActivate();
    } else {
      this.onDeactivate();
    }
  }

  public onActivate(): void {}
  public onDeactivate(): void {}
  public onAddedToScene(): void {}
  public onRemovedFromScene(): void {}
  public onAddedToEntity(): void {}
  public onRemovedFromEntity(): void {}

  public update(deltaTime: number): void {}
  public lateUpdate(): void {}
  public onDestroy(): void {}
  public drawGizmos<T extends RenderingContext>(ctx: T): void {}
}

export abstract class EcsRenderableComponent extends EcsComponent {
  public abstract render(ctx: RenderingContext): void;
}