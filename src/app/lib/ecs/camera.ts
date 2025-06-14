import { Vector2 } from '../coordinate';
import { EcsComponent } from './ecs';
import { VirtualAxis } from './scene';

export class EcsCamera extends EcsComponent {
  protected readonly MinZoom: number = 1;
  private _zoom = this.MinZoom;

  public getViewMatrix(origin: Vector2): DOMMatrix {
    const identity = new DOMMatrix();
    if (!this.transform) {
      return identity;
    }
    return identity
      .translate(origin.x, origin.y)
      .scale(this._zoom, this._zoom)
      .translate(-this.transform.position.x, -this.transform.position.y)
      .rotate(0, 0, this.transform.rotation);
  }

  public getZoom(): number {
    return this._zoom;
  }

  public updateZoom(updateFn: (currentZoom: number) => number) {
    this.setZoom(updateFn(this._zoom));
  }

  public setZoom(zoom: number): void {
    zoom = Math.max(zoom, this.MinZoom);
    this._zoom = zoom;
  }
}

export class ControllableCamera extends EcsCamera {
  private readonly panSpeed = 500;
  private downUpInput: VirtualAxis;
  private leftRightInput: VirtualAxis;

  public override onAddedToScene(): void {
    const scene = this.scene!;
    // positive y axis goes downward, so I simply invert input
    this.downUpInput = scene.registerVirtualAxis('w', 's');
    this.leftRightInput = scene.registerVirtualAxis('a', 'd');
  }

  public override update(deltaTime: number): void {
    const transform = this.transform!;
    const rawInput = new Vector2(this.leftRightInput.rawValue, this.downUpInput.rawValue);
    rawInput.normalize();
    const moveDelta = Vector2.scale(rawInput, (this.panSpeed / this.getZoom()) * deltaTime);
    transform.position = Vector2.plus(transform.position, moveDelta);
  }
}
