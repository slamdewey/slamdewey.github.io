import { Vector2 } from '../coordinate';
import { EcsComponent } from './component';

export abstract class EcsCamera extends EcsComponent {
  
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

export class TransformFollowCamera extends EcsCamera {

}

enum ControllableCameraInputAxes {
 Vertical = 'controllable-camera-Vertical',
 Horizontal = 'controllable-camera-Horizontal'
};
export class ControllableCamera extends EcsCamera {
  private readonly panSpeed = 500;

  public override onAddedToScene(): void {
    this.scene.addKeyBinding('w', { axis: ControllableCameraInputAxes.Vertical, axisDirection: -1 });
    this.scene.addKeyBinding('s', { axis: ControllableCameraInputAxes.Vertical, axisDirection: 1 });
    this.scene.addKeyBinding('a', { axis: ControllableCameraInputAxes.Horizontal, axisDirection: -1 });
    this.scene.addKeyBinding('d', { axis: ControllableCameraInputAxes.Horizontal, axisDirection: 1 });
  }

  public override update(deltaTime: number): void {
    const shootHorizontal = this.scene.getAxisValue(ControllableCameraInputAxes.Vertical);
    const shootVertical = this.scene.getAxisValue(ControllableCameraInputAxes.Horizontal);
    const rawInput = new Vector2(shootHorizontal, shootVertical);
    rawInput.normalize();

    const moveDelta = Vector2.scale(rawInput, (this.panSpeed / this.getZoom()) * deltaTime);
    this.transform.position = Vector2.plus(this.transform.position, moveDelta);
  }
}