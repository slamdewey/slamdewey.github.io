import { Vector2 } from '../coordinate';
import { EcsComponent } from './component';

export abstract class EcsCamera extends EcsComponent {
  protected readonly MinZoom: number = 1;
  private _zoom = this.MinZoom;

  public getViewMatrix(): DOMMatrix {
    const viewMatrix = new DOMMatrix();
    // Apply zoom first
    viewMatrix.scale(this._zoom, this._zoom);
    // Apply negative rotation (to rotate the world opposite to camera)
    viewMatrix.rotate(0, 0, -this.transform.rotation);
    // Apply negative translation (to move the world opposite to camera position)
    viewMatrix.translate(-this.transform.position.x, -this.transform.position.y);
    return viewMatrix;
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

enum ControllableCameraInputAxes {
  Vertical = 'ControllableCameraInputAxes-Vertical',
  Horizontal = 'ControllableCameraInputAxes-Horizontal',
}
export class ControllableCamera extends EcsCamera {
  private readonly panSpeed = 500;

  public override onAddedToScene(): void {
    this.scene.addVirtualAxisBinding('w', 's', ControllableCameraInputAxes.Vertical);
    this.scene.addVirtualAxisBinding('a', 'd', ControllableCameraInputAxes.Horizontal);
  }

  public override update(deltaTime: number): void {
    const shootVertical = this.scene.getAxisValue(ControllableCameraInputAxes.Vertical);
    const shootHorizontal = this.scene.getAxisValue(ControllableCameraInputAxes.Horizontal);
    const rawInput = new Vector2(shootHorizontal, shootVertical);
    rawInput.normalize();

    const moveDelta = Vector2.scale(rawInput, (this.panSpeed / this.getZoom()) * deltaTime);
    this.transform.position = Vector2.plus(this.transform.position, moveDelta);
  }
}

export class TransformFollowCamera extends EcsCamera {}
